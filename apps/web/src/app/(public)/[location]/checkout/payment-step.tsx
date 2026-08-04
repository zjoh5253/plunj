'use client'

/**
 * Stripe Payment Element stage. stripe-js is loaded lazily HERE so the
 * schedule/checkout-form bundles never pull it in; wallets (Apple/Google Pay)
 * are on by default via automatic payment methods.
 */

import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js'
import { loadStripe } from '@stripe/stripe-js'
import type { Appearance, Stripe } from '@stripe/stripe-js'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { formatCents } from '@/lib/format'

let stripePromise: Promise<Stripe | null> | undefined

function getStripe(): Promise<Stripe | null> | null {
  const key = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
  if (!key) return null
  return (stripePromise ??= loadStripe(key))
}

const appearance: Appearance = {
  variables: {
    colorPrimary: '#0a0a0a',
    colorBackground: '#ffffff',
    colorText: '#0a0a0a',
    colorDanger: '#b3261e',
    borderRadius: '12px',
    fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
  },
}

export function PaymentStep({
  clientSecret,
  totalCents,
  returnPath,
}: {
  clientSecret: string
  totalCents: number
  returnPath: string
}) {
  const stripe = useMemo(() => getStripe(), [])

  if (!stripe) {
    return (
      <p className="rounded-card bg-warn/5 px-4 py-3 text-sm text-warn" role="alert">
        Payments aren&apos;t configured in this environment (NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is
        missing).
      </p>
    )
  }

  return (
    <Elements stripe={stripe} options={{ clientSecret, appearance }}>
      <PaymentForm totalCents={totalCents} returnPath={returnPath} />
    </Elements>
  )
}

function PaymentForm({ totalCents, returnPath }: { totalCents: number; returnPath: string }) {
  const stripe = useStripe()
  const elements = useElements()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={async (e) => {
        e.preventDefault()
        if (!stripe || !elements) return
        setSubmitting(true)
        setError(null)
        // basePath '/book' is not part of app-router paths — add it for Stripe.
        const returnUrl = `${window.location.origin}/book${returnPath}`
        const result = await stripe.confirmPayment({
          elements,
          confirmParams: { return_url: returnUrl },
        })
        // Only reached on immediate failure — success redirects away.
        setError(result.error.message ?? 'Payment failed. Please try again.')
        setSubmitting(false)
      }}
    >
      <PaymentElement />
      {error ? (
        <p className="rounded-card bg-danger/5 px-4 py-3 text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}
      <Button type="submit" size="lg" disabled={!stripe || !elements} loading={submitting}>
        Pay {formatCents(totalCents)}
      </Button>
    </form>
  )
}
