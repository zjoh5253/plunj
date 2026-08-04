import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  allocateProportional,
  MoneyError,
  mulDivRoundHalfUp,
  PRICING_VERSION,
  quote,
  roundHalfUp,
} from '../index.js'
import type { DiscountInput, LineKind, QuoteInput } from '../index.js'

const RUNS = { numRuns: 1000 }

const KINDS: readonly LineKind[] = [
  'DROP_IN',
  'BUYOUT',
  'MEMBERSHIP_CYCLE',
  'PACK',
  'GIFT_CARD',
  'RETAIL',
  'FEE',
]

const bareLineArb = fc.record({
  kind: fc.constantFrom(...KINDS),
  description: fc.string({ maxLength: 20 }),
  qty: fc.integer({ min: 1, max: 12 }),
  unitPriceCents: fc.integer({ min: 0, max: 500_000 }),
  taxable: fc.boolean(),
  discountEligible: fc.boolean(),
})

const linesArb = fc
  .array(bareLineArb, { maxLength: 8 })
  .map((lines) => lines.map((line, i) => ({ ...line, id: `line-${i}` })))

const percentDiscountArb: fc.Arbitrary<DiscountInput> = fc
  .integer({ min: 1, max: 10000 })
  .map((valueBps) => ({ id: 'disc-1', code: 'CODE', type: 'PERCENT' as const, valueBps }))

const fixedDiscountArb: fc.Arbitrary<DiscountInput> = fc
  .integer({ min: 1, max: 2_000_000 })
  .map((valueCents) => ({ id: 'disc-1', code: 'CODE', type: 'FIXED_CENTS' as const, valueCents }))

const taxRateArb = fc.integer({ min: 0, max: 3000 })

const quoteInputArb: fc.Arbitrary<QuoteInput> = fc
  .record({
    lines: linesArb,
    discount: fc.option(fc.oneof(percentDiscountArb, fixedDiscountArb), { nil: undefined }),
    taxRateBps: taxRateArb,
    tipCents: fc.option(fc.integer({ min: 0, max: 100_000 }), { nil: undefined }),
  })
  .map(({ lines, discount, taxRateBps, tipCents }) => {
    const input: QuoteInput = { lines, taxRateBps }
    if (discount !== undefined) input.discount = discount
    if (tipCents !== undefined) input.tipCents = tipCents
    return input
  })

function eligibleSubtotalOf(input: QuoteInput): number {
  return input.lines
    .filter((line) => line.discountEligible)
    .reduce((sum, line) => sum + line.qty * line.unitPriceCents, 0)
}

