/**
 * THE single server-authoritative quote builder (CLAUDE.md invariant #1).
 *
 * Customer checkout, desk POS, and admin discount preview all call buildQuote —
 * one code path, one number. This module does NO money arithmetic beyond
 * assembling a QuoteInput for @plunj/money; every cent that appears here was
 * either loaded from the database or computed by the pricing kernel.
 */

import { StudioKind } from '@plunj/db'
import type {
  DiscountAppliesTo,
  DiscountCode,
  DiscountType,
  PrismaClient,
  Session,
} from '@plunj/db'
import { quote } from '@plunj/money'
import type { DiscountInput, Quote, QuoteLineInput } from '@plunj/money'
import { formatCents } from '@plunj/notifications'
import { formatSessionMoment } from './format.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CheckoutItemInput =
  | { kind: 'DROP_IN'; sessionId: string; seats: number }
  | { kind: 'BUYOUT'; buyoutOptionId: string; sessionIds: string[] }

export type DiscountRejectionReason =
  | 'EXPIRED'
  | 'NOT_YET_ACTIVE'
  | 'EXHAUSTED'
  | 'PER_CUSTOMER_LIMIT'
  | 'MIN_SUBTOTAL'
  | 'SCOPE_MISMATCH'
  | 'UNKNOWN_CODE'
  | 'INACTIVE'

/** Structured discount rejection — never a bare "invalid". */
export class DiscountRejectedError extends Error {
  readonly reason: DiscountRejectionReason

  constructor(reason: DiscountRejectionReason, message: string) {
    super(message)
    this.name = 'DiscountRejectedError'
    this.reason = reason
  }
}

/** A not-yet-saved discount for admin preview — same validation + quote path as a stored code. */
export interface DraftDiscountInput {
  code: string
  type: DiscountType
  valueBps?: number | null
  valueCents?: number | null
  appliesTo: DiscountAppliesTo
  maxRedemptions?: number | null
  maxPerCustomer?: number | null
  minSubtotalCents?: number | null
  startsAt?: Date | null
  endsAt?: Date | null
  active?: boolean
}

export interface BuildQuoteInput {
  locationId: string
  items: CheckoutItemInput[]
  discountCode?: string
  /** Used instead of a DB lookup when previewing an unsaved code (admin). */
  draftDiscount?: DraftDiscountInput
  tipCents?: number
  customerId?: string
  /** Clock for discount window checks; defaults to wall time. */
  now?: Date
}

export interface BuildQuoteSuccess {
  ok: true
  quote: Quote
  discountDescription: string | null
  /** DiscountCode row id when a stored code applied; null for drafts / no code. */
  discountCodeId: string | null
}

export interface BuildQuoteFailure {
  ok: false
  reason: DiscountRejectionReason
  message: string
}

export type BuildQuoteResult = BuildQuoteSuccess | BuildQuoteFailure

/** The wire shape shared by checkout.quote and admin discounts.preview. */
export type QuoteResponse =
  { ok: true; quote: Quote; discountDescription: string | null } | BuildQuoteFailure

export function toQuoteResponse(result: BuildQuoteResult): QuoteResponse {
  if (!result.ok) return result
  return { ok: true, quote: result.quote, discountDescription: result.discountDescription }
}

// ---------------------------------------------------------------------------
// Discount resolution
// ---------------------------------------------------------------------------

interface ResolvedDiscount {
  id: string | null
  code: string
  type: DiscountType
  valueBps: number | null
  valueCents: number | null
  appliesTo: DiscountAppliesTo
  maxRedemptions: number | null
  maxPerCustomer: number | null
  minSubtotalCents: number | null
  startsAt: Date | null
  endsAt: Date | null
  active: boolean
}

function fromRow(row: DiscountCode): ResolvedDiscount {
  return {
    id: row.id,
    code: row.code,
    type: row.type,
    valueBps: row.valueBps,
    valueCents: row.valueCents,
    appliesTo: row.appliesTo,
    maxRedemptions: row.maxRedemptions,
    maxPerCustomer: row.maxPerCustomer,
    minSubtotalCents: row.minSubtotalCents,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    active: row.active,
  }
}

