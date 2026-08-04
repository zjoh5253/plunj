import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PrismaClient } from '@plunj/db'
import { applyTemplateChanges, generateSessions, tryReserveSeats } from '../src/index.js'
import { createClient, seedLocation, seedTemplate } from './helpers.js'

describe('generateSessions', () => {
  let db: PrismaClient

  beforeAll(() => {
    db = createClient()
  })

  afterAll(async () => {
    await db.$disconnect()
  })

  it('is idempotent: a double run creates 0 new sessions', async () => {
    const { location, studio } = await seedLocation(db)
    await seedTemplate(db, studio, { dayOfWeek: 3, startTimeLocal: '10:00' })

    const now = new Date('2026-06-10T18:00:00Z')
    const first = await generateSessions(db, { locationId: location.id, horizonDays: 13, now })
    expect(first.created).toBeGreaterThan(0)
    expect(first.created).toBe(first.scanned)

    const second = await generateSessions(db, { locationId: location.id, horizonDays: 13, now })
    expect(second.scanned).toBe(first.scanned)
    expect(second.created).toBe(0)

    const count = await db.session.count({ where: { locationId: location.id } })
    expect(count).toBe(first.created)
  })

  it('DST spring forward: a nonexistent 02:30 resolves forward through the gap (America/Denver 2026-03-08)', async () => {
    const { location, studio } = await seedLocation(db, { timezone: 'America/Denver' })
    // 2026-03-08 is the second Sunday of March (dayOfWeek 0): 02:00–03:00 MST does not exist.
    await seedTemplate(db, studio, { dayOfWeek: 0, startTimeLocal: '02:30' })
    // Control: the same wall time the day after the transition (Monday, plain MDT).
    await seedTemplate(db, studio, { dayOfWeek: 1, startTimeLocal: '02:30' })

    const now = new Date('2026-03-07T12:00:00Z') // local Sat 2026-03-07
    await generateSessions(db, { locationId: location.id, horizonDays: 2, now })

    const sessions = await db.session.findMany({
      where: { locationId: location.id },
      orderBy: { startsAt: 'asc' },
    })
    expect(sessions).toHaveLength(2)
    // Nonexistent 02:30 -> next valid instant 03:30 MDT = 09:30Z (not dropped, not 02:30 MST).
    expect(sessions[0]!.startsAt.toISOString()).toBe('2026-03-08T09:30:00.000Z')
    expect(sessions[0]!.endsAt.toISOString()).toBe('2026-03-08T10:30:00.000Z')
    // Monday 02:30 MDT = 08:30Z.
    expect(sessions[1]!.startsAt.toISOString()).toBe('2026-03-09T08:30:00.000Z')
  })

  it('DST fall back: an ambiguous 01:30 resolves to the earlier offset (America/Denver 2026-11-01)', async () => {
    const { location, studio } = await seedLocation(db, { timezone: 'America/Denver' })
    // 2026-11-01 is the first Sunday of November (dayOfWeek 0): 01:00–02:00 occurs twice.
    await seedTemplate(db, studio, { dayOfWeek: 0, startTimeLocal: '01:30' })
    // Control: same wall time the day after (Monday, plain MST).
    await seedTemplate(db, studio, { dayOfWeek: 1, startTimeLocal: '01:30' })

    const now = new Date('2026-10-31T12:00:00Z') // local Sat 2026-10-31
    await generateSessions(db, { locationId: location.id, horizonDays: 2, now })

    const sessions = await db.session.findMany({
      where: { locationId: location.id },
      orderBy: { startsAt: 'asc' },
    })
    expect(sessions).toHaveLength(2)
    // Ambiguous 01:30 -> EARLIER offset: 01:30 MDT = 07:30Z (not 01:30 MST = 08:30Z).
    expect(sessions[0]!.startsAt.toISOString()).toBe('2026-11-01T07:30:00.000Z')
    // Monday 01:30 MST = 08:30Z.
    expect(sessions[1]!.startsAt.toISOString()).toBe('2026-11-02T08:30:00.000Z')
  })

  it('windows by horizon (inclusive) and defaults to location.bookingWindowDays', async () => {
    const { location, studio } = await seedLocation(db, { bookingWindowDays: 3 })
    for (let dow = 0; dow < 7; dow++) {
      await seedTemplate(db, studio, { dayOfWeek: dow, startTimeLocal: '10:00' })
    }

    const now = new Date('2026-06-10T18:00:00Z') // local Wed 2026-06-10, 12:00 MDT
    // Default horizon = bookingWindowDays = 3 -> Jun 10..13 inclusive = 4 sessions.
    const byDefault = await generateSessions(db, { locationId: location.id, now })
    expect(byDefault.created).toBe(4)

    // Explicit horizon 9 -> Jun 10..19 = 10 daily sessions; 4 already exist.
    const extended = await generateSessions(db, { locationId: location.id, horizonDays: 9, now })
    expect(extended.scanned).toBe(10)
    expect(extended.created).toBe(6)
  })

  it('respects effectiveFrom/effectiveUntil as location-local calendar dates', async () => {
    const { location, studio } = await seedLocation(db)
    for (let dow = 0; dow < 7; dow++) {
      await seedTemplate(db, studio, {
        dayOfWeek: dow,
        startTimeLocal: '10:00',
        effectiveFrom: new Date('2026-06-13'),
        effectiveUntil: new Date('2026-06-15'),
      })
    }

    const now = new Date('2026-06-10T18:00:00Z')
    const result = await generateSessions(db, { locationId: location.id, horizonDays: 9, now })
    expect(result.created).toBe(3) // Jun 13, 14, 15 only

    const sessions = await db.session.findMany({
      where: { locationId: location.id },
      orderBy: { startsAt: 'asc' },
    })
    expect(sessions.map((s) => s.startsAt.toISOString())).toEqual([
      '2026-06-13T16:00:00.000Z',
      '2026-06-14T16:00:00.000Z',
      '2026-06-15T16:00:00.000Z',
    ])
  })

  it('Provo-like schedules: weekday and weekend hours differ per template dayOfWeek', async () => {
    const { location, studio } = await seedLocation(db)
    for (const dow of [1, 2, 3, 4, 5]) {
      await seedTemplate(db, studio, { dayOfWeek: dow, startTimeLocal: '06:00', priceCents: 4000 })
    }
    for (const dow of [0, 6]) {
      await seedTemplate(db, studio, { dayOfWeek: dow, startTimeLocal: '08:00', priceCents: 5000 })
    }

    const now = new Date('2026-06-08T12:00:00Z') // local Mon 2026-06-08
    await generateSessions(db, { locationId: location.id, horizonDays: 6, now })

    const sessions = await db.session.findMany({
      where: { locationId: location.id },
      orderBy: { startsAt: 'asc' },
    })
    expect(sessions).toHaveLength(7)
    for (const session of sessions) {
      const dow = new Date(session.startsAt).getUTCDay() // 06:00/08:00 MDT stay same UTC day
      const isWeekend = dow === 0 || dow === 6
      // June MDT = UTC-6: weekday 06:00 local = 12:00Z, weekend 08:00 local = 14:00Z.
      expect(session.startsAt.toISOString().slice(11, 16)).toBe(isWeekend ? '14:00' : '12:00')
      expect(session.priceCents).toBe(isWeekend ? 5000 : 4000)
    }
  })

  it('capacity falls back template.capacity ?? studio.defaultCapacity', async () => {
    const { location, studio } = await seedLocation(db, { defaultCapacity: 6 })
    await seedTemplate(db, studio, { dayOfWeek: 3, startTimeLocal: '09:00', capacity: 2 })
    await seedTemplate(db, studio, { dayOfWeek: 3, startTimeLocal: '11:00', capacity: null })

    const now = new Date('2026-06-10T18:00:00Z') // Wednesday
    await generateSessions(db, { locationId: location.id, horizonDays: 0, now })

    const sessions = await db.session.findMany({
      where: { locationId: location.id },
      orderBy: { startsAt: 'asc' },
    })
    expect(sessions.map((s) => s.capacity)).toEqual([2, 6])
  })

  it('skips inactive templates and inactive studios', async () => {
    const { location, studio } = await seedLocation(db)
    await seedTemplate(db, studio, { dayOfWeek: 3, startTimeLocal: '10:00', active: false })

    const now = new Date('2026-06-10T18:00:00Z')
    const result = await generateSessions(db, { locationId: location.id, horizonDays: 6, now })
    expect(result.scanned).toBe(0)
    expect(result.created).toBe(0)
  })
})

