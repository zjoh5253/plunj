import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { CustomersClient } from '@/components/desk/customers-client'
import { getCaller } from '@/lib/trpc/server'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Customers' }

interface Props {
  params: Promise<{ location: string }>
}

export default async function DeskCustomersPage({ params }: Props) {
  const { location: slug } = await params
  const caller = await getCaller()
  let location
  try {
    location = await caller.public.locations.bySlug({ slug })
  } catch (err) {
    if ((err as { code?: string } | null)?.code === 'NOT_FOUND') notFound()
    throw err
  }

  return <CustomersClient location={location} />
}
