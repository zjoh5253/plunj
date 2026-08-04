'use client'

/**
 * Single-screen checkout. THE money invariant lives here in the negative:
 * every cent shown is rendered verbatim from a server quote; the Pay button
 * label, the breakdown total, and the charged amount are one server value.
 */

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { HoldCountdown } from '@/components/booking/hold-countdown'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import type {
  CheckoutItem,
  CheckoutStartResult,
  LocationDetail,
  QuoteResult,
  ServerQuote,
} from '@/lib/api-types'
import { domainError } from '@/lib/api-types'
import { formatCents } from '@/lib/format'
import { useTRPC } from '@/lib/trpc/client'
import { PaymentStep } from './payment-step'

type Stage =
  { kind: 'form' } | { kind: 'payment'; start: CheckoutStartResult } | { kind: 'conflict' }

export function CheckoutClient({
  location,
  items,
}: {
  location: LocationDetail
  items: CheckoutItem[]
}) {
  const trpc = useTRPC()
  const router = useRouter()
  const queryClient = useQueryClient()

  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [phone, setPhone] = useState('')
  const [promoInput, setPromoInput] = useState('')
  const [promoCode, setPromoCode] = useState('')
  const [tipInput, setTipInput] = useState('')
  const [stage, setStage] = useState<Stage>({ kind: 'form' })
  const [formError, setFormError] = useState<string | null>(null)

  // Promo entry → 300ms debounce → server re-quote.
  useEffect(() => {
    const timer = setTimeout(() => setPromoCode(promoInput.trim()), 300)
    return () => clearTimeout(timer)
  }, [promoInput])

  // Custom tip in whole dollars; the SERVER folds it into the quote.
  const tipCents = useMemo(() => {
    const dollars = Number.parseInt(tipInput, 10)
    return Number.isFinite(dollars) && dollars > 0 ? dollars * 100 : undefined
  }, [tipInput])

  const baseInput = {
    locationSlug: location.slug,
    items,
    ...(tipCents !== undefined ? { tipCents } : {}),
  }

  // Base quote (no code) is always live so an invalid code still shows real totals.
  const baseQuote = useQuery(
    trpc.public.checkout.quote.queryOptions(baseInput, { placeholderData: keepPreviousData }),
  )
  const codedQuote = useQuery(
    trpc.public.checkout.quote.queryOptions(
      { ...baseInput, discountCode: promoCode },
      { enabled: promoCode !== '', placeholderData: keepPreviousData },
    ),
  )

  const codeApplied = promoCode !== '' && codedQuote.data?.ok === true
  const codeRejection =
    promoCode !== '' && codedQuote.data && !codedQuote.data.ok ? codedQuote.data.message : null
  const display: QuoteResult | undefined = codeApplied ? codedQuote.data : baseQuote.data
  const quote = display?.ok ? display.quote : undefined
  const requoting = baseQuote.isFetching || (promoCode !== '' && codedQuote.isFetching)

  const startMutation = useMutation(
    trpc.public.checkout.start.mutationOptions({
      onSuccess: (result) => {
        if (result.clientSecret === null) {
          router.push(`/${location.slug}/confirmed/${result.bookingId}`)
          return
        }
        setStage({ kind: 'payment', start: result })
      },
      onError: (err) => {
        const info = domainError(err)
        if (
          info.domainCode === 'SOLD_OUT' ||
          info.domainCode === 'HOLD_EXPIRED' ||
          info.domainCode === 'BUYOUT_UNAVAILABLE'
        ) {
          setStage({ kind: 'conflict' })
          return
        }
        setFormError(info.messageText)
      },
    }),
  )

  const backToSchedule = () => {
    void queryClient.invalidateQueries(trpc.public.availability.list.pathFilter())
    router.push(`/${location.slug}`)
  }

  if (stage.kind === 'conflict') {
    return (
      <div className="flex flex-col items-center gap-4 pt-16 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">That time just filled up</h1>
        <p className="max-w-xs text-gray-500">
          Someone grabbed the last spot while you were checking out. The schedule has fresh times
          waiting.
        </p>
        <Button size="lg" className="max-w-xs" onClick={backToSchedule}>
          Pick another time
        </Button>
      </div>
    )
  }

  if (stage.kind === 'payment') {
    return (
      <div className="flex flex-col gap-5 pt-2">
        <h1 className="text-2xl font-semibold tracking-tight">Payment</h1>
        {/* The quote returned by checkout.start — the exact amount being charged */}
        <Breakdown quote={stage.start.quote} requoting={false} codeRejection={null} />
        {stage.start.holdExpiresAt ? (
          <HoldCountdown
            holdExpiresAt={stage.start.holdExpiresAt}
            onExpired={() => setStage({ kind: 'conflict' })}
          />
        ) : null}
        <PaymentStep
          clientSecret={stage.start.clientSecret ?? ''}
          totalCents={stage.start.quote.totalCents}
          returnPath={`/${location.slug}/confirmed/${stage.start.bookingId}`}
        />
      </div>
    )
  }

  const canSubmit =
    firstName.trim().length > 0 && phone.trim().length >= 7 && quote !== undefined && !requoting

  return (
    <form
      className="flex flex-col gap-5 pt-2"
      onSubmit={(e) => {
        e.preventDefault()
        if (!canSubmit) return
        setFormError(null)
        const trimmedLast = lastName.trim()
        startMutation.mutate({
          locationSlug: location.slug,
          items,
          ...(codeApplied ? { discountCode: promoCode } : {}),
          ...(tipCents !== undefined ? { tipCents } : {}),
          customer: {
            firstName: firstName.trim(),
            phone: phone.trim(),
            ...(trimmedLast ? { lastName: trimmedLast } : {}),
          },
        })
      }}
    >
      <h1 className="text-2xl font-semibold tracking-tight">Checkout</h1>

      {/* Order summary — descriptions come from the server quote verbatim */}
      <Card className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium uppercase tracking-wide text-gray-500">Your order</h2>
          <Link href={`/${location.slug}`} className="text-sm font-medium underline">
            Change
          </Link>
        </div>
        {quote ? (
          quote.lines.map((line) => (
            <p key={line.id} className="text-base font-medium">
              {line.description}
              {line.qty > 1 ? ` × ${line.qty}` : ''}
            </p>
          ))
        ) : (
          <p className="text-gray-400">Loading…</p>
        )}
      </Card>

      {/* Contact */}
      <div className="grid grid-cols-2 gap-3">
        <Input
          label="First name"
          autoComplete="given-name"
          value={firstName}
          onChange={(e) => setFirstName(e.target.value)}
          required
        />
        <Input
          label="Last name"
          autoComplete="family-name"
          value={lastName}
          onChange={(e) => setLastName(e.target.value)}
        />
      </div>
      <Input
        label="Mobile number"
        type="tel"
        autoComplete="tel"
        inputMode="tel"
        placeholder="(555) 555-5555"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        hint="We'll text your confirmation and waiver link here."
        required
      />

      {/* Always-visible promo field */}
      <Input
        label="Promo code"
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
        value={promoInput}
        onChange={(e) => setPromoInput(e.target.value)}
        placeholder="Have a code?"
      />

      {/* Custom tip (server re-quotes; chips would be client math) */}
      <Input
        label="Add a tip (optional)"
        type="number"
        inputMode="numeric"
        min={0}
        step={1}
        placeholder="$0"
        value={tipInput}
        onChange={(e) => setTipInput(e.target.value)}
        hint="Whole dollars — added to your total."
      />

      <Breakdown quote={quote} requoting={requoting} codeRejection={codeRejection} />

      {formError ? (
        <p className="rounded-card bg-danger/5 px-4 py-3 text-sm text-danger" role="alert">
          {formError}
        </p>
      ) : null}

      <Button type="submit" size="lg" disabled={!canSubmit} loading={startMutation.isPending}>
        {quote ? `Pay ${formatCents(quote.totalCents)}` : 'Loading…'}
      </Button>
      <p className="text-center text-xs text-gray-400">
        Cancel more than 1 hour before your session for automatic account credit. Later
        cancellations aren&apos;t credited; no-shows are charged in full.
      </p>
    </form>
  )
}

