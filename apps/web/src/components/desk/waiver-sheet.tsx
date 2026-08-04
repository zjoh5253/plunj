'use client'

/**
 * Full-screen waiver backstop, opened when check-in hits WAIVER_UNSIGNED.
 * Three paths: QR to the walk-in waiver on the guest's own phone, hand the
 * tablet over, or manager PIN override (audited server-side).
 */

import Link from 'next/link'
import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import type { RosterBooking } from '@/components/desk/desk-types'
import { QrSvg } from '@/components/desk/qr'
import { DeskSheet } from '@/components/desk/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { domainError } from '@/lib/api-types'
import { useTRPC } from '@/lib/trpc/client'

export function WaiverSheet({
  booking,
  locationSlug,
  onClose,
  onCheckedIn,
}: {
  booking: RosterBooking | null
  locationSlug: string
  onClose: () => void
  onCheckedIn: () => void
}) {
  const trpc = useTRPC()
  const [showOverride, setShowOverride] = useState(false)
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)

  const override = useMutation(
    trpc.desk.checkIn.mutationOptions({
      onSuccess: () => {
        setPin('')
        setShowOverride(false)
        setError(null)
        onCheckedIn()
      },
      onError: (err) => setError(domainError(err).messageText),
    }),
  )

  const open = booking !== null
  // Walk-in waiver signs by phone number, so a booked guest signing there
  // attaches to their customer row and flips the roster badge.
  const walkinUrl =
    open && typeof window !== 'undefined'
      ? `${window.location.origin}/book/${locationSlug}/walkin`
      : ''

  const close = () => {
    setShowOverride(false)
    setPin('')
    setError(null)
    onClose()
  }

  return (
    <DeskSheet open={open} onClose={close} title="Waiver needed" full>
      {booking ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-6 py-6 text-center">
          <div className="flex flex-col gap-1">
            <p className="text-2xl font-semibold tracking-tight">
              {booking.customerName || 'This guest'}
            </p>
            <p className="text-gray-500">
              hasn&apos;t signed the current waiver. Scan to sign on their phone:
            </p>
          </div>

          {walkinUrl ? (
            <QrSvg
              value={walkinUrl}
              label={`Waiver signing link for ${booking.customerName || 'guest'}`}
              className="w-full max-w-[420px] rounded-card border border-gray-100"
            />
          ) : null}

          <Link
            href={`/${locationSlug}/walkin`}
            target="_blank"
            className="flex min-h-13 w-full max-w-sm items-center justify-center rounded-card border border-gray-200 bg-white px-6 text-base font-medium transition-colors hover:border-ink"
          >
            Sign on this tablet instead
          </Link>

          {showOverride ? (
            <form
              className="flex w-full max-w-sm flex-col gap-3 text-left"
              onSubmit={(e) => {
                e.preventDefault()
                if (pin.trim().length === 0 || override.isPending) return
                override.mutate({
                  bookingId: booking.bookingId,
                  override: true,
                  staffPin: pin.trim(),
                })
              }}
            >
              <Input
                label="Staff PIN"
                type="password"
                inputMode="numeric"
                autoComplete="off"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                hint="Overrides are logged to the exceptions audit trail."
                autoFocus
                {...(error ? { error } : {})}
              />
              <Button
                type="submit"
                size="lg"
                loading={override.isPending}
                disabled={pin.trim().length === 0}
              >
                Check in without waiver
              </Button>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setShowOverride(true)}
              className="min-h-11 text-sm font-medium text-gray-500 underline underline-offset-2"
            >
              Manager override (PIN)
            </button>
          )}
        </div>
      ) : null}
    </DeskSheet>
  )
}
