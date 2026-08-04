/**
 * POS PIN hashing for StaffUser.pin — never store plaintext. scrypt with a
 * per-pin random salt, constant-time compare. Format: "scrypt:<salt>:<hash>".
 */

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

export function hashStaffPin(pin: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(pin, salt, 32).toString('hex')
  return `scrypt:${salt}:${hash}`
}

export function verifyStaffPin(pin: string, stored: string | null | undefined): boolean {
  if (!stored) return false
  const [scheme, salt, hash] = stored.split(':')
  if (scheme !== 'scrypt' || !salt || !hash) return false
  const expected = Buffer.from(hash, 'hex')
  const candidate = scryptSync(pin, salt, expected.length)
  return timingSafeEqual(candidate, expected)
}
