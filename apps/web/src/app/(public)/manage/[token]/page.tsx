import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getCaller } from '@/lib/trpc/server'
import { ManageClient } from './manage-client'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Manage your booking' }

interface Props {
  params: Promise<{ token: string }>
}

export default async function ManagePage({ params }: Props) {
  const { token } = await params
  const caller = await getCaller()

  let booking
  try {
    booking = await caller.public.manage.get({ token })
  } catch (err) {
    if ((err as { code?: string } | null)?.code === 'NOT_FOUND') notFound()
    throw err
  }

  return <ManageClient token={token} initialBooking={booking} />
}
