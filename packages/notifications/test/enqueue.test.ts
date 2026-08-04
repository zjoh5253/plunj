import { describe, expect, it } from 'vitest'
import { enqueue, enqueueBookingLifecycle } from '../src/index.js'
import type { OutboxCreateData, OutboxTx } from '../src/index.js'

function fakeTx(): { tx: OutboxTx; created: OutboxCreateData[] } {
  const created: OutboxCreateData[] = []
  const tx: OutboxTx = {
    outboxMessage: {
      create: async ({ data }) => {
        created.push(data)
        return data
      },
    },
  }
  return { tx, created }
}

const confirmed = {
  firstName: 'Maya',
  locationName: 'Provo',
  dateTimeLocal: 'Sat, Aug 9 at 7:00 AM',
  seats: 2,
  manageUrl: 'https://plunj.co/book/manage/abc',
}

const reminder24h = {
  firstName: 'Maya',
  locationName: 'Provo',
  dateTimeLocal: 'Sat, Aug 9 at 7:00 AM',
  unsignedCount: 1,
  waiverUrl: 'https://plunj.co/book/waiver/abc',
}

const reminder2h = { firstName: 'Maya', locationName: 'Provo', timeLocal: '7:00 AM' }

describe('enqueue', () => {
  it('inserts a PENDING row with the given fields', async () => {
    const { tx, created } = fakeTx()
    const scheduledFor = new Date('2026-08-05T12:00:00Z')
    const result = await enqueue(tx, {
      kind: 'SMS',
      template: 'otp-code',
      recipient: '+18015550100',
      payload: { code: '123456' },
      locationId: 'loc_1',
      scheduledFor,
    })

    expect(created).toHaveLength(1)
    const row = created[0]!
    expect(row).toMatchObject({
      kind: 'SMS',
      template: 'otp-code',
      recipient: '+18015550100',
      payload: { code: '123456' },
      locationId: 'loc_1',
      scheduledFor,
      status: 'PENDING',
      attempts: 0,
    })
    expect(typeof row.id).toBe('string')
    expect(row.id.length).toBeGreaterThan(0)
    expect(result).toEqual({ id: row.id, kind: 'SMS', template: 'otp-code', scheduledFor })
  })

  it('defaults scheduledFor to now and locationId to null', async () => {
    const { tx, created } = fakeTx()
    const before = Date.now()
    await enqueue(tx, {
      kind: 'EMAIL',
      template: 'booking-confirmed',
      recipient: 'maya@example.com',
      payload: confirmed,
    })
    const row = created[0]!
    expect(row.locationId).toBeNull()
    expect(row.scheduledFor.getTime()).toBeGreaterThanOrEqual(before)
    expect(row.scheduledFor.getTime()).toBeLessThanOrEqual(Date.now())
  })
})

describe('enqueueBookingLifecycle', () => {
  const now = new Date('2026-08-05T12:00:00Z')

  it('enqueues confirmation now plus both reminders when the session is far out', async () => {
    const { tx, created } = fakeTx()
    const sessionStartsAt = new Date('2026-08-08T13:00:00Z') // 3 days out
    const enqueued = await enqueueBookingLifecycle(tx, {
      smsRecipient: '+18015550100',
      emailRecipient: 'maya@example.com',
      locationId: 'loc_1',
      sessionStartsAt,
      confirmed,
      reminder24h,
      reminder2h,
      now,
    })

    expect(enqueued.map((m) => [m.kind, m.template])).toEqual([
      ['SMS', 'booking-confirmed'],
      ['EMAIL', 'booking-confirmed'],
      ['SMS', 'booking-reminder-24h'],
      ['SMS', 'booking-reminder-2h'],
    ])
    expect(created[0]!.scheduledFor).toEqual(now)
    expect(created[1]!.recipient).toBe('maya@example.com')
    expect(created[2]!.scheduledFor).toEqual(new Date('2026-08-07T13:00:00Z'))
    expect(created[3]!.scheduledFor).toEqual(new Date('2026-08-08T11:00:00Z'))
    expect(created.every((r) => r.locationId === 'loc_1')).toBe(true)
  })

  it('skips the 24h reminder when the session is less than 24h away', async () => {
    const { tx, created } = fakeTx()
    await enqueueBookingLifecycle(tx, {
      smsRecipient: '+18015550100',
      sessionStartsAt: new Date('2026-08-06T00:00:00Z'), // 12h out
      confirmed,
      reminder24h,
      reminder2h,
      now,
    })
    const templates = created.map((r) => r.template)
    expect(templates).toEqual(['booking-confirmed', 'booking-reminder-2h'])
  })

  it('skips both reminders when the session is less than 2h away', async () => {
    const { tx, created } = fakeTx()
    await enqueueBookingLifecycle(tx, {
      smsRecipient: '+18015550100',
      sessionStartsAt: new Date('2026-08-05T13:00:00Z'), // 1h out
      confirmed,
      reminder24h,
      reminder2h,
      now,
    })
    expect(created.map((r) => r.template)).toEqual(['booking-confirmed'])
  })

  it('omits the email when no emailRecipient is provided', async () => {
    const { tx, created } = fakeTx()
    await enqueueBookingLifecycle(tx, {
      smsRecipient: '+18015550100',
      sessionStartsAt: new Date('2026-08-08T13:00:00Z'),
      confirmed,
      reminder24h,
      reminder2h,
      now,
    })
    expect(created.filter((r) => r.kind === 'EMAIL')).toHaveLength(0)
  })
})
