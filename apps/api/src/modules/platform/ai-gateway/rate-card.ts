// Per-model USD rate card for cost accounting.
//
// Rates are per-1M tokens, matching the Anthropic published pricing shape
// (opus/sonnet/haiku). cachedInputRate reflects the prompt-caching discount
// (typically 10% of normal input rate for a cache hit).
//
// Rates are intentionally frozen in code (not DB-sourced) so historical
// AiCallRecord.costUsd values stay stable across rate-card changes. When
// Anthropic updates pricing, we add a new entry here and the service picks
// the right one by model name at write time.

export interface ModelRate {
  model: string
  inputPer1M: number        // USD per 1M input tokens
  outputPer1M: number       // USD per 1M output tokens
  cachedInputPer1M: number  // discounted rate for cache-hit input tokens
}

const RATES: ReadonlyArray<ModelRate> = [
  // Claude 4 family — approximations until the live price table lands
  { model: 'claude-opus-4-7', inputPer1M: 15.0, outputPer1M: 75.0, cachedInputPer1M: 1.5 },
  { model: 'claude-sonnet-4-6', inputPer1M: 3.0, outputPer1M: 15.0, cachedInputPer1M: 0.3 },
  { model: 'claude-haiku-4-5-20251001', inputPer1M: 0.8, outputPer1M: 4.0, cachedInputPer1M: 0.08 },
  // Fallback catch-all so unknown model names still get accounted.
  { model: 'unknown', inputPer1M: 5.0, outputPer1M: 25.0, cachedInputPer1M: 0.5 },
]

export function getModelRate(model: string): ModelRate {
  return RATES.find(r => r.model === model) ?? RATES.find(r => r.model === 'unknown')!
}

export function computeCostUsd(args: {
  model: string
  inputTokens: number
  outputTokens: number
  cachedTokens?: number
}): number {
  const r = getModelRate(args.model)
  const regularInput = Math.max(0, args.inputTokens - (args.cachedTokens ?? 0))
  const cached = args.cachedTokens ?? 0
  const total =
    (regularInput * r.inputPer1M) / 1_000_000 +
    (cached * r.cachedInputPer1M) / 1_000_000 +
    (args.outputTokens * r.outputPer1M) / 1_000_000
  // Round to 6 decimals so Prisma Decimal(10,6) stores cleanly.
  return Math.round(total * 1_000_000) / 1_000_000
}
