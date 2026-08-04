'use client'

/**
 * Today roster — the desk home screen. Vertical timeline of today's sessions,
 * expandable guest lists, one-tap check-in, waiver QR backstop, exceptions
 * sheet, walk-in sheet. Auto-refreshes every 15s and on window focus.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { RosterBooking, RosterSession } from '@/components/desk/desk-types'
import { ExceptionsSheet } from '@/components/desk/exceptions-sheet'
import { useStaffGuard } from '@/components/desk/guard'
import { WaiverSheet } from '@/components/desk/waiver-sheet'
import { WalkinSheet } from '@/components/desk/walkin-sheet'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import type { LocationDetail } from '@/lib/api-types'
import { domainError } from '@/lib/api-types'
import { formatDateKeyLong, formatPhoneUS, formatTimeOfDay } from '@/lib/format'
import { useTRPC } from '@/lib/trpc/client'

export function RosterClient({ location }: { location: LocationDetail }) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()

  const roster = useQuery(
    trpc.desk.roster.today.queryOptions(
      { locationSlug: location.slug },
      { refetchInterval: 15_000, refetchOnWindowFocus: true, staleTime: 5_000 },
    ),
  )
  useStaffGuard(roster.error)

  const invalidateRoster = () => {
    void queryClient.invalidateQueries(trpc.desk.roster.today.pathFilter())
  }

  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [waiverTarget, setWaiverTarget] = useState<RosterBooking | null>(null)
  const [exceptionsTarget, setExceptionsTarget] = useState<{
    booking: RosterBooking
    session: RosterSession
  } | null>(null)
  const [walkinOpen, setWalkinOpen] = useState(false)
  const [banner, setBanner] = useState<string | null>(null)

  const checkIn = useMutation(
    trpc.desk.checkIn.mutationOptions({
      onSuccess: () => {
        setBanner(null)
        invalidateRoster()
      },
      onError: (err, variables) => {
        const info = domainError(err)
        if (info.domainCode === 'WAIVER_UNSIGNED') {
          const booking = roster.data?.sessions
            .flatMap((s) => s.bookings)
            .find((b) => b.bookingId === variables.bookingId)
          if (booking) setWaiverTarget(booking)
          return
        }
        setBanner(info.messageText)
      },
    }),
  )

  if (roster.isPending) {
    return (
      <div className="flex flex-col gap-3" aria-busy>
        <Skeleton className="h-8 w-56" />
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
    )
  }

  if (roster.isError) {
    return (
      <p className="rounded-card bg-danger/5 px-4 py-3 text-sm text-danger" role="alert">
        {domainError(roster.error).messageText}
      </p>
    )
  }

  const data = roster.data
  const sessions = data?.sessions ?? []
  const now = Date.now()
  // Auto-highlight the running-or-next session so the desk lands on it.
  const activeId =
    sessions.find((s) => new Date(s.endsAt).getTime() > now)?.sessionId ??
    sessions[sessions.length - 1]?.sessionId

  const isExpanded = (sessionId: string): boolean => expanded[sessionId] ?? sessionId === activeId

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold tracking-tight">
          {data ? formatDateKeyLong(data.date) : 'Today'}
        </h1>
        <span className="text-sm text-gray-400">
          {sessions.length} {sessions.length === 1 ? 'session' : 'sessions'}
        </span>
      </div>

      {banner ? (
        <p className="rounded-card bg-danger/5 px-4 py-3 text-sm text-danger" role="alert">
          {banner}
        </p>
      ) : null}

      {sessions.length === 0 ? (
        <p className="py-16 text-center text-gray-500">No sessions today.</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {sessions.map((session) => (
            <SessionCard
              key={session.sessionId}
              session={session}
              timezone={location.timezone}
              past={new Date(session.endsAt).getTime() <= now}
              expanded={isExpanded(session.sessionId)}
              onToggle={() =>
                setExpanded((prev) => ({
                  ...prev,
                  [session.sessionId]: !isExpanded(session.sessionId),
                }))
              }
              onCheckIn={(bookingId) => checkIn.mutate({ bookingId })}
              checkInPendingId={checkIn.isPending ? (checkIn.variables?.bookingId ?? null) : null}
              onExceptions={(booking) => setExceptionsTarget({ booking, session })}
              onCapacityChanged={invalidateRoster}
            />
          ))}
        </ol>
      )}

      {/* Floating walk-in button */}
      <button
        type="button"
        onClick={() => setWalkinOpen(true)}
        className="fixed bottom-6 right-6 z-30 flex min-h-14 items-center gap-2 rounded-full bg-ink px-6 text-base font-semibold text-paper shadow-lg transition-colors hover:bg-gray-800"
      >
        <span className="text-xl leading-none" aria-hidden>
          +
        </span>
        Walk-in
      </button>

      <WaiverSheet
        booking={waiverTarget}
        locationSlug={location.slug}
        onClose={() => setWaiverTarget(null)}
        onCheckedIn={() => {
          setWaiverTarget(null)
          invalidateRoster()
        }}
      />

      {exceptionsTarget ? (
        <ExceptionsSheet
          booking={exceptionsTarget.booking}
          session={exceptionsTarget.session}
          location={location}
          onClose={() => setExceptionsTarget(null)}
          onDone={() => {
            setExceptionsTarget(null)
            invalidateRoster()
          }}
        />
      ) : null}

      <WalkinSheet
        open={walkinOpen}
        location={location}
        sessions={sessions}
        onClose={() => setWalkinOpen(false)}
        onCreated={invalidateRoster}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------

