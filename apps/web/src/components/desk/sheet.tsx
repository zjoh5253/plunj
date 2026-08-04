'use client'

/**
 * Desk action sheet — a larger, touch-first variant of ui/dialog (which is
 * capped at max-w-md and too small for the desk flows). `full` renders a
 * full-screen takeover (used by the waiver QR screen).
 */

import { useEffect } from 'react'

export interface DeskSheetProps {
  open: boolean
  onClose: () => void
  title?: string
  full?: boolean
  children: React.ReactNode
}

export function DeskSheet({ open, onClose, title, full = false, children }: DeskSheetProps) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open, onClose])

  if (!open) return null

  if (full) {
    return (
      <div
        className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-paper"
        role="dialog"
        aria-modal="true"
        {...(title ? { 'aria-label': title } : {})}
      >
        <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-6 py-5">
          <div className="flex items-center justify-between">
            {title ? <h2 className="text-xl font-semibold tracking-tight">{title}</h2> : <span />}
            <button
              type="button"
              onClick={onClose}
              className="flex min-h-11 min-w-11 items-center justify-center rounded-card text-2xl text-gray-500 hover:bg-gray-100"
              aria-label="Close"
            >
              ×
            </button>
          </div>
          <div className="flex flex-1 flex-col">{children}</div>
        </div>
      </div>
    )
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 sm:items-center"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        {...(title ? { 'aria-label': title } : {})}
        className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-paper p-6 shadow-xl sm:rounded-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          {title ? <h2 className="text-lg font-semibold tracking-tight">{title}</h2> : <span />}
          <button
            type="button"
            onClick={onClose}
            className="flex min-h-11 min-w-11 items-center justify-center rounded-card text-2xl text-gray-500 hover:bg-gray-100"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
