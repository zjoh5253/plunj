/**
 * @plunj/availability — session generation + capacity/hold/buyout engine.
 *
 * Owns CLAUDE.md invariants:
 * #3 overbooking impossible at the DB level (conditional UPDATE + CHECK),
 * #4 buyouts and communal share one source of truth (EXCLUSIVE sessions),
 * #5 templates store local wall time, converted per-date to UTC at generation.
 *
 * Every function takes a PrismaClient (or Prisma.TransactionClient for the
 * primitives that must run inside a caller's transaction) as its first
 * argument — this package holds no module-level database state.
 */

export {
  BookingNotFoundError,
  BookingStateError,
  BuyoutUnavailableError,
  HoldExpiredError,
  SoldOutError,
} from './errors.js'

export { applyTemplateChanges, generateSessions } from './generate.js'
export type {
  ApplyTemplateChangesInput,
  ApplyTemplateChangesResult,
  GenerateSessionsInput,
  GenerateSessionsResult,
} from './generate.js'

export {
  cancelBooking,
  confirmHold,
  createHold,
  expireHolds,
  releaseSeats,
  tryReserveSeats,
} from './capacity.js'
export type {
  CancelBookingInput,
  ConfirmHoldInput,
  CreateHoldInput,
  DbClient,
  ExpireHoldsInput,
  SeatOpInput,
} from './capacity.js'

export { claimBuyout, findBuyoutWindows, reclaimBuyoutSessions, releaseBuyout } from './buyout.js'
export type {
  BuyoutWindow,
  ClaimBuyoutInput,
  FindBuyoutWindowsInput,
  ReleaseBuyoutInput,
} from './buyout.js'

export { listAvailability } from './query.js'
export type { AvailabilityDay, AvailableSession, ListAvailabilityInput } from './query.js'
