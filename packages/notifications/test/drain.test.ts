import { describe, expect, it } from 'vitest'
import { FakeEmailSender, FakeSmsSender, drainOutbox } from '../src/index.js'
import type { OutboxDb, OutboxUpdateData } from '../src/index.js'

interface MemoryRow {
  id: string
  locationId: string | null
  kind: 'SMS' | 'EMAIL'
  recipient: string
  template: string
  payload: unknown
  scheduledFor: Date
  sentAt: Date | null
  status: 'PENDING' | 'SENT' | 'FAILED'
  attempts: number
  lastError: string | null
}

/** In-memory stub of the tiny prisma surface drainOutbox uses. No real database. */
class MemoryOutbox implements OutboxDb {
  constructor(readonly rows: MemoryRow[]) {}

  private apply(row: MemoryRow, data: OutboxUpdateData): void {
    if (data.status !== undefined) row.status = data.status
    if (data.attempts !== undefined) row.attempts = data.attempts
    if (data.scheduledFor !== undefined) row.scheduledFor = data.scheduledFor
    if (data.sentAt !== undefined) row.sentAt = data.sentAt
    if (data.lastError !== undefined) row.lastError = data.lastError
  }

  outboxMessage = {
    findMany: async (args: {
      where: { status: 'PENDING'; scheduledFor: { lte: Date } }
      orderBy: { scheduledFor: 'asc' }
      take: number
    }) => {
      return this.rows
        .filter(
          (r) =>
            r.status === args.where.status &&
            r.scheduledFor.getTime() <= args.where.scheduledFor.lte.getTime(),
        )
        .sort((a, b) => a.scheduledFor.getTime() - b.scheduledFor.getTime())
        .slice(0, args.take)
        .map((r) => ({ ...r }))
    },

    updateMany: async (args: {
      where: { id: string; status: 'PENDING'; scheduledFor: { lte: Date } }
      data: OutboxUpdateData
    }) => {
      const matches = this.rows.filter(
        (r) =>
          r.id === args.where.id &&
          r.status === args.where.status &&
          r.scheduledFor.getTime() <= args.where.scheduledFor.lte.getTime(),
      )
      for (const row of matches) this.apply(row, args.data)
      return { count: matches.length }
    },

    update: async (args: { where: { id: string }; data: OutboxUpdateData }) => {
      const row = this.rows.find((r) => r.id === args.where.id)
      if (!row) throw new Error(`no row ${args.where.id}`)
      this.apply(row, args.data)
      return { ...row }
    },
  }

  get(id: string): MemoryRow {
    const row = this.rows.find((r) => r.id === id)
    if (!row) throw new Error(`no row ${id}`)
    return row
  }
}

let seq = 0
function row(overrides: Partial<MemoryRow> = {}): MemoryRow {
  seq += 1
  return {
    id: `msg_${seq}`,
    locationId: null,
    kind: 'SMS',
    recipient: '+18015550100',
    template: 'otp-code',
    payload: { code: '123456' },
    scheduledFor: new Date('2026-08-05T12:00:00Z'),
    sentAt: null,
    status: 'PENDING',
    attempts: 0,
    lastError: null,
    ...overrides,
  }
}

const NOW = new Date('2026-08-05T12:00:00Z')
const MIN = 60 * 1000

function senders() {
  return { smsSender: new FakeSmsSender(), emailSender: new FakeEmailSender() }
}

