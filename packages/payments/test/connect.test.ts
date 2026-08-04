import { beforeEach, describe, expect, it, vi } from 'vitest'

import { StripeConnect } from '../src/connect.js'
import { PaymentProviderError } from '../src/provider.js'

const mocks = vi.hoisted(() => ({
  accounts: { create: vi.fn(), retrieve: vi.fn() },
  accountLinks: { create: vi.fn() },
  constructorArgs: vi.fn(),
}))

vi.mock('stripe', () => ({
  default: class MockStripe {
    accounts = mocks.accounts
    accountLinks = mocks.accountLinks
    constructor(...args: unknown[]) {
      mocks.constructorArgs(...args)
    }
  },
}))

describe('StripeConnect', () => {
  let connect: StripeConnect

  beforeEach(() => {
    vi.clearAllMocks()
    connect = new StripeConnect({ secretKey: 'sk_test_123' })
  })

  it('creates an Express account for a location and returns its id', async () => {
    mocks.accounts.create.mockResolvedValue({ id: 'acct_loc_1' })
    const id = await connect.createLocationAccount({
      email: 'owner@plunj.co',
      businessName: 'PLUNJ Lehi',
    })
    expect(mocks.accounts.create).toHaveBeenCalledWith({
      type: 'express',
      email: 'owner@plunj.co',
      business_profile: { name: 'PLUNJ Lehi' },
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
    })
    expect(id).toBe('acct_loc_1')
  })

  it('creates an onboarding link and returns its url', async () => {
    mocks.accountLinks.create.mockResolvedValue({ url: 'https://connect.stripe.com/setup/x' })
    const url = await connect.createOnboardingLink({
      accountId: 'acct_loc_1',
      refreshUrl: 'https://plunj.co/book/admin/payments/refresh',
      returnUrl: 'https://plunj.co/book/admin/payments/return',
    })
    expect(mocks.accountLinks.create).toHaveBeenCalledWith({
      account: 'acct_loc_1',
      refresh_url: 'https://plunj.co/book/admin/payments/refresh',
      return_url: 'https://plunj.co/book/admin/payments/return',
      type: 'account_onboarding',
    })
    expect(url).toBe('https://connect.stripe.com/setup/x')
  })

  it('returns normalized account status flags', async () => {
    mocks.accounts.retrieve.mockResolvedValue({
      id: 'acct_loc_1',
      charges_enabled: true,
      payouts_enabled: false,
      details_submitted: true,
    })
    const status = await connect.getAccountStatus('acct_loc_1')
    expect(mocks.accounts.retrieve).toHaveBeenCalledWith('acct_loc_1')
    expect(status).toEqual({ chargesEnabled: true, payoutsEnabled: false, detailsSubmitted: true })
  })

  it('maps stripe errors to normalized PaymentProviderError', async () => {
    mocks.accounts.create.mockRejectedValue(
      Object.assign(new Error('bad request'), { type: 'StripeInvalidRequestError' }),
    )
    const err = await connect
      .createLocationAccount({ email: 'x@plunj.co', businessName: 'X' })
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PaymentProviderError)
    expect(err).toMatchObject({ code: 'invalid_request', retryable: false })
  })
})
