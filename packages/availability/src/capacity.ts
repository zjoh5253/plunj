import { id, BookingStatus, BookingType } from '@plunj/db'
import type { Booking, Prisma, PrismaClient } from '@plunj/db'
import {
  BookingNotFoundError,
  BookingStateError,
  HoldExpiredError,
  SoldOutError,
} from './errors.js'
import { newManageToken } from './token.js'
import { reclaimBuyoutSessions, releaseBuyout } from './buyout.js'

/**
 * Atomic seat operations (CLAUDE.md invariant #3).
 *
 * The ONLY way seats are consumed is the conditional UPDATE in
 * `tryReserveSeats` — a single statement whose WHERE clause re-checks capacity,
 * so under any interleaving of concurrent bookers Postgres serializes the row
 * updates and at most `capacity` seats are ever handed out. The
 * `sessions_booked_seats_within_capacity` CHECK constraint
 * (packages/db/prisma/sql/constraints.sql) is the backstop if this module is
 * ever bypassed. Holds consume REAL seats: a HOLD booking's seats are already
 * counted in booked_seats and are only returned by expiry or cancellation.
 */

/** Either a PrismaClient or an in-flight transaction handle. */
export type DbClient = PrismaClient | Prisma.TransactionClient

export interface SeatOpInput {
  sessionId: string
  seats: number
}

/**
 * Conditionally reserve `seats` on a session. Returns true iff the reservation
 * happened (row matched: session exists, is OPEN, and had room). Runs in the
 * caller's transaction when given a transaction client.
 */
export async function tryReserveSeats(
  tx: DbClient,
  { sessionId, seats }: SeatOpInput,
): Promise<boolean> {
  const count = await tx.$executeRaw`
    UPDATE "sessions"
    SET "booked_seats" = "booked_seats" + ${seats}, "updated_at" = now()
    WHERE "id" = ${sessionId}
      AND "status" = 'OPEN'
      AND "booked_seats" + ${seats} <= "capacity"
  `
  return count === 1
}

/**
 * Return `seats` to a session. GREATEST(..., 0) guards against double-release
 * ever driving booked_seats negative (which the CHECK would reject anyway).
 */
export async function releaseSeats(tx: DbClient, { sessionId, seats }: SeatOpInput): Promise<void> {
  await tx.$executeRaw`
    UPDATE "sessions"
    SET "booked_seats" = GREATEST("booked_seats" - ${seats}, 0), "updated_at" = now()
    WHERE "id" = ${sessionId}
  `
}

export interface CreateHoldInput {
  sessionId: string
  locationId: string
  studioId: string
  customerId: string
  seats: number
  startsAt: Date
  endsAt: Date
  /** Hold TTL. Defaults to 10 minutes (CLAUDE.md invariant #3). */
  holdMinutes?: number
  type: BookingType
  /** Injectable clock for tests; defaults to wall time. */
  now?: Date
}

/**
 * Reserve seats and create a HOLD booking in one transaction. Throws
 * `SoldOutError` (nothing written) if the session cannot take the seats.
 */
export async function createHold(db: PrismaClient, input: CreateHoldInput): Promise<Booking> {
  const { sessionId, locationId, studioId, customerId, seats, startsAt, endsAt, type } = input
  const holdMinutes = input.holdMinutes ?? 10
  const now = input.now ?? new Date()

  return db.$transaction(async (tx) => {
    const reserved = await tryReserveSeats(tx, { sessionId, seats })
    if (!reserved) throw new SoldOutError(sessionId, seats)

    return tx.booking.create({
      data: {
        id: id(),
        sessionId,
        locationId,
        studioId,
        customerId,
        type,
        seats,
        status: BookingStatus.HOLD,
        holdExpiresAt: new Date(now.getTime() + holdMinutes * 60_000),
        startsAt,
        endsAt,
        manageToken: newManageToken(),
      },
    })
  })
}

export interface ConfirmHoldInput {
  bookingId: string
  orderId: string
}

/**
 * HOLD -> CONFIRMED (payment landed).
 *
 * - Already CONFIRMED: idempotent no-op (webhook retries).
 * - EXPIRED: the cron released the seats, but a slow payer can still win — we
 *   attempt to re-reserve (re-claim the sessions for buyouts) and only throw
 *   `HoldExpiredError` if the space is genuinely gone.
 * - Any other status: `BookingStateError`.
 *
 * The booking row is locked FOR UPDATE so confirm and the expiry cron
 * serialize instead of double-releasing / double-reserving.
 */
