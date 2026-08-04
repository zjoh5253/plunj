'use client'

import { useEffect, useState } from 'react'
import { formatCountdown } from '@/lib/format'

export function HoldCountdown({
  holdExpiresAt,
  onExpired,
}: {
  holdExpiresAt: string
  onExpired: () => void
}) {
  const [remainingMs, setRemainingMs] = useState(
    () => new Date(holdExpiresAt).getTime() - Date.now(),
  )

  useEffect(() => {
    const tick = () => {
      const ms = new Date(holdExpiresAt).getTime() - Date.now()
      setRemainingMs(ms)
      if (ms <= 0) onExpired()
    }
    tick()
    const interval = setInterval(tick, 1000)
    return () => clearInterval(interval)
  }, [holdExpiresAt, onExpired])

  return (
    <p className="text-center text-sm text-gray-500" aria-live="polite">
      Your spot is held for{' '}
      <span className="font-medium text-ink tabular-nums">{formatCountdown(remainingMs)}</span>
    </p>
  )
}
