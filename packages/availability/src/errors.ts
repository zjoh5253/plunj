/**
 * Typed errors thrown by the availability/capacity engine. Callers (tRPC
 * routers, cron jobs) branch on `instanceof` to map these to user-facing
 * responses.
 */

/** The conditional seat reservation matched no row: session full, not OPEN, or missing. */
export class SoldOutError extends Error {
  readonly sessionId: string

  constructor(sessionId: string, seats: number) {
    super(`Session ${sessionId} cannot accommodate ${seats} more seat(s)`)
    this.name = 'SoldOutError'
    this.sessionId = sessionId
  }
}

/** A hold expired, its seats were re-sold, and re-reservation failed. */
export class HoldExpiredError extends Error {
  readonly bookingId: string

  constructor(bookingId: string) {
    super(`Hold ${bookingId} has expired and its seats could not be re-reserved`)
    this.name = 'HoldExpiredError'
    this.bookingId = bookingId
  }
}

/** A buyout claim failed. `conflictingSessionIds` lists the sessions that blocked it. */
export class BuyoutUnavailableError extends Error {
  readonly conflictingSessionIds: string[]

  constructor(conflictingSessionIds: string[], detail?: string) {
    super(
      `Buyout unavailable${detail ? ` (${detail})` : ''}: ` +
        `conflicting sessions [${conflictingSessionIds.join(', ')}]`,
    )
    this.name = 'BuyoutUnavailableError'
    this.conflictingSessionIds = conflictingSessionIds
  }
}

/** Referenced booking row does not exist. */
export class BookingNotFoundError extends Error {
  readonly bookingId: string

  constructor(bookingId: string) {
    super(`Booking ${bookingId} not found`)
    this.name = 'BookingNotFoundError'
    this.bookingId = bookingId
  }
}

/** A state transition was requested from a status that does not allow it. */
export class BookingStateError extends Error {
  readonly bookingId: string
  readonly status: string

  constructor(bookingId: string, status: string, attempted: string) {
    super(`Booking ${bookingId} is ${status}; cannot ${attempted}`)
    this.name = 'BookingStateError'
    this.bookingId = bookingId
    this.status = status
  }
}