describe('quote properties', () => {
  it('reconciles every total exactly', () => {
    fc.assert(
      fc.property(quoteInputArb, (input) => {
        const q = quote(input)
        expect(q.totalCents).toBe(q.subtotalCents - q.discountCents + q.taxCents + q.tipCents)
        expect(q.tipCents).toBe(input.tipCents ?? 0)
        const sumLineSubtotals = q.lines.reduce((sum, line) => sum + line.lineSubtotalCents, 0)
        const sumLineTaxes = q.lines.reduce((sum, line) => sum + line.taxCents, 0)
        const sumLineTotals = q.lines.reduce((sum, line) => sum + line.lineTotalCents, 0)
        expect(sumLineSubtotals).toBe(q.subtotalCents)
        expect(sumLineTaxes).toBe(q.taxCents)
        expect(sumLineTotals).toBe(q.totalCents - q.tipCents)
      }),
      RUNS,
    )
  })

  it('discount allocations sum exactly to discountCents', () => {
    fc.assert(
      fc.property(quoteInputArb, (input) => {
        const q = quote(input)
        const allocated = q.lines.reduce((sum, line) => sum + line.discountAllocatedCents, 0)
        expect(allocated).toBe(q.discountCents)
      }),
      RUNS,
    )
  })

  it('keeps the discount within 0..eligibleSubtotal and off ineligible lines', () => {
    fc.assert(
      fc.property(quoteInputArb, (input) => {
        const q = quote(input)
        expect(q.discountCents).toBeGreaterThanOrEqual(0)
        expect(q.discountCents).toBeLessThanOrEqual(eligibleSubtotalOf(input))
        for (const line of q.lines) {
          if (!line.discountEligible) expect(line.discountAllocatedCents).toBe(0)
        }
      }),
      RUNS,
    )
  })

  it('never produces negative cents anywhere', () => {
    fc.assert(
      fc.property(quoteInputArb, (input) => {
        const q = quote(input)
        for (const value of [
          q.subtotalCents,
          q.discountCents,
          q.taxCents,
          q.tipCents,
          q.totalCents,
        ]) {
          expect(Number.isInteger(value)).toBe(true)
          expect(value).toBeGreaterThanOrEqual(0)
        }
        for (const line of q.lines) {
          for (const value of [
            line.lineSubtotalCents,
            line.discountAllocatedCents,
            line.taxCents,
            line.lineTotalCents,
          ]) {
            expect(Number.isInteger(value)).toBe(true)
            expect(value).toBeGreaterThanOrEqual(0)
          }
          expect(line.discountAllocatedCents).toBeLessThanOrEqual(line.lineSubtotalCents)
        }
      }),
      RUNS,
    )
  })

  it('is deterministic and never mutates its input', () => {
    fc.assert(
      fc.property(quoteInputArb, (input) => {
        const snapshot = structuredClone(input)
        const first = quote(input)
        const second = quote(input)
        expect(second).toStrictEqual(first)
        expect(input).toStrictEqual(snapshot)
        expect(first.pricingVersion).toBe(PRICING_VERSION)
      }),
      RUNS,
    )
  })

  it('allocates identically per line id under permutation of lines', () => {
    // Distinct positive weights per line so remainder ties (which legitimately
    // break by line order) are rare; residual ties are skipped via fc.pre.
    const permutationCaseArb = fc
      .record({
        lines: fc.array(bareLineArb, { minLength: 1, maxLength: 8 }).map((lines) =>
          lines.map((line, i) => ({
            ...line,
            id: `line-${i}`,
            qty: 1,
            unitPriceCents: line.unitPriceCents * 8 + i + 1,
            discountEligible: true,
          })),
        ),
        discount: fc.oneof(percentDiscountArb, fixedDiscountArb),
        taxRateBps: taxRateArb,
      })
      .chain(({ lines, discount, taxRateBps }) =>
        fc.record({
          lines: fc.constant(lines),
          permutedLines: fc.shuffledSubarray(lines, {
            minLength: lines.length,
            maxLength: lines.length,
          }),
          discount: fc.constant(discount),
          taxRateBps: fc.constant(taxRateBps),
        }),
      )
    fc.assert(
      fc.property(permutationCaseArb, ({ lines, permutedLines, discount, taxRateBps }) => {
        const original = quote({ lines, discount, taxRateBps })
        const eligibleWeights = lines.map((line) => line.qty * line.unitPriceCents)
        const weightSum = eligibleWeights.reduce((sum, w) => sum + w, 0)
        if (original.discountCents > 0 && weightSum > 0) {
          const remainders = eligibleWeights.map((w) =>
            String((BigInt(original.discountCents) * BigInt(w)) % BigInt(weightSum)),
          )
          fc.pre(new Set(remainders).size === remainders.length)
        }
        const permuted = quote({ lines: permutedLines, discount, taxRateBps })
        expect(permuted.subtotalCents).toBe(original.subtotalCents)
        expect(permuted.discountCents).toBe(original.discountCents)
        expect(permuted.taxCents).toBe(original.taxCents)
        expect(permuted.totalCents).toBe(original.totalCents)
        const byId = new Map(permuted.lines.map((line) => [line.id, line]))
        for (const line of original.lines) {
          const twin = byId.get(line.id)
          expect(twin).toBeDefined()
          if (twin === undefined) continue
          expect(twin.lineSubtotalCents).toBe(line.lineSubtotalCents)
          expect(twin.discountAllocatedCents).toBe(line.discountAllocatedCents)
          expect(twin.taxCents).toBe(line.taxCents)
          expect(twin.lineTotalCents).toBe(line.lineTotalCents)
        }
      }),
      RUNS,
    )
  })

  it('zeroes eligible lines exactly under a 100% discount', () => {
    fc.assert(
      fc.property(linesArb, taxRateArb, (lines, taxRateBps) => {
        const q = quote({
          lines,
          discount: { id: 'disc-1', code: 'FREE', type: 'PERCENT', valueBps: 10000 },
          taxRateBps,
        })
        expect(q.discountCents).toBe(eligibleSubtotalOf({ lines, taxRateBps }))
        for (const line of q.lines) {
          if (line.discountEligible) {
            expect(line.discountAllocatedCents).toBe(line.lineSubtotalCents)
            expect(line.taxCents).toBe(0)
            expect(line.lineTotalCents).toBe(0)
          }
        }
      }),
      RUNS,
    )
  })

  it('has zero discount when no discount is given', () => {
    fc.assert(
      fc.property(linesArb, taxRateArb, (lines, taxRateBps) => {
        const q = quote({ lines, taxRateBps })
        expect(q.discountCents).toBe(0)
        expect(q.discountDescription).toBeNull()
        for (const line of q.lines) expect(line.discountAllocatedCents).toBe(0)
        expect(q.totalCents).toBe(q.subtotalCents + q.taxCents)
      }),
      RUNS,
    )
  })
})

describe('allocateProportional properties', () => {
  it('sums exactly, never goes negative, gives zero to zero weights', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000_000 }),
        fc.array(fc.integer({ min: 0, max: 10_000_000 }), { minLength: 1, maxLength: 12 }),
        (totalCents, weights) => {
          const weightSum = weights.reduce((sum, w) => sum + w, 0)
          if (weightSum === 0 && totalCents > 0) {
            expect(() => allocateProportional(totalCents, weights)).toThrow(MoneyError)
            return
          }
          const out = allocateProportional(totalCents, weights)
          expect(out).toHaveLength(weights.length)
          expect(out.reduce((sum, v) => sum + v, 0)).toBe(totalCents)
          out.forEach((value, i) => {
            expect(Number.isInteger(value)).toBe(true)
            expect(value).toBeGreaterThanOrEqual(0)
            if (weights[i] === 0) expect(value).toBe(0)
            if (totalCents <= weightSum) expect(value).toBeLessThanOrEqual(weights[i] as number)
          })
        },
      ),
      RUNS,
    )
  })
})

