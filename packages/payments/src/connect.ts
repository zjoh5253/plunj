import Stripe from 'stripe'

import { mapStripeError } from './stripe.js'

export interface LocationAccountStatus {
  chargesEnabled: boolean
  payoutsEnabled: boolean
  detailsSubmitted: boolean
}

/**
 * Stripe Connect account lifecycle helpers (used by admin): one Express account per
 * location, onboarded via hosted account links.
 */
export class StripeConnect {
  private readonly stripe: Stripe

  constructor(options: { secretKey: string }) {
    this.stripe = new Stripe(options.secretKey)
  }

  /** Creates an Express connected account for a location and returns its account id. */
  async createLocationAccount(args: { email: string; businessName: string }): Promise<string> {
    try {
      const account = await this.stripe.accounts.create({
        type: 'express',
        email: args.email,
        business_profile: { name: args.businessName },
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
      })
      return account.id
    } catch (err) {
      throw mapStripeError(err)
    }
  }

  /** Creates a hosted onboarding link for the connected account and returns its URL. */
  async createOnboardingLink(args: {
    accountId: string
    refreshUrl: string
    returnUrl: string
  }): Promise<string> {
    try {
      const link = await this.stripe.accountLinks.create({
        account: args.accountId,
        refresh_url: args.refreshUrl,
        return_url: args.returnUrl,
        type: 'account_onboarding',
      })
      return link.url
    } catch (err) {
      throw mapStripeError(err)
    }
  }

  async getAccountStatus(accountId: string): Promise<LocationAccountStatus> {
    try {
      const account = await this.stripe.accounts.retrieve(accountId)
      return {
        chargesEnabled: account.charges_enabled === true,
        payoutsEnabled: account.payouts_enabled === true,
        detailsSubmitted: account.details_submitted === true,
      }
    } catch (err) {
      throw mapStripeError(err)
    }
  }
}
