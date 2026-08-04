/**
 * /desk index — the default ?next= landing after staff sign-in. There is no
 * "my locations" endpoint on the desk router, so this lists active locations;
 * the API still enforces per-location roles on every desk call.
 */

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCaller } from '@/lib/trpc/server'

export const dynamic = 'force-dynamic'

export default async function DeskIndexPage() {
  const caller = await getCaller()
  const locations = await caller.public.locations.list()

  const only = locations.length === 1 ? locations[0] : undefined
  if (only) redirect(`/desk/${only.slug}`)

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-6 px-6 py-10">
      <div className="flex flex-col gap-1">
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-gray-400">PLUNJ Desk</p>
        <h1 className="text-2xl font-semibold tracking-tight">Choose your location</h1>
      </div>
      <ul className="flex flex-col gap-2">
        {locations.map((l) => (
          <li key={l.slug}>
            <Link
              href={`/desk/${l.slug}`}
              className="flex min-h-14 w-full items-center justify-between rounded-card border border-gray-200 bg-white px-5 text-base font-medium transition-colors hover:border-ink"
            >
              <span>{l.name}</span>
              <span className="text-sm text-gray-500">
                {l.city}, {l.state}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {locations.length === 0 ? <p className="text-gray-500">No active locations yet.</p> : null}
    </div>
  )
}
