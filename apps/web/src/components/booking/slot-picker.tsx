'use client'

/**
 * 14-day date strip + slot list, rendered in the LOCATION's timezone. Slots
 * with fewer remaining seats than the party size are dimmed, never hidden.
 * Used by the schedule screen and the manage-page reschedule picker.
 */

import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import type { AvailabilityDay, AvailabilitySlot } from '@/lib/api-types'
import { dateKeyParts, formatCents, formatTimeOfDay, upcomingDateKeys } from '@/lib/format'
import { useTRPC } from '@/lib/trpc/client'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'

export interface SlotPickerProps {
  locationSlug: string
  timezone: string
  /** Seats the party needs — slots with fewer remaining are dimmed. */
  guests: number
  onSelect: (slot: AvailabilitySlot) => void
  /** Server-rendered first paint; the client refetches in the background. */
  initialDays?: AvailabilityDay[]
  /** Extra note shown above the slot list (e.g. same-price reschedule rule). */
  note?: string
}

export function SlotListSkeleton() {
  return (
    <div className="flex flex-col gap-2" aria-busy>
      <div className="flex gap-2 overflow-hidden pb-2">
        {Array.from({ length: 7 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-14 shrink-0" />
        ))}
      </div>
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-14 w-full" />
      ))}
    </div>
  )
}

export function DateStrip({
  dateKeys,
  selected,
  onSelect,
}: {
  dateKeys: string[]
  selected: string
  onSelect: (key: string) => void
}) {
  return (
    <div
      className="-mx-5 flex snap-x snap-mandatory gap-2 overflow-x-auto px-5 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      role="tablist"
      aria-label="Choose a date"
    >
      {dateKeys.map((key) => {
        const parts = dateKeyParts(key)
        const isSelected = key === selected
        return (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={isSelected}
            onClick={() => onSelect(key)}
            className={`flex min-h-16 w-14 shrink-0 snap-start flex-col items-center justify-center gap-0.5 rounded-card border transition-colors ${
              isSelected
                ? 'border-ink bg-ink text-paper'
                : 'border-gray-200 bg-white text-ink hover:border-gray-400'
            }`}
          >
            <span
              className={`text-[11px] font-medium uppercase tracking-wide ${isSelected ? 'text-gray-300' : 'text-gray-500'}`}
            >
              {parts.weekday}
            </span>
            <span className="text-lg font-semibold leading-none">{parts.day}</span>
          </button>
        )
      })}
    </div>
  )
}

export function SlotPicker({
  locationSlug,
  timezone,
  guests,
  onSelect,
  initialDays,
  note,
}: SlotPickerProps) {
  const trpc = useTRPC()
  const dateKeys = useMemo(() => upcomingDateKeys(timezone, 14), [timezone])
  const firstKey = dateKeys[0] ?? ''
  const lastKey = dateKeys[dateKeys.length - 1] ?? firstKey
  const [selectedDate, setSelectedDate] = useState(firstKey)

  const query = useQuery(
    trpc.public.availability.list.queryOptions(
      { locationSlug, fromDate: firstKey, toDate: lastKey },
      {
        refetchInterval: 60_000,
        ...(initialDays ? { initialData: initialDays } : {}),
      },
    ),
  )

  const day = query.data?.find((d) => d.date === selectedDate)
  const slots = day?.sessions ?? []

  return (
    <div className="flex flex-col gap-4">
      <DateStrip dateKeys={dateKeys} selected={selectedDate} onSelect={setSelectedDate} />

      {note ? <p className="text-sm text-gray-500">{note}</p> : null}

      {/* Slot list — fixed row height, zero layout shift while refetching */}
      {query.isPending ? (
        <div className="flex flex-col gap-2" aria-busy>
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : slots.length === 0 ? (
        <p className="py-10 text-center text-gray-500">No sessions on this day.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {slots.map((slot) => {
            const soldOut = slot.remainingSeats <= 0
            const tooSmall = !soldOut && slot.remainingSeats < guests
            const disabled = soldOut || tooSmall
            return (
              <li key={slot.sessionId}>
                <button
                  type="button"
                  onClick={() => onSelect(slot)}
                  disabled={disabled}
                  className={`flex min-h-14 w-full items-center justify-between gap-3 rounded-card border bg-white px-4 text-left transition-colors ${
                    disabled
                      ? 'border-gray-100 opacity-45'
                      : 'border-gray-200 hover:border-ink active:bg-gray-50'
                  }`}
                >
                  <span className="text-base font-semibold tabular-nums tracking-tight">
                    {formatTimeOfDay(slot.startsAt, timezone)}
                  </span>
                  <span className="flex items-center gap-2.5">
                    {soldOut ? (
                      <Badge>Sold out</Badge>
                    ) : tooSmall ? (
                      <Badge>
                        Only {slot.remainingSeats} {slot.remainingSeats === 1 ? 'spot' : 'spots'}
                      </Badge>
                    ) : slot.remainingSeats <= 3 ? (
                      <Badge tone="warn">
                        {slot.remainingSeats} {slot.remainingSeats === 1 ? 'spot' : 'spots'} left
                      </Badge>
                    ) : null}
                    <span className="text-sm text-gray-500 tabular-nums">
                      {formatCents(slot.priceCents)}
                    </span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
