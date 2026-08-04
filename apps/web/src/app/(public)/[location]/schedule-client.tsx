'use client'

/**
 * The Schedule screen — the workhorse. Sessions tab: 14-day date strip +
 * guest stepper (pinned) + slot list. Buyout tab: duration picker + windows.
 * Membership tab: plan + punch-pass listing (purchase is Phase 3). Gift Cards
 * render disabled ("coming soon").
 */

import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { MembershipPlans } from '@/components/booking/membership-plans'
import { DateStrip, SlotPicker } from '@/components/booking/slot-picker'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Stepper } from '@/components/ui/stepper'
import type { AvailabilityDay, BuyoutOption, LocationDetail } from '@/lib/api-types'
import { formatCents, formatTimeOfDay, upcomingDateKeys } from '@/lib/format'
import { useTRPC } from '@/lib/trpc/client'

type Tab = 'sessions' | 'buyout' | 'membership' | 'giftcards'

const TABS: Array<{ id: Tab; label: string; enabled: boolean }> = [
  { id: 'sessions', label: 'Sessions', enabled: true },
  { id: 'buyout', label: 'Private Buyout', enabled: true },
  { id: 'membership', label: 'Membership', enabled: true },
  { id: 'giftcards', label: 'Gift Cards', enabled: false },
]

export function ScheduleClient({
  location,
  initialDays,
  buyoutOptions,
}: {
  location: LocationDetail
  initialDays: AvailabilityDay[]
  buyoutOptions: BuyoutOption[]
}) {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('sessions')
  const [guests, setGuests] = useState(1)

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">PLUNJ {location.city}</h1>
        <p className="text-sm text-gray-500">
          {location.address1}, {location.city}, {location.state}
        </p>
      </div>

      {/* Tabs */}
      <div className="-mx-5 flex gap-1 overflow-x-auto border-b border-gray-100 px-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => t.enabled && setTab(t.id)}
            disabled={!t.enabled}
            title={t.enabled ? undefined : 'Coming soon'}
            aria-selected={tab === t.id}
            role="tab"
            className={`min-h-11 shrink-0 whitespace-nowrap border-b-2 px-3 text-sm font-medium transition-colors ${
              tab === t.id
                ? 'border-ink text-ink'
                : t.enabled
                  ? 'border-transparent text-gray-500 hover:text-ink'
                  : 'cursor-not-allowed border-transparent text-gray-300'
            }`}
          >
            {t.label}
            {!t.enabled && <span className="sr-only"> (coming soon)</span>}
          </button>
        ))}
      </div>

      {tab === 'sessions' ? (
        <div className="flex flex-col gap-4">
          {/* Guest stepper — pinned above the slot list */}
          <div className="sticky top-0 z-10 -mx-5 flex items-center justify-between bg-paper/95 px-5 py-2 backdrop-blur-sm">
            <span className="text-sm font-medium text-gray-700">Guests</span>
            <Stepper value={guests} min={1} max={8} onChange={setGuests} />
          </div>
          <SlotPicker
            locationSlug={location.slug}
            timezone={location.timezone}
            guests={guests}
            initialDays={initialDays}
            onSelect={(slot) =>
              router.push(`/${location.slug}/checkout?session=${slot.sessionId}&seats=${guests}`)
            }
          />
        </div>
      ) : tab === 'buyout' ? (
        <BuyoutTab location={location} options={buyoutOptions} />
      ) : tab === 'membership' ? (
        // Provo's prices are real Momence prices; the rest of the network shows
        // provisional pricing, so everywhere but Provo gets the footnote.
        <MembershipPlans locationSlug={location.slug} pricesConfirmed={location.slug === 'provo'} />
      ) : null}
    </div>
  )
}

function BuyoutTab({ location, options }: { location: LocationDetail; options: BuyoutOption[] }) {
  const router = useRouter()
  const trpc = useTRPC()
  const dateKeys = useMemo(() => upcomingDateKeys(location.timezone, 14), [location.timezone])
  const [selectedDate, setSelectedDate] = useState(dateKeys[0] ?? '')
  const [optionId, setOptionId] = useState(options[0]?.id ?? null)
  const option = options.find((o) => o.id === optionId) ?? null

  const windowsQuery = useQuery(
    trpc.public.buyouts.windows.queryOptions(
      {
        locationSlug: location.slug,
        date: selectedDate,
        durationHours: option?.durationHours ?? 1,
      },
      { enabled: option !== null && selectedDate !== '' },
    ),
  )

  if (options.length === 0) {
    return (
      <p className="py-10 text-center text-gray-500">
        Private buyouts aren&apos;t available at this studio yet.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Duration picker */}
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Buyout duration">
        {options.map((o) => {
          const selected = o.id === optionId
          return (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setOptionId(o.id)}
              className={`flex min-h-11 flex-col items-start rounded-card border px-4 py-2 transition-colors ${
                selected
                  ? 'border-ink bg-ink text-paper'
                  : 'border-gray-200 bg-white hover:border-gray-400'
              }`}
            >
              <span className="text-sm font-semibold">
                {o.durationHours} {o.durationHours === 1 ? 'hour' : 'hours'}
              </span>
              <span className={`text-xs ${selected ? 'text-gray-300' : 'text-gray-500'}`}>
                {formatCents(o.priceCents)} · up to {o.maxGuests} guests
              </span>
            </button>
          )
        })}
      </div>

      <DateStrip dateKeys={dateKeys} selected={selectedDate} onSelect={setSelectedDate} />

      {windowsQuery.isPending ? (
        <div className="flex flex-col gap-2" aria-busy>
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : (windowsQuery.data?.length ?? 0) === 0 ? (
        <p className="py-10 text-center text-gray-500">
          No open buyout windows this day — try another date or duration.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {windowsQuery.data?.map((w) => (
            <li key={`${w.studioId}-${w.startsAt}`}>
              <button
                type="button"
                onClick={() =>
                  option &&
                  router.push(
                    `/${location.slug}/checkout?buyout=${option.id}&sessions=${w.sessionIds.join(',')}`,
                  )
                }
                className="flex min-h-14 w-full items-center justify-between gap-3 rounded-card border border-gray-200 bg-white px-4 text-left transition-colors hover:border-ink active:bg-gray-50"
              >
                <span className="text-base font-semibold tabular-nums tracking-tight">
                  {formatTimeOfDay(w.startsAt, location.timezone)} –{' '}
                  {formatTimeOfDay(w.endsAt, location.timezone)}
                </span>
                <span className="flex items-center gap-2.5">
                  <Badge>Private</Badge>
                  {option ? (
                    <span className="text-sm text-gray-500 tabular-nums">
                      {formatCents(option.priceCents)}
                    </span>
                  ) : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
