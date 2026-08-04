import Stripe from 'stripe'

import {
  PaymentProviderError,
  type CancelPaymentIntentArgs,
  type ConfirmOffSessionArgs,
  type CreatePaymentIntentArgs,
  type GetPaymentIntentArgs,
  type NormalizedWebhookEvent,
  type PaymentIntentResult,
  type PaymentIntentSnapshot,
  type PaymentIntentStatus,
  type PaymentProvider,
  type RefundArgs,
  type RefundResult,
  type RefundStatus,
  type VerifyWebhookArgs,
} from './provider.js'

const PI_STATUS_MAP: Record<string, PaymentIntentStatus> = {
  requires_payment_method: 'REQUIRES_ACTION',
  requires_confirmation: 'REQUIRES_ACTION',
  requires_action: 'REQUIRES_ACTION',
  processing: 'PROCESSING',
  requires_capture: 'PROCESSING',
  succeeded: 'SUCCEEDED',
  canceled: 'CANCELED',
}

const mapIntentStatus = (status: string): PaymentIntentStatus => PI_STATUS_MAP[status] ?? 'FAILED'

const mapRefundStatus = (status: string | null | undefined): RefundStatus => {
  if (status === 'succeeded') return 'SUCCEEDED'
  if (status === 'failed' || status === 'canceled') return 'FAILED'
  return 'PENDING'
}

const STRIPE_REFUND_REASONS = new Set(['duplicate', 'fraudulent', 'requested_by_customer'])

/**
 * Maps a raw Stripe error to a normalized PaymentProviderError. Uses the `type` string
 * rather than instanceof so it works regardless of how the SDK constructed the error.
 */
export const mapStripeError = (err: unknown): PaymentProviderError => {
  if (err instanceof PaymentProviderError) return err
  const e = err as {
    type?: string
    code?: string
    decline_code?: string
    message?: string
  } | null
  const message = e?.message ?? 'Unknown payment provider error'
  switch (e?.type) {
    case 'StripeCardError':
      if (e.code === 'authentication_required' || e.decline_code === 'authentication_required') {
        return new PaymentProviderError(message, {
          code: 'authentication_required',
          retryable: false,
          cause: err,
        })
      }
      if (e.code === 'insufficient_funds' || e.decline_code === 'insufficient_funds') {
        return new PaymentProviderError(message, {
          code: 'insufficient_funds',
          retryable: false,
          cause: err,
        })
      }
      return new PaymentProviderError(message, {
        code: 'card_declined',
        retryable: false,
        cause: err,
      })
    case 'StripeRateLimitError':
      return new PaymentProviderError(message, {
        code: 'rate_limited',
        retryable: true,
        cause: err,
      })
    case 'StripeInvalidRequestError':
    case 'StripeAuthenticationError':
    case 'StripePermissionError':
    case 'StripeIdempotencyError':
      return new PaymentProviderError(message, {
        code: 'invalid_request',
        retryable: false,
        cause: err,
      })
    case 'StripeAPIError':
    case 'StripeConnectionError':
      return new PaymentProviderError(message, {
        code: 'provider_unavailable',
        retryable: true,
        cause: err,
      })
    default:
      return new PaymentProviderError(message, { code: 'unknown', retryable: false, cause: err })
  }
}

const toResult = (pi: Stripe.PaymentIntent): PaymentIntentResult => ({
  providerPaymentRef: pi.id,
  clientSecret: pi.client_secret ?? '',
  status: mapIntentStatus(pi.status),
})

const refFromExpandable = (
  value: string | { id: string } | null | undefined,
): string | undefined => (typeof value === 'string' ? value : (value?.id ?? undefined))

/**
 * Stripe Connect implementation. Every charge-creating call is a DIRECT CHARGE on the
 * location's connected account (`stripeAccount` request option) so funds settle to the
 * location, and every mutating call carries the caller's idempotency key.
 *
 * Exception: an `internal:` account ref (a location with no connected account yet,
 * e.g. during the pilot before Connect onboarding) charges the platform account
 * directly — no `stripeAccount` option is sent.
 */
export class StripeProvider implements PaymentProvider {
  private readonly stripe: Stripe
  private readonly webhookSecret: string

  constructor(options: { secretKey: string; webhookSecret: string }) {
    this.stripe = new Stripe(options.secretKey)
    this.webhookSecret = options.webhookSecret
  }

  private accountOpts(ref: string): { stripeAccount?: string } {
    return ref.startsWith('internal:') ? {} : { stripeAccount: ref }
  }

  async createPaymentIntent(args: CreatePaymentIntentArgs): Promise<PaymentIntentResult> {
    try {
      const pi = await this.stripe.paymentIntents.create(
        {
          amount: args.amountCents,
          currency: args.currency,
          metadata: args.metadata,
          capture_method: args.captureNow === false ? 'manual' : 'automatic',
          automatic_payment_methods: { enabled: true },
          ...(args.customerRef !== undefined ? { customer: args.customerRef } : {}),
          ...(args.paymentMethodRef !== undefined ? { payment_method: args.paymentMethodRef } : {}),
        },
        { ...this.accountOpts(args.locationAccountRef), idempotencyKey: args.idempotencyKey },
      )
      return toResult(pi)
    } catch (err) {
      throw mapStripeError(err)
    }
  }

