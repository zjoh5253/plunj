'use client'

/**
 * Invite-your-crew share sheet ("you're invited" energy): native OS share
 * when available (the full platform sheet on iOS/Android), always backed by
 * quick actions — copy link, Messages, WhatsApp, email.
 */

import { useEffect, useState } from 'react'
import { Card } from '@/components/ui/card'

interface ShareSheetProps {
  heading: string
  subtitle: string
  /** Share payload */
  title: string
  text: string
  /** App-relative path (e.g. "/waiver/abc") — absolutized to the current origin + basePath. */
  path: string
}

export function ShareSheet({ heading, subtitle, title, text, path }: ShareSheetProps) {
  const [copied, setCopied] = useState(false)
  const [shareError, setShareError] = useState(false)
  const [url, setUrl] = useState(`/book${path}`)

  useEffect(() => {
    setUrl(`${window.location.origin}/book${path}`)
  }, [path])

  const fullMessage = `${text} ${url}`
  const canNativeShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'

  const nativeShare = async () => {
    try {
      await navigator.share({ title, text, url })
    } catch {
      // User dismissed the sheet — not an error; anything else falls back to
      // the quick actions below, which are always visible anyway.
      setShareError(true)
    }
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(fullMessage)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setShareError(true)
    }
  }

  const quickAction =
    'flex min-h-11 flex-1 items-center justify-center gap-2 rounded-card border border-gray-200 bg-white px-3 text-sm font-medium text-ink transition-colors hover:border-gray-400'

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold tracking-tight">{heading}</h2>
        <p className="text-sm text-gray-500">{subtitle}</p>
      </div>

      {canNativeShare ? (
        <button
          type="button"
          onClick={nativeShare}
          className="flex min-h-12 w-full items-center justify-center gap-2 rounded-card bg-ink px-6 text-base font-medium text-paper transition-colors hover:bg-gray-800"
        >
          <span aria-hidden>↗</span> Share invite
        </button>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={copy} className={quickAction}>
          {copied ? '✓ Copied' : 'Copy link'}
        </button>
        <a href={`sms:?&body=${encodeURIComponent(fullMessage)}`} className={quickAction}>
          Messages
        </a>
        <a
          href={`https://wa.me/?text=${encodeURIComponent(fullMessage)}`}
          target="_blank"
          rel="noreferrer"
          className={quickAction}
        >
          WhatsApp
        </a>
        <a
          href={`mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(fullMessage)}`}
          className={quickAction}
        >
          Email
        </a>
      </div>

      {shareError ? (
        <p className="text-xs text-gray-500">Sharing didn&apos;t open — copy the link instead.</p>
      ) : null}
    </Card>
  )
}
