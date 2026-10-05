// Per-model USD rate card for cost accounting.
//
// Rates are per-1M tokens, matching the Anthropic published pricing shape
// (opus/sonnet/haiku). cachedInputRate reflects the prompt-caching discount
// (typically 10% of normal input rate for a cache hit).
//
// Two-layer source of truth (DB-backed hot reload shipped 2026-10-05):
//   1. DB `rate_card_versions` + `rate_card_entries` (preferred). Admin
//      publishes a new version via POST /admin/rate-cards without a
//      deploy; the service picks it up on the next 60-second cache tick.
//   2. In-code RATES array (fallback). Used when the DB has no active
//      rate card (fresh test DBs, dev contexts). The seed migration
//      00000000000024 imports this array as v1 so prod DBs always have
//      a DB-backed card.
//
// Historical AiCallRecord.costUsd rows are authoritative — stable across
// rate-card changes even if a later version revises per-model rates.

import type { PrismaClient } from '@prisma/client'

export interface ModelRate {
  model: string
  inputPer1M: number        // USD per 1M input tokens
  outputPer1M: number       // USD per 1M output tokens
  cachedInputPer1M: number  // discounted rate for cache-hit input tokens
}

export interface ActiveRateCard {
  versionId: string | null
  version: string | null
  rates: ReadonlyArray<ModelRate>
}

/**
 * Fallback rate table. Seeded into the DB as v1 by migration 24; also used
 * for test contexts that bypass the DB and for the brief startup window
 * before the first cache tick primes.
 */
const FALLBACK_RATES: ReadonlyArray<ModelRate> = [
  { model: 'claude-opus-4-7', inputPer1M: 15.0, outputPer1M: 75.0, cachedInputPer1M: 1.5 },
  { model: 'claude-sonnet-4-6', inputPer1M: 3.0, outputPer1M: 15.0, cachedInputPer1M: 0.3 },
  { model: 'claude-haiku-4-5-20251001', inputPer1M: 0.8, outputPer1M: 4.0, cachedInputPer1M: 0.08 },
  { model: 'unknown', inputPer1M: 5.0, outputPer1M: 25.0, cachedInputPer1M: 0.5 },
]

// --- Rate card lookup -----------------------------------------------------

/**
 * In-process cache of the current active rate card. Refreshed on 60s TTL
 * or on-demand via refreshActiveRateCard(). Reads during the cache window
 * take zero DB round-trips; refreshes happen out-of-band from AI calls.
 */
let cached: ActiveRateCard = { versionId: null, version: null, rates: FALLBACK_RATES }
let cachedAt = 0
const CACHE_TTL_MS = 60_000

export async function getActiveRateCard(prisma: PrismaClient): Promise<ActiveRateCard> {
  if (Date.now() - cachedAt < CACHE_TTL_MS && cached.versionId !== null) return cached
  try {
    const row = await prisma.rateCardVersion.findFirst({
      where: { isActive: true },
      include: { entries: true },
    })
    if (row) {
      cached = {
        versionId: row.id,
        version: row.version,
        rates: row.entries.map(e => ({
          model: e.model,
          inputPer1M: Number(e.inputPer1M),
          outputPer1M: Number(e.outputPer1M),
          cachedInputPer1M: Number(e.cachedInputPer1M),
        })),
      }
      cachedAt = Date.now()
    } else {
      // DB empty — keep the FALLBACK card and don't update cachedAt so the
      // next call re-probes the DB. Tolerant of the fresh-DB scenario.
      cached = { versionId: null, version: null, rates: FALLBACK_RATES }
    }
  } catch {
    // DB error (e.g. Prisma not ready) — fall back silently; the service
    // will retry on the next call.
    cached = { versionId: null, version: null, rates: FALLBACK_RATES }
  }
  return cached
}

/** Force a reload — called from POST /admin/rate-cards after a publish. */
export function invalidateRateCardCache(): void {
  cachedAt = 0
}

// --- Pure lookup helpers (back-compat) -----------------------------------

/**
 * Legacy synchronous getModelRate — resolves against the fallback rate
 * table. Kept for test files that import directly. Production callers
 * should use `computeCostUsdWithCard(rates, args)` instead.
 */
export function getModelRate(model: string): ModelRate {
  return FALLBACK_RATES.find(r => r.model === model) ?? FALLBACK_RATES.find(r => r.model === 'unknown')!
}

export function computeCostUsd(args: {
  model: string
  inputTokens: number
  outputTokens: number
  cachedTokens?: number
}): number {
  return computeCostUsdWithCard(FALLBACK_RATES, args)
}

export function computeCostUsdWithCard(
  rates: ReadonlyArray<ModelRate>,
  args: { model: string; inputTokens: number; outputTokens: number; cachedTokens?: number },
): number {
  const r = rates.find(x => x.model === args.model)
    ?? rates.find(x => x.model === 'unknown')
    ?? FALLBACK_RATES.find(x => x.model === 'unknown')!
  const regularInput = Math.max(0, args.inputTokens - (args.cachedTokens ?? 0))
  const cached = args.cachedTokens ?? 0
  const total =
    (regularInput * r.inputPer1M) / 1_000_000 +
    (cached * r.cachedInputPer1M) / 1_000_000 +
    (args.outputTokens * r.outputPer1M) / 1_000_000
  return Math.round(total * 1_000_000) / 1_000_000
}
