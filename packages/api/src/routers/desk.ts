/**
 * Desk router — staff tablet POS. Everything is staffProcedure(FRONT_DESK)
 * and location-scoped via ctx.assertLocationRole on the resolved location.
 */

import { SoldOutError, tryReserveSeats } from '@plunj/availability'
import {
  BookingStatus,
  BookingType,
  LedgerReason,
  OrderChannel,
  OrderStatus,
  PaymentProviderKind,
  PaymentStatus,
  PaymentTender,
  RefundStatus,
  StaffRoleKind,
  id,
} from '@plunj/db'
import { allocateProportional } from '@plunj/money'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { audit } from '../audit.js'
import { WaiverUnsignedError } from '../errors.js'
import { formatSessionMoment, iso, isoOrNull, localDateKey } from '../format.js'
import { normalizePhoneUS } from '../phone.js'
import { DiscountRejectedError, buildQuote } from '../pricing.js'
import {
  currentWaiverDocument,
  locationBySlug,
  upsertCustomerByPhone,
  waiverStatusFor,
} from '../shared.js'
import { verifyStaffPin } from '../staff-pin.js'
import { router, staffProcedure } from '../trpc.js'

const deskProcedure = staffProcedure(StaffRoleKind.FRONT_DESK)

const DAY_MS = 24 * 60 * 60 * 1000

const customerSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1).optional(),
  phone: z.string().min(7),
})

