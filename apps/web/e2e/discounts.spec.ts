/**
 * The anti-Momence spec: discount codes at checkout render exact,
 * server-computed strings, structured rejection messages, and a pay-button
 * label that always equals the rendered total.
 *
 * Hand-computed expectations (Provo taxRateBps 725, 2 × $35.00 = 7000¢),
 * pinned as literals — the tests NEVER recompute money:
 *
 *   base:      tax = round(7000×725/10000) = round(507.5) = 508¢ → "$5.08"
 *              total = 7508¢ → "$75.08"
 *   WELCOME20: discount = round(7000×2000/10000) = 1400¢ → "−$14.00"
 *              7000 − 1400 = 5600¢; tax = round(5600×725/10000) = 406¢ → "$4.06"
 *              total = 5600 + 406 = 6006¢ → "$60.06"
 *   TENOFF:    discount = 1000¢ → "−$10.00"
 *              7000 − 1000 = 6000¢; tax = round(6000×725/10000) = 435¢ → "$4.35"
 *              total = 7000 − 1000 + 435 = 6435¢ → "$64.35"
 *
 * NOTE the discount value renders with a typographic minus (U+2212 "−"), per
 * formatCents in src/lib/format.ts.
 */
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { BOOK, availabilityOn, dateKey, moneyRowValue } from './helpers'

/** Pay-button label must equal the rendered Total — one server value. */
async function expectTotalAndPayButton(page: Page, total: string): Promise<void> {
  await expect(moneyRowValue(page, 'Total')).toHaveText(total)
  const rendered = await moneyRowValue(page, 'Total').innerText()
  await expect(page.getByRole('button', { name: `Pay ${rendered}` })).toBeVisible()
}

test('discount codes: exact breakdown strings, structured rejections, pay = total', async ({
  page,
  request,
}) => {
  // A tomorrow session straight from the public API — 2 seats → 7000¢ order.
  const slots = await availabilityOn(request, dateKey(1))
  expect(slots.length).toBeGreaterThan(0)
  const slot = slots[0] as (typeof slots)[number]
  expect(slot.priceCents).toBe(3500)

  await page.goto(`${BOOK}/provo/checkout?session=${slot.sessionId}&seats=2`)
  await expect(page.getByRole('heading', { name: 'Checkout' })).toBeVisible()

  // --- Base quote -----------------------------------------------------------
  await expect(moneyRowValue(page, 'Subtotal')).toHaveText('$70.00')
  await expect(moneyRowValue(page, 'Tax')).toHaveText('$5.08')
  await expectTotalAndPayButton(page, '$75.08')

  const promo = page.getByLabel('Promo code')

  // --- WELCOME20 (20% → 2000 bps) ------------------------------------------
  await promo.fill('WELCOME20')
  // Discount line: server description + exact amount (typographic minus).
  await expect(moneyRowValue(page, '20% off')).toHaveText('−$14.00')
  await expect(moneyRowValue(page, 'Subtotal')).toHaveText('$70.00')
  await expect(moneyRowValue(page, 'Tax')).toHaveText('$4.06')
  await expectTotalAndPayButton(page, '$60.06')

  // --- Nonsense code: structured message, not a bare "invalid code" ---------
  await promo.fill('DEFINITELYNOTACODE')
  await expect(page.getByText("We don't recognize that code.")).toBeVisible()
  // Totals fall back to the base quote while the code is rejected.
  await expect(moneyRowValue(page, 'Tax')).toHaveText('$5.08')
  await expectTotalAndPayButton(page, '$75.08')

  // --- TENOFF ($10 fixed) ----------------------------------------------------
  await promo.fill('TENOFF')
  await expect(moneyRowValue(page, '$10.00 off')).toHaveText('−$10.00')
  await expect(moneyRowValue(page, 'Subtotal')).toHaveText('$70.00')
  await expect(moneyRowValue(page, 'Tax')).toHaveText('$4.35')
  await expectTotalAndPayButton(page, '$64.35')
})
