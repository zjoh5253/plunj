import { PrismaPg } from '@prisma/adapter-pg'
import {
  BookingProvider,
  CustomerKind,
  LocationStatus,
  OrderChannel,
  PrismaClient,
  SessionStatus,
  StaffRoleKind,
  StudioKind,
  WaiverKind,
  id,
} from '@plunj/db'
import type {
  Customer,
  DiscountCode,
  Location,
  Order,
  Session,
  StaffUser,
  Studio,
  WaiverDocument,
} from '@plunj/db'
import { FakeSmsSender } from '@plunj/notifications'
import { FakePaymentProvider } from '@plunj/payments'
import type { NormalizedWebhookEvent } from '@plunj/payments'
import { createCaller, createContext, hashStaffPin } from '../src/index.js'
import { DATABASE_URL } from './pgserver.js'

export const STAFF_PIN = '4321'

export function createClient(): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL }) })
}

// ---------------------------------------------------------------------------
// Test env + callers
// ---------------------------------------------------------------------------

export interface TestEnv {
  db: PrismaClient
  payments: FakePaymentProvider
  sms: FakeSmsSender
}

export function newEnv(db: PrismaClient): TestEnv {
  return { db, payments: new FakePaymentProvider(), sms: new FakeSmsSender() }
}

/**
 * Each test's FakePaymentProvider restarts its event counter at fake_evt_1,
 * but WebhookEvent rows (unique providerEventId) persist in the shared test
 * database — give every fabricated event a globally unique id.
 */
export function uniquifyEvent(event: NormalizedWebhookEvent): NormalizedWebhookEvent {
  return { ...event, providerEventId: `${event.providerEventId}-${id()}` }
}

export async function callerFor(
  env: TestEnv,
  opts: { authUserId?: string; now?: () => Date } = {},
): Promise<ReturnType<typeof createCaller>> {
  const ctx = await createContext({
    db: env.db,
    payments: env.payments,
    sms: env.sms,
    ...(opts.authUserId !== undefined ? { authUserId: opts.authUserId } : {}),
    ...(opts.now !== undefined ? { now: opts.now } : {}),
  })
  return createCaller(ctx)
}

// ---------------------------------------------------------------------------
// Seeds
// ---------------------------------------------------------------------------

/** Globally unique E.164-ish phone — test files each get a fresh module graph,
 * so a plain counter would collide across files sharing one database. */
export function uniquePhone(): string {
  const digits = String(Math.floor(Math.random() * 1e10)).padStart(10, '0')
  return `+1${digits}`
}

export function daysFromNow(days: number, base = new Date()): Date {
  const d = new Date(base.getTime() + days * 24 * 60 * 60 * 1000)
  d.setUTCMinutes(0, 0, 0)
  return d
}

export async function seedLocation(
  db: PrismaClient,
  options: { taxRateBps?: number; timezone?: string; defaultCapacity?: number } = {},
): Promise<{ location: Location; studio: Studio }> {
  const org = await db.organization.create({ data: { id: id(), name: 'PLUNJ Test Org' } })
  const location = await db.location.create({
    data: {
      id: id(),
      orgId: org.id,
      slug: `test-${id()}`,
      name: 'PLUNJ Test Location',
      timezone: options.timezone ?? 'America/Denver',
      address1: '123 Cold Plunge Way',
      city: 'Provo',
      state: 'UT',
      postalCode: '84601',
      phone: '+13855550100',
      email: 'test@plunj.co',
      status: LocationStatus.ACTIVE,
      taxRateBps: options.taxRateBps ?? 725,
      bookingProvider: BookingProvider.INTERNAL,
      stripeAccountId: `acct_${id().slice(0, 8)}`,
    },
  })
  const studio = await db.studio.create({
    data: {
      id: id(),
      locationId: location.id,
      name: 'Suite A',
      kind: StudioKind.CONTRAST_SUITE,
      defaultCapacity: options.defaultCapacity ?? 8,
    },
  })
  return { location, studio }
}

export async function seedSession(
  db: PrismaClient,
  studio: Studio,
  options: {
    startsAt: Date
    durationMin?: number
    capacity?: number
    bookedSeats?: number
    status?: SessionStatus
    priceCents?: number
  },
): Promise<Session> {
  const durationMin = options.durationMin ?? 60
  return db.session.create({
    data: {
      id: id(),
      studioId: studio.id,
      locationId: studio.locationId,
      startsAt: options.startsAt,
      endsAt: new Date(options.startsAt.getTime() + durationMin * 60_000),
      capacity: options.capacity ?? 8,
      bookedSeats: options.bookedSeats ?? 0,
      status: options.status ?? SessionStatus.OPEN,
      priceCents: options.priceCents ?? 4500,
    },
  })
}

