/**
 * Better Auth instance factory — phone-OTP only (CLAUDE.md: no passwords
 * anywhere). Customers and staff both sign in with phone OTP; a StaffUser row
 * with a matching authUserId is what gates staff procedures.
 *
 * Storage: better-auth's prisma adapter against the AuthUser/AuthSession/
 * AuthAccount/AuthVerification models in packages/db (the "Auth" prefix avoids
 * colliding with the bookable Session model; modelName overrides below map
 * better-auth's internal names onto them).
 */

import type { PrismaClient } from '@plunj/db'
import { renderSms } from '@plunj/notifications'
import type { SmsSender } from '@plunj/notifications'
import { betterAuth } from 'better-auth'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import { phoneNumber } from 'better-auth/plugins/phone-number'

export const requiredAuthModels = [
  'authUser',
  'authSession',
  'authAccount',
  'authVerification',
] as const

export interface CreateAuthOptions {
  db: PrismaClient
  /** OTP delivery — injected so tests capture codes instead of hitting Twilio. */
  sms: SmsSender
  baseURL?: string
  secret?: string
}

export function createAuth(options: CreateAuthOptions) {
  return betterAuth({
    baseURL: options.baseURL ?? 'http://localhost:3000',
    secret: options.secret ?? 'plunj-dev-only-secret',
    database: prismaAdapter(options.db, { provider: 'postgresql' }),
    user: { modelName: 'authUser' },
    session: { modelName: 'authSession' },
    account: { modelName: 'authAccount' },
    verification: { modelName: 'authVerification' },
    plugins: [
      phoneNumber({
        sendOTP: async ({ phoneNumber: to, code }) => {
          await options.sms.sendSms(to, renderSms('otp-code', { code }))
        },
        signUpOnVerification: {
          getTempEmail: (phone) => `${phone.replace(/[^0-9]/g, '')}@phone.plunj.co`,
          getTempName: (phone) => phone,
        },
      }),
    ],
  })
}

export type PlunjAuth = ReturnType<typeof createAuth>
