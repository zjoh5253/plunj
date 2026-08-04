/**
 * Cron endpoint: bearer-authenticated, returns the run summary JSON
 * (expired holds, outbox drain counts, per-location session generation).
 */
import { expect, test } from '@playwright/test'
import { BOOK, CRON_SECRET } from './helpers'

test('POST with the right bearer → 200 and the run-summary shape', async ({ request }) => {
  const res = await request.post(`${BOOK}/api/cron`, {
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  })
  expect(res.status()).toBe(200)
  const body = (await res.json()) as {
    expiredHolds: unknown
    outbox: { sent: unknown; failed: unknown; retried: unknown }
    generated: Record<string, { scanned: unknown; created: unknown }>
  }
  expect(typeof body.expiredHolds).toBe('number')
  expect(typeof body.outbox.sent).toBe('number')
  expect(typeof body.outbox.failed).toBe('number')
  expect(typeof body.outbox.retried).toBe('number')
  // The seeded internal location is rolled forward.
  expect(body.generated).toHaveProperty('provo')
  expect(typeof body.generated.provo?.scanned).toBe('number')
  expect(typeof body.generated.provo?.created).toBe('number')
})

test('wrong bearer → 401', async ({ request }) => {
  const res = await request.post(`${BOOK}/api/cron`, {
    headers: { authorization: 'Bearer not-the-secret' },
  })
  expect(res.status()).toBe(401)
  expect(await res.json()).toEqual({ error: 'Unauthorized' })
})

test('missing Authorization header → 401', async ({ request }) => {
  const res = await request.post(`${BOOK}/api/cron`)
  expect(res.status()).toBe(401)
})
