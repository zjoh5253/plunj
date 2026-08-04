export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-card bg-gray-100 ${className}`} aria-hidden />
}
