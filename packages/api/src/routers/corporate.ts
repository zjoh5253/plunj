/**
 * Corporate roll-up: org-wide, CORPORATE_ADMIN only. Read-only aggregates —
 * intervention happens through each location's admin (visible in audit logs),
 * per the franchise-trust model.
 */

import { BookingStatus, LocationStatus, OrderStatus } from '@plunj/db'
import { localDateKey } from '../format.js'
import { corporateProcedure, router } from '../trpc.js'

const DAY_MS = 24 * 60 * 60 * 1000

export const corporateRouter = router({
  overview: corporateProcedure.query(async ({ ctx }) => {
    const { db } = ctx
    const now = ctx.now()
    const dayAgo = new Date(now.getTime() - DAY_MS)
    const monthAgo = new Date(now.getTime() - 30 * DAY_MS)
    const weekOut = new Date(now.getTime() + 7 * DAY_MS)

    const locations = await db.location.findMany({
      where: { status: LocationStatus.ACTIVE },
      orderBy: { name: 'asc' },
    })

    const [revenue24h, revenue30d, upcoming, sessionsWindow] = await Promise.all([
      db.order.groupBy({
        by: ['locationId'],
        where: {
          status: { in: [OrderStatus.PAID, OrderStatus.PARTIALLY_REFUNDED] },
          createdAt: { gte: dayAgo },
        },
        _sum: { totalCents: true },
      }),
      db.order.groupBy({
        by: ['locationId'],
        where: {
          status: { in: [OrderStatus.PAID, OrderStatus.PARTIALLY_REFUNDED] },
          createdAt: { gte: monthAgo },
        },
        _sum: { totalCents: true },
      }),
      db.booking.groupBy({
        by: ['locationId'],
        where: {
          status: { in: [BookingStatus.CONFIRMED, BookingStatus.CHECKED_IN] },
          startsAt: { gte: now, lte: weekOut },
        },
        _count: { _all: true },
        _sum: { seats: true },
      }),
      // ±36h window, bucketed to each location's local "today" below.
      db.session.findMany({
        where: {
          startsAt: {
            gte: new Date(now.getTime() - 1.5 * DAY_MS),
            lte: new Date(now.getTime() + 1.5 * DAY_MS),
          },
          status: { not: 'CANCELLED' },
        },
        select: {
          locationId: true,
          startsAt: true,
          capacity: true,
          bookedSeats: true,
        },
      }),
    ])

    const sumByLocation = <T extends { locationId: string }>(
      rows: T[],
      pick: (row: T) => number,
    ): Map<string, number> => {
      const m = new Map<string, number>()
      for (const row of rows) m.set(row.locationId, (m.get(row.locationId) ?? 0) + pick(row))
      return m
    }

    const rev24 = sumByLocation(revenue24h, (r) => r._sum.totalCents ?? 0)
    const rev30 = sumByLocation(revenue30d, (r) => r._sum.totalCents ?? 0)
    const upcomingSeats = sumByLocation(upcoming, (r) => r._sum.seats ?? 0)

    const rows = locations.map((location) => {
      const todayKey = localDateKey(now, location.timezone)
      let todayCapacity = 0
      let todayBooked = 0
      for (const s of sessionsWindow) {
        if (s.locationId !== location.id) continue
        if (localDateKey(s.startsAt, location.timezone) !== todayKey) continue
        todayCapacity += s.capacity
        todayBooked += s.bookedSeats
      }
      return {
        locationId: location.id,
        slug: location.slug,
        name: location.name,
        city: location.city,
        state: location.state,
        bookingProvider: location.bookingProvider,
        revenue24hCents: rev24.get(location.id) ?? 0,
        revenue30dCents: rev30.get(location.id) ?? 0,
        todayBookedSeats: todayBooked,
        todayCapacitySeats: todayCapacity,
        upcoming7dSeats: upcomingSeats.get(location.id) ?? 0,
      }
    })

    return {
      asOf: now.toISOString(),
      locations: rows,
      totals: {
        revenue24hCents: rows.reduce((a, r) => a + r.revenue24hCents, 0),
        revenue30dCents: rows.reduce((a, r) => a + r.revenue30dCents, 0),
        todayBookedSeats: rows.reduce((a, r) => a + r.todayBookedSeats, 0),
        todayCapacitySeats: rows.reduce((a, r) => a + r.todayCapacitySeats, 0),
        upcoming7dSeats: rows.reduce((a, r) => a + r.upcoming7dSeats, 0),
      },
    }
  }),
})
