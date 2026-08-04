import type { Metadata } from 'next'
import { loadLocation } from '@/components/admin/load-location'
import { DashboardClient } from './dashboard-client'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Admin — Dashboard' }

export default async function AdminDashboardPage({
  params,
}: {
  params: Promise<{ location: string }>
}) {
  const { location: slug } = await params
  const location = await loadLocation(slug)
  return <DashboardClient location={location} />
}
