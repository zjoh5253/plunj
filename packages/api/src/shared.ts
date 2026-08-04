/**
 * Shared data helpers used by the routers and the webhook processor.
 */

import { CustomerKind, LocationStatus, WaiverKind, id } from '@plunj/db'
import type { Booking, Customer, Location, Prisma, PrismaClient, WaiverDocument } from '@plunj/db'
import { enqueueBookingLifecycle } from '@plunj/notifications'
import type { EnqueuedMessage, OutboxTx } from '@plunj/notifications'
import { TRPCError } from '@trpc/server'
import { formatSessionMoment, formatTimeOfDay } from './format.js'
import { normalizePhoneUS } from './phone.js'

export type DbClient = PrismaClient | Prisma.TransactionClient

const BASE_URL = 'https://plunj.co/book'

/**
 * Prisma's generic `outboxMessage.create` is not structurally assignable to
 * the narrow OutboxTx surface @plunj/notifications declares, even though it is
 * fully compatible at runtime — bridge the variance gap in one place.
 */
export function asOutboxTx(tx: DbClient): OutboxTx {
  return tx as unknown as OutboxTx
}

export function manageUrl(manageToken: string): string {
  return `${BASE_URL}/manage/${manageToken}`
}

export function waiverUrl(manageToken: string): string {
  return `${BASE_URL}/waiver/${manageToken}`
}

// ---------------------------------------------------------------------------
// Locations
// ---------------------------------------------------------------------------

/** Public-facing lookup: ACTIVE locations only. */
export async function activeLocationBySlug(db: DbClient, slug: string): Promise<Location> {
  const location = await db.location.findUnique({ where: { slug } })
  if (!location || location.status !== LocationStatus.ACTIVE) {
    throw new TRPCError({ code: 'NOT_FOUND', message: `No active location "${slug}"` })
  }
  return location
}

/** Staff-facing lookup: any status. */
export async function locationBySlug(db: DbClient, slug: string): Promise<Location> {
  const location = await db.location.findUnique({ where: { slug } })
  if (!location) {
    throw new TRPCError({ code: 'NOT_FOUND', message: `No location "${slug}"` })
  }
  return location
}

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

export interface CustomerNameInput {
  firstName: string
  lastName?: string | undefined
  phone: string
}

/** Normalize to canonical E.164 or reject — the shared guard for every phone entry point. */
export function requireNormalizedPhone(input: string): string {
  const phone = normalizePhoneUS(input)
  if (phone === null) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Please enter a valid US mobile number' })
  }
  return phone
}

/**
 * Find-or-create the customer for a guest checkout / walk-in by phone.
 * The phone is normalized to E.164 BEFORE lookup/create so "8018422358" and
 * "+18018422358" can never become two Customer rows. An ACCOUNT row with that
 * phone wins (the booking attaches to it — we never silently merge a guest
 * into an account, we just don't create a duplicate shadow row). Otherwise an
 * existing GUEST row is reused (name refreshed), else a new GUEST shadow
 * customer is created.
 */
export async function upsertCustomerByPhone(
  db: DbClient,
  input: CustomerNameInput,
): Promise<Customer> {
  const phone = requireNormalizedPhone(input.phone)
  const matches = await db.customer.findMany({ where: { phone } })
  const existing =
    matches.find((c) => c.kind === CustomerKind.ACCOUNT) ??
    matches.find((c) => c.kind === CustomerKind.GUEST) ??
    null
  if (existing) {
    if (existing.kind === CustomerKind.GUEST) {
      return db.customer.update({
        where: { id: existing.id },
        data: { firstName: input.firstName, lastName: input.lastName ?? existing.lastName },
      })
    }
    return existing
  }
  return db.customer.create({
    data: {
      id: id(),
      kind: CustomerKind.GUEST,
      firstName: input.firstName,
      lastName: input.lastName ?? null,
      phone,
    },
  })
}

// ---------------------------------------------------------------------------
// Waivers
// ---------------------------------------------------------------------------

/** The active, published document of a kind at a location (latest version). */
export async function currentWaiverDocument(
  db: DbClient,
  locationId: string,
  kind: WaiverKind = WaiverKind.LIABILITY,
): Promise<WaiverDocument | null> {
  return db.waiverDocument.findFirst({
    where: { locationId, kind, active: true, publishedAt: { not: null } },
    orderBy: { version: 'desc' },
  })
}

export type WaiverStatus = 'SIGNED' | 'UNSIGNED' | 'MINOR_UNVERIFIED'

/**
 * Waiver badge for one customer against the current liability document:
 * - their own signature on the current version → SIGNED
 * - only a guardian signature naming them as the minor → MINOR_UNVERIFIED
 * - nothing on the current version → UNSIGNED
 * No published document means there is nothing to sign → SIGNED.
 */
export async function waiverStatusFor(
  db: DbClient,
  locationId: string,
  customerId: string,
): Promise<WaiverStatus> {
  const doc = await currentWaiverDocument(db, locationId)
  if (!doc) return 'SIGNED'
  const own = await db.waiverSignature.findFirst({
    where: { waiverDocumentId: doc.id, customerId, minorCustomerId: null },
  })
  if (own) return 'SIGNED'
  const asMinor = await db.waiverSignature.findFirst({
    where: { waiverDocumentId: doc.id, minorCustomerId: customerId },
  })
  if (asMinor) return 'MINOR_UNVERIFIED'
  return 'UNSIGNED'
}

// ---------------------------------------------------------------------------
// Booking lifecycle notifications
// ---------------------------------------------------------------------------

export interface LifecycleArgs {
  booking: Booking
  customer: Customer
  location: Location
  /** Whether the customer still needs to sign the current waiver. */
  unsigned: boolean
  now: Date
}

/**
 * Enqueue the confirmation + reminder outbox rows for a just-confirmed
 * booking. MUST run inside the same transaction as the state change
 * (CLAUDE.md invariant #8).
 */
export async function enqueueLifecycleForBooking(
  tx: DbClient,
  args: LifecycleArgs,
): Promise<EnqueuedMessage[]> {
  const { booking, customer, location, unsigned, now } = args
  const dateTimeLocal = formatSessionMoment(booking.startsAt, location.timezone)
  const waiver = unsigned ? { waiverUrl: waiverUrl(booking.manageToken) } : {}
  return enqueueBookingLifecycle(asOutboxTx(tx), {
    smsRecipient: customer.phone,
    ...(customer.email !== null ? { emailRecipient: customer.email } : {}),
    locationId: location.id,
    sessionStartsAt: booking.startsAt,
    now,
    confirmed: {
      firstName: customer.firstName,
      locationName: location.name,
      dateTimeLocal,
      seats: booking.seats,
      manageUrl: manageUrl(booking.manageToken),
      ...waiver,
    },
    reminder24h: {
      firstName: customer.firstName,
      locationName: location.name,
      dateTimeLocal,
      unsignedCount: unsigned ? 1 : 0,
      ...waiver,
    },
    reminder2h: {
      firstName: customer.firstName,
      locationName: location.name,
      timeLocal: formatTimeOfDay(booking.startsAt, location.timezone),
    },
  })
}
