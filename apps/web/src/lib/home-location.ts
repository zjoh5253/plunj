'use client'

/**
 * "Home studio" (favorite location) helpers. The chosen slug lives in
 * localStorage so guests get the feature too; signed-in customers also persist
 * it server-side via public.me.setHomeLocation. When signed in AND the server
 * has a value, the server wins and is written back to localStorage.
 */

import { useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useState } from 'react'
import { useTRPC, useTRPCClient } from '@/lib/trpc/client'

const STORAGE_KEY = 'plunj.homeLocation'

/** Read the stored home-studio slug (null on the server or when unset). */
export function getStoredHomeLocation(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

/** Store (or clear, with null) the home-studio slug. No-op on the server. */
export function setStoredHomeLocation(slug: string | null): void {
  if (typeof window === 'undefined') return
  try {
    if (slug === null) window.localStorage.removeItem(STORAGE_KEY)
    else window.localStorage.setItem(STORAGE_KEY, slug)
  } catch {
    // localStorage unavailable (private mode, blocked) — degrade silently.
  }
}

export function clearStoredHomeLocation(): void {
  setStoredHomeLocation(null)
}

export interface HomeLocationState {
  /** Current home-studio slug (null when unset, and always null pre-mount). */
  homeSlug: string | null
  /** True once localStorage has been read on the client (hydration-safe). */
  ready: boolean
  /** True once ready AND the me.get query has settled (success or error). */
  resolved: boolean
  /** True when public.me.get returned a signed-in customer. */
  signedIn: boolean
  /** The server-persisted home slug for the signed-in customer, else null. */
  serverHomeSlug: string | null
  /** Set or clear the home studio: localStorage always, server when signed in. */
  setHome: (slug: string | null) => void
}

export function useHomeLocation(): HomeLocationState {
  const trpc = useTRPC()
  const client = useTRPCClient()
  const [homeSlug, setHomeSlug] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    setHomeSlug(getStoredHomeLocation())
    setReady(true)
  }, [])

  // Guests are the normal case: me.get returns null (it never throws for a
  // missing session), and retry: false keeps transient failures quiet.
  const meQuery = useQuery(trpc.public.me.get.queryOptions(undefined, { retry: false }))
  const signedIn = meQuery.data !== null && meQuery.data !== undefined
  const serverHomeSlug = meQuery.data?.homeLocationSlug ?? null

  // Server wins: a signed-in customer's saved studio overwrites local state.
  useEffect(() => {
    if (serverHomeSlug !== null) {
      setStoredHomeLocation(serverHomeSlug)
      setHomeSlug(serverHomeSlug)
    }
  }, [serverHomeSlug])

  const setHome = useCallback(
    (slug: string | null) => {
      setStoredHomeLocation(slug)
      setHomeSlug(slug)
      if (signedIn) {
        // Fire-and-forget: a failed server write still leaves the local copy,
        // and guest UX must never break on UNAUTHORIZED.
        client.public.me.setHomeLocation.mutate({ locationSlug: slug }).catch(() => undefined)
      }
    },
    [client, signedIn],
  )

  return {
    homeSlug,
    ready,
    resolved: ready && (meQuery.isSuccess || meQuery.isError),
    signedIn,
    serverHomeSlug,
    setHome,
  }
}
