/**
 * Type-only projections of the AppRouter wire shapes (Dates are ISO strings on
 * the wire — the router serializes them explicitly, no transformer).
 */

import type { AppRouter } from '@plunj/api'
import type { inferRouterOutputs } from '@trpc/server'

export type RouterOutputs = inferRouterOutputs<AppRouter>

export type LocationSummary = RouterOutputs['public']['locations']['list'][number]
export type LocationDetail = RouterOutputs['public']['locations']['bySlug']
export type AvailabilityDay = RouterOutputs['public']['availability']['list'][number]
export type AvailabilitySlot = AvailabilityDay['sessions'][number]
export type BuyoutOption = RouterOutputs['public']['buyouts']['options'][number]
export type BuyoutWindow = RouterOutputs['public']['buyouts']['windows'][number]
export type QuoteResult = RouterOutputs['public']['checkout']['quote']
/** The kernel-computed quote object inside a successful quote response. */
export type ServerQuote = Extract<QuoteResult, { ok: true }>['quote']
export type CheckoutStartResult = RouterOutputs['public']['checkout']['start']
export type ManageBooking = RouterOutputs['public']['manage']['get']
export type WaiverDoc = RouterOutputs['public']['waivers']['current']

/** Checkout cart item, mirrored from the router's input schema. */
export type CheckoutItem =
  | { kind: 'DROP_IN'; sessionId: string; seats: number }
  | { kind: 'BUYOUT'; buyoutOptionId: string; sessionIds: string[] }

/** Structured domain-error payload attached by the API's error formatter. */
export interface DomainErrorShape {
  domainCode?:
    'SOLD_OUT' | 'HOLD_EXPIRED' | 'BUYOUT_UNAVAILABLE' | 'DISCOUNT_REJECTED' | 'WAIVER_UNSIGNED'
  reason?: string
  message?: string
}

/** Best-effort extraction of the domain error payload from a caught error. */
export function domainError(err: unknown): DomainErrorShape & { messageText: string } {
  const anyErr = err as {
    message?: string
    data?: DomainErrorShape | null
  } | null
  const data = anyErr?.data ?? {}
  return {
    ...data,
    messageText: data.message ?? anyErr?.message ?? 'Something went wrong. Please try again.',
  }
}
