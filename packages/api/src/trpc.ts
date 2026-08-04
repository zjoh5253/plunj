/**
 * tRPC initialization: plain-JSON wire format (no transformer — every Date in
 * a router output is serialized to an ISO string explicitly, so what the type
 * says is what crosses the wire), a domain-error formatter, and the procedure
 * builders (public / staff-with-role / corporate).
 */

import { BuyoutUnavailableError, HoldExpiredError, SoldOutError } from '@plunj/availability'
import { StaffRoleKind } from '@plunj/db'
import { TRPCError, initTRPC } from '@trpc/server'
import type { Context } from './context.js'
import { WaiverUnsignedError } from './errors.js'
import { DiscountRejectedError } from './pricing.js'

// ---------------------------------------------------------------------------
// Error mapping
// ---------------------------------------------------------------------------

export type DomainErrorCode =
  'SOLD_OUT' | 'HOLD_EXPIRED' | 'BUYOUT_UNAVAILABLE' | 'DISCOUNT_REJECTED' | 'WAIVER_UNSIGNED'

export interface DomainErrorData {
  domainCode?: DomainErrorCode
  conflictingSessionIds?: string[]
  /** DiscountRejectedError only: structured { reason, message }. */
  reason?: string
  message?: string
}

const t = initTRPC.context<Context>().create({
  errorFormatter({ shape, error }) {
    const cause = error.cause
    const extra: DomainErrorData = {}
    if (cause instanceof SoldOutError) {
      extra.domainCode = 'SOLD_OUT'
    } else if (cause instanceof HoldExpiredError) {
      extra.domainCode = 'HOLD_EXPIRED'
    } else if (cause instanceof BuyoutUnavailableError) {
      extra.domainCode = 'BUYOUT_UNAVAILABLE'
      extra.conflictingSessionIds = cause.conflictingSessionIds
    } else if (cause instanceof DiscountRejectedError) {
      extra.domainCode = 'DISCOUNT_REJECTED'
      extra.reason = cause.reason
      extra.message = cause.message
    } else if (cause instanceof WaiverUnsignedError) {
      extra.domainCode = 'WAIVER_UNSIGNED'
    }
    return { ...shape, data: { ...shape.data, ...extra } }
  },
})

/** Remap known domain errors to their transport codes (CONFLICT / BAD_REQUEST). */
function remapDomainError(error: TRPCError): TRPCError {
  if (error.code !== 'INTERNAL_SERVER_ERROR') return error
  const cause = error.cause
  if (
    cause instanceof SoldOutError ||
    cause instanceof HoldExpiredError ||
    cause instanceof BuyoutUnavailableError ||
    cause instanceof WaiverUnsignedError
  ) {
    return new TRPCError({ code: 'CONFLICT', message: cause.message, cause })
  }
  if (cause instanceof DiscountRejectedError) {
    return new TRPCError({ code: 'BAD_REQUEST', message: cause.message, cause })
  }
  return error
}

const domainErrors = t.middleware(async ({ next }) => {
  const result = await next()
  if (!result.ok) {
    throw remapDomainError(result.error)
  }
  return result
})

// ---------------------------------------------------------------------------
// Procedures
// ---------------------------------------------------------------------------

export const router = t.router
export const createCallerFactory = t.createCallerFactory
export const publicProcedure = t.procedure.use(domainErrors)

const ROLE_RANK: Record<StaffRoleKind, number> = {
  [StaffRoleKind.FRONT_DESK]: 1,
  [StaffRoleKind.LOCATION_ADMIN]: 2,
  [StaffRoleKind.LOCATION_OWNER]: 3,
  [StaffRoleKind.CORPORATE_ADMIN]: 4,
}

/**
 * Staff-only procedure with per-location role enforcement. The location is not
 * known until input is resolved, so the middleware authenticates the staff
 * user and provides `ctx.assertLocationRole(locationId)`, which every staff
 * resolver MUST call once it has resolved its target location.
 *
 * CORPORATE_ADMIN (org-wide role row, locationId null) passes everywhere;
 * otherwise the staff user needs a role at that exact location ranking at or
 * above `minRole` (LOCATION_OWNER > LOCATION_ADMIN > FRONT_DESK).
 */
export function staffProcedure(minRole: StaffRoleKind) {
  return publicProcedure.use(({ ctx, next }) => {
    const staff = ctx.staff
    if (!staff) {
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Staff sign-in required' })
    }
    const isCorporate = staff.roles.some(
      (r) => r.role === StaffRoleKind.CORPORATE_ADMIN && r.locationId === null,
    )
    const assertLocationRole = (locationId: string): void => {
      if (isCorporate) return
      const allowed = staff.roles.some(
        (r) => r.locationId === locationId && ROLE_RANK[r.role] >= ROLE_RANK[minRole],
      )
      if (!allowed) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: `This action requires ${minRole} access at this location`,
        })
      }
    }
    return next({ ctx: { ...ctx, staff, assertLocationRole } })
  })
}

/** Org-wide procedures: CORPORATE_ADMIN only. */
export const corporateProcedure = publicProcedure.use(({ ctx, next }) => {
  const staff = ctx.staff
  if (!staff) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Staff sign-in required' })
  }
  const isCorporate = staff.roles.some(
    (r) => r.role === StaffRoleKind.CORPORATE_ADMIN && r.locationId === null,
  )
  if (!isCorporate) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Corporate admin access required' })
  }
  return next({ ctx: { ...ctx, staff } })
})
