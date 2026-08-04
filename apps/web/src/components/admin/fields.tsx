/**
 * Small form primitives the shared ui/ set doesn't have (Select, Textarea) —
 * built here because src/components/ui is shared with the desk surface and
 * read-only for the admin build. Styling mirrors ui/input.tsx exactly.
 */

import type { SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'
import { useId } from 'react'

const fieldClasses =
  'min-h-11 rounded-card border border-gray-200 bg-white px-3.5 text-base text-ink placeholder:text-gray-400 focus:outline-2 focus:-outline-offset-1 focus:outline-ink'

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
  hint?: string
}

export function Select({ label, hint, className = '', id, children, ...rest }: SelectProps) {
  const autoId = useId()
  const selectId = id ?? autoId
  return (
    <div className="flex flex-col gap-1.5">
      {label ? (
        <label htmlFor={selectId} className="text-sm font-medium text-gray-700">
          {label}
        </label>
      ) : null}
      <select id={selectId} className={`${fieldClasses} ${className}`} {...rest}>
        {children}
      </select>
      {hint ? <p className="text-sm text-gray-500">{hint}</p> : null}
    </div>
  )
}

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string
  hint?: string
}

export function Textarea({ label, hint, className = '', id, ...rest }: TextareaProps) {
  const autoId = useId()
  const areaId = id ?? autoId
  return (
    <div className="flex flex-col gap-1.5">
      {label ? (
        <label htmlFor={areaId} className="text-sm font-medium text-gray-700">
          {label}
        </label>
      ) : null}
      <textarea
        id={areaId}
        className={`rounded-card border border-gray-200 bg-white px-3.5 py-2.5 text-base leading-relaxed text-ink placeholder:text-gray-400 focus:outline-2 focus:-outline-offset-1 focus:outline-ink ${className}`}
        {...rest}
      />
      {hint ? <p className="text-sm text-gray-500">{hint}</p> : null}
    </div>
  )
}
