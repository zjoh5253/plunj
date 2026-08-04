/**
 * Typed notification template registry.
 *
 * Every template is registered against exactly one payload shape per channel, so
 * `renderSms('booking-confirmed', payload)` is a compile error unless `payload` matches the
 * template's declared type, and an unknown template name never typechecks.
 *
 * Invariant (CLAUDE.md #1): templates NEVER do money arithmetic. All money values arrive
 * pre-formatted as strings from the server, except `creditCents`, which is an integer amount
 * formatted (not computed) for display here.
 */

// ---------------------------------------------------------------------------
// Payload types
// ---------------------------------------------------------------------------

export interface BookingConfirmedPayload {
  firstName: string
  locationName: string
  dateTimeLocal: string
  seats: number
  manageUrl: string
  waiverUrl?: string
}

export interface BookingReminder24hPayload {
  firstName: string
  locationName: string
  dateTimeLocal: string
  unsignedCount: number
  waiverUrl?: string
}

export interface BookingReminder2hPayload {
  firstName: string
  locationName: string
  timeLocal: string
  arrivalNote?: string
}

export interface BookingCancelledPayload {
  firstName: string
  locationName: string
  dateTimeLocal: string
  creditCents?: number
}

export interface WaiverRequestPayload {
  guestName?: string
  locationName: string
  waiverUrl: string
}

export interface OtpCodePayload {
  code: string
}

export interface ReceiptLine {
  description: string
  qty: number
  amountFormatted: string
}

/** All money fields are pre-formatted strings — the server owns the arithmetic. */
export interface ReceiptPayload {
  firstName: string
  locationName: string
  lines: ReceiptLine[]
  subtotal: string
  discount: string
  tax: string
  tip: string
  total: string
  discountDescription?: string
}

// ---------------------------------------------------------------------------
// Registry types
// ---------------------------------------------------------------------------

export interface SmsTemplatePayloads {
  'booking-confirmed': BookingConfirmedPayload
  'booking-reminder-24h': BookingReminder24hPayload
  'booking-reminder-2h': BookingReminder2hPayload
  'booking-cancelled': BookingCancelledPayload
  'waiver-request': WaiverRequestPayload
  'otp-code': OtpCodePayload
}

export interface EmailTemplatePayloads {
  'booking-confirmed': BookingConfirmedPayload
  'booking-cancelled': BookingCancelledPayload
  receipt: ReceiptPayload
}

export type SmsTemplateName = keyof SmsTemplatePayloads
export type EmailTemplateName = keyof EmailTemplatePayloads
export type TemplateName = SmsTemplateName | EmailTemplateName

