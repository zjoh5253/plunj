/**
 * Shared E2E helpers: tRPC-over-HTTP calls, fake-webhook driving, and the
 * date/time formatting needed to find UI elements rendered in the LOCATION's
 * timezone (America/Denver for the seeded Provo studio).
 *
 * NO money math lives here — every dollar string asserted in the specs is a
 * hand-computed literal pinned against the server-rendered output.
 */
import type { APIRequestContext, APIResponse, Locator, Page } from '@playwright/test'
import { expect } from '@playwright/test'
import { psql } from './setup/pg'

export function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export const BOOK = '/book'
export const TZ = 'America/Denver'
export const CRON_SECRET = 'e2e-secret'
export const PROVO_SLUG = 'provo'

// ---------------------------------------------------------------------------
// Location-local dates/times (mirrors src/lib/format.ts rendering)
// ---------------------------------------------------------------------------

/** "YYYY-MM-DD" of today + offsetDays in the location's timezone. */
export function dateKey(offsetDays: number): string {
  const instant = new Date(Date.now() + offsetDays * 86_400_000)
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant)
}

/** ISO instant → "6:00 AM" in the location's timezone (matches formatTimeOfDay). */
export function timeOfDay(iso: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).formatToParts(new Date(iso))
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? ''
  return `${get('hour')}:${get('minute')} ${get('dayPeriod')}`
}

// ---------------------------------------------------------------------------
// UI locators shared across specs
// ---------------------------------------------------------------------------

/**
 * The value span next to a breakdown row label — the checkout Breakdown
 * renders each row as sibling <span>label</span><span>value</span>.
 */
export function moneyRowValue(page: Page, label: string | RegExp): Locator {
  const pattern = typeof label === 'string' ? new RegExp(`^${escapeRegex(label)}$`) : label
  return page
    .locator('span')
    .filter({ hasText: pattern })
    .locator('xpath=following-sibling::span[1]')
}

/** Date-strip tab for today+offset, matched on "<Weekday><day>" (e.g. "Wed5"). */
export function dateTab(page: Page, offsetDays: number): Locator {
  const key = dateKey(offsetDays)
  // Noon UTC + UTC rendering keeps the calendar date stable (mirrors dateKeyParts).
  const probe = new Date(`${key}T12:00:00Z`)
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short' }).format(
    probe,
  )
  const day = String(Number(key.slice(8, 10)))
  return page
    .getByRole('tablist', { name: 'Choose a date' })
    .getByRole('tab')
    .filter({ hasText: new RegExp(`^${weekday}\\s*${day}$`) })
}

// ---------------------------------------------------------------------------
// tRPC over HTTP (plain JSON — the API uses no transformer)
// ---------------------------------------------------------------------------

export async function trpcQuery<T>(
  request: APIRequestContext,
  procedure: string,
  input: unknown,
): Promise<T> {
  const res = await request.get(
    `${BOOK}/api/trpc/${procedure}?input=${encodeURIComponent(JSON.stringify(input))}`,
  )
  expect(res.status(), `${procedure} should succeed`).toBe(200)
  const body = (await res.json()) as { result: { data: T } }
  return body.result.data
}

/** POST a tRPC mutation; returns the raw response so error shapes can be asserted. */
export async function trpcMutateRaw(
  request: APIRequestContext,
  procedure: string,
  input: unknown,
): Promise<APIResponse> {
  return request.post(`${BOOK}/api/trpc/${procedure}`, { data: input })
}

export async function trpcMutate<T>(
  request: APIRequestContext,
  procedure: string,
  input: unknown,
): Promise<T> {
  const res = await trpcMutateRaw(request, procedure, input)
  expect(res.status(), `${procedure} should succeed`).toBe(200)
  const body = (await res.json()) as { result: { data: T } }
  return body.result.data
}

// ---------------------------------------------------------------------------
// Availability + checkout + fake-webhook payment completion
// ---------------------------------------------------------------------------

export interface AvailabilitySlot {
  sessionId: string
  startsAt: string
  endsAt: string
  capacity: number
  priceCents: number
  remainingSeats: number
}

export async function availabilityOn(
  request: APIRequestContext,
  date: string,
): Promise<AvailabilitySlot[]> {
  const days = await trpcQuery<Array<{ date: string; sessions: AvailabilitySlot[] }>>(
    request,
    'public.availability.list',
    { locationSlug: PROVO_SLUG, fromDate: date, toDate: date },
  )
  return days.find((d) => d.date === date)?.sessions ?? []
}

