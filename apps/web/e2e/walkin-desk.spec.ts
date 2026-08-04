/**
 * Walk-in QR waiver + staff desk flows:
 *  1. Two CONFIRMED bookings for a session today (created over the API, paid
 *     via the fake webhook — same path the golden-path spec exercises).
 *  2. The walk-in QR page: guest signs name+phone+waiver → checkmark screen.
 *  3. Staff phone-OTP sign-in (better-auth; the OTP is read from the
 *     auth_verifications row the server stores — FakeSmsSender's copy lives in
 *     server memory). The seeded FRONT_DESK staff row carries no authUserId
 *     and nothing links one on sign-in, so the test attaches it in the DB.
 *  4. Desk roster shows both guests; checking in the signed guest succeeds;
 *     checking in the unsigned guest opens the waiver sheet with the QR.
 */
import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import {
  BOOK,
  availabilityOn,
  createConfirmedBooking,
  dateKey,
  signInAsStaff,
  timeOfDay,
} from './helpers'

const SIGNED = { name: 'Wally Walkin', phone: '+18015553001' }
const UNSIGNED = { name: 'Uma Unsigned', phone: '+18015553002' }
const STAFF_PHONE = '+18015553999'
const FRONT_DESK_EMAIL = 'frontdesk@provo.plunj.example'

/** Expand a roster session card if its guest list is collapsed. */
async function expandCard(card: Locator): Promise<void> {
  const header = card.getByRole('button').first()
  if ((await header.getAttribute('aria-expanded')) !== 'true') {
    await header.click()
  }
}

async function rosterCardFor(
  page: Page,
  slot: { startsAt: string; endsAt: string },
): Promise<Locator> {
  const label = `${timeOfDay(slot.startsAt)} – ${timeOfDay(slot.endsAt)}`
  const card = page.locator('ol > li').filter({ hasText: label })
  await expect(card).toBeVisible()
  return card
}

test('walk-in waiver + desk roster check-in with waiver enforcement', async ({
  page,
  request,
}) => {
  // --- Two paid bookings for TODAY (the desk roster is today-only) ----------
  const slots = await availabilityOn(request, dateKey(0))
  expect(slots.length).toBeGreaterThan(0)
  const slot = slots[slots.length - 1] as (typeof slots)[number] // last session of the day

  await createConfirmedBooking(request, {
    sessionId: slot.sessionId,
    seats: 1,
    firstName: 'Wally',
    lastName: 'Walkin',
    phone: SIGNED.phone,
  })
  await createConfirmedBooking(request, {
    sessionId: slot.sessionId,
    seats: 1,
    firstName: 'Uma',
    lastName: 'Unsigned',
    phone: UNSIGNED.phone,
  })

  // --- Walk-in QR page: sign the waiver on "your own phone" -----------------
  await page.goto(`${BOOK}/provo/walkin`)
  await expect(page.getByRole('heading', { name: 'Welcome to PLUNJ Provo' })).toBeVisible()
  await page.getByLabel('Full name').fill(SIGNED.name)
  await page.getByLabel('Mobile number').fill(SIGNED.phone)
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Sign & check in' }).click()

  // Checkmark screen for the front desk.
  await expect(page.getByText('Show this screen at the front desk.')).toBeVisible()
  await expect(page.getByText('Wally', { exact: true })).toBeVisible()
  await expect(page.getByText('Waiver signed · PLUNJ Provo')).toBeVisible()

  // --- Staff phone-OTP sign-in ---------------------------------------------
  await signInAsStaff(page, { phone: STAFF_PHONE, staffEmail: FRONT_DESK_EMAIL })

  // --- Desk roster: both guests on today's session --------------------------
  await page.goto(`${BOOK}/desk/provo`)
  const card = await rosterCardFor(page, slot)
  await expandCard(card)

  const signedRow = card.locator('li').filter({ hasText: SIGNED.name })
  const unsignedRow = card.locator('li').filter({ hasText: UNSIGNED.name })
  await expect(signedRow).toBeVisible()
  await expect(unsignedRow).toBeVisible()
  await expect(signedRow.getByText('✓ Waiver')).toBeVisible()
  await expect(unsignedRow.getByText('Waiver unsigned')).toBeVisible()

  // --- Check in the signed guest: succeeds ----------------------------------
  await signedRow.getByRole('button', { name: 'Check in' }).click()
  await expect(signedRow.getByText('✓ In')).toBeVisible()

  // --- Check in the unsigned guest: waiver sheet with QR --------------------
  await unsignedRow.getByRole('button', { name: 'Check in' }).click()
  const sheet = page.getByRole('dialog', { name: 'Waiver needed' })
  await expect(sheet).toBeVisible()
  await expect(sheet.getByText(/hasn.t signed the current waiver/)).toBeVisible()
  await expect(
    sheet.getByRole('img', { name: `Waiver signing link for ${UNSIGNED.name}` }),
  ).toBeVisible()
  // Still not checked in.
  await sheet.getByRole('button', { name: 'Close' }).click()
  await expect(unsignedRow.getByRole('button', { name: 'Check in' })).toBeVisible()
})
