import type { Metadata } from 'next'
import { loadLocation } from '@/components/admin/load-location'
import { WaiversClient } from './waivers-client'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Admin — Waivers' }

export default async function AdminWaiversPage({
  params,
}: {
  params: Promise<{ location: string }>
}) {
  const { location: slug } = await params
  const location = await loadLocation(slug)
  return <WaiversClient location={location} />
}
