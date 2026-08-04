import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { BookingType, SessionStatus } from '@plunj/db'
import type { Customer, Location, PrismaClient, Studio } from '@plunj/db'
import { claimBuyout, createHold, listAvailability } from '../src/index.js'
import { createClient, seedCustomer, seedLocation, seedSession } from './helpers.js'

describe('listAvailability', () => {
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

  it('groups by location-local date, subtracts seats, excludes non-OPEN, ignores expired holds', async () => {
    const now = new Date('2026-10-01T12:00:00Z')

    // Plain open session: Oct 5, 10:00 MDT = 16:00Z. 2 seats already booked.
    const open = await seedSession(db, studio, {
      startsAt: new Date('2026-10-05T16:00:00Z'),
      capacity: 8,
      bookedSeats: 2,
    })
    // Late-evening session: Oct 5, 21:00 MDT = Oct 6 03:00Z — must group under Oct 5.
    const lateNight = await seedSession(db, studio, {
      startsAt: new Date('2026-10-06T03:00:00Z'),
      capacity: 8,
    })
    // Non-OPEN sessions: all excluded from public listing.
    await seedSession(db, studio, {
      startsAt: new Date('2026-10-05T17:00:00Z'),
      status: SessionStatus.CLOSED,
    })
    await seedSession(db, studio, {
      startsAt: new Date('2026-10-05T18:00:00Z'),
      status: SessionStatus.CANCELLED,
    })
    const forBuyout = await seedSession(db, studio, {
      startsAt: new Date('2026-10-06T16:00:00Z'),
      capacity: 8,
    })
    await claimBuyout(db, {
      sessionIds: [forBuyout.id],
      locationId: location.id,
      studioId: studio.id,
      customerId: customer.id,
      holdMinutes: 10,
      priceCents: 30_000,
      now,
    })
    // Outside the range: Oct 8.
    await seedSession(db, studio, { startsAt: new Date('2026-10-08T16:00:00Z') })

    const days = await listAvailability(db, {
      locationId: location.id,
      fromDate: '2026-10-05',
      toDate: '2026-10-07',
      now,
    })

    expect(days).toHaveLength(1)
    expect(days[0]!.date).toBe('2026-10-05')
    expect(days[0]!.sessions.map((s) => s.sessionId)).toEqual([open.id, lateNight.id])
    expect(days[0]!.sessions[0]!.remainingSeats).toBe(6) // 8 - 2 booked
    expect(days[0]!.sessions[1]!.remainingSeats).toBe(8)
  })

  it('adds back the seats of expired-but-unswept holds (stuck cron never fakes a sellout)', async () => {
    const now = new Date('2026-10-10T12:00:00Z')
    const session = await seedSession(db, studio, {
      startsAt: new Date('2026-10-12T16:00:00Z'),
      capacity: 8,
    })

    const base = {
      sessionId: session.id,
      locationId: location.id,
      studioId: studio.id,
      customerId: customer.id,
      startsAt: session.startsAt,
      endsAt: session.endsAt,
      type: BookingType.DROP_IN,
    }
    // An active hold (2 seats) — really unavailable.
    await createHold(db, { ...base, seats: 2, holdMinutes: 10, now })
    // An expired hold (3 seats) the cron has NOT swept — seats still sit in
    // booked_seats, but the listing must treat them as available.
    await createHold(db, { ...base, seats: 3, holdMinutes: -5, now })

    const row = await db.session.findUniqueOrThrow({ where: { id: session.id } })
    expect(row.bookedSeats).toBe(5)

    const days = await listAvailability(db, {
      locationId: location.id,
      fromDate: '2026-10-12',
      toDate: '2026-10-12',
      now,
    })
    expect(days[0]!.sessions).toHaveLength(1)
    // 8 capacity - 5 booked + 3 stale-hold seats lazily returned = 6.
    expect(days[0]!.sessions[0]!.remainingSeats).toBe(6)
  })
})
