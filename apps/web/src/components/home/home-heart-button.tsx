'use client'

/**
 * Heart toggle marking a location as the visitor's home studio. Outline when
 * inactive, filled ink when active; 44px tap target. Never triggers a parent
 * card link — clicks are stopped and default-prevented.
 */

export function HomeHeartButton({
  active,
  locationName,
  onToggle,
  className,
}: {
  active: boolean
  locationName: string
  onToggle: () => void
  className?: string
}) {
  const label = active
    ? `Remove ${locationName} as your home studio`
    : `Make ${locationName} your home studio`
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onToggle()
      }}
      className={`flex size-11 shrink-0 items-center justify-center rounded-full text-ink transition-colors hover:bg-gray-100 active:bg-gray-200 ${className ?? ''}`}
    >
      <svg
        aria-hidden
        viewBox="0 0 24 24"
        className="size-5"
        fill={active ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
      </svg>
    </button>
  )
}
