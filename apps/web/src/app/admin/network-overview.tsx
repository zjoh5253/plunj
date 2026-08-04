'use client'

/**
 * Corporate network dashboard. Renders for CORPORATE_ADMIN sessions; staff
 * without corporate access (or signed-out visitors) fall back to the plain
 * location picker. Money renders verbatim from server cents (invariant #1).
 */

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { formatCents } from '@/lib/format'
import { TRPCReactProvider, useTRPC } from '@/lib/trpc/client'

interface PickerLocation {
  id: string
  slug: string
  name: string
  city: string
  state: string
}

function LocationPicker({ locations }: { locations: PickerLocation[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {locations.map((l) => (
        <li key={l.id}>
          <Link
            href={`/admin/${l.slug}`}
            className="block rounded-card border border-gray-200 bg-white px-4 py-3 font-medium text-ink transition-colors hover:border-gray-400"
          >
            {l.name}
            <span className="ml-2 text-sm font-normal text-gray-500">
              {[l.city, l.state].filter(Boolean).join(', ')}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  )
}

function Overview({ locations }: { locations: PickerLocation[] }) {
  const trpc = useTRPC()
  const overview = useQuery({
    ...trpc.corporate.overview.queryOptions(),
    retry: false,
    refetchInterval: 60_000,
  })

  if (overview.isPending) {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-10" />
        <Skeleton className="h-64" />
      </div>
    )
  }

  // Not corporate (or not signed in): plain location picker.
  if (overview.isError || !overview.data) {
    return (
      <>
        <p className="text-sm text-gray-500">Choose a location to manage.</p>
        <LocationPicker locations={locations} />
      </>
    )
  }

  const { locations: rows, totals } = overview.data

  const stat = (label: string, value: string) => (
    <Card className="flex flex-1 flex-col gap-1 px-4 py-3">
      <span className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</span>
      <span className="text-xl font-semibold tabular-nums tracking-tight">{value}</span>
    </Card>
  )

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap gap-3">
        {stat('Revenue · 24h', formatCents(totals.revenue24hCents))}
        {stat('Revenue · 30d', formatCents(totals.revenue30dCents))}
        {stat('Seats today', `${totals.todayBookedSeats}/${totals.todayCapacitySeats}`)}
        {stat('Booked · next 7d', String(totals.upcoming7dSeats))}
      </div>

      <Card className="overflow-x-auto p-0">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-500">
              <th className="px-4 py-3 font-medium">Location</th>
              <th className="px-4 py-3 text-right font-medium">Revenue 24h</th>
              <th className="px-4 py-3 text-right font-medium">Revenue 30d</th>
              <th className="px-4 py-3 text-right font-medium">Today</th>
              <th className="px-4 py-3 text-right font-medium">Next 7d</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.locationId} className="border-b border-gray-50 hover:bg-gray-50">
                <td className="px-4 py-3">
                  <Link href={`/admin/${row.slug}`} className="font-medium hover:underline">
                    {row.name}
                  </Link>
                  <span className="ml-2 text-xs text-gray-400">
                    {row.city}, {row.state}
                  </span>
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {formatCents(row.revenue24hCents)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {formatCents(row.revenue30dCents)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {row.todayBookedSeats}/{row.todayCapacitySeats}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{row.upcoming7dSeats}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <p className="text-xs text-gray-500">
        Corporate view is read-only — open a location to act as its admin (visible in that
        location&apos;s activity log).
      </p>
    </div>
  )
}

export function NetworkOverview({ locations }: { locations: PickerLocation[] }) {
  return (
    <TRPCReactProvider>
      <Overview locations={locations} />
    </TRPCReactProvider>
  )
}
