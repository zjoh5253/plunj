/**
 * Type-only projections of the desk router wire shapes (Dates are ISO strings
 * on the wire). Mirrors src/lib/api-types.ts, which is shared surface and
 * therefore not modified.
 */

import type { AppRouter } from '@plunj/api'
import type { inferRouterOutputs } from '@trpc/server'

export type RouterOutputs = inferRouterOutputs<AppRouter>

export type RosterToday = RouterOutputs['desk']['roster']['today']
export type RosterSession = RosterToday['sessions'][number]
export type RosterBooking = RosterSession['bookings'][number]
export type CustomerHit = RouterOutputs['desk']['customers']['search'][number]
export type WalkInResult = RouterOutputs['desk']['walkIn']['create']
export type CheckInResult = RouterOutputs['desk']['checkIn']

/**
 * Response of the desk-only booking lookup route handler
 * (src/app/desk/api/booking/[bookingId]/route.ts). Exists because the roster
 * payload does not expose orderId / customerId / manageToken, which the
 * refund, credit, and move-guest flows need.
 */
export interface BookingLookup {
  bookingId: string
  customerId: string
  manageToken: string | null
  order: {
    orderId: string
    status: string
    totalCents: number
    refundedCents: number
    refundableCents: number
  } | null
}

export async function fetchBookingLookup(bookingId: string): Promise<BookingLookup> {
  const res = await fetch(`/book/desk/api/booking/${encodeURIComponent(bookingId)}`, {
    credentials: 'same-origin',
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null
    const err = new Error(body?.message ?? `Lookup failed (${res.status})`) as Error & {
      data?: { code?: string }
    }
    if (res.status === 401) err.data = { code: 'UNAUTHORIZED' }
    throw err
  }
  return (await res.json()) as BookingLookup
}
