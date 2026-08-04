import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ShareSheet } from '@/components/booking/share-sheet'
import { RememberHomeLocation } from '@/components/home/remember-home-location'
import { Card } from '@/components/ui/card'
import { formatSessionMoment } from '@/lib/format'
import { prisma } from '@/lib/trpc/server'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: "You're booked" }

interface Props {
  params: Promise<{ location: string; bookingId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

/** ISO instant → ICS UTC stamp "20260811T230000Z" (string reshaping only). */
function icsStamp(iso: string): string {
  return `${iso.replace(/[-:]/g, '').slice(0, 15)}Z`
}

function buildIcsDataUrl(args: {
  uid: string
  startsAt: string
  endsAt: string
  summary: string
  locationText: string
}): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//PLUNJ//Booking//EN',
    'BEGIN:VEVENT',
    `UID:${args.uid}@plunj.co`,
    `DTSTAMP:${icsStamp(new Date().toISOString())}`,
    `DTSTART:${icsStamp(args.startsAt)}`,
    `DTEND:${icsStamp(args.endsAt)}`,
    `SUMMARY:${args.summary}`,
    `LOCATION:${args.locationText}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ]
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(lines.join('\r\n'))}`
}

export default async function ConfirmedPage({ params, searchParams }: Props) {
  const { bookingId } = await params
  const query = await searchParams
  const tokenParam = Array.isArray(query.t) ? query.t[0] : query.t

  // The manage token normally arrives via ?t= (SMS links). checkout.start does
  // NOT return it, so after payment we land here with only the bookingId — a
  // server-side lookup recovers the token (flagged as an API-shape gap).
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { location: true, customer: true },
  })
  if (!booking) notFound()
  if (tokenParam !== undefined && tokenParam !== booking.manageToken) notFound()
  const token = booking.manageToken

  // Waiver status for the dominant CTA (manage.get doesn't expose it — same gap).
  const doc = await prisma.waiverDocument.findFirst({
    where: {
      locationId: booking.locationId,
      kind: 'LIABILITY',
      active: true,
      publishedAt: { not: null },
    },
    orderBy: { version: 'desc' },
  })
  const signed = doc
    ? (await prisma.waiverSignature.findFirst({
        where: { waiverDocumentId: doc.id, customerId: booking.customerId },
      })) !== null
    : true

  const whenLocal = formatSessionMoment(booking.startsAt.toISOString(), booking.location.timezone)
  const icsHref = buildIcsDataUrl({
    uid: booking.id,
    startsAt: booking.startsAt.toISOString(),
    endsAt: booking.endsAt.toISOString(),
    summary: `PLUNJ — ${booking.location.name}`,
    locationText: `${booking.location.address1}, ${booking.location.city}, ${booking.location.state}`,
  })

  return (
    <div className="flex flex-col gap-6 pt-4">
      {/* First booking sets the home studio, only if none is set yet. */}
      <RememberHomeLocation slug={booking.location.slug} />
      <div className="flex flex-col gap-2">
        <p className="text-4xl" aria-hidden>
          ✓
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">You&apos;re booked.</h1>
        {!signed ? (
          <p className="text-gray-500">One thing left before you arrive:</p>
        ) : (
          <p className="text-gray-500">See you soon, {booking.customer.firstName}.</p>
        )}
      </div>

      {!signed ? (
        <Link
          href={`/waiver/${token}`}
          className="flex min-h-13 w-full items-center justify-center rounded-card bg-ink px-6 text-base font-medium text-paper transition-colors hover:bg-gray-800"
        >
          Sign your waiver (2 min)
        </Link>
      ) : null}

      <Card className="flex flex-col gap-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-gray-500">Your session</h2>
        <div className="flex flex-col gap-1">
          <p className="text-lg font-semibold tracking-tight">{whenLocal}</p>
          <p className="text-gray-500">
            {booking.location.name} — {booking.location.address1}, {booking.location.city},{' '}
            {booking.location.state}
          </p>
          <p className="text-gray-500">
            {booking.seats} {booking.seats === 1 ? 'guest' : 'guests'}
          </p>
        </div>
        <a href={icsHref} download="plunj.ics" className="text-sm font-medium underline">
          Add to calendar
        </a>
      </Card>

      <ShareSheet
        heading={booking.seats > 1 ? 'Invite your crew' : 'Bringing someone?'}
        subtitle={
          booking.seats > 1
            ? `${booking.seats} spots are booked — send everyone the invite so they can sign their waiver before you arrive.`
            : 'Share the session — guests sign their waiver from the same link.'
        }
        title={`PLUNJ — ${booking.location.name}`}
        text={`You're invited to PLUNJ ${booking.location.city} — ${whenLocal}. Sign the quick waiver before you arrive:`}
        path={`/waiver/${token}`}
      />

      <Card className="flex flex-col gap-2">
        <h2 className="text-sm font-medium uppercase tracking-wide text-gray-500">What to bring</h2>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-gray-600">
          <li>Swimsuit and a towel (we have extras if you forget)</li>
          <li>Water bottle — you&apos;ll want it</li>
          <li>Arrive 10 minutes early for your first visit</li>
        </ul>
      </Card>

      <p className="text-center text-sm text-gray-500">
        Need to change plans?{' '}
        <Link href={`/manage/${token}`} className="font-medium text-ink underline">
          Manage your booking
        </Link>
      </p>
    </div>
  )
}
