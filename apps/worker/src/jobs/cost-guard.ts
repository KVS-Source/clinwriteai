// The AI cost limit a PM may set on a document (documents.ai_cost_limit, API ai-cost.ts). Before each AI call the
// drafter asks whether what has been spent plus a call like the last one would go over the limit; if so the draft
// pauses (the same Pause a writer can press) and AI Debug says why. A project manager raises the limit, then Resume.
//
// Spend is priced with the admin's active rate card, exactly as AI Debug's cost total; no price is hard-coded. A
// document without a limit, or an install without a rate card, is never paused for cost.

import type { JobHandler } from './types.js'

type Prisma = Parameters<JobHandler>[1]['prisma']
interface Rate { model: string; inputPer1M: number; outputPer1M: number; cachedInputPer1M: number }
export interface CallUsage { model: string; inputTokens: number; cachedTokens?: number; outputTokens: number }

export class CostGuard {
  constructor(
    readonly limitUsd: number,
    public spentUsd: number,
    public lastCallUsd: number,
    private readonly rates: Rate[],
    private readonly currency: { code: string; usdRate: number },
  ) {}

  /** USD for one call, like the API's computeCostUsdWithCard. */
  price(u: CallUsage): number {
    const r = this.rates.find(x => x.model === u.model) ?? this.rates.find(x => x.model === 'unknown')
    if (!r) return 0
    const cached = u.cachedTokens ?? 0
    return (Math.max(0, u.inputTokens - cached) * r.inputPer1M + cached * r.cachedInputPer1M + u.outputTokens * r.outputPer1M) / 1_000_000
  }

  add(u: CallUsage): void {
    const usd = this.price(u)
    this.spentUsd += usd
    this.lastCallUsd = usd
  }

  /** Spent plus a call like the last one would go over the limit. */
  get reached(): boolean {
    return this.spentUsd + this.lastCallUsd > this.limitUsd
  }

  private money(usd: number): string {
    return `${(usd * this.currency.usdRate).toFixed(2)} ${this.currency.code}`
  }

  describe(): string {
    return `Paused: the AI cost limit of ${this.money(this.limitUsd)} would be passed by the next AI call (${this.money(this.spentUsd)} spent so far). A project manager can raise the limit in AI Debug, then press Resume.`
  }
}

export async function loadCostGuard(prisma: Prisma, documentId: string): Promise<CostGuard | null> {
  const doc = await prisma.document.findUnique({ where: { id: documentId }, select: { aiCostLimit: true } }).catch(() => null)
  const limit = doc?.aiCostLimit as { usd?: number } | null | undefined
  if (!limit || typeof limit.usd !== 'number' || limit.usd <= 0) return null
  const card = await prisma.rateCardVersion.findFirst({ where: { isActive: true }, include: { entries: true } }).catch(() => null)
  if (!card || card.entries.length === 0) return null
  const rates: Rate[] = card.entries.map(e => ({
    model: e.model, inputPer1M: Number(e.inputPer1M), outputPer1M: Number(e.outputPer1M), cachedInputPer1M: Number(e.cachedInputPer1M),
  }))
  const settings = await prisma.platformSettings.findUnique({ where: { id: 'default' }, select: { localisation: true } }).catch(() => null)
  const loc = (settings?.localisation ?? {}) as { currency?: string; usdRate?: number }
  const currency = loc.currency && loc.currency.toUpperCase() !== 'USD' && typeof loc.usdRate === 'number' && loc.usdRate > 0
    ? { code: loc.currency.toUpperCase(), usdRate: loc.usdRate }
    : { code: 'USD', usdRate: 1 }

  const guard = new CostGuard(limit.usd, 0, 0, rates, currency)
  const steps = await prisma.aiDraftStep.findMany({ where: { documentId }, select: { details: true }, orderBy: { id: 'asc' } })
  for (const s of steps) {
    const d = (s.details ?? {}) as Record<string, unknown>
    const inputTokens = typeof d.inputTokens === 'number' ? d.inputTokens : 0
    const outputTokens = typeof d.outputTokens === 'number' ? d.outputTokens : 0
    if (!inputTokens && !outputTokens) continue
    guard.add({ model: typeof d.model === 'string' ? d.model : 'unknown', inputTokens, outputTokens, cachedTokens: typeof d.cachedTokens === 'number' ? d.cachedTokens : 0 })
  }
  return guard
}
