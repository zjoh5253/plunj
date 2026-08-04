'use client'

/**
 * Client-side location search: filters and relevance-ranks the (small) studio
 * list by city, state, or zip as the user types. Ranking per query token:
 * zip prefix > city prefix > city substring > state > name substring; every
 * token must match somewhere or the location drops out.
 *
 * A heart on each card marks the visitor's "home studio" (localStorage, plus
 * server-side for signed-in customers). With no query typed the home studio is
 * pinned in a "Your studio" section above the list; during a search it ranks
 * like any other location and only appears when it matches the query.
 */

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { HomeHeartButton } from '@/components/home/home-heart-button'
import { Input } from '@/components/ui/input'
import { useHomeLocation } from '@/lib/home-location'

export interface ChooserLocation {
  id: string
  slug: string
  name: string
  city: string
  state: string
  postalCode: string
  bookingProvider: string
  momenceUrl: string | null
}

const STATE_NAMES: Record<string, string> = {
  UT: 'utah',
  ID: 'idaho',
  AZ: 'arizona',
  CO: 'colorado',
  TN: 'tennessee',
  TX: 'texas',
  NV: 'nevada',
  CA: 'california',
}

function tokenScore(location: ChooserLocation, token: string): number {
  const city = location.city.toLowerCase()
  const state = location.state.toLowerCase()
  const stateName = STATE_NAMES[location.state] ?? ''
  const name = location.name.toLowerCase()

  if (/^\d+$/.test(token)) {
    return location.postalCode.startsWith(token) ? 100 : 0
  }
  if (city.startsWith(token)) return 90
  if (city.includes(token)) return 70
  if (state === token || stateName === token || stateName.startsWith(token)) return 60
  if (name.includes(token)) return 50
  return 0
}

function LocationCard({
  location,
  isHome,
  pinned = false,
  onToggleHome,
}: {
  location: ChooserLocation
  isHome: boolean
  pinned?: boolean
  onToggleHome: () => void
}) {
  const external = location.bookingProvider === 'MOMENCE'
  const inner = (
    <span className="flex min-h-11 items-center justify-between gap-4">
      <span className="flex flex-col">
        <span className="text-lg font-semibold tracking-tight">{location.name}</span>
        <span className="text-sm text-gray-500">
          {location.city}, {location.state} {location.postalCode}
        </span>
      </span>
      <span className="flex items-center gap-2">
        {pinned ? (
          <span className="text-sm font-medium text-ink">Book at your studio</span>
        ) : external ? (
          <span className="text-xs text-gray-400">books on plunj.co</span>
        ) : (
          <span className="rounded-full bg-ink px-2.5 py-0.5 text-xs font-medium text-paper">
            Book here
          </span>
        )}
        <span aria-hidden className="text-gray-300">
          {external ? '↗' : '→'}
        </span>
      </span>
    </span>
  )
  const cardClass = `block rounded-card border bg-white py-4 pl-5 pr-14 transition-colors hover:border-gray-300 active:bg-gray-50 ${
    pinned ? 'border-gray-300' : 'border-gray-100'
  }`
  return (
    <li className="relative">
      {external && location.momenceUrl ? (
        <a href={location.momenceUrl} className={cardClass}>
          {inner}
        </a>
      ) : (
        <Link href={`/${location.slug}`} className={cardClass}>
          {inner}
        </Link>
      )}
      <HomeHeartButton
        active={isHome}
        locationName={location.name}
        onToggle={onToggleHome}
        className="absolute right-1.5 top-1/2 -translate-y-1/2"
      />
    </li>
  )
}

export function LocationSearch({ locations }: { locations: ChooserLocation[] }) {
  const [query, setQuery] = useState('')
  const { homeSlug, ready, setHome } = useHomeLocation()

  const results = useMemo(() => {
    // Locations booking natively here list first; Momence-routed ones follow.
    const internalFirst = (a: ChooserLocation, b: ChooserLocation) =>
      Number(b.bookingProvider === 'INTERNAL') - Number(a.bookingProvider === 'INTERNAL') ||
      a.name.localeCompare(b.name)

    const tokens = query.toLowerCase().trim().split(/\s+/).filter(Boolean)
    if (tokens.length === 0) return [...locations].sort(internalFirst)
    return locations
      .map((location) => {
        let score = 0
        for (const token of tokens) {
          const s = tokenScore(location, token)
          if (s === 0) return { location, score: 0 }
          score += s
        }
        return { location, score }
      })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score || internalFirst(a.location, b.location))
      .map((r) => r.location)
  }, [locations, query])

  const searching = query.trim().length > 0
  const home =
    ready && homeSlug !== null ? (locations.find((l) => l.slug === homeSlug) ?? null) : null
  // Pin the home studio only while no query is typed; during a search it ranks
  // like any other location (and drops out when it doesn't match).
  const pinnedHome = searching ? null : home
  const listResults = pinnedHome
    ? results.filter((location) => location.slug !== pinnedHome.slug)
    : results

  const toggleHome = (location: ChooserLocation) =>
    setHome(homeSlug === location.slug ? null : location.slug)

  return (
    <div className="flex flex-col gap-4">
      <Input
        type="search"
        inputMode="search"
        placeholder="Search by city, state, or zip"
        aria-label="Search studios by city, state, or zip code"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      {pinnedHome ? (
        <section aria-label="Your studio" className="flex flex-col gap-2">
          <h2 className="text-sm font-medium uppercase tracking-wide text-gray-500">Your studio</h2>
          <ul className="flex flex-col gap-3">
            <LocationCard
              location={pinnedHome}
              isHome
              pinned
              onToggleHome={() => toggleHome(pinnedHome)}
            />
          </ul>
        </section>
      ) : null}

      {listResults.length === 0 ? (
        searching ? (
          <p className="py-4 text-gray-500">
            No studios match &ldquo;{query.trim()}&rdquo; — try a city, state, or zip code.
          </p>
        ) : null
      ) : (
        <ul className="flex flex-col gap-3">
          {listResults.map((location) => (
            <LocationCard
              key={location.id}
              location={location}
              isHome={location.slug === homeSlug}
              onToggleHome={() => toggleHome(location)}
            />
          ))}
        </ul>
      )}
    </div>
  )
}
