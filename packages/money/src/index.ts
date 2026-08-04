/**
 * @plunj/money — the pricing kernel.
 *
 * The ONLY place money arithmetic happens. Pure, deterministic, zero runtime
 * dependencies, no I/O, no clocks, no floating point on any money path.
 * All amounts are integer cents.
 *
 * Pipeline (fixed order): line subtotals → discount (computed ONCE on the
 * eligible subtotal, allocated largest-remainder) → per-line tax → tip.
 * Round-half-up happens at exactly two points: the discount total and each
 * line's tax.
 */

export const PRICING_VERSION = 'v1'

export type LineKind =
  'DROP_IN' | 'BUYOUT' | 'MEMBERSHIP_CYCLE' | 'PACK' | 'GIFT_CARD' | 'RETAIL' | 'FEE'

export type DiscountType = 'PERCENT' | 'FIXED_CENTS'

export interface QuoteLineInput {
  id: string
  kind: LineKind
  description: string
  /** Positive integer. */
  qty: number
  /** Non-negative integer cents. */
  unitPriceCents: number
  taxable: boolean
  discountEligible: boolean
}

export interface DiscountInput {
  id: string
  code: string
  type: DiscountType
  /** Basis points, 1..10000 (5000 = 50%). Required when type is PERCENT. */
  valueBps?: number
  /** Positive integer cents. Required when type is FIXED_CENTS. */
  valueCents?: number
}

export interface QuoteInput {
  lines: QuoteLineInput[]
  discount?: DiscountInput
  /** Basis points, 0..3000. */
  taxRateBps: number
  /** Non-negative integer cents. */
  tipCents?: number
}

export interface QuoteLine extends QuoteLineInput {
  lineSubtotalCents: number
  discountAllocatedCents: number
  taxCents: number
  lineTotalCents: number
}

export interface Quote {
  pricingVersion: string
  lines: QuoteLine[]
  subtotalCents: number
  discountCents: number
  /** Human-readable, e.g. "20% off" / "$5.00 off". Null when no discount. */
  discountDescription: string | null
  taxCents: number
  tipCents: number
  totalCents: number
}

export class MoneyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MoneyError'
  }
}

const LINE_KINDS: readonly LineKind[] = [
  'DROP_IN',
  'BUYOUT',
  'MEMBERSHIP_CYCLE',
  'PACK',
  'GIFT_CARD',
  'RETAIL',
  'FEE',
]

function assertInteger(value: number, name: string): void {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new MoneyError(`${name} must be a safe integer, got ${String(value)}`)
  }
}

function assertNonNegativeInteger(value: number, name: string): void {
  assertInteger(value, name)
  if (value < 0) {
    throw new MoneyError(`${name} must be non-negative, got ${String(value)}`)
  }
}

function assertPositiveInteger(value: number, name: string): void {
  assertInteger(value, name)
  if (value < 1) {
    throw new MoneyError(`${name} must be a positive integer, got ${String(value)}`)
  }
}

function toSafeNumber(value: bigint, name: string): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new MoneyError(`${name} exceeds the maximum safe integer amount`)
  }
  return Number(value)
}

/**
 * Round-half-up of the rational (amount × num) / den using integer arithmetic
 * only. All money-path rounding in this package goes through here.
 *
 * floor((2·a·n + d) / (2·d)) rounds a·n/d half-up for non-negative a·n.
 */
export function mulDivRoundHalfUp(amount: number, num: number, den: number): number {
  assertNonNegativeInteger(amount, 'amount')
  assertNonNegativeInteger(num, 'num')
  assertInteger(den, 'den')
  if (den < 1) {
    throw new MoneyError(`den must be a positive integer, got ${String(den)}`)
  }
  const d = BigInt(den)
  const result = (2n * BigInt(amount) * BigInt(num) + d) / (2n * d)
  return toSafeNumber(result, 'mulDivRoundHalfUp result')
}

/** Round-half-up on a rational, expressed as (amount × num) / den. */
export const roundHalfUp = mulDivRoundHalfUp

/**
 * Largest-remainder allocation of totalCents across weights, proportional to
 * each weight. The allocations always sum to exactly totalCents, no entry is
 * negative, zero weights receive zero, and remainder ties are broken by index
 * order (stable). Reused for discount allocation and refund line allocation.
 */
export function allocateProportional(totalCents: number, weights: number[]): number[] {
  assertNonNegativeInteger(totalCents, 'totalCents')
  for (let i = 0; i < weights.length; i++) {
    assertNonNegativeInteger(weights[i] as number, `weights[${i}]`)
  }
  if (totalCents === 0) {
    return weights.map(() => 0)
  }
  let weightSum = 0n
  for (const weight of weights) {
    weightSum += BigInt(weight)
  }
  if (weightSum === 0n) {
    throw new MoneyError('cannot allocate a positive total across all-zero weights')
  }
  const total = BigInt(totalCents)
  const allocations: number[] = []
  const remainders: bigint[] = []
  let allocated = 0
  for (const weight of weights) {
    const product = total * BigInt(weight)
    const base = toSafeNumber(product / weightSum, 'allocation')
    allocations.push(base)
    remainders.push(product % weightSum)
    allocated += base
  }
  let leftover = totalCents - allocated
  if (leftover > 0) {
    const order = allocations.map((_, i) => i)
    order.sort((a, b) => {
      const ra = remainders[a] as bigint
      const rb = remainders[b] as bigint
      if (ra !== rb) return rb > ra ? 1 : -1
      return a - b
    })
    for (const index of order) {
      if (leftover === 0) break
      allocations[index] = (allocations[index] as number) + 1
      leftover -= 1
    }
  }
  return allocations
}

