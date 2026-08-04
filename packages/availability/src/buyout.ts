import { TZDate } from '@date-fns/tz'
import { id, BookingStatus, BookingType, Prisma, SessionStatus } from '@plunj/db'
import type { Booking, PrismaClient } from '@plunj/db'
import { BuyoutUnavailableError } from './errors.js'
import { newManageToken } from './token.js'
import type { DbClient } from './capacity.js'

/**
 * Buyouts (CLAUDE.md invariant #4): buyouts and communal sessions share ONE
 * source of truth. A buyout does not live on a second calendar — it flips the
 * overlapping Session rows to EXCLUSIVE (with booked_seats = capacity and
 * exclusive_booking_id set) inside the same transaction that creates the
 * BUYOUT booking. Drop-in reservations then fail naturally because
 * tryReserveSeats requires status = OPEN.
 */

interface LockedSessionRow {
  id: string
  studio_id: string
  starts_at: Date
  ends_at: Date
  status: string
  booked_seats: number
}

export interface FindBuyoutWindowsInput {
  locationId: string
  /** Restrict to one studio; defaults to every active studio at the location. */
  studioId?: string
  /** Local calendar date at the location, "YYYY-MM-DD". */
  date: string
  durationHours: number
}

export interface BuyoutWindow {
  studioId: string
  startsAt: Date
  endsAt: Date
  /** The consecutive sessions the claim must flip, ordered by startsAt. */
  sessionIds: string[]
}

function parseDateString(date: string): { y: number; m: number; d: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!match) throw new Error(`Invalid date "${date}" — expected YYYY-MM-DD`)
  return { y: Number(match[1]), m: Number(match[2]) - 1, d: Number(match[3]) }
}

/**
 * For each candidate studio, list start times on `date` (location-local) where
 * `durationHours` of CONSECUTIVE sessions (each endsAt touching the next
 * startsAt) are all OPEN with zero booked seats. Windows are minimal chains
 * covering at least `durationHours` from their start.
 */
export async function findBuyoutWindows(
  db: PrismaClient,
  input: FindBuyoutWindowsInput,
): Promise<BuyoutWindow[]> {
  const { locationId, studioId, date, durationHours } = input

  const location = await db.location.findUnique({ where: { id: locationId } })
  if (!location) throw new Error(`Location ${locationId} not found`)

  const { y, m, d } = parseDateString(date)
  // Local midnight to next local midnight; JS date normalization handles
  // month/year rollover, TZDate handles the zone (DST days are 23h/25h long).
  const dayStart = new Date(new TZDate(y, m, d, 0, 0, 0, location.timezone).getTime())
  const dayEnd = new Date(new TZDate(y, m, d + 1, 0, 0, 0, location.timezone).getTime())

  const studioIds = studioId
    ? [studioId]
    : (await db.studio.findMany({ where: { locationId, active: true }, select: { id: true } })).map(
        (s) => s.id,
      )

  const targetMs = durationHours * 3_600_000
  const windows: BuyoutWindow[] = []

  for (const sid of studioIds) {
    const sessions = await db.session.findMany({
      where: {
        studioId: sid,
        startsAt: { gte: dayStart, lt: dayEnd },
        status: SessionStatus.OPEN,
        bookedSeats: 0,
      },
      orderBy: { startsAt: 'asc' },
      select: { id: true, startsAt: true, endsAt: true },
    })

    for (let i = 0; i < sessions.length; i++) {
      const first = sessions[i]!
      const chain = [first]
      let last = first
      let j = i + 1
      while (last.endsAt.getTime() - first.startsAt.getTime() < targetMs) {
        const next = sessions[j]
        if (!next || next.startsAt.getTime() !== last.endsAt.getTime()) break
        chain.push(next)
        last = next
        j++
      }
      if (last.endsAt.getTime() - first.startsAt.getTime() >= targetMs) {
        windows.push({
          studioId: sid,
          startsAt: first.startsAt,
          endsAt: last.endsAt,
          sessionIds: chain.map((s) => s.id),
        })
      }
    }
  }

  return windows
}

export interface ClaimBuyoutInput {
  sessionIds: string[]
  locationId: string
  studioId: string
  customerId: string
  holdMinutes: number
  /**
   * Quoted buyout price. Money lives on Orders/OrderLines (computed by
   * @plunj/money at checkout) — the Booking row itself carries no price, so
   * this is accepted for API symmetry with the quote flow but not persisted.
   */
  priceCents: number
  /** Injectable clock for tests; defaults to wall time. */
  now?: Date
}

/**
 * Atomically claim `sessionIds` for a buyout: lock the rows (FOR UPDATE,
 * ordered by starts_at so competing claims lock in the same order), verify
 * each is OPEN with zero booked seats and that they form one consecutive run
 * on `studioId`, then flip them all to EXCLUSIVE and create a single BUYOUT
 * booking in HOLD. Throws `BuyoutUnavailableError` naming the conflicting
 * sessions, with nothing written.
 */
