/**
 * Outbox enqueue helpers.
 *
 * Invariant (CLAUDE.md #8): notifications are never sent inline — they are written to the
 * OutboxMessage table in the SAME transaction as the domain state change they announce, then
 * drained by cron (see drain.ts). Pass the transaction client (`tx`) from `prisma.$transaction`.
 */

import { id } from '@plunj/db'
import type {
  BookingConfirmedPayload,
  BookingReminder2hPayload,
  BookingReminder24hPayload,
  EmailTemplateName,
  EmailTemplatePayloads,
  SmsTemplateName,
  SmsTemplatePayloads,
} from './templates.js'

// ---------------------------------------------------------------------------
// Minimal prisma surface
// ---------------------------------------------------------------------------

export interface OutboxCreateData {
  id: string
  locationId: string | null
  kind: 'SMS' | 'EMAIL'
  recipient: string
  template: string
  payload: unknown
  scheduledFor: Date
  status: 'PENDING'
  attempts: number
}

/**
 * The slice of a Prisma transaction client that enqueue needs. Structurally compatible with
 * `Prisma.TransactionClient` and `PrismaClient` from @plunj/db.
 */
export interface OutboxTx {
  outboxMessage: {
    create(args: { data: OutboxCreateData }): Promise<unknown>
  }
}

// ---------------------------------------------------------------------------
// enqueue
// ---------------------------------------------------------------------------

type SmsEnqueue = {
  [K in SmsTemplateName]: { kind: 'SMS'; template: K; payload: SmsTemplatePayloads[K] }
}[SmsTemplateName]

type EmailEnqueue = {
  [K in EmailTemplateName]: { kind: 'EMAIL'; template: K; payload: EmailTemplatePayloads[K] }
}[EmailTemplateName]

export type EnqueueInput = (SmsEnqueue | EmailEnqueue) & {
  recipient: string
  locationId?: string
  /** When the message becomes due. Defaults to now (send on next drain). */
  scheduledFor?: Date
}

export interface EnqueuedMessage {
  id: string
  kind: 'SMS' | 'EMAIL'
  template: string
  scheduledFor: Date
}

/**
 * Insert a PENDING OutboxMessage row. Call inside the same transaction as the domain write.
 * The (template, payload) pair is a discriminated union, so a wrong payload shape for a given
 * template is a compile error.
 */
export async function enqueue(tx: OutboxTx, input: EnqueueInput): Promise<EnqueuedMessage> {
  const scheduledFor = input.scheduledFor ?? new Date()
  const row: OutboxCreateData = {
    id: id(),
    locationId: input.locationId ?? null,
    kind: input.kind,
    recipient: input.recipient,
    template: input.template,
    payload: input.payload,
    scheduledFor,
    status: 'PENDING',
    attempts: 0,
  }
  await tx.outboxMessage.create({ data: row })
  return { id: row.id, kind: row.kind, template: row.template, scheduledFor }
}

// ---------------------------------------------------------------------------
// Booking lifecycle convenience
// ---------------------------------------------------------------------------

const HOUR_MS = 60 * 60 * 1000

export interface BookingLifecycleArgs {
  /** Customer phone number (E.164) for the confirmation SMS + reminders. */
  smsRecipient: string
  /** When provided, also enqueues the booking-confirmed email. */
  emailRecipient?: string
  locationId?: string
  /** Session start as a UTC instant — reminders are scheduled 24h/2h before it. */
  sessionStartsAt: Date
  confirmed: BookingConfirmedPayload
  reminder24h: BookingReminder24hPayload
  reminder2h: BookingReminder2hPayload
  /** Injectable clock for tests; defaults to `new Date()`. */
  now?: Date
}

/**
 * Enqueue the standard booking lifecycle: confirmation (SMS, plus email when we have an address)
 * immediately, and 24h/2h SMS reminders relative to `sessionStartsAt`. Reminders whose send time
 * is already in the past are skipped (e.g. a booking made 90 minutes before the session gets no
 * 24h reminder).
 */
export async function enqueueBookingLifecycle(
  tx: OutboxTx,
  args: BookingLifecycleArgs,
): Promise<EnqueuedMessage[]> {
  const now = args.now ?? new Date()
  const shared = args.locationId !== undefined ? { locationId: args.locationId } : {}
  const enqueued: EnqueuedMessage[] = []

  enqueued.push(
    await enqueue(tx, {
      kind: 'SMS',
      template: 'booking-confirmed',
      recipient: args.smsRecipient,
      payload: args.confirmed,
      scheduledFor: now,
      ...shared,
    }),
  )

  if (args.emailRecipient !== undefined) {
    enqueued.push(
      await enqueue(tx, {
        kind: 'EMAIL',
        template: 'booking-confirmed',
        recipient: args.emailRecipient,
        payload: args.confirmed,
        scheduledFor: now,
        ...shared,
      }),
    )
  }

  const startMs = args.sessionStartsAt.getTime()

  const at24h = new Date(startMs - 24 * HOUR_MS)
  if (at24h.getTime() > now.getTime()) {
    enqueued.push(
      await enqueue(tx, {
        kind: 'SMS',
        template: 'booking-reminder-24h',
        recipient: args.smsRecipient,
        payload: args.reminder24h,
        scheduledFor: at24h,
        ...shared,
      }),
    )
  }

  const at2h = new Date(startMs - 2 * HOUR_MS)
  if (at2h.getTime() > now.getTime()) {
    enqueued.push(
      await enqueue(tx, {
        kind: 'SMS',
        template: 'booking-reminder-2h',
        recipient: args.smsRecipient,
        payload: args.reminder2h,
        scheduledFor: at2h,
        ...shared,
      }),
    )
  }

  return enqueued
}
