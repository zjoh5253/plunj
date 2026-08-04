'use client'

/**
 * Membership tab: plan cards + punch pass from public.memberships.list.
 * Listing only — purchase is Phase 3, so every CTA is a disabled placeholder.
 * Every cent rendered here came verbatim from the server (invariant #1).
 */

import { useQuery } from '@tanstack/react-query'
import { Skeleton } from '@/components/ui/skeleton'
import type { RouterOutputs } from '@/lib/api-types'
import { formatCents } from '@/lib/format'
import { useTRPC } from '@/lib/trpc/client'

type MembershipList = RouterOutputs['public']['memberships']['list']
type Plan = MembershipList['plans'][number]

function visitPolicyLabel(plan: Plan): string {
  if (plan.visitPolicy === 'UNLIMITED') return 'Unlimited sessions'
  const n = plan.visitsPerPeriod ?? 0
  return `${n} ${n === 1 ? 'session' : 'sessions'} a month`
}

function DisabledCta() {
  return (
    <button
      type="button"
      disabled
      className="mt-auto min-h-11 w-full cursor-not-allowed rounded-card border border-gray-200 bg-gray-50 px-4 text-sm font-medium text-gray-400"
    >
      Join at the front desk — online signup coming soon
    </button>
  )
}

export function MembershipPlans({
  locationSlug,
  pricesConfirmed = false,
}: {
  locationSlug: string
  /** True when the listed prices are this studio's real (confirmed) prices. */
  pricesConfirmed?: boolean
}) {
  const trpc = useTRPC()
  const listQuery = useQuery(trpc.public.memberships.list.queryOptions({ locationSlug }))

  if (listQuery.isPending) {
    return (
      <div className="grid gap-3 sm:grid-cols-2" aria-busy>
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-52 w-full" />
        ))}
      </div>
    )
  }

  const plans = listQuery.data?.plans ?? []
  const packs = listQuery.data?.packs ?? []
  if (plans.length === 0 && packs.length === 0) {
    return (
      <p className="py-10 text-center text-gray-500">
        Memberships aren&apos;t available at this studio yet.
      </p>
    )
  }

  // Flagship emphasis: the SISU Unlimited tier when present, otherwise the
  // most expensive plan (the server returns plans ordered by price ascending).
  const featured = plans.find((p) => p.name === 'SISU Unlimited') ?? plans[plans.length - 1]

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        {plans.map((plan) => {
          const isFeatured = plan.id === featured?.id
          return (
            <div
              key={plan.id}
              className={`relative flex flex-col gap-3 rounded-card border bg-white p-5 ${
                isFeatured ? 'border-ink shadow-sm' : 'border-gray-200'
              }`}
            >
              {isFeatured && (
                <span className="absolute -top-2.5 right-4 rounded-full bg-ink px-2.5 py-0.5 text-xs font-medium text-paper">
                  Most popular
                </span>
              )}
              <div className="flex flex-col gap-1">
                <h3 className="text-sm font-semibold tracking-tight">{plan.name}</h3>
                <p className="text-2xl font-semibold tracking-tight tabular-nums">
                  {formatCents(plan.priceCents)}
                  <span className="text-sm font-normal text-gray-500">/mo</span>
                </p>
              </div>
              <ul className="flex flex-col gap-1 text-sm text-gray-600">
                <li>{visitPolicyLabel(plan)}</li>
                {plan.guestPassesPerPeriod > 0 && (
                  <li>
                    {plan.guestPassesPerPeriod} guest{' '}
                    {plan.guestPassesPerPeriod === 1 ? 'pass' : 'passes'} a month
                  </li>
                )}
              </ul>
              <DisabledCta />
            </div>
          )
        })}

        {packs.map((pack) => (
          <div
            key={pack.id}
            className="flex flex-col gap-3 rounded-card border border-gray-200 bg-white p-5"
          >
            <div className="flex flex-col gap-1">
              <h3 className="text-sm font-semibold tracking-tight">{pack.name}</h3>
              <p className="text-2xl font-semibold tracking-tight tabular-nums">
                {formatCents(pack.priceCents)}
              </p>
            </div>
            <ul className="flex flex-col gap-1 text-sm text-gray-600">
              <li>
                {pack.credits} session {pack.credits === 1 ? 'credit' : 'credits'}
              </li>
              {pack.expiresAfterDays !== null && (
                <li>Expires after {pack.expiresAfterDays} days</li>
              )}
            </ul>
            <DisabledCta />
          </div>
        ))}
      </div>

      {!pricesConfirmed && (
        <p className="text-xs text-gray-400">
          Membership pricing is being confirmed for this studio.
        </p>
      )}
    </div>
  )
}
