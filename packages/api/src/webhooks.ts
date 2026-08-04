/**
 * Payment webhook processing. Idempotent at two levels:
 * 1. WebhookEvent rows are unique on (provider, providerEventId) — a replayed
 *    event short-circuits before touching any domain state.
 * 2. Every state transition tolerates being applied twice (already-CONFIRMED
 *    bookings stay confirmed, already-PAID orders don't re-enqueue SMS).
 */

import { cancelBooking, confirmHold } from '@plunj/availability'
import {
  BookingStatus,
  OrderStatus,
  PaymentStatus,
  RefundStatus,
  WebhookStatus,
  id,
} from '@plunj/db'
import type { ActorType, Prisma, PrismaClient } from '@plunj/db'
import type { NormalizedWebhookEvent, PaymentProvider } from '@plunj/payments'
import { audit } from './audit.js'
import { enqueueLifecycleForBooking, waiverStatusFor } from './shared.js'

const PROVIDER = 'payments'

export interface ProcessWebhookOptions {
  /** Injectable clock; defaults to wall time. */
  now?: Date
}

export interface ProcessWebhookResult {
  status: 'processed' | 'skipped' | 'ignored' | 'failed'
  error?: string
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === 'P2002'
  )
}

async function loadPaymentByRef(db: PrismaClient, providerPaymentRef: string) {
  // Provider refs are globally unique in production; the newest-first order
  // makes the lookup deterministic if a ref were ever reused.
  return db.payment.findFirst({
    where: { providerPaymentRef },
    orderBy: { createdAt: 'desc' },
    include: {
      order: {
        include: { bookings: true, customer: true, location: true },
      },
    },
  })
}

/**
 * Mark an order paid: confirm each of its bookings (re-reserving expired
 * holds when the space is still free), flip the order to PAID, and enqueue
 * the confirmation + reminder SMS — outbox rows in the same transaction as
 * the state change, with an AuditLog row (invariants #7 and #8).
 * Idempotent: an already-PAID order is a no-op.
 */
export async function markOrderPaid(
  db: PrismaClient,
  args: { orderId: string; actorType?: ActorType; actorId?: string | null; now: Date },
): Promise<void> {
  const order = await db.order.findUnique({
    where: { id: args.orderId },
    include: { bookings: true, customer: true, location: true },
  })
  if (!order) throw new Error(`Order ${args.orderId} not found`)

  // confirmHold runs its own transaction (row-locked against the expiry cron).
  for (const booking of order.bookings) {
    if (
      booking.status === BookingStatus.HOLD ||
      booking.status === BookingStatus.EXPIRED ||
      booking.status === BookingStatus.CONFIRMED
    ) {
      await confirmHold(db, { bookingId: booking.id, orderId: order.id })
    }
  }

  if (order.status === OrderStatus.PAID) return

  const customer = order.customer
  await db.$transaction(async (tx) => {
    await tx.order.update({ where: { id: order.id }, data: { status: OrderStatus.PAID } })
    if (customer) {
      for (const booking of order.bookings) {
        const unsigned = (await waiverStatusFor(tx, order.locationId, customer.id)) !== 'SIGNED'
        await enqueueLifecycleForBooking(tx, {
          booking,
          customer,
          location: order.location,
          unsigned,
          now: args.now,
        })
      }
    }
    await audit(tx, {
      actorType: args.actorType ?? 'WEBHOOK',
      actorId: args.actorId ?? null,
      locationId: order.locationId,
      action: 'order.paid',
      entityType: 'Order',
      entityId: order.id,
      before: { status: order.status },
      after: { status: OrderStatus.PAID },
    })
  })
}

async function handlePaymentSucceeded(
  db: PrismaClient,
  event: NormalizedWebhookEvent,
  now: Date,
): Promise<void> {
  if (!event.providerPaymentRef) {
    throw new Error('payment.succeeded event has no providerPaymentRef')
  }
  const payment = await loadPaymentByRef(db, event.providerPaymentRef)
  if (!payment) {
    throw new Error(`No payment row for providerPaymentRef ${event.providerPaymentRef}`)
  }
  await markOrderPaid(db, { orderId: payment.orderId, actorId: event.providerEventId, now })
  if (payment.status !== PaymentStatus.SUCCEEDED) {
    await db.payment.update({
      where: { id: payment.id },
      data: { status: PaymentStatus.SUCCEEDED },
    })
  }
}

