import { StaffRoleKind, WaiverKind } from '@plunj/db'
import { TRPCError } from '@trpc/server'
import { afterAll, describe, expect, test } from 'vitest'
import { callerFor, createClient, newEnv, seedLocation, seedStaff } from './helpers.js'

const db = createClient()
afterAll(async () => db.$disconnect())

function expectCode(code: 'FORBIDDEN' | 'UNAUTHORIZED') {
  return (err: unknown): boolean => {
    expect(err).toBeInstanceOf(TRPCError)
    expect((err as TRPCError).code).toBe(code)
    return true
  }
}

describe('role gates', () => {
  test('unauthenticated caller → UNAUTHORIZED on staff procedures', async () => {
    const env = newEnv(db)
    const { location } = await seedLocation(db)
    const caller = await callerFor(env)
    await expect(caller.desk.roster.today({ locationSlug: location.slug })).rejects.toSatisfy(
      expectCode('UNAUTHORIZED'),
    )
  })

  test('FRONT_DESK cannot touch the admin router', async () => {
    const env = newEnv(db)
    const { location } = await seedLocation(db)
    const { authUserId } = await seedStaff(db, {
      role: StaffRoleKind.FRONT_DESK,
      locationId: location.id,
    })
    const caller = await callerFor(env, { authUserId })

    // Desk works…
    const roster = await caller.desk.roster.today({ locationSlug: location.slug })
    expect(roster.sessions).toEqual([])

    // …admin does not.
    await expect(caller.admin.discounts.list({ locationSlug: location.slug })).rejects.toSatisfy(
      expectCode('FORBIDDEN'),
    )
    await expect(
      caller.admin.waivers.publish({
        locationId: location.id,
        kind: WaiverKind.LIABILITY,
        title: 'nope',
        bodyMarkdown: 'nope',
      }),
    ).rejects.toSatisfy(expectCode('FORBIDDEN'))
  })

  test('location scoping: staff at location A is FORBIDDEN at location B', async () => {
    const env = newEnv(db)
    const { location: locationA } = await seedLocation(db)
    const { location: locationB } = await seedLocation(db)
    const { authUserId } = await seedStaff(db, {
      role: StaffRoleKind.LOCATION_OWNER,
      locationId: locationA.id,
    })
    const caller = await callerFor(env, { authUserId })

    await expect(caller.desk.roster.today({ locationSlug: locationA.slug })).resolves.toBeDefined()
    await expect(caller.desk.roster.today({ locationSlug: locationB.slug })).rejects.toSatisfy(
      expectCode('FORBIDDEN'),
    )
    await expect(caller.admin.discounts.list({ locationSlug: locationB.slug })).rejects.toSatisfy(
      expectCode('FORBIDDEN'),
    )
  })

  test('LOCATION_ADMIN cannot run owner-only team mutations', async () => {
    const env = newEnv(db)
    const { location } = await seedLocation(db)
    const { authUserId } = await seedStaff(db, {
      role: StaffRoleKind.LOCATION_ADMIN,
      locationId: location.id,
    })
    const caller = await callerFor(env, { authUserId })
    await expect(
      caller.admin.team.invite({
        locationSlug: location.slug,
        name: 'Newbie',
        email: 'newbie@plunj.co',
        role: 'FRONT_DESK',
      }),
    ).rejects.toSatisfy(expectCode('FORBIDDEN'))
  })

  test('CORPORATE_ADMIN passes everywhere', async () => {
    const env = newEnv(db)
    const { location: locationA } = await seedLocation(db)
    const { location: locationB } = await seedLocation(db)
    const { authUserId } = await seedStaff(db, {
      role: StaffRoleKind.CORPORATE_ADMIN,
      locationId: null,
    })
    const caller = await callerFor(env, { authUserId })

    await expect(caller.desk.roster.today({ locationSlug: locationA.slug })).resolves.toBeDefined()
    await expect(caller.desk.roster.today({ locationSlug: locationB.slug })).resolves.toBeDefined()
    await expect(
      caller.admin.discounts.list({ locationSlug: locationA.slug }),
    ).resolves.toBeDefined()
    await expect(
      caller.admin.team.invite({
        locationSlug: locationB.slug,
        name: 'Corp Hire',
        email: `corp-${Date.now()}@plunj.co`,
        role: 'FRONT_DESK',
      }),
    ).resolves.toBeDefined()
  })
})

describe('admin.waivers.publish', () => {
  test('publishes the next version with sha + audit; dryRun counts re-signs', async () => {
    const env = newEnv(db)
    const { location } = await seedLocation(db)
    const { authUserId } = await seedStaff(db, {
      role: StaffRoleKind.LOCATION_ADMIN,
      locationId: location.id,
    })
    const caller = await callerFor(env, { authUserId })

    const v1 = await caller.admin.waivers.publish({
      locationId: location.id,
      kind: WaiverKind.LIABILITY,
      title: 'Liability v1',
      bodyMarkdown: '# v1 body',
    })
    expect(v1.nextVersion).toBe(1)
    expect(v1.waiverDocumentId).toBeTruthy()

    const dry = await caller.admin.waivers.publish({
      locationId: location.id,
      kind: WaiverKind.LIABILITY,
      title: 'Liability v2',
      bodyMarkdown: '# v2 body',
      dryRun: true,
    })
    expect(dry.dryRun).toBe(true)
    expect(dry.nextVersion).toBe(2)
    expect(dry.waiverDocumentId).toBeNull()
    // dryRun published nothing.
    expect(await db.waiverDocument.count({ where: { locationId: location.id } })).toBe(1)

    const v2 = await caller.admin.waivers.publish({
      locationId: location.id,
      kind: WaiverKind.LIABILITY,
      title: 'Liability v2',
      bodyMarkdown: '# v2 body',
    })
    expect(v2.nextVersion).toBe(2)

    const docs = await db.waiverDocument.findMany({
      where: { locationId: location.id },
      orderBy: { version: 'asc' },
    })
    expect(docs).toHaveLength(2)
    expect(docs[0]!.active).toBe(false)
    expect(docs[1]!.active).toBe(true)
    expect(docs[1]!.contentSha256).toMatch(/^[0-9a-f]{64}$/)

    const auditRows = await db.auditLog.findMany({
      where: { action: 'admin.waiver_publish', entityId: v2.waiverDocumentId ?? '' },
    })
    expect(auditRows).toHaveLength(1)
  })
})
