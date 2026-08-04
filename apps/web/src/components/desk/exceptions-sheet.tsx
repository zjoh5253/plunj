'use client'

/**
 * Per-booking exceptions action sheet: no-show, refund, credit/comp, move
 * guest, all against the audited desk API (refund/credit require a staff PIN
 * server-side). Order/customer identifiers come from the desk booking lookup
 * route because the roster payload does not carry them. API error messages are
 * always surfaced verbatim.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { RosterBooking, RosterSession } from '@/components/desk/desk-types'
import { fetchBookingLookup } from '@/components/desk/desk-types'
import { useStaffGuard } from '@/components/desk/guard'
import { DeskSheet } from '@/components/desk/sheet'
import { SlotPicker } from '@/components/booking/slot-picker'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import type { AvailabilitySlot, LocationDetail } from '@/lib/api-types'
import { domainError } from '@/lib/api-types'
import { formatCents, formatTimeOfDay } from '@/lib/format'
import { useTRPC } from '@/lib/trpc/client'

const REASONS = ['Service issue', 'Equipment', 'Goodwill', 'Other'] as const

type View = 'menu' | 'noshow' | 'refund' | 'credit' | 'move'

export function ExceptionsSheet({
  booking,
  session,
  location,
  onClose,
  onDone,
}: {
  booking: RosterBooking
  session: RosterSession
  location: LocationDetail
  onClose: () => void
  onDone: () => void
}) {
  const [view, setView] = useState<View>('menu')

  const lookup = useQuery({
    queryKey: ['desk-booking-lookup', booking.bookingId],
    queryFn: () => fetchBookingLookup(booking.bookingId),
  })
  useStaffGuard(lookup.error)

  const title =
    view === 'menu'
      ? booking.customerName || 'Guest'
      : view === 'noshow'
        ? 'Mark no-show'
        : view === 'refund'
          ? 'Refund'
          : view === 'credit'
            ? 'Account credit'
            : 'Move guest'

  return (
    <DeskSheet open onClose={onClose} title={title}>
      {view === 'menu' ? (
        <Menu booking={booking} session={session} location={location} onPick={setView} />
      ) : view === 'noshow' ? (
        <NoShowView booking={booking} onBack={() => setView('menu')} onDone={onDone} />
      ) : view === 'refund' ? (
        <RefundView
          lookupPending={lookup.isPending}
          lookupError={lookup.isError ? (lookup.error?.message ?? 'Lookup failed') : null}
          order={lookup.data?.order ?? null}
          onBack={() => setView('menu')}
          onDone={onDone}
        />
      ) : view === 'credit' ? (
        <CreditView
          locationSlug={location.slug}
          customerId={lookup.data?.customerId ?? null}
          customerName={booking.customerName}
          lookupPending={lookup.isPending}
          onBack={() => setView('menu')}
          onDone={onDone}
        />
      ) : (
        <MoveView
          booking={booking}
          location={location}
          manageToken={lookup.data?.manageToken ?? null}
          lookupPending={lookup.isPending}
          onBack={() => setView('menu')}
          onDone={onDone}
        />
      )}
    </DeskSheet>
  )
}

// ---------------------------------------------------------------------------

function Menu({
  booking,
  session,
  location,
  onPick,
}: {
  booking: RosterBooking
  session: RosterSession
  location: LocationDetail
  onPick: (view: View) => void
}) {
  const item = (label: string, hint: string, view: View, danger = false) => (
    <button
      type="button"
      onClick={() => onPick(view)}
      className={`flex min-h-14 w-full flex-col justify-center rounded-card border bg-white px-4 text-left transition-colors ${
        danger ? 'border-gray-200 hover:border-danger/40' : 'border-gray-200 hover:border-ink'
      }`}
    >
      <span className={`font-medium ${danger ? 'text-danger' : ''}`}>{label}</span>
      <span className="text-sm text-gray-500">{hint}</span>
    </button>
  )

  return (
    <div className="flex flex-col gap-2">
      <p className="pb-1 text-sm text-gray-500">
        {formatTimeOfDay(session.startsAt, location.timezone)} · {session.studioName} ·{' '}
        {booking.seats} {booking.seats === 1 ? 'seat' : 'seats'}
      </p>
      {item('Move guest', 'Reschedule to another session — free, same-priced times', 'move')}
      {item('Account credit / comp', 'Add stored-value credit (staff PIN)', 'credit')}
      {item('Refund', 'Refund part or all of the order (staff PIN)', 'refund', true)}
      {item('No-show', 'Mark this booking a no-show', 'noshow', true)}
    </div>
  )
}

function ErrorLine({ message }: { message: string | null }) {
  return (
    <div className="min-h-5" aria-live="polite">
      {message ? <p className="text-sm text-danger">{message}</p> : null}
    </div>
  )
}

function BackButton({ onBack }: { onBack: () => void }) {
  return (
    <button
      type="button"
      onClick={onBack}
      className="min-h-11 self-start text-sm font-medium text-gray-500 underline underline-offset-2"
    >
      ← Back
    </button>
  )
}

// ---------------------------------------------------------------------------

function NoShowView({
  booking,
  onBack,
  onDone,
}: {
  booking: RosterBooking
  onBack: () => void
  onDone: () => void
}) {
  const trpc = useTRPC()
  const [error, setError] = useState<string | null>(null)
  const noShow = useMutation(
    trpc.desk.noShow.mutationOptions({
      onSuccess: onDone,
      onError: (err) => setError(domainError(err).messageText),
    }),
  )
  return (
    <div className="flex flex-col gap-4">
      <p className="text-gray-600">
        Mark <span className="font-medium text-ink">{booking.customerName || 'this guest'}</span> a
        no-show for this session? This frees nothing automatically — seats stay consumed.
      </p>
      <ErrorLine message={error} />
      <Button
        variant="danger"
        size="lg"
        loading={noShow.isPending}
        onClick={() => noShow.mutate({ bookingId: booking.bookingId })}
      >
        Mark no-show
      </Button>
      <BackButton onBack={onBack} />
    </div>
  )
}

// ---------------------------------------------------------------------------

function ReasonChips({
  value,
  onChange,
}: {
  value: string | null
  onChange: (reason: string) => void
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-gray-700">Reason</span>
      <div className="flex flex-wrap gap-2">
        {REASONS.map((reason) => (
          <button
            key={reason}
            type="button"
            onClick={() => onChange(reason)}
            aria-pressed={value === reason}
            className={`flex min-h-11 items-center rounded-full border px-4 text-sm font-medium transition-colors ${
              value === reason
                ? 'border-ink bg-ink text-paper'
                : 'border-gray-200 bg-white text-ink hover:border-gray-400'
            }`}
          >
            {reason}
          </button>
        ))}
      </div>
    </div>
  )
}

/** Whole-dollar/cents text input → integer cents (input parsing, not pricing). */
function parseAmountCents(raw: string): number | null {
  const value = Number.parseFloat(raw)
  if (!Number.isFinite(value) || value <= 0) return null
  return Math.round(value * 100)
}

