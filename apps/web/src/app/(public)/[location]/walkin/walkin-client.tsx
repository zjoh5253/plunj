'use client'

/**
 * Walk-in QR landing: sign the waiver on your own phone, then show the
 * checkmark screen at the front desk. Sub-60-second flow.
 */

import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { Markdown } from '@/components/booking/markdown'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { PhoneInput } from '@/components/ui/phone-input'
import type { LocationDetail, WaiverDoc } from '@/lib/api-types'
import { domainError } from '@/lib/api-types'
import { useTRPC } from '@/lib/trpc/client'

export function WalkinClient({ location, doc }: { location: LocationDetail; doc: WaiverDoc }) {
  const trpc = useTRPC()
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const signMutation = useMutation(
    trpc.public.waivers.sign.mutationOptions({
      onError: (err) => setError(domainError(err).messageText),
    }),
  )

  const firstName = name.trim().split(/\s+/)[0] ?? ''

  if (signMutation.isSuccess) {
    return (
      <div className="flex flex-col items-center gap-6 pt-20 text-center">
        <p className="text-7xl text-ok" aria-hidden>
          ✓
        </p>
        <p className="text-5xl font-semibold tracking-tight">{firstName}</p>
        <p className="max-w-xs text-lg text-gray-600">Show this screen at the front desk.</p>
        <p className="text-sm text-gray-400">Waiver signed · {location.name}</p>
      </div>
    )
  }

  const canSign = name.trim().length > 0 && phone.length === 10 && (doc === null || agreed)

  return (
    <form
      className="flex flex-col gap-5 pt-2"
      onSubmit={(e) => {
        e.preventDefault()
        if (!canSign) return
        setError(null)
        signMutation.mutate({
          walkIn: { locationSlug: location.slug },
          signer: { name: name.trim(), phone: `+1${phone}` },
          signatureKind: 'TYPED',
          typedName: name.trim(),
        })
      }}
    >
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Welcome to PLUNJ {location.city}</h1>
        <p className="text-gray-500">Quick sign-in — you&apos;ll be plunging in a minute.</p>
      </div>

      <Input
        label="Full name"
        autoComplete="name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
      />
      <PhoneInput label="Mobile number" value={phone} onChange={setPhone} required />
      {/* A2P 10DLC opt-in disclosure — carrier-required language; keep in sync
          with the Twilio campaign registration. */}
      <p className="text-xs leading-relaxed text-gray-500">
        By continuing, you agree to receive booking-related texts from PLUNJ (confirmations, waiver
        links, reminders). Message frequency varies. Message &amp; data rates may apply. Reply STOP
        to cancel or HELP for help.{' '}
        <a
          href="https://plunj.co/privacy-policy"
          className="underline"
          target="_blank"
          rel="noreferrer"
        >
          Privacy policy
        </a>
      </p>

      {doc ? (
        <>
          <Card className="max-h-48 overflow-y-auto">
            <Markdown source={doc.bodyMarkdown} />
          </Card>
          <label className="flex min-h-11 items-start gap-3">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              className="mt-1 size-5 accent-ink"
            />
            <span className="text-sm text-gray-700">
              I have read and agree to the waiver above. Typing my name below is my signature.
            </span>
          </label>
        </>
      ) : null}

      {error ? (
        <p className="rounded-card bg-danger/5 px-4 py-3 text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}

      <Button type="submit" size="lg" disabled={!canSign} loading={signMutation.isPending}>
        Sign &amp; check in
      </Button>
    </form>
  )
}
