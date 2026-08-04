'use client'

/**
 * Self-serve booking management via the unguessable manage token: reschedule
 * (same-price only — the server enforces it, we surface its message verbatim)
 * and cancel (1-hour policy → account credit).
 */

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { SlotPicker } from '@/components/booking/slot-picker'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog } from '@/components/ui/dialog'
import type { ManageBooking } from '@/lib/api-types'
import { domainError } from '@/lib/api-types'
import { formatCents } from '@/lib/format'
import { useTRPC } from '@/lib/trpc/client'

const CANCEL_POLICY =
  "Cancel more than 1 hour before your session for automatic account credit. Later cancellations aren't credited."

export function ManageClient({
  token,
  initialBooking,
}: {
  token: string
  initialBooking: ManageBooking
}) {
  const trpc = useTRPC()
  const router = useRouter()
  const [rescheduling, setRescheduling] = useState(false)
  const [confirmingCancel, setConfirmingCancel] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [cancelledCredit, setCancelledCredit] = useState<number | null>(null)

  const bookingQuery = useQuery(
    trpc.public.manage.get.queryOptions({ token }, { initialData: initialBooking }),
  )
  const booking = bookingQuery.data ?? initialBooking

  const rescheduleMutation = useMutation(
    trpc.public.manage.reschedule.mutationOptions({
      onSuccess: (result) => {
        // Reschedule issues a NEW booking + manage token — follow it.
        router.replace(`/manage/${result.manageToken}`)
      },
      onError: (err) => setActionError(domainError(err).messageText),
    }),
  )

  const cancelMutation = useMutation(
    trpc.public.manage.cancel.mutationOptions({
      onSuccess: (result) => {
        setConfirmingCancel(false)
        setCancelledCredit(result.creditCents)
      },
      onError: (err) => {
        setConfirmingCancel(false)
        setActionError(domainError(err).messageText)
      },
    }),
  )

  const cancelled = booking.status === 'CANCELLED' || cancelledCredit !== null

  if (cancelled) {
    return (
      <div className="flex flex-col items-center gap-4 pt-16 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Booking cancelled</h1>
        {cancelledCredit !== null && cancelledCredit > 0 ? (
          <p className="max-w-xs text-gray-600">
            {formatCents(cancelledCredit)} in account credit is waiting for your next visit.
          </p>
        ) : (
          <p className="max-w-xs text-gray-500">We hope to see you another time.</p>
        )}
        <Link
          href={`/${booking.location.slug}`}
          className="flex min-h-11 items-center justify-center rounded-card bg-ink px-6 text-sm font-medium text-paper"
        >
          Book a new session
        </Link>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5 pt-2">
      <h1 className="text-2xl font-semibold tracking-tight">
        Hi {booking.customerFirstName} — your booking
      </h1>

      <Card className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium uppercase tracking-wide text-gray-500">
            {booking.location.name}
          </h2>
          <Badge tone={booking.status === 'CONFIRMED' ? 'ok' : 'neutral'}>{booking.status}</Badge>
        </div>
        <p className="text-lg font-semibold tracking-tight">{booking.whenLocal}</p>
        <p className="text-sm text-gray-500">
          {booking.seats} {booking.seats === 1 ? 'guest' : 'guests'}
          {booking.order ? ` · ${formatCents(booking.order.totalCents)} total` : ''}
        </p>
        <Link href={`/waiver/${token}`} className="text-sm font-medium underline">
          Sign or share the waiver
        </Link>
      </Card>

      {actionError ? (
        <p className="rounded-card bg-warn/5 px-4 py-3 text-sm text-warn" role="alert">
          {actionError}
        </p>
      ) : null}

      {!rescheduling ? (
        <div className="flex flex-col gap-3">
          <Button size="lg" variant="secondary" onClick={() => setRescheduling(true)}>
            Reschedule — always free
          </Button>
          <Button size="lg" variant="danger" onClick={() => setConfirmingCancel(true)}>
            Cancel booking
          </Button>
          <p className="text-center text-xs text-gray-400">{CANCEL_POLICY}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold tracking-tight">Pick a new time</h2>
            <button
              type="button"
              className="min-h-11 text-sm font-medium underline"
              onClick={() => setRescheduling(false)}
            >
              Never mind
            </button>
          </div>
          <SlotPicker
            locationSlug={booking.location.slug}
            timezone={booking.location.timezone}
            guests={booking.seats}
            note="Same-priced sessions only — for anything else, contact the studio."
            onSelect={(slot) => {
              setActionError(null)
              rescheduleMutation.mutate({ token, newSessionId: slot.sessionId })
            }}
          />
          {rescheduleMutation.isPending ? (
            <p className="text-center text-sm text-gray-500">Moving your booking…</p>
          ) : null}
        </div>
      )}

      <Dialog
        open={confirmingCancel}
        onClose={() => setConfirmingCancel(false)}
        title="Cancel this booking?"
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-gray-600">{CANCEL_POLICY}</p>
          <div className="flex flex-col gap-2">
            <Button
              size="lg"
              variant="danger"
              loading={cancelMutation.isPending}
              onClick={() => cancelMutation.mutate({ token })}
            >
              Yes, cancel it
            </Button>
            <Button size="lg" variant="ghost" onClick={() => setConfirmingCancel(false)}>
              Keep my booking
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  )
}
