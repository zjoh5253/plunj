/**
 * Desk-only booking lookup. Exists because the desk roster payload does not
 * expose orderId / customerId / manageToken, which the refund, credit, and
 * move-guest flows need. READ-ONLY — every mutation still goes through the
 * audited tRPC desk router (refund/credit require a staff PIN there).
 *
 * Auth mirrors staffProcedure: Better Auth session cookie → active StaffUser
 * by authUserId → a role at the booking's location (or org-wide corporate).
 */

import { RefundStatus, StaffRoleKind } from '@plunj/db'
import { getAuth, prisma } from '@/lib/trpc/server'

export const dynamic = 'force-dynamic'

export async function GET(req: Request, { params }: { params: Promise<{ bookingId: string }> }) {
  const { bookingId } = await params

  const session = await getAuth().api.getSession({ headers: req.headers })
  if (!session) {
    return Response.json({ message: 'Staff sign-in required' }, { status: 401 })
  }
  const staff = await prisma.staffUser.findFirst({
    where: { authUserId: session.user.id, active: true },
    include: { roles: true },
  })
  if (!staff) {
    return Response.json({ message: 'Staff sign-in required' }, { status: 401 })
  }

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { order: { include: { refunds: true } } },
  })
  if (!booking) {
    return Response.json({ message: 'Booking not found' }, { status: 404 })
  }

  const isCorporate = staff.roles.some(
    (r) => r.role === StaffRoleKind.CORPORATE_ADMIN && r.locationId === null,
  )
  const atLocation = staff.roles.some((r) => r.locationId === booking.locationId)
  if (!isCorporate && !atLocation) {
    return Response.json({ message: 'No desk access at this location' }, { status: 403 })
  }

  const order = booking.order
  const refundedCents = order
    ? order.refunds
        .filter((r) => r.status !== RefundStatus.FAILED)
        .reduce((sum, r) => sum + r.amountCents, 0)
    : 0

  return Response.json({
    bookingId: booking.id,
    customerId: booking.customerId,
    manageToken: booking.manageToken,
    order: order
      ? {
          orderId: order.id,
          status: order.status,
          totalCents: order.totalCents,
          refundedCents,
          refundableCents: Math.max(0, order.totalCents - refundedCents),
        }
      : null,
  })
}
