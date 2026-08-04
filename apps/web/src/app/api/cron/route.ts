/**
 * Cron entry point (`Authorization: Bearer $CRON_SECRET`):
 * 1. expire stale holds (releases their seats),
 * 2. drain the notification outbox (invariant #8),
 * 3. roll the session horizon forward for every ACTIVE internal location.
 *
 * GET is accepted because Vercel Cron invokes with GET (sending
 * `Authorization: Bearer $CRON_SECRET` automatically); POST kept for
 * manual/external schedulers.
 */

import { expireHolds, generateSessions } from '@plunj/availability'
import { BookingProvider, LocationStatus } from '@plunj/db'
import { drainOutbox } from '@plunj/notifications'
import type { OutboxDb } from '@plunj/notifications'
import { getEmail, getSms, prisma } from '@/lib/trpc/server'

export async function GET(req: Request): Promise<Response> {
  return handleCron(req)
}

export async function POST(req: Request): Promise<Response> {
  return handleCron(req)
}

async function handleCron(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return Response.json({ error: 'CRON_SECRET is not configured' }, { status: 503 })
  }
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = new Date()
  const expired = await expireHolds(prisma, { now })

  // Prisma's generic delegate types are wider than the narrow OutboxDb surface
  // @plunj/notifications declares; runtime-compatible (same bridge as the API).
  const outbox = await drainOutbox(prisma as unknown as OutboxDb, {
    smsSender: getSms(),
    emailSender: getEmail(),
    now,
  })

  const locations = await prisma.location.findMany({
    where: { status: LocationStatus.ACTIVE, bookingProvider: BookingProvider.INTERNAL },
    select: { id: true, slug: true },
  })
  const generated: Record<string, { scanned: number; created: number }> = {}
  for (const location of locations) {
    generated[location.slug] = await generateSessions(prisma, { locationId: location.id, now })
  }

  return Response.json({ expiredHolds: expired, outbox, generated })
}
