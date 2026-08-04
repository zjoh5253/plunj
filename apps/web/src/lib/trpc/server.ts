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
  EmailBridgeSmsSender,
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
  if (!cache.sms) {
    if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
      cache.sms = new TwilioSmsSender()
    } else if (process.env.RESEND_API_KEY && process.env.SMS_FALLBACK_EMAIL) {
      // Pilot bridge while the SMS number pends carrier registration: every
      // outbound SMS (OTPs, confirmations) is emailed to one inbox instead.
      cache.sms = new EmailBridgeSmsSender(getEmail(), process.env.SMS_FALLBACK_EMAIL)
    } else {
      cache.sms = new FakeSmsSender()
    }
  }
  return cache.sms
}

export function getEmail(): EmailSender {
  return (cache.email ??= process.env.RESEND_API_KEY
    ? new ResendEmailSender(
        // Until the plunj.co domain is verified in Resend, send from Resend's
        // onboarding address (deliverable only to the account owner's inbox).
        process.env.RESEND_FROM ? { from: process.env.RESEND_FROM } : {},
      )
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