export interface EmailContent {
  subject: string
  html: string
  text: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Format an integer cent amount as "$XX.XX". Display formatting only — this is the one place a
 * cent integer meets a string, and no pricing math ever happens here.
 */
export function formatCents(cents: number): string {
  const abs = Math.abs(cents)
  const dollars = Math.trunc(abs / 100)
  const rem = String(abs % 100).padStart(2, '0')
  return `${cents < 0 ? '-' : ''}$${dollars}.${rem}`
}

function plural(n: number, singular: string, pluralWord: string): string {
  return n === 1 ? singular : pluralWord
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Minimal branded email shell. Black/white/gray, color only for semantic states. */
function emailShell(bodyHtml: string): string {
  return [
    '<div style="font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;color:#111;">',
    '<p style="font-size:14px;letter-spacing:0.2em;font-weight:700;margin:0 0 24px;">PLUNJ</p>',
    bodyHtml,
    '<p style="font-size:12px;color:#777;margin:32px 0 0;">PLUNJ &middot; cold plunge &amp; contrast therapy</p>',
    '</div>',
  ].join('\n')
}

// ---------------------------------------------------------------------------
// SMS templates
// ---------------------------------------------------------------------------

const smsTemplates: { [K in SmsTemplateName]: (payload: SmsTemplatePayloads[K]) => string } = {
  'booking-confirmed': (p) => {
    const lines = [
      `Hey ${p.firstName}, you're booked at PLUNJ ${p.locationName} — ${p.dateTimeLocal}, ` +
        `${p.seats} ${plural(p.seats, 'seat', 'seats')}.`,
      `Manage your booking: ${p.manageUrl}`,
    ]
    if (p.waiverUrl) lines.push(`One thing left — sign your waiver: ${p.waiverUrl}`)
    return lines.join('\n')
  },

  'booking-reminder-24h': (p) => {
    const lines = [
      `Hey ${p.firstName}, quick reminder — your plunge at PLUNJ ${p.locationName} is tomorrow, ` +
        `${p.dateTimeLocal}.`,
    ]
    if (p.unsignedCount > 0) {
      const who =
        p.unsignedCount === 1
          ? '1 of your group still needs to sign'
          : `${p.unsignedCount} of your group still need to sign`
      lines.push(p.waiverUrl ? `${who} the waiver: ${p.waiverUrl}` : `${who} the waiver.`)
    }
    return lines.join('\n')
  },

  'booking-reminder-2h': (p) => {
    const lines = [`Hey ${p.firstName}, see you at PLUNJ ${p.locationName} at ${p.timeLocal}.`]
    if (p.arrivalNote) lines.push(p.arrivalNote)
    return lines.join('\n')
  },

  'booking-cancelled': (p) => {
    const lines = [
      `Hey ${p.firstName}, your booking at PLUNJ ${p.locationName} for ${p.dateTimeLocal} ` +
        `has been cancelled.`,
    ]
    if (p.creditCents !== undefined) {
      lines.push(
        `A ${formatCents(p.creditCents)} credit is on your account for next time — ` +
          `it applies automatically at checkout.`,
      )
    }
    lines.push(`Hope to see you back in the water soon.`)
    return lines.join('\n')
  },

  'waiver-request': (p) => {
    const greeting = p.guestName ? `Hi ${p.guestName}, ` : `Hi, `
    return (
      `${greeting}you're joining a plunge at PLUNJ ${p.locationName}. ` +
      `Please sign your waiver before you arrive: ${p.waiverUrl}`
    )
  },

  'otp-code': (p) => `Your PLUNJ code: ${p.code}`,
}

// ---------------------------------------------------------------------------
// EMAIL templates
// ---------------------------------------------------------------------------

const emailTemplates: {
  [K in EmailTemplateName]: (payload: EmailTemplatePayloads[K]) => EmailContent
} = {
  'booking-confirmed': (p) => {
    const seats = `${p.seats} ${plural(p.seats, 'seat', 'seats')}`
    const waiverText = p.waiverUrl
      ? `\nOne thing left — sign your waiver before you arrive: ${p.waiverUrl}\n`
      : ''
    const waiverHtml = p.waiverUrl
      ? `<p style="font-size:15px;line-height:1.5;">One thing left — <a href="${escapeHtml(p.waiverUrl)}" style="color:#111;">sign your waiver</a> before you arrive.</p>`
      : ''
    return {
      subject: `You're booked — PLUNJ ${p.locationName}`,
      text:
        `Hey ${p.firstName},\n\n` +
        `You're booked at PLUNJ ${p.locationName}.\n\n` +
        `When: ${p.dateTimeLocal}\n` +
        `Seats: ${seats}\n\n` +
        `Manage your booking: ${p.manageUrl}\n` +
        waiverText +
        `\nSee you in the water.\nPLUNJ`,
      html: emailShell(
        `<h1 style="font-size:20px;margin:0 0 16px;">You're booked, ${escapeHtml(p.firstName)}.</h1>` +
          `<p style="font-size:15px;line-height:1.5;margin:0 0 16px;">` +
          `<strong>PLUNJ ${escapeHtml(p.locationName)}</strong><br>` +
          `${escapeHtml(p.dateTimeLocal)}<br>${escapeHtml(seats)}</p>` +
          `<p style="font-size:15px;line-height:1.5;"><a href="${escapeHtml(p.manageUrl)}" style="color:#111;">Manage your booking</a></p>` +
          waiverHtml +
          `<p style="font-size:15px;line-height:1.5;">See you in the water.</p>`,
      ),
    }
  },

  'booking-cancelled': (p) => {
    const creditText =
      p.creditCents !== undefined
        ? `\nA ${formatCents(p.creditCents)} credit is on your account for next time — it applies automatically at checkout.\n`
        : ''
    const creditHtml =
      p.creditCents !== undefined
        ? `<p style="font-size:15px;line-height:1.5;">A <strong>${formatCents(p.creditCents)}</strong> credit is on your account for next time — it applies automatically at checkout.</p>`
        : ''
    return {
      subject: `Your PLUNJ booking is cancelled — ${p.locationName}`,
      text:
        `Hey ${p.firstName},\n\n` +
        `Your booking at PLUNJ ${p.locationName} for ${p.dateTimeLocal} has been cancelled.\n` +
        creditText +
        `\nHope to see you back in the water soon.\nPLUNJ`,
      html: emailShell(
        `<h1 style="font-size:20px;margin:0 0 16px;">Booking cancelled</h1>` +
          `<p style="font-size:15px;line-height:1.5;">Hey ${escapeHtml(p.firstName)}, your booking at ` +
          `<strong>PLUNJ ${escapeHtml(p.locationName)}</strong> for ${escapeHtml(p.dateTimeLocal)} has been cancelled.</p>` +
          creditHtml +
          `<p style="font-size:15px;line-height:1.5;">Hope to see you back in the water soon.</p>`,
      ),
    }
  },

  receipt: (p) => {
    const discountLabel = p.discountDescription ? `Discount (${p.discountDescription})` : 'Discount'
    const textLines = p.lines
      .map((l) => `${l.qty} x ${l.description} — ${l.amountFormatted}`)
      .join('\n')
    const htmlRows = p.lines
      .map(
        (l) =>
          `<tr><td style="padding:6px 0;font-size:14px;">${l.qty} &times; ${escapeHtml(l.description)}</td>` +
          `<td style="padding:6px 0;font-size:14px;text-align:right;">${escapeHtml(l.amountFormatted)}</td></tr>`,
      )
      .join('')
    const totalsRow = (label: string, value: string, bold = false): string =>
      `<tr><td style="padding:4px 0;font-size:14px;${bold ? 'font-weight:700;' : 'color:#555;'}">${escapeHtml(label)}</td>` +
      `<td style="padding:4px 0;font-size:14px;text-align:right;${bold ? 'font-weight:700;' : ''}">${escapeHtml(value)}</td></tr>`
    return {
      subject: `Your PLUNJ receipt — ${p.locationName}`,
      text:
        `Hey ${p.firstName},\n\n` +
        `Thanks for plunging with us at PLUNJ ${p.locationName}. Here's your receipt.\n\n` +
        `${textLines}\n\n` +
        `Subtotal: ${p.subtotal}\n` +
        `${discountLabel}: ${p.discount}\n` +
        `Tax: ${p.tax}\n` +
        `Tip: ${p.tip}\n` +
        `Total: ${p.total}\n\n` +
        `See you next time.\nPLUNJ`,
      html: emailShell(
        `<h1 style="font-size:20px;margin:0 0 8px;">Your receipt</h1>` +
          `<p style="font-size:15px;line-height:1.5;margin:0 0 16px;">Thanks for plunging with us at ` +
          `<strong>PLUNJ ${escapeHtml(p.locationName)}</strong>, ${escapeHtml(p.firstName)}.</p>` +
          `<table style="width:100%;border-collapse:collapse;border-bottom:1px solid #ddd;">${htmlRows}</table>` +
          `<table style="width:100%;border-collapse:collapse;margin-top:8px;">` +
          totalsRow('Subtotal', p.subtotal) +
          totalsRow(discountLabel, p.discount) +
          totalsRow('Tax', p.tax) +
          totalsRow('Tip', p.tip) +
          totalsRow('Total', p.total, true) +
          `</table>`,
      ),
    }
  },
}

// ---------------------------------------------------------------------------
// Render API
// ---------------------------------------------------------------------------

/** Render an SMS template. Unknown template names or mismatched payloads are compile errors. */
export function renderSms<T extends SmsTemplateName>(
  template: T,
  payload: SmsTemplatePayloads[T],
): string {
  return smsTemplates[template](payload)
}

/** Render an EMAIL template. Unknown template names or mismatched payloads are compile errors. */
export function renderEmail<T extends EmailTemplateName>(
  template: T,
  payload: EmailTemplatePayloads[T],
): EmailContent {
  return emailTemplates[template](payload)
}

export function isSmsTemplate(name: string): name is SmsTemplateName {
  return Object.hasOwn(smsTemplates, name)
}

export function isEmailTemplate(name: string): name is EmailTemplateName {
  return Object.hasOwn(emailTemplates, name)
}
