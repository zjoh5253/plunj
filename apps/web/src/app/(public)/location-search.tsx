'use client'

/**
 * Client-side location search: filters and relevance-ranks the (small) studio
 * list by city, state, or zip as the user types. Ranking per query token:
 * zip prefix > city prefix > city substring > state > name substring; every
 * token must match somewhere or the location drops out.
 */

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { Input } from '@/components/ui/input'

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

export function LocationSearch({ locations }: { locations: ChooserLocation[] }) {
  const [query, setQuery] = useState('')

  const results = useMemo(() => {
    const tokens = query.toLowerCase().trim().split(/\s+/).filter(Boolean)
    if (tokens.length === 0) return locations
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
      .sort((a, b) => b.score - a.score || a.location.name.localeCompare(b.location.name))
      .map((r) => r.location)
  }, [locations, query])

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

      {results.length === 0 ? (
        <p className="py-4 text-gray-500">
          No studios match &ldquo;{query.trim()}&rdquo; — try a city, state, or zip code.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {results.map((location) => {
            const inner = (
              <span className="flex min-h-11 items-center justify-between gap-4">
                <span className="flex flex-col">
                  <span className="text-lg font-semibold tracking-tight">{location.name}</span>
                  <span className="text-sm text-gray-500">
                    {location.city}, {location.state} {location.postalCode}
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
