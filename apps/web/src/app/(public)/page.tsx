import type { Metadata } from 'next'
import { getCaller } from '@/lib/trpc/server'
import { LocationSearch } from './location-search'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Find your studio',
  description: 'Choose your nearest PLUNJ studio to book a contrast therapy session.',
}

export default async function LocationChooserPage() {
  const caller = await getCaller()
  const locations = await caller.public.locations.list()

  return (
    <div className="flex flex-col gap-6 pt-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Find your studio</h1>
        <p className="text-gray-500">Sauna. Cold plunge. Repeat.</p>
      </div>

      {locations.length === 0 ? (
        <p className="text-gray-500">No studios are open for booking yet — check back soon.</p>
      ) : (
        <LocationSearch locations={locations} />
      )}
    </div>
  )
}
