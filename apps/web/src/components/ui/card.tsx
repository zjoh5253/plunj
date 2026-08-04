import type { HTMLAttributes } from 'react'

export function Card({ className = '', ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`rounded-card border border-gray-100 bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,0.03)] ${className}`}
      {...rest}
    />
  )
}
