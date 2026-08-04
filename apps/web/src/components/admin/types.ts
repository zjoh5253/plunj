/**
 * Type-only projections of the admin router wire shapes (Dates are ISO strings
 * on the wire). Kept inside components/admin — src/lib is shared with the desk
 * surface and read-only for this area.
 */

import type { AppRouter } from '@plunj/api'
import type { inferRouterInputs, inferRouterOutputs } from '@trpc/server'

export type RouterOutputs = inferRouterOutputs<AppRouter>
export type RouterInputs = inferRouterInputs<AppRouter>

export type AdminDashboardToday = RouterOutputs['admin']['dashboard']['today']
export type AdminTemplate = RouterOutputs['admin']['schedule']['templates']['list'][number]
export type AdminClosureResult = RouterOutputs['admin']['schedule']['closures']
export type AdminApplyChangesResult = RouterOutputs['admin']['schedule']['applyChanges']
export type AdminDiscount = RouterOutputs['admin']['discounts']['list'][number]
export type AdminTeamMember = RouterOutputs['admin']['team']['list'][number]
export type AdminWaiverPublishResult = RouterOutputs['admin']['waivers']['publish']
export type AdminQuotePreview = RouterOutputs['admin']['discounts']['preview']

/** Draft-mode preview input — inferred from the router so it can never drift. */
export type DiscountDraftInput = NonNullable<RouterInputs['admin']['discounts']['preview']['draft']>

export type TemplateCreateInput = RouterInputs['admin']['schedule']['templates']['create']
export type TemplateUpdateInput = RouterInputs['admin']['schedule']['templates']['update']
export type DiscountCreateInput = RouterInputs['admin']['discounts']['create']
export type DiscountUpdateInput = RouterInputs['admin']['discounts']['update']
