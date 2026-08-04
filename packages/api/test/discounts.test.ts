import { StaffRoleKind, id } from '@plunj/db'
import { TRPCError } from '@trpc/server'
import { afterAll, describe, expect, test } from 'vitest'
import { DiscountRejectedError } from '../src/index.js'
import {
  callerFor,
  createClient,
  daysFromNow,
  newEnv,
  seedCustomer,
  seedDiscount,
  seedLocation,
  seedOrder,
  seedSession,
  seedStaff,
  uniquePhone,
} from './helpers.js'

const db = createClient()
afterAll(async () => db.$disconnect())

async function setup() {
  const env = newEnv(db)
  const { location, studio } = await seedLocation(db)
  const session = await seedSession(db, studio, { startsAt: daysFromNow(3), priceCents: 4500 })
  const caller = await callerFor(env)
  const items = [{ kind: 'DROP_IN' as const, sessionId: session.id, seats: 1 }]
  return { env, location, studio, session, caller, items }
}

describe('discount rejections surface structured reasons', () => {
  test('UNKNOWN_CODE', async () => {
    const { caller, location, items } = await setup()
    const result = await caller.public.checkout.quote({
      locationSlug: location.slug,
      items,
      discountCode: 'NOPE',
    })
    expect(result).toMatchObject({ ok: false, reason: 'UNKNOWN_CODE' })
  })

  test('INACTIVE', async () => {
    const { caller, location, items } = await setup()
    await seedDiscount(db, { locationId: location.id, code: 'OLD', active: false })
    const result = await caller.public.checkout.quote({
      locationSlug: location.slug,
      items,
      discountCode: 'old',
    })
    expect(result).toMatchObject({ ok: false, reason: 'INACTIVE' })
  })

  test('NOT_YET_ACTIVE', async () => {
    const { caller, location, items } = await setup()
    await seedDiscount(db, {
      locationId: location.id,
      code: 'SOON',
      startsAt: daysFromNow(5),
    })
    const result = await caller.public.checkout.quote({
      locationSlug: location.slug,
      items,
      discountCode: 'SOON',
    })
    expect(result).toMatchObject({ ok: false, reason: 'NOT_YET_ACTIVE' })
  })

  test('EXPIRED', async () => {
    const { caller, location, items } = await setup()
    await seedDiscount(db, {
      locationId: location.id,
      code: 'GONE',
      endsAt: daysFromNow(-1),
    })
    const result = await caller.public.checkout.quote({
      locationSlug: location.slug,
      items,
      discountCode: 'GONE',
    })
    expect(result).toMatchObject({ ok: false, reason: 'EXPIRED' })
  })

  test('EXHAUSTED', async () => {
    const { caller, location, items } = await setup()
    const code = await seedDiscount(db, {
      locationId: location.id,
      code: 'MAXED',
      maxRedemptions: 1,
    })
    const order = await seedOrder(db, location)
    await db.discountRedemption.create({
      data: {
        id: id(),
        discountCodeId: code.id,
        orderId: order.id,
        locationId: location.id,
        amountCents: 500,
      },
    })
    const result = await caller.public.checkout.quote({
      locationSlug: location.slug,
      items,
      discountCode: 'MAXED',
    })
    expect(result).toMatchObject({ ok: false, reason: 'EXHAUSTED' })
  })

  test('PER_CUSTOMER_LIMIT (enforced at checkout.start with the resolved customer)', async () => {
    const { caller, location, items } = await setup()
    const phone = uniquePhone()
    const customer = await seedCustomer(db, { phone })
    const code = await seedDiscount(db, {
      locationId: location.id,
      code: 'ONCEEACH',
      maxPerCustomer: 1,
    })
    const order = await seedOrder(db, location)
    await db.discountRedemption.create({
      data: {
        id: id(),
        discountCodeId: code.id,
        orderId: order.id,
        customerId: customer.id,
        locationId: location.id,
        amountCents: 500,
      },
    })

    // Anonymous quote still allows the code (no customer to count against)…
    const anonymous = await caller.public.checkout.quote({
      locationSlug: location.slug,
      items,
      discountCode: 'ONCEEACH',
    })
    expect(anonymous.ok).toBe(true)

    // …but checkout.start resolves the customer by phone and rejects.
    const attempt = caller.public.checkout.start({
      locationSlug: location.slug,
      items,
      discountCode: 'ONCEEACH',
      customer: { firstName: 'Repeat', phone },
    })
    await expect(attempt).rejects.toSatisfy((err: unknown) => {
      const trpcErr = err as TRPCError
      expect(trpcErr).toBeInstanceOf(TRPCError)
      expect(trpcErr.code).toBe('BAD_REQUEST')
      expect(trpcErr.cause).toBeInstanceOf(DiscountRejectedError)
      expect((trpcErr.cause as DiscountRejectedError).reason).toBe('PER_CUSTOMER_LIMIT')
      return true
    })
  })

  test('MIN_SUBTOTAL', async () => {
    const { caller, location, items } = await setup()
    await seedDiscount(db, {
      locationId: location.id,
      code: 'BIGSPEND',
      minSubtotalCents: 10_000,
    })
    const result = await caller.public.checkout.quote({
      locationSlug: location.slug,
      items,
      discountCode: 'BIGSPEND',
    })
    expect(result).toMatchObject({ ok: false, reason: 'MIN_SUBTOTAL' })
    if (!result.ok) expect(result.message).toContain('$100.00')
  })

  test('SCOPE_MISMATCH with a scope-specific message', async () => {
    const { caller, location, items } = await setup()
    await seedDiscount(db, {
      locationId: location.id,
      code: 'BUYOUTONLY',
      appliesTo: 'BUYOUT',
    })
    const result = await caller.public.checkout.quote({
      locationSlug: location.slug,
      items,
      discountCode: 'BUYOUTONLY',
    })
    expect(result).toMatchObject({
      ok: false,
      reason: 'SCOPE_MISMATCH',
      message: 'This code is for private buyouts only.',
    })
  })

  test('brand-wide code (locationId null) applies case-insensitively', async () => {
    const { caller, location, items } = await setup()
    await seedDiscount(db, {
      locationId: null,
      code: `Brand${id().slice(0, 6)}`,
      valueBps: 1000,
    })
    const brandCode = await db.discountCode.findFirst({
      where: { locationId: null },
      orderBy: { createdAt: 'desc' },
    })
    const result = await caller.public.checkout.quote({
      locationSlug: location.slug,
      items,
      discountCode: brandCode!.code.toUpperCase(),
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.quote.discountCents).toBeGreaterThan(0)
  })
})

describe('discounts.preview === checkout.quote (invariant #1)', () => {
  test('stored-code preview is byte-identical to the public quote', async () => {
    const { env, location, items } = await setup()
    await seedDiscount(db, { locationId: location.id, code: 'MATCH20', valueBps: 2000 })
    const { authUserId } = await seedStaff(db, {
      role: StaffRoleKind.LOCATION_ADMIN,
      locationId: location.id,
    })

    const staffCaller = await callerFor(env, { authUserId })
    const publicCaller = await callerFor(env)

    const preview = await staffCaller.admin.discounts.preview({
      locationSlug: location.slug,
      sampleItems: items,
      tipCents: 300,
      code: 'MATCH20',
    })
    const quote = await publicCaller.public.checkout.quote({
      locationSlug: location.slug,
      items,
      tipCents: 300,
      discountCode: 'MATCH20',
    })

    expect(JSON.stringify(preview)).toBe(JSON.stringify(quote))
  })

  test('draft preview runs the same rejection path', async () => {
    const { env, location, items } = await setup()
    const { authUserId } = await seedStaff(db, {
      role: StaffRoleKind.LOCATION_ADMIN,
      locationId: location.id,
    })
    const staffCaller = await callerFor(env, { authUserId })
    const preview = await staffCaller.admin.discounts.preview({
      locationSlug: location.slug,
      sampleItems: items,
      draft: {
        code: 'DRAFTY',
        type: 'FIXED_CENTS',
        valueCents: 500,
        appliesTo: 'BUYOUT',
      },
    })
    expect(preview).toMatchObject({ ok: false, reason: 'SCOPE_MISMATCH' })
  })
})
