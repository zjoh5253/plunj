/**
 * @plunj/api — tRPC 11 API layer for the PLUNJ booking platform.
 */

export { appRouter, createCaller } from './routers/index.js'
export type { AppRouter } from './routers/index.js'

export { createContext } from './context.js'
export type { Context, CreateContextOptions, StaffSession } from './context.js'

export { markOrderPaid, processWebhookEvent } from './webhooks.js'
export type { ProcessWebhookOptions, ProcessWebhookResult } from './webhooks.js'

export { DiscountRejectedError, buildQuote, toQuoteResponse } from './pricing.js'
export type {
  BuildQuoteInput,
  BuildQuoteResult,
  BuildQuoteSuccess,
  BuildQuoteFailure,
  CheckoutItemInput,
  DiscountRejectionReason,
  DraftDiscountInput,
  QuoteResponse,
} from './pricing.js'

export { createAuth, requiredAuthModels } from './auth.js'
export type { CreateAuthOptions, PlunjAuth } from './auth.js'

export { audit } from './audit.js'
export type { AuditInput } from './audit.js'

export { formatPhoneUS, normalizePhoneUS } from './phone.js'

export { WaiverUnsignedError } from './errors.js'
export { hashStaffPin, verifyStaffPin } from './staff-pin.js'
export type { DomainErrorCode, DomainErrorData } from './trpc.js'
