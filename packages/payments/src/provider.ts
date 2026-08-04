/**
 * Provider-agnostic payment abstraction for PLUNJ.
 *
 * The rest of the platform (api, web, desk POS) programs against this interface only.
 * No Stripe types may leak through it — refs are opaque strings, statuses and error
 * codes are normalized enums.
 */

export type PaymentIntentStatus =
  'REQUIRES_ACTION' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED' | 'CANCELED'

export type RefundStatus = 'PENDING' | 'SUCCEEDED' | 'FAILED'

export type PaymentErrorCode =
  | 'card_declined'
  | 'insufficient_funds'
  | 'authentication_required'
  | 'rate_limited'
  | 'invalid_request'
  | 'provider_unavailable'
  | 'unknown'

export class PaymentProviderError extends Error {
  readonly code: PaymentErrorCode
  readonly retryable: boolean

  constructor(
    message: string,
    options: { code: PaymentErrorCode; retryable: boolean; cause?: unknown },
  ) {
    super(message, { cause: options.cause })
    this.name = 'PaymentProviderError'
    this.code = options.code
    this.retryable = options.retryable
  }
}

export interface CreatePaymentIntentArgs {
  amountCents: number
  currency: 'usd'
  /** Opaque ref for the location's connected account (charges are made directly on it). */
  locationAccountRef: string
  customerRef?: string
  paymentMethodRef?: string
  /** When false, authorize only (manual capture). Defaults to capturing immediately. */
  captureNow?: boolean
  metadata: Record<string, string>
  idempotencyKey: string
}

export interface ConfirmOffSessionArgs {
  /** Existing intent to confirm; when omitted a new intent is created and confirmed. */
  providerPaymentRef?: string
  amountCents: number
  locationAccountRef: string
  customerRef: string
  paymentMethodRef: string
  metadata: Record<string, string>
  idempotencyKey: string
}

export interface PaymentIntentResult {
  providerPaymentRef: string
  clientSecret: string
  status: PaymentIntentStatus
}

export interface RefundArgs {
  providerPaymentRef: string
  amountCents: number
  locationAccountRef: string
  reason?: string
  idempotencyKey: string
}

export interface RefundResult {
  providerRefundRef: string
  status: RefundStatus
}

export interface CancelPaymentIntentArgs {
  providerPaymentRef: string
  locationAccountRef: string
}

export interface GetPaymentIntentArgs {
  providerPaymentRef: string
  locationAccountRef: string
}

export interface PaymentIntentSnapshot {
  providerPaymentRef: string
  status: PaymentIntentStatus
  amountCents: number
}

export type NormalizedWebhookEventType =
  | 'payment.succeeded'
  | 'payment.failed'
  | 'payment.canceled'
  | 'refund.succeeded'
  | 'refund.failed'
  | 'dispute.created'
  | 'account.updated'
  | 'other'

export interface NormalizedWebhookEvent {
  providerEventId: string
  type: NormalizedWebhookEventType
  /** The provider's own event type string, kept for auditing/debugging. */
  rawType: string
  providerPaymentRef?: string
  providerRefundRef?: string
  /** Connected account the event belongs to. */
  accountRef?: string
  amountCents?: number
  payload: unknown
}

export interface VerifyWebhookArgs {
  rawBody: string | Buffer
  signatureHeader: string
}

export interface PaymentProvider {
  createPaymentIntent(args: CreatePaymentIntentArgs): Promise<PaymentIntentResult>
  /** Off-session charge against a saved payment method (membership billing). */
  confirmOffSession(args: ConfirmOffSessionArgs): Promise<PaymentIntentResult>
  refund(args: RefundArgs): Promise<RefundResult>
  cancelPaymentIntent(args: CancelPaymentIntentArgs): Promise<void>
  getPaymentIntent(args: GetPaymentIntentArgs): Promise<PaymentIntentSnapshot>
  verifyAndParseWebhook(args: VerifyWebhookArgs): Promise<NormalizedWebhookEvent>
}