export async function confirmHold(
  db: PrismaClient,
  { bookingId, orderId }: ConfirmHoldInput,
): Promise<Booking> {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT 1 FROM "bookings" WHERE "id" = ${bookingId} FOR UPDATE`
    const booking = await tx.booking.findUnique({ where: { id: bookingId } })
    if (!booking) throw new BookingNotFoundError(bookingId)

    if (booking.status === BookingStatus.CONFIRMED) return booking

    if (booking.status === BookingStatus.HOLD) {
      return tx.booking.update({
        where: { id: bookingId },
        data: { status: BookingStatus.CONFIRMED, orderId, holdExpiresAt: null },
      })
    }

    if (booking.status === BookingStatus.EXPIRED) {
      const reclaimed =
        booking.type === BookingType.BUYOUT
          ? await reclaimBuyoutSessions(tx, booking)
          : booking.sessionId !== null &&
            (await tryReserveSeats(tx, { sessionId: booking.sessionId, seats: booking.seats }))
      if (!reclaimed) throw new HoldExpiredError(bookingId)

      return tx.booking.update({
        where: { id: bookingId },
        data: { status: BookingStatus.CONFIRMED, orderId, holdExpiresAt: null },
      })
    }

    throw new BookingStateError(bookingId, booking.status, 'confirm')
  })
}

export interface ExpireHoldsInput {
  now: Date
}

/**
 * Cron entry point: expire every HOLD whose holdExpiresAt < now. One
 * transaction PER booking so a single poisoned row cannot wedge the sweep;
 * each transaction re-checks under a row lock (racing confirms lose or win
 * cleanly, never both). Buyout holds also revert their EXCLUSIVE sessions.
 * Returns the number of holds expired.
 */
export async function expireHolds(db: PrismaClient, { now }: ExpireHoldsInput): Promise<number> {
  const stale = await db.booking.findMany({
    where: { status: BookingStatus.HOLD, holdExpiresAt: { lt: now } },
    select: { id: true },
  })

  let expired = 0
  for (const { id: bookingId } of stale) {
    const didExpire = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT 1 FROM "bookings" WHERE "id" = ${bookingId} FOR UPDATE`
      const booking = await tx.booking.findUnique({ where: { id: bookingId } })
      // Re-check under the lock: a concurrent confirmHold may have won.
      if (
        !booking ||
        booking.status !== BookingStatus.HOLD ||
        !booking.holdExpiresAt ||
        booking.holdExpiresAt >= now
      ) {
        return false
      }

      await tx.booking.update({ where: { id: bookingId }, data: { status: BookingStatus.EXPIRED } })
      if (booking.type === BookingType.BUYOUT) {
        await releaseBuyout(tx, { bookingId })
      } else if (booking.sessionId !== null) {
        await releaseSeats(tx, { sessionId: booking.sessionId, seats: booking.seats })
      }
      return true
    })
    if (didExpire) expired++
  }
  return expired
}

export interface CancelBookingInput {
  bookingId: string
  reason: string
  /** Whether the seats go back on sale (late cancellations may keep them consumed). */
  releaseSeats: boolean
  /** Injectable clock for tests; defaults to wall time. */
  now?: Date
}

/**
 * CONFIRMED/HOLD -> CANCELLED, optionally releasing the seats (buyout-aware:
 * cancelling a buyout reverts its EXCLUSIVE sessions). Cancelling an
 * already-CANCELLED booking is an idempotent no-op.
 */
export async function cancelBooking(db: PrismaClient, input: CancelBookingInput): Promise<Booking> {
  const { bookingId, reason, releaseSeats: shouldRelease } = input
  const now = input.now ?? new Date()

  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT 1 FROM "bookings" WHERE "id" = ${bookingId} FOR UPDATE`
    const booking = await tx.booking.findUnique({ where: { id: bookingId } })
    if (!booking) throw new BookingNotFoundError(bookingId)

    if (booking.status === BookingStatus.CANCELLED) return booking
    if (booking.status !== BookingStatus.CONFIRMED && booking.status !== BookingStatus.HOLD) {
      throw new BookingStateError(bookingId, booking.status, 'cancel')
    }

    const cancelled = await tx.booking.update({
      where: { id: bookingId },
      data: {
        status: BookingStatus.CANCELLED,
        cancelledAt: now,
        cancellationReason: reason,
        holdExpiresAt: null,
      },
    })

    if (shouldRelease) {
      if (booking.type === BookingType.BUYOUT) {
        await releaseBuyout(tx, { bookingId })
      } else if (booking.sessionId !== null) {
        await releaseSeats(tx, { sessionId: booking.sessionId, seats: booking.seats })
      }
    }

    return cancelled
  })
}
