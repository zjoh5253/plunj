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

describe('corporate.overview', () => {
  test('corporate admin sees network rows; location owner is forbidden', async () => {
    const { location } = await seedLocation(db)
    const corp = await seedStaff(db, { role: 'CORPORATE_ADMIN', locationId: null })
    const owner = await seedStaff(db, { role: 'LOCATION_OWNER', locationId: location.id })

    const corpCaller = await callerFor(newEnv(db), { authUserId: corp.authUserId })
    const overview = await corpCaller.corporate.overview()
    expect(overview.locations.some((row) => row.locationId === location.id)).toBe(true)
    expect(overview.totals.revenue24hCents).toBeTypeOf('number')

    const ownerCaller = await callerFor(newEnv(db), { authUserId: owner.authUserId })
    await expect(ownerCaller.corporate.overview()).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })
})
