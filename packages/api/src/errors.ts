/** API-level domain errors (availability's live in @plunj/availability). */

/** Check-in blocked: the attendee has not signed the current liability waiver. */
export class WaiverUnsignedError extends Error {
  readonly bookingId: string

  constructor(bookingId: string) {
    super('The current liability waiver has not been signed for this booking')
    this.name = 'WaiverUnsignedError'
    this.bookingId = bookingId
  }
}
