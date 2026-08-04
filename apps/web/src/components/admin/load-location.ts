/**
 * Server-side location fetch shared by the admin pages (mirrors the checkout
 * page's pattern: NOT_FOUND → next/navigation notFound()).
 */

import { notFound } from 'next/navigation'
import type { LocationDetail } from '@/lib/api-types'
import { getCaller } from '@/lib/trpc/server'

export async function loadLocation(slug: string): Promise<LocationDetail> {
  const caller = await getCaller()
  try {
    return await caller.public.locations.bySlug({ slug })
  } catch (err) {
    if ((err as { code?: string } | null)?.code === 'NOT_FOUND') notFound()
    throw err
  }
}
