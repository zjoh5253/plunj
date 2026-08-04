'use client'

/**
 * Tiny client island for the schedule page: heart toggle marking this location
 * as the visitor's home studio. Mounted from the RSC page so the schedule
 * client component stays untouched.
 */

import { useHomeLocation } from '@/lib/home-location'
import { HomeHeartButton } from './home-heart-button'

export function HomeToggle({ slug }: { slug: string }) {
  const { homeSlug, ready, setHome } = useHomeLocation()
  if (!ready) return null
  const active = homeSlug === slug
  return (
    <div className="flex items-center justify-end gap-1 pt-4 text-sm text-gray-500">
      <span>{active ? 'Your studio' : 'Make this your studio'}</span>
      <HomeHeartButton
        active={active}
        locationName="this studio"
        onToggle={() => setHome(active ? null : slug)}
      />
    </div>
  )
}
