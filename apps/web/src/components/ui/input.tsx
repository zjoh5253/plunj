import type { InputHTMLAttributes } from 'react'
import { useId } from 'react'

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  hint?: string
  error?: string
}

export function Input({ label, hint, error, className = '', id, ...rest }: InputProps) {
  const autoId = useId()
  const inputId = id ?? autoId
  return (
    <div className="flex flex-col gap-1.5">
      {label ? (
        <label htmlFor={inputId} className="text-sm font-medium text-gray-700">
          {label}
        </label>
      ) : null}
      <input
        id={inputId}
        className={`min-h-11 rounded-card border bg-white px-3.5 text-base text-ink placeholder:text-gray-400 focus:outline-2 focus:-outline-offset-1 focus:outline-ink ${
          error ? 'border-danger' : 'border-gray-200'
        } ${className}`}
        aria-invalid={error ? true : undefined}
        {...rest}
      />
      {error ? (
        <p className="text-sm text-danger">{error}</p>
      ) : hint ? (
        <p className="text-sm text-gray-500">{hint}</p>
      ) : null}
    </div>
  )
}
