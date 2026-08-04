# @plunj/db

Prisma + Neon Postgres data layer for the PLUNJ booking platform.

- **Schema:** `prisma/schema.prisma` — full Phase 1–3 entity model
- **Client:** generated into `src/generated/prisma/` (checked-in output of `prisma generate`)
- **Exports:** `prisma` (lazy PrismaClient singleton), `id()` (UUIDv7 helper), and every generated Prisma type/enum
- **Seed:** `src/seed.ts` — idempotent, safe to re-run

## Conventions

- Row ids are **UUIDv7 strings generated in app code** via `id()` — never by the database.
- All money fields are integer cents (`*Cents`); rates are basis points (`*Bps`).
- Every tenant-scoped table carries a denormalized, indexed `location_id`.
- Tables/columns are snake_case (`@@map`/`@map`); Prisma fields are camelCase.
- Prisma 7: the connection URL lives in `prisma.config.ts` (`DATABASE_URL`), not in the schema. The runtime client connects through a driver adapter (`@prisma/adapter-neon` or `@prisma/adapter-pg`) resolved lazily by `src/index.ts` from the consuming app's dependencies.

## Migration workflow

There is no migration history yet — migrations are generated locally against a
**Neon development branch**, never against production.

1. Point `DATABASE_URL` at a Neon dev branch (or local Postgres) in your environment.
2. Generate the first migration:

   ```sh
   pnpm --filter @plunj/db db:migrate -- --name init
   ```

3. **Before committing the first migration**, append the contents of
   `prisma/sql/constraints.sql` to the end of the generated
   `prisma/migrations/<timestamp>_init/migration.sql`, then re-apply
   (`prisma migrate reset` on the dev branch, or run the file directly).
   That file contains constraints Prisma cannot express in the schema:

   - `sessions_booked_seats_within_capacity` — CHECK backstop making overbooking impossible at the DB level (`booked_seats >= 0 AND booked_seats <= capacity`).
   - `discount_codes_brand_wide_code_key` — partial unique index on `lower(code) WHERE location_id IS NULL`. Postgres treats NULLs as distinct in the `@@unique([locationId, code])` constraint, so brand-wide codes need this.
   - `staff_roles_global_role_key` — same NULL-distinctness fix for org-wide staff roles.
   - CHECKs for discount value/type consistency, stored-value ledger integrity, EXCLUSIVE sessions, and positive booking seats.

   The statements are idempotent (`IF EXISTS` / `IF NOT EXISTS`), so keeping
   them at the end of the migration is safe.

4. Subsequent schema changes: edit `schema.prisma`, run
   `pnpm --filter @plunj/db db:migrate -- --name <change>`, review the SQL, and
   commit schema + migration together. If a change touches one of the raw
   constraints, update `prisma/sql/constraints.sql` **and** add the matching
   ALTER statements to that migration.
5. Deploys apply committed migrations only: `pnpm --filter @plunj/db db:deploy`.

## Everyday commands

```sh
pnpm --filter @plunj/db db:generate   # regenerate the client after schema edits
pnpm --filter @plunj/db typecheck
pnpm --filter @plunj/db db:seed       # idempotent seed (PLUNJ org, Provo location, …)
pnpm --filter @plunj/db exec prisma validate
```

Note: Prisma prints a Node 25 support warning in this repo — expected, ignore it.

## Seed contents

`src/seed.ts` upserts by natural keys (slug, unique constraints), so it always
converges: PLUNJ organization; Provo location (`provo`, America/Denver,
tax 7.25%, internal booking); one CONTRAST_SUITE studio (capacity 8); hourly
session templates matching real hours (Mon–Fri 06:00–21:00 starts, Sat
07:00–20:00, Sun 08:00–19:00) at $45; buyout options 1 hr/$210/8 guests and
2 hr/$385/12 guests; v1 placeholder LIABILITY and MINOR_CONSENT waivers; test
discount codes `WELCOME20`, `FIRSTTIMER`, `TENOFF`; one LOCATION_OWNER and one
FRONT_DESK staff user (placeholder emails).
