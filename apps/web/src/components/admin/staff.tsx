'use client'

/**
 * Staff auth helpers for the admin surface. UNAUTHORIZED from any staff query
 * redirects to the staff sign-in screen (built by the desk surface) with a
 * `next` param back to the current admin page.
 */

import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

interface TrpcishError {
  data?: { code?: string } | null
}

export function errorCode(err: unknown): string | undefined {
  return (err as TrpcishError | null)?.data?.code
}

export function isUnauthorized(err: unknown): boolean {
  return errorCode(err) === 'UNAUTHORIZED'
}

export function isForbidden(err: unknown): boolean {
  return errorCode(err) === 'FORBIDDEN'
}

/** App-relative (basePath-free) sign-in URL with a return pointer. */
export function signInHref(next: string): string {
  return `/staff/sign-in?next=${encodeURIComponent(next)}`
}

/**
 * Watches any number of query/mutation errors; the first UNAUTHORIZED one
 * redirects to staff sign-in with next=<current admin page>.
 */
export function useStaffGuard(...errors: unknown[]): void {
  const router = useRouter()
  const pathname = usePathname()
  const unauthorized = errors.some((e) => e != null && isUnauthorized(e))
  useEffect(() => {
    if (unauthorized) router.replace(signInHref(pathname))
  }, [unauthorized, router, pathname])
}

/**
 * Best-effort staff display identity from the Better Auth session endpoint.
 * (No staff "me" tRPC query exists yet — see the admin surface build report.)
 */
export function useStaffIdentity(): { name: string | null; loaded: boolean } {
  const [name, setName] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    let alive = true
    // basePath '/book' applies to routes, not fetch URLs — spell it out.
    fetch('/book/api/auth/get-session', { credentials: 'include' })
      .then((r) => (r.ok ? (r.json() as Promise<unknown>) : null))
      .then((data) => {
        if (!alive) return
        const user = (data as { user?: { name?: string; phoneNumber?: string } | null } | null)
          ?.user
        setName(user?.name ?? user?.phoneNumber ?? null)
        setLoaded(true)
      })
      .catch(() => {
        if (alive) setLoaded(true)
      })
    return () => {
      alive = false
    }
  }, [])
  return { name, loaded }
}
