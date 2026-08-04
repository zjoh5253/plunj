/**
 * Playwright E2E config for @plunj/web.
 *
 * globalSetup boots an ephemeral Postgres (port 54333), pushes the Prisma
 * schema + raw constraints, seeds, and generates ~3 days of sessions; the
 * webServer is `next dev` against that database with NO Stripe/Twilio/Resend
 * keys so the in-memory fakes activate (FakePaymentProvider, FakeSmsSender).
 *
 * workers: 1 — the specs share one database and one dev server.
 */
import { defineConfig, devices } from '@playwright/test'
import { DATABASE_URL } from './e2e/setup/pg'

const PORT = 3100
const BASE = `http://localhost:${PORT}`

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/setup/global-setup',
  globalTeardown: './e2e/setup/global-teardown',
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: BASE,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm --filter @plunj/web dev',
    // Port-based readiness on purpose: Playwright starts the webServer plugin
    // BEFORE globalSetup runs, and the ephemeral database only exists after
    // globalSetup — `next dev` binds the port immediately and touches the DB
    // lazily, so waiting on the port avoids a readiness/setup deadlock.
    port: PORT,
    cwd: '../..',
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      PORT: String(PORT),
      DATABASE_URL,
      CRON_SECRET: 'e2e-secret',
      BETTER_AUTH_SECRET: 'e2e',
      // Origin only — Next strips the /book basePath before route handlers,
      // so better-auth must keep its default '/api/auth' basePath.
      BETTER_AUTH_URL: BASE,
      // Force the fake providers: empty strings are falsy in the lazy env
      // checks in src/lib/trpc/server.ts.
      STRIPE_SECRET_KEY: '',
      STRIPE_WEBHOOK_SECRET: '',
      TWILIO_ACCOUNT_SID: '',
      TWILIO_AUTH_TOKEN: '',
      RESEND_API_KEY: '',
      NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: '',
    },
  },
})