describe('drainOutbox', () => {
  it('sends due messages only, marks them SENT with sentAt', async () => {
    const due = row()
    const future = row({ scheduledFor: new Date(NOW.getTime() + 10 * MIN) })
    const db = new MemoryOutbox([due, future])
    const { smsSender, emailSender } = senders()

    const result = await drainOutbox(db, { smsSender, emailSender, now: NOW })

    expect(result).toEqual({ sent: 1, failed: 0, retried: 0 })
    expect(smsSender.sent).toEqual([{ to: '+18015550100', body: 'Your PLUNJ code: 123456' }])
    expect(db.get(due.id)).toMatchObject({ status: 'SENT', sentAt: NOW, attempts: 1 })
    expect(db.get(future.id)).toMatchObject({ status: 'PENDING', attempts: 0, sentAt: null })
  })

  it('routes EMAIL rows through the email sender', async () => {
    const db = new MemoryOutbox([
      row({
        kind: 'EMAIL',
        recipient: 'maya@example.com',
        template: 'booking-cancelled',
        payload: {
          firstName: 'Maya',
          locationName: 'Provo',
          dateTimeLocal: 'Sat, Aug 9 at 7:00 AM',
        },
      }),
    ])
    const { smsSender, emailSender } = senders()

    const result = await drainOutbox(db, { smsSender, emailSender, now: NOW })

    expect(result.sent).toBe(1)
    expect(smsSender.sent).toHaveLength(0)
    expect(emailSender.sent).toHaveLength(1)
    expect(emailSender.sent[0]!.to).toBe('maya@example.com')
    expect(emailSender.sent[0]!.subject).toContain('cancelled')
  })

  it('keeps failed messages PENDING with backoff +1min, +5min, +30min, +30min', async () => {
    const target = row()
    const db = new MemoryOutbox([target])
    const { smsSender, emailSender } = senders()
    smsSender.failWith = () => new Error('twilio is down')

    const expectedBackoffMin = [1, 5, 30, 30]
    let clock = NOW
    for (const [i, backoffMin] of expectedBackoffMin.entries()) {
      const result = await drainOutbox(db, { smsSender, emailSender, now: clock })
      expect(result).toEqual({ sent: 0, failed: 0, retried: 1 })
      const state = db.get(target.id)
      expect(state.status).toBe('PENDING')
      expect(state.attempts).toBe(i + 1)
      expect(state.lastError).toBe('twilio is down')
      expect(state.scheduledFor).toEqual(new Date(clock.getTime() + backoffMin * MIN))
      clock = state.scheduledFor
    }
  })

  it('does not retry a message before its backed-off scheduledFor', async () => {
    const target = row()
    const db = new MemoryOutbox([target])
    const { smsSender, emailSender } = senders()
    smsSender.failWith = () => new Error('nope')

    await drainOutbox(db, { smsSender, emailSender, now: NOW })
    expect(db.get(target.id).attempts).toBe(1)

    // 30 seconds later — before the +1min backoff elapses — nothing is due.
    const result = await drainOutbox(db, {
      smsSender,
      emailSender,
      now: new Date(NOW.getTime() + 30 * 1000),
    })
    expect(result).toEqual({ sent: 0, failed: 0, retried: 0 })
    expect(db.get(target.id).attempts).toBe(1)
  })

  it('goes FAILED permanently after 5 attempts', async () => {
    const target = row()
    const db = new MemoryOutbox([target])
    const { smsSender, emailSender } = senders()
    smsSender.failWith = () => new Error('still down')

    let clock = NOW
    let last = { sent: 0, failed: 0, retried: 0 }
    for (let i = 0; i < 5; i += 1) {
      last = await drainOutbox(db, { smsSender, emailSender, now: clock })
      clock = new Date(db.get(target.id).scheduledFor.getTime() + 1)
    }

    expect(last).toEqual({ sent: 0, failed: 1, retried: 0 })
    const state = db.get(target.id)
    expect(state.status).toBe('FAILED')
    expect(state.attempts).toBe(5)
    expect(state.lastError).toBe('still down')

    // A later drain never touches it again.
    const after = await drainOutbox(db, { smsSender, emailSender, now: clock })
    expect(after).toEqual({ sent: 0, failed: 0, retried: 0 })
    expect(db.get(target.id).attempts).toBe(5)
  })

  it('one throwing message does not block the rest of the batch', async () => {
    const bad = row({ recipient: '+1BAD' })
    const good1 = row({ recipient: '+18015550101' })
    const good2 = row({ recipient: '+18015550102' })
    const db = new MemoryOutbox([good1, bad, good2])
    const { smsSender, emailSender } = senders()
    smsSender.failWith = (to) => (to === '+1BAD' ? new Error('kaboom') : null)

    const result = await drainOutbox(db, { smsSender, emailSender, now: NOW })

    expect(result).toEqual({ sent: 2, failed: 0, retried: 1 })
    expect(smsSender.sent.map((s) => s.to)).toEqual(['+18015550101', '+18015550102'])
    expect(db.get(bad.id)).toMatchObject({ status: 'PENDING', attempts: 1, lastError: 'kaboom' })
    expect(db.get(good1.id).status).toBe('SENT')
    expect(db.get(good2.id).status).toBe('SENT')
  })

  it('a message with an unknown template is retried, not sent', async () => {
    const target = row({ template: 'not-a-template' })
    const db = new MemoryOutbox([target])
    const { smsSender, emailSender } = senders()

    const result = await drainOutbox(db, { smsSender, emailSender, now: NOW })

    expect(result).toEqual({ sent: 0, failed: 0, retried: 1 })
    expect(smsSender.sent).toHaveLength(0)
    expect(db.get(target.id).lastError).toContain('unknown SMS template')
  })

  it('skips rows another drainer claimed between findMany and the claim (count 0)', async () => {
    const contested = row()
    const db = new MemoryOutbox([contested])
    const inner = db.outboxMessage
    let stolen = false
    // Simulate an overlapping cron run stealing the row right before our claim.
    db.outboxMessage = {
      ...inner,
      updateMany: async (args) => {
        if (!stolen) {
          stolen = true
          await inner.updateMany({
            where: args.where,
            data: { attempts: 1, scheduledFor: new Date(NOW.getTime() + MIN) },
          })
        }
        return inner.updateMany(args)
      },
    }
    const { smsSender, emailSender } = senders()

    const result = await drainOutbox(db, { smsSender, emailSender, now: NOW })

    expect(result).toEqual({ sent: 0, failed: 0, retried: 0 })
    expect(smsSender.sent).toHaveLength(0)
    expect(db.get(contested.id)).toMatchObject({ status: 'PENDING', attempts: 1 })
  })

  it('respects batchSize', async () => {
    const rows = Array.from({ length: 5 }, () => row())
    const db = new MemoryOutbox(rows)
    const { smsSender, emailSender } = senders()

    const result = await drainOutbox(db, { smsSender, emailSender, now: NOW, batchSize: 2 })

    expect(result.sent).toBe(2)
    expect(rows.filter((r) => r.status === 'SENT')).toHaveLength(2)
  })
})
