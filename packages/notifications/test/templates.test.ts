import { describe, expect, it } from 'vitest'
import { formatCents, renderEmail, renderSms } from '../src/index.js'
import type { ReceiptPayload } from '../src/index.js'

const confirmed = {
  firstName: 'Maya',
  locationName: 'Provo',
  dateTimeLocal: 'Sat, Aug 9 at 7:00 AM',
  seats: 3,
  manageUrl: 'https://plunj.co/book/manage/abc123',
}

describe('SMS templates', () => {
  it('booking-confirmed without waiver', () => {
    expect(renderSms('booking-confirmed', confirmed)).toMatchSnapshot()
  })

  it('booking-confirmed with waiver link', () => {
    const body = renderSms('booking-confirmed', {
      ...confirmed,
      waiverUrl: 'https://plunj.co/book/waiver/abc123',
    })
    expect(body).toContain('One thing left — sign your waiver: https://plunj.co/book/waiver/abc123')
    expect(body).toMatchSnapshot()
  })

  it('booking-confirmed singular seat', () => {
    const body = renderSms('booking-confirmed', { ...confirmed, seats: 1 })
    expect(body).toContain('1 seat.')
    expect(body).not.toContain('1 seats')
  })

  it('booking-reminder-24h with unsigned waivers', () => {
    const body = renderSms('booking-reminder-24h', {
      firstName: 'Maya',
      locationName: 'Provo',
      dateTimeLocal: 'Sat, Aug 9 at 7:00 AM',
      unsignedCount: 2,
      waiverUrl: 'https://plunj.co/book/waiver/abc123',
    })
    expect(body).toContain('2 of your group still need to sign')
    expect(body).toMatchSnapshot()
  })

  it('booking-reminder-24h with everyone signed omits waiver line', () => {
    const body = renderSms('booking-reminder-24h', {
      firstName: 'Maya',
      locationName: 'Provo',
      dateTimeLocal: 'Sat, Aug 9 at 7:00 AM',
      unsignedCount: 0,
    })
    expect(body).not.toContain('still need')
    expect(body).not.toContain('waiver')
    expect(body).toMatchSnapshot()
  })

  it('booking-reminder-24h singular unsigned', () => {
    const body = renderSms('booking-reminder-24h', {
      firstName: 'Maya',
      locationName: 'Provo',
      dateTimeLocal: 'Sat, Aug 9 at 7:00 AM',
      unsignedCount: 1,
    })
    expect(body).toContain('1 of your group still needs to sign')
  })

  it('booking-reminder-2h with arrival note', () => {
    const body = renderSms('booking-reminder-2h', {
      firstName: 'Maya',
      locationName: 'Provo',
      timeLocal: '7:00 AM',
      arrivalNote: 'Park behind the building and come in the side door.',
    })
    expect(body).toMatchSnapshot()
  })

  it('booking-reminder-2h without arrival note', () => {
    expect(
      renderSms('booking-reminder-2h', {
        firstName: 'Maya',
        locationName: 'Provo',
        timeLocal: '7:00 AM',
      }),
    ).toMatchSnapshot()
  })

  it('booking-cancelled with credit formats cents as $XX.XX', () => {
    const body = renderSms('booking-cancelled', {
      firstName: 'Maya',
      locationName: 'Provo',
      dateTimeLocal: 'Sat, Aug 9 at 7:00 AM',
      creditCents: 2500,
    })
    expect(body).toContain('$25.00 credit')
    expect(body).toMatchSnapshot()
  })

  it('booking-cancelled without credit omits credit line', () => {
    const body = renderSms('booking-cancelled', {
      firstName: 'Maya',
      locationName: 'Provo',
      dateTimeLocal: 'Sat, Aug 9 at 7:00 AM',
    })
    expect(body).not.toContain('credit')
    expect(body).toMatchSnapshot()
  })

  it('waiver-request with and without guest name', () => {
    expect(
      renderSms('waiver-request', {
        guestName: 'Jonah',
        locationName: 'Provo',
        waiverUrl: 'https://plunj.co/book/waiver/xyz',
      }),
    ).toMatchSnapshot()
    expect(
      renderSms('waiver-request', {
        locationName: 'Provo',
        waiverUrl: 'https://plunj.co/book/waiver/xyz',
      }),
    ).toMatchSnapshot()
  })

  it('otp-code', () => {
    expect(renderSms('otp-code', { code: '123456' })).toBe('Your PLUNJ code: 123456')
  })
})

