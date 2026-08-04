import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getCaller } from '@/lib/trpc/server'
import { WaiverClient } from './waiver-client'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Sign your waiver' }

interface Props {
  params: Promise<{ token: string }>
}

export default async function WaiverPage({ params }: Props) {
  const { token } = await params
  const caller = await getCaller()

  let booking
  try {
    booking = await caller.public.manage.get({ token })
  } catch (err) {
    if ((err as { code?: string } | null)?.code === 'NOT_FOUND') notFound()
    throw err
  }

  const doc = await caller.public.waivers.current({ locationSlug: booking.location.slug })
  if (!doc) {
    return (
      <div className="flex flex-col gap-3 pt-10 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">No waiver needed</h1>
        <p className="text-gray-500">
          {booking.location.name} doesn&apos;t have a waiver to sign right now. You&apos;re all set.
        </p>
      </div>
    )
  }

  return <WaiverClient token={token} booking={booking} doc={doc} />
}
