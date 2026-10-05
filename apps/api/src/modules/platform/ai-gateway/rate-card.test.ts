import { describe, expect, it } from 'vitest'
import { computeCostUsd, getModelRate } from './rate-card.js'

describe('rate-card', () => {
  it('resolves known model rates', () => {
    expect(getModelRate('claude-opus-4-7').outputPer1M).toBe(75)
    expect(getModelRate('claude-sonnet-4-6').inputPer1M).toBe(3)
  })

  it('falls back to the unknown-model rate on misses', () => {
    expect(getModelRate('not-a-real-model').model).toBe('unknown')
  })

  it('computes USD cost for a plain call (no cache)', () => {
    // Sonnet @ 3/M in + 15/M out, 10k in + 2k out
    const cost = computeCostUsd({ model: 'claude-sonnet-4-6', inputTokens: 10_000, outputTokens: 2_000 })
    // Expected: 10000 * 3/1M + 2000 * 15/1M = 0.03 + 0.03 = 0.06
    expect(cost).toBeCloseTo(0.06, 6)
  })

  it('applies the cached-input discount', () => {
    const warm = computeCostUsd({ model: 'claude-sonnet-4-6', inputTokens: 10_000, outputTokens: 0, cachedTokens: 10_000 })
    // Expected: 10000 * 0.3/1M = 0.003
    expect(warm).toBeCloseTo(0.003, 6)
  })

  it('mixes cached + regular input tokens correctly', () => {
    const cost = computeCostUsd({ model: 'claude-sonnet-4-6', inputTokens: 10_000, outputTokens: 0, cachedTokens: 3_000 })
    // 7000 regular @ 3/M + 3000 cached @ 0.3/M = 0.021 + 0.0009 = 0.0219
    expect(cost).toBeCloseTo(0.0219, 6)
  })

  it('rounds to 6-decimal precision for Decimal(10,6)', () => {
    const cost = computeCostUsd({ model: 'claude-opus-4-7', inputTokens: 1, outputTokens: 1 })
    // Should be a finite 6-decimal rounded value, not a floating-point surprise.
    expect(String(cost).split('.')[1]?.length ?? 0).toBeLessThanOrEqual(6)
  })
})
