/**
 * The anti-Momence spec: discount codes at checkout render exact,
 * server-computed strings, structured rejection messages, and a pay-button
 * label that always equals the rendered total.
 *
 * Hand-computed expectations (Provo taxRateBps 725, 2 × $45.00 = 9000¢),
 * pinned as literals — the tests NEVER recompute money:
 *
 *   base:      tax = round(9000×725/10000) = round(652.5) = 653¢ → "$6.53"
 *              total = 9653¢ → "$96.53"
 *   WELCOME20: discount = round(9000×2000/10000) = 1800¢ → "−$18.00"
 *              9000 − 1800 = 7200¢; tax = round(7200×725/10000) = 522¢ → "$5.22"
 *              total = 7200 + 522 = 7722¢ → "$77.22"
 *   TENOFF:    discount = 1000¢ → "−$10.00"
 *              9000 − 1000 = 8000¢; tax = round(8000×725/10000) = 580¢ → "$5.80"
 *              total = 9000 − 1000 + 580 = 8580¢ → "$85.80"
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
  // A tomorrow session straight from the public API — 2 seats → 9000¢ order.
  const slots = await availabilityOn(request, dateKey(1))
  expect(slots.length).toBeGreaterThan(0)
  const slot = slots[0] as (typeof slots)[number]
  expect(slot.priceCents).toBe(4500)

  await page.goto(`${BOOK}/provo/checkout?session=${slot.sessionId}&seats=2`)
  await expect(page.getByRole('heading', { name: 'Checkout' })).toBeVisible()

  // --- Base quote -----------------------------------------------------------
  await expect(moneyRowValue(page, 'Subtotal')).toHaveText('$90.00')
  await expect(moneyRowValue(page, 'Tax')).toHaveText('$6.53')
  await expectTotalAndPayButton(page, '$96.53')

  const promo = page.getByLabel('Promo code')

  // --- WELCOME20 (20% → 2000 bps) ------------------------------------------
  await promo.fill('WELCOME20')
  // Discount line: server description + exact amount (typographic minus).
  await expect(moneyRowValue(page, '20% off')).toHaveText('−$18.00')
  await expect(moneyRowValue(page, 'Subtotal')).toHaveText('$90.00')
  await expect(moneyRowValue(page, 'Tax')).toHaveText('$5.22')
  await expectTotalAndPayButton(page, '$77.22')

  // --- Nonsense code: structured message, not a bare "invalid code" ---------
  await promo.fill('DEFINITELYNOTACODE')
  await expect(page.getByText("We don't recognize that code.")).toBeVisible()
  // Totals fall back to the base quote while the code is rejected.
  await expect(moneyRowValue(page, 'Tax')).toHaveText('$6.53')
  await expectTotalAndPayButton(page, '$96.53')

  // --- TENOFF ($10 fixed) ----------------------------------------------------
  await promo.fill('TENOFF')
  await expect(moneyRowValue(page, '$10.00 off')).toHaveText('−$10.00')
  await expect(moneyRowValue(page, 'Subtotal')).toHaveText('$90.00')
  await expect(moneyRowValue(page, 'Tax')).toHaveText('$5.80')
  await expectTotalAndPayButton(page, '$85.80')
})