export interface CheckoutStartData {
  bookingId: string
  bookingIds: string[]
  manageToken: string
  orderId: string
  clientSecret: string | null
  holdExpiresAt: string | null
}

export async function startCheckout(
  request: APIRequestContext,
  args: { sessionId: string; seats: number; firstName: string; lastName?: string; phone: string },
): Promise<CheckoutStartData> {
  return trpcMutate<CheckoutStartData>(request, 'public.checkout.start', {
    locationSlug: PROVO_SLUG,
    items: [{ kind: 'DROP_IN', sessionId: args.sessionId, seats: args.seats }],
    customer: {
      firstName: args.firstName,
      ...(args.lastName !== undefined ? { lastName: args.lastName } : {}),
      phone: args.phone,
    },
  })
}

let eventCounter = 0

/**
 * Deliver a fake payment webhook. The FakePaymentProvider's
 * verifyAndParseWebhook accepts the constant 'fake_signature' and parses the
 * body as an already-normalized event, so the test can fabricate one for the
 * intent ref derived from the checkout's clientSecret ("<ref>_secret").
 */
export async function deliverPaymentWebhook(
  request: APIRequestContext,
  clientSecret: string,
  type: 'payment.succeeded' | 'payment.failed' = 'payment.succeeded',
): Promise<void> {
  const providerPaymentRef = clientSecret.replace(/_secret$/, '')
  const res = await request.post(`${BOOK}/api/webhooks/stripe`, {
    headers: { 'stripe-signature': 'fake_signature' },
    data: {
      providerEventId: `e2e-evt-${Date.now()}-${++eventCounter}`,
      type,
      rawType: type === 'payment.succeeded' ? 'payment_intent.succeeded' : 'payment_intent.payment_failed',
      payload: {},
      providerPaymentRef,
    },
  })
  expect(res.status(), 'webhook should be accepted').toBe(200)
  expect(await res.json()).toEqual({ status: 'processed' })
}

/** checkout.start + succeeded webhook → CONFIRMED booking. */
export async function createConfirmedBooking(
  request: APIRequestContext,
  args: { sessionId: string; seats: number; firstName: string; lastName?: string; phone: string },
): Promise<CheckoutStartData> {
  const start = await startCheckout(request, args)
  expect(start.clientSecret).not.toBeNull()
  await deliverPaymentWebhook(request, start.clientSecret as string)
  return start
}

// ---------------------------------------------------------------------------
// Staff sign-in (better-auth phone OTP, code read from auth_verifications)
// ---------------------------------------------------------------------------

/** The OTP the server "texted" via FakeSmsSender, read from the DB row better-auth stores. */
export function latestOtpFor(phone: string): string {
  const value = psql(
    `SELECT value FROM auth_verifications WHERE identifier = '${phone}' ORDER BY created_at DESC LIMIT 1`,
  )
  const code = value.split(':')[0]
  expect(code, `an OTP row should exist for ${phone}`).toMatch(/^\d{6}$/)
  return code as string
}

/**
 * Sign in through the staff UI with phone OTP, then attach the resulting auth
 * user to the seeded StaffUser row (the seed creates staff with no authUserId,
 * and no app code links one on sign-in — see report).
 */
export async function signInAsStaff(
  page: Page,
  args: { phone: string; staffEmail: string },
): Promise<void> {
  await page.goto(`${BOOK}/staff/sign-in`)
  await expect(page.getByRole('heading', { name: 'Staff sign-in' })).toBeVisible()
  await page.getByLabel('Mobile number').fill(args.phone)
  await page.getByRole('button', { name: 'Text me a code' }).click()

  await expect(page.getByRole('heading', { name: 'Enter the code' })).toBeVisible()
  const code = latestOtpFor(args.phone)
  // Filling all 6 digits auto-submits the verification.
  await page.getByLabel('Code').fill(code)
  // Verification signed us in (cookie set) and redirected off the sign-in form.
  await expect(page.getByRole('heading', { name: 'Enter the code' })).toBeHidden()

  // Link the fresh auth user to the seeded staff row so staffProcedure passes.
  const updated = psql(
    `UPDATE staff_users
     SET auth_user_id = (SELECT id FROM auth_users WHERE phone_number = '${args.phone}')
     WHERE email = '${args.staffEmail}'
     RETURNING id`,
  )
  expect(updated, 'staff row should be linked to the auth user').not.toBe('')
}
