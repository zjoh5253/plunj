import type { Metadata } from 'next'
import Link from 'next/link'
import { getCaller } from '@/lib/trpc/server'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Admin' }

/** /admin without a location: pick one. */
export default async function AdminIndexPage() {
  const caller = await getCaller()
  const locations = await caller.public.locations.list()
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-xl flex-col gap-6 px-5 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Location admin</h1>
      <p className="text-sm text-gray-500">Choose a location to manage.</p>
      <ul className="flex flex-col gap-2">
        {locations.map((l) => (
          <li key={l.id}>
            <Link
              href={`/admin/${l.slug}`}
              className="block rounded-card border border-gray-200 bg-white px-4 py-3 font-medium text-ink transition-colors hover:border-gray-400"
            >
              {l.name}
              <span className="ml-2 text-sm font-normal text-gray-500">
                {[l.city, l.state].filter(Boolean).join(', ')}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
