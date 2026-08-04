import { beforeEach, describe, expect, it } from 'vitest'

import { FAKE_WEBHOOK_SIGNATURE, FakePaymentProvider } from '../src/fake.js'
import { PaymentProviderError, type CreatePaymentIntentArgs } from '../src/provider.js'

const createArgs = (overrides: Partial<CreatePaymentIntentArgs> = {}): CreatePaymentIntentArgs => ({
  amountCents: 5000,
  currency: 'usd',
  locationAccountRef: 'acct_loc_1',
  metadata: { bookingId: 'b1' },
  idempotencyKey: 'idem-1',
  ...overrides,
})

describe('FakePaymentProvider', () => {
  let provider: FakePaymentProvider

  beforeEach(() => {
    provider = new FakePaymentProvider()
  })

  describe('createPaymentIntent', () => {
    it('creates a succeeded intent with deterministic refs', async () => {
      const first = await provider.createPaymentIntent(createArgs())
      const second = await provider.createPaymentIntent(createArgs({ idempotencyKey: 'idem-2' }))
      expect(first).toEqual({
        providerPaymentRef: 'fake_pi_1',
        clientSecret: 'fake_pi_1_secret',
        status: 'SUCCEEDED',
      })
      expect(second.providerPaymentRef).toBe('fake_pi_2')
    })

    it('returns the same result for the same idempotency key', async () => {
      const first = await provider.createPaymentIntent(createArgs())
      const replay = await provider.createPaymentIntent(createArgs())
      expect(replay).toEqual(first)
      expect(replay.providerPaymentRef).toBe('fake_pi_1')
      const next = await provider.createPaymentIntent(createArgs({ idempotencyKey: 'idem-2' }))
      expect(next.providerPaymentRef).toBe('fake_pi_2')
    })

    it('returns REQUIRES_ACTION when configured to require action', async () => {
      provider.behavior = 'require_action'
      const result = await provider.createPaymentIntent(createArgs())
      expect(result.status).toBe('REQUIRES_ACTION')
      const snapshot = await provider.getPaymentIntent({
        providerPaymentRef: result.providerPaymentRef,
        locationAccountRef: 'acct_loc_1',
      })
      expect(snapshot.status).toBe('REQUIRES_ACTION')
    })

    it('throws a normalized card_declined error when configured to fail', async () => {
      provider.behavior = 'fail'
      const err = await provider.createPaymentIntent(createArgs()).catch((e: unknown) => e)
      expect(err).toBeInstanceOf(PaymentProviderError)
      expect(err).toMatchObject({ code: 'card_declined', retryable: false })
    })
  })

  describe('confirmOffSession', () => {
    it('confirms an existing intent to SUCCEEDED', async () => {
      provider.behavior = 'require_action'
      const created = await provider.createPaymentIntent(createArgs())
      provider.behavior = 'succeed'
      const confirmed = await provider.confirmOffSession({
        providerPaymentRef: created.providerPaymentRef,
        amountCents: 5000,
        locationAccountRef: 'acct_loc_1',
        customerRef: 'cus_1',
        paymentMethodRef: 'pm_1',
        metadata: {},
        idempotencyKey: 'idem-confirm',
      })
      expect(confirmed.providerPaymentRef).toBe(created.providerPaymentRef)
      expect(confirmed.status).toBe('SUCCEEDED')
    })

    it('creates a new intent when no ref is given, honoring idempotency', async () => {
      const args = {
        amountCents: 2500,
        locationAccountRef: 'acct_loc_1',
        customerRef: 'cus_1',
        paymentMethodRef: 'pm_1',
        metadata: { membershipId: 'm1' },
        idempotencyKey: 'idem-off',
      }
      const first = await provider.confirmOffSession(args)
      const replay = await provider.confirmOffSession(args)
      expect(first.providerPaymentRef).toBe('fake_pi_1')
      expect(first.status).toBe('SUCCEEDED')
      expect(replay).toEqual(first)
    })

    it('throws authentication_required when configured to require action', async () => {
      provider.behavior = 'require_action'
      const err = await provider
        .confirmOffSession({
          amountCents: 2500,
          locationAccountRef: 'acct_loc_1',
          customerRef: 'cus_1',
          paymentMethodRef: 'pm_1',
          metadata: {},
          idempotencyKey: 'idem-off',
        })
        .catch((e: unknown) => e)
      expect(err).toBeInstanceOf(PaymentProviderError)
      expect(err).toMatchObject({ code: 'authentication_required', retryable: false })
    })
  })

  describe('refund', () => {
    it('refunds a succeeded intent with deterministic refs and idempotency', async () => {
      const intent = await provider.createPaymentIntent(createArgs())
      const refundArgs = {
        providerPaymentRef: intent.providerPaymentRef,
        amountCents: 2000,
        locationAccountRef: 'acct_loc_1',
        idempotencyKey: 'idem-re-1',
      }
      const refund = await provider.refund(refundArgs)
      expect(refund).toEqual({ providerRefundRef: 'fake_re_1', status: 'SUCCEEDED' })
      const replay = await provider.refund(refundArgs)
      expect(replay).toEqual(refund)
    })

    it('rejects refunds that exceed the remaining balance', async () => {
      const intent = await provider.createPaymentIntent(createArgs())
      await provider.refund({
        providerPaymentRef: intent.providerPaymentRef,
        amountCents: 4000,
        locationAccountRef: 'acct_loc_1',
        idempotencyKey: 'idem-re-1',
      })
      const err = await provider
        .refund({
          providerPaymentRef: intent.providerPaymentRef,
          amountCents: 2000,
          locationAccountRef: 'acct_loc_1',
          idempotencyKey: 'idem-re-2',
        })
        .catch((e: unknown) => e)
      expect(err).toMatchObject({ code: 'invalid_request', retryable: false })
    })

    it('rejects refunds for unknown or non-succeeded intents', async () => {
      const unknown = await provider
        .refund({
          providerPaymentRef: 'fake_pi_missing',
          amountCents: 100,
          locationAccountRef: 'acct_loc_1',
          idempotencyKey: 'idem-re-1',
        })
        .catch((e: unknown) => e)
      expect(unknown).toMatchObject({ code: 'invalid_request' })

      provider.behavior = 'require_action'
      const pending = await provider.createPaymentIntent(createArgs())
      const notSucceeded = await provider
        .refund({
          providerPaymentRef: pending.providerPaymentRef,
          amountCents: 100,
          locationAccountRef: 'acct_loc_1',
          idempotencyKey: 'idem-re-2',
        })
        .catch((e: unknown) => e)
      expect(notSucceeded).toMatchObject({ code: 'invalid_request' })
    })

    it('honors refundBehavior pending and fail', async () => {
      const intent = await provider.createPaymentIntent(createArgs())
      provider.refundBehavior = 'pending'
      const pending = await provider.refund({
        providerPaymentRef: intent.providerPaymentRef,
        amountCents: 1000,
        locationAccountRef: 'acct_loc_1',
        idempotencyKey: 'idem-re-1',
      })
      expect(pending.status).toBe('PENDING')
      provider.refundBehavior = 'fail'
      const failed = await provider.refund({
        providerPaymentRef: intent.providerPaymentRef,
        amountCents: 1000,
        locationAccountRef: 'acct_loc_1',
        idempotencyKey: 'idem-re-2',
      })
      expect(failed.status).toBe('FAILED')
    })
  })

  describe('cancelPaymentIntent', () => {
    it('cancels a pending intent', async () => {
      provider.behavior = 'require_action'
      const intent = await provider.createPaymentIntent(createArgs())
      await provider.cancelPaymentIntent({
        providerPaymentRef: intent.providerPaymentRef,
        locationAccountRef: 'acct_loc_1',
      })
      const snapshot = await provider.getPaymentIntent({
        providerPaymentRef: intent.providerPaymentRef,
        locationAccountRef: 'acct_loc_1',
      })
      expect(snapshot.status).toBe('CANCELED')
    })

    it('refuses to cancel a succeeded intent', async () => {
      const intent = await provider.createPaymentIntent(createArgs())
      const err = await provider
        .cancelPaymentIntent({
          providerPaymentRef: intent.providerPaymentRef,
          locationAccountRef: 'acct_loc_1',
        })
        .catch((e: unknown) => e)
      expect(err).toMatchObject({ code: 'invalid_request' })
    })
  })

  describe('webhook simulation', () => {
    it('makeWebhookEvent transitions intent state and round-trips through verifyAndParseWebhook', async () => {
      provider.behavior = 'require_action'
      const intent = await provider.createPaymentIntent(createArgs())
      const event = provider.makeWebhookEvent(intent.providerPaymentRef, 'payment.succeeded')
      expect(event).toMatchObject({
        providerEventId: 'fake_evt_1',
        type: 'payment.succeeded',
        rawType: 'payment_intent.succeeded',
        providerPaymentRef: intent.providerPaymentRef,
        amountCents: 5000,
        accountRef: 'acct_loc_1',
      })
      const snapshot = await provider.getPaymentIntent({
        providerPaymentRef: intent.providerPaymentRef,
        locationAccountRef: 'acct_loc_1',
      })
      expect(snapshot.status).toBe('SUCCEEDED')

      const parsed = await provider.verifyAndParseWebhook({
        rawBody: JSON.stringify(event),
        signatureHeader: FAKE_WEBHOOK_SIGNATURE,
      })
      expect(parsed).toEqual(event)
    })

    it('builds refund and account events keyed by the right ref field', () => {
      const refundEvent = provider.makeWebhookEvent('fake_re_1', 'refund.succeeded')
      expect(refundEvent).toMatchObject({
        type: 'refund.succeeded',
        providerRefundRef: 'fake_re_1',
      })
      const accountEvent = provider.makeWebhookEvent('acct_loc_1', 'account.updated')
      expect(accountEvent).toMatchObject({ type: 'account.updated', accountRef: 'acct_loc_1' })
    })

    it('rejects bad signatures and malformed payloads', async () => {
      const badSig = await provider
        .verifyAndParseWebhook({ rawBody: '{}', signatureHeader: 'nope' })
        .catch((e: unknown) => e)
      expect(badSig).toBeInstanceOf(PaymentProviderError)
      expect(badSig).toMatchObject({ code: 'invalid_request' })

      const badJson = await provider
        .verifyAndParseWebhook({ rawBody: 'not-json', signatureHeader: FAKE_WEBHOOK_SIGNATURE })
        .catch((e: unknown) => e)
      expect(badJson).toMatchObject({ code: 'invalid_request' })
    })
  })
})
