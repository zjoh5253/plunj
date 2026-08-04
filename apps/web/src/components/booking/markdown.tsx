/**
 * Tiny markdown renderer for waiver documents (headings, lists, paragraphs,
 * **bold**). No dependency, no raw HTML pass-through.
 */

import type { ReactNode } from 'react'

function inline(text: string): ReactNode[] {
  return text
    .split(/(\*\*[^*]+\*\*)/g)
    .map((part, i) =>
      part.startsWith('**') && part.endsWith('**') ? (
        <strong key={i}>{part.slice(2, -2)}</strong>
      ) : (
        part
      ),
    )
}

export function Markdown({ source }: { source: string }) {
  const blocks = source.replace(/\r\n/g, '\n').split(/\n{2,}/)
  return (
    <div className="flex flex-col gap-3 text-sm leading-relaxed text-gray-700">
      {blocks.map((block, i) => {
        const trimmed = block.trim()
        if (trimmed === '') return null
        if (trimmed.startsWith('### '))
          return (
            <h4 key={i} className="font-semibold text-ink">
              {inline(trimmed.slice(4))}
            </h4>
          )
        if (trimmed.startsWith('## '))
          return (
            <h3 key={i} className="text-base font-semibold text-ink">
              {inline(trimmed.slice(3))}
            </h3>
          )
        if (trimmed.startsWith('# '))
          return (
            <h2 key={i} className="text-lg font-semibold tracking-tight text-ink">
              {inline(trimmed.slice(2))}
            </h2>
          )
        const lines = trimmed.split('\n')
        if (lines.every((l) => l.trim().startsWith('- ')))
          return (
            <ul key={i} className="flex list-disc flex-col gap-1 pl-5">
              {lines.map((l, j) => (
                <li key={j}>{inline(l.trim().slice(2))}</li>
              ))}
            </ul>
          )
        return <p key={i}>{inline(trimmed)}</p>
      })}
    </div>
  )
}
