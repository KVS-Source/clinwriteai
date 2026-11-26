// AI drafting cost: what a draft is expected to cost (shown at New Document when the policy's cost estimate is on),
// what a document has spent so far, and the cost limit the PM may set on it.
//
// Prices come from the admin-managed rate card (platform/ai-gateway/rate-card.ts), the same one AI Debug's cost
// total uses; nothing here hard-codes a price. AI providers bill in US dollars, so amounts are kept in USD and shown
// in the install's currency (Admin → Localisation: currency + "1 USD =" rate). Without a rate, they're shown in USD.

import type { PrismaClient } from '@prisma/client'
import { computeCostUsdWithCard, getActiveRateCard, type ModelRate } from '../../platform/ai-gateway/rate-card.js'

export interface LocalCurrency {
  /** The currency amounts are shown in: the install's, or USD when it has no rate. */
  currency: string
  /** 1 USD in `currency` (1 for USD). */
  usdRate:  number
  /** The install's currency has no rate yet, so amounts are in USD. */
  rateMissing: boolean
}

export async function localCurrency(prisma: PrismaClient): Promise<LocalCurrency> {
  const row = await prisma.platformSettings.findUnique({ where: { id: 'default' }, select: { localisation: true } }).catch(() => null)
  const loc = (row?.localisation ?? {}) as { currency?: string; usdRate?: number }
  const currency = (loc.currency ?? 'USD').toUpperCase()
  if (currency === 'USD') return { currency, usdRate: 1, rateMissing: false }
  if (typeof loc.usdRate === 'number' && loc.usdRate > 0) return { currency, usdRate: loc.usdRate, rateMissing: false }
  return { currency: 'USD', usdRate: 1, rateMissing: true }
}

const round = (n: number, places = 2) => Math.round(n * 10 ** places) / 10 ** places
export const toLocal = (usd: number, cur: LocalCurrency) => round(usd * cur.usdRate)
export const toUsd = (amount: number, cur: LocalCurrency) => round(amount / cur.usdRate, 6)

/** The cost limit set on a document (documents.ai_cost_limit). */
export interface AiCostLimit {
  usd:      number
  amount:   number
  currency: string
  usdRate:  number
  setBy:    string
  setAt:    string
}

export const asCostLimit = (raw: unknown): AiCostLimit | null => {
  const l = raw as Partial<AiCostLimit> | null
  return l && typeof l.usd === 'number' && l.usd > 0 ? (l as AiCostLimit) : null
}

/** What a document's AI calls have cost so far, from its drafting steps and the active rate card. */
export async function documentSpendUsd(prisma: PrismaClient, documentId: string): Promise<number> {
  return (await documentSpend(prisma, documentId)).totalUsd
}

/**
 * Spent so far and the cost of the last AI call. The worker pauses when spent plus a call like the last one would
 * pass the limit (worker cost-guard.ts), so Resume and AI Debug use the same rule: limitReached().
 */
export async function documentSpend(prisma: PrismaClient, documentId: string): Promise<{ totalUsd: number; lastCallUsd: number }> {
  const [steps, card] = await Promise.all([
    prisma.aiDraftStep.findMany({ where: { documentId }, select: { details: true }, orderBy: { id: 'asc' } }),
    getActiveRateCard(prisma),
  ])
  let total = 0
  let last = 0
  for (const s of steps) {
    const d = (s.details ?? {}) as Record<string, unknown>
    const inputTokens = typeof d.inputTokens === 'number' ? d.inputTokens : 0
    const outputTokens = typeof d.outputTokens === 'number' ? d.outputTokens : 0
    if (!inputTokens && !outputTokens) continue
    last = computeCostUsdWithCard(card.rates, {
      model: typeof d.model === 'string' ? d.model : 'unknown',
      inputTokens, outputTokens, cachedTokens: typeof d.cachedTokens === 'number' ? d.cachedTokens : 0,
    })
    total += last
  }
  return { totalUsd: round(total, 6), lastCallUsd: round(last, 6) }
}

export const limitReached = (spend: { totalUsd: number; lastCallUsd: number }, limit: AiCostLimit) =>
  spend.totalUsd + spend.lastCallUsd > limit.usd

// --------------------------------------------------------------------------- estimate

export interface EstimateInput {
  /** Sections the AI drafts. */
  sections: number
  /** Text of all sources, in characters, and their pages (PDF) and pages without text. */
  sourceChars: number
  sourcePages: number
  scannedPages: number
  /** Each section gets only its relevant pages (build plan sourcePages), within this many characters. */
  pagesBudgetChars: number | null
  /** A study fact sheet is extracted first (build plan factSheet). */
  factSheet: boolean
  rate: ModelRate
}