  async confirmOffSession(args: ConfirmOffSessionArgs): Promise<PaymentIntentResult> {
    try {
      const requestOptions = {
        ...this.accountOpts(args.locationAccountRef),
        idempotencyKey: args.idempotencyKey,
      }
      const pi =
        args.providerPaymentRef !== undefined
          ? await this.stripe.paymentIntents.confirm(
              args.providerPaymentRef,
              { payment_method: args.paymentMethodRef, off_session: true },
              requestOptions,
            )
          : await this.stripe.paymentIntents.create(
              {
                amount: args.amountCents,
                currency: 'usd',
                customer: args.customerRef,
                payment_method: args.paymentMethodRef,
                metadata: args.metadata,
                confirm: true,
                off_session: true,
              },
              requestOptions,
            )
      return toResult(pi)
    } catch (err) {
      throw mapStripeError(err)
    }
  }

  async refund(args: RefundArgs): Promise<RefundResult> {
    try {
      const refund = await this.stripe.refunds.create(
        {
          payment_intent: args.providerPaymentRef,
          amount: args.amountCents,
          ...(args.reason !== undefined && STRIPE_REFUND_REASONS.has(args.reason)
            ? { reason: args.reason as Stripe.RefundCreateParams.Reason }
            : args.reason !== undefined
              ? { metadata: { reason: args.reason } }
              : {}),
        },
        { ...this.accountOpts(args.locationAccountRef), idempotencyKey: args.idempotencyKey },
      )
      return { providerRefundRef: refund.id, status: mapRefundStatus(refund.status) }
    } catch (err) {
      throw mapStripeError(err)
    }
  }

  async cancelPaymentIntent(args: CancelPaymentIntentArgs): Promise<void> {
    try {
      await this.stripe.paymentIntents.cancel(
        args.providerPaymentRef,
        {},
        { ...this.accountOpts(args.locationAccountRef) },
      )
    } catch (err) {
      throw mapStripeError(err)
    }
  }

  async getPaymentIntent(args: GetPaymentIntentArgs): Promise<PaymentIntentSnapshot> {
    try {
      const pi = await this.stripe.paymentIntents.retrieve(
        args.providerPaymentRef,
        {},
        { ...this.accountOpts(args.locationAccountRef) },
      )
      return {
        providerPaymentRef: pi.id,
        status: mapIntentStatus(pi.status),
        amountCents: pi.amount,
      }
    } catch (err) {
      throw mapStripeError(err)
    }
  }

  async verifyAndParseWebhook(args: VerifyWebhookArgs): Promise<NormalizedWebhookEvent> {
    let event: Stripe.Event
    try {
      event = this.stripe.webhooks.constructEvent(
        args.rawBody,
        args.signatureHeader,
        this.webhookSecret,
      )
    } catch (err) {
      throw new PaymentProviderError('Webhook signature verification failed', {
        code: 'invalid_request',
        retryable: false,
        cause: err,
      })
    }
    return this.normalizeEvent(event)
  }

  private normalizeEvent(event: Stripe.Event): NormalizedWebhookEvent {
    const accountRef = event.account ?? undefined
    const base = {
      providerEventId: event.id,
      rawType: event.type,
      payload: event.data.object,
      ...(accountRef !== undefined ? { accountRef } : {}),
    }

    switch (event.type) {
      case 'payment_intent.succeeded': {
        const pi = event.data.object as Stripe.PaymentIntent
        return {
          ...base,
          type: 'payment.succeeded',
          providerPaymentRef: pi.id,
          amountCents: pi.amount_received ?? pi.amount,
        }
      }
      case 'payment_intent.payment_failed': {
        const pi = event.data.object as Stripe.PaymentIntent
        return {
          ...base,
          type: 'payment.failed',
          providerPaymentRef: pi.id,
          amountCents: pi.amount,
        }
      }
      case 'payment_intent.canceled': {
        const pi = event.data.object as Stripe.PaymentIntent
        return {
          ...base,
          type: 'payment.canceled',
          providerPaymentRef: pi.id,
          amountCents: pi.amount,
        }
      }
      case 'refund.created':
      case 'refund.updated':
      case 'refund.failed': {
        const refund = event.data.object as Stripe.Refund
        const type =
          event.type === 'refund.failed' || refund.status === 'failed'
            ? 'refund.failed'
            : refund.status === 'succeeded'
              ? 'refund.succeeded'
              : 'other'
        const paymentRef = refFromExpandable(refund.payment_intent)
        return {
          ...base,
          type,
          providerRefundRef: refund.id,
          amountCents: refund.amount,
          ...(paymentRef !== undefined ? { providerPaymentRef: paymentRef } : {}),
        }
      }
      case 'charge.refunded': {
        const charge = event.data.object as Stripe.Charge
        const paymentRef = refFromExpandable(charge.payment_intent)
        return {
          ...base,
          type: 'refund.succeeded',
          amountCents: charge.amount_refunded,
          ...(paymentRef !== undefined ? { providerPaymentRef: paymentRef } : {}),
        }
      }
      case 'charge.dispute.created': {
        const dispute = event.data.object as Stripe.Dispute
        const paymentRef = refFromExpandable(dispute.payment_intent)
        return {
          ...base,
          type: 'dispute.created',
          amountCents: dispute.amount,
          ...(paymentRef !== undefined ? { providerPaymentRef: paymentRef } : {}),
        }
      }
      case 'account.updated': {
        const account = event.data.object as Stripe.Account
        return { ...base, type: 'account.updated', accountRef: accountRef ?? account.id }
      }
      default:
        return { ...base, type: 'other' }
    }
  }
}