async function handlePaymentFailed(
  db: PrismaClient,
  event: NormalizedWebhookEvent,
  now: Date,
): Promise<void> {
  if (!event.providerPaymentRef) {
    throw new Error('payment.failed event has no providerPaymentRef')
  }
  const payment = await loadPaymentByRef(db, event.providerPaymentRef)
  if (!payment) {
    throw new Error(`No payment row for providerPaymentRef ${event.providerPaymentRef}`)
  }
  // Release the held seats — the payer is not coming back through this intent.
  for (const booking of payment.order.bookings) {
    if (booking.status === BookingStatus.HOLD) {
      await cancelBooking(db, {
        bookingId: booking.id,
        reason: 'payment failed',
        releaseSeats: true,
        now,
      })
    }
  }
  await db.$transaction(async (tx) => {
    if (payment.status !== PaymentStatus.FAILED) {
      await tx.payment.update({
        where: { id: payment.id },
        data: { status: PaymentStatus.FAILED },
      })
    }
    await audit(tx, {
      actorType: 'WEBHOOK',
      actorId: event.providerEventId,
      locationId: payment.locationId,
      action: 'payment.failed',
      entityType: 'Payment',
      entityId: payment.id,
      after: { status: PaymentStatus.FAILED },
    })
  })
}

async function handleRefundSucceeded(
  db: PrismaClient,
  event: NormalizedWebhookEvent,
): Promise<void> {
  if (!event.providerRefundRef) {
    throw new Error('refund.succeeded event has no providerRefundRef')
  }
  const refund = await db.refund.findFirst({
    where: { providerRefundRef: event.providerRefundRef },
    orderBy: { createdAt: 'desc' },
  })
  if (!refund) {
    throw new Error(`No refund row for providerRefundRef ${event.providerRefundRef}`)
  }
  if (refund.status !== RefundStatus.SUCCEEDED) {
    await db.refund.update({
      where: { id: refund.id },
      data: { status: RefundStatus.SUCCEEDED },
    })
  }
}

async function handleDisputeCreated(
  db: PrismaClient,
  event: NormalizedWebhookEvent,
): Promise<void> {
  if (!event.providerPaymentRef) {
    throw new Error('dispute.created event has no providerPaymentRef')
  }
  const payment = await loadPaymentByRef(db, event.providerPaymentRef)
  if (!payment) {
    throw new Error(`No payment row for providerPaymentRef ${event.providerPaymentRef}`)
  }
  await db.$transaction(async (tx) => {
    await audit(tx, {
      actorType: 'WEBHOOK',
      actorId: event.providerEventId,
      locationId: payment.locationId,
      action: 'order.dispute_created',
      entityType: 'Order',
      entityId: payment.orderId,
      after: { providerPaymentRef: event.providerPaymentRef, rawType: event.rawType },
    })
  })
}

/**
 * Entry point for the webhook route: record the event (skipping replays via
 * the unique providerEventId), apply the transition, mark PROCESSED/FAILED.
 */
export async function processWebhookEvent(
  db: PrismaClient,
  payments: PaymentProvider,
  event: NormalizedWebhookEvent,
  options: ProcessWebhookOptions = {},
): Promise<ProcessWebhookResult> {
  void payments // reserved for handlers that need to re-query the provider
  const now = options.now ?? new Date()

  try {
    await db.webhookEvent.create({
      data: {
        id: id(),
        provider: PROVIDER,
        providerEventId: event.providerEventId,
        type: event.type,
        payload: (event.payload ?? {}) as Prisma.InputJsonValue,
        status: WebhookStatus.RECEIVED,
      },
    })
  } catch (err) {
    if (isUniqueViolation(err)) return { status: 'skipped' }
    throw err
  }

  const key = {
    provider_providerEventId: { provider: PROVIDER, providerEventId: event.providerEventId },
  }

  try {
    let handled = true
    switch (event.type) {
      case 'payment.succeeded':
        await handlePaymentSucceeded(db, event, now)
        break
      case 'payment.failed':
        await handlePaymentFailed(db, event, now)
        break
      case 'refund.succeeded':
        await handleRefundSucceeded(db, event)
        break
      case 'dispute.created':
        await handleDisputeCreated(db, event)
        break
      default:
        handled = false
        break
    }
    await db.webhookEvent.update({
      where: key,
      data: { status: WebhookStatus.PROCESSED, processedAt: now },
    })
    return { status: handled ? 'processed' : 'ignored' }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await db.webhookEvent.update({
      where: key,
      data: { status: WebhookStatus.FAILED, error: message },
    })
    return { status: 'failed', error: message }
  }
}
