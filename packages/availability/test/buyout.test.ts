import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { BookingStatus, BookingType, SessionStatus } from '@plunj/db'
import type { Customer, Location, PrismaClient, Session, Studio } from '@plunj/db'
import {
  cancelBooking,
  claimBuyout,
  confirmHold,
  createHold,
  expireHolds,
  findBuyoutWindows,
  tryReserveSeats,
  BuyoutUnavailableError,
  SoldOutError,
} from '../src/index.js'
import { createClient, seedCustomer, seedLocation, seedOrder, seedSession } from './helpers.js'

describe('buyouts', () => {
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

  let day = 1
  /** Four contiguous 60-min sessions starting 10:00 local (16:00Z) on a fresh June day. */
  async function contiguousDay(): Promise<{ date: string; sessions: Session[] }> {
    const date = `2026-09-${String(day++).padStart(2, '0')}`
    const sessions: Session[] = []
    for (let hour = 0; hour < 4; hour++) {
      sessions.push(
        await seedSession(db, studio, {
          startsAt: new Date(`${date}T${16 + hour}:00:00Z`), // 10:00+ local America/Denver (MDT)
          capacity: 8,
        }),
      )
    }
    return { date, sessions }
  }

  function claimInput(sessions: Session[], holdMinutes = 10, now?: Date) {
    return {
      sessionIds: sessions.map((s) => s.id),
      locationId: location.id,
      studioId: studio.id,
      customerId: customer.id,
      holdMinutes,
      priceCents: 30_000,
      ...(now ? { now } : {}),
    }
  }

  it('findBuyoutWindows lists every start where enough consecutive sessions are open and empty', async () => {
    const { date, sessions } = await contiguousDay()

    const windows = await findBuyoutWindows(db, { locationId: location.id, date, durationHours: 2 })
    expect(windows).toHaveLength(3)
    expect(windows.map((w) => w.sessionIds)).toEqual([
      [sessions[0]!.id, sessions[1]!.id],
      [sessions[1]!.id, sessions[2]!.id],
      [sessions[2]!.id, sessions[3]!.id],
    ])
    expect(windows[0]!.startsAt).toEqual(sessions[0]!.startsAt)
    expect(windows[0]!.endsAt).toEqual(sessions[1]!.endsAt)

    // A single held seat on the third session eliminates every window touching it.
    expect(await tryReserveSeats(db, { sessionId: sessions[2]!.id, seats: 1 })).toBe(true)
    const after = await findBuyoutWindows(db, { locationId: location.id, date, durationHours: 2 })
    expect(after.map((w) => w.sessionIds)).toEqual([[sessions[0]!.id, sessions[1]!.id]])
  })

  it('claimBuyout flips the sessions to EXCLUSIVE and blocks drop-ins', async () => {
    const { sessions } = await contiguousDay()
    const [s0, s1] = sessions

    const booking = await claimBuyout(db, claimInput([s0!, s1!]))
    expect(booking.type).toBe(BookingType.BUYOUT)
    expect(booking.status).toBe(BookingStatus.HOLD)
    expect(booking.startsAt).toEqual(s0!.startsAt)
    expect(booking.endsAt).toEqual(s1!.endsAt)
    expect(booking.sessionId).toBeNull() // multi-session buyout

    for (const s of [s0!, s1!]) {
      const row = await db.session.findUniqueOrThrow({ where: { id: s.id } })
      expect(row.status).toBe(SessionStatus.EXCLUSIVE)
      expect(row.bookedSeats).toBe(row.capacity)
      expect(row.exclusiveBookingId).toBe(booking.id)
    }

    await expect(
      createHold(db, {
        sessionId: s0!.id,
        locationId: location.id,
        studioId: studio.id,
        customerId: customer.id,
        seats: 1,
        startsAt: s0!.startsAt,
        endsAt: s0!.endsAt,
        type: BookingType.DROP_IN,
      }),
    ).rejects.toThrow(SoldOutError)
  })

  it('claimBuyout fails listing the conflicting sessionIds and writes nothing', async () => {
    const { sessions } = await contiguousDay()
    const [, , s2, s3] = sessions
    expect(await tryReserveSeats(db, { sessionId: s2!.id, seats: 1 })).toBe(true)

    let error: unknown
    try {
      await claimBuyout(db, claimInput([s2!, s3!]))
    } catch (e) {
      error = e
    }
    expect(error).toBeInstanceOf(BuyoutUnavailableError)
    expect((error as BuyoutUnavailableError).conflictingSessionIds).toEqual([s2!.id])

    // Nothing was written: s3 untouched, no booking created.
    const s3After = await db.session.findUniqueOrThrow({ where: { id: s3!.id } })
    expect(s3After.status).toBe(SessionStatus.OPEN)
    expect(s3After.bookedSeats).toBe(0)
    expect(
      await db.booking.count({ where: { type: BookingType.BUYOUT, startsAt: s2!.startsAt } }),
    ).toBe(0)
  })

  it('claimBuyout rejects non-consecutive sessions', async () => {
    const { sessions } = await contiguousDay()
    const [s0, , s2] = sessions
    await expect(claimBuyout(db, claimInput([s0!, s2!]))).rejects.toThrow(BuyoutUnavailableError)
  })

  it('cancelBooking(releaseSeats: true) reverts the sessions to OPEN', async () => {
    const { sessions } = await contiguousDay()
    const [s0, s1] = sessions
    const booking = await claimBuyout(db, claimInput([s0!, s1!]))

    await cancelBooking(db, { bookingId: booking.id, reason: 'changed plans', releaseSeats: true })
    for (const s of [s0!, s1!]) {
      const row = await db.session.findUniqueOrThrow({ where: { id: s.id } })
      expect(row.status).toBe(SessionStatus.OPEN)
      expect(row.bookedSeats).toBe(0)
      expect(row.exclusiveBookingId).toBeNull()
    }
  })

  it('hold expiry reverts EXCLUSIVE sessions; a slow payer can still reclaim them', async () => {
    const { sessions } = await contiguousDay()
    const [s0, s1] = sessions
    const now = new Date('2026-08-01T12:00:00Z')
    const booking = await claimBuyout(db, claimInput([s0!, s1!], 10, now))

    expect(await expireHolds(db, { now: new Date('2026-08-01T12:11:00Z') })).toBe(1)
    for (const s of [s0!, s1!]) {
      const row = await db.session.findUniqueOrThrow({ where: { id: s.id } })
      expect(row.status).toBe(SessionStatus.OPEN)
      expect(row.bookedSeats).toBe(0)
    }

    // Slow payer: sessions still free, so confirm re-claims the whole window.
    const order = await seedOrder(db, location)
    const confirmed = await confirmHold(db, { bookingId: booking.id, orderId: order.id })
    expect(confirmed.status).toBe(BookingStatus.CONFIRMED)
    for (const s of [s0!, s1!]) {
      const row = await db.session.findUniqueOrThrow({ where: { id: s.id } })
      expect(row.status).toBe(SessionStatus.EXCLUSIVE)
      expect(row.exclusiveBookingId).toBe(booking.id)
    }
  })

  it('an expired buyout cannot be confirmed once a drop-in took a seat in the window', async () => {
    const { sessions } = await contiguousDay()
    const [s0, s1] = sessions
    const now = new Date('2026-08-02T12:00:00Z')
    const booking = await claimBuyout(db, claimInput([s0!, s1!], 10, now))
    await expireHolds(db, { now: new Date('2026-08-02T12:11:00Z') })

    expect(await tryReserveSeats(db, { sessionId: s1!.id, seats: 1 })).toBe(true)

    const order = await seedOrder(db, location)
    await expect(confirmHold(db, { bookingId: booking.id, orderId: order.id })).rejects.toThrow(
      /expired/i,
    )
    const s0After = await db.session.findUniqueOrThrow({ where: { id: s0!.id } })
    expect(s0After.status).toBe(SessionStatus.OPEN)
    expect(s0After.bookedSeats).toBe(0)
  })
})
