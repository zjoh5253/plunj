/**
 * Outbox drain — run from cron. Claims due PENDING rows one at a time with an optimistic
 * conditional update (the schema has no SENDING status, so the claim bumps `scheduledFor` into
 * the future while the WHERE clause still requires the row to be due; an overlapping cron run
 * loses the race and skips the row). Renders via the template registry, sends through the
 * injected senders, and never lets one bad message break the batch.
 *
 * Retry policy: on failure the row stays PENDING with `scheduledFor` pushed out on an
 * exponential-ish backoff (+1min, +5min, +30min, +30min), and goes FAILED permanently once it
 * has been attempted MAX_ATTEMPTS (5) times.
 */

import {
  isEmailTemplate,
  isSmsTemplate,
  renderEmail,
  renderSms,
  type EmailContent,
  type EmailTemplatePayloads,
  type SmsTemplatePayloads,
} from './templates.js'
import type { EmailSender, SmsSender } from './senders.js'

export const MAX_ATTEMPTS = 5

const MINUTE_MS = 60 * 1000
/** Backoff after the Nth failed attempt (1-indexed). */
const BACKOFF_MINUTES = [1, 5, 30, 30] as const

// ---------------------------------------------------------------------------
// Minimal prisma surface
// ---------------------------------------------------------------------------

export interface OutboxRow {
  id: string
  kind: 'SMS' | 'EMAIL'
  recipient: string
  template: string
  payload: unknown
  scheduledFor: Date
  attempts: number
}

export interface OutboxUpdateData {
  status?: 'PENDING' | 'SENT' | 'FAILED'
  attempts?: number
  scheduledFor?: Date
  sentAt?: Date
  lastError?: string | null
}

/**
 * The slice of PrismaClient that drainOutbox needs. Structurally compatible with the real
 * client from @plunj/db; tests provide an in-memory stub.
 */
export interface OutboxDb {
  outboxMessage: {
    findMany(args: {
      where: { status: 'PENDING'; scheduledFor: { lte: Date } }
      orderBy: { scheduledFor: 'asc' }
      take: number
    }): Promise<OutboxRow[]>
    updateMany(args: {
      where: { id: string; status: 'PENDING'; scheduledFor: { lte: Date } }
      data: OutboxUpdateData
    }): Promise<{ count: number }>
    update(args: { where: { id: string }; data: OutboxUpdateData }): Promise<unknown>
  }
}

// ---------------------------------------------------------------------------
// drain
// ---------------------------------------------------------------------------

export interface DrainOptions {
  smsSender: SmsSender
  emailSender: EmailSender
  /** Injectable clock; defaults to `new Date()`. */
  now?: Date
  batchSize?: number
}

export interface DrainResult {
  sent: number
  failed: number
  retried: number
}

function backoffAt(now: Date, attempts: number): Date {
  const minutes = BACKOFF_MINUTES[Math.min(attempts, BACKOFF_MINUTES.length) - 1] ?? 30
  return new Date(now.getTime() + minutes * MINUTE_MS)
}

function renderAndValidate(row: OutboxRow): { sms: string } | { email: EmailContent } {
  if (row.kind === 'SMS') {
    if (!isSmsTemplate(row.template)) {
      throw new Error(`unknown SMS template: ${row.template}`)
    }
    return { sms: renderSms(row.template, row.payload as SmsTemplatePayloads[typeof row.template]) }
  }
  if (!isEmailTemplate(row.template)) {
    throw new Error(`unknown EMAIL template: ${row.template}`)
  }
  return {
    email: renderEmail(row.template, row.payload as EmailTemplatePayloads[typeof row.template]),
  }
}

/**
 * Drain due outbox messages. Safe to run concurrently (overlapping cron runs) — the per-row
 * conditional claim guarantees a message is only sent once. Returns counters; never throws for
 * per-message errors.
 */
export async function drainOutbox(db: OutboxDb, options: DrainOptions): Promise<DrainResult> {
  const now = options.now ?? new Date()
  const batchSize = options.batchSize ?? 50
  const result: DrainResult = { sent: 0, failed: 0, retried: 0 }

  const due = await db.outboxMessage.findMany({
    where: { status: 'PENDING', scheduledFor: { lte: now } },
    orderBy: { scheduledFor: 'asc' },
    take: batchSize,
  })

  for (const row of due) {
    const attempts = row.attempts + 1
    try {
      // Optimistic claim: the WHERE re-checks that the row is still PENDING and still due, and
      // the update pushes scheduledFor into the future, so a concurrent drainer's claim on the
      // same row matches zero rows. The bumped scheduledFor doubles as the retry time if the
      // send below fails.
      const claimed = await db.outboxMessage.updateMany({
        where: { id: row.id, status: 'PENDING', scheduledFor: { lte: now } },
        data: { attempts, scheduledFor: backoffAt(now, attempts) },
      })
      if (claimed.count === 0) continue
    } catch {
      // Claim itself failed (db error) — leave the row untouched for the next run.
      continue
    }

    try {
      const rendered = renderAndValidate(row)
      if ('sms' in rendered) {
        await options.smsSender.sendSms(row.recipient, rendered.sms)
      } else {
        await options.emailSender.sendEmail(row.recipient, rendered.email)
      }
      await db.outboxMessage.update({
        where: { id: row.id },
        data: { status: 'SENT', sentAt: now, lastError: null },
      })
      result.sent += 1
    } catch (error) {
      const lastError = error instanceof Error ? error.message : String(error)
      const permanent = attempts >= MAX_ATTEMPTS
      try {
        await db.outboxMessage.update({
          where: { id: row.id },
          // On retry the claim already set the backed-off scheduledFor; just record the error.
          data: permanent ? { status: 'FAILED', lastError } : { lastError },
        })
      } catch {
        // Even the bookkeeping write failed — swallow so the rest of the batch still drains.
      }
      if (permanent) result.failed += 1
      else result.retried += 1
    }
  }

  return result
}