function fromDraft(draft: DraftDiscountInput): ResolvedDiscount {
  return {
    id: null,
    code: draft.code,
    type: draft.type,
    valueBps: draft.valueBps ?? null,
    valueCents: draft.valueCents ?? null,
    appliesTo: draft.appliesTo,
    maxRedemptions: draft.maxRedemptions ?? null,
    maxPerCustomer: draft.maxPerCustomer ?? null,
    minSubtotalCents: draft.minSubtotalCents ?? null,
    startsAt: draft.startsAt ?? null,
    endsAt: draft.endsAt ?? null,
    active: draft.active ?? true,
  }
}

/** Case-insensitive, location-scoped lookup falling back to brand-wide (locationId null). */
async function lookupDiscountCode(
  db: PrismaClient,
  locationId: string,
  code: string,
): Promise<DiscountCode | null> {
  const scoped = await db.discountCode.findFirst({
    where: { locationId, code: { equals: code, mode: 'insensitive' } },
  })
  if (scoped) return scoped
  return db.discountCode.findFirst({
    where: { locationId: null, code: { equals: code, mode: 'insensitive' } },
  })
}

function lineEligible(kind: 'DROP_IN' | 'BUYOUT', appliesTo: DiscountAppliesTo): boolean {
  switch (appliesTo) {
    case 'ALL':
      return true
    case 'DROP_IN':
      return kind === 'DROP_IN'
    case 'BUYOUT':
      return kind === 'BUYOUT'
    default:
      // MEMBERSHIP_FIRST_CYCLE / PACK — not sellable through this cart in v1.
      return false
  }
}

function scopeMessage(appliesTo: DiscountAppliesTo): string {
  switch (appliesTo) {
    case 'BUYOUT':
      return 'This code is for private buyouts only.'
    case 'DROP_IN':
      return 'This code is for drop-in sessions only.'
    case 'MEMBERSHIP_FIRST_CYCLE':
      return 'This code is for new memberships only.'
    case 'PACK':
      return 'This code is for session packs only.'
    default:
      return "This code doesn't apply to anything in your cart."
  }
}

// ---------------------------------------------------------------------------
// buildQuote
// ---------------------------------------------------------------------------

function sessionLabel(kind: StudioKind): string {
  return kind === StudioKind.MOBILE_SAUNA ? 'Sauna Session' : 'Contrast Session'
}

