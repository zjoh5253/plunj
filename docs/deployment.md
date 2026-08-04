# Deployment

## Vercel project (booking app)

- **Root directory:** `apps/web` (framework: Next.js). The app has `basePath: '/book'`, so every route serves under `/book/*`.
- **Env vars** (see `.env.example`): `DATABASE_URL` (Neon, pooled connection string), `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` (**origin only** — `https://plunj.co`, never a path; Next strips the basePath before route handlers run), `TWILIO_*`, `RESEND_API_KEY`, `CRON_SECRET`. Without Stripe/Twilio/Resend keys the app falls back to fake providers — fine for previews, never for production.
- **Cron:** `apps/web/vercel.json` schedules `/book/api/cron` every minute (hold expiry, outbox drain, session-horizon roll). Vercel sends `Authorization: Bearer $CRON_SECRET` automatically when the `CRON_SECRET` env var exists.

## Database (Neon)

1. Create a Neon project + a `main` branch database; set `DATABASE_URL`.
2. First deploy: `pnpm --filter @plunj/db db:migrate` locally against a Neon branch to generate the initial migration, then **append `packages/db/prisma/sql/constraints.sql`** to that migration's `migration.sql` (CHECK constraints Prisma can't express — see `packages/db/README.md`), then `db:deploy` against main.
3. Seed the pilot: `pnpm db:seed` (idempotent; creates PLUNJ org, Provo location + studio + templates + buyout options + placeholder waivers + test discount codes).

## Keeping `plunj.co/book/*` on the main domain

The marketing site is a separate Nuxt app on Vercel that owns `plunj.co`. Its project needs one rewrite so the booking app shares the domain:

```json
// marketing site's vercel.json
{
  "rewrites": [
    { "source": "/book", "destination": "https://<booking-deployment>.vercel.app/book" },
    { "source": "/book/:path*", "destination": "https://<booking-deployment>.vercel.app/book/:path*" }
  ]
}
```

Until corporate grants that, run the booking app standalone on `book.plunj.co` (add the domain to the booking project; everything still serves under `/book`).

## Stripe

1. Platform account + Connect enabled (Express accounts).
2. Create the Provo connected account via `StripeConnect.createLocationAccount`, complete onboarding, store the account id in `Location.stripeAccountId`.
3. Webhook endpoint (Connect events, listening on the platform): `https://plunj.co/book/api/webhooks/stripe` → set `STRIPE_WEBHOOK_SECRET`. Local dev: `stripe listen --forward-to localhost:3000/book/api/webhooks/stripe`.
4. Register `plunj.co` for Apple Pay under each connected account (Payment Element handles the rest).

## Local dev

```bash
pnpm install
pnpm --filter @plunj/db db:generate
# ephemeral test DBs are automatic (initdb/pg_ctl); for a live dev DB use a Neon branch
pnpm dev
```
