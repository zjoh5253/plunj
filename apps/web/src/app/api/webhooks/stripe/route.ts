/**
 * Stripe webhook receiver. Raw body → signature verification → idempotent
 * domain processing (WebhookEvent rows dedupe replays inside processWebhookEvent).
 */

import { processWebhookEvent } from '@plunj/api'
import { getPayments, prisma } from '@/lib/trpc/server'

export async function POST(req: Request): Promise<Response> {
  const payments = getPayments()
  const rawBody = await req.text()
  const signatureHeader = req.headers.get('stripe-signature')
  if (!signatureHeader) {
    return Response.json({ error: 'Missing stripe-signature header' }, { status: 400 })
  }

  let event
  try {
    event = await payments.verifyAndParseWebhook({ rawBody, signatureHeader })
  } catch {
    return Response.json({ error: 'Webhook signature verification failed' }, { status: 400 })
  }

  const result = await processWebhookEvent(prisma, payments, event)
  if (result.status === 'failed') {
    // 500 → Stripe retries; the WebhookEvent row already records the error.
    return Response.json(result, { status: 500 })
  }
  return Response.json(result)
}
