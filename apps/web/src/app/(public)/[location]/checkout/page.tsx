import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import type { CheckoutItem } from '@/lib/api-types'
import { getCaller } from '@/lib/trpc/server'
import { CheckoutClient } from './checkout-client'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Checkout' }

interface Props {
  params: Promise<{ location: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

export default async function CheckoutPage({ params, searchParams }: Props) {
  const { location: slug } = await params
  const query = await searchParams

  const sessionId = first(query.session)
  const seats = Number.parseInt(first(query.seats) ?? '1', 10)
  const buyoutOptionId = first(query.buyout)
  const buyoutSessionIds = (first(query.sessions) ?? '').split(',').filter(Boolean)

  let items: CheckoutItem[]
  if (sessionId) {
    items = [
      { kind: 'DROP_IN', sessionId, seats: Number.isFinite(seats) && seats >= 1 ? seats : 1 },
    ]
  } else if (buyoutOptionId && buyoutSessionIds.length > 0) {
    items = [{ kind: 'BUYOUT', buyoutOptionId, sessionIds: buyoutSessionIds }]
  } else {
    redirect(`/${slug}`)
  }

  const caller = await getCaller()
  let location
  try {
    location = await caller.public.locations.bySlug({ slug })
  } catch (err) {
    if ((err as { code?: string } | null)?.code === 'NOT_FOUND') notFound()
    throw err
  }

  return <CheckoutClient location={location} items={items} />
}
