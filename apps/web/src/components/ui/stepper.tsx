'use client'

export interface StepperProps {
  value: number
  min: number
  max: number
  onChange: (value: number) => void
  label?: string
}

const stepButton =
  'flex size-11 items-center justify-center rounded-full border border-gray-200 bg-white text-xl leading-none text-ink transition-colors hover:border-gray-400 active:bg-gray-50 disabled:opacity-30 disabled:pointer-events-none'

export function Stepper({ value, min, max, onChange, label }: StepperProps) {
  return (
    <div className="flex items-center gap-3">
      {label ? <span className="text-sm font-medium text-gray-700">{label}</span> : null}
      <button
        type="button"
        className={stepButton}
        onClick={() => onChange(value - 1)}
        disabled={value <= min}
        aria-label="Fewer guests"
      >
        −
      </button>
      <span className="min-w-6 text-center text-lg font-semibold tabular-nums" aria-live="polite">
        {value}
      </span>
      <button
        type="button"
        className={stepButton}
        onClick={() => onChange(value + 1)}
        disabled={value >= max}
        aria-label="More guests"
      >
        +
      </button>
    </div>
  )
}
