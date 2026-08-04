import { TZDate } from '@date-fns/tz'
import type { PrismaClient } from '@plunj/db'

/**
 * Public availability queries. Read-only — never mutates capacity.
 */

export interface ListAvailabilityInput {
  locationId: string
  /** Inclusive local calendar date at the location, "YYYY-MM-DD". */
  fromDate: string
  /** Inclusive local calendar date at the location, "YYYY-MM-DD". */
  toDate: string
  /** Injectable clock for the stale-hold correction; defaults to wall time. */
  now?: Date
}

export interface AvailableSession {
  sessionId: string
  studioId: string
  startsAt: Date
  endsAt: Date
  capacity: number
  priceCents: number
  remainingSeats: number
}

export interface AvailabilityDay {
  /** Local calendar date at the location, "YYYY-MM-DD". */
  date: string
  sessions: AvailableSession[]
}

interface AvailabilityRow {
  id: string
  studio_id: string
  starts_at: Date
  ends_at: Date
  capacity: number
  booked_seats: number
  price_cents: number
  stale_hold_seats: number
}

function parseDateString(date: string): { y: number; m: number; d: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!match) throw new Error(`Invalid date "${date}" — expected YYYY-MM-DD`)
  return { y: Number(match[1]), m: Number(match[2]) - 1, d: Number(match[3]) }
}

function localDateKey(instant: Date, timezone: string): string {
  const local = new TZDate(instant.getTime(), timezone)
  const mm = String(local.getMonth() + 1).padStart(2, '0')
  const dd = String(local.getDate()).padStart(2, '0')
  return `${local.getFullYear()}-${mm}-${dd}`
}

/**
 * Sessions with remaining seats over [fromDate, toDate] (location-local,
 * inclusive), grouped by local date. CLOSED/CANCELLED/EXCLUSIVE sessions are
 * excluded from public listing.
 *
 * remaining = capacity - booked_seats + SUM(seats of EXPIRED-but-unswept holds)
 *
 * The correction term makes availability robust to a stuck expiry cron: a HOLD
 * booking whose holdExpiresAt has passed still has its seats counted in
 * booked_seats until `expireHolds` runs, so we lazily add those seats back in
 * the read path — a dead cron can delay real releases but never causes phantom
 * sellouts in what customers see.
 */
export async function listAvailability(
  db: PrismaClient,
  input: ListAvailabilityInput,
): Promise<AvailabilityDay[]> {
  const { locationId, fromDate, toDate } = input
  const now = input.now ?? new Date()

  const location = await db.location.findUnique({ where: { id: locationId } })
  if (!location) throw new Error(`Location ${locationId} not found`)
  const timezone = location.timezone

  const from = parseDateString(fromDate)
  const to = parseDateString(toDate)
  const rangeStart = new Date(new TZDate(from.y, from.m, from.d, 0, 0, 0, timezone).getTime())
  const rangeEnd = new Date(new TZDate(to.y, to.m, to.d + 1, 0, 0, 0, timezone).getTime())

  const rows = await db.$queryRaw<AvailabilityRow[]>`
    SELECT
      s."id", s."studio_id", s."starts_at", s."ends_at", s."capacity", s."booked_seats",
      s."price_cents",
      COALESCE(
        SUM(b."seats") FILTER (WHERE b."status" = 'HOLD' AND b."hold_expires_at" < ${now}),
        0
      )::int AS "stale_hold_seats"
    FROM "sessions" s
    LEFT JOIN "bookings" b ON b."session_id" = s."id"
    WHERE s."location_id" = ${locationId}
      AND s."starts_at" >= ${rangeStart}
      AND s."starts_at" < ${rangeEnd}
      AND s."status" = 'OPEN'
    GROUP BY s."id"
    ORDER BY s."starts_at" ASC
  `

  const days = new Map<string, AvailableSession[]>()
  for (const row of rows) {
    const remaining = Math.max(row.capacity - row.booked_seats + row.stale_hold_seats, 0)
    const key = localDateKey(row.starts_at, timezone)
    const sessions = days.get(key) ?? []
    sessions.push({
      sessionId: row.id,
      studioId: row.studio_id,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      capacity: row.capacity,
      priceCents: row.price_cents,
      remainingSeats: remaining,
    })
    days.set(key, sessions)
  }

  return [...days.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, sessions]) => ({ date, sessions }))
}
