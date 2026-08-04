'use client'

/**
 * Customer lookup: phone/name search → results with visit summary and waiver
 * status → detail panel. Renders exactly what desk.customers.search exposes
 * (the desk API has no per-customer bookings/credits query yet), plus an
 * add-credit action against the audited desk.credit mutation.
 */

import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import type { CustomerHit } from '@/components/desk/desk-types'
import { useStaffGuard } from '@/components/desk/guard'
import { DeskSheet } from '@/components/desk/sheet'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import type { LocationDetail } from '@/lib/api-types'
import { domainError } from '@/lib/api-types'
import { formatCents, formatPhoneUS, formatSessionMoment } from '@/lib/format'
import { useTRPC } from '@/lib/trpc/client'

export function CustomersClient({ location }: { location: LocationDetail }) {
  const trpc = useTRPC()
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [selected, setSelected] = useState<CustomerHit | null>(null)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 300)
    return () => clearTimeout(timer)
  }, [query])

  const search = useQuery(
    trpc.desk.customers.search.queryOptions(
      { locationSlug: location.slug, q: debounced },
      { enabled: debounced.length >= 2, placeholderData: keepPreviousData },
    ),
  )
  useStaffGuard(search.error)

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold tracking-tight">Customers</h1>

      <Input
        label="Search"
        type="search"
        placeholder="Phone or name"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoFocus
        hint="At least two characters."
      />

      {debounced.length < 2 ? (
        <p className="py-10 text-center text-gray-400">
          Search by phone number or name to pull up a customer.
        </p>
      ) : search.isPending ? (
        <div className="flex flex-col gap-2" aria-busy>
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : search.isError ? (
        <p className="rounded-card bg-danger/5 px-4 py-3 text-sm text-danger" role="alert">
          {domainError(search.error).messageText}
        </p>
      ) : search.data.length === 0 ? (
        <p className="py-10 text-center text-gray-500">No customers match “{debounced}”.</p>
      ) : (
        <ul className={`flex flex-col gap-2 ${search.isFetching ? 'opacity-60' : ''}`}>
          {search.data.map((hit) => (
            <li key={hit.customerId}>
              <button
                type="button"
                onClick={() => setSelected(hit)}
                className="flex min-h-16 w-full items-center justify-between gap-3 rounded-card border border-gray-200 bg-white px-4 py-2 text-left transition-colors hover:border-ink"
              >
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-medium">{hit.name || 'Guest'}</span>
                  <span className="text-sm text-gray-500 tabular-nums">
                    {formatPhoneUS(hit.phone)}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="text-sm text-gray-500 tabular-nums">
                    {hit.visits} {hit.visits === 1 ? 'visit' : 'visits'}
                  </span>
                  <WaiverBadge status={hit.waiverStatus} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {selected ? (
        <CustomerDetail hit={selected} location={location} onClose={() => setSelected(null)} />
      ) : null}
    </div>
  )
}

function WaiverBadge({ status }: { status: CustomerHit['waiverStatus'] }) {
  if (status === 'SIGNED') return <Badge tone="ok">✓ Waiver</Badge>
  if (status === 'MINOR_UNVERIFIED') return <Badge tone="warn">Minor</Badge>
  return <Badge tone="danger">Unsigned</Badge>
}

function CustomerDetail({
  hit,
  location,
  onClose,
}: {
  hit: CustomerHit
  location: LocationDetail
  onClose: () => void
}) {
  const [creditOpen, setCreditOpen] = useState(false)

  return (
    <DeskSheet open onClose={onClose} title={hit.name || 'Guest'}>
      {creditOpen ? (
        <CreditForm
          locationSlug={location.slug}
          customerId={hit.customerId}
          customerName={hit.name}
          onBack={() => setCreditOpen(false)}
          onDone={onClose}
        />
      ) : (
        <div className="flex flex-col gap-4">
          <Card className="flex flex-col gap-2 text-sm">
            <DetailRow label="Phone">
              <a href={`tel:${hit.phone}`} className="tabular-nums underline underline-offset-2">
                {formatPhoneUS(hit.phone)}
              </a>
            </DetailRow>
            <DetailRow label="Customer type">
              {hit.kind === 'ACCOUNT' ? 'Account' : 'Guest'}
            </DetailRow>
            <DetailRow label={`Waiver at ${location.name}`}>
              <WaiverBadge status={hit.waiverStatus} />
            </DetailRow>
            <DetailRow label="Visits here">
              <span className="tabular-nums">{hit.visits}</span>
            </DetailRow>
            <DetailRow label="Last visit">
              {hit.lastVisitAt
                ? formatSessionMoment(hit.lastVisitAt, location.timezone)
                : 'Never checked in'}
            </DetailRow>
          </Card>
          <Button size="lg" variant="secondary" onClick={() => setCreditOpen(true)}>
            Add account credit
          </Button>
        </div>
      )}
    </DeskSheet>
  )
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-gray-500">{label}</span>
      <span className="text-right">{children}</span>
    </div>
  )
}

const REASONS = ['Service issue', 'Equipment', 'Goodwill', 'Other'] as const

function CreditForm({
  locationSlug,
  customerId,
  customerName,
  onBack,
  onDone,
}: {
  locationSlug: string
  customerId: string
  customerName: string
  onBack: () => void
  onDone: () => void
}) {
  const trpc = useTRPC()
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState<string | null>(null)
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)

  const credit = useMutation(
    trpc.desk.credit.mutationOptions({
      onSuccess: onDone,
      onError: (err) => setError(domainError(err).messageText),
    }),
  )

  const parsed = Number.parseFloat(amount)
  const amountCents = Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) : null
  const canSubmit =
    amountCents !== null && reason !== null && pin.trim().length > 0 && !credit.isPending

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (!canSubmit || amountCents === null || reason === null) return
        setError(null)
        credit.mutate({ locationSlug, customerId, amountCents, reason, staffPin: pin.trim() })
      }}
    >
      <p className="text-gray-600">
        Add account credit for{' '}
        <span className="font-medium text-ink">{customerName || 'this guest'}</span>.
      </p>
      <Input
        label="Credit amount"
        type="number"
        inputMode="decimal"
        min={0.01}
        step={0.01}
        placeholder="$0.00"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
      />
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-gray-700">Reason</span>
        <div className="flex flex-wrap gap-2">
          {REASONS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setReason(r)}
              aria-pressed={reason === r}
              className={`flex min-h-11 items-center rounded-full border px-4 text-sm font-medium transition-colors ${
                reason === r
                  ? 'border-ink bg-ink text-paper'
                  : 'border-gray-200 bg-white text-ink hover:border-gray-400'
              }`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>
      <Input
        label="Staff PIN"
        type="password"
        inputMode="numeric"
        autoComplete="off"
        value={pin}
        onChange={(e) => setPin(e.target.value)}
      />
      <div className="min-h-5" aria-live="polite">
        {error ? <p className="text-sm text-danger">{error}</p> : null}
      </div>
      <Button type="submit" size="lg" loading={credit.isPending} disabled={!canSubmit}>
        {amountCents !== null ? `Add ${formatCents(amountCents)} credit` : 'Add credit'}
      </Button>
      <button
        type="button"
        onClick={onBack}
        className="min-h-11 self-start text-sm font-medium text-gray-500 underline underline-offset-2"
      >
        ← Back
      </button>
    </form>
  )
}
