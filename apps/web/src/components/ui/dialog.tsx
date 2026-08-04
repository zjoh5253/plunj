'use client'

import { useEffect } from 'react'

export interface DialogProps {
  open: boolean
  onClose: () => void
  title?: string
  children: React.ReactNode
}

/** Minimal centered dialog / bottom sheet (sheet on small screens). */
export function Dialog({ open, onClose, title, children }: DialogProps) {
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
        className="w-full max-w-md rounded-t-2xl bg-paper p-6 shadow-xl sm:rounded-card"
        onClick={(e) => e.stopPropagation()}
      >
        {title ? <h2 className="mb-3 text-lg font-semibold tracking-tight">{title}</h2> : null}
        {children}
      </div>
    </div>
  )
}
