/**
 * Public router: location discovery, availability, checkout, self-serve
 * booking management, waivers, and phone-OTP auth. No staff auth anywhere in
 * this file; manage.* is gated by the unguessable manage token.
 */

import {
  cancelBooking,
  claimBuyout,
  confirmHold,
  createHold,
  findBuyoutWindows,
  listAvailability,
} from '@plunj/availability'
import {
  BookingStatus,
  BookingType,
  CustomerKind,
  LedgerReason,
  LocationStatus,
  OrderChannel,
  OrderStatus,
  PaymentProviderKind,
  PaymentStatus,
  PaymentTender,
  SignatureKind,
  id,
} from '@plunj/db'
import type { Booking } from '@plunj/db'
import { enqueue } from '@plunj/notifications'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { audit } from '../audit.js'
import { formatSessionMoment, iso, isoOrNull } from '../format.js'
import { DiscountRejectedError, buildQuote, toQuoteResponse } from '../pricing.js'
import {
  activeLocationBySlug,
  asOutboxTx,
  currentWaiverDocument,
  requireNormalizedPhone,
  upsertCustomerByPhone,
  waiverStatusFor,
} from '../shared.js'
import { publicProcedure, router } from '../trpc.js'
import { markOrderPaid } from '../webhooks.js'

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD')

export const checkoutItemSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('DROP_IN'),
    sessionId: z.string(),
    seats: z.number().int().min(1).max(20),
  }),
  z.object({
    kind: z.literal('BUYOUT'),
    buyoutOptionId: z.string(),
    sessionIds: z.array(z.string()).min(1),
  }),
])

const customerSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1).optional(),
  phone: z.string().min(7),
})

/**
 * Cancellation window: this far before start, cancelling earns account credit.
 * PLUNJ's published policy (see the waiver): cancel 1+ hours before → credit
 * automatically returned; later → no credit. (The waiver's $5 late-cancel fee
 * and full-cost no-show charge apply to the membership/credit model — Phase 3.)
 */
const CANCEL_CREDIT_WINDOW_MS = 60 * 60 * 1000

function ageOn(dateOfBirth: string, at: Date): number {
  const dob = new Date(`${dateOfBirth}T00:00:00Z`)
  let age = at.getUTCFullYear() - dob.getUTCFullYear()
  const beforeBirthday =
    at.getUTCMonth() < dob.getUTCMonth() ||
    (at.getUTCMonth() === dob.getUTCMonth() && at.getUTCDate() < dob.getUTCDate())
  if (beforeBirthday) age -= 1
  return age
}

