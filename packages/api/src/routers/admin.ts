/**
 * Admin router — location owners/admins. staffProcedure(LOCATION_ADMIN) unless
 * noted (team mutations are LOCATION_OWNER+). Discount preview goes through
 * buildQuote — the SAME code path as checkout (invariant #1: preview ===
 * checkout, always).
 */

import { applyTemplateChanges, generateSessions } from '@plunj/availability'
import {
  BookingStatus,
  DiscountAppliesTo,
  DiscountType,
  OrderStatus,
  SessionStatus,
  StaffRoleKind,
  WaiverKind,
  id,
} from '@plunj/db'
import { TRPCError } from '@trpc/server'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { audit } from '../audit.js'
import { iso, localDateKey } from '../format.js'
import { buildQuote, toQuoteResponse } from '../pricing.js'
import { locationBySlug, waiverStatusFor } from '../shared.js'
import { router, staffProcedure } from '../trpc.js'
import { checkoutItemSchema } from './public.js'

const adminProcedure = staffProcedure(StaffRoleKind.LOCATION_ADMIN)
const ownerProcedure = staffProcedure(StaffRoleKind.LOCATION_OWNER)

const DAY_MS = 24 * 60 * 60 * 1000

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD')
const timeString = z.string().regex(/^\d{2}:\d{2}$/, 'expected HH:MM')

const discountDraftSchema = z
  .object({
    code: z.string().min(1),
    type: z.enum(['PERCENT', 'FIXED_CENTS']),
    valueBps: z.number().int().min(1).max(10000).optional(),
    valueCents: z.number().int().min(1).optional(),
    appliesTo: z.enum(['ALL', 'DROP_IN', 'BUYOUT', 'MEMBERSHIP_FIRST_CYCLE', 'PACK']),
    maxRedemptions: z.number().int().min(1).optional(),
    maxPerCustomer: z.number().int().min(1).optional(),
    minSubtotalCents: z.number().int().min(0).optional(),
    startsAt: z.string().datetime().optional(),
    endsAt: z.string().datetime().optional(),
    active: z.boolean().optional(),
  })
  .refine((d) => (d.type === 'PERCENT' ? d.valueBps !== undefined : d.valueCents !== undefined), {
    message: 'PERCENT needs valueBps; FIXED_CENTS needs valueCents',
  })

function discountShape(row: {
  id: string
  locationId: string | null
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
}) {
  return {
    id: row.id,
    locationId: row.locationId,
    code: row.code,
    type: row.type,
    valueBps: row.valueBps,
    valueCents: row.valueCents,
    appliesTo: row.appliesTo,
    maxRedemptions: row.maxRedemptions,
    maxPerCustomer: row.maxPerCustomer,
    minSubtotalCents: row.minSubtotalCents,
    startsAt: row.startsAt ? iso(row.startsAt) : null,
    endsAt: row.endsAt ? iso(row.endsAt) : null,
    active: row.active,
  }
}