export async function claimBuyout(db: PrismaClient, input: ClaimBuyoutInput): Promise<Booking> {
  const { sessionIds, locationId, studioId, customerId, holdMinutes } = input
  const now = input.now ?? new Date()
  if (sessionIds.length === 0) throw new BuyoutUnavailableError([], 'no sessions requested')

  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<LockedSessionRow[]>`
      SELECT "id", "studio_id", "starts_at", "ends_at", "status", "booked_seats"
      FROM "sessions"
      WHERE "id" IN (${Prisma.join(sessionIds)})
      ORDER BY "starts_at" ASC
      FOR UPDATE
    `

    const missing = sessionIds.filter((sid) => !rows.some((r) => r.id === sid))
    if (missing.length > 0) throw new BuyoutUnavailableError(missing, 'sessions not found')

    const conflicts = rows
      .filter((r) => r.status !== 'OPEN' || r.booked_seats > 0 || r.studio_id !== studioId)
      .map((r) => r.id)
    if (conflicts.length > 0) throw new BuyoutUnavailableError(conflicts)

    for (let i = 1; i < rows.length; i++) {
      if (rows[i]!.starts_at.getTime() !== rows[i - 1]!.ends_at.getTime()) {
        throw new BuyoutUnavailableError([rows[i - 1]!.id, rows[i]!.id], 'sessions not consecutive')
      }
    }

    const bookingId = id()
    await tx.$executeRaw`
      UPDATE "sessions"
      SET "status" = 'EXCLUSIVE',
          "exclusive_booking_id" = ${bookingId},
          "booked_seats" = "capacity",
          "updated_at" = now()
      WHERE "id" IN (${Prisma.join(sessionIds)})
    `

    return tx.booking.create({
      data: {
        id: bookingId,
        // Schema convention: sessionId is null for buyouts spanning multiple sessions.
        sessionId: rows.length === 1 ? rows[0]!.id : null,
        locationId,
        studioId,
        customerId,
        type: BookingType.BUYOUT,
        seats: 1,
        status: BookingStatus.HOLD,
        holdExpiresAt: new Date(now.getTime() + holdMinutes * 60_000),
        startsAt: rows[0]!.starts_at,
        endsAt: rows[rows.length - 1]!.ends_at,
        manageToken: newManageToken(),
      },
    })
  })
}

export interface ReleaseBuyoutInput {
  bookingId: string
}

/**
 * Revert every session claimed by `bookingId` to OPEN with zero booked seats.
 * Used by hold expiry and cancellation; runs in the caller's transaction.
 * Returns the number of sessions reverted (0 if already released — idempotent).
 */
export async function releaseBuyout(
  tx: DbClient,
  { bookingId }: ReleaseBuyoutInput,
): Promise<number> {
  return tx.$executeRaw`
    UPDATE "sessions"
    SET "status" = 'OPEN', "booked_seats" = 0, "exclusive_booking_id" = NULL, "updated_at" = now()
    WHERE "exclusive_booking_id" = ${bookingId} AND "status" = 'EXCLUSIVE'
  `
}

/**
 * Attempt to re-claim the sessions of an EXPIRED buyout hold (confirmHold's
 * slow-payer path). The booking's studio + [startsAt, endsAt) window identifies
 * the sessions; they must all still be OPEN and empty and must exactly cover
 * the window. Returns true iff the sessions were re-flipped to EXCLUSIVE.
 */
export async function reclaimBuyoutSessions(tx: DbClient, booking: Booking): Promise<boolean> {
  const rows = await tx.$queryRaw<LockedSessionRow[]>`
    SELECT "id", "studio_id", "starts_at", "ends_at", "status", "booked_seats"
    FROM "sessions"
    WHERE "studio_id" = ${booking.studioId}
      AND "starts_at" >= ${booking.startsAt}
      AND "starts_at" < ${booking.endsAt}
    ORDER BY "starts_at" ASC
    FOR UPDATE
  `

  if (rows.length === 0) return false
  if (rows.some((r) => r.status !== 'OPEN' || r.booked_seats > 0)) return false
  if (rows[0]!.starts_at.getTime() !== booking.startsAt.getTime()) return false
  if (rows[rows.length - 1]!.ends_at.getTime() !== booking.endsAt.getTime()) return false
  for (let i = 1; i < rows.length; i++) {
    if (rows[i]!.starts_at.getTime() !== rows[i - 1]!.ends_at.getTime()) return false
  }

  await tx.$executeRaw`
    UPDATE "sessions"
    SET "status" = 'EXCLUSIVE',
        "exclusive_booking_id" = ${booking.id},
        "booked_seats" = "capacity",
        "updated_at" = now()
    WHERE "id" IN (${Prisma.join(rows.map((r) => r.id))})
  `
  return true
}