function SessionCard({
  session,
  timezone,
  past,
  expanded,
  onToggle,
  onCheckIn,
  checkInPendingId,
  onExceptions,
  onCapacityChanged,
}: {
  session: RosterSession
  timezone: string
  past: boolean
  expanded: boolean
  onToggle: () => void
  onCheckIn: (bookingId: string) => void
  checkInPendingId: string | null
  onExceptions: (booking: RosterBooking) => void
  onCapacityChanged: () => void
}) {
  const guestCount = session.bookings.length

  return (
    <li
      className={`rounded-card border bg-white shadow-[0_1px_2px_rgba(0,0,0,0.03)] ${
        past ? 'border-gray-100 opacity-60' : 'border-gray-200'
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex min-h-16 w-full items-center justify-between gap-3 px-5 py-3 text-left"
      >
        <span className="flex min-w-0 flex-col">
          <span className="text-lg font-semibold tabular-nums tracking-tight">
            {formatTimeOfDay(session.startsAt, timezone)}
            <span className="text-sm font-normal text-gray-400">
              {' '}
              – {formatTimeOfDay(session.endsAt, timezone)}
            </span>
          </span>
          <span className="flex items-center gap-2 text-sm text-gray-500">
            {session.studioName}
            {session.status === 'EXCLUSIVE' ? <Badge>Private buyout</Badge> : null}
            {session.status === 'CANCELLED' ? <Badge tone="danger">Cancelled</Badge> : null}
            {session.status === 'CLOSED' ? <Badge>Closed</Badge> : null}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-3">
          <span
            className={`text-lg font-semibold tabular-nums ${
              session.bookedSeats >= session.capacity ? 'text-warn' : 'text-ink'
            }`}
          >
            {session.bookedSeats}/{session.capacity}
          </span>
          <span
            className={`text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
            aria-hidden
          >
            ▾
          </span>
        </span>
      </button>

      {expanded ? (
        <div className="border-t border-gray-100 px-5 py-3">
          {guestCount === 0 ? (
            <p className="py-3 text-sm text-gray-400">No guests booked.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-gray-50">
              {session.bookings.map((booking) => (
                <GuestRow
                  key={booking.bookingId}
                  booking={booking}
                  pending={checkInPendingId === booking.bookingId}
                  onCheckIn={() => onCheckIn(booking.bookingId)}
                  onExceptions={() => onExceptions(booking)}
                />
              ))}
            </ul>
          )}
          <CapacityControl session={session} onChanged={onCapacityChanged} />
        </div>
      ) : null}
    </li>
  )
}

function GuestRow({
  booking,
  pending,
  onCheckIn,
  onExceptions,
}: {
  booking: RosterBooking
  pending: boolean
  onCheckIn: () => void
  onExceptions: () => void
}) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-2">
          <span className="truncate font-medium">{booking.customerName || 'Guest'}</span>
          {booking.seats > 1 ? (
            <span className="text-sm text-gray-500 tabular-nums">×{booking.seats}</span>
          ) : null}
          {booking.type !== 'DROP_IN' ? <TypeBadge type={booking.type} /> : null}
        </span>
        <span className="flex flex-wrap items-center gap-2">
          <a
            href={`tel:${booking.customerPhone}`}
            className="text-sm text-gray-500 underline-offset-2 tabular-nums hover:underline"
          >
            {formatPhoneUS(booking.customerPhone)}
          </a>
          <WaiverBadge status={booking.waiverStatus} />
          <PaymentBadge status={booking.paymentStatus} />
        </span>
      </div>
      <div className="flex items-center gap-2">
        {booking.status === 'CONFIRMED' ? (
          <button
            type="button"
            onClick={onCheckIn}
            disabled={pending}
            className="flex min-h-11 items-center rounded-card bg-ink px-4 text-sm font-semibold text-paper transition-colors hover:bg-gray-800 disabled:opacity-40"
          >
            {pending ? 'Checking in…' : 'Check in'}
          </button>
        ) : booking.status === 'CHECKED_IN' ? (
          <Badge tone="ok" className="min-h-7 px-3 text-sm">
            ✓ In
          </Badge>
        ) : booking.status === 'NO_SHOW' ? (
          <Badge tone="danger" className="min-h-7 px-3 text-sm">
            No-show
          </Badge>
        ) : (
          <Badge className="min-h-7 px-3 text-sm">Hold</Badge>
        )}
        <button
          type="button"
          onClick={onExceptions}
          aria-label={`More actions for ${booking.customerName || 'guest'}`}
          className="flex min-h-11 min-w-11 items-center justify-center rounded-card border border-gray-200 text-lg text-gray-500 transition-colors hover:border-gray-400"
        >
          ⋯
        </button>
      </div>
    </li>
  )
}

