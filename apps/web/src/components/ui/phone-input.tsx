'use client'

/**
 * US phone input that formats as you type — "(801) 842-2358". State is the
 * raw 10 digits; the display string is DERIVED from those digits on every
 * change, so backspacing across punctuation and pasting "+1 (801) 842-2358"
 * both just work. Submit handlers send "+1" + digits (E.164) to the API.
 */

import { Input } from './input'
import type { InputProps } from './input'

/** Any phone-ish string → its US subscriber digits (max 10, country code dropped). */
export function phoneDigits(value: string): string {
  let digits = value.replace(/\D/g, '')
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1)
  return digits.slice(0, 10)
}

/** Progressive display format: "801" → "(801) 842" → "(801) 842-2358". */
export function formatPhoneDisplay(digits: string): string {
  if (digits.length <= 3) return digits
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
}

export interface PhoneInputProps extends Omit<InputProps, 'value' | 'onChange' | 'type'> {
  /** Raw digits ("8018422358") or E.164 ("+18018422358") — both render the same. */
  value: string
  /** Called with the raw digits (0–10 chars) on every change. */
  onChange: (digits: string) => void
}

export function PhoneInput({ value, onChange, ...rest }: PhoneInputProps) {
  return (
    <Input
      type="tel"
      autoComplete="tel"
      inputMode="tel"
      placeholder="(555) 555-5555"
      {...rest}
      value={formatPhoneDisplay(phoneDigits(value))}
      onChange={(e) => onChange(phoneDigits(e.target.value))}
    />
  )
}
