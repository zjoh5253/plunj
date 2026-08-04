/**
 * Display-only formatting helpers. Pure Intl — the UI NEVER computes money
 * (CLAUDE.md invariant #1); every cent rendered here came verbatim from a
 * server quote/order. Times render in the LOCATION's IANA timezone, never the
 * browser's (invariant #5).
 */

const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
})

/** 4500 → "$45.00"; -500 → "−$5.00" (typographic minus). */
export function formatCents(cents: number): string {
  if (cents < 0) return `−${usd.format(Math.abs(cents) / 100)}`
  return usd.format(cents / 100)
}

function parts(instant: Date, timeZone: string, options: Intl.DateTimeFormatOptions) {
  const list = new Intl.DateTimeFormat('en-US', { timeZone, ...options }).formatToParts(instant)
  return (type: Intl.DateTimeFormatPartTypes): string =>
    list.find((p) => p.type === type)?.value ?? ''
}

/** ISO instant → "6:00 PM" in the location's timezone. */
export function formatTimeOfDay(iso: string, timeZone: string): string {
  const get = parts(new Date(iso), timeZone, { hour: 'numeric', minute: '2-digit', hour12: true })
  return `${get('hour')}:${get('minute')} ${get('dayPeriod')}`
}

/** ISO instant → "Tue Aug 11, 6:00 PM" in the location's timezone. */
export function formatSessionMoment(iso: string, timeZone: string): string {
  const get = parts(new Date(iso), timeZone, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
  return `${get('weekday')} ${get('month')} ${get('day')}, ${get('hour')}:${get('minute')} ${get('dayPeriod')}`
}

/** Local calendar date "YYYY-MM-DD" of an instant in the given timezone. */
export function localDateKey(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant)
}

/** "YYYY-MM-DD" (already a location-local calendar date) → { weekday: "Tue", day: "11", month: "Aug" }. */
export function dateKeyParts(dateKey: string): { weekday: string; day: string; month: string } {
  // Noon UTC + UTC rendering keeps the calendar date stable for any zone.
  const get = parts(new Date(`${dateKey}T12:00:00Z`), 'UTC', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
  return { weekday: get('weekday'), day: get('day'), month: get('month') }
}

/** "YYYY-MM-DD" → "Tuesday, August 11". */
export function formatDateKeyLong(dateKey: string): string {
  const get = parts(new Date(`${dateKey}T12:00:00Z`), 'UTC', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })
  return `${get('weekday')}, ${get('month')} ${get('day')}`
}

/** The next `count` location-local calendar dates starting today. */
export function upcomingDateKeys(
  timeZone: string,
  count: number,
  from: Date = new Date(),
): string[] {
  const keys: string[] = []
  for (let i = 0; i < count; i += 1) {
    keys.push(localDateKey(new Date(from.getTime() + i * 86_400_000), timeZone))
  }
  // DST shifts can duplicate a key at the boundary — dedupe, keep order.
  return [...new Set(keys)]
}

/**
 * E.164 "+18018422358" → "(801) 842-2358" for display. Non-canonical input is
 * returned unchanged. Mirrors @plunj/api's formatPhoneUS (local copy — pulling
 * the API package's runtime into client bundles would drag server deps along).
 * Keep tel: links on the raw E.164 value; only the visible text is formatted.
 */
export function formatPhoneUS(e164: string): string {
  const match = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164)
  if (!match) return e164
  return `(${match[1]}) ${match[2]}-${match[3]}`
}

/** Milliseconds → "9:58" countdown text (never negative). */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}
