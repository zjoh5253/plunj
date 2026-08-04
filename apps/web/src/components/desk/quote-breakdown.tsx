'use client'

/**
 * Verbatim renderer for a server quote — the desk twin of the customer
 * checkout breakdown. Every cent comes from the server quote object; there is
 * NO client-side money arithmetic here (invariant #1).
 */

import { Card } from '@/components/ui/card'
import type { ServerQuote } from '@/lib/api-types'
import { formatCents } from '@/lib/format'

export function QuoteBreakdown({
  quote,
  requoting = false,
  rejection = null,
}: {
  quote: ServerQuote | undefined
  requoting?: boolean
  rejection?: string | null
}) {
  return (
    <Card
      className={`flex flex-col gap-2 transition-opacity duration-200 ${requoting ? 'opacity-60' : ''}`}
    >
      <h3 className="text-sm font-medium uppercase tracking-wide text-gray-500">Total</h3>
      <div className="flex min-h-20 flex-col gap-1.5 text-sm">
        {quote ? (
          <>
            {quote.lines.map((line) => (
              <Row
                key={line.id}
                label={`${line.description}${line.qty > 1 ? ` × ${line.qty}` : ''}`}
                value={formatCents(line.lineSubtotalCents)}
              />
            ))}
            {quote.discountCents > 0 ? (
              <Row
                label={quote.discountDescription ?? 'Discount'}
                value={formatCents(-quote.discountCents)}
                tone="ok"
              />
            ) : null}
            <Row label="Subtotal" value={formatCents(quote.subtotalCents)} muted />
            <Row label="Tax" value={formatCents(quote.taxCents)} muted />
            {quote.tipCents > 0 ? (
              <Row label="Tip" value={formatCents(quote.tipCents)} muted />
            ) : null}
            <div className="my-1 border-t border-gray-100" />
            <div className="flex items-baseline justify-between">
              <span className="text-base font-semibold">Total</span>
              <span className="text-base font-semibold tabular-nums">
                {formatCents(quote.totalCents)}
              </span>
            </div>
          </>
        ) : (
          <p className="text-gray-400">Calculating…</p>
        )}
      </div>
      <div className="min-h-5" aria-live="polite">
        {rejection ? <p className="text-sm text-warn">{rejection}</p> : null}
      </div>
    </Card>
  )
}

function Row({
  label,
  value,
  muted = false,
  tone,
}: {
  label: string
  value: string
  muted?: boolean
  tone?: 'ok'
}) {
  const color = tone === 'ok' ? 'text-ok' : muted ? 'text-gray-500' : 'text-ink'
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className={color}>{label}</span>
      <span className={`tabular-nums ${color}`}>{value}</span>
    </div>
  )
}
