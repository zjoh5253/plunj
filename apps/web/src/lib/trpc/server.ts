/**
 * Server-side wiring: providers + tRPC caller for RSC data fetching, shared by
 * the API route handlers (trpc, auth, webhooks, cron).
 *
 * ALL env access is lazy — importing this module never touches process.env or
 * the database, so `next build` succeeds with no env vars set. When Stripe /
 * Twilio / Resend keys are absent, dev falls back to the in-memory fakes.
 */

import { createAuth, createCaller, createContext } from '@plunj/api'
import type { PlunjAuth } from '@plunj/api'
import { prisma } from '@plunj/db'
import {
  FakeEmailSender,
  FakeSmsSender,
  ResendEmailSender,
  TwilioSmsSender,
} from '@plunj/notifications'
import type { EmailSender, SmsSender } from '@plunj/notifications'
import { FakePaymentProvider, StripeProvider } from '@plunj/payments'
import type { PaymentProvider } from '@plunj/payments'

interface Singletons {
  payments?: PaymentProvider
  sms?: SmsSender
  email?: EmailSender
  auth?: PlunjAuth
}

// Cached on globalThis so Next.js dev hot reloads reuse one instance of each.
const globals = globalThis as unknown as { __plunjWeb?: Singletons }
const cache = (globals.__plunjWeb ??= {})

export function getPayments(): PaymentProvider {
  return (cache.payments ??=
    process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET
      ? new StripeProvider({
          secretKey: process.env.STRIPE_SECRET_KEY,
          webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
        })
      : new FakePaymentProvider())
}

export function getSms(): SmsSender {
  return (cache.sms ??=
    process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN
      ? new TwilioSmsSender()
      : new FakeSmsSender())
}

export function getEmail(): EmailSender {
  return (cache.email ??= process.env.RESEND_API_KEY
    ? new ResendEmailSender()
    : new FakeEmailSender())
}

export function getAuth(): PlunjAuth {
  return (cache.auth ??= createAuth({
    db: prisma,
    sms: getSms(),
    ...(process.env.BETTER_AUTH_URL ? { baseURL: process.env.BETTER_AUTH_URL } : {}),
    ...(process.env.BETTER_AUTH_SECRET ? { secret: process.env.BETTER_AUTH_SECRET } : {}),
  }))
}

/** Server-side tRPC caller for RSC data fetching (public procedures only). */
export async function getCaller() {
  const ctx = await createContext({
    db: prisma,
    payments: getPayments(),
    sms: getSms(),
    auth: getAuth(),
  })
  return createCaller(ctx)
}

export { prisma }