function RefundView({
  lookupPending,
  lookupError,
  order,
  onBack,
  onDone,
}: {
  lookupPending: boolean
  lookupError: string | null
  order: {
    orderId: string
    totalCents: number
    refundedCents: number
    refundableCents: number
  } | null
  onBack: () => void
  onDone: () => void
}) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const [amount, setAmount] = useState<string | null>(null)
  const [reason, setReason] = useState<string | null>(null)
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)

  const refund = useMutation(
    trpc.desk.refund.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: ['desk-booking-lookup'] })
        onDone()
      },
      onError: (err) => setError(domainError(err).messageText),
    }),
  )

  if (lookupPending) {
    return (
      <div className="flex justify-center py-10">
        <Spinner />
      </div>
    )
  }
  if (lookupError) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-danger">{lookupError}</p>
        <BackButton onBack={onBack} />
      </div>
    )
  }
  if (!order) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-gray-600">This booking has no order attached — nothing to refund.</p>
        <BackButton onBack={onBack} />
      </div>
    )
  }

  const amountValue = amount ?? (order.refundableCents / 100).toFixed(2)
  const amountCents = parseAmountCents(amountValue)
  const tooMuch = amountCents !== null && amountCents > order.refundableCents
  const canSubmit =
    amountCents !== null &&
    !tooMuch &&
    reason !== null &&
    pin.trim().length > 0 &&
    !refund.isPending

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (!canSubmit || amountCents === null || reason === null) return
        setError(null)
        refund.mutate({
          orderId: order.orderId,
          amountCents,
          reason,
          staffPin: pin.trim(),
        })
      }}
    >
      <div className="flex flex-col gap-1 rounded-card bg-gray-50 px-4 py-3 text-sm">
        <div className="flex justify-between">
          <span className="text-gray-500">Order total</span>
          <span className="tabular-nums">{formatCents(order.totalCents)}</span>
        </div>
        {order.refundedCents > 0 ? (
          <div className="flex justify-between">
            <span className="text-gray-500">Already refunded</span>
            <span className="tabular-nums">{formatCents(order.refundedCents)}</span>
          </div>
        ) : null}
        <div className="flex justify-between font-medium">
          <span>Refundable</span>
          <span className="tabular-nums">{formatCents(order.refundableCents)}</span>
        </div>
      </div>

      <Input
        label="Refund amount"
        type="number"
        inputMode="decimal"
        min={0.01}
        step={0.01}
        value={amountValue}
        onChange={(e) => setAmount(e.target.value)}
        {...(tooMuch
          ? { error: `Maximum refundable is ${formatCents(order.refundableCents)}` }
          : {})}
      />

      <ReasonChips value={reason} onChange={setReason} />

      <Input
        label="Staff PIN"
        type="password"
        inputMode="numeric"
        autoComplete="off"
        value={pin}
        onChange={(e) => setPin(e.target.value)}
      />

      <ErrorLine message={error} />
      <Button
        type="submit"
        variant="danger"
        size="lg"
        loading={refund.isPending}
        disabled={!canSubmit}
      >
        {amountCents !== null && !tooMuch ? `Refund ${formatCents(amountCents)}` : 'Refund'}
      </Button>
      <BackButton onBack={onBack} />
    </form>
  )
}

