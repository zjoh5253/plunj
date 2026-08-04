import type { Metadata } from 'next'
import { loadLocation } from '@/components/admin/load-location'
import { ScheduleClient } from './schedule-client'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Admin — Schedule' }

export default async function AdminSchedulePage({
  params,
}: {
  params: Promise<{ location: string }>
}) {
  const { location: slug } = await params
  const location = await loadLocation(slug)
  return <ScheduleClient location={location} />
}
