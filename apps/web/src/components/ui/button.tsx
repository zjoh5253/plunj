import type { ButtonHTMLAttributes } from 'react'
import { Spinner } from './spinner'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'md' | 'lg'

const base =
  'inline-flex items-center justify-center gap-2 rounded-card font-medium tracking-tight transition-colors duration-150 select-none disabled:opacity-40 disabled:pointer-events-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink'

const variants: Record<Variant, string> = {
  primary: 'bg-ink text-paper hover:bg-gray-800 active:bg-gray-900',
  secondary: 'border border-gray-200 bg-white text-ink hover:border-gray-400 active:bg-gray-50',
  ghost: 'text-ink hover:bg-gray-100 active:bg-gray-200',
  danger: 'border border-gray-200 bg-white text-danger hover:border-danger/40 active:bg-gray-50',
}

// 44px minimum tap target (thumb-reachable, mobile-first).
const sizes: Record<Size, string> = {
  md: 'min-h-11 px-4 text-sm',
  lg: 'min-h-13 px-6 text-base w-full',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  loading?: boolean
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  className = '',
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`${base} ${variants[variant]} ${sizes[size]} ${className}`}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <Spinner className="size-4" /> : null}
      {children}
    </button>
  )
}
