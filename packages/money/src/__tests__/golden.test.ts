import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PRICING_VERSION, quote } from '../index.js'
import type { Quote, QuoteInput } from '../index.js'

interface GoldenLineExpectation {
  id: string
  lineSubtotalCents: number
  discountAllocatedCents: number
  taxCents: number
  lineTotalCents: number
}

interface GoldenExpectation {
  subtotalCents: number
  discountCents: number
  discountDescription: string | null
  taxCents: number
  tipCents: number
  totalCents: number
  lines: GoldenLineExpectation[]
}

interface GoldenCase {
  name: string
  note?: string
  input: QuoteInput
  expected: GoldenExpectation
}

const goldenCases = JSON.parse(
  readFileSync(new URL('../../test/golden.json', import.meta.url), 'utf8'),
) as GoldenCase[]

function project(q: Quote): GoldenExpectation {
  return {
    subtotalCents: q.subtotalCents,
    discountCents: q.discountCents,
    discountDescription: q.discountDescription,
    taxCents: q.taxCents,
    tipCents: q.tipCents,
    totalCents: q.totalCents,
    lines: q.lines.map((line) => ({
      id: line.id,
      lineSubtotalCents: line.lineSubtotalCents,
      discountAllocatedCents: line.discountAllocatedCents,
      taxCents: line.taxCents,
      lineTotalCents: line.lineTotalCents,
    })),
  }
}

function eligibleSubtotalOf(input: QuoteInput): number {
  return input.lines
    .filter((line) => line.discountEligible)
    .reduce((sum, line) => sum + line.qty * line.unitPriceCents, 0)
}

describe('golden cases', () => {
  it('has at least 50 scenarios with unique names', () => {
    expect(goldenCases.length).toBeGreaterThanOrEqual(50)
    expect(new Set(goldenCases.map((gc) => gc.name)).size).toBe(goldenCases.length)
  })

  for (const goldenCase of goldenCases) {
    it(goldenCase.name, () => {
      const q = quote(goldenCase.input)
      expect(q.pricingVersion).toBe(PRICING_VERSION)
      expect(project(q)).toStrictEqual(goldenCase.expected)
    })
  }
})

describe('display invariant', () => {
  // For every PERCENT golden case, the advertised percentage and the applied
  // cents never diverge by more than one cent's worth of basis points.
  const percentCases = goldenCases.filter(
    (gc) => gc.input.discount?.type === 'PERCENT' && eligibleSubtotalOf(gc.input) > 0,
  )

  it('covers a meaningful share of the corpus', () => {
    expect(percentCases.length).toBeGreaterThanOrEqual(15)
  })

  for (const goldenCase of percentCases) {
    it(`${goldenCase.name}: advertised percent matches applied cents`, () => {
      const q = quote(goldenCase.input)
      const eligibleSubtotalCents = eligibleSubtotalOf(goldenCase.input)
      const valueBps = goldenCase.input.discount?.valueBps
      expect(valueBps).toBeDefined()
      if (valueBps === undefined) return
      const impliedBps = (q.discountCents * 10000) / eligibleSubtotalCents
      expect(Math.abs(impliedBps - valueBps)).toBeLessThanOrEqual(10000 / eligibleSubtotalCents)
    })
  }
})
