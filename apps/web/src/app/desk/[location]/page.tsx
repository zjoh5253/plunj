import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { RosterClient } from '@/components/desk/roster-client'
import { getCaller } from '@/lib/trpc/server'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Today' }

interface Props {
  params: Promise<{ location: string }>
}

export default async function DeskRosterPage({ params }: Props) {
  const { location: slug } = await params
  const caller = await getCaller()
  let location
  try {
    location = await caller.public.locations.bySlug({ slug })
  } catch (err) {
    if ((err as { code?: string } | null)?.code === 'NOT_FOUND') notFound()
    throw err
  }

  // Roster data itself is staff-only: fetched client-side with the session
  // cookie; UNAUTHORIZED redirects to /staff/sign-in?next=.
  return <RosterClient location={location} />
}
