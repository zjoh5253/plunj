/**
 * tRPC context. ALL external effects are injected — db, payment provider, SMS
 * sender, clock — so routers never import concrete providers and tests run
 * against fakes.
 */

import type { Customer, PrismaClient, StaffRole, StaffUser } from '@plunj/db'
import type { SmsSender } from '@plunj/notifications'
import type { PaymentProvider } from '@plunj/payments'
import { createAuth } from './auth.js'
import type { PlunjAuth } from './auth.js'

export interface StaffSession {
  user: StaffUser
  roles: StaffRole[]
}

export interface CreateContextOptions {
  db: PrismaClient
  payments: PaymentProvider
  /** OTP delivery for Better Auth's phone plugin. */
  sms: SmsSender
  /** Better Auth instance; a default (memory-adapter) instance is created when omitted. */
  auth?: PlunjAuth
  /** Injectable clock — every "now" in the API goes through this. */
  now?: () => Date
  /** Better Auth user id from the verified session, when signed in. */
  authUserId?: string | null
  /**
   * Verified phone from the session user. Used to lazily link a StaffUser row
   * (matched by phone) to its auth user on first sign-in — staff sign in
   * through Better Auth's own endpoints, which never touch our routers.
   */
  authUserPhone?: string | null
  ip?: string | null
}

export interface Context {
  db: PrismaClient
  payments: PaymentProvider
  sms: SmsSender
  auth: PlunjAuth
  now: () => Date
  /** Customer row claimed by the signed-in auth user, if any. */
  customer: Customer | null
  /** Staff identity (active StaffUser by authUserId) with its role rows, if any. */
  staff: StaffSession | null
  ip: string | null
}

export async function createContext(options: CreateContextOptions): Promise<Context> {
  const now = options.now ?? ((): Date => new Date())
  const auth = options.auth ?? createAuth({ db: options.db, sms: options.sms })

  let customer: Customer | null = null
  let staff: StaffSession | null = null
  if (options.authUserId) {
    customer = await options.db.customer.findUnique({
      where: { authUserId: options.authUserId },
    })
    let staffUser = await options.db.staffUser.findFirst({
      where: { authUserId: options.authUserId, active: true },
      include: { roles: true },
    })
    if (!staffUser && options.authUserPhone) {
      // First staff sign-in: claim the unlinked StaffUser row for this
      // OTP-verified phone (mirrors the customer guest-claim flow).
      const claimed = await options.db.staffUser.updateMany({
        where: { phone: options.authUserPhone, active: true, authUserId: null },
        data: { authUserId: options.authUserId },
      })
      if (claimed.count > 0) {
        staffUser = await options.db.staffUser.findFirst({
          where: { authUserId: options.authUserId, active: true },
          include: { roles: true },
        })
      }
    }
    if (staffUser) {
      staff = { user: staffUser, roles: staffUser.roles }
    }
  }

  return {
    db: options.db,
    payments: options.payments,
    sms: options.sms,
    auth,
    now,
    customer,
    staff,
    ip: options.ip ?? null,
  }
}