function formatPercentOff(valueBps: number): string {
  const whole = Math.floor(valueBps / 100)
  const frac = valueBps % 100
  if (frac === 0) return `${whole}% off`
  const fracStr = String(frac).padStart(2, '0').replace(/0$/, '')
  return `${whole}.${fracStr}% off`
}

function formatCentsOff(valueCents: number): string {
  const dollars = Math.floor(valueCents / 100)
  const rem = String(valueCents % 100).padStart(2, '0')
  return `$${dollars}.${rem} off`
}

function validateLine(line: QuoteLineInput, index: number): void {
  if (!LINE_KINDS.includes(line.kind)) {
    throw new MoneyError(`lines[${index}].kind is not a valid line kind: ${String(line.kind)}`)
  }
  assertPositiveInteger(line.qty, `lines[${index}].qty`)
  assertNonNegativeInteger(line.unitPriceCents, `lines[${index}].unitPriceCents`)
}

interface ResolvedDiscount {
  discountCents: number
  discountDescription: string
}

function resolveDiscount(discount: DiscountInput, eligibleSubtotalCents: number): ResolvedDiscount {
  if (discount.type === 'PERCENT') {
    const valueBps = discount.valueBps
    if (valueBps === undefined) {
      throw new MoneyError('discount.valueBps is required for PERCENT discounts')
    }
    assertInteger(valueBps, 'discount.valueBps')
    if (valueBps < 1 || valueBps > 10000) {
      throw new MoneyError(`discount.valueBps must be in 1..10000, got ${String(valueBps)}`)
    }
    return {
      discountCents: mulDivRoundHalfUp(eligibleSubtotalCents, valueBps, 10000),
      discountDescription: formatPercentOff(valueBps),
    }
  }
  if (discount.type === 'FIXED_CENTS') {
    const valueCents = discount.valueCents
    if (valueCents === undefined) {
      throw new MoneyError('discount.valueCents is required for FIXED_CENTS discounts')
    }
    assertPositiveInteger(valueCents, 'discount.valueCents')
    return {
      discountCents: Math.min(valueCents, eligibleSubtotalCents),
      discountDescription: formatCentsOff(valueCents),
    }
  }
  throw new MoneyError(`unknown discount type: ${String(discount.type)}`)
}

/**
 * Compute a full quote. Deterministic: the same input always produces a
 * deep-equal output. Never mutates its input.
 */
export function quote(input: QuoteInput): Quote {
  if (!Array.isArray(input.lines)) {
    throw new MoneyError('lines must be an array')
  }
  assertInteger(input.taxRateBps, 'taxRateBps')
  if (input.taxRateBps < 0 || input.taxRateBps > 3000) {
    throw new MoneyError(`taxRateBps must be in 0..3000, got ${String(input.taxRateBps)}`)
  }
  const tipCents = input.tipCents ?? 0
  assertNonNegativeInteger(tipCents, 'tipCents')

  // 1. Exact line subtotals.
  const lineSubtotals: number[] = []
  let subtotal = 0n
  let eligibleSubtotal = 0n
  input.lines.forEach((line, index) => {
    validateLine(line, index)
    const lineSubtotal = toSafeNumber(
      BigInt(line.unitPriceCents) * BigInt(line.qty),
      `lines[${index}].lineSubtotalCents`,
    )
    lineSubtotals.push(lineSubtotal)
    subtotal += BigInt(lineSubtotal)
    if (line.discountEligible) eligibleSubtotal += BigInt(lineSubtotal)
  })
  const subtotalCents = toSafeNumber(subtotal, 'subtotalCents')
  const eligibleSubtotalCents = toSafeNumber(eligibleSubtotal, 'eligibleSubtotalCents')

  // 2. Discount: computed ONCE on the eligible subtotal, then allocated across
  // eligible lines by largest remainder so the allocations sum exactly.
  let discountCents = 0
  let discountDescription: string | null = null
  if (input.discount !== undefined) {
    const resolved = resolveDiscount(input.discount, eligibleSubtotalCents)
    discountCents = resolved.discountCents
    discountDescription = resolved.discountDescription
  }
  const eligibleIndexes: number[] = []
  input.lines.forEach((line, index) => {
    if (line.discountEligible) eligibleIndexes.push(index)
  })
  const eligibleAllocations = allocateProportional(
    discountCents,
    eligibleIndexes.map((index) => lineSubtotals[index] as number),
  )
  const discountAllocations: number[] = input.lines.map(() => 0)
  eligibleIndexes.forEach((lineIndex, position) => {
    discountAllocations[lineIndex] = eligibleAllocations[position] as number
  })

  // 3. Per-line tax on the discounted amount, taxable lines only.
  // 4. Tip added last, untaxed.
  let taxCents = 0
  const lines: QuoteLine[] = input.lines.map((line, index) => {
    const lineSubtotalCents = lineSubtotals[index] as number
    const discountAllocatedCents = discountAllocations[index] as number
    const lineTaxCents = line.taxable
      ? mulDivRoundHalfUp(lineSubtotalCents - discountAllocatedCents, input.taxRateBps, 10000)
      : 0
    taxCents += lineTaxCents
    return {
      id: line.id,
      kind: line.kind,
      description: line.description,
      qty: line.qty,
      unitPriceCents: line.unitPriceCents,
      taxable: line.taxable,
      discountEligible: line.discountEligible,
      lineSubtotalCents,
      discountAllocatedCents,
      taxCents: lineTaxCents,
      lineTotalCents: lineSubtotalCents - discountAllocatedCents + lineTaxCents,
    }
  })

  return {
    pricingVersion: PRICING_VERSION,
    lines,
    subtotalCents,
    discountCents,
    discountDescription,
    taxCents,
    tipCents,
    totalCents: subtotalCents - discountCents + taxCents + tipCents,
  }
}