export interface Estimate {
  lowUsd:  number
  highUsd: number
  minutesLow:  number
  minutesHigh: number
  /** Inputs to the estimate, for the "how is this worked out" note. */
  basis: { sections: number; sourceTokens: number; perSectionSourceTokens: number; cached: boolean; validationPasses: [number, number] }
}

const CHARS_PER_TOKEN = 3.5
/** A PDF page sent as a PDF costs its text plus an image of the page. */
const PAGE_IMAGE_TOKENS = 1_500
/** Instructions, fact sheet, outline and earlier sections given to a section. */
const SECTION_PROMPT_TOKENS = 7_000
// High end: a long section. The worker's limit is 8000 since 2026-11-26; at 2000 half a Protocol's sections hit it.
const SECTION_OUTPUT_TOKENS: [number, number] = [900, 4_000]
const FACT_SHEET_OUTPUT_TOKENS = 4_000
const PASS_OUTPUT_TOKENS = 4_000
const DRAFTED_TOKENS_PER_SECTION = 1_200
const CACHE_WRITE = 1.25
/** Up to this many pages in all, sources go as PDFs (every page also an image). */
const PDF_PAGES_AS_IS = 100

/**
 * A rough range for one AI draft of a document: low = one checking pass and short sections, high = three passes,
 * long sections and a fifth of the sections drafted again. Uses the rate card's input, cached-input and output rates.
 */
export function estimateDraftCost(i: EstimateInput): Estimate {
  const per = (tokens: number, ratePer1M: number) => (tokens * ratePer1M) / 1_000_000
  const sourceTokens = Math.round(i.sourceChars / CHARS_PER_TOKEN
    + (i.sourcePages <= PDF_PAGES_AS_IS ? i.sourcePages : i.scannedPages) * PAGE_IMAGE_TOKENS)
  const pagesMode = i.pagesBudgetChars !== null && i.sourcePages > PDF_PAGES_AS_IS
  const perSectionSource = pagesMode ? Math.round(i.pagesBudgetChars! / CHARS_PER_TOKEN) : sourceTokens
  // Every file to every section: the sources are cached after the first call (written once, then read).
  const cached = !pagesMode && sourceTokens > 15_000

  const sectionInput = (n: number) => {
    if (pagesMode) return per(n * (perSectionSource + SECTION_PROMPT_TOKENS), i.rate.inputPer1M)
    if (!cached) return per(n * (sourceTokens + SECTION_PROMPT_TOKENS), i.rate.inputPer1M)
    // With a fact sheet its call writes the cache and every section reads it.
    const writes = i.factSheet ? 0 : 1
    return per(writes * sourceTokens * CACHE_WRITE + SECTION_PROMPT_TOKENS * n, i.rate.inputPer1M)
      + per((n - writes) * sourceTokens, i.rate.cachedInputPer1M)
  }
  const sectionOutput = (n: number, each: number) => per(n * each, i.rate.outputPer1M)
  const factSheet = i.factSheet
    ? per(sourceTokens * (cached ? CACHE_WRITE : 1) + 3_000, i.rate.inputPer1M) + per(FACT_SHEET_OUTPUT_TOKENS, i.rate.outputPer1M)
    : 0
  const pass = per(sourceTokens * (cached ? CACHE_WRITE : 1) + i.sections * DRAFTED_TOKENS_PER_SECTION, i.rate.inputPer1M)
    + per(PASS_OUTPUT_TOKENS, i.rate.outputPer1M)

  const redrafts = Math.ceil(i.sections * 0.2)
  const low = factSheet + sectionInput(i.sections) + sectionOutput(i.sections, SECTION_OUTPUT_TOKENS[0]) + pass
  const high = factSheet + sectionInput(i.sections + redrafts) + sectionOutput(i.sections + redrafts, SECTION_OUTPUT_TOKENS[1]) + 3 * pass
  return {
    lowUsd: round(low),
    highUsd: round(high),
    minutesLow: Math.max(1, Math.round((i.sections * 15 + 60) / 60)),
    minutesHigh: Math.max(2, Math.round(((i.sections + redrafts) * 40 + 3 * 90) / 60)),
    basis: { sections: i.sections, sourceTokens, perSectionSourceTokens: perSectionSource, cached, validationPasses: [1, 3] },
  }
}