/**
 * Animated line-item breakdown. Space is reserved (min-heights) so applying a
 * code or tip never shifts the layout below it.
 */
function Breakdown({
  quote,
  requoting,
  codeRejection,
}: {
  quote: ServerQuote | undefined
  requoting: boolean
  codeRejection: string | null
}) {
  return (
    <Card
      className={`flex flex-col gap-2 transition-opacity duration-200 ${requoting ? 'opacity-60' : ''}`}
    >
      <h2 className="text-sm font-medium uppercase tracking-wide text-gray-500">Total</h2>
      <div className="flex min-h-24 flex-col gap-1.5 text-sm">
        {quote ? (
          <>
            {quote.lines.map((line) => (
              <Row
                key={line.id}
                label={`${line.description}${line.qty > 1 ? ` × ${line.qty}` : ''}`}
                value={formatCents(line.lineSubtotalCents)}
              />
            ))}
            {quote.discountCents > 0 ? (
              <Row
                label={quote.discountDescription ?? 'Discount'}
                value={formatCents(-quote.discountCents)}
                tone="ok"
                animateIn
              />
            ) : null}
            <Row label="Subtotal" value={formatCents(quote.subtotalCents)} muted />
            <Row label="Tax" value={formatCents(quote.taxCents)} muted />
            {quote.tipCents > 0 ? (
              <Row label="Tip" value={formatCents(quote.tipCents)} muted animateIn />
            ) : null}
            <div className="my-1 border-t border-gray-100" />
            <div className="flex items-baseline justify-between">
              <span className="text-base font-semibold">Total</span>
              <span className="text-base font-semibold tabular-nums">
                {formatCents(quote.totalCents)}
              </span>
            </div>
          </>
        ) : (
          <p className="text-gray-400">Calculating…</p>
        )}
      </div>
      {/* Reserved warn-row space: quiet, verbatim API message */}
      <div className="min-h-5" aria-live="polite">
        {codeRejection ? <p className="text-sm text-warn">{codeRejection}</p> : null}
      </div>
    </Card>
  )
}

function Row({
  label,
  value,
  muted = false,
  tone,
  animateIn = false,
}: {
  label: string
  value: string
  muted?: boolean
  tone?: 'ok'
  animateIn?: boolean
}) {
  return (
    <div
      className={`flex items-baseline justify-between gap-4 ${
        animateIn ? 'animate-[fadeSlideIn_200ms_ease-out]' : ''
      }`}
    >
      <span className={tone === 'ok' ? 'text-ok' : muted ? 'text-gray-500' : 'text-ink'}>
        {label}
      </span>
      <span
        className={`tabular-nums ${tone === 'ok' ? 'text-ok' : muted ? 'text-gray-500' : 'text-ink'}`}
      >
        {value}
      </span>
    </div>
  )
}
