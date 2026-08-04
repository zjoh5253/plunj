import { expireHolds } from '@plunj/availability'
import { BookingStatus, OrderStatus, WebhookStatus } from '@plunj/db'
import { afterAll, describe, expect, test } from 'vitest'
import { processWebhookEvent } from '../src/index.js'
import {
  callerFor,
  createClient,
  daysFromNow,
  newEnv,
  seedLocation,
  seedSession,
  uniquePhone,
  uniquifyEvent,
} from './helpers.js'

const db = createClient()
afterAll(async () => db.$disconnect())

async function startCheckout(now: () => Date = () => new Date()) {
  const env = newEnv(db)
  const { location, studio } = await seedLocation(db)
  const session = await seedSession(db, studio, { startsAt: daysFromNow(3), capacity: 4 })
  const caller = await callerFor(env, { now })
  const started = await caller.public.checkout.start({
    locationSlug: location.slug,
    items: [{ kind: 'DROP_IN', sessionId: session.id, seats: 2 }],
    customer: { firstName: 'Hook', phone: uniquePhone() },
  })
  const payment = await db.payment.findFirstOrThrow({ where: { orderId: started.orderId } })
  return { env, location, session, started, payment }
}

describe('webhook processing', () => {
  test('same event twice → exactly one transition, one outbox batch', async () => {
    const { env, payment, started } = await startCheckout()
    const event = uniquifyEvent(
      env.payments.makeWebhookEvent(payment.providerPaymentRef ?? '', 'payment.succeeded'),
    )

    const first = await processWebhookEvent(db, env.payments, event)
    expect(first.status).toBe('processed')
    const outboxAfterFirst = await db.outboxMessage.count({
      where: { template: 'booking-confirmed' },
    })

    const second = await processWebhookEvent(db, env.payments, event)
    expect(second.status).toBe('skipped')

    const outboxAfterSecond = await db.outboxMessage.count({
      where: { template: 'booking-confirmed' },
    })
    expect(outboxAfterSecond).toBe(outboxAfterFirst)

    const events = await db.webhookEvent.findMany({
      where: { providerEventId: event.providerEventId },
    })
    expect(events).toHaveLength(1)
    expect(events[0]!.status).toBe(WebhookStatus.PROCESSED)

    const booking = await db.booking.findUniqueOrThrow({ where: { id: started.bookingId } })
    expect(booking.status).toBe(BookingStatus.CONFIRMED)
  })

  test('a distinct duplicate success event leaves an already-CONFIRMED booking confirmed', async () => {
    const { env, payment, started } = await startCheckout()
    const eventA = uniquifyEvent(
      env.payments.makeWebhookEvent(payment.providerPaymentRef ?? '', 'payment.succeeded'),
    )
    await processWebhookEvent(db, env.payments, eventA)
    const outboxBefore = await db.outboxMessage.count()

    const eventB = uniquifyEvent(
      env.payments.makeWebhookEvent(payment.providerPaymentRef ?? '', 'payment.succeeded'),
    )
    const result = await processWebhookEvent(db, env.payments, eventB)
    expect(result.status).toBe('processed')

    const booking = await db.booking.findUniqueOrThrow({ where: { id: started.bookingId } })
    expect(booking.status).toBe(BookingStatus.CONFIRMED)
    // Already-PAID order: no second confirmation SMS batch.
    expect(await db.outboxMessage.count()).toBe(outboxBefore)
  })

  test('expired hold + late webhook succeed → re-reserve wins when space remains', async () => {
    const t0 = new Date()
    const { env, payment, started, session } = await startCheckout(() => t0)

    // The expiry cron sweeps the stale hold and releases the seats.
    const t1 = new Date(t0.getTime() + 11 * 60_000)
    const expired = await expireHolds(db, { now: t1 })
    expect(expired).toBeGreaterThanOrEqual(1)
    const releasedSession = await db.session.findUniqueOrThrow({ where: { id: session.id } })
    expect(releasedSession.bookedSeats).toBe(0)
    const expiredBooking = await db.booking.findUniqueOrThrow({ where: { id: started.bookingId } })
    expect(expiredBooking.status).toBe(BookingStatus.EXPIRED)

    // The slow payer's webhook still lands — confirmHold re-reserves.
    const event = uniquifyEvent(
      env.payments.makeWebhookEvent(payment.providerPaymentRef ?? '', 'payment.succeeded'),
    )
    const result = await processWebhookEvent(db, env.payments, event, { now: t1 })
    expect(result.status).toBe('processed')

    const booking = await db.booking.findUniqueOrThrow({ where: { id: started.bookingId } })
    expect(booking.status).toBe(BookingStatus.CONFIRMED)
    const reservedSession = await db.session.findUniqueOrThrow({ where: { id: session.id } })
    expect(reservedSession.bookedSeats).toBe(2)
  })

  test('expired hold whose seats were re-sold → webhook marked FAILED, booking stays EXPIRED', async () => {
    const t0 = new Date()
    const { env, payment, started, session } = await startCheckout(() => t0)
    const t1 = new Date(t0.getTime() + 11 * 60_000)
    await expireHolds(db, { now: t1 })
    // Someone else takes every seat.
    await db.session.update({
      where: { id: session.id },
      data: { bookedSeats: 4 },
    })

    const event = uniquifyEvent(
      env.payments.makeWebhookEvent(payment.providerPaymentRef ?? '', 'payment.succeeded'),
    )
    const result = await processWebhookEvent(db, env.payments, event, { now: t1 })
    expect(result.status).toBe('failed')

    const booking = await db.booking.findUniqueOrThrow({ where: { id: started.bookingId } })
    expect(booking.status).toBe(BookingStatus.EXPIRED)
    const row = await db.webhookEvent.findFirstOrThrow({
      where: { providerEventId: event.providerEventId },
    })
    expect(row.status).toBe(WebhookStatus.FAILED)
  })

  test('payment.failed cancels the hold and releases the seats', async () => {
    const { env, payment, started, session } = await startCheckout()
    const event = uniquifyEvent(
      env.payments.makeWebhookEvent(payment.providerPaymentRef ?? '', 'payment.failed'),
    )
    const result = await processWebhookEvent(db, env.payments, event)
    expect(result.status).toBe('processed')

    const booking = await db.booking.findUniqueOrThrow({ where: { id: started.bookingId } })
    expect(booking.status).toBe(BookingStatus.CANCELLED)
    const releasedSession = await db.session.findUniqueOrThrow({ where: { id: session.id } })
    expect(releasedSession.bookedSeats).toBe(0)
    const order = await db.order.findUniqueOrThrow({ where: { id: started.orderId } })
    expect(order.status).toBe(OrderStatus.PENDING)
  })
})
