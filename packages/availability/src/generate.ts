import { TZDate } from '@date-fns/tz'
import { id, SessionStatus } from '@plunj/db'
import type { PrismaClient, Session } from '@plunj/db'

/**
 * Session generation — expands SessionTemplates (local wall time, day-of-week)
 * into concrete Session rows with UTC instants (CLAUDE.md invariant #5).
 *
 * DST semantics (verified behavior of @date-fns/tz TZDate, tested in
 * test/generate.test.ts):
 *
 * - Nonexistent local times (spring forward): the wall time is interpreted with
 *   the pre-transition offset, which pushes it forward through the gap to the
 *   next valid instant. E.g. America/Denver 2026-03-08: a "02:30" template
 *   resolves to 03:30 MDT = 09:30Z ("02:00" resolves to 03:00 MDT = 09:00Z).
 *   The session is never dropped and never lands on an invalid instant.
 *
 * - Ambiguous local times (fall back): the EARLIER offset (still-daylight
 *   occurrence) is chosen. E.g. America/Denver 2026-11-01: a "01:30" template
 *   resolves to 01:30 MDT = 07:30Z, not 01:30 MST = 08:30Z.
 */

export interface GenerateSessionsInput {
  locationId: string
  /** Days past today to generate, inclusive. Defaults to location.bookingWindowDays. */
  horizonDays?: number
  now: Date
}

export interface GenerateSessionsResult {
  /** Candidate (template, date) pairs considered for insertion. */
  scanned: number
  /** Rows actually inserted; scanned - created were pre-existing (idempotency). */
  created: number
}

/** Calendar date as { y, m (0-based), d } — pure calendar math, no instants. */
interface CalendarDate {
  y: number
  m: number
  d: number
}

function localCalendarDate(instant: Date, timezone: string): CalendarDate {
  const local = new TZDate(instant.getTime(), timezone)
  return { y: local.getFullYear(), m: local.getMonth(), d: local.getDate() }
}

/** Add days via Date.UTC normalization — immune to DST since it never touches a zone. */
function addCalendarDays(date: CalendarDate, days: number): CalendarDate {
  const shifted = new Date(Date.UTC(date.y, date.m, date.d + days))
  return { y: shifted.getUTCFullYear(), m: shifted.getUTCMonth(), d: shifted.getUTCDate() }
}

/** 0 = Sunday … 6 = Saturday, matching SessionTemplate.dayOfWeek. */
function dayOfWeek(date: CalendarDate): number {
  return new Date(Date.UTC(date.y, date.m, date.d)).getUTCDay()
}

function toDateString(date: CalendarDate): string {
  const mm = String(date.m + 1).padStart(2, '0')
  const dd = String(date.d).padStart(2, '0')
  return `${date.y}-${mm}-${dd}`
}

/**
 * Expand all active templates of the location's active studios into Session
 * rows over [today, today + horizonDays] in the LOCATION's IANA timezone.
 *
 * Idempotent by construction: rows are inserted with
 * `createMany({ skipDuplicates: true })` against the (studioId, startsAt)
 * unique constraint, so re-running (cron, overlapping horizons) creates only
 * the missing rows and never duplicates or resets existing ones.
 */
export async function generateSessions(
  db: PrismaClient,
  input: GenerateSessionsInput,
): Promise<GenerateSessionsResult> {
  const { locationId, now } = input

  const location = await db.location.findUnique({ where: { id: locationId } })
  if (!location) throw new Error(`Location ${locationId} not found`)
  const horizonDays = input.horizonDays ?? location.bookingWindowDays
  const timezone = location.timezone

  const templates = await db.sessionTemplate.findMany({
    where: { locationId, active: true, studio: { active: true } },
    include: { studio: true },
  })
  if (templates.length === 0) return { scanned: 0, created: 0 }

  const today = localCalendarDate(now, timezone)

  const rows: Array<{
    id: string
    studioId: string
    locationId: string
    templateId: string
    startsAt: Date
    endsAt: Date
    capacity: number
    priceCents: number
  }> = []

  for (let offset = 0; offset <= horizonDays; offset++) {
    const date = addCalendarDays(today, offset)
    const dow = dayOfWeek(date)
    const dateStr = toDateString(date)

    for (const template of templates) {
      if (template.dayOfWeek !== dow) continue

      // effectiveFrom/effectiveUntil are @db.Date columns (UTC-midnight Dates);
      // compare as calendar-date strings against the LOCAL date being generated.
      if (dateStr < template.effectiveFrom.toISOString().slice(0, 10)) continue
      if (template.effectiveUntil && dateStr > template.effectiveUntil.toISOString().slice(0, 10))
        continue

      const [hh, mm] = template.startTimeLocal.split(':').map(Number)
      if (hh === undefined || mm === undefined || Number.isNaN(hh) || Number.isNaN(mm)) {
        throw new Error(
          `Template ${template.id} has invalid startTimeLocal "${template.startTimeLocal}"`,
        )
      }

      // Local wall time -> UTC instant. TZDate applies the DST semantics
      // documented at the top of this file.
      const startsAt = new Date(new TZDate(date.y, date.m, date.d, hh, mm, 0, timezone).getTime())
      const endsAt = new Date(startsAt.getTime() + template.durationMin * 60_000)

      rows.push({
        id: id(),
        studioId: template.studioId,
        locationId,
        templateId: template.id,
        startsAt,
        endsAt,
        capacity: template.capacity ?? template.studio.defaultCapacity,
        priceCents: template.priceCents,
      })
    }
  }

  const { count } = await db.session.createMany({ data: rows, skipDuplicates: true })
  return { scanned: rows.length, created: count }
}

export interface ApplyTemplateChangesInput {
  templateId: string
  now: Date
}

export interface ApplyTemplateChangesResult {
  /** Future, empty, OPEN sessions deleted (regenerated on the next generation run). */
  deleted: number
  /**
   * Future sessions of this template that could NOT be deleted (booked seats or
   * non-OPEN status). These need human resolution — the engine never touches them.
   */
  conflicts: Session[]
}

/**
 * After a template edit or deactivation: delete this template's future sessions
 * that carry no bookings (bookedSeats = 0, status OPEN) so the next
 * generateSessions run recreates them from the new definition. Sessions with
 * bookings (or otherwise touched: CLOSED/CANCELLED/EXCLUSIVE) are returned as
 * conflicts and left untouched.
 */
export async function applyTemplateChanges(
  db: PrismaClient,
  input: ApplyTemplateChangesInput,
): Promise<ApplyTemplateChangesResult> {
  const { templateId, now } = input

  const { count: deleted } = await db.session.deleteMany({
    where: { templateId, startsAt: { gt: now }, bookedSeats: 0, status: SessionStatus.OPEN },
  })

  const conflicts = await db.session.findMany({
    where: {
      templateId,
      startsAt: { gt: now },
      OR: [{ bookedSeats: { gt: 0 } }, { status: { not: SessionStatus.OPEN } }],
    },
    orderBy: { startsAt: 'asc' },
  })

  return { deleted, conflicts }
}