export async function buildQuote(
  db: PrismaClient,
  input: BuildQuoteInput,
): Promise<BuildQuoteResult> {
  const now = input.now ?? new Date()

  const location = await db.location.findUnique({ where: { id: input.locationId } })
  if (!location) throw new Error(`Location ${input.locationId} not found`)

  // 1. Snapshot prices + descriptions from the database.
  interface PendingLine {
    id: string
    kind: 'DROP_IN' | 'BUYOUT'
    description: string
    qty: number
    unitPriceCents: number
  }
  const pending: PendingLine[] = []

  for (const item of input.items) {
    if (item.kind === 'DROP_IN') {
      const session = await db.session.findUnique({
        where: { id: item.sessionId },
        include: { studio: true },
      })
      if (!session || session.locationId !== location.id) {
        throw new Error(`Session ${item.sessionId} not found at this location`)
      }
      pending.push({
        id: session.id,
        kind: 'DROP_IN',
        description: `${sessionLabel(session.studio.kind)} — ${formatSessionMoment(session.startsAt, location.timezone)}`,
        qty: item.seats,
        unitPriceCents: session.priceCents,
      })
    } else {
      const option = await db.buyoutOption.findUnique({ where: { id: item.buyoutOptionId } })
      if (!option || option.locationId !== location.id) {
        throw new Error(`Buyout option ${item.buyoutOptionId} not found at this location`)
      }
      const sessions: Session[] = await db.session.findMany({
        where: { id: { in: item.sessionIds } },
        orderBy: { startsAt: 'asc' },
      })
      const first = sessions[0]
      if (sessions.length !== item.sessionIds.length || !first) {
        throw new Error('One or more buyout sessions were not found')
      }
      if (sessions.some((s) => s.locationId !== location.id)) {
        throw new Error('Buyout sessions must belong to this location')
      }
      pending.push({
        id: option.id,
        kind: 'BUYOUT',
        description: `Private Buyout (${option.durationHours}h) — ${formatSessionMoment(first.startsAt, location.timezone)}`,
        qty: 1,
        unitPriceCents: option.priceCents,
      })
    }
  }

  // 2. Resolve the discount code (case-insensitive, location-scoped then brand-wide).
  let resolved: ResolvedDiscount | null = null
  if (input.draftDiscount !== undefined) {
    resolved = fromDraft(input.draftDiscount)
  } else if (input.discountCode !== undefined) {
    const row = await lookupDiscountCode(db, location.id, input.discountCode)
    if (!row) {
      return { ok: false, reason: 'UNKNOWN_CODE', message: "We don't recognize that code." }
    }
    resolved = fromRow(row)
  }

  const lines: QuoteLineInput[] = pending.map((line) => ({
    id: line.id,
    kind: line.kind,
    description: line.description,
    qty: line.qty,
    unitPriceCents: line.unitPriceCents,
    taxable: true,
    discountEligible: resolved ? lineEligible(line.kind, resolved.appliesTo) : true,
  }))

  const tipSpread = input.tipCents !== undefined ? { tipCents: input.tipCents } : {}

  // Base quote (kernel-computed subtotal — no arithmetic here).
  const base = quote({ lines, taxRateBps: location.taxRateBps, ...tipSpread })

  // 3. Validate the code; every rejection carries a structured reason + human message.
  if (resolved) {
    if (!resolved.active) {
      return { ok: false, reason: 'INACTIVE', message: 'This code is no longer active.' }
    }
    if (resolved.startsAt && resolved.startsAt.getTime() > now.getTime()) {
      return { ok: false, reason: 'NOT_YET_ACTIVE', message: "This code isn't active yet." }
    }
    if (resolved.endsAt && resolved.endsAt.getTime() < now.getTime()) {
      return { ok: false, reason: 'EXPIRED', message: 'This code has expired.' }
    }
    if (resolved.minSubtotalCents !== null && base.subtotalCents < resolved.minSubtotalCents) {
      return {
        ok: false,
        reason: 'MIN_SUBTOTAL',
        message: `This code requires a minimum purchase of ${formatCents(resolved.minSubtotalCents)}.`,
      }
    }
    if (resolved.id !== null && resolved.maxRedemptions !== null) {
      const used = await db.discountRedemption.count({
        where: { discountCodeId: resolved.id },
      })
      if (used >= resolved.maxRedemptions) {
        return {
          ok: false,
          reason: 'EXHAUSTED',
          message: 'This code has reached its redemption limit.',
        }
      }
    }
    // maxPerCustomer needs a customer — for anonymous quotes we still allow;
    // checkout.start passes customerId, so the limit is enforced at confirm.
    if (resolved.id !== null && resolved.maxPerCustomer !== null && input.customerId) {
      const used = await db.discountRedemption.count({
        where: { discountCodeId: resolved.id, customerId: input.customerId },
      })
      if (used >= resolved.maxPerCustomer) {
        return {
          ok: false,
          reason: 'PER_CUSTOMER_LIMIT',
          message: "You've already used this code the maximum number of times.",
        }
      }
    }
    if (!lines.some((l) => l.discountEligible)) {
      return { ok: false, reason: 'SCOPE_MISMATCH', message: scopeMessage(resolved.appliesTo) }
    }
  }

  // 4. Final quote via the pricing kernel.
  if (!resolved) {
    return { ok: true, quote: base, discountDescription: null, discountCodeId: null }
  }

  const discount: DiscountInput = {
    id: resolved.id ?? `draft:${resolved.code}`,
    code: resolved.code,
    type: resolved.type,
    ...(resolved.valueBps !== null ? { valueBps: resolved.valueBps } : {}),
    ...(resolved.valueCents !== null ? { valueCents: resolved.valueCents } : {}),
  }
  const final = quote({ lines, discount, taxRateBps: location.taxRateBps, ...tipSpread })
  return {
    ok: true,
    quote: final,
    discountDescription: final.discountDescription,
    discountCodeId: resolved.id,
  }
}
