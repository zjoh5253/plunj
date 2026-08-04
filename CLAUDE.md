# PLUNJ Booking Platform

Multi-tenant scheduling & booking platform for PLUNJ (contrast-therapy franchise, 16+ locations), replacing Momence in phases. Full plan: `~/.claude/plans/ok-my-wife-jennica-compiled-reddy.md`.

## Monorepo

- `apps/web` — Next.js 16 App Router, served at `plunj.co/book/*` (basePath `/book`). Route groups: public booking, account, desk (staff tablet PWA), admin (owner + corporate).
- `packages/db` — Prisma + Neon Postgres. All money integer cents; UUIDv7 ids; `locationId` denormalized on every tenant-scoped table.
- `packages/money` — pure zero-dep pricing kernel. **The only place money arithmetic happens.** Server computes quotes; UIs only render them.
- `packages/availability` — session generation + capacity/hold/buyout engine.
- `packages/payments` — `PaymentProvider` interface; Stripe Connect (one Express account per location, direct charges).
- `packages/api` — tRPC 11 routers, consumed by web now, Expo later.

## Non-negotiable invariants

1. **No client-side money math, ever.** One server quote endpoint feeds customer checkout, desk POS, and admin discount preview. Pay button amount = breakdown total = charged amount = one server value.
2. **Percent discounts computed once** on the eligible subtotal, allocated across lines largest-remainder; allocations must sum exactly. Round-half-up at exactly two points (discount total, per-line tax). Discount → tax → tip order. Gift cards/pack credits are tenders, not discounts.
3. **Overbooking is impossible at the DB level**: conditional `UPDATE ... WHERE booked_seats + n <= capacity` + CHECK constraint. Holds (10-min TTL) consume real seats.
4. **Buyouts and communal share one source of truth** — buyouts set overlapping Session rows to EXCLUSIVE; no second calendar.
5. Timezones: templates store local wall time, converted per-date to UTC at generation; render in the location's IANA TZ, never the browser's.
6. Append-only ledgers for stored value (gift cards, packs, credits); balances are SUMs, never mutable columns.
7. Anything touching money or capacity writes an AuditLog row in the same transaction.
8. Notifications go through the OutboxMessage table (transactional with state change), drained by cron.

## Auth

Better Auth: phone-OTP (Twilio) for customers, org/roles for staff. No passwords anywhere. Guest checkout (name + phone) creates a shadow Customer; first OTP verification claims their history. Waivers never block booking — enforced at check-in.

## Conventions

- pnpm + Turborepo; `pnpm test` / `pnpm typecheck` from root.
- Tailwind; black/white/gray Nordic palette, color only for semantic states.
- Per-location `bookingProvider` flag (`internal | momence`) routes unmigrated locations to their Momence URL.