describe('mulDivRoundHalfUp properties', () => {
  it('rounds the exact rational half-up', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.integer({ min: 1, max: 10_000 }),
        (amount, num, den) => {
          const result = mulDivRoundHalfUp(amount, num, den)
          // result is round-half-up of (amount*num)/den iff -den < 2*(result*den - amount*num) <= den
          const diff = 2n * (BigInt(result) * BigInt(den) - BigInt(amount) * BigInt(num))
          expect(diff <= BigInt(den)).toBe(true)
          expect(diff > -BigInt(den)).toBe(true)
        },
      ),
      RUNS,
    )
  })

  it('is exported as roundHalfUp too', () => {
    expect(roundHalfUp).toBe(mulDivRoundHalfUp)
    expect(roundHalfUp(4750, 2000, 10000)).toBe(950)
    expect(roundHalfUp(1, 5000, 10000)).toBe(1)
    expect(roundHalfUp(9999, 1000, 10000)).toBe(1000)
  })
})

describe('input validation', () => {
  const validLine = {
    id: 'a',
    kind: 'DROP_IN' as const,
    description: 'Cold plunge drop-in',
    qty: 1,
    unitPriceCents: 4500,
    taxable: true,
    discountEligible: true,
  }

  it('rejects invalid line quantities and prices', () => {
    expect(() => quote({ lines: [{ ...validLine, qty: 0 }], taxRateBps: 0 })).toThrow(MoneyError)
    expect(() => quote({ lines: [{ ...validLine, qty: 1.5 }], taxRateBps: 0 })).toThrow(MoneyError)
    expect(() => quote({ lines: [{ ...validLine, qty: -1 }], taxRateBps: 0 })).toThrow(MoneyError)
    expect(() => quote({ lines: [{ ...validLine, unitPriceCents: -1 }], taxRateBps: 0 })).toThrow(
      MoneyError,
    )
    expect(() => quote({ lines: [{ ...validLine, unitPriceCents: 10.5 }], taxRateBps: 0 })).toThrow(
      MoneyError,
    )
  })

  it('rejects out-of-range tax rates and tips', () => {
    expect(() => quote({ lines: [validLine], taxRateBps: -1 })).toThrow(MoneyError)
    expect(() => quote({ lines: [validLine], taxRateBps: 3001 })).toThrow(MoneyError)
    expect(() => quote({ lines: [validLine], taxRateBps: 100.5 })).toThrow(MoneyError)
    expect(() => quote({ lines: [validLine], taxRateBps: 0, tipCents: -1 })).toThrow(MoneyError)
    expect(() => quote({ lines: [validLine], taxRateBps: 0, tipCents: 2.5 })).toThrow(MoneyError)
  })

  it('rejects malformed discounts', () => {
    const base = { id: 'd', code: 'CODE' }
    expect(() =>
      quote({ lines: [validLine], taxRateBps: 0, discount: { ...base, type: 'PERCENT' } }),
    ).toThrow(MoneyError)
    expect(() =>
      quote({
        lines: [validLine],
        taxRateBps: 0,
        discount: { ...base, type: 'PERCENT', valueBps: 0 },
      }),
    ).toThrow(MoneyError)
    expect(() =>
      quote({
        lines: [validLine],
        taxRateBps: 0,
        discount: { ...base, type: 'PERCENT', valueBps: 10001 },
      }),
    ).toThrow(MoneyError)
    expect(() =>
      quote({ lines: [validLine], taxRateBps: 0, discount: { ...base, type: 'FIXED_CENTS' } }),
    ).toThrow(MoneyError)
    expect(() =>
      quote({
        lines: [validLine],
        taxRateBps: 0,
        discount: { ...base, type: 'FIXED_CENTS', valueCents: 0 },
      }),
    ).toThrow(MoneyError)
    expect(() =>
      quote({
        lines: [validLine],
        taxRateBps: 0,
        discount: { ...base, type: 'FIXED_CENTS', valueCents: -500 },
      }),
    ).toThrow(MoneyError)
  })

  it('rejects invalid allocator and rounding inputs', () => {
    expect(() => allocateProportional(-1, [100])).toThrow(MoneyError)
    expect(() => allocateProportional(1.5, [100])).toThrow(MoneyError)
    expect(() => allocateProportional(100, [-1, 50])).toThrow(MoneyError)
    expect(() => allocateProportional(100, [0, 0])).toThrow(MoneyError)
    expect(() => mulDivRoundHalfUp(100, 200, 0)).toThrow(MoneyError)
    expect(() => mulDivRoundHalfUp(100, 200, -1)).toThrow(MoneyError)
    expect(() => mulDivRoundHalfUp(-1, 200, 10)).toThrow(MoneyError)
    expect(() => mulDivRoundHalfUp(1, 2.5, 10)).toThrow(MoneyError)
  })
})
