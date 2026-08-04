import type { Metadata } from 'next'
import Link from 'next/link'
import { getCaller } from '@/lib/trpc/server'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Find your studio',
  description: 'Choose your nearest PLUNJ studio to book a contrast therapy session.',
}

export default async function LocationChooserPage() {
  const caller = await getCaller()
  const locations = await caller.public.locations.list()

  return (
    <div className="flex flex-col gap-8 pt-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Find your studio</h1>
        <p className="text-gray-500">Sauna. Cold plunge. Repeat.</p>
      </div>

      {locations.length === 0 ? (
        <p className="text-gray-500">No studios are open for booking yet — check back soon.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {locations.map((location) => {
            const inner = (
              <span className="flex min-h-11 items-center justify-between gap-4">
                <span className="flex flex-col">
                  <span className="text-lg font-semibold tracking-tight">{location.name}</span>
                  <span className="text-sm text-gray-500">
                    {location.city}, {location.state}
                  </span>
                </span>
                <span aria-hidden className="text-gray-300">
                  →
                </span>
              </span>
            )
            const cardClass =
              'block rounded-card border border-gray-100 bg-white px-5 py-4 transition-colors hover:border-gray-300 active:bg-gray-50'
            return (
              <li key={location.id}>
                {location.bookingProvider === 'MOMENCE' && location.momenceUrl ? (
                  <a href={location.momenceUrl} className={cardClass}>
                    {inner}
                  </a>
                ) : (
                  <Link href={`/${location.slug}`} className={cardClass}>
                    {inner}
                  </Link>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
