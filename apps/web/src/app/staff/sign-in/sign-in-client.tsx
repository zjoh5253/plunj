'use client'

/**
 * Staff phone-OTP sign-in (Better Auth phone-number plugin — no passwords
 * anywhere). Phone → 6-digit code → session cookie → redirect to ?next=
 * (default /desk). The ?next= value is the app-internal path contract shared
 * with the desk guard and the admin surface.
 */

import { useRouter, useSearchParams } from 'next/navigation'
import { useState } from 'react'
import { authClient } from '@/components/desk/auth-client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

/** Only allow internal app paths — never absolute URLs (open-redirect guard). */
function safeNext(raw: string | null): string {
  if (raw && raw.startsWith('/') && !raw.startsWith('//')) return raw
  return '/desk'
}

export function SignInClient() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const next = safeNext(searchParams.get('next'))

  const [step, setStep] = useState<'phone' | 'code'>('phone')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const sendCode = async () => {
    setPending(true)
    setError(null)
    const { error: err } = await authClient.phoneNumber.sendOtp({ phoneNumber: phone.trim() })
    setPending(false)
    if (err) {
      setError(err.message ?? 'Could not send the code. Check the number and try again.')
      return
    }
    setStep('code')
  }

  const verify = async (value: string) => {
    setPending(true)
    setError(null)
    const { error: err } = await authClient.phoneNumber.verify({
      phoneNumber: phone.trim(),
      code: value.trim(),
    })
    setPending(false)
    if (err) {
      setError(err.message ?? 'That code did not work. Try again.')
      setCode('')
      return
    }
    router.replace(next)
  }

  if (step === 'code') {
    return (
      <form
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault()
          if (code.trim().length === 6 && !pending) void verify(code)
        }}
      >
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Enter the code</h1>
          <p className="text-gray-500">We texted a 6-digit code to {phone.trim()}.</p>
        </div>
        <Input
          label="Code"
          autoFocus
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          pattern="[0-9]*"
          className="text-center text-2xl tracking-[0.5em] tabular-nums"
          value={code}
          onChange={(e) => {
            const digits = e.target.value.replace(/\D/g, '').slice(0, 6)
            setCode(digits)
            if (digits.length === 6 && !pending) void verify(digits)
          }}
          {...(error ? { error } : {})}
        />
        <Button type="submit" size="lg" loading={pending} disabled={code.trim().length !== 6}>
          Sign in
        </Button>
        <button
          type="button"
          className="min-h-11 text-sm font-medium text-gray-500 underline"
          onClick={() => {
            setStep('phone')
            setCode('')
            setError(null)
          }}
        >
          Use a different number
        </button>
      </form>
    )
  }

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault()
        if (phone.trim().length >= 7 && !pending) void sendCode()
      }}
    >
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Staff sign-in</h1>
        <p className="text-gray-500">We&apos;ll text you a one-time code. No passwords.</p>
      </div>
      <Input
        label="Mobile number"
        type="tel"
        autoComplete="tel"
        inputMode="tel"
        placeholder="(555) 555-5555"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        autoFocus
        {...(error ? { error } : {})}
      />
      <Button type="submit" size="lg" loading={pending} disabled={phone.trim().length < 7}>
        Text me a code
      </Button>
    </form>
  )
}