export async function seedStaff(
  db: PrismaClient,
  options: { role: StaffRoleKind; locationId: string | null; pin?: string | null },
): Promise<{ staffUser: StaffUser; authUserId: string }> {
  const authUserId = `auth-${id()}`
  const staffUser = await db.staffUser.create({
    data: {
      id: id(),
      name: 'Test Staffer',
      email: `staff-${id()}@plunj.co`,
      authUserId,
      pin: options.pin === null ? null : hashStaffPin(options.pin ?? STAFF_PIN),
    },
  })
  await db.staffRole.create({
    data: {
      id: id(),
      staffUserId: staffUser.id,
      role: options.role,
      locationId: options.locationId,
    },
  })
  return { staffUser, authUserId }
}

export async function seedCustomer(
  db: PrismaClient,
  options: { firstName?: string; phone?: string } = {},
): Promise<Customer> {
  return db.customer.create({
    data: {
      id: id(),
      kind: CustomerKind.GUEST,
      firstName: options.firstName ?? 'Test',
      lastName: 'Customer',
      phone: options.phone ?? uniquePhone(),
    },
  })
}

export async function seedDiscount(
  db: PrismaClient,
  options: {
    locationId: string | null
    code: string
    type?: 'PERCENT' | 'FIXED_CENTS'
    valueBps?: number
    valueCents?: number
    appliesTo?: 'ALL' | 'DROP_IN' | 'BUYOUT' | 'MEMBERSHIP_FIRST_CYCLE' | 'PACK'
    maxRedemptions?: number
    maxPerCustomer?: number
    minSubtotalCents?: number
    startsAt?: Date
    endsAt?: Date
    active?: boolean
  },
): Promise<DiscountCode> {
  const type = options.type ?? 'PERCENT'
  return db.discountCode.create({
    data: {
      id: id(),
      locationId: options.locationId,
      code: options.code,
      type,
      valueBps: type === 'PERCENT' ? (options.valueBps ?? 2000) : null,
      valueCents: type === 'FIXED_CENTS' ? (options.valueCents ?? 500) : null,
      appliesTo: options.appliesTo ?? 'ALL',
      maxRedemptions: options.maxRedemptions ?? null,
      maxPerCustomer: options.maxPerCustomer ?? null,
      minSubtotalCents: options.minSubtotalCents ?? null,
      startsAt: options.startsAt ?? null,
      endsAt: options.endsAt ?? null,
      active: options.active ?? true,
    },
  })
}

/** Minimal PAID/PENDING order for FK targets (e.g. seeding redemptions). */
export async function seedOrder(db: PrismaClient, location: Location): Promise<Order> {
  return db.order.create({
    data: {
      id: id(),
      locationId: location.id,
      channel: OrderChannel.WEB,
      subtotalCents: 4500,
      discountCents: 0,
      taxCents: 0,
      tipCents: 0,
      totalCents: 4500,
      pricingVersion: 'v1',
    },
  })
}

export async function seedWaiverDoc(
  db: PrismaClient,
  locationId: string,
  options: { version?: number; kind?: WaiverKind } = {},
): Promise<WaiverDocument> {
  return db.waiverDocument.create({
    data: {
      id: id(),
      locationId,
      kind: options.kind ?? WaiverKind.LIABILITY,
      version: options.version ?? 1,
      title: 'Liability Waiver',
      bodyMarkdown: '# You plunge at your own risk',
      contentSha256: 'a'.repeat(64),
      publishedAt: new Date(),
      active: true,
    },
  })
}

export async function signWaiver(
  db: PrismaClient,
  options: {
    customerId: string
    locationId: string
    waiverDocumentId: string
    minorCustomerId?: string
  },
): Promise<void> {
  await db.waiverSignature.create({
    data: {
      id: id(),
      customerId: options.customerId,
      locationId: options.locationId,
      waiverDocumentId: options.waiverDocumentId,
      signedAt: new Date(),
      signatureKind: 'TYPED',
      typedName: 'Test Customer',
      minorCustomerId: options.minorCustomerId ?? null,
      ...(options.minorCustomerId
        ? { guardianName: 'Guard Ian', guardianRelationship: 'parent' }
        : {}),
    },
  })
}