describe('applyTemplateChanges', () => {
  let db: PrismaClient

  beforeAll(() => {
    db = createClient()
  })

  afterAll(async () => {
    await db.$disconnect()
  })

  it('deletes empty future sessions and reports booked ones as conflicts', async () => {
    const { location, studio } = await seedLocation(db)
    const template = await seedTemplate(db, studio, { dayOfWeek: 3, startTimeLocal: '10:00' })

    const now = new Date('2026-06-10T12:00:00Z')
    await generateSessions(db, { locationId: location.id, horizonDays: 20, now })
    const sessions = await db.session.findMany({
      where: { templateId: template.id },
      orderBy: { startsAt: 'asc' },
    })
    expect(sessions).toHaveLength(3) // Jun 10, 17, 24

    // A customer books a seat on the middle session — it must survive.
    const booked = sessions[1]!
    expect(await tryReserveSeats(db, { sessionId: booked.id, seats: 1 })).toBe(true)

    const result = await applyTemplateChanges(db, { templateId: template.id, now })
    expect(result.deleted).toBe(2)
    expect(result.conflicts.map((s) => s.id)).toEqual([booked.id])

    const remaining = await db.session.findMany({ where: { templateId: template.id } })
    expect(remaining.map((s) => s.id)).toEqual([booked.id])
  })
})