// ---------------------------------------------------------------------------

function CreditView({
  locationSlug,
  customerId,
  customerName,
  lookupPending,
  onBack,
  onDone,
}: {
  locationSlug: string
  customerId: string | null
  customerName: string
  lookupPending: boolean
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

  if (lookupPending) {
    return (
      <div className="flex justify-center py-10">
        <Spinner />
      </div>
    )
  }

  const amountCents = parseAmountCents(amount)
  const canSubmit =
    amountCents !== null &&
    reason !== null &&
    pin.trim().length > 0 &&
    customerId !== null &&
    !credit.isPending

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (!canSubmit || amountCents === null || reason === null || customerId === null) return
        setError(null)
        credit.mutate({
          locationSlug,
          customerId,
          amountCents,
          reason,
          staffPin: pin.trim(),
        })
      }}
    >
      <p className="text-gray-600">
        Add account credit for{' '}
        <span className="font-medium text-ink">{customerName || 'this guest'}</span>. Credits live
        on the stored-value ledger and apply at their next checkout.
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
      <ReasonChips value={reason} onChange={setReason} />
      <Input
        label="Staff PIN"
        type="password"
        inputMode="numeric"
        autoComplete="off"
        value={pin}
        onChange={(e) => setPin(e.target.value)}
      />
      <ErrorLine message={error} />
      <Button type="submit" size="lg" loading={credit.isPending} disabled={!canSubmit}>
        {amountCents !== null ? `Add ${formatCents(amountCents)} credit` : 'Add credit'}
      </Button>
      <BackButton onBack={onBack} />
    </form>
  )
}

// ---------------------------------------------------------------------------

function MoveView({
  booking,
  location,
  manageToken,
  lookupPending,
  onBack,
  onDone,
}: {
  booking: RosterBooking
  location: LocationDetail
  manageToken: string | null
  lookupPending: boolean
  onBack: () => void
  onDone: () => void
}) {
  const trpc = useTRPC()
  const [picked, setPicked] = useState<AvailabilitySlot | null>(null)
  const [error, setError] = useState<string | null>(null)

  const reschedule = useMutation(
    trpc.public.manage.reschedule.mutationOptions({
      onSuccess: onDone,
      onError: (err) => {
        setError(domainError(err).messageText)
        setPicked(null)
      },
    }),
  )

  if (lookupPending) {
    return (
      <div className="flex justify-center py-10">
        <Spinner />
      </div>
    )
  }
  if (manageToken === null) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-gray-600">This booking has no manage link, so it can&apos;t be moved.</p>
        <BackButton onBack={onBack} />
      </div>
    )
  }

  if (picked) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-gray-600">
          Move <span className="font-medium text-ink">{booking.customerName || 'this guest'}</span>{' '}
          to{' '}
          <span className="font-medium text-ink">
            {formatTimeOfDay(picked.startsAt, location.timezone)}
          </span>
          ?
        </p>
        <ErrorLine message={error} />
        <Button
          size="lg"
          loading={reschedule.isPending}
          onClick={() => {
            setError(null)
            reschedule.mutate({ token: manageToken, newSessionId: picked.sessionId })
          }}
        >
          Confirm move
        </Button>
        <button
          type="button"
          onClick={() => setPicked(null)}
          className="min-h-11 text-sm font-medium text-gray-500 underline underline-offset-2"
        >
          Pick a different time
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <ErrorLine message={error} />
      <SlotPicker
        locationSlug={location.slug}
        timezone={location.timezone}
        guests={booking.seats}
        onSelect={setPicked}
        note="Free move — same-priced sessions only (the server enforces the price rule)."
      />
      <BackButton onBack={onBack} />
    </div>
  )
}
