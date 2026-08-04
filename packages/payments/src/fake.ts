import {
  PaymentProviderError,
  type CancelPaymentIntentArgs,
  type ConfirmOffSessionArgs,
  type CreatePaymentIntentArgs,
  type GetPaymentIntentArgs,
  type NormalizedWebhookEvent,
  type NormalizedWebhookEventType,
  type PaymentIntentResult,
  type PaymentIntentSnapshot,
  type PaymentIntentStatus,
  type PaymentProvider,
  type RefundArgs,
  type RefundResult,
  type VerifyWebhookArgs,
} from './provider.js'

export type FakeBehavior = 'succeed' | 'fail' | 'require_action'
export type FakeRefundBehavior = 'succeed' | 'pending' | 'fail'

export const FAKE_WEBHOOK_SIGNATURE = 'fake_signature'

interface FakeIntent {
  ref: string
  clientSecret: string
  status: PaymentIntentStatus
  amountCents: number
  refundedCents: number
  locationAccountRef: string
  metadata: Record<string, string>
}

const RAW_TYPE_BY_NORMALIZED: Record<NormalizedWebhookEventType, string> = {
  'payment.succeeded': 'payment_intent.succeeded',
  'payment.failed': 'payment_intent.payment_failed',
  'payment.canceled': 'payment_intent.canceled',
  'refund.succeeded': 'refund.updated',
  'refund.failed': 'refund.failed',
  'dispute.created': 'charge.dispute.created',
  'account.updated': 'account.updated',
  other: 'other',
}

/**
 * In-memory PaymentProvider for tests and local dev. Deterministic refs
 * ('fake_pi_1', 'fake_re_1', ...), configurable behavior, and a webhook simulator.
 */
export class FakePaymentProvider implements PaymentProvider {
  /** Controls createPaymentIntent / confirmOffSession outcomes. */
  behavior: FakeBehavior = 'succeed'
  /** Controls refund outcomes. */
  refundBehavior: FakeRefundBehavior = 'succeed'

  private readonly intents = new Map<string, FakeIntent>()
  private readonly refunds = new Map<string, RefundResult>()
  private readonly intentIdempotency = new Map<string, PaymentIntentResult>()
  private readonly refundIdempotency = new Map<string, RefundResult>()
  private piCounter = 0
  private refundCounter = 0
  private eventCounter = 0

  async createPaymentIntent(args: CreatePaymentIntentArgs): Promise<PaymentIntentResult> {
    const cached = this.intentIdempotency.get(args.idempotencyKey)
    if (cached) return cached
    if (this.behavior === 'fail') {
      throw new PaymentProviderError('Your card was declined (fake)', {
        code: 'card_declined',
        retryable: false,
      })
    }
    const status: PaymentIntentStatus =
      this.behavior === 'require_action' ? 'REQUIRES_ACTION' : 'SUCCEEDED'
    const result = this.storeIntent(args, status)
    this.intentIdempotency.set(args.idempotencyKey, result)
    return result
  }

  async confirmOffSession(args: ConfirmOffSessionArgs): Promise<PaymentIntentResult> {
    const cached = this.intentIdempotency.get(args.idempotencyKey)
    if (cached) return cached

    const existing =
      args.providerPaymentRef !== undefined
        ? this.mustGetIntent(args.providerPaymentRef)
        : undefined

    if (this.behavior === 'fail') {
      if (existing) existing.status = 'FAILED'
      throw new PaymentProviderError('Your card was declined (fake)', {
        code: 'card_declined',
        retryable: false,
      })
    }
    if (this.behavior === 'require_action') {
      if (existing) existing.status = 'REQUIRES_ACTION'
      throw new PaymentProviderError('Authentication required (fake)', {
        code: 'authentication_required',
        retryable: false,
      })
    }

    let result: PaymentIntentResult
    if (existing) {
      existing.status = 'SUCCEEDED'
      result = {
        providerPaymentRef: existing.ref,
        clientSecret: existing.clientSecret,
        status: existing.status,
      }
    } else {
      result = this.storeIntent(args, 'SUCCEEDED')
    }
    this.intentIdempotency.set(args.idempotencyKey, result)
    return result
  }

