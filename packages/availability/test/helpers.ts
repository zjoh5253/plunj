import { PrismaPg } from '@prisma/adapter-pg'
import { id, CustomerKind, OrderChannel, PrismaClient, SessionStatus, StudioKind } from '@plunj/db'
import type { Customer, Location, Order, Session, SessionTemplate, Studio } from '@plunj/db'
import { DATABASE_URL } from './pgserver.js'

/** A dedicated connection — concurrency tests open several of these. */
export function createClient(): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL }) })
}

export interface SeedLocationOptions {
  timezone?: string
  bookingWindowDays?: number
  defaultCapacity?: number
}

export async function seedLocation(
  db: PrismaClient,
  options: SeedLocationOptions = {},
): Promise<{ location: Location; studio: Studio }> {
  const { timezone = 'America/Denver', bookingWindowDays = 35, defaultCapacity = 8 } = options

  const org = await db.organization.create({ data: { id: id(), name: 'PLUNJ Test Org' } })
  const location = await db.location.create({
    data: {
      id: id(),
      orgId: org.id,
      slug: `test-${id()}`,
      name: 'PLUNJ Test Location',
      timezone,
      address1: '123 Cold Plunge Way',
      city: 'Provo',
      state: 'UT',
      postalCode: '84601',
      phone: '+13855550100',
      email: 'test@plunj.co',
      taxRateBps: 725,
      bookingWindowDays,
    },
  })
  const studio = await db.studio.create({
    data: {
      id: id(),
      locationId: location.id,
      name: 'Suite A',
      kind: StudioKind.CONTRAST_SUITE,
      defaultCapacity,
    },
  })
  return { location, studio }
}

export interface SeedTemplateOptions {
  dayOfWeek: number
  startTimeLocal: string
  durationMin?: number
  capacity?: number | null
  priceCents?: number
  effectiveFrom?: Date
  effectiveUntil?: Date | null
  active?: boolean
}

export async function seedTemplate(
  db: PrismaClient,
  studio: Studio,
  options: SeedTemplateOptions,
): Promise<SessionTemplate> {
  return db.sessionTemplate.create({
    data: {
      id: id(),
      studioId: studio.id,
      locationId: studio.locationId,
      dayOfWeek: options.dayOfWeek,
      startTimeLocal: options.startTimeLocal,
      durationMin: options.durationMin ?? 60,
      capacity: options.capacity ?? null,
      offeringType: 'BOTH',
      priceCents: options.priceCents ?? 4500,
      effectiveFrom: options.effectiveFrom ?? new Date('2026-01-01'),
      effectiveUntil: options.effectiveUntil ?? null,
      active: options.active ?? true,
    },
  })
}

export interface SeedSessionOptions {
  startsAt: Date
  durationMin?: number
  capacity?: number
  bookedSeats?: number
  status?: SessionStatus
  priceCents?: number
}

export async function seedSession(
  db: PrismaClient,
  studio: Studio,
  options: SeedSessionOptions,
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

/** Minimal PENDING order — confirmHold's orderId is a real FK to orders. */
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

export async function seedCustomer(db: PrismaClient): Promise<Customer> {
  return db.customer.create({
    data: {
      id: id(),
      kind: CustomerKind.GUEST,
      firstName: 'Test',
      lastName: 'Customer',
      phone: '+13855550101',
    },
  })
}
