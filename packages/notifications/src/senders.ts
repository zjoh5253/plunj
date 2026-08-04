/**
 * Channel senders. Real implementations wrap Twilio (SMS) and Resend (email); fakes capture
 * messages in memory for tests. drain.ts only knows the interfaces.
 */

import twilio from 'twilio'
import { Resend } from 'resend'
import type { EmailContent } from './templates.js'

export interface SmsSender {
  sendSms(to: string, body: string): Promise<void>
}

export interface EmailSender {
  sendEmail(to: string, content: EmailContent): Promise<void>
}

// ---------------------------------------------------------------------------
// Twilio
// ---------------------------------------------------------------------------

export interface TwilioSmsSenderOptions {
  accountSid?: string
  authToken?: string
  fromNumber?: string
}

export class TwilioSmsSender implements SmsSender {
  private readonly client: twilio.Twilio
  private readonly from: string

  constructor(options: TwilioSmsSenderOptions = {}) {
    const accountSid = options.accountSid ?? process.env.TWILIO_ACCOUNT_SID
    const authToken = options.authToken ?? process.env.TWILIO_AUTH_TOKEN
    const from = options.fromNumber ?? process.env.TWILIO_FROM_NUMBER
    if (!accountSid || !authToken) {
      throw new Error('TwilioSmsSender: TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN are required')
    }
    if (!from) {
      throw new Error('TwilioSmsSender: TWILIO_FROM_NUMBER is required')
    }
    this.client = twilio(accountSid, authToken)
    this.from = from
  }

  async sendSms(to: string, body: string): Promise<void> {
    await this.client.messages.create({ to, from: this.from, body })
  }
}

// ---------------------------------------------------------------------------
// Resend
// ---------------------------------------------------------------------------

export const PLUNJ_EMAIL_FROM = 'PLUNJ <bookings@plunj.co>'

export interface ResendEmailSenderOptions {
  apiKey?: string
  from?: string
}

export class ResendEmailSender implements EmailSender {
  private readonly client: Resend
  private readonly from: string

  constructor(options: ResendEmailSenderOptions = {}) {
    const apiKey = options.apiKey ?? process.env.RESEND_API_KEY
    if (!apiKey) {
      throw new Error('ResendEmailSender: RESEND_API_KEY is required')
    }
    this.client = new Resend(apiKey)
    this.from = options.from ?? PLUNJ_EMAIL_FROM
  }

  async sendEmail(to: string, content: EmailContent): Promise<void> {
    const { error } = await this.client.emails.send({
      from: this.from,
      to,
      subject: content.subject,
      html: content.html,
      text: content.text,
    })
    if (error) {
      throw new Error(`ResendEmailSender: ${error.name}: ${error.message}`)
    }
  }
}

// ---------------------------------------------------------------------------
// Fakes (tests)
// ---------------------------------------------------------------------------

export interface FakeSentSms {
  to: string
  body: string
}

export class FakeSmsSender implements SmsSender {
  readonly sent: FakeSentSms[] = []
  /** When set, returns an error to throw for a given recipient (or null to send normally). */
  failWith: ((to: string, body: string) => Error | null) | null = null

  async sendSms(to: string, body: string): Promise<void> {
    const error = this.failWith?.(to, body)
    if (error) throw error
    this.sent.push({ to, body })
  }
}

export interface FakeSentEmail extends EmailContent {
  to: string
}

export class FakeEmailSender implements EmailSender {
  readonly sent: FakeSentEmail[] = []
  failWith: ((to: string, content: EmailContent) => Error | null) | null = null

  async sendEmail(to: string, content: EmailContent): Promise<void> {
    const error = this.failWith?.(to, content)
    if (error) throw error
    this.sent.push({ to, ...content })
  }
}
