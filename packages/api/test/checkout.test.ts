import { SoldOutError } from '@plunj/availability'
import { BookingStatus, OrderStatus, PaymentStatus } from '@plunj/db'
import { TRPCError } from '@trpc/server'
import { afterAll, describe, expect, test } from 'vitest'
import { processWebhookEvent } from '../src/index.js'
import {
  callerFor,
  createClient,
  daysFromNow,
  newEnv,
  seedDiscount,
  seedLocation,
  seedSession,
  uniquePhone,
  uniquifyEvent,
} from './helpers.js'

const db = createClient()
afterAll(async () => db.$disconnect())

describe('checkout', () => {
  test('happy path: quote → start → webhook succeed → CONFIRMED + PAID + outbox', async () => {
    const env = newEnv(db)
    const { location, studio } = await seedLocation(db)
    const session = await seedSession(db, studio, {
      startsAt: daysFromNow(3),
      priceCents: 4500,
      capacity: 8,
    })
    const caller = await callerFor(env)
    const phone = uniquePhone()

    const items = [{ kind: 'DROP_IN' as const, sessionId: session.id, seats: 2 }]
    const quoted = await caller.public.checkout.quote({
      locationSlug: location.slug,
      items,
      tipCents: 500,
    })
    expect(quoted.ok).toBe(true)

    const started = await caller.public.checkout.start({
      locationSlug: location.slug,
      items,
      tipCents: 500,
      customer: { firstName: 'Jo', lastName: 'Plunger', phone },
    })

    // checkout.start recomputes and stores exactly checkout.quote's numbers.
    if (!quoted.ok) throw new Error('unreachable')
    expect(started.quote).toEqual(quoted.quote)

    expect(started.clientSecret).toBeTruthy()
    expect(started.holdExpiresAt).toBeTruthy()

    const order = await db.order.findUniqueOrThrow({
      where: { id: started.orderId },
      include: { lines: true },
    })
    expect(order.status).toBe(OrderStatus.PENDING)
    expect(order.subtotalCents).toBe(quoted.quote.subtotalCents)
    expect(order.discountCents).toBe(quoted.quote.discountCents)
    expect(order.taxCents).toBe(quoted.quote.taxCents)
    expect(order.tipCents).toBe(500)
    expect(order.totalCents).toBe(quoted.quote.totalCents)
    expect(order.lines).toHaveLength(1)
    expect(order.lines[0]!.lineTotalCents).toBe(quoted.quote.lines[0]!.lineTotalCents)
    expect(order.lines[0]!.refId).toBe(session.id)

    // Hold consumed real seats.
    const heldSession = await db.session.findUniqueOrThrow({ where: { id: session.id } })
    expect(heldSession.bookedSeats).toBe(2)

    // Audit row written in the checkout transaction (invariant #7).
    const auditRows = await db.auditLog.findMany({
      where: { action: 'checkout.start', entityId: started.orderId },
    })
    expect(auditRows).toHaveLength(1)

    // Simulate async payment success via the normalized webhook.
    const payment = await db.payment.findFirstOrThrow({ where: { orderId: started.orderId } })
    expect(payment.status).toBe(PaymentStatus.REQUIRES_ACTION)
    const event = uniquifyEvent(
      env.payments.makeWebhookEvent(payment.providerPaymentRef ?? '', 'payment.succeeded'),
    )
    const result = await processWebhookEvent(db, env.payments, event)
    expect(result.status).toBe('processed')

    const booking = await db.booking.findUniqueOrThrow({ where: { id: started.bookingId } })
    expect(booking.status).toBe(BookingStatus.CONFIRMED)
    expect(booking.orderId).toBe(started.orderId)

    const paidOrder = await db.order.findUniqueOrThrow({ where: { id: started.orderId } })
    expect(paidOrder.status).toBe(OrderStatus.PAID)

    const settledPayment = await db.payment.findUniqueOrThrow({ where: { id: payment.id } })
    expect(settledPayment.status).toBe(PaymentStatus.SUCCEEDED)

    // Outbox rows (invariant #8): confirmation now + 24h + 2h reminders.
    const outbox = await db.outboxMessage.findMany({ where: { recipient: phone } })
    const templates = outbox.map((m) => m.template).sort()
    expect(templates).toEqual(
      ['booking-confirmed', 'booking-reminder-24h', 'booking-reminder-2h'].sort(),
    )
  })

  test('sold-out session → CONFLICT with SoldOutError cause', async () => {
    const env = newEnv(db)
    const { location, studio } = await seedLocation(db)
    const session = await seedSession(db, studio, {
      startsAt: daysFromNow(2),
      capacity: 1,
    })
    const caller = await callerFor(env)

    const attempt = caller.public.checkout.start({
      locationSlug: location.slug,
      items: [{ kind: 'DROP_IN', sessionId: session.id, seats: 2 }],
      customer: { firstName: 'Overflow', phone: uniquePhone() },
    })
    await expect(attempt).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(TRPCError)
      const trpcErr = err as TRPCError
      expect(trpcErr.code).toBe('CONFLICT')
      expect(trpcErr.cause).toBeInstanceOf(SoldOutError)
      return true
    })

    // Nothing was written.
    const after = await db.session.findUniqueOrThrow({ where: { id: session.id } })
    expect(after.bookedSeats).toBe(0)
  })

  test('zero-total order (100% off) skips the provider and confirms immediately', async () => {
    const env = newEnv(db)
    const { location, studio } = await seedLocation(db, { taxRateBps: 0 })
    const session = await seedSession(db, studio, {
      startsAt: daysFromNow(2),
      priceCents: 4500,
    })
    await seedDiscount(db, {
      locationId: location.id,
      code: 'FREEBIE',
      type: 'PERCENT',
      valueBps: 10000,
    })
    const caller = await callerFor(env)
    const started = await caller.public.checkout.start({
      locationSlug: location.slug,
      items: [{ kind: 'DROP_IN', sessionId: session.id, seats: 1 }],
      discountCode: 'freebie',
      customer: { firstName: 'Free', phone: uniquePhone() },
    })
    expect(started.quote.totalCents).toBe(0)
    expect(started.clientSecret).toBeNull()

    const booking = await db.booking.findUniqueOrThrow({ where: { id: started.bookingId } })
    expect(booking.status).toBe(BookingStatus.CONFIRMED)
    const order = await db.order.findUniqueOrThrow({ where: { id: started.orderId } })
    expect(order.status).toBe(OrderStatus.PAID)
    const payments = await db.payment.findMany({ where: { orderId: started.orderId } })
    expect(payments).toHaveLength(0)
  })
})
