'use client'

/**
 * Invisible island for the confirmation page: a successful booking sets the
 * booked location as the home studio — but ONLY when no home is set anywhere
 * (an explicit choice, local or server-side, always wins).
 */

import { useEffect, useRef } from 'react'
import { getStoredHomeLocation, useHomeLocation } from '@/lib/home-location'

export function RememberHomeLocation({ slug }: { slug: string }) {
  const { resolved, serverHomeSlug, setHome } = useHomeLocation()
  const applied = useRef(false)

  useEffect(() => {
    if (!resolved || applied.current) return
    applied.current = true
    // Fresh localStorage read avoids racing the server-wins write-back.
    if (serverHomeSlug === null && getStoredHomeLocation() === null) setHome(slug)
  }, [resolved, serverHomeSlug, setHome, slug])

  return null
}
