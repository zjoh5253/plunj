/**
 * Display formatting helpers (CLAUDE.md invariant #5: render in the LOCATION's
 * IANA timezone, never the browser's). Pure Intl — no timezone library, no
 * money arithmetic.
 */

/** "Tue Aug 11, 6:00 PM" in the location's timezone. */
export function formatSessionMoment(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).formatToParts(instant)
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? ''
  return `${get('weekday')} ${get('month')} ${get('day')}, ${get('hour')}:${get('minute')} ${get('dayPeriod')}`
}

/** "6:00 PM" in the location's timezone. */
export function formatTimeOfDay(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).formatToParts(instant)
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? ''
  return `${get('hour')}:${get('minute')} ${get('dayPeriod')}`
}

/** Local calendar date "YYYY-MM-DD" of a UTC instant in the given timezone. */
export function localDateKey(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant)
}

/** ISO-8601 string for API responses — Dates never cross the wire as objects. */
export function iso(instant: Date): string {
  return instant.toISOString()
}

export function isoOrNull(instant: Date | null | undefined): string | null {
  return instant ? instant.toISOString() : null
}
