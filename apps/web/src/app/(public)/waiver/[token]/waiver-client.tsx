'use client'

/**
 * Waiver signing — a sub-60-second, one-scroll experience. Typed-name
 * signature. Minors 14–17 fork to a guardian section; under 14 is a hard stop
 * (the server enforces both — the UI just says it sooner).
 */

import Link from 'next/link'
import { useMutation } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Markdown } from '@/components/booking/markdown'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import type { ManageBooking, WaiverDoc } from '@/lib/api-types'
import { domainError } from '@/lib/api-types'
import { useTRPC } from '@/lib/trpc/client'

function ageFromDob(dob: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) return null
  const birth = new Date(`${dob}T00:00:00Z`)
  if (Number.isNaN(birth.getTime())) return null
  const now = new Date()
  let age = now.getUTCFullYear() - birth.getUTCFullYear()
  const beforeBirthday =
    now.getUTCMonth() < birth.getUTCMonth() ||
    (now.getUTCMonth() === birth.getUTCMonth() && now.getUTCDate() < birth.getUTCDate())
  if (beforeBirthday) age -= 1
  return age
}

export function WaiverClient({
  token,
  booking,
  doc,
}: {
  token: string
  booking: ManageBooking
  doc: NonNullable<WaiverDoc>
}) {
  const trpc = useTRPC()
  const [name, setName] = useState(booking.customerFirstName)
  const [phone, setPhone] = useState('')
  const [dob, setDob] = useState('')
  const [guardianName, setGuardianName] = useState('')
  const [guardianPhone, setGuardianPhone] = useState('')
  const [guardianRelationship, setGuardianRelationship] = useState('')
  const [typedName, setTypedName] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const age = useMemo(() => (dob ? ageFromDob(dob) : null), [dob])
  const isMinor = age !== null && age >= 14 && age < 18
  const blocked = age !== null && age < 14

  const signMutation = useMutation(
    trpc.public.waivers.sign.mutationOptions({
      onError: (err) => setError(domainError(err).messageText),
    }),
  )

  if (signMutation.isSuccess) {
    return (
      <div className="flex flex-col items-center gap-4 pt-16 text-center">
        <p className="text-5xl text-ok" aria-hidden>
          ✓
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">Waiver signed</h1>
        <p className="max-w-xs text-gray-500">
          You&apos;re all set for {booking.whenLocal} at {booking.location.name}.
        </p>
        <Link href={`/manage/${token}`} className="text-sm font-medium underline">
          View your booking
        </Link>
      </div>
    )
  }

  const expectedSignature = isMinor ? guardianName.trim() : name.trim()
  const canSign =
    !blocked &&
    name.trim().length > 0 &&
    (isMinor ? guardianPhone : phone).trim().length >= 7 &&
    agreed &&
    typedName.trim().length > 0 &&
    (!isMinor || (guardianName.trim().length > 0 && guardianRelationship.trim().length > 0)) &&
    (!isMinor || dob !== '')

  return (
    <form
      className="flex flex-col gap-5 pt-2"
      onSubmit={(e) => {
        e.preventDefault()
        if (!canSign) return
        setError(null)
        signMutation.mutate({
          bookingManageToken: token,
          signer: isMinor
            ? { name: guardianName.trim(), phone: guardianPhone.trim() }
            : {
                name: name.trim(),
                phone: phone.trim(),
                ...(dob ? { dateOfBirth: dob } : {}),
              },
          signatureKind: 'TYPED',
          typedName: typedName.trim(),
          ...(isMinor
            ? {
                minor: {
                  name: name.trim(),
                  dateOfBirth: dob,
                  guardianName: guardianName.trim(),
                  guardianRelationship: guardianRelationship.trim(),
                },
              }
            : {}),
        })
      }}
    >
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{doc.title}</h1>
        <p className="text-sm text-gray-500">
          {booking.location.name} · version {doc.version}
        </p>
      </div>

      <Card className="max-h-64 overflow-y-auto">
        <Markdown source={doc.bodyMarkdown} />
      </Card>

      <p className="text-sm text-gray-500">
        Signing for someone else in your group? Enter <em>their</em> name and <em>their</em> phone —
        each guest signs their own.
      </p>

      <Input
        label="Full name"
        autoComplete="name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
      />
      {!isMinor ? (
        <Input
          label="Mobile number"
          type="tel"
          autoComplete="tel"
          inputMode="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          required
        />
      ) : null}
      <Input
        label="Date of birth"
        type="date"
        value={dob}
        onChange={(e) => setDob(e.target.value)}
        {...(blocked
          ? { error: 'Guests under 14 cannot attend — even with a signed guardian waiver.' }
          : {})}
      />

      {isMinor ? (
        <Card className="flex flex-col gap-4 border-warn/30">
          <p className="text-sm text-warn">Guests under 18 need a parent or guardian to sign.</p>
          <Input
            label="Guardian full name"
            value={guardianName}
            onChange={(e) => setGuardianName(e.target.value)}
            required
          />
          <Input
            label="Guardian mobile number"
            type="tel"
            inputMode="tel"
            value={guardianPhone}
            onChange={(e) => setGuardianPhone(e.target.value)}
            required
          />
          <Input
            label="Relationship to guest"
            placeholder="Parent, guardian…"
            value={guardianRelationship}
            onChange={(e) => setGuardianRelationship(e.target.value)}
            required
          />
        </Card>
      ) : null}

      {!blocked ? (
        <Card className="flex flex-col gap-4">
          <label className="flex min-h-11 items-start gap-3">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              className="mt-1 size-5 accent-ink"
            />
            <span className="text-sm text-gray-700">
              I have read and agree to the terms above{isMinor ? ' on behalf of my minor' : ''}.
            </span>
          </label>
          <Input
            label={
              isMinor
                ? 'Guardian signature — type your full name'
                : 'Signature — type your full name'
            }
            value={typedName}
            onChange={(e) => setTypedName(e.target.value)}
            {...(expectedSignature ? { placeholder: expectedSignature } : {})}
            className="font-serif italic"
            required
          />
        </Card>
      ) : null}

      {error ? (
        <p className="rounded-card bg-danger/5 px-4 py-3 text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}

      <Button type="submit" size="lg" disabled={!canSign} loading={signMutation.isPending}>
        Sign waiver
      </Button>
    </form>
  )
}
