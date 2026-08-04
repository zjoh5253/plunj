import { BookingStatus, LedgerReason } from '@plunj/db'
import { afterAll, describe, expect, test } from 'vitest'
import { processWebhookEvent } from '../src/index.js'
import {
  callerFor,
  createClient,
  newEnv,
  seedLocation,
  seedSession,
  uniquePhone,
  uniquifyEvent,
} from './helpers.js'

const db = createClient()
afterAll(async () => db.$disconnect())

async function paidBooking(startsInMs: number) {
  const t0 = new Date()
  const env = newEnv(db)
  const { location, studio } = await seedLocation(db)
  const startsAt = new Date(t0.getTime() + startsInMs)
  const session = await seedSession(db, studio, { startsAt, capacity: 8, priceCents: 4500 })
  const phone = uniquePhone()
  const caller = await callerFor(env, { now: () => t0 })
  const started = await caller.public.checkout.start({
    locationSlug: location.slug,
    items: [{ kind: 'DROP_IN', sessionId: session.id, seats: 1 }],
    customer: { firstName: 'Cancelly', phone },
  })
  const payment = await db.payment.findFirstOrThrow({ where: { orderId: started.orderId } })
  await processWebhookEvent(
    db,
    env.payments,
    uniquifyEvent(
      env.payments.makeWebhookEvent(payment.providerPaymentRef ?? '', 'payment.succeeded'),
    ),
    { now: t0 },
  )
  const booking = await db.booking.findUniqueOrThrow({ where: { id: started.bookingId } })
  return { env, t0, location, session, phone, caller, started, booking }
}

const HOUR_MS = 60 * 60 * 1000

describe('manage.cancel', () => {
  test('outside the 1h window → cancelled + seats released + account credit + SMS with credit', async () => {
    const { caller, booking, session, started, phone } = await paidBooking(3 * 24 * HOUR_MS)

    const result = await caller.public.manage.cancel({ token: booking.manageToken })
    expect(result.cancelled).toBe(true)
    expect(result.creditCents).toBe(started.quote.totalCents)

    const cancelled = await db.booking.findUniqueOrThrow({ where: { id: booking.id } })
    expect(cancelled.status).toBe(BookingStatus.CANCELLED)

    const freedSession = await db.session.findUniqueOrThrow({ where: { id: session.id } })
    expect(freedSession.bookedSeats).toBe(0)

    const ledger = await db.storedValueLedger.findMany({
      where: { customerId: booking.customerId, reason: LedgerReason.CANCELLATION_CREDIT },
    })
    expect(ledger).toHaveLength(1)
    expect(ledger[0]!.deltaCents).toBe(started.quote.totalCents)

    const sms = await db.outboxMessage.findMany({
      where: { recipient: phone, template: 'booking-cancelled' },
    })
    expect(sms).toHaveLength(1)
    expect((sms[0]!.payload as { creditCents?: number }).creditCents).toBe(started.quote.totalCents)

    const auditRows = await db.auditLog.findMany({
      where: { action: 'booking.cancel', entityId: booking.id },
    })
    expect(auditRows).toHaveLength(1)
  })

  test('inside the 1h window → cancelled, NO credit, seats stay consumed', async () => {
    const { caller, booking, session, phone } = await paidBooking(HOUR_MS / 2)

    const result = await caller.public.manage.cancel({ token: booking.manageToken })
    expect(result.cancelled).toBe(true)
    expect(result.creditCents).toBe(0)

    const cancelled = await db.booking.findUniqueOrThrow({ where: { id: booking.id } })
    expect(cancelled.status).toBe(BookingStatus.CANCELLED)

    // Late cancellation keeps the seats consumed.
    const heldSession = await db.session.findUniqueOrThrow({ where: { id: session.id } })
    expect(heldSession.bookedSeats).toBe(1)

    const ledger = await db.storedValueLedger.findMany({
      where: { customerId: booking.customerId, reason: LedgerReason.CANCELLATION_CREDIT },
    })
    expect(ledger).toHaveLength(0)

    const sms = await db.outboxMessage.findMany({
      where: { recipient: phone, template: 'booking-cancelled' },
    })
    expect(sms).toHaveLength(1)
    expect((sms[0]!.payload as { creditCents?: number }).creditCents).toBeUndefined()
  })
})

describe('manage.reschedule', () => {
  test('rejects a different-priced session with the v1 message', async () => {
    const { caller, booking, session } = await paidBooking(3 * 24 * HOUR_MS)
    const studio = await db.studio.findUniqueOrThrow({ where: { id: session.studioId } })
    const pricier = await seedSession(db, studio, {
      startsAt: new Date(session.startsAt.getTime() + 2 * HOUR_MS),
      priceCents: 9900,
    })
    await expect(
      caller.public.manage.reschedule({ token: booking.manageToken, newSessionId: pricier.id }),
    ).rejects.toThrowError(/pick a same-priced time or contact the studio/)
  })

  test('moves a confirmed booking to a same-priced session', async () => {
    const { caller, booking, session } = await paidBooking(3 * 24 * HOUR_MS)
    const studio = await db.studio.findUniqueOrThrow({ where: { id: session.studioId } })
    const target = await seedSession(db, studio, {
      startsAt: new Date(session.startsAt.getTime() + 2 * HOUR_MS),
      priceCents: 4500,
    })
    const moved = await caller.public.manage.reschedule({
      token: booking.manageToken,
      newSessionId: target.id,
    })

    const oldBooking = await db.booking.findUniqueOrThrow({ where: { id: booking.id } })
    expect(oldBooking.status).toBe(BookingStatus.CANCELLED)
    const newBooking = await db.booking.findUniqueOrThrow({ where: { id: moved.bookingId } })
    expect(newBooking.status).toBe(BookingStatus.CONFIRMED)
    expect(newBooking.sessionId).toBe(target.id)
    expect(newBooking.orderId).toBe(oldBooking.orderId)

    const oldSession = await db.session.findUniqueOrThrow({ where: { id: session.id } })
    expect(oldSession.bookedSeats).toBe(0)
    const newSession = await db.session.findUniqueOrThrow({ where: { id: target.id } })
    expect(newSession.bookedSeats).toBe(1)
  })
})