  async refund(args: RefundArgs): Promise<RefundResult> {
    const cached = this.refundIdempotency.get(args.idempotencyKey)
    if (cached) return cached

    const intent = this.mustGetIntent(args.providerPaymentRef)
    if (intent.status !== 'SUCCEEDED') {
      throw new PaymentProviderError(`Payment intent ${intent.ref} has not succeeded`, {
        code: 'invalid_request',
        retryable: false,
      })
    }
    if (args.amountCents <= 0 || args.amountCents > intent.amountCents - intent.refundedCents) {
      throw new PaymentProviderError('Refund amount exceeds refundable balance', {
        code: 'invalid_request',
        retryable: false,
      })
    }

    const ref = `fake_re_${++this.refundCounter}`
    const status =
      this.refundBehavior === 'fail'
        ? 'FAILED'
        : this.refundBehavior === 'pending'
          ? 'PENDING'
          : 'SUCCEEDED'
    if (status === 'SUCCEEDED') intent.refundedCents += args.amountCents
    const result: RefundResult = { providerRefundRef: ref, status }
    this.refunds.set(ref, result)
    this.refundIdempotency.set(args.idempotencyKey, result)
    return result
  }

  async cancelPaymentIntent(args: CancelPaymentIntentArgs): Promise<void> {
    const intent = this.mustGetIntent(args.providerPaymentRef)
    if (intent.status === 'SUCCEEDED') {
      throw new PaymentProviderError(`Payment intent ${intent.ref} already succeeded`, {
        code: 'invalid_request',
        retryable: false,
      })
    }
    intent.status = 'CANCELED'
  }

  async getPaymentIntent(args: GetPaymentIntentArgs): Promise<PaymentIntentSnapshot> {
    const intent = this.mustGetIntent(args.providerPaymentRef)
    return {
      providerPaymentRef: intent.ref,
      status: intent.status,
      amountCents: intent.amountCents,
    }
  }

  async verifyAndParseWebhook(args: VerifyWebhookArgs): Promise<NormalizedWebhookEvent> {
    if (args.signatureHeader !== FAKE_WEBHOOK_SIGNATURE) {
      throw new PaymentProviderError('Webhook signature verification failed (fake)', {
        code: 'invalid_request',
        retryable: false,
      })
    }
    const raw = typeof args.rawBody === 'string' ? args.rawBody : args.rawBody.toString('utf8')
    try {
      return JSON.parse(raw) as NormalizedWebhookEvent
    } catch (err) {
      throw new PaymentProviderError('Webhook payload is not valid JSON', {
        code: 'invalid_request',
        retryable: false,
        cause: err,
      })
    }
  }

  /**
   * Builds a NormalizedWebhookEvent for the given ref (intent ref for payment/dispute
   * types, refund ref for refund types, account ref for account.updated) and applies
   * the matching state transition to the stored intent, simulating async delivery.
   * Serialize it with JSON.stringify and feed it to verifyAndParseWebhook with
   * FAKE_WEBHOOK_SIGNATURE to exercise a webhook handler end to end.
   */
  makeWebhookEvent(ref: string, type: NormalizedWebhookEventType): NormalizedWebhookEvent {
    const base = {
      providerEventId: `fake_evt_${++this.eventCounter}`,
      type,
      rawType: RAW_TYPE_BY_NORMALIZED[type],
      payload: {},
    }
    switch (type) {
      case 'payment.succeeded':
      case 'payment.failed':
      case 'payment.canceled':
      case 'dispute.created': {
        const intent = this.intents.get(ref)
        if (intent) {
          if (type === 'payment.succeeded') intent.status = 'SUCCEEDED'
          if (type === 'payment.failed') intent.status = 'FAILED'
          if (type === 'payment.canceled') intent.status = 'CANCELED'
        }
        return {
          ...base,
          providerPaymentRef: ref,
          ...(intent !== undefined
            ? { amountCents: intent.amountCents, accountRef: intent.locationAccountRef }
            : {}),
        }
      }
      case 'refund.succeeded':
      case 'refund.failed':
        return { ...base, providerRefundRef: ref }
      case 'account.updated':
        return { ...base, accountRef: ref }
      default:
        return base
    }
  }

  private storeIntent(
    args: { amountCents: number; locationAccountRef: string; metadata: Record<string, string> },
    status: PaymentIntentStatus,
  ): PaymentIntentResult {
    const ref = `fake_pi_${++this.piCounter}`
    const intent: FakeIntent = {
      ref,
      clientSecret: `${ref}_secret`,
      status,
      amountCents: args.amountCents,
      refundedCents: 0,
      locationAccountRef: args.locationAccountRef,
      metadata: args.metadata,
    }
    this.intents.set(ref, intent)
    return { providerPaymentRef: ref, clientSecret: intent.clientSecret, status }
  }

  private mustGetIntent(ref: string): FakeIntent {
    const intent = this.intents.get(ref)
    if (!intent) {
      throw new PaymentProviderError(`No such payment intent: ${ref}`, {
        code: 'invalid_request',
        retryable: false,
      })
    }
    return intent
  }
}
