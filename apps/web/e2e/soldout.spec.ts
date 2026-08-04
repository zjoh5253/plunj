/**
 * Sold-out behavior. Fill a session to capacity via the tRPC HTTP API
 * (checkout.start holds consume REAL seats — invariant #3), then:
 *  - the schedule UI renders the slot dimmed with a "Sold out" badge and the
 *    button is disabled (selection impossible),
 *  - a straggler checkout.start gets the structured SOLD_OUT conflict.
 *
 * Uses the day-after-tomorrow's first slot so it never collides with the
 * golden-path spec (which books tomorrow).
 */
import { expect, test } from '@playwright/test'
import {
  BOOK,
  availabilityOn,
  dateKey,
  dateTab,
  escapeRegex,
  startCheckout,
  timeOfDay,
  trpcMutateRaw,
} from './helpers'

test('a slot booked to capacity is Sold out in the UI and SOLD_OUT over the API', async ({
  page,
  request,
}) => {
  const day = dateKey(2)
  const slots = await availabilityOn(request, day)
  expect(slots.length).toBeGreaterThan(0)
  const slot = slots[0] as (typeof slots)[number]
  expect(slot.remainingSeats).toBe(slot.capacity) // untouched by other specs

  // Book the session to capacity: distinct guests, 2 seats each.
  let seatsLeft = slot.remainingSeats
  let guest = 0
  while (seatsLeft > 0) {
    const seats = Math.min(2, seatsLeft)
    guest += 1
    await startCheckout(request, {
      sessionId: slot.sessionId,
      seats,
      firstName: `Filler${guest}`,
      phone: `+1801555210${guest}`,
    })
    seatsLeft -= seats
  }

  // API now reports zero remaining seats.
  const after = await availabilityOn(request, day)
  const refreshed = after.find((s) => s.sessionId === slot.sessionId)
  expect(refreshed?.remainingSeats).toBe(0)

  // --- UI: dimmed "Sold out" slot that cannot be selected -------------------
  await page.goto(`${BOOK}/provo`)
  await dateTab(page, 2).click()
  await expect(dateTab(page, 2)).toHaveAttribute('aria-selected', 'true')

  const slotButton = page
    .getByRole('button')
    .filter({ hasText: new RegExp(`^${escapeRegex(timeOfDay(slot.startsAt))}`) })
  await expect(slotButton).toContainText('Sold out')
  await expect(slotButton).toBeDisabled()

  // --- Straggler checkout.start: structured SOLD_OUT conflict ---------------
  const straggler = await trpcMutateRaw(request, 'public.checkout.start', {
    locationSlug: 'provo',
    items: [{ kind: 'DROP_IN', sessionId: slot.sessionId, seats: 1 }],
    customer: { firstName: 'Straggler', phone: '+18015552199' },
  })
  expect(straggler.status()).toBe(409)
  const body = (await straggler.json()) as {
    error: { data: { code: string; httpStatus: number; domainCode?: string } }
  }
  expect(body.error.data.code).toBe('CONFLICT')
  expect(body.error.data.httpStatus).toBe(409)
  expect(body.error.data.domainCode).toBe('SOLD_OUT')
})
