'use client'

/**
 * Walk-in sheet: pick a session, attach a customer (phone search or new
 * name+phone), optional discount code, tender, and the SERVER quote breakdown
 * rendered verbatim before confirming (invariant #1 — no client money math).
 * "Card terminal" still creates the REQUIRES_ACTION order; capture arrives
 * with Stripe Terminal in Phase 3.
 */

import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import type { CustomerHit, RosterSession, WalkInResult } from '@/components/desk/desk-types'
import { useStaffGuard } from '@/components/desk/guard'
import { QuoteBreakdown } from '@/components/desk/quote-breakdown'
import { DeskSheet } from '@/components/desk/sheet'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import type { LocationDetail } from '@/lib/api-types'
import { domainError } from '@/lib/api-types'
import { formatCents, formatTimeOfDay } from '@/lib/format'
import { useTRPC } from '@/lib/trpc/client'

type Tender = 'CASH_RECORDED' | 'COMP' | 'TERMINAL'

export function WalkinSheet({
  open,
  location,
  sessions,
  onClose,
  onCreated,
}: {
  open: boolean
  location: LocationDetail
  sessions: RosterSession[]
  onClose: () => void
  onCreated: () => void
}) {
  const trpc = useTRPC()

  // Sessions a walk-in can join: open, not yet ended.
  const nowMs = Date.now()
  const joinable = useMemo(
    () => sessions.filter((s) => s.status === 'OPEN' && new Date(s.endsAt).getTime() > nowMs),
    [sessions, nowMs],
  )
  const defaultSessionId =
    joinable.find((s) => new Date(s.startsAt).getTime() >= nowMs)?.sessionId ??
    joinable[0]?.sessionId ??
    null

  const [sessionId, setSessionId] = useState<string | null>(null)
  const [seats, setSeats] = useState(1)
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [phone, setPhone] = useState('')
  const [codeInput, setCodeInput] = useState('')
  const [code, setCode] = useState('')
  const [tender, setTender] = useState<Tender | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [result, setResult] = useState<{ tender: Tender; created: WalkInResult } | null>(null)

  const selectedSessionId = sessionId ?? defaultSessionId

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 300)
    return () => clearTimeout(timer)
  }, [query])

  useEffect(() => {
    const timer = setTimeout(() => setCode(codeInput.trim()), 300)
    return () => clearTimeout(timer)
  }, [codeInput])

  const search = useQuery(
    trpc.desk.customers.search.queryOptions(
      { locationSlug: location.slug, q: debouncedQuery },
      { enabled: open && debouncedQuery.length >= 2, placeholderData: keepPreviousData },
    ),
  )
  useStaffGuard(search.error)

  const quoteInput = selectedSessionId
    ? {
        locationSlug: location.slug,
        items: [{ kind: 'DROP_IN' as const, sessionId: selectedSessionId, seats }],
        ...(code !== '' ? { discountCode: code } : {}),
      }
    : null
  const quote = useQuery(
    trpc.public.checkout.quote.queryOptions(
      quoteInput ?? { locationSlug: location.slug, items: [] },
      { enabled: open && quoteInput !== null, placeholderData: keepPreviousData },
    ),
  )
  const serverQuote = quote.data?.ok === true ? quote.data.quote : undefined
  const rejection = quote.data && !quote.data.ok ? quote.data.message : null

  const create = useMutation(
    trpc.desk.walkIn.create.mutationOptions({
      onSuccess: (created, variables) => {
        setResult({ tender: variables.paymentTender, created })
        onCreated()
      },
      onError: (err) => setFormError(domainError(err).messageText),
    }),
  )
  useStaffGuard(create.error)

  const pickCustomer = (hit: CustomerHit) => {
    const parts = hit.name.split(/\s+/).filter(Boolean)
    setFirstName(parts[0] ?? '')
    setLastName(parts.slice(1).join(' '))
    setPhone(hit.phone)
    setQuery('')
    setDebouncedQuery('')
  }

  const reset = () => {
    setSessionId(null)
    setSeats(1)
    setQuery('')
    setDebouncedQuery('')
    setFirstName('')
    setLastName('')
    setPhone('')
    setCodeInput('')
    setCode('')
    setTender(null)
    setFormError(null)
    setResult(null)
  }

  const close = () => {
    reset()
    onClose()
  }

  const canSubmit =
    selectedSessionId !== null &&
    firstName.trim().length > 0 &&
    phone.trim().length >= 7 &&
    tender !== null &&
    serverQuote !== undefined &&
    rejection === null &&
    !create.isPending

  if (result) {
    const total = formatCents(result.created.quote.totalCents)
    return (
      <DeskSheet open={open} onClose={close} title="Walk-in">
        <div className="flex flex-col items-center gap-4 py-8 text-center">
          {result.tender === 'TERMINAL' ? (
            <>
              <p className="text-5xl" aria-hidden>
                ⏳
              </p>
              <p className="text-xl font-semibold tracking-tight">Order created — {total} due</p>
              <p className="max-w-sm text-gray-500">
                The order is on the roster awaiting card payment. Terminal integration coming in
                Phase 3 — take payment on the card terminal and reconcile there.
              </p>
            </>
          ) : (
            <>
              <p className="text-5xl text-ok" aria-hidden>
                ✓
              </p>
              <p className="text-xl font-semibold tracking-tight">
                {result.tender === 'COMP' ? `Comped — ${total}` : `Cash recorded — ${total}`}
              </p>
              <p className="max-w-sm text-gray-500">
                {firstName.trim() || 'The guest'} is booked and on the roster.
              </p>
            </>
          )}
          <Button size="lg" className="max-w-xs" onClick={close}>
            Done
          </Button>
        </div>
      </DeskSheet>
    )
  }

  return (
    <DeskSheet open={open} onClose={close} title="Walk-in">
      <form
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault()
          if (!canSubmit || selectedSessionId === null || tender === null) return
          setFormError(null)
          const trimmedLast = lastName.trim()
          create.mutate({
            locationSlug: location.slug,
            sessionId: selectedSessionId,
            seats,
            customer: {
              firstName: firstName.trim(),
              phone: phone.trim(),
              ...(trimmedLast ? { lastName: trimmedLast } : {}),
            },
            ...(code !== '' ? { discountCode: code } : {}),
            paymentTender: tender,
          })
        }}
      >
        {/* Session */}
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-gray-700">Session</span>
          {joinable.length === 0 ? (
            <p className="text-sm text-gray-500">No open sessions left today.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {joinable.map((s) => {
                const remaining = s.capacity - s.bookedSeats
                const full = remaining <= 0
                const selected = s.sessionId === selectedSessionId
                return (
                  <button
                    key={s.sessionId}
                    type="button"
                    disabled={full}
                    onClick={() => setSessionId(s.sessionId)}
                    aria-pressed={selected}
                    className={`flex min-h-11 items-center gap-2 rounded-card border px-4 text-sm font-medium transition-colors disabled:opacity-40 ${
                      selected
                        ? 'border-ink bg-ink text-paper'
                        : 'border-gray-200 bg-white hover:border-gray-400'
                    }`}
                  >
                    <span className="tabular-nums">
                      {formatTimeOfDay(s.startsAt, location.timezone)}
                    </span>
                    <span
                      className={`text-xs tabular-nums ${selected ? 'text-gray-300' : 'text-gray-500'}`}
                    >
                      {full ? 'Full' : `${s.bookedSeats}/${s.capacity}`}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Seats */}
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-gray-700">Seats</span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label="Fewer seats"
              disabled={seats <= 1}
              onClick={() => setSeats((n) => Math.max(1, n - 1))}
              className="flex min-h-11 min-w-11 items-center justify-center rounded-card border border-gray-200 text-lg font-semibold hover:border-gray-400 disabled:opacity-40"
            >
              −
            </button>
            <span className="min-w-8 text-center text-lg font-semibold tabular-nums">{seats}</span>
            <button
              type="button"
              aria-label="More seats"
              disabled={seats >= 8}
              onClick={() => setSeats((n) => Math.min(8, n + 1))}
              className="flex min-h-11 min-w-11 items-center justify-center rounded-card border border-gray-200 text-lg font-semibold hover:border-gray-400 disabled:opacity-40"
            >
              +
            </button>
          </div>
        </div>

        {/* Customer */}
        <div className="flex flex-col gap-3">
          <Input
            label="Find customer"
            type="search"
            placeholder="Search by phone or name"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            hint="Or type a new customer below."
          />
          {debouncedQuery.length >= 2 && search.data ? (
            search.data.length === 0 ? (
              <p className="text-sm text-gray-400">No matches — enter their details below.</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {search.data.slice(0, 5).map((hit) => (
                  <li key={hit.customerId}>
                    <button
                      type="button"
                      onClick={() => pickCustomer(hit)}
                      className="flex min-h-12 w-full items-center justify-between gap-3 rounded-card border border-gray-200 bg-white px-4 text-left transition-colors hover:border-ink"
                    >
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate font-medium">{hit.name || 'Guest'}</span>
                        <span className="text-sm text-gray-500 tabular-nums">{hit.phone}</span>
                      </span>
                      {hit.waiverStatus === 'SIGNED' ? (
                        <Badge tone="ok">✓ Waiver</Badge>
                      ) : (
                        <Badge tone="danger">Waiver</Badge>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )
          ) : null}
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="First name"
              autoComplete="off"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              required
            />
            <Input
              label="Last name"
              autoComplete="off"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
            />
          </div>
          <Input
            label="Mobile number"
            type="tel"
            inputMode="tel"
            autoComplete="off"
            placeholder="(555) 555-5555"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            required
          />
        </div>

        {/* Discount */}
        <Input
          label="Discount code (optional)"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          placeholder="Have a code?"
          value={codeInput}
          onChange={(e) => setCodeInput(e.target.value)}
        />

        {/* Server quote, verbatim */}
        <QuoteBreakdown quote={serverQuote} requoting={quote.isFetching} rejection={rejection} />

        {/* Tender */}
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-gray-700">Payment</span>
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                ['CASH_RECORDED', 'Record cash'],
                ['COMP', 'Comp'],
                ['TERMINAL', 'Card terminal'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setTender(value)}
                aria-pressed={tender === value}
                className={`flex min-h-13 items-center justify-center rounded-card border px-2 text-sm font-medium transition-colors ${
                  tender === value
                    ? 'border-ink bg-ink text-paper'
                    : 'border-gray-200 bg-white hover:border-gray-400'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="min-h-5">
            {tender === 'TERMINAL' ? (
              <p className="text-sm text-warn">
                Terminal integration coming in Phase 3 — this creates the order awaiting card
                payment.
              </p>
            ) : null}
          </div>
        </div>

        {formError ? (
          <p className="rounded-card bg-danger/5 px-4 py-3 text-sm text-danger" role="alert">
            {formError}
          </p>
        ) : null}

        <Button type="submit" size="lg" loading={create.isPending} disabled={!canSubmit}>
          {serverQuote
            ? tender === 'COMP'
              ? `Comp ${formatCents(serverQuote.totalCents)}`
              : tender === 'TERMINAL'
                ? `Create order — ${formatCents(serverQuote.totalCents)}`
                : `Record cash ${formatCents(serverQuote.totalCents)}`
            : 'Loading…'}
        </Button>
      </form>
    </DeskSheet>
  )
}