function splitName(full: string): { firstName: string; lastName?: string } {
  const [first, ...rest] = full.trim().split(/\s+/)
  const firstName = first ?? full
  return rest.length > 0 ? { firstName, lastName: rest.join(' ') } : { firstName }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const publicRouter = router({
  locations: router({
    list: publicProcedure.query(async ({ ctx }) => {
      const locations = await ctx.db.location.findMany({
        where: { status: LocationStatus.ACTIVE },
        orderBy: { name: 'asc' },
      })
      return locations.map((l) => ({
        id: l.id,
        slug: l.slug,
        name: l.name,
        timezone: l.timezone,
        city: l.city,
        state: l.state,
        postalCode: l.postalCode,
        phone: l.phone,
        bookingProvider: l.bookingProvider,
        momenceUrl: l.momenceUrl,
      }))
    }),

    bySlug: publicProcedure.input(z.object({ slug: z.string() })).query(async ({ ctx, input }) => {
      const l = await activeLocationBySlug(ctx.db, input.slug)
      return {
        id: l.id,
        slug: l.slug,
        name: l.name,
        timezone: l.timezone,
        address1: l.address1,
        address2: l.address2,
        city: l.city,
        state: l.state,
        postalCode: l.postalCode,
        phone: l.phone,
        bookingProvider: l.bookingProvider,
        momenceUrl: l.momenceUrl,
      }
    }),
  }),

  availability: router({
    list: publicProcedure
      .input(z.object({ locationSlug: z.string(), fromDate: dateString, toDate: dateString }))
      .query(async ({ ctx, input }) => {
        const location = await activeLocationBySlug(ctx.db, input.locationSlug)
        const days = await listAvailability(ctx.db, {
          locationId: location.id,
          fromDate: input.fromDate,
          toDate: input.toDate,
          now: ctx.now(),
        })
        return days.map((day) => ({
          date: day.date,
          sessions: day.sessions.map((s) => ({
            sessionId: s.sessionId,
            studioId: s.studioId,
            startsAt: iso(s.startsAt),
            endsAt: iso(s.endsAt),
            capacity: s.capacity,
            priceCents: s.priceCents,
            remainingSeats: s.remainingSeats,
          })),
        }))
      }),
  }),

  buyouts: router({
    options: publicProcedure
      .input(z.object({ locationSlug: z.string() }))
      .query(async ({ ctx, input }) => {
        const location = await activeLocationBySlug(ctx.db, input.locationSlug)
        const options = await ctx.db.buyoutOption.findMany({
          where: { locationId: location.id, active: true },
          orderBy: { durationHours: 'asc' },
        })
        return options.map((o) => ({
          id: o.id,
          studioId: o.studioId,
          durationHours: o.durationHours,
          priceCents: o.priceCents,
          maxGuests: o.maxGuests,
        }))
      }),

    windows: publicProcedure
      .input(
        z.object({
          locationSlug: z.string(),
          date: dateString,
          durationHours: z.number().int().min(1).max(12),
        }),
      )
      .query(async ({ ctx, input }) => {
        const location = await activeLocationBySlug(ctx.db, input.locationSlug)
        const windows = await findBuyoutWindows(ctx.db, {
          locationId: location.id,
          date: input.date,
          durationHours: input.durationHours,
        })
        return windows.map((w) => ({
          studioId: w.studioId,
          startsAt: iso(w.startsAt),
          endsAt: iso(w.endsAt),
          sessionIds: w.sessionIds,
        }))
      }),
  }),

  checkout: router({
    quote: publicProcedure
      .input(
        z.object({
          locationSlug: z.string(),
          items: z.array(checkoutItemSchema).min(1),
          discountCode: z.string().min(1).optional(),
          tipCents: z.number().int().min(0).optional(),
        }),
      )
      .query(async ({ ctx, input }) => {
        const location = await activeLocationBySlug(ctx.db, input.locationSlug)
        const built = await buildQuote(ctx.db, {
          locationId: location.id,
          items: input.items,
          ...(input.discountCode !== undefined ? { discountCode: input.discountCode } : {}),
          ...(input.tipCents !== undefined ? { tipCents: input.tipCents } : {}),
          ...(ctx.customer ? { customerId: ctx.customer.id } : {}),
          now: ctx.now(),
        })
        return toQuoteResponse(built)
      }),

    start: publicProcedure
      .input(
        z.object({
          locationSlug: z.string(),
          items: z.array(checkoutItemSchema).min(1),
          discountCode: z.string().min(1).optional(),
          tipCents: z.number().int().min(0).optional(),
          customer: customerSchema,
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const { db } = ctx
        const now = ctx.now()
        const location = await activeLocationBySlug(db, input.locationSlug)
        const customer = await upsertCustomerByPhone(db, input.customer)

        // Server-authoritative quote — client totals are never trusted
        // because the client never sends totals at all (invariant #1).
        const built = await buildQuote(db, {
          locationId: location.id,
          items: input.items,
          ...(input.discountCode !== undefined ? { discountCode: input.discountCode } : {}),
          ...(input.tipCents !== undefined ? { tipCents: input.tipCents } : {}),
          customerId: customer.id,
          now,
        })
        if (!built.ok) throw new DiscountRejectedError(built.reason, built.message)
        const { quote } = built

        // Reserve seats: HOLD bookings via the availability engine.
        const bookings: Booking[] = []
        try {
          for (const item of input.items) {
            if (item.kind === 'DROP_IN') {
              const session = await db.session.findUniqueOrThrow({
                where: { id: item.sessionId },
              })
              bookings.push(
                await createHold(db, {
                  sessionId: session.id,
                  locationId: location.id,
                  studioId: session.studioId,
                  customerId: customer.id,
                  seats: item.seats,
                  startsAt: session.startsAt,
                  endsAt: session.endsAt,
                  type: BookingType.DROP_IN,
                  now,
                }),
              )
            } else {
              const sessions = await db.session.findMany({
                where: { id: { in: item.sessionIds } },
                orderBy: { startsAt: 'asc' },
              })
              const first = sessions[0]
              if (!first) throw new Error('Buyout requires at least one session')
              bookings.push(
                await claimBuyout(db, {
                  sessionIds: item.sessionIds,
                  locationId: location.id,
                  studioId: first.studioId,
                  customerId: customer.id,
                  holdMinutes: 10,
                  priceCents: quote.totalCents,
                  now,
                }),
              )
            }
          }
        } catch (err) {
          // Release anything we already held — all-or-nothing checkout.
          for (const b of bookings) {
            await cancelBooking(db, {
              bookingId: b.id,
              reason: 'checkout aborted',
              releaseSeats: true,
              now,
            }).catch(() => undefined)
          }
          throw err
        }

        const orderId = id()
        await db.$transaction(async (tx) => {
          await tx.order.create({
            data: {
              id: orderId,
              locationId: location.id,
              customerId: customer.id,
              channel: OrderChannel.WEB,
              status: OrderStatus.PENDING,
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
          // Link the HOLD bookings to the order now so the payment webhook can
          // find them by providerPaymentRef → payment → order → bookings.
          await tx.booking.updateMany({
            where: { id: { in: bookings.map((b) => b.id) } },
            data: { orderId },
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
          await audit(tx, {
            actorType: 'CUSTOMER',
            actorId: customer.id,
            locationId: location.id,
            action: 'checkout.start',
            entityType: 'Order',
            entityId: orderId,
            after: {
              totalCents: quote.totalCents,
              discountCents: quote.discountCents,
              bookingIds: bookings.map((b) => b.id),
            },
          })
        })

        const firstBooking = bookings[0]
        if (!firstBooking) {
          throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'No booking created' })
        }

        // Free orders (100% discount) skip the payment provider entirely.
        if (quote.totalCents === 0) {
          await markOrderPaid(ctx.db, {
            orderId,
            actorType: 'CUSTOMER',
            actorId: customer.id,
            now,
          })
          return {
            bookingId: firstBooking.id,
            bookingIds: bookings.map((b) => b.id),
            manageToken: firstBooking.manageToken,
            orderId,
            clientSecret: null,
            holdExpiresAt: null,
            quote,
          }
        }

        const intent = await ctx.payments.createPaymentIntent({
          amountCents: quote.totalCents,
          currency: 'usd',
          locationAccountRef: location.stripeAccountId ?? `internal:${location.id}`,
          metadata: { orderId, bookingId: firstBooking.id },
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
            tender: PaymentTender.CARD,
            amountCents: quote.totalCents,
            status: PaymentStatus.REQUIRES_ACTION,
          },
        })

        return {
          bookingId: firstBooking.id,
          bookingIds: bookings.map((b) => b.id),
          manageToken: firstBooking.manageToken,
          orderId,
          clientSecret: intent.clientSecret,
          holdExpiresAt: isoOrNull(firstBooking.holdExpiresAt),
          quote,
        }
      }),
  }),

  waivers: router({
    current: publicProcedure
      .input(z.object({ locationSlug: z.string() }))
      .query(async ({ ctx, input }) => {
        const location = await activeLocationBySlug(ctx.db, input.locationSlug)
        const doc = await currentWaiverDocument(ctx.db, location.id)
        if (!doc) return null
        return {
          id: doc.id,
          kind: doc.kind,
          version: doc.version,
          title: doc.title,
          bodyMarkdown: doc.bodyMarkdown,
        }
      }),

    sign: publicProcedure
      .input(
        z.object({
          bookingManageToken: z.string().optional(),
          walkIn: z.object({ locationSlug: z.string() }).optional(),
          signer: z.object({
            name: z.string().min(1),
            phone: z.string().min(7),
            dateOfBirth: dateString.optional(),
          }),
          signatureKind: z.enum(['TYPED', 'DRAWN']),
          typedName: z.string().min(1).optional(),
          minor: z
            .object({
              name: z.string().min(1),
              dateOfBirth: dateString,
              guardianName: z.string().min(1),
              guardianRelationship: z.string().min(1),
            })
            .optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const { db } = ctx
        const now = ctx.now()
        if (input.signatureKind === 'TYPED' && !input.typedName) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'typedName is required for a typed signature',
          })
        }

        let locationId: string
        if (input.bookingManageToken !== undefined) {
          const booking = await db.booking.findUnique({
            where: { manageToken: input.bookingManageToken },
          })
          if (!booking) {
            throw new TRPCError({ code: 'NOT_FOUND', message: 'Booking not found' })
          }
          locationId = booking.locationId
        } else if (input.walkIn !== undefined) {
          locationId = (await activeLocationBySlug(db, input.walkIn.locationSlug)).id
        } else {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Provide bookingManageToken or walkIn.locationSlug',
          })
        }

        const doc = await currentWaiverDocument(db, locationId)
        if (!doc) {
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: 'This location has no published waiver to sign',
          })
        }

        const signerPhone = requireNormalizedPhone(input.signer.phone)
        const signer = await upsertCustomerByPhone(db, {
          ...splitName(input.signer.name),
          phone: signerPhone,
        })
        if (input.signer.dateOfBirth !== undefined) {
          await db.customer.update({
            where: { id: signer.id },
            data: { dateOfBirth: new Date(`${input.signer.dateOfBirth}T00:00:00Z`) },
          })
        }

        let minorCustomerId: string | null = null
        if (input.minor !== undefined) {
          const age = ageOn(input.minor.dateOfBirth, now)
          if (age < 14) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: 'Guests under 14 cannot attend — even with a signed guardian waiver',
            })
          }
          if (age >= 18) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: 'This attendee is an adult — they should sign the standard waiver',
            })
          }
          const minorName = splitName(input.minor.name)
          const minorRow = await db.customer.create({
            data: {
              id: id(),
              kind: CustomerKind.GUEST,
              firstName: minorName.firstName,
              lastName: minorName.lastName ?? null,
              phone: signerPhone,
              dateOfBirth: new Date(`${input.minor.dateOfBirth}T00:00:00Z`),
            },
          })
          minorCustomerId = minorRow.id
        }

        const signature = await db.waiverSignature.create({
          data: {
            id: id(),
            customerId: signer.id,
            locationId,
            waiverDocumentId: doc.id,
            signedAt: now,
            signatureKind:
              input.signatureKind === 'TYPED' ? SignatureKind.TYPED : SignatureKind.DRAWN,
            typedName: input.typedName ?? null,
            minorCustomerId,
            guardianName: input.minor?.guardianName ?? null,
            guardianRelationship: input.minor?.guardianRelationship ?? null,
            ipAddress: ctx.ip,
          },
        })
        return {
          signatureId: signature.id,
          waiverDocumentId: doc.id,
          version: doc.version,
        }
      }),
  }),

  manage: router({
    get: publicProcedure.input(z.object({ token: z.string() })).query(async ({ ctx, input }) => {
      const booking = await ctx.db.booking.findUnique({
        where: { manageToken: input.token },
        include: { location: true, order: true, customer: true, session: true },
      })
      if (!booking) throw new TRPCError({ code: 'NOT_FOUND', message: 'Booking not found' })
      const waiverStatus = await waiverStatusFor(ctx.db, booking.locationId, booking.customerId)
      return {
        bookingId: booking.id,
        status: booking.status,
        type: booking.type,
        seats: booking.seats,
        startsAt: iso(booking.startsAt),
        endsAt: iso(booking.endsAt),
        whenLocal: formatSessionMoment(booking.startsAt, booking.location.timezone),
        location: {
          slug: booking.location.slug,
          name: booking.location.name,
          timezone: booking.location.timezone,
        },
        customerFirstName: booking.customer.firstName,
        customerPhone: booking.customer.phone,
        waiverStatus,
        sessionPriceCents: booking.session?.priceCents ?? null,
        order: booking.order
          ? {
              orderId: booking.order.id,
              status: booking.order.status,
              totalCents: booking.order.totalCents,
            }
          : null,
      }
    }),

    cancel: publicProcedure
      .input(z.object({ token: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const { db } = ctx
        const now = ctx.now()
        const booking = await db.booking.findUnique({
          where: { manageToken: input.token },
          include: { location: true, order: true, customer: true },
        })
        if (!booking) throw new TRPCError({ code: 'NOT_FOUND', message: 'Booking not found' })
        if (booking.status === BookingStatus.CANCELLED) {
          return { cancelled: true, creditCents: 0 }
        }
        if (booking.status !== BookingStatus.CONFIRMED && booking.status !== BookingStatus.HOLD) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `Booking is ${booking.status} and cannot be cancelled`,
          })
        }

        const outsideWindow = booking.startsAt.getTime() - now.getTime() > CANCEL_CREDIT_WINDOW_MS
        const paidCents =
          booking.order && booking.order.status === OrderStatus.PAID ? booking.order.totalCents : 0
        const creditCents = outsideWindow ? paidCents : 0

        await cancelBooking(db, {
          bookingId: booking.id,
          reason: outsideWindow ? 'customer cancellation' : 'late customer cancellation',
          releaseSeats: outsideWindow,
          now,
        })

        await db.$transaction(async (tx) => {
          if (creditCents > 0) {
            await tx.storedValueLedger.create({
              data: {
                id: id(),
                locationId: booking.locationId,
                customerId: booking.customerId,
                deltaCents: creditCents,
                reason: LedgerReason.CANCELLATION_CREDIT,
                orderId: booking.orderId,
                note: `Cancellation credit for booking ${booking.id}`,
              },
            })
          }
          await enqueue(asOutboxTx(tx), {
            kind: 'SMS',
            template: 'booking-cancelled',
            recipient: booking.customer.phone,
            locationId: booking.locationId,
            payload: {
              firstName: booking.customer.firstName,
              locationName: booking.location.name,
              dateTimeLocal: formatSessionMoment(booking.startsAt, booking.location.timezone),
              ...(creditCents > 0 ? { creditCents } : {}),
            },
            scheduledFor: now,
          })
          await audit(tx, {
            actorType: 'CUSTOMER',
            actorId: booking.customerId,
            locationId: booking.locationId,
            action: 'booking.cancel',
            entityType: 'Booking',
            entityId: booking.id,
            before: { status: booking.status },
            after: {
              status: BookingStatus.CANCELLED,
              outsideWindow,
              creditCents,
              seatsReleased: outsideWindow,
            },
          })
        })

        return { cancelled: true, creditCents }
      }),

    reschedule: publicProcedure
      .input(z.object({ token: z.string(), newSessionId: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const { db } = ctx
        const now = ctx.now()
        const booking = await db.booking.findUnique({
          where: { manageToken: input.token },
          include: { session: true },
        })
        if (!booking) throw new TRPCError({ code: 'NOT_FOUND', message: 'Booking not found' })
        if (booking.status !== BookingStatus.CONFIRMED) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Only confirmed bookings can be rescheduled',
          })
        }
        if (booking.type !== BookingType.DROP_IN || !booking.session || !booking.orderId) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'This booking cannot be rescheduled online — contact the studio',
          })
        }
        const newSession = await db.session.findUnique({ where: { id: input.newSessionId } })
        if (!newSession || newSession.locationId !== booking.locationId) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Session not found' })
        }
        // v1: no price-difference handling — same-priced sessions only.
        if (newSession.priceCents !== booking.session.priceCents) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'pick a same-priced time or contact the studio',
          })
        }

        // Hold the new seats FIRST so the customer can never lose both slots.
        const newHold = await createHold(db, {
          sessionId: newSession.id,
          locationId: booking.locationId,
          studioId: newSession.studioId,
          customerId: booking.customerId,
          seats: booking.seats,
          startsAt: newSession.startsAt,
          endsAt: newSession.endsAt,
          type: BookingType.DROP_IN,
          now,
        })
        await cancelBooking(db, {
          bookingId: booking.id,
          reason: 'rescheduled',
          releaseSeats: true,
          now,
        })
        const confirmed = await confirmHold(db, {
          bookingId: newHold.id,
          orderId: booking.orderId,
        })
        await db.$transaction(async (tx) => {
          await audit(tx, {
            actorType: 'CUSTOMER',
            actorId: booking.customerId,
            locationId: booking.locationId,
            action: 'booking.reschedule',
            entityType: 'Booking',
            entityId: booking.id,
            before: { sessionId: booking.sessionId },
            after: { sessionId: newSession.id, newBookingId: confirmed.id },
          })
        })
        return {
          bookingId: confirmed.id,
          manageToken: confirmed.manageToken,
          startsAt: iso(confirmed.startsAt),
        }
      }),
  }),

  otp: router({
    request: publicProcedure
      .input(z.object({ phone: z.string().min(7) }))
      .mutation(async ({ ctx, input }) => {
        // Better Auth stores the phone it is given — always hand it the
        // canonical E.164 form so auth_users.phone_number never splits.
        const phone = requireNormalizedPhone(input.phone)
        await ctx.auth.api.sendPhoneNumberOTP({ body: { phoneNumber: phone } })
        return { sent: true }
      }),

    verify: publicProcedure
      .input(z.object({ phone: z.string().min(7), code: z.string().min(4) }))
      .mutation(async ({ ctx, input }) => {
        const phone = requireNormalizedPhone(input.phone)
        let verified: { token: string | null; user?: { id: string } | null }
        try {
          verified = (await ctx.auth.api.verifyPhoneNumber({
            body: { phoneNumber: phone, code: input.code },
          })) as { token: string | null; user?: { id: string } | null }
        } catch {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid or expired code' })
        }
        const user = verified.user
        if (!user) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid or expired code' })
        }

        // First OTP verification claims the guest history for this phone.
        const { db } = ctx
        const matches = await db.customer.findMany({ where: { phone } })
        const claimable =
          matches.find((c) => c.authUserId === user.id) ??
          matches.find((c) => c.kind === CustomerKind.ACCOUNT && c.authUserId === null) ??
          matches.find((c) => c.kind === CustomerKind.GUEST && c.authUserId === null)
        const customer = claimable
          ? claimable.authUserId === user.id
            ? claimable
            : await db.customer.update({
                where: { id: claimable.id },
                data: { kind: CustomerKind.ACCOUNT, authUserId: user.id },
              })
          : await db.customer.create({
              data: {
                id: id(),
                kind: CustomerKind.ACCOUNT,
                firstName: 'PLUNJ',
                lastName: 'Member',
                phone,
                authUserId: user.id,
              },
            })

        // Staff sign in with the same phone OTP: link an unclaimed StaffUser
        // row by phone on first verification so staffProcedure can find it.
        await db.staffUser.updateMany({
          where: { phone, active: true, authUserId: null },
          data: { authUserId: user.id },
        })

        return {
          verified: true,
          authUserId: user.id,
          customerId: customer.id,
          token: verified.token ?? null,
        }
      }),
  }),
})
