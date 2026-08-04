import type { Metadata } from 'next'
import { loadLocation } from '@/components/admin/load-location'
import { TeamClient } from './team-client'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Admin — Team' }

export default async function AdminTeamPage({ params }: { params: Promise<{ location: string }> }) {
  const { location: slug } = await params
  const location = await loadLocation(slug)
  return <TeamClient location={location} />
}
