import { randomBytes } from 'node:crypto'

/** Unguessable token for magic-link booking management (Booking.manageToken). */
export function newManageToken(): string {
  return randomBytes(24).toString('base64url')
}
