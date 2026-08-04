import type { Metadata } from 'next'
import { loadLocation } from '@/components/admin/load-location'
import { PricingClient } from './pricing-client'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Admin — Pricing & Codes' }

export default async function AdminPricingPage({
  params,
}: {
  params: Promise<{ location: string }>
}) {
  const { location: slug } = await params
  const location = await loadLocation(slug)
  return <PricingClient location={location} />
}
