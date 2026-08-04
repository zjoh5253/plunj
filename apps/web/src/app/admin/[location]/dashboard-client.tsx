'use client'

/**
 * Thin dashboard: today's revenue (verbatim server cents), utilization as the
 * server's raw booked/capacity counts side by side (no client percentage
 * math), and an unsigned-waivers-for-tomorrow alert. All numbers come from
 * admin.dashboard.today unchanged.
 */

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { useStaffGuard } from '@/components/admin/staff'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import type { LocationDetail } from '@/lib/api-types'
import { formatCents, formatDateKeyLong } from '@/lib/format'
import { useTRPC } from '@/lib/trpc/client'

export function DashboardClient({ location }: { location: LocationDetail }) {
  const trpc = useTRPC()
  const today = useQuery(trpc.admin.dashboard.today.queryOptions({ locationSlug: location.slug }))
  useStaffGuard(today.error)

  const data = today.data

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="mt-1 text-sm text-gray-500">
          {data ? formatDateKeyLong(data.date) : 'Today'} · {location.name}
        </p>
      </div>

      {today.isError ? (
        <Card>
          <p className="text-sm text-danger">
            {(today.error as { message?: string } | null)?.message ??
              'Could not load the dashboard.'}
          </p>
        </Card>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card className="flex flex-col gap-1">
          <span className="text-sm font-medium uppercase tracking-wide text-gray-500">
            Revenue today
          </span>
          {data ? (
            <span className="text-3xl font-semibold tabular-nums tracking-tight">
              {formatCents(data.revenueCents)}
            </span>
          ) : (
            <Skeleton className="h-9 w-28" />
          )}
          <span className="text-sm text-gray-500">Paid orders, location-local day</span>
        </Card>

        <Card className="flex flex-col gap-1">
          <span className="text-sm font-medium uppercase tracking-wide text-gray-500">
            Utilization today
          </span>
          {data ? (
            <span className="text-3xl font-semibold tabular-nums tracking-tight">
              {data.bookedSeats}/{data.capacitySeats}
              <span className="ml-2 text-base font-normal text-gray-500">booked</span>
            </span>
          ) : (
            <Skeleton className="h-9 w-28" />
          )}
          <span className="text-sm text-gray-500">Seats booked across today&apos;s sessions</span>
        </Card>

        <Card
          className={`flex flex-col gap-1 ${
            data && data.unsignedWaiversTomorrow > 0 ? 'border-warn/40' : ''
          }`}
        >
          <span className="text-sm font-medium uppercase tracking-wide text-gray-500">
            Waivers tomorrow
          </span>
          {data ? (
            data.unsignedWaiversTomorrow > 0 ? (
              <>
                <span className="text-3xl font-semibold tabular-nums tracking-tight text-warn">
                  {data.unsignedWaiversTomorrow}
                </span>
                <span className="text-sm text-warn">
                  {data.unsignedWaiversTomorrow === 1
                    ? 'booking for tomorrow has an unsigned waiver'
                    : 'bookings for tomorrow have unsigned waivers'}
                </span>
              </>
            ) : (
              <>
                <span className="text-3xl font-semibold tabular-nums tracking-tight text-ok">
                  0
                </span>
                <span className="text-sm text-gray-500">Everyone booked tomorrow has signed</span>
              </>
            )
          ) : (
            <Skeleton className="h-9 w-16" />
          )}
        </Card>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Link
          href={`/admin/${location.slug}/schedule`}
          className="rounded-card border border-gray-200 bg-white p-5 transition-colors hover:border-gray-400"
        >
          <h2 className="font-semibold">Schedule</h2>
          <p className="mt-1 text-sm text-gray-500">
            Weekly template grid, session generation, and closures.
          </p>
        </Link>
        <Link
          href={`/admin/${location.slug}/pricing`}
          className="rounded-card border border-gray-200 bg-white p-5 transition-colors hover:border-gray-400"
        >
          <h2 className="font-semibold">Pricing &amp; Codes</h2>
          <p className="mt-1 text-sm text-gray-500">
            Discount codes with a live customer-checkout preview.
          </p>
        </Link>
      </div>
    </div>
  )
}