function WaiverBadge({ status }: { status: RosterBooking['waiverStatus'] }) {
  if (status === 'SIGNED') return <Badge tone="ok">✓ Waiver</Badge>
  if (status === 'MINOR_UNVERIFIED') return <Badge tone="warn">Minor — unverified</Badge>
  return <Badge tone="danger">Waiver unsigned</Badge>
}

function PaymentBadge({ status }: { status: string }) {
  if (status === 'PAID') return <Badge tone="neutral">Paid</Badge>
  if (status === 'PENDING' || status === 'UNPAID') return <Badge tone="warn">Unpaid</Badge>
  if (status === 'REFUNDED') return <Badge>Refunded</Badge>
  if (status === 'PARTIALLY_REFUNDED') return <Badge>Part-refunded</Badge>
  return <Badge>{status}</Badge>
}

function TypeBadge({ type }: { type: string }) {
  const label =
    type === 'BUYOUT'
      ? 'Buyout'
      : type === 'COMP'
        ? 'Comp'
        : type === 'MEMBER_VISIT'
          ? 'Member'
          : type === 'PACK_VISIT'
            ? 'Pack'
            : type
  return <Badge>{label}</Badge>
}

/** +1 / −1 capacity for this session only; the server clamp is surfaced. */
function CapacityControl({
  session,
  onChanged,
}: {
  session: RosterSession
  onChanged: () => void
}) {
  const trpc = useTRPC()
  const [note, setNote] = useState<string | null>(null)

  const override = useMutation(
    trpc.desk.capacityOverride.mutationOptions({
      onSuccess: (result, variables) => {
        const requested = session.capacity + variables.delta
        setNote(
          result.capacity === requested
            ? `Capacity set to ${result.capacity}`
            : `Server limited capacity to ${result.capacity}`,
        )
        onChanged()
      },
      onError: (err) => setNote(domainError(err).messageText),
    }),
  )

  return (
    <div className="mt-2 flex flex-wrap items-center gap-3 border-t border-gray-50 pt-3">
      <span className="text-sm text-gray-500">Capacity this session</span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label="Reduce capacity by one"
          disabled={override.isPending}
          onClick={() => override.mutate({ sessionId: session.sessionId, delta: -1 })}
          className="flex min-h-11 min-w-11 items-center justify-center rounded-card border border-gray-200 text-lg font-semibold hover:border-gray-400 disabled:opacity-40"
        >
          −
        </button>
        <span className="min-w-8 text-center font-semibold tabular-nums">{session.capacity}</span>
        <button
          type="button"
          aria-label="Add one seat this session only"
          disabled={override.isPending}
          onClick={() => override.mutate({ sessionId: session.sessionId, delta: 1 })}
          className="flex min-h-11 min-w-11 items-center justify-center rounded-card border border-gray-200 text-lg font-semibold hover:border-gray-400 disabled:opacity-40"
        >
          +
        </button>
      </div>
      {note ? <span className="text-sm text-gray-500">{note}</span> : null}
    </div>
  )
}
