import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getCaller } from '@/lib/trpc/server'
import { WalkinClient } from './walkin-client'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Walk-in check-in' }

interface Props {
  params: Promise<{ location: string }>
}

export default async function WalkinPage({ params }: Props) {
  const { location: slug } = await params
  const caller = await getCaller()

  let location
  try {
    location = await caller.public.locations.bySlug({ slug })
  } catch (err) {
    if ((err as { code?: string } | null)?.code === 'NOT_FOUND') notFound()
    throw err
  }

  const doc = await caller.public.waivers.current({ locationSlug: slug })

  return <WalkinClient location={location} doc={doc} />
}
