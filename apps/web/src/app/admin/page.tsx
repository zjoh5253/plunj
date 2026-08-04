import type { Metadata } from 'next'
import { getCaller } from '@/lib/trpc/server'
import { NetworkOverview } from './network-overview'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Admin' }

/**
 * /admin: corporate admins get the cross-location network dashboard;
 * everyone else gets the location picker (rendered by the same component
 * when the corporate overview query is forbidden).
 */
export default async function AdminIndexPage() {
  const caller = await getCaller()
  const locations = await caller.public.locations.list()
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-4xl flex-col gap-6 px-5 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">PLUNJ Admin</h1>
      <NetworkOverview locations={locations} />
    </div>
  )
}