export const adminRouter = router({
  schedule: router({
    templates: router({
      list: adminProcedure
        .input(z.object({ locationSlug: z.string() }))
        .query(async ({ ctx, input }) => {
          const location = await locationBySlug(ctx.db, input.locationSlug)
          ctx.assertLocationRole(location.id)
          const templates = await ctx.db.sessionTemplate.findMany({
            where: { locationId: location.id },
            orderBy: [{ dayOfWeek: 'asc' }, { startTimeLocal: 'asc' }],
          })
          return templates.map((t) => ({
            id: t.id,
            studioId: t.studioId,
            dayOfWeek: t.dayOfWeek,
            startTimeLocal: t.startTimeLocal,
            durationMin: t.durationMin,
            capacity: t.capacity,
            offeringType: t.offeringType,
            priceCents: t.priceCents,
            effectiveFrom: t.effectiveFrom.toISOString().slice(0, 10),
            effectiveUntil: t.effectiveUntil?.toISOString().slice(0, 10) ?? null,
            active: t.active,
          }))
        }),

      create: adminProcedure
        .input(
          z.object({
            locationSlug: z.string(),
            studioId: z.string(),
            dayOfWeek: z.number().int().min(0).max(6),
            startTimeLocal: timeString,
            durationMin: z.number().int().min(15).max(480).default(60),
            capacity: z.number().int().min(1).nullable().default(null),
            offeringType: z.enum(['COMMUNAL', 'PRIVATE_ONLY', 'BOTH']),
            priceCents: z.number().int().min(0),
            effectiveFrom: dateString,
            effectiveUntil: dateString.nullable().default(null),
          }),
        )
        .mutation(async ({ ctx, input }) => {
          const { db } = ctx
          const location = await locationBySlug(db, input.locationSlug)
          ctx.assertLocationRole(location.id)
          const studio = await db.studio.findUnique({ where: { id: input.studioId } })
          if (!studio || studio.locationId !== location.id) {
            throw new TRPCError({ code: 'NOT_FOUND', message: 'Studio not found' })
          }
          const templateId = id()
          await db.$transaction(async (tx) => {
            await tx.sessionTemplate.create({
              data: {
                id: templateId,
                studioId: studio.id,
                locationId: location.id,
                dayOfWeek: input.dayOfWeek,
                startTimeLocal: input.startTimeLocal,
                durationMin: input.durationMin,
                capacity: input.capacity,
                offeringType: input.offeringType,
                priceCents: input.priceCents,
                effectiveFrom: new Date(`${input.effectiveFrom}T00:00:00Z`),
                effectiveUntil: input.effectiveUntil
                  ? new Date(`${input.effectiveUntil}T00:00:00Z`)
                  : null,
              },
            })
            await audit(tx, {
              actorType: 'STAFF',
              actorId: ctx.staff.user.id,
              locationId: location.id,
              action: 'admin.template_create',
              entityType: 'SessionTemplate',
              entityId: templateId,
              after: { priceCents: input.priceCents, dayOfWeek: input.dayOfWeek },
            })
          })
          return { templateId }
        }),

      update: adminProcedure
        .input(
          z.object({
            templateId: z.string(),
            startTimeLocal: timeString.optional(),
            durationMin: z.number().int().min(15).max(480).optional(),
            capacity: z.number().int().min(1).nullable().optional(),
            priceCents: z.number().int().min(0).optional(),
            effectiveUntil: dateString.nullable().optional(),
            active: z.boolean().optional(),
          }),
        )
        .mutation(async ({ ctx, input }) => {
          const { db } = ctx
          const template = await db.sessionTemplate.findUnique({
            where: { id: input.templateId },
          })
          if (!template) throw new TRPCError({ code: 'NOT_FOUND', message: 'Template not found' })
          ctx.assertLocationRole(template.locationId)
          await db.$transaction(async (tx) => {
            await tx.sessionTemplate.update({
              where: { id: template.id },
              data: {
                ...(input.startTimeLocal !== undefined
                  ? { startTimeLocal: input.startTimeLocal }
                  : {}),
                ...(input.durationMin !== undefined ? { durationMin: input.durationMin } : {}),
                ...(input.capacity !== undefined ? { capacity: input.capacity } : {}),
                ...(input.priceCents !== undefined ? { priceCents: input.priceCents } : {}),
                ...(input.effectiveUntil !== undefined
                  ? {
                      effectiveUntil: input.effectiveUntil
                        ? new Date(`${input.effectiveUntil}T00:00:00Z`)
                        : null,
                    }
                  : {}),
                ...(input.active !== undefined ? { active: input.active } : {}),
              },
            })
            await audit(tx, {
              actorType: 'STAFF',
              actorId: ctx.staff.user.id,
              locationId: template.locationId,
              action: 'admin.template_update',
              entityType: 'SessionTemplate',
              entityId: template.id,
              before: { priceCents: template.priceCents, active: template.active },
              after: { patch: input },
            })
          })
          return { templateId: template.id }
        }),
    }),

    applyChanges: adminProcedure
      .input(z.object({ templateId: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const { db } = ctx
        const template = await db.sessionTemplate.findUnique({ where: { id: input.templateId } })
        if (!template) throw new TRPCError({ code: 'NOT_FOUND', message: 'Template not found' })
        ctx.assertLocationRole(template.locationId)
        const now = ctx.now()
        const result = await applyTemplateChanges(db, { templateId: template.id, now })
        const generated = await generateSessions(db, { locationId: template.locationId, now })
        await db.$transaction(async (tx) => {
          await audit(tx, {
            actorType: 'STAFF',
            actorId: ctx.staff.user.id,
            locationId: template.locationId,
            action: 'admin.template_apply',
            entityType: 'SessionTemplate',
            entityId: template.id,
            after: {
              deleted: result.deleted,
              conflicts: result.conflicts.map((s) => s.id),
              created: generated.created,
            },
          })
        })
        return {
          deleted: result.deleted,
          conflictSessionIds: result.conflicts.map((s) => s.id),
          created: generated.created,
        }
      }),

    generate: adminProcedure
      .input(
        z.object({
          locationSlug: z.string(),
          horizonDays: z.number().int().min(1).max(120).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const location = await locationBySlug(ctx.db, input.locationSlug)
        ctx.assertLocationRole(location.id)
        const result = await generateSessions(ctx.db, {
          locationId: location.id,
          ...(input.horizonDays !== undefined ? { horizonDays: input.horizonDays } : {}),
          now: ctx.now(),
        })
        return result
      }),

    closures: adminProcedure
      .input(
        z.object({
          sessionIds: z.array(z.string()).min(1),
          action: z.enum(['CLOSE', 'REOPEN']),
          dryRun: z.boolean().default(false),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const { db } = ctx
        const sessions = await db.session.findMany({ where: { id: { in: input.sessionIds } } })
        if (sessions.length !== input.sessionIds.length) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'One or more sessions not found' })
        }
        const locationId = sessions[0]?.locationId
        if (!locationId || sessions.some((s) => s.locationId !== locationId)) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'All sessions must belong to one location',
          })
        }
        ctx.assertLocationRole(locationId)

        // Blast radius: confirmed bookings that a closure would strand.
        const affected = await db.booking.findMany({
          where: {
            sessionId: { in: input.sessionIds },
            status: { in: [BookingStatus.CONFIRMED, BookingStatus.HOLD] },
          },
          include: { customer: true },
        })
        const affectedShape = affected.map((b) => ({
          bookingId: b.id,
          sessionId: b.sessionId,
          status: b.status,
          seats: b.seats,
          customerName: [b.customer.firstName, b.customer.lastName].filter(Boolean).join(' '),
          customerPhone: b.customer.phone,
        }))

        if (input.dryRun) {
          return { dryRun: true, affected: affectedShape, updated: 0 }
        }

        const from = input.action === 'CLOSE' ? SessionStatus.OPEN : SessionStatus.CLOSED
        const to = input.action === 'CLOSE' ? SessionStatus.CLOSED : SessionStatus.OPEN
        const updated = await db.$transaction(async (tx) => {
          const { count } = await tx.session.updateMany({
            where: { id: { in: input.sessionIds }, status: from },
            data: { status: to },
          })
          await audit(tx, {
            actorType: 'STAFF',
            actorId: ctx.staff.user.id,
            locationId,
            action: input.action === 'CLOSE' ? 'admin.sessions_close' : 'admin.sessions_reopen',
            entityType: 'Session',
            entityId: input.sessionIds.join(','),
            after: { sessionIds: input.sessionIds, affectedBookings: affectedShape.length },
          })
          return count
        })
        return { dryRun: false, affected: affectedShape, updated }
      }),
  }),

  discounts: router({
    list: adminProcedure
      .input(z.object({ locationSlug: z.string() }))
      .query(async ({ ctx, input }) => {
        const location = await locationBySlug(ctx.db, input.locationSlug)
        ctx.assertLocationRole(location.id)
        const codes = await ctx.db.discountCode.findMany({
          where: { OR: [{ locationId: location.id }, { locationId: null }] },
          orderBy: { createdAt: 'desc' },
        })
        return codes.map(discountShape)
      }),

    create: adminProcedure
      .input(z.object({ locationSlug: z.string() }).extend(discountDraftSchema.shape))
      .mutation(async ({ ctx, input }) => {
        const { db } = ctx
        const location = await locationBySlug(db, input.locationSlug)
        ctx.assertLocationRole(location.id)
        const codeId = id()
        await db.$transaction(async (tx) => {
          await tx.discountCode.create({
            data: {
              id: codeId,
              locationId: location.id,
              code: input.code,
              type: input.type,
              valueBps: input.valueBps ?? null,
              valueCents: input.valueCents ?? null,
              appliesTo: input.appliesTo,
              maxRedemptions: input.maxRedemptions ?? null,
              maxPerCustomer: input.maxPerCustomer ?? null,
              minSubtotalCents: input.minSubtotalCents ?? null,
              startsAt: input.startsAt ? new Date(input.startsAt) : null,
              endsAt: input.endsAt ? new Date(input.endsAt) : null,
              active: input.active ?? true,
            },
          })
          await audit(tx, {
            actorType: 'STAFF',
            actorId: ctx.staff.user.id,
            locationId: location.id,
            action: 'admin.discount_create',
            entityType: 'DiscountCode',
            entityId: codeId,
            after: { code: input.code, type: input.type },
          })
        })
        return { discountCodeId: codeId }
      }),

    update: adminProcedure
      .input(
        z.object({
          discountCodeId: z.string(),
          active: z.boolean().optional(),
          maxRedemptions: z.number().int().min(1).nullable().optional(),
          maxPerCustomer: z.number().int().min(1).nullable().optional(),
          minSubtotalCents: z.number().int().min(0).nullable().optional(),
          startsAt: z.string().datetime().nullable().optional(),
          endsAt: z.string().datetime().nullable().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const { db } = ctx
        const code = await db.discountCode.findUnique({ where: { id: input.discountCodeId } })
        if (!code) throw new TRPCError({ code: 'NOT_FOUND', message: 'Discount code not found' })
        if (code.locationId === null) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'Brand-wide codes are managed by corporate',
          })
        }
        ctx.assertLocationRole(code.locationId)
        await db.$transaction(async (tx) => {
          await tx.discountCode.update({
            where: { id: code.id },
            data: {
              ...(input.active !== undefined ? { active: input.active } : {}),
              ...(input.maxRedemptions !== undefined
                ? { maxRedemptions: input.maxRedemptions }
                : {}),
              ...(input.maxPerCustomer !== undefined
                ? { maxPerCustomer: input.maxPerCustomer }
                : {}),
              ...(input.minSubtotalCents !== undefined
                ? { minSubtotalCents: input.minSubtotalCents }
                : {}),
              ...(input.startsAt !== undefined
                ? { startsAt: input.startsAt ? new Date(input.startsAt) : null }
                : {}),
              ...(input.endsAt !== undefined
                ? { endsAt: input.endsAt ? new Date(input.endsAt) : null }
                : {}),
            },
          })
          await audit(tx, {
            actorType: 'STAFF',
            actorId: ctx.staff.user.id,
            locationId: code.locationId,
            action: 'admin.discount_update',
            entityType: 'DiscountCode',
            entityId: code.id,
            before: { active: code.active },
            after: { patch: input },
          })
        })
        return { discountCodeId: code.id }
      }),

    /**
     * Preview a stored code or an unsaved draft against sample items — runs
     * the exact buildQuote path checkout uses, so preview === checkout.
     */
    preview: adminProcedure
      .input(
        z
          .object({
            locationSlug: z.string(),
            sampleItems: z.array(checkoutItemSchema).min(1),
            tipCents: z.number().int().min(0).optional(),
            code: z.string().min(1).optional(),
            draft: discountDraftSchema.optional(),
          })
          .refine((v) => (v.code !== undefined) !== (v.draft !== undefined), {
            message: 'Provide exactly one of code or draft',
          }),
      )
      .query(async ({ ctx, input }) => {
        const location = await locationBySlug(ctx.db, input.locationSlug)
        ctx.assertLocationRole(location.id)
        const built = await buildQuote(ctx.db, {
          locationId: location.id,
          items: input.sampleItems,
          ...(input.tipCents !== undefined ? { tipCents: input.tipCents } : {}),
          ...(input.code !== undefined ? { discountCode: input.code } : {}),
          ...(input.draft !== undefined
            ? {
                draftDiscount: {
                  code: input.draft.code,
                  type: input.draft.type,
                  valueBps: input.draft.valueBps ?? null,
                  valueCents: input.draft.valueCents ?? null,
                  appliesTo: input.draft.appliesTo,
                  maxRedemptions: input.draft.maxRedemptions ?? null,
                  maxPerCustomer: input.draft.maxPerCustomer ?? null,
                  minSubtotalCents: input.draft.minSubtotalCents ?? null,
                  startsAt: input.draft.startsAt ? new Date(input.draft.startsAt) : null,
                  endsAt: input.draft.endsAt ? new Date(input.draft.endsAt) : null,
                  active: input.draft.active ?? true,
                },
              }
            : {}),
          now: ctx.now(),
        })
        return toQuoteResponse(built)
      }),
  }),

  team: router({
    list: adminProcedure
      .input(z.object({ locationSlug: z.string() }))
      .query(async ({ ctx, input }) => {
        const location = await locationBySlug(ctx.db, input.locationSlug)
        ctx.assertLocationRole(location.id)
        const roles = await ctx.db.staffRole.findMany({
          where: { locationId: location.id },
          include: { staffUser: true },
        })
        return roles.map((r) => ({
          staffUserId: r.staffUserId,
          name: r.staffUser.name,
          email: r.staffUser.email,
          phone: r.staffUser.phone,
          role: r.role,
          active: r.staffUser.active,
        }))
      }),

    invite: ownerProcedure
      .input(
        z.object({
          locationSlug: z.string(),
          name: z.string().min(1),
          email: z.string().email(),
          phone: z.string().min(7).optional(),
          role: z.enum(['FRONT_DESK', 'LOCATION_ADMIN', 'LOCATION_OWNER']),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const { db } = ctx
        const location = await locationBySlug(db, input.locationSlug)
        ctx.assertLocationRole(location.id)
        let staffUser = await db.staffUser.findUnique({ where: { email: input.email } })
        staffUser ??= await db.staffUser.create({
          data: {
            id: id(),
            name: input.name,
            email: input.email,
            phone: input.phone ?? null,
          },
        })
        const existingRole = await db.staffRole.findFirst({
          where: { staffUserId: staffUser.id, locationId: location.id },
        })
        if (!existingRole) {
          await db.staffRole.create({
            data: {
              id: id(),
              staffUserId: staffUser.id,
              role: input.role,
              locationId: location.id,
            },
          })
        }
        return { staffUserId: staffUser.id }
      }),

    setRole: ownerProcedure
      .input(
        z.object({
          locationSlug: z.string(),
          staffUserId: z.string(),
          role: z.enum(['FRONT_DESK', 'LOCATION_ADMIN', 'LOCATION_OWNER']),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const { db } = ctx
        const location = await locationBySlug(db, input.locationSlug)
        ctx.assertLocationRole(location.id)
        const existing = await db.staffRole.findFirst({
          where: { staffUserId: input.staffUserId, locationId: location.id },
        })
        if (existing) {
          await db.staffRole.update({ where: { id: existing.id }, data: { role: input.role } })
        } else {
          await db.staffRole.create({
            data: {
              id: id(),
              staffUserId: input.staffUserId,
              role: input.role,
              locationId: location.id,
            },
          })
        }
        return { staffUserId: input.staffUserId, role: input.role }
      }),

    deactivate: ownerProcedure
      .input(z.object({ locationSlug: z.string(), staffUserId: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const { db } = ctx
        const location = await locationBySlug(db, input.locationSlug)
        ctx.assertLocationRole(location.id)
        const role = await db.staffRole.findFirst({
          where: { staffUserId: input.staffUserId, locationId: location.id },
        })
        if (!role) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'That staff member has no role at this location',
          })
        }
        await db.staffUser.update({
          where: { id: input.staffUserId },
          data: { active: false },
        })
        return { staffUserId: input.staffUserId, active: false }
      }),
  }),

  waivers: router({
    publish: adminProcedure
      .input(
        z.object({
          locationId: z.string(),
          kind: z.enum(['LIABILITY', 'MINOR_CONSENT', 'PRIVACY']),
          title: z.string().min(1),
          bodyMarkdown: z.string().min(1),
          dryRun: z.boolean().default(false),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const { db } = ctx
        const location = await db.location.findUnique({ where: { id: input.locationId } })
        if (!location) throw new TRPCError({ code: 'NOT_FOUND', message: 'Location not found' })
        ctx.assertLocationRole(location.id)
        const now = ctx.now()
        const kind = input.kind as WaiverKind

        const latest = await db.waiverDocument.findFirst({
          where: { locationId: location.id, kind },
          orderBy: { version: 'desc' },
        })
        const nextVersion = (latest?.version ?? 0) + 1

        // Everyone who signed a previous version needs a re-sign.
        const priorSignatures = await db.waiverSignature.findMany({
          where: { locationId: location.id, waiverDocument: { kind } },
          select: { customerId: true },
        })
        const customersNeedingResign = new Set(priorSignatures.map((s) => s.customerId)).size

        if (input.dryRun) {
          return { dryRun: true, nextVersion, customersNeedingResign, waiverDocumentId: null }
        }

        const docId = id()
        const contentSha256 = createHash('sha256').update(input.bodyMarkdown).digest('hex')
        await db.$transaction(async (tx) => {
          await tx.waiverDocument.updateMany({
            where: { locationId: location.id, kind, active: true },
            data: { active: false },
          })
          await tx.waiverDocument.create({
            data: {
              id: docId,
              locationId: location.id,
              kind,
              version: nextVersion,
              title: input.title,
              bodyMarkdown: input.bodyMarkdown,
              contentSha256,
              publishedAt: now,
              active: true,
            },
          })
          await audit(tx, {
            actorType: 'STAFF',
            actorId: ctx.staff.user.id,
            locationId: location.id,
            action: 'admin.waiver_publish',
            entityType: 'WaiverDocument',
            entityId: docId,
            after: { kind, version: nextVersion, contentSha256, customersNeedingResign },
          })
        })
        return { dryRun: false, nextVersion, customersNeedingResign, waiverDocumentId: docId }
      }),
  }),

  dashboard: router({
    today: adminProcedure
      .input(z.object({ locationSlug: z.string() }))
      .query(async ({ ctx, input }) => {
        const { db } = ctx
        const location = await locationBySlug(db, input.locationSlug)
        ctx.assertLocationRole(location.id)
        const now = ctx.now()
        const tz = location.timezone
        const todayKey = localDateKey(now, tz)
        const tomorrowKey = localDateKey(new Date(now.getTime() + DAY_MS), tz)

        // Revenue today: SUM of PAID order totals created on the local day.
        const recentOrders = await db.order.findMany({
          where: {
            locationId: location.id,
            status: OrderStatus.PAID,
            createdAt: {
              gte: new Date(now.getTime() - 2 * DAY_MS),
              lte: new Date(now.getTime() + DAY_MS),
            },
          },
        })
        const revenueCents = recentOrders
          .filter((o) => localDateKey(o.createdAt, tz) === todayKey)
          .reduce((sum, o) => sum + o.totalCents, 0)

        // Utilization today: booked / capacity across today's sessions.
        const sessions = await db.session.findMany({
          where: {
            locationId: location.id,
            startsAt: {
              gte: new Date(now.getTime() - 1.5 * DAY_MS),
              lte: new Date(now.getTime() + 1.5 * DAY_MS),
            },
            status: { in: [SessionStatus.OPEN, SessionStatus.CLOSED, SessionStatus.EXCLUSIVE] },
          },
        })
        const todays = sessions.filter((s) => localDateKey(s.startsAt, tz) === todayKey)
        const bookedSeats = todays.reduce((sum, s) => sum + s.bookedSeats, 0)
        const capacitySeats = todays.reduce((sum, s) => sum + s.capacity, 0)

        // Unsigned waivers among tomorrow's confirmed bookings.
        const tomorrowBookings = await db.booking.findMany({
          where: {
            locationId: location.id,
            status: BookingStatus.CONFIRMED,
            startsAt: {
              gte: new Date(now.getTime() - DAY_MS),
              lte: new Date(now.getTime() + 3 * DAY_MS),
            },
          },
        })
        const tomorrows = tomorrowBookings.filter(
          (b) => localDateKey(b.startsAt, tz) === tomorrowKey,
        )
        let unsignedWaiversTomorrow = 0
        for (const booking of tomorrows) {
          const waiver = await waiverStatusFor(db, location.id, booking.customerId)
          if (waiver !== 'SIGNED') unsignedWaiversTomorrow += 1
        }

        return {
          date: todayKey,
          revenueCents,
          bookedSeats,
          capacitySeats,
          unsignedWaiversTomorrow,
        }
      }),
  }),
})
