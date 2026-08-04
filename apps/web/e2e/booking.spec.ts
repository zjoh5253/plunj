/**
 * The golden path: location chooser → schedule (tomorrow, 2 guests) → checkout
 * with a server-rendered breakdown → payment completed by driving the fake
 * payment webhook → confirmation page with the waiver CTA → sign the waiver →
 * manage page shows CONFIRMED.
 *
 * Money strings are hand-computed literals pinned against the server output —
 * the tests NEVER recompute money:
 *   2 seats × $45.00 = $90.00 subtotal
 *   tax  = round(9000 × 725 / 10000) = round(652.5) = 653¢ → "$6.53"
 *   total = 9000 + 653 = 9653¢ → "$96.53"
 */
import { expect, test } from '@playwright/test'
import { BOOK, dateTab, deliverPaymentWebhook, escapeRegex, moneyRowValue } from './helpers'

const PHONE = '+18015551001'

test('golden path: browse → checkout → fake-webhook payment → waiver → CONFIRMED', async ({
  page,
  request,
}) => {
  // --- Location chooser ----------------------------------------------------
  await page.goto(`${BOOK}`)
  await expect(page.getByRole('heading', { name: 'Find your studio' })).toBeVisible()
  await page.getByRole('link', { name: /PLUNJ Provo/ }).click()

  // --- Schedule: tomorrow, 2 guests ---------------------------------------
  await expect(page.getByRole('heading', { name: 'PLUNJ Provo' })).toBeVisible()
  await page.getByRole('button', { name: 'More guests' }).click()
  await dateTab(page, 1).click()
  await expect(dateTab(page, 1)).toHaveAttribute('aria-selected', 'true')

  // Pick the first bookable slot (every seeded slot renders the "$45.00" price).
  const slot = page
    .getByRole('button')
    .filter({ hasText: '$45.00' })
    .and(page.locator(':not([disabled])'))
    .first()
  await slot.click()
  await page.waitForURL(/\/book\/provo\/checkout\?session=[^&]+&seats=2/)

  // --- Checkout breakdown: verbatim server strings -------------------------
  await expect(page.getByRole('heading', { name: 'Checkout' })).toBeVisible()
  // Line: 2 × Contrast Session, $90.00; then Subtotal / Tax / Total.
  await expect(moneyRowValue(page, /^Contrast Session — .* × 2$/)).toHaveText('$90.00')
  await expect(moneyRowValue(page, 'Subtotal')).toHaveText('$90.00')
  await expect(moneyRowValue(page, 'Tax')).toHaveText('$6.53')
  await expect(moneyRowValue(page, 'Total')).toHaveText('$96.53')
  // Pay-button label equals the rendered total — one server value.
  const payButton = page.getByRole('button', { name: 'Pay $96.53' })
  await expect(payButton).toBeVisible()

  // --- Contact + start checkout --------------------------------------------
  await page.getByLabel('First name').fill('Erin')
  await page.getByLabel('Last name').fill('Golden')
  await page.getByLabel('Mobile number').fill(PHONE)

  const startResponse = page.waitForResponse(
    (r) => r.url().includes('checkout.start') && r.request().method() === 'POST',
  )
  await payButton.click()
  const response = await startResponse
  expect(response.ok()).toBe(true)
  const raw = (await response.json()) as unknown
  const startData = (
    Array.isArray(raw) ? (raw[0] as { result: { data: unknown } }).result.data : (raw as { result: { data: unknown } }).result.data
  ) as {
    bookingId: string
    manageToken: string
    clientSecret: string | null
    quote: { totalCents: number }
  }
  expect(startData.clientSecret).not.toBeNull()

  // --- Payment stage: same server total; Stripe.js is unavailable in E2E ---
  await expect(page.getByRole('heading', { name: 'Payment' })).toBeVisible()
  await expect(moneyRowValue(page, 'Total')).toHaveText('$96.53')
  await expect(page.getByText(/Payments aren.t configured in this environment/)).toBeVisible()

  // Complete the payment by driving the webhook endpoint with the fake
  // provider's contract (same singleton in the server process holds the intent).
  await deliverPaymentWebhook(request, startData.clientSecret as string)

  // --- Confirmation: waiver CTA --------------------------------------------
  await page.goto(`${BOOK}/provo/confirmed/${startData.bookingId}`)
  await expect(page.getByRole('heading', { name: "You're booked." })).toBeVisible()
  await expect(page.getByText('2 guests', { exact: true })).toBeVisible()
  const waiverCta = page.getByRole('link', { name: 'Sign your waiver (2 min)' })
  await expect(waiverCta).toBeVisible()

  // --- Sign the waiver (typed name) ----------------------------------------
  await waiverCta.click()
  await page.waitForURL(new RegExp(`/book/waiver/${escapeRegex(startData.manageToken)}`))
  // level 1 — the placeholder waiver body markdown repeats the title as an h2.
  await expect(
    page.getByRole('heading', { name: 'Waiver and Release of Liability', level: 1 }),
  ).toBeVisible()
  // exact — the signature field's label also contains "full name".
  await expect(page.getByLabel('Full name', { exact: true })).toHaveValue('Erin')
  await page.getByLabel('Mobile number').fill(PHONE)
  await page.getByRole('checkbox').check()
  await page.getByLabel('Signature — type your full name').fill('Erin Golden')
  await page.getByRole('button', { name: 'Sign waiver' }).click()
  await expect(page.getByRole('heading', { name: 'Waiver signed' })).toBeVisible()

  // --- Manage page shows CONFIRMED -----------------------------------------
  await page.getByRole('link', { name: 'View your booking' }).click()
  await page.waitForURL(new RegExp(`/book/manage/${escapeRegex(startData.manageToken)}`))
  await expect(page.getByRole('heading', { name: 'Hi Erin — your booking' })).toBeVisible()
  await expect(page.getByText('CONFIRMED', { exact: true })).toBeVisible()
})
