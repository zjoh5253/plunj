import { TRPCError } from '@trpc/server'
import { afterAll, describe, expect, test } from 'vitest'
import { formatPhoneUS, normalizePhoneUS } from '../src/index.js'
import {
  callerFor,
  createClient,
  daysFromNow,
  newEnv,
  seedLocation,
  seedSession,
  uniquePhone,
} from './helpers.js'

const db = createClient()
afterAll(async () => db.$disconnect())

describe('normalizePhoneUS', () => {
  test('10 plain digits → E.164', () => {
    expect(normalizePhoneUS('8018422358')).toBe('+18018422358')
  })

  test('formatted entries normalize to the same E.164', () => {
    expect(normalizePhoneUS('(801) 842-2358')).toBe('+18018422358')
    expect(normalizePhoneUS('801-842-2358')).toBe('+18018422358')
    expect(normalizePhoneUS('801.842.2358')).toBe('+18018422358')
    expect(normalizePhoneUS(' 801 842 2358 ')).toBe('+18018422358')
  })

  test('11 digits with leading 1 → E.164', () => {
    expect(normalizePhoneUS('18018422358')).toBe('+18018422358')
    expect(normalizePhoneUS('1 (801) 842-2358')).toBe('+18018422358')
  })

  test('already-canonical E.164 is unchanged', () => {
    expect(normalizePhoneUS('+18018422358')).toBe('+18018422358')
  })

  test('rejects everything else', () => {
    expect(normalizePhoneUS('')).toBeNull()
    expect(normalizePhoneUS('801842235')).toBeNull() // 9 digits
    expect(normalizePhoneUS('80184223580')).toBeNull() // 11 digits, no leading 1
    expect(normalizePhoneUS('218018422358')).toBeNull() // 12 digits
    expect(normalizePhoneUS('+448018422358')).toBeNull() // non-US country code
    expect(normalizePhoneUS('not a phone')).toBeNull()
  })
})

describe('formatPhoneUS', () => {
  test('E.164 → display format', () => {
    expect(formatPhoneUS('+18018422358')).toBe('(801) 842-2358')
  })

  test('non-canonical input is returned unchanged', () => {
    expect(formatPhoneUS('8018422358')).toBe('8018422358')
    expect(formatPhoneUS('+448018422358')).toBe('+448018422358')
    expect(formatPhoneUS('')).toBe('')
  })
})

describe('phone identity at checkout', () => {
  test('"8018422358" and "+18018422358" checkout to the SAME customer row', async () => {
    const env = newEnv(db)
    const { location, studio } = await seedLocation(db)
    const session = await seedSession(db, studio, { startsAt: daysFromNow(3), capacity: 8 })
    const caller = await callerFor(env)

    const e164 = uniquePhone() // "+1XXXXXXXXXX"
    const raw = e164.slice(2) // "XXXXXXXXXX"
    const formatted = `(${raw.slice(0, 3)}) ${raw.slice(3, 6)}-${raw.slice(6)}`

    const first = await caller.public.checkout.start({
      locationSlug: location.slug,
      items: [{ kind: 'DROP_IN', sessionId: session.id, seats: 1 }],
      customer: { firstName: 'Raw', phone: raw },
    })
    const second = await caller.public.checkout.start({
      locationSlug: location.slug,
      items: [{ kind: 'DROP_IN', sessionId: session.id, seats: 1 }],
      customer: { firstName: 'Canonical', phone: e164 },
    })
    const third = await caller.public.checkout.start({
      locationSlug: location.slug,
      items: [{ kind: 'DROP_IN', sessionId: session.id, seats: 1 }],
      customer: { firstName: 'Formatted', phone: formatted },
    })

    const orders = await db.order.findMany({
      where: { id: { in: [first.orderId, second.orderId, third.orderId] } },
    })
    const customerIds = new Set(orders.map((o) => o.customerId))
    expect(customerIds.size).toBe(1)

    // Exactly one Customer row exists for this phone, stored canonically.
    const rows = await db.customer.findMany({ where: { phone: e164 } })
    expect(rows).toHaveLength(1)
    const strays = await db.customer.findMany({ where: { phone: raw } })
    expect(strays).toHaveLength(0)
  })

  test('an invalid phone is rejected with BAD_REQUEST', async () => {
    const env = newEnv(db)
    const { location, studio } = await seedLocation(db)
    const session = await seedSession(db, studio, { startsAt: daysFromNow(3) })
    const caller = await callerFor(env)

    const attempt = caller.public.checkout.start({
      locationSlug: location.slug,
      items: [{ kind: 'DROP_IN', sessionId: session.id, seats: 1 }],
      customer: { firstName: 'Bad', phone: '801-842' },
    })
    await expect(attempt).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(TRPCError)
      expect((err as TRPCError).code).toBe('BAD_REQUEST')
      expect((err as TRPCError).message).toBe('Please enter a valid US mobile number')
      return true
    })
  })
})
