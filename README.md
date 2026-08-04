# PLUNJ Booking Platform

Custom multi-tenant scheduling, booking, and studio-management platform for PLUNJ contrast-therapy studios.

## Structure

| Path | What |
|------|------|
| `apps/web` | Next.js app — public booking, account, front desk, admin |
| `packages/db` | Prisma schema + migrations (Postgres/Neon) |
| `packages/money` | Pure pricing kernel (property-tested) |
| `packages/availability` | Session generation + capacity engine |
| `packages/payments` | Payment provider abstraction (Stripe Connect) |
| `packages/api` | tRPC routers shared by web (and future mobile) |

## Development

```bash
pnpm install
pnpm dev        # all apps
pnpm test       # unit tests
pnpm typecheck
```

Requires Node 22+, pnpm 10+, and a Postgres `DATABASE_URL` (Neon in prod).
