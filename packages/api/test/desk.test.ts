import {
  BookingStatus,
  OrderStatus,
  PaymentStatus,
  PaymentTender,
  RefundStatus,
  StaffRoleKind,
  id,
} from '@plunj/db'
import { TRPCError } from '@trpc/server'
import { afterAll, describe, expect, test } from 'vitest'
import { WaiverUnsignedError } from '../src/index.js'
import {
  STAFF_PIN,
  callerFor,
  createClient,
  daysFromNow,
  newEnv,
  seedCustomer,
  seedLocation,
  seedSession,
  seedStaff,
  seedWaiverDoc,
  signWaiver,
  uniquePhone,
} from './helpers.js'

const db = createClient()
afterAll(async () => db.$disconnect())

const HOUR_MS = 60 * 60 * 1000

async function deskSetup() {
  const env = newEnv(db)
  const { location, studio } = await seedLocation(db)
  const { staffUser, authUserId } = await seedStaff(db, {
    role: StaffRoleKind.FRONT_DESK,
    locationId: location.id,
  })
  const caller = await callerFor(env, { authUserId })
  return { env, location, studio, staffUser, authUserId, caller }
}

describe('desk.walkIn', () => {
  test('CASH_RECORDED creates a PAID order, SUCCEEDED payment, CONFIRMED booking, audit row', async () => {
    const { caller, location, studio } = await deskSetup()
    const session = await seedSession(db, studio, { startsAt: daysFromNow(0.1), priceCents: 4500 })

    const result = await caller.desk.walkIn.create({
      locationSlug: location.slug,
      sessionId: session.id,
      customer: { firstName: 'Walk', lastName: 'Inn', phone: uniquePhone() },
      paymentTender: 'CASH_RECORDED',
    })

    const order = await db.order.findUniqueOrThrow({
      where: { id: result.orderId },
      include: { payments: true, lines: true },
    })
    expect(order.status).toBe(OrderStatus.PAID)
    expect(order.totalCents).toBe(result.quote.totalCents)
    expect(order.payments).toHaveLength(1)
    expect(order.payments[0]!.status).toBe(PaymentStatus.SUCCEEDED)
    expect(order.payments[0]!.tender).toBe(PaymentTender.CASH_RECORDED)
    expect(order.payments[0]!.amountCents).toBe(order.totalCents)

    const booking = await db.booking.findUniqueOrThrow({ where: { id: result.bookingId } })
    expect(booking.status).toBe(BookingStatus.CONFIRMED)
    expect(booking.orderId).toBe(result.orderId)

    const after = await db.session.findUniqueOrThrow({ where: { id: session.id } })
    expect(after.bookedSeats).toBe(1)

    const auditRows = await db.auditLog.findMany({
      where: { action: 'desk.walk_in', entityId: result.orderId },
    })
    expect(auditRows).toHaveLength(1)
  })
})

describe('desk.refund', () => {
  async function paidWalkIn() {
    const setup = await deskSetup()
    const session = await seedSession(db, setup.studio, {
      startsAt: daysFromNow(0.1),
      priceCents: 4500,
    })
    const result = await setup.caller.desk.walkIn.create({
      locationSlug: setup.location.slug,
      sessionId: session.id,
      seats: 2,
      customer: { firstName: 'Refunda', phone: uniquePhone() },
      paymentTender: 'CASH_RECORDED',
    })
    return { ...setup, session, walkIn: result }
  }

  test('valid pin: full refund allocates lines exactly and marks order REFUNDED', async () => {
    const { caller, walkIn } = await paidWalkIn()
    const order = await db.order.findUniqueOrThrow({
      where: { id: walkIn.orderId },
      include: { lines: true },
    })

    const result = await caller.desk.refund({
      orderId: order.id,
      amountCents: order.totalCents,
      reason: 'unhappy plunge',
      staffPin: STAFF_PIN,
    })
    expect(result.status).toBe(RefundStatus.SUCCEEDED)

    const allocated = result.lineAllocations.reduce((sum, a) => sum + a.amountCents, 0)
    expect(allocated).toBe(order.totalCents)
    for (const allocation of result.lineAllocations) {
      expect(order.lines.some((l) => l.id === allocation.orderLineId)).toBe(true)
    }

    const refreshed = await db.order.findUniqueOrThrow({ where: { id: order.id } })
    expect(refreshed.status).toBe(OrderStatus.REFUNDED)

    const refundRow = await db.refund.findUniqueOrThrow({ where: { id: result.refundId } })
    expect(refundRow.amountCents).toBe(order.totalCents)

    const auditRows = await db.auditLog.findMany({
      where: { action: 'desk.refund', entityId: order.id },
    })
    expect(auditRows).toHaveLength(1)
  })

  test('partial refund → PARTIALLY_REFUNDED with exact allocation', async () => {
    const { caller, walkIn } = await paidWalkIn()
    const result = await caller.desk.refund({
      orderId: walkIn.orderId,
      amountCents: 1001,
      reason: 'partial goodwill',
      staffPin: STAFF_PIN,
    })
    const allocated = result.lineAllocations.reduce((sum, a) => sum + a.amountCents, 0)
    expect(allocated).toBe(1001)
    const order = await db.order.findUniqueOrThrow({ where: { id: walkIn.orderId } })
    expect(order.status).toBe(OrderStatus.PARTIALLY_REFUNDED)
  })

  test('wrong pin → UNAUTHORIZED, attempt audited, nothing refunded', async () => {
    const { caller, walkIn } = await paidWalkIn()
    await expect(
      caller.desk.refund({
        orderId: walkIn.orderId,
        amountCents: 500,
        reason: 'nope',
        staffPin: '0000',
      }),
    ).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(TRPCError)
      expect((err as TRPCError).code).toBe('UNAUTHORIZED')
      return true
    })

    const auditRows = await db.auditLog.findMany({
      where: { action: 'desk.refund.pin_rejected', entityId: walkIn.orderId },
    })
    expect(auditRows).toHaveLength(1)

    expect(await db.refund.count({ where: { orderId: walkIn.orderId } })).toBe(0)
    const order = await db.order.findUniqueOrThrow({ where: { id: walkIn.orderId } })
    expect(order.status).toBe(OrderStatus.PAID)
  })
})

