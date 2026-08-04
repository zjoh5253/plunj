import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Suspense } from 'react'
import { SlotListSkeleton } from '@/components/booking/slot-picker'
import { HomeToggle } from '@/components/home/home-toggle'
import { localDateKey, upcomingDateKeys } from '@/lib/format'
import { getCaller } from '@/lib/trpc/server'
import { ScheduleClient } from './schedule-client'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ location: string }>
}

function isNotFound(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === 'NOT_FOUND'
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { location: slug } = await params
  try {
    const caller = await getCaller()
    const location = await caller.public.locations.bySlug({ slug })
    return {
      title: `Book a Cold Plunge in ${location.city}`,
      description: `Book a contrast therapy session — sauna and cold plunge — at PLUNJ ${location.city}, ${location.state}.`,
    }
  } catch {
    return { title: 'Book a session' }
  }
}

async function ScheduleData({ slug }: { slug: string }) {
  const caller = await getCaller()
  let location
  try {
    location = await caller.public.locations.bySlug({ slug })
  } catch (err) {
    if (isNotFound(err)) notFound()
    throw err
  }

  const dateKeys = upcomingDateKeys(location.timezone, 14)
  const fromDate = dateKeys[0] ?? localDateKey(new Date(), location.timezone)
  const toDate = dateKeys[dateKeys.length - 1] ?? fromDate

  const [days, buyoutOptions] = await Promise.all([
    caller.public.availability.list({ locationSlug: slug, fromDate, toDate }),
    caller.public.buyouts.options({ locationSlug: slug }),
  ])

  return <ScheduleClient location={location} initialDays={days} buyoutOptions={buyoutOptions} />
}

export default async function SchedulePage({ params }: Props) {
  const { location: slug } = await params
  return (
    <>
      <HomeToggle slug={slug} />
      <Suspense fallback={<SlotListSkeleton />}>
        <ScheduleData slug={slug} />
      </Suspense>
    </>
  )
}
