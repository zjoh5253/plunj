import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { BookingStatus, BookingType } from '@plunj/db'
import type { Customer, Location, PrismaClient, Session, Studio } from '@plunj/db'
import {
  cancelBooking,
  confirmHold,
  createHold,
  expireHolds,
  tryReserveSeats,
  HoldExpiredError,
} from '../src/index.js'
import { createClient, seedCustomer, seedLocation, seedOrder, seedSession } from './helpers.js'

describe('holds lifecycle', () => {
  let db: PrismaClient
  let location: Location
  let studio: Studio
  let customer: Customer

  beforeAll(async () => {
    db = createClient()
    ;({ location, studio } = await seedLocation(db))
    customer = await seedCustomer(db)
  })

  afterAll(async () => {
    await db.$disconnect()
  })

  let sessionHour = 0
  async function freshSession(capacity = 8): Promise<Session> {
    // Unique startsAt per call — (studioId, startsAt) is unique.
    return seedSession(db, studio, {
      startsAt: new Date(Date.UTC(2026, 7, 1 + Math.floor(sessionHour / 24), sessionHour++ % 24)),
      capacity,
    })
  }

  function holdInput(session: Session, seats: number, holdMinutes: number, now: Date) {
    return {
      sessionId: session.id,
      locationId: location.id,
      studioId: studio.id,
      customerId: customer.id,
      seats,
      startsAt: session.startsAt,
      endsAt: session.endsAt,
      holdMinutes,
      type: BookingType.DROP_IN,
      now,
    }
  }

  it('expireHolds releases the seats and marks the booking EXPIRED', async () => {
    const session = await freshSession()
    const now = new Date('2026-07-01T12:00:00Z')
    const hold = await createHold(db, holdInput(session, 2, 10, now))
    expect(hold.holdExpiresAt?.toISOString()).toBe('2026-07-01T12:10:00.000Z')
    expect((await db.session.findUniqueOrThrow({ where: { id: session.id } })).bookedSeats).toBe(2)

    // One minute before expiry: nothing happens.
    expect(await expireHolds(db, { now: new Date('2026-07-01T12:09:00Z') })).toBe(0)

    const expired = await expireHolds(db, { now: new Date('2026-07-01T12:11:00Z') })
    expect(expired).toBe(1)
    expect((await db.session.findUniqueOrThrow({ where: { id: session.id } })).bookedSeats).toBe(0)
    expect((await db.booking.findUniqueOrThrow({ where: { id: hold.id } })).status).toBe(
      BookingStatus.EXPIRED,
    )
  })

  it('confirmHold after expiry re-reserves when space remains (slow payer wins)', async () => {
    const session = await freshSession()
    const now = new Date('2026-07-01T12:00:00Z')
    const hold = await createHold(db, holdInput(session, 2, 10, now))
    await expireHolds(db, { now: new Date('2026-07-01T12:11:00Z') })

    const order = await seedOrder(db, location)
    const confirmed = await confirmHold(db, { bookingId: hold.id, orderId: order.id })
    expect(confirmed.status).toBe(BookingStatus.CONFIRMED)
    expect(confirmed.orderId).toBe(order.id)
    expect(confirmed.holdExpiresAt).toBeNull()
    expect((await db.session.findUniqueOrThrow({ where: { id: session.id } })).bookedSeats).toBe(2)
  })

  it('confirmHold after expiry fails when the session filled up meanwhile', async () => {
    const session = await freshSession(4)
    const now = new Date('2026-07-01T12:00:00Z')
    const hold = await createHold(db, holdInput(session, 2, 10, now))
    await expireHolds(db, { now: new Date('2026-07-01T12:11:00Z') })

    // Someone else takes 3 of the 4 seats — only 1 left, the hold needed 2.
    expect(await tryReserveSeats(db, { sessionId: session.id, seats: 3 })).toBe(true)

    const order = await seedOrder(db, location)
    await expect(confirmHold(db, { bookingId: hold.id, orderId: order.id })).rejects.toThrow(
      HoldExpiredError,
    )
    const after = await db.booking.findUniqueOrThrow({ where: { id: hold.id } })
    expect(after.status).toBe(BookingStatus.EXPIRED)
    expect((await db.session.findUniqueOrThrow({ where: { id: session.id } })).bookedSeats).toBe(3)
  })

  it('double confirm is idempotent and never double-reserves', async () => {
    const session = await freshSession()
    const now = new Date('2026-07-01T12:00:00Z')
    const hold = await createHold(db, holdInput(session, 2, 10, now))
    const order = await seedOrder(db, location)

    const first = await confirmHold(db, { bookingId: hold.id, orderId: order.id })
    const second = await confirmHold(db, { bookingId: hold.id, orderId: order.id })
    expect(first.status).toBe(BookingStatus.CONFIRMED)
    expect(second.status).toBe(BookingStatus.CONFIRMED)
    expect(second.orderId).toBe(order.id)
    expect((await db.session.findUniqueOrThrow({ where: { id: session.id } })).bookedSeats).toBe(2)
  })

  it('a confirmed hold is not swept by the expiry cron', async () => {
    const session = await freshSession()
    const now = new Date('2026-07-01T12:00:00Z')
    const hold = await createHold(db, holdInput(session, 1, 10, now))
    const order = await seedOrder(db, location)
    await confirmHold(db, { bookingId: hold.id, orderId: order.id })

    expect(await expireHolds(db, { now: new Date('2026-07-02T00:00:00Z') })).toBe(0)
    expect((await db.session.findUniqueOrThrow({ where: { id: session.id } })).bookedSeats).toBe(1)
  })

  it('cancelBooking releases seats when asked and is idempotent', async () => {
    const session = await freshSession()
    const now = new Date('2026-07-01T12:00:00Z')
    const hold = await createHold(db, holdInput(session, 2, 10, now))
    const order = await seedOrder(db, location)
    await confirmHold(db, { bookingId: hold.id, orderId: order.id })

    const cancelled = await cancelBooking(db, {
      bookingId: hold.id,
      reason: 'customer request',
      releaseSeats: true,
      now,
    })
    expect(cancelled.status).toBe(BookingStatus.CANCELLED)
    expect(cancelled.cancellationReason).toBe('customer request')
    expect((await db.session.findUniqueOrThrow({ where: { id: session.id } })).bookedSeats).toBe(0)

    // Idempotent re-cancel: no error, seats not double-released.
    const again = await cancelBooking(db, {
      bookingId: hold.id,
      reason: 'retry',
      releaseSeats: true,
      now,
    })
    expect(again.status).toBe(BookingStatus.CANCELLED)
    expect((await db.session.findUniqueOrThrow({ where: { id: session.id } })).bookedSeats).toBe(0)
  })

  it('cancelBooking can keep seats consumed (late cancellation policy)', async () => {
    const session = await freshSession()
    const now = new Date('2026-07-01T12:00:00Z')
    const hold = await createHold(db, holdInput(session, 2, 10, now))
    const order = await seedOrder(db, location)
    await confirmHold(db, { bookingId: hold.id, orderId: order.id })

    await cancelBooking(db, { bookingId: hold.id, reason: 'late cancel', releaseSeats: false, now })
    expect((await db.session.findUniqueOrThrow({ where: { id: session.id } })).bookedSeats).toBe(2)
  })
})