describe('desk.roster', () => {
  test('waiver badges: SIGNED / UNSIGNED / MINOR_UNVERIFIED', async () => {
    const { caller, location, studio } = await deskSetup()
    const doc = await seedWaiverDoc(db, location.id)
    const now = new Date()
    const session = await seedSession(db, studio, {
      startsAt: new Date(now.getTime() + 2 * HOUR_MS),
      capacity: 8,
    })

    const signed = await seedCustomer(db, { firstName: 'Signed' })
    const unsigned = await seedCustomer(db, { firstName: 'Unsigned' })
    const minor = await seedCustomer(db, { firstName: 'Minor' })
    const guardian = await seedCustomer(db, { firstName: 'Guardian' })

    await signWaiver(db, {
      customerId: signed.id,
      locationId: location.id,
      waiverDocumentId: doc.id,
    })
    await signWaiver(db, {
      customerId: guardian.id,
      locationId: location.id,
      waiverDocumentId: doc.id,
      minorCustomerId: minor.id,
    })

    for (const customer of [signed, unsigned, minor]) {
      await db.booking.create({
        data: {
          id: id(),
          sessionId: session.id,
          locationId: location.id,
          studioId: studio.id,
          customerId: customer.id,
          type: 'DROP_IN',
          seats: 1,
          status: BookingStatus.CONFIRMED,
          startsAt: session.startsAt,
          endsAt: session.endsAt,
          manageToken: id(),
        },
      })
    }

    const roster = await caller.desk.roster.today({ locationSlug: location.slug })
    const rosterSession = roster.sessions.find((s) => s.sessionId === session.id)
    expect(rosterSession).toBeDefined()
    const byName = new Map(
      rosterSession!.bookings.map((b) => [b.customerName.split(' ')[0], b.waiverStatus]),
    )
    expect(byName.get('Signed')).toBe('SIGNED')
    expect(byName.get('Unsigned')).toBe('UNSIGNED')
    expect(byName.get('Minor')).toBe('MINOR_UNVERIFIED')
  })
})

describe('desk.checkIn', () => {
  test('blocks unsigned waiver with CONFLICT, allows override with valid pin', async () => {
    const { caller, location, studio } = await deskSetup()
    await seedWaiverDoc(db, location.id)
    const session = await seedSession(db, studio, {
      startsAt: new Date(Date.now() + 2 * HOUR_MS),
    })
    const customer = await seedCustomer(db)
    const booking = await db.booking.create({
      data: {
        id: id(),
        sessionId: session.id,
        locationId: location.id,
        studioId: studio.id,
        customerId: customer.id,
        type: 'DROP_IN',
        seats: 1,
        status: BookingStatus.CONFIRMED,
        startsAt: session.startsAt,
        endsAt: session.endsAt,
        manageToken: id(),
      },
    })

    await expect(caller.desk.checkIn({ bookingId: booking.id })).rejects.toSatisfy(
      (err: unknown) => {
        expect(err).toBeInstanceOf(TRPCError)
        expect((err as TRPCError).code).toBe('CONFLICT')
        expect((err as TRPCError).cause).toBeInstanceOf(WaiverUnsignedError)
        return true
      },
    )

    const overridden = await caller.desk.checkIn({
      bookingId: booking.id,
      override: true,
      staffPin: STAFF_PIN,
    })
    expect(overridden.status).toBe(BookingStatus.CHECKED_IN)
  })
})

describe('desk.capacityOverride', () => {
  test('clamps to studio default capacity + 4 and audits before/after', async () => {
    const { caller, studio } = await deskSetup() // defaultCapacity 8
    const session = await seedSession(db, studio, {
      startsAt: daysFromNow(1),
      capacity: 8,
    })

    const result = await caller.desk.capacityOverride({ sessionId: session.id, delta: 10 })
    expect(result.capacity).toBe(12) // 8 + 4 ceiling

    const auditRows = await db.auditLog.findMany({
      where: { action: 'desk.capacity_override', entityId: session.id },
    })
    expect(auditRows).toHaveLength(1)
    expect(auditRows[0]!.before).toMatchObject({ capacity: 8 })
    expect(auditRows[0]!.after).toMatchObject({ capacity: 12 })
  })
})
