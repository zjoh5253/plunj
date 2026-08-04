import { describe, expect, test, beforeAll, afterAll } from 'vitest'
import type { PrismaClient } from '@plunj/db'
import { callerFor, createClient, newEnv, seedLocation, seedStaff } from './helpers.js'

let db: PrismaClient

beforeAll(() => {
  db = createClient()
})

afterAll(async () => {
  await db.$disconnect()
})

describe('admin.buyouts', () => {
  test('owner creates, edits, and retires a tier; public list reflects it', async () => {
    const { location } = await seedLocation(db)
    const { authUserId } = await seedStaff(db, {
      role: 'LOCATION_OWNER',
      locationId: location.id,
    })
    const caller = await callerFor(newEnv(db), { authUserId })

    const created = await caller.admin.buyouts.create({
      locationSlug: location.slug,
      durationHours: 2,
      priceCents: 38500,
      maxGuests: 12,
    })

    let tiers = await caller.admin.buyouts.list({ locationSlug: location.slug })
    const tier = tiers.find((t) => t.buyoutOptionId === created.buyoutOptionId)
    expect(tier).toMatchObject({ durationHours: 2, priceCents: 38500, maxGuests: 12, active: true })

    await caller.admin.buyouts.update({
      buyoutOptionId: created.buyoutOptionId,
      priceCents: 41000,
      active: false,
    })
    tiers = await caller.admin.buyouts.list({ locationSlug: location.slug })
    expect(tiers.find((t) => t.buyoutOptionId === created.buyoutOptionId)).toMatchObject({
      priceCents: 41000,
      active: false,
    })

    // Retired tiers disappear from the public options.
    const publicOptions = await caller.public.buyouts.options({ locationSlug: location.slug })
    expect(publicOptions.some((o) => o.id === created.buyoutOptionId)).toBe(false)

    const auditRows = await db.auditLog.findMany({
      where: { entityType: 'BuyoutOption', entityId: created.buyoutOptionId },
    })
    expect(auditRows.map((r) => r.action).sort()).toEqual([
      'admin.buyout_create',
      'admin.buyout_update',
    ])
  })

  test('front desk cannot manage buyout tiers', async () => {
    const { location } = await seedLocation(db)
    const { authUserId } = await seedStaff(db, { role: 'FRONT_DESK', locationId: location.id })
    const caller = await callerFor(newEnv(db), { authUserId })

    await expect(
      caller.admin.buyouts.create({
        locationSlug: location.slug,
        durationHours: 1,
        priceCents: 21000,
        maxGuests: 8,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })
})
