import { BillingInterval, VisitPolicy, id } from '@plunj/db'
import { afterAll, describe, expect, test } from 'vitest'
import { callerFor, createClient, newEnv, seedLocation } from './helpers.js'

const db = createClient()
afterAll(async () => db.$disconnect())

describe('public.memberships.list', () => {
  test('returns active plans and packs ordered by price with exact cents', async () => {
    const env = newEnv(db)
    const { location } = await seedLocation(db)

    // Created most-expensive first to prove ordering comes from the endpoint.
    const sisu = await db.membershipPlan.create({
      data: {
        id: id(),
        locationId: location.id,
        name: 'SISU Unlimited',
        priceCents: 13000,
        interval: BillingInterval.MONTH,
        visitPolicy: VisitPolicy.UNLIMITED,
        guestPassesPerPeriod: 0,
        giftable: true,
        active: true,
      },
    })
    const lagom = await db.membershipPlan.create({
      data: {
        id: id(),
        locationId: location.id,
        name: 'LAGOM Pass',
        priceCents: 9653,
        interval: BillingInterval.MONTH,
        visitPolicy: VisitPolicy.N_PER_PERIOD,
        visitsPerPeriod: 8,
        guestPassesPerPeriod: 0,
        giftable: true,
        active: true,
      },
    })
    await db.membershipPlan.create({
      data: {
        id: id(),
        locationId: location.id,
        name: 'Retired Plan',
        priceCents: 100,
        interval: BillingInterval.MONTH,
        visitPolicy: VisitPolicy.UNLIMITED,
        giftable: true,
        active: false,
      },
    })
    const pack = await db.pack.create({
      data: {
        id: id(),
        locationId: location.id,
        name: '10 Visit Punch Pass',
        credits: 10,
        priceCents: 26813,
        active: true,
      },
    })

    const caller = await callerFor(env)
    const result = await caller.public.memberships.list({ locationSlug: location.slug })

    // Plans ordered by priceCents ascending; the inactive plan is excluded.
    expect(result.plans).toEqual([
      {
        id: lagom.id,
        name: 'LAGOM Pass',
        priceCents: 9653,
        interval: 'MONTH',
        visitPolicy: 'N_PER_PERIOD',
        visitsPerPeriod: 8,
        guestPassesPerPeriod: 0,
      },
      {
        id: sisu.id,
        name: 'SISU Unlimited',
        priceCents: 13000,
        interval: 'MONTH',
        visitPolicy: 'UNLIMITED',
        visitsPerPeriod: null,
        guestPassesPerPeriod: 0,
      },
    ])
    expect(result.packs).toEqual([
      {
        id: pack.id,
        name: '10 Visit Punch Pass',
        credits: 10,
        priceCents: 26813,
        expiresAfterDays: null,
      },
    ])
  })

  test('excludes inactive packs and other locations', async () => {
    const env = newEnv(db)
    const { location } = await seedLocation(db)
    const { location: other } = await seedLocation(db)

    await db.pack.create({
      data: {
        id: id(),
        locationId: location.id,
        name: 'Old Pack',
        credits: 5,
        priceCents: 10000,
        active: false,
      },
    })
    await db.membershipPlan.create({
      data: {
        id: id(),
        locationId: other.id,
        name: 'Elsewhere Plan',
        priceCents: 5000,
        interval: BillingInterval.MONTH,
        visitPolicy: VisitPolicy.UNLIMITED,
        active: true,
      },
    })

    const caller = await callerFor(env)
    const result = await caller.public.memberships.list({ locationSlug: location.slug })
    expect(result).toEqual({ plans: [], packs: [] })
  })
})
