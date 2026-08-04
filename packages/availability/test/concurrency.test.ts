import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { BookingType, SessionStatus } from '@plunj/db'
import type { Customer, Location, PrismaClient, Studio } from '@plunj/db'
import { claimBuyout, createHold, BuyoutUnavailableError, SoldOutError } from '../src/index.js'
import { createClient, seedCustomer, seedLocation, seedSession } from './helpers.js'

/**
 * Real-database concurrency tests (invariant #3). Each contender uses its OWN
 * PrismaClient connection so the conditional UPDATEs genuinely race in
 * Postgres rather than queueing on one connection.
 */
describe('concurrent capacity operations', () => {
  let db: PrismaClient
  let location: Location
  let studio: Studio
  let customer: Customer

  beforeAll(async () => {
    db = createClient()
    ;({ location, studio } = await seedLocation(db, { defaultCapacity: 10 }))
    customer = await seedCustomer(db)
  })

  afterAll(async () => {
    await db.$disconnect()
  })

  it('8 parallel createHold calls for the last 3 seats: exactly 3 succeed', async () => {
    const session = await seedSession(db, studio, {
      startsAt: new Date('2026-06-20T16:00:00Z'),
      capacity: 10,
      bookedSeats: 7,
    })

    const clients = Array.from({ length: 8 }, () => createClient())
    try {
      const results = await Promise.allSettled(
        clients.map((client) =>
          createHold(client, {
            sessionId: session.id,
            locationId: location.id,
            studioId: studio.id,
            customerId: customer.id,
            seats: 1,
            startsAt: session.startsAt,
            endsAt: session.endsAt,
            type: BookingType.DROP_IN,
          }),
        ),
      )

      const fulfilled = results.filter((r) => r.status === 'fulfilled')
      const rejected = results.filter((r) => r.status === 'rejected')
      expect(fulfilled).toHaveLength(3)
      expect(rejected).toHaveLength(5)
      for (const r of rejected) {
        expect(r.reason).toBeInstanceOf(SoldOutError)
      }

      const after = await db.session.findUniqueOrThrow({ where: { id: session.id } })
      expect(after.bookedSeats).toBe(10)
      const holds = await db.booking.count({ where: { sessionId: session.id } })
      expect(holds).toBe(3)
    } finally {
      await Promise.all(clients.map((client) => client.$disconnect()))
    }
  })

  it('parallel buyout-vs-drop-in race: exactly one wins', async () => {
    const session = await seedSession(db, studio, {
      startsAt: new Date('2026-06-21T16:00:00Z'),
      capacity: 10,
    })

    const buyoutClient = createClient()
    const dropInClient = createClient()
    try {
      const [buyoutResult, dropInResult] = await Promise.allSettled([
        claimBuyout(buyoutClient, {
          sessionIds: [session.id],
          locationId: location.id,
          studioId: studio.id,
          customerId: customer.id,
          holdMinutes: 10,
          priceCents: 30_000,
        }),
        createHold(dropInClient, {
          sessionId: session.id,
          locationId: location.id,
          studioId: studio.id,
          customerId: customer.id,
          seats: 1,
          startsAt: session.startsAt,
          endsAt: session.endsAt,
          type: BookingType.DROP_IN,
        }),
      ])

      const winners = [buyoutResult, dropInResult].filter((r) => r.status === 'fulfilled')
      expect(winners).toHaveLength(1)

      const after = await db.session.findUniqueOrThrow({ where: { id: session.id } })
      if (buyoutResult.status === 'fulfilled') {
        expect(dropInResult.status).toBe('rejected')
        expect((dropInResult as PromiseRejectedResult).reason).toBeInstanceOf(SoldOutError)
        expect(after.status).toBe(SessionStatus.EXCLUSIVE)
        expect(after.bookedSeats).toBe(after.capacity)
        expect(after.exclusiveBookingId).toBe(buyoutResult.value.id)
      } else {
        expect(buyoutResult.reason).toBeInstanceOf(BuyoutUnavailableError)
        expect(after.status).toBe(SessionStatus.OPEN)
        expect(after.bookedSeats).toBe(1)
      }
    } finally {
      await buyoutClient.$disconnect()
      await dropInClient.$disconnect()
    }
  })

  it('CHECK constraint rejects overbooking even when tryReserveSeats is bypassed', async () => {
    const session = await seedSession(db, studio, {
      startsAt: new Date('2026-06-22T16:00:00Z'),
      capacity: 4,
      bookedSeats: 4,
    })

    await expect(
      db.$executeRaw`
        UPDATE "sessions" SET "booked_seats" = "booked_seats" + 1 WHERE "id" = ${session.id}
      `,
    ).rejects.toThrow(/booked_seats_within_capacity|check constraint/i)

    const after = await db.session.findUniqueOrThrow({ where: { id: session.id } })
    expect(after.bookedSeats).toBe(4)
  })
})
