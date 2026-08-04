'use client'

/**
 * Desk chrome: location name, live today's date (location TZ, never the
 * browser's), staff identity, nav, sign-out. Sticky, arm's-length tap targets.
 */

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { authClient } from '@/components/desk/auth-client'
import { formatDateKeyLong, localDateKey } from '@/lib/format'

export interface DeskLocation {
  slug: string
  name: string
  city: string
  timezone: string
}

export function DeskTopBar({ location }: { location: DeskLocation }) {
  const router = useRouter()
  const pathname = usePathname()
  const { data: session } = authClient.useSession()

  // Live location-local date — a desk tablet stays open across midnight.
  const [dateKey, setDateKey] = useState(() => localDateKey(new Date(), location.timezone))
  useEffect(() => {
    const timer = setInterval(() => setDateKey(localDateKey(new Date(), location.timezone)), 30_000)
    return () => clearInterval(timer)
  }, [location.timezone])

  const staffPhone =
    (session?.user as { phoneNumber?: string | null } | undefined)?.phoneNumber ?? null

  const rosterHref = `/desk/${location.slug}`
  const customersHref = `/desk/${location.slug}/customers`

  const tab = (href: string, label: string, active: boolean) => (
    <Link
      href={href}
      className={`flex min-h-11 items-center rounded-card px-4 text-sm font-medium transition-colors ${
        active ? 'bg-ink text-paper' : 'text-gray-600 hover:bg-gray-100'
      }`}
    >
      {label}
    </Link>
  )

  return (
    <header className="sticky top-0 z-40 border-b border-gray-100 bg-paper/95 backdrop-blur">
      <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3">
        <div className="flex min-w-0 flex-col">
          <span className="text-sm font-bold tracking-[0.18em]">
            PLUNJ{' '}
            <span className="font-medium tracking-normal text-gray-500">· {location.name}</span>
          </span>
          <span className="text-xs text-gray-400">{formatDateKeyLong(dateKey)}</span>
        </div>
        <nav className="ml-auto flex items-center gap-1" aria-label="Desk">
          {tab(rosterHref, 'Today', pathname === rosterHref)}
          {tab(customersHref, 'Customers', pathname.startsWith(customersHref))}
        </nav>
        <div className="flex items-center gap-2">
          {staffPhone ? (
            <span className="hidden text-xs text-gray-400 tabular-nums sm:inline">
              {staffPhone}
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => {
              void authClient.signOut().then(() => {
                router.replace(`/staff/sign-in?next=${encodeURIComponent(rosterHref)}`)
              })
            }}
            className="flex min-h-11 items-center rounded-card px-3 text-sm font-medium text-gray-500 hover:bg-gray-100"
          >
            Sign out
          </button>
        </div>
      </div>
    </header>
  )
}
