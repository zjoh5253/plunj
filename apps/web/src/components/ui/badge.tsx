import type { HTMLAttributes } from 'react'

type Tone = 'neutral' | 'ok' | 'warn' | 'danger'

const tones: Record<Tone, string> = {
  neutral: 'bg-gray-100 text-gray-600',
  ok: 'bg-ok/10 text-ok',
  warn: 'bg-warn/10 text-warn',
  danger: 'bg-danger/10 text-danger',
}

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone
}

export function Badge({ tone = 'neutral', className = '', ...rest }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${tones[tone]} ${className}`}
      {...rest}
    />
  )
}