describe('EMAIL templates', () => {
  it('booking-confirmed with waiver', () => {
    const email = renderEmail('booking-confirmed', {
      ...confirmed,
      waiverUrl: 'https://plunj.co/book/waiver/abc123',
    })
    expect(email.subject).toBe("You're booked — PLUNJ Provo")
    expect(email).toMatchSnapshot()
  })

  it('booking-confirmed without waiver has no waiver mention', () => {
    const email = renderEmail('booking-confirmed', confirmed)
    expect(email.text).not.toContain('waiver')
    expect(email.html).not.toContain('waiver')
    expect(email).toMatchSnapshot()
  })

  it('booking-cancelled with credit', () => {
    const email = renderEmail('booking-cancelled', {
      firstName: 'Maya',
      locationName: 'Provo',
      dateTimeLocal: 'Sat, Aug 9 at 7:00 AM',
      creditCents: 1050,
    })
    expect(email.text).toContain('$10.50 credit')
    expect(email.html).toContain('$10.50')
    expect(email).toMatchSnapshot()
  })

  it('receipt', () => {
    const payload: ReceiptPayload = {
      firstName: 'Maya',
      locationName: 'Provo',
      lines: [
        { description: 'Communal plunge', qty: 2, amountFormatted: '$50.00' },
        { description: 'Sauna add-on', qty: 1, amountFormatted: '$15.00' },
      ],
      subtotal: '$65.00',
      discount: '-$6.50',
      tax: '$4.68',
      tip: '$10.00',
      total: '$73.18',
      discountDescription: '10% founders club',
    }
    expect(renderEmail('receipt', payload)).toMatchSnapshot()
  })

  it('receipt passes money strings through untouched (no arithmetic)', () => {
    // Deliberately inconsistent strings — if the template did any math or re-formatting,
    // these would not survive verbatim.
    const payload: ReceiptPayload = {
      firstName: 'Maya',
      locationName: 'Provo',
      lines: [{ description: 'Buyout', qty: 1, amountFormatted: 'CHF 1,234.56' }],
      subtotal: 'CHF 1,234.56',
      discount: '-CHF 0.99',
      tax: 'CHF 77.77',
      tip: 'CHF 0.00',
      total: 'CHF 9,999.99',
    }
    const email = renderEmail('receipt', payload)
    for (const value of ['CHF 1,234.56', '-CHF 0.99', 'CHF 77.77', 'CHF 0.00', 'CHF 9,999.99']) {
      expect(email.text).toContain(value)
      expect(email.html).toContain(value)
    }
    // No discountDescription — plain "Discount" label.
    expect(email.text).toContain('Discount: -CHF 0.99')
  })

  it('escapes html in user-provided strings', () => {
    const email = renderEmail('booking-confirmed', {
      ...confirmed,
      firstName: '<script>alert(1)</script>',
    })
    expect(email.html).not.toContain('<script>')
    expect(email.html).toContain('&lt;script&gt;')
  })
})

describe('formatCents', () => {
  it('formats cent integers for display', () => {
    expect(formatCents(0)).toBe('$0.00')
    expect(formatCents(5)).toBe('$0.05')
    expect(formatCents(2500)).toBe('$25.00')
    expect(formatCents(12345)).toBe('$123.45')
    expect(formatCents(-150)).toBe('-$1.50')
  })
})
