import { beforeEach, describe, expect, it, vi } from 'vitest'

import { PaymentProviderError, type CreatePaymentIntentArgs } from '../src/provider.js'
import { StripeProvider } from '../src/stripe.js'

const mocks = vi.hoisted(() => ({
  paymentIntents: { create: vi.fn(), confirm: vi.fn(), retrieve: vi.fn(), cancel: vi.fn() },
  refunds: { create: vi.fn() },
  webhooks: { constructEvent: vi.fn() },
  constructorArgs: vi.fn(),
}))

vi.mock('stripe', () => ({
  default: class MockStripe {
    paymentIntents = mocks.paymentIntents
    refunds = mocks.refunds
    webhooks = mocks.webhooks
    constructor(...args: unknown[]) {
      mocks.constructorArgs(...args)
    }
  },
}))

const stripeError = (props: Record<string, unknown>) => Object.assign(new Error('stripe'), props)

const createArgs = (overrides: Partial<CreatePaymentIntentArgs> = {}): CreatePaymentIntentArgs => ({
  amountCents: 5000,
  currency: 'usd',
  locationAccountRef: 'acct_loc_1',
  metadata: { bookingId: 'b1' },
  idempotencyKey: 'idem-1',
  ...overrides,
})

describe('StripeProvider', () => {
  let provider: StripeProvider

  beforeEach(() => {
    vi.clearAllMocks()
    provider = new StripeProvider({ secretKey: 'sk_test_123', webhookSecret: 'whsec_123' })
  })

  it('constructs the stripe client with the secret key', () => {
    expect(mocks.constructorArgs).toHaveBeenCalledWith('sk_test_123')
  })

  describe('createPaymentIntent', () => {
    it('creates a direct charge on the connected account with the idempotency key', async () => {
      mocks.paymentIntents.create.mockResolvedValue({
        id: 'pi_1',
        client_secret: 'pi_1_secret_x',
        status: 'requires_payment_method',
      })
      const result = await provider.createPaymentIntent(
        createArgs({ customerRef: 'cus_1', paymentMethodRef: 'pm_1' }),
      )
      expect(mocks.paymentIntents.create).toHaveBeenCalledWith(
        {
          amount: 5000,
          currency: 'usd',
          metadata: { bookingId: 'b1' },
          capture_method: 'automatic',
          automatic_payment_methods: { enabled: true },
          customer: 'cus_1',
          payment_method: 'pm_1',
        },
        { stripeAccount: 'acct_loc_1', idempotencyKey: 'idem-1' },
      )
      expect(result).toEqual({
        providerPaymentRef: 'pi_1',
        clientSecret: 'pi_1_secret_x',
        status: 'REQUIRES_ACTION',
      })
    })

    it('uses manual capture when captureNow is false and omits absent optional refs', async () => {
      mocks.paymentIntents.create.mockResolvedValue({
        id: 'pi_2',
        client_secret: 's',
        status: 'requires_capture',
      })
      const result = await provider.createPaymentIntent(createArgs({ captureNow: false }))
      const [params] = mocks.paymentIntents.create.mock.calls[0] as [Record<string, unknown>]
      expect(params['capture_method']).toBe('manual')
      expect(params).not.toHaveProperty('customer')
      expect(params).not.toHaveProperty('payment_method')
      expect(result.status).toBe('PROCESSING')
    })

    it.each([
      ['succeeded', 'SUCCEEDED'],
      ['processing', 'PROCESSING'],
      ['requires_action', 'REQUIRES_ACTION'],
      ['requires_confirmation', 'REQUIRES_ACTION'],
      ['canceled', 'CANCELED'],
      ['something_new', 'FAILED'],
    ])('maps stripe status %s to %s', async (stripeStatus, normalized) => {
      mocks.paymentIntents.create.mockResolvedValue({
        id: 'pi_3',
        client_secret: 's',
        status: stripeStatus,
      })
      const result = await provider.createPaymentIntent(createArgs())
      expect(result.status).toBe(normalized)
    })

    it.each([
      [
        { type: 'StripeCardError', code: 'card_declined', decline_code: 'generic_decline' },
        'card_declined',
        false,
      ],
      [
        { type: 'StripeCardError', code: 'card_declined', decline_code: 'insufficient_funds' },
        'insufficient_funds',
        false,
      ],
      [
        { type: 'StripeCardError', code: 'authentication_required' },
        'authentication_required',
        false,
      ],
      [{ type: 'StripeRateLimitError' }, 'rate_limited', true],
      [{ type: 'StripeInvalidRequestError' }, 'invalid_request', false],
      [{ type: 'StripeAPIError' }, 'provider_unavailable', true],
      [{ type: 'StripeConnectionError' }, 'provider_unavailable', true],
      [{ type: 'SomethingElse' }, 'unknown', false],
    ])('maps stripe error %o to %s (retryable %s)', async (props, code, retryable) => {
      mocks.paymentIntents.create.mockRejectedValue(stripeError(props))
      const err = await provider.createPaymentIntent(createArgs()).catch((e: unknown) => e)
      expect(err).toBeInstanceOf(PaymentProviderError)
      expect(err).toMatchObject({ code, retryable })
    })
  })

  describe('confirmOffSession', () => {
    it('confirms an existing intent off-session on the connected account', async () => {
      mocks.paymentIntents.confirm.mockResolvedValue({
        id: 'pi_1',
        client_secret: 's',
        status: 'succeeded',
      })
      const result = await provider.confirmOffSession({
        providerPaymentRef: 'pi_1',
        amountCents: 5000,
        locationAccountRef: 'acct_loc_1',
        customerRef: 'cus_1',
        paymentMethodRef: 'pm_1',
        metadata: {},
        idempotencyKey: 'idem-c',
      })
      expect(mocks.paymentIntents.confirm).toHaveBeenCalledWith(
        'pi_1',
        { payment_method: 'pm_1', off_session: true },
        { stripeAccount: 'acct_loc_1', idempotencyKey: 'idem-c' },
      )
      expect(result.status).toBe('SUCCEEDED')
    })

    it('creates and confirms a new off-session intent when no ref is given', async () => {
      mocks.paymentIntents.create.mockResolvedValue({
        id: 'pi_9',
        client_secret: null,
        status: 'succeeded',
      })
      const result = await provider.confirmOffSession({
        amountCents: 2500,
        locationAccountRef: 'acct_loc_1',
        customerRef: 'cus_1',
        paymentMethodRef: 'pm_1',
        metadata: { membershipId: 'm1' },
        idempotencyKey: 'idem-o',
      })
      expect(mocks.paymentIntents.create).toHaveBeenCalledWith(
        {
          amount: 2500,
          currency: 'usd',
          customer: 'cus_1',
          payment_method: 'pm_1',
          metadata: { membershipId: 'm1' },
          confirm: true,
          off_session: true,
        },
        { stripeAccount: 'acct_loc_1', idempotencyKey: 'idem-o' },
      )
      expect(result).toEqual({ providerPaymentRef: 'pi_9', clientSecret: '', status: 'SUCCEEDED' })
    })
  })

  describe('refund', () => {
    it('creates the refund on the connected account with the idempotency key', async () => {
      mocks.refunds.create.mockResolvedValue({ id: 're_1', status: 'pending' })
      const result = await provider.refund({
        providerPaymentRef: 'pi_1',
        amountCents: 1500,
        locationAccountRef: 'acct_loc_1',
        reason: 'requested_by_customer',
        idempotencyKey: 'idem-r',
      })
      expect(mocks.refunds.create).toHaveBeenCalledWith(
        { payment_intent: 'pi_1', amount: 1500, reason: 'requested_by_customer' },
        { stripeAccount: 'acct_loc_1', idempotencyKey: 'idem-r' },
      )
      expect(result).toEqual({ providerRefundRef: 're_1', status: 'PENDING' })
    })

    it('moves non-stripe reasons into metadata and maps terminal statuses', async () => {
      mocks.refunds.create.mockResolvedValue({ id: 're_2', status: 'failed' })
      const result = await provider.refund({
        providerPaymentRef: 'pi_1',
        amountCents: 500,
        locationAccountRef: 'acct_loc_1',
        reason: 'class canceled by owner',
        idempotencyKey: 'idem-r2',
      })
      expect(mocks.refunds.create).toHaveBeenCalledWith(
        {
          payment_intent: 'pi_1',
          amount: 500,
          metadata: { reason: 'class canceled by owner' },
        },
        { stripeAccount: 'acct_loc_1', idempotencyKey: 'idem-r2' },
      )
      expect(result.status).toBe('FAILED')
    })
  })

  describe('cancelPaymentIntent / getPaymentIntent', () => {
    it('cancels on the connected account', async () => {
      mocks.paymentIntents.cancel.mockResolvedValue({ id: 'pi_1', status: 'canceled' })
      await provider.cancelPaymentIntent({
        providerPaymentRef: 'pi_1',
        locationAccountRef: 'acct_loc_1',
      })
      expect(mocks.paymentIntents.cancel).toHaveBeenCalledWith(
        'pi_1',
        {},
        { stripeAccount: 'acct_loc_1' },
      )
    })

    it('retrieves a normalized snapshot from the connected account', async () => {
      mocks.paymentIntents.retrieve.mockResolvedValue({
        id: 'pi_1',
        status: 'processing',
        amount: 5000,
      })
      const snapshot = await provider.getPaymentIntent({
        providerPaymentRef: 'pi_1',
        locationAccountRef: 'acct_loc_1',
      })
      expect(mocks.paymentIntents.retrieve).toHaveBeenCalledWith(
        'pi_1',
        {},
        { stripeAccount: 'acct_loc_1' },
      )
      expect(snapshot).toEqual({
        providerPaymentRef: 'pi_1',
        status: 'PROCESSING',
        amountCents: 5000,
      })
    })
  })

  describe('verifyAndParseWebhook', () => {
    it('verifies with the connect webhook secret and normalizes payment_intent.succeeded', async () => {
      mocks.webhooks.constructEvent.mockReturnValue({
        id: 'evt_1',
        type: 'payment_intent.succeeded',
        account: 'acct_loc_1',
        data: { object: { id: 'pi_1', amount: 5000, amount_received: 5000 } },
      })
      const event = await provider.verifyAndParseWebhook({
        rawBody: '{"raw":true}',
        signatureHeader: 'sig_header',
      })
      expect(mocks.webhooks.constructEvent).toHaveBeenCalledWith(
        '{"raw":true}',
        'sig_header',
        'whsec_123',
      )
      expect(event).toMatchObject({
        providerEventId: 'evt_1',
        type: 'payment.succeeded',
        rawType: 'payment_intent.succeeded',
        providerPaymentRef: 'pi_1',
        accountRef: 'acct_loc_1',
        amountCents: 5000,
      })
    })

    it('normalizes payment_intent.payment_failed', async () => {
      mocks.webhooks.constructEvent.mockReturnValue({
        id: 'evt_2',
        type: 'payment_intent.payment_failed',
        account: 'acct_loc_1',
        data: { object: { id: 'pi_2', amount: 2500 } },
      })
      const event = await provider.verifyAndParseWebhook({ rawBody: '{}', signatureHeader: 's' })
      expect(event).toMatchObject({
        type: 'payment.failed',
        providerPaymentRef: 'pi_2',
        accountRef: 'acct_loc_1',
        amountCents: 2500,
      })
    })

    it('normalizes refund.updated by refund status', async () => {
      mocks.webhooks.constructEvent.mockReturnValue({
        id: 'evt_3',
        type: 'refund.updated',
        account: 'acct_loc_1',
        data: { object: { id: 're_1', status: 'succeeded', amount: 1500, payment_intent: 'pi_1' } },
      })
      const event = await provider.verifyAndParseWebhook({ rawBody: '{}', signatureHeader: 's' })
      expect(event).toMatchObject({
        type: 'refund.succeeded',
        providerRefundRef: 're_1',
        providerPaymentRef: 'pi_1',
        amountCents: 1500,
      })
    })

    it('normalizes charge.dispute.created with amount and payment ref', async () => {
      mocks.webhooks.constructEvent.mockReturnValue({
        id: 'evt_4',
        type: 'charge.dispute.created',
        account: 'acct_loc_1',
        data: { object: { id: 'dp_1', amount: 5000, payment_intent: 'pi_1' } },
      })
      const event = await provider.verifyAndParseWebhook({ rawBody: '{}', signatureHeader: 's' })
      expect(event).toMatchObject({
        type: 'dispute.created',
        rawType: 'charge.dispute.created',
        providerPaymentRef: 'pi_1',
        accountRef: 'acct_loc_1',
        amountCents: 5000,
      })
    })

    it('normalizes account.updated, falling back to the account object id', async () => {
      mocks.webhooks.constructEvent.mockReturnValue({
        id: 'evt_5',
        type: 'account.updated',
        data: { object: { id: 'acct_loc_2', charges_enabled: true } },
      })
      const event = await provider.verifyAndParseWebhook({ rawBody: '{}', signatureHeader: 's' })
      expect(event).toMatchObject({ type: 'account.updated', accountRef: 'acct_loc_2' })
    })

    it('passes through unrecognized event types as other', async () => {
      mocks.webhooks.constructEvent.mockReturnValue({
        id: 'evt_6',
        type: 'customer.created',
        account: 'acct_loc_1',
        data: { object: { id: 'cus_1' } },
      })
      const event = await provider.verifyAndParseWebhook({ rawBody: '{}', signatureHeader: 's' })
      expect(event).toMatchObject({
        type: 'other',
        rawType: 'customer.created',
        accountRef: 'acct_loc_1',
      })
      expect(event.providerPaymentRef).toBeUndefined()
    })

    it('throws invalid_request when signature verification fails', async () => {
      mocks.webhooks.constructEvent.mockImplementation(() => {
        throw new Error('No signatures found')
      })
      const err = await provider
        .verifyAndParseWebhook({ rawBody: '{}', signatureHeader: 'bad' })
        .catch((e: unknown) => e)
      expect(err).toBeInstanceOf(PaymentProviderError)
      expect(err).toMatchObject({ code: 'invalid_request', retryable: false })
    })
  })
})
