'use client'

/**
 * Buyout tier editor — owner-configurable pricing for private buyouts.
 * Dollars→cents conversion happens only as form-input encoding; every
 * displayed amount renders the server's stored cents verbatim.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import type { LocationDetail } from '@/lib/api-types'
import { formatCents } from '@/lib/format'
import { useTRPC } from '@/lib/trpc/client'

export function BuyoutEditor({ location }: { location: LocationDetail }) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState({ hours: '1', price: '', guests: '' })

  const listOptions = trpc.admin.buyouts.list.queryOptions({ locationSlug: location.slug })
  const tiers = useQuery(listOptions)

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: listOptions.queryKey })
    void queryClient.invalidateQueries({
      queryKey: trpc.public.buyouts.options.queryOptions({ locationSlug: location.slug }).queryKey,
    })
  }
  const onError = (e: unknown) => setError(e instanceof Error ? e.message : 'Something went wrong')

  const create = useMutation(
    trpc.admin.buyouts.create.mutationOptions({
      onSuccess: () => {
        setDraft({ hours: '1', price: '', guests: '' })
        setError(null)
        invalidate()
      },
      onError,
    }),
  )
  const update = useMutation(
    trpc.admin.buyouts.update.mutationOptions({
      onSuccess: () => {
        setError(null)
        invalidate()
      },
      onError,
    }),
  )

  const draftValid =
    Number(draft.hours) >= 1 && Number(draft.price) > 0 && Number(draft.guests) >= 1

  return (
    <Card className="flex flex-col gap-3">
      <h2 className="text-sm font-medium uppercase tracking-wide text-gray-500">Buyout pricing</h2>

      {error ? (
        <p className="rounded-card bg-danger/5 px-3 py-2 text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}

      {tiers.isPending ? (
        <Skeleton className="h-8" />
      ) : (tiers.data ?? []).length === 0 ? (
        <p className="text-sm text-gray-500">No buyout tiers yet — add one below.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {(tiers.data ?? []).map((tier) => (
            <li
              key={tier.buyoutOptionId}
              className={`flex items-center justify-between gap-3 text-sm ${tier.active ? '' : 'opacity-50'}`}
            >
              <span>
                {tier.durationHours}h private buyout · up to {tier.maxGuests} guests
                {tier.active ? '' : ' · retired'}
              </span>
              <span className="flex items-center gap-3">
                <span className="tabular-nums">{formatCents(tier.priceCents)}</span>
                <Button
                  variant="ghost"
                  disabled={update.isPending}
                  onClick={() =>
                    update.mutate({ buyoutOptionId: tier.buyoutOptionId, active: !tier.active })
                  }
                >
                  {tier.active ? 'Retire' : 'Restore'}
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-end gap-2 border-t border-gray-100 pt-3">
        <Input
          label="Hours"
          type="number"
          min={1}
          max={12}
          className="w-20"
          value={draft.hours}
          onChange={(e) => setDraft({ ...draft, hours: e.target.value })}
        />
        <Input
          label="Price ($)"
          type="number"
          min={0}
          step="1"
          className="w-28"
          value={draft.price}
          onChange={(e) => setDraft({ ...draft, price: e.target.value })}
        />
        <Input
          label="Max guests"
          type="number"
          min={1}
          max={50}
          className="w-24"
          value={draft.guests}
          onChange={(e) => setDraft({ ...draft, guests: e.target.value })}
        />
        <Button
          disabled={!draftValid || create.isPending}
          onClick={() =>
            create.mutate({
              locationSlug: location.slug,
              durationHours: Number(draft.hours),
              priceCents: Math.round(Number(draft.price) * 100),
              maxGuests: Number(draft.guests),
            })
          }
        >
          Add tier
        </Button>
      </div>
      <p className="text-xs text-gray-500">
        Changes apply to new bookings immediately; existing buyout bookings keep their paid price.
      </p>
    </Card>
  )
}
