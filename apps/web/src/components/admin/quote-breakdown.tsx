/**
 * Read-only quote breakdown for the admin discount preview — visually
 * identical to the customer checkout Breakdown (same fields, same order:
 * lines → discount → subtotal → tax → tip → total), consuming the same
 * server QuoteResponse shape. The checkout component is file-local to
 * checkout-client.tsx, so this is a faithful copy, not a fork: every cent is
 * rendered verbatim from the server quote (invariant #1).
 */

import { Card } from '@/components/ui/card'
import type { ServerQuote } from '@/lib/api-types'
import { formatCents } from '@/lib/format'

export function QuoteBreakdown({
  quote,
  requoting,
  codeRejection,
}: {
  quote: ServerQuote | undefined
  requoting: boolean
  codeRejection: string | null
}) {
  return (
    <Card
      className={`flex flex-col gap-2 transition-opacity duration-200 ${requoting ? 'opacity-60' : ''}`}
    >
      <h2 className="text-sm font-medium uppercase tracking-wide text-gray-500">Total</h2>
      <div className="flex min-h-24 flex-col gap-1.5 text-sm">
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
                animateIn
              />
            ) : null}
            <Row label="Subtotal" value={formatCents(quote.subtotalCents)} muted />
            <Row label="Tax" value={formatCents(quote.taxCents)} muted />
            {quote.tipCents > 0 ? (
              <Row label="Tip" value={formatCents(quote.tipCents)} muted animateIn />
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
      {/* Reserved warn-row space: quiet, verbatim API message */}
      <div className="min-h-5" aria-live="polite">
        {codeRejection ? <p className="text-sm text-warn">{codeRejection}</p> : null}
      </div>
    </Card>
  )
}

function Row({
  label,
  value,
  muted = false,
  tone,
  animateIn = false,
}: {
  label: string
  value: string
  muted?: boolean
  tone?: 'ok'
  animateIn?: boolean
}) {
  return (
    <div
      className={`flex items-baseline justify-between gap-4 ${
        animateIn ? 'animate-[fadeSlideIn_200ms_ease-out]' : ''
      }`}
    >
      <span className={tone === 'ok' ? 'text-ok' : muted ? 'text-gray-500' : 'text-ink'}>
        {label}
      </span>
      <span
        className={`tabular-nums ${tone === 'ok' ? 'text-ok' : muted ? 'text-gray-500' : 'text-ink'}`}
      >
        {value}
      </span>
    </div>
  )
}