export const deskRouter = router({
  roster: router({
    today: deskProcedure
      .input(z.object({ locationSlug: z.string() }))
      .query(async ({ ctx, input }) => {
        const { db } = ctx
        const location = await locationBySlug(db, input.locationSlug)
        ctx.assertLocationRole(location.id)
        const now = ctx.now()
        const todayKey = localDateKey(now, location.timezone)

        const doc = await currentWaiverDocument(db, location.id)
        const signatures = doc
          ? await db.waiverSignature.findMany({ where: { waiverDocumentId: doc.id } })
          : []
        const signedSet = new Set(
          signatures.filter((s) => s.minorCustomerId === null).map((s) => s.customerId),
        )
        const minorSet = new Set(
          signatures.map((s) => s.minorCustomerId).filter((cid): cid is string => cid !== null),
        )
        const badge = (customerId: string): 'SIGNED' | 'UNSIGNED' | 'MINOR_UNVERIFIED' => {
          if (!doc || signedSet.has(customerId)) return 'SIGNED'
          if (minorSet.has(customerId)) return 'MINOR_UNVERIFIED'
          return 'UNSIGNED'
        }

        // ±36h window, then filter to the location-local calendar day.
        const sessions = await db.session.findMany({
          where: {
            locationId: location.id,
            startsAt: {
              gte: new Date(now.getTime() - 1.5 * DAY_MS),
              lte: new Date(now.getTime() + 1.5 * DAY_MS),
            },
          },
          include: {
            bookings: { include: { customer: true, order: true } },
            studio: true,
          },
          orderBy: { startsAt: 'asc' },
        })
        const todays = sessions.filter(
          (s) => localDateKey(s.startsAt, location.timezone) === todayKey,
        )

        const rosterBooking = (booking: (typeof todays)[number]['bookings'][number]) => ({
          bookingId: booking.id,
          customerId: booking.customerId,
          customerName: [booking.customer.firstName, booking.customer.lastName]
            .filter(Boolean)
            .join(' '),
          customerPhone: booking.customer.phone,
          seats: booking.seats,
          type: booking.type,
          status: booking.status,
          waiverStatus: badge(booking.customerId),
          paymentStatus: booking.order?.status ?? 'UNPAID',
          orderId: booking.orderId,
          orderTotalCents: booking.order?.totalCents ?? null,
          manageToken: booking.manageToken,
        })

        return {
          date: todayKey,
          sessions: todays.map((s) => ({
            sessionId: s.id,
            studioName: s.studio.name,
            startsAt: iso(s.startsAt),
            endsAt: iso(s.endsAt),
            whenLocal: formatSessionMoment(s.startsAt, location.timezone),
            status: s.status,
            capacity: s.capacity,
            bookedSeats: s.bookedSeats,
            bookings: s.bookings
              .filter(
                (b) =>
                  b.status === BookingStatus.HOLD ||
                  b.status === BookingStatus.CONFIRMED ||
                  b.status === BookingStatus.CHECKED_IN ||
                  b.status === BookingStatus.NO_SHOW,
              )
              .map(rosterBooking),
          })),
        }
      }),
  }),

  checkIn: deskProcedure
    .input(
      z.object({
        bookingId: z.string(),
        override: z.boolean().optional(),
        staffPin: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { db } = ctx
      const booking = await db.booking.findUnique({
        where: { id: input.bookingId },
        include: { customer: true },
      })
      if (!booking) throw new TRPCError({ code: 'NOT_FOUND', message: 'Booking not found' })
      ctx.assertLocationRole(booking.locationId)
      const now = ctx.now()

      if (booking.status === BookingStatus.CHECKED_IN) {
        return {
          bookingId: booking.id,
          status: booking.status,
          checkedInAt: isoOrNull(booking.checkedInAt),
        }
      }
      if (booking.status !== BookingStatus.CONFIRMED) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Booking is ${booking.status} and cannot be checked in`,
        })
      }

      const waiver = await waiverStatusFor(db, booking.locationId, booking.customerId)
      if (waiver !== 'SIGNED') {
        const overridden =
          input.override === true &&
          input.staffPin !== undefined &&
          verifyStaffPin(input.staffPin, ctx.staff.user.pin)
        if (!overridden) {
          if (input.override === true) {
            throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Invalid staff PIN' })
          }
          throw new WaiverUnsignedError(booking.id)
        }
      }

      const updated = await db.$transaction(async (tx) => {
        const row = await tx.booking.update({
          where: { id: booking.id },
          data: { status: BookingStatus.CHECKED_IN, checkedInAt: now },
        })
        await audit(tx, {
          actorType: 'STAFF',
          actorId: ctx.staff.user.id,
          locationId: booking.locationId,
          action: 'desk.check_in',
          entityType: 'Booking',
          entityId: booking.id,
          before: { status: booking.status },
          after: {
            status: BookingStatus.CHECKED_IN,
            waiverStatus: waiver,
            override: waiver !== 'SIGNED',
          },
        })
        return row
      })
      return {
        bookingId: updated.id,
        status: updated.status,
        checkedInAt: isoOrNull(updated.checkedInAt),
      }
    }),

  walkIn: router({
    create: deskProcedure
      .input(
        z.object({
          locationSlug: z.string(),
          sessionId: z.string(),
          seats: z.number().int().min(1).max(20).default(1),
          customer: customerSchema,
          discountCode: z.string().min(1).optional(),
          tipCents: z.number().int().min(0).optional(),
          paymentTender: z.enum(['TERMINAL', 'CASH_RECORDED', 'COMP']),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const { db } = ctx
        const location = await locationBySlug(db, input.locationSlug)
        ctx.assertLocationRole(location.id)
        const now = ctx.now()

        const session = await db.session.findUnique({ where: { id: input.sessionId } })
        if (!session || session.locationId !== location.id) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Session not found' })
        }

        const customer = await upsertCustomerByPhone(db, input.customer)
        const built = await buildQuote(db, {
          locationId: location.id,
          items: [{ kind: 'DROP_IN', sessionId: session.id, seats: input.seats }],
          ...(input.discountCode !== undefined ? { discountCode: input.discountCode } : {}),
          ...(input.tipCents !== undefined ? { tipCents: input.tipCents } : {}),
          customerId: customer.id,
          now,
        })
        if (!built.ok) throw new DiscountRejectedError(built.reason, built.message)
        const { quote } = built

        const paidNow = input.paymentTender !== 'TERMINAL'
        const orderId = id()
        const bookingId = id()

        // No hold — seats reserved and confirmed in ONE transaction. The
        // conditional UPDATE inside tryReserveSeats keeps invariant #3.
        await db.$transaction(async (tx) => {
          const reserved = await tryReserveSeats(tx, {
            sessionId: session.id,
            seats: input.seats,
          })
          if (!reserved) throw new SoldOutError(session.id, input.seats)

          await tx.order.create({
            data: {
              id: orderId,
              locationId: location.id,
              customerId: customer.id,
              channel: OrderChannel.POS,
              status: paidNow ? OrderStatus.PAID : OrderStatus.PENDING,
              subtotalCents: quote.subtotalCents,
              discountCents: quote.discountCents,
              taxCents: quote.taxCents,
              tipCents: quote.tipCents,
              totalCents: quote.totalCents,
              discountCodeId: built.discountCodeId,
              pricingVersion: quote.pricingVersion,
            },
          })
          for (const line of quote.lines) {
            await tx.orderLine.create({
              data: {
                id: id(),
                orderId,
                locationId: location.id,
                kind: line.kind,
                refId: line.id,
                description: line.description,
                qty: line.qty,
                unitPriceCents: line.unitPriceCents,
                lineSubtotalCents: line.lineSubtotalCents,
                discountAllocatedCents: line.discountAllocatedCents,
                taxCents: line.taxCents,
                lineTotalCents: line.lineTotalCents,
                taxable: line.taxable,
              },
            })
          }
          await tx.booking.create({
            data: {
              id: bookingId,
              sessionId: session.id,
              locationId: location.id,
              studioId: session.studioId,
              customerId: customer.id,
              orderId,
              type: input.paymentTender === 'COMP' ? BookingType.COMP : BookingType.DROP_IN,
              seats: input.seats,
              status: BookingStatus.CONFIRMED,
              startsAt: session.startsAt,
              endsAt: session.endsAt,
              manageToken: id(),
            },
          })
          if (built.discountCodeId !== null) {
            await tx.discountRedemption.create({
              data: {
                id: id(),
                discountCodeId: built.discountCodeId,
                orderId,
                customerId: customer.id,
                locationId: location.id,
                amountCents: quote.discountCents,
              },
            })
          }
          if (paidNow) {
            await tx.payment.create({
              data: {
                id: id(),
                orderId,
                locationId: location.id,
                provider: PaymentProviderKind.INTERNAL,
                tender:
                  input.paymentTender === 'COMP' ? PaymentTender.COMP : PaymentTender.CASH_RECORDED,
                amountCents: quote.totalCents,
                status: PaymentStatus.SUCCEEDED,
              },
            })
          }
          await audit(tx, {
            actorType: 'STAFF',
            actorId: ctx.staff.user.id,
            locationId: location.id,
            action: 'desk.walk_in',
            entityType: 'Order',
            entityId: orderId,
            after: {
              bookingId,
              totalCents: quote.totalCents,
              paymentTender: input.paymentTender,
            },
          })
        })

        // TERMINAL: stub the future Stripe Terminal path with a
        // REQUIRES_ACTION card-present intent the desk can pick up later.
        let clientSecret: string | null = null
        if (!paidNow) {
          const intent = await ctx.payments.createPaymentIntent({
            amountCents: quote.totalCents,
            currency: 'usd',
            locationAccountRef: location.stripeAccountId ?? `internal:${location.id}`,
            metadata: { orderId, bookingId },
            idempotencyKey: orderId,
          })
          await db.payment.create({
            data: {
              id: id(),
              orderId,
              locationId: location.id,
              provider: PaymentProviderKind.STRIPE,
              providerAccountRef: location.stripeAccountId,
              providerPaymentRef: intent.providerPaymentRef,
              tender: PaymentTender.TERMINAL,
              amountCents: quote.totalCents,
              status: PaymentStatus.REQUIRES_ACTION,
            },
          })
          clientSecret = intent.clientSecret
        }

        return { bookingId, orderId, clientSecret, quote }
      }),
  }),

  noShow: deskProcedure
    .input(z.object({ bookingId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { db } = ctx
      const booking = await db.booking.findUnique({ where: { id: input.bookingId } })
      if (!booking) throw new TRPCError({ code: 'NOT_FOUND', message: 'Booking not found' })
      ctx.assertLocationRole(booking.locationId)
      if (booking.status === BookingStatus.NO_SHOW) {
        return { bookingId: booking.id, status: booking.status }
      }
      if (booking.status !== BookingStatus.CONFIRMED) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Booking is ${booking.status} and cannot be marked a no-show`,
        })
      }
      const updated = await db.$transaction(async (tx) => {
        const row = await tx.booking.update({
          where: { id: booking.id },
          data: { status: BookingStatus.NO_SHOW },
        })
        await audit(tx, {
          actorType: 'STAFF',
          actorId: ctx.staff.user.id,
          locationId: booking.locationId,
          action: 'desk.no_show',
          entityType: 'Booking',
          entityId: booking.id,
          before: { status: booking.status },
          after: { status: BookingStatus.NO_SHOW },
        })
        return row
      })
      return { bookingId: updated.id, status: updated.status }
    }),

  refund: deskProcedure
    .input(
      z.object({
        orderId: z.string(),
        amountCents: z.number().int().min(1),
        reason: z.string().min(1),
        staffPin: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { db } = ctx
      const order = await db.order.findUnique({
        where: { id: input.orderId },
        include: { lines: true, payments: true, refunds: true },
      })
      if (!order) throw new TRPCError({ code: 'NOT_FOUND', message: 'Order not found' })
      ctx.assertLocationRole(order.locationId)

      if (!verifyStaffPin(input.staffPin, ctx.staff.user.pin)) {
        // Failed PIN attempts on money mutations are audited.
        await db.$transaction(async (tx) => {
          await audit(tx, {
            actorType: 'STAFF',
            actorId: ctx.staff.user.id,
            locationId: order.locationId,
            action: 'desk.refund.pin_rejected',
            entityType: 'Order',
            entityId: order.id,
            after: { amountCents: input.amountCents },
          })
        })
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Invalid staff PIN' })
      }

      const payment = order.payments.find((p) => p.status === PaymentStatus.SUCCEEDED)
      if (!payment || order.status === OrderStatus.PENDING) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Order has no successful payment to refund',
        })
      }
      const alreadyRefunded = order.refunds
        .filter((r) => r.status !== RefundStatus.FAILED)
        .reduce((sum, r) => sum + r.amountCents, 0)
      if (input.amountCents + alreadyRefunded > order.totalCents) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Refund amount exceeds the refundable balance',
        })
      }

      const refundId = id()
      let providerRefundRef: string | null = null
      let status: RefundStatus = RefundStatus.SUCCEEDED
      if (payment.provider === PaymentProviderKind.STRIPE && payment.providerPaymentRef) {
        const result = await ctx.payments.refund({
          providerPaymentRef: payment.providerPaymentRef,
          amountCents: input.amountCents,
          locationAccountRef: payment.providerAccountRef ?? '',
          reason: input.reason,
          idempotencyKey: refundId,
        })
        providerRefundRef = result.providerRefundRef
        status = result.status
      }

      // Exact per-line allocation of the refund (largest remainder — sums exactly).
      const weights = order.lines.map((l) => l.lineTotalCents)
      const allocations = allocateProportional(input.amountCents, weights)
      const lineAllocations = order.lines.map((l, i) => ({
        orderLineId: l.id,
        amountCents: allocations[i] ?? 0,
      }))

      const totalAfter = alreadyRefunded + input.amountCents
      const nextOrderStatus =
        status !== RefundStatus.FAILED && totalAfter >= order.totalCents
          ? OrderStatus.REFUNDED
          : OrderStatus.PARTIALLY_REFUNDED

      await db.$transaction(async (tx) => {
        await tx.refund.create({
          data: {
            id: refundId,
            paymentId: payment.id,
            orderId: order.id,
            locationId: order.locationId,
            amountCents: input.amountCents,
            reason: input.reason,
            initiatedByStaffId: ctx.staff.user.id,
            providerRefundRef,
            status,
            lineAllocations,
          },
        })
        if (status !== RefundStatus.FAILED) {
          await tx.order.update({
            where: { id: order.id },
            data: { status: nextOrderStatus },
          })
        }
        await audit(tx, {
          actorType: 'STAFF',
          actorId: ctx.staff.user.id,
          locationId: order.locationId,
          action: 'desk.refund',
          entityType: 'Order',
          entityId: order.id,
          before: { status: order.status },
          after: {
            refundId,
            amountCents: input.amountCents,
            reason: input.reason,
            status: nextOrderStatus,
            lineAllocations,
          },
        })
      })

      return { refundId, status, lineAllocations }
    }),

  credit: deskProcedure
    .input(
      z.object({
        locationSlug: z.string(),
        customerId: z.string(),
        amountCents: z.number().int().min(1),
        reason: z.string().min(1),
        staffPin: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { db } = ctx
      const location = await locationBySlug(db, input.locationSlug)
      ctx.assertLocationRole(location.id)
      const customer = await db.customer.findUnique({ where: { id: input.customerId } })
      if (!customer) throw new TRPCError({ code: 'NOT_FOUND', message: 'Customer not found' })

      if (!verifyStaffPin(input.staffPin, ctx.staff.user.pin)) {
        await db.$transaction(async (tx) => {
          await audit(tx, {
            actorType: 'STAFF',
            actorId: ctx.staff.user.id,
            locationId: location.id,
            action: 'desk.credit.pin_rejected',
            entityType: 'Customer',
            entityId: customer.id,
            after: { amountCents: input.amountCents },
          })
        })
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Invalid staff PIN' })
      }

      const entryId = id()
      await db.$transaction(async (tx) => {
        await tx.storedValueLedger.create({
          data: {
            id: entryId,
            locationId: location.id,
            customerId: customer.id,
            deltaCents: input.amountCents,
            reason: LedgerReason.ADJUSTMENT,
            note: input.reason,
          },
        })
        await audit(tx, {
          actorType: 'STAFF',
          actorId: ctx.staff.user.id,
          locationId: location.id,
          action: 'desk.credit',
          entityType: 'Customer',
          entityId: customer.id,
          after: { amountCents: input.amountCents, reason: input.reason, ledgerEntryId: entryId },
        })
      })
      return { ledgerEntryId: entryId }
    }),

  capacityOverride: deskProcedure
    .input(z.object({ sessionId: z.string(), delta: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const { db } = ctx
      const session = await db.session.findUnique({
        where: { id: input.sessionId },
        include: { studio: true },
      })
      if (!session) throw new TRPCError({ code: 'NOT_FOUND', message: 'Session not found' })
      ctx.assertLocationRole(session.locationId)

      const ceiling = session.studio.defaultCapacity + 4
      const requested = session.capacity + input.delta
      const newCapacity = Math.max(session.bookedSeats, Math.min(requested, ceiling))

      const updated = await db.$transaction(async (tx) => {
        const row = await tx.session.update({
          where: { id: session.id },
          data: { capacity: newCapacity },
        })
        await audit(tx, {
          actorType: 'STAFF',
          actorId: ctx.staff.user.id,
          locationId: session.locationId,
          action: 'desk.capacity_override',
          entityType: 'Session',
          entityId: session.id,
          before: { capacity: session.capacity },
          after: { capacity: newCapacity, requested, ceiling },
        })
        return row
      })
      return { sessionId: updated.id, capacity: updated.capacity }
    }),

  customers: router({
    search: deskProcedure
      .input(z.object({ locationSlug: z.string(), q: z.string().min(1) }))
      .query(async ({ ctx, input }) => {
        const { db } = ctx
        const location = await locationBySlug(db, input.locationSlug)
        ctx.assertLocationRole(location.id)

        // Phones are stored canonically as "+1XXXXXXXXXX" — match phone-ish
        // queries by their digits so "(801) 842", "801-842", and "801842" all
        // hit the same rows. A full 10/11-digit entry normalizes to an exact
        // E.164 match; partial digits fall back to contains. Name search is
        // untouched.
        const digits = input.q.replace(/\D/g, '')
        const normalized = normalizePhoneUS(input.q)
        const phoneClauses =
          normalized !== null
            ? [{ phone: normalized }]
            : digits.length > 0
              ? [{ phone: { contains: digits } }]
              : []

        const customers = await db.customer.findMany({
          where: {
            AND: [
              {
                OR: [
                  ...phoneClauses,
                  { firstName: { contains: input.q, mode: 'insensitive' } },
                  { lastName: { contains: input.q, mode: 'insensitive' } },
                ],
              },
              {
                OR: [
                  { bookings: { some: { locationId: location.id } } },
                  { locationProfiles: { some: { locationId: location.id } } },
                ],
              },
            ],
          },
          take: 20,
        })

        return Promise.all(
          customers.map(async (c) => {
            const [waiverStatus, visits, lastVisit] = await Promise.all([
              waiverStatusFor(db, location.id, c.id),
              db.booking.count({
                where: {
                  customerId: c.id,
                  locationId: location.id,
                  status: BookingStatus.CHECKED_IN,
                },
              }),
              db.booking.findFirst({
                where: {
                  customerId: c.id,
                  locationId: location.id,
                  status: BookingStatus.CHECKED_IN,
                },
                orderBy: { startsAt: 'desc' },
              }),
            ])
            return {
              customerId: c.id,
              kind: c.kind,
              name: [c.firstName, c.lastName].filter(Boolean).join(' '),
              phone: c.phone,
              waiverStatus,
              visits,
              lastVisitAt: isoOrNull(lastVisit?.startsAt ?? null),
            }
          }),
        )
      }),
  }),
})
