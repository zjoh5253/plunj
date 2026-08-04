/**
 * US phone canonicalization. EVERY phone the platform stores or compares goes
 * through normalizePhoneUS first — one customer, one phone, ONE storage form
 * (E.164 "+18018422358"). Anything else splits customer identity by format.
 */

/**
 * Normalize any reasonable US phone entry to E.164 "+1XXXXXXXXXX".
 * - "(801) 842-2358" / "8018422358"  → "+18018422358"
 * - "1 801 842 2358" / "18018422358" → "+18018422358"
 * - "+18018422358"                   → unchanged
 * - anything else                    → null
 */
export function normalizePhoneUS(input: string): string | null {
  const digits = input.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return null
}

/** E.164 "+18018422358" → "(801) 842-2358". Non-canonical input is returned unchanged. */
export function formatPhoneUS(e164: string): string {
  const match = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164)
  if (!match) return e164
  return `(${match[1]}) ${match[2]}-${match[3]}`
}
