'use client'

/**
 * Admin shell: location header + left nav (Dashboard / Schedule / Pricing &
 * Codes / Team / Waivers) + staff identity. Desktop-first; the nav collapses
 * to a horizontal scroller on narrow tablets.
 */

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { signInHref, useStaffIdentity } from './staff'

const NAV = [
  { label: 'Dashboard', segment: '' },
  { label: 'Schedule', segment: 'schedule' },
  { label: 'Pricing & Codes', segment: 'pricing' },
  { label: 'Team', segment: 'team' },
  { label: 'Waivers', segment: 'waivers' },
] as const

export function AdminShell({
  locationSlug,
  locationName,
  children,
}: {
  locationSlug: string
  locationName: string
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const base = `/admin/${locationSlug}`
  const identity = useStaffIdentity()

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col px-5 pb-16">
      <header className="flex items-center justify-between gap-4 border-b border-gray-100 py-4">
        <div className="flex items-baseline gap-3">
          <Link href="/" className="text-lg font-bold tracking-[0.18em] text-ink">
            PLUNJ
          </Link>
          <span className="text-sm text-gray-400">/</span>
          <span className="text-base font-semibold tracking-tight">{locationName}</span>
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
            Admin
          </span>
        </div>
        <div className="text-sm text-gray-500">
          {identity.name ? (
            <span>{identity.name}</span>
          ) : identity.loaded ? (
            <Link href={signInHref(pathname)} className="font-medium text-ink underline">
              Staff sign-in
            </Link>
          ) : null}
        </div>
      </header>

      <div className="flex flex-1 flex-col gap-8 pt-6 md:flex-row">
        <nav className="flex shrink-0 gap-1 overflow-x-auto md:w-48 md:flex-col md:overflow-visible">
          {NAV.map((item) => {
            const href = item.segment === '' ? base : `${base}/${item.segment}`
            const active = item.segment === '' ? pathname === base : pathname.startsWith(href)
            return (
              <Link
                key={item.label}
                href={href}
                aria-current={active ? 'page' : undefined}
                className={`whitespace-nowrap rounded-card px-3 py-2 text-sm font-medium transition-colors ${
                  active ? 'bg-ink text-paper' : 'text-gray-600 hover:bg-gray-100 hover:text-ink'
                }`}
              >
                {item.label}
              </Link>
            )
          })}
        </nav>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  )
}
