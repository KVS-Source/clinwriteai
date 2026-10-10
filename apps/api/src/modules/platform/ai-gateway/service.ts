// AI Gateway service — the one path for LLM calls.
//
// Every feature module calls `app.aiGateway.chat(...)` instead of talking
// to Anthropic directly. The gateway:
//
//   1. Scrubs structured PII from the prompt (pii-scrub).
//   2. Looks up the tenant's monthly quota (AiTenantQuota) and current
//      month-to-date spend from AiCallRecord. Decides allowed / warn / reject.
//   3. If allowed, forwards to the real Anthropic SDK (stubbed until the
//      API key arrives — see memory project_phase_3a_deferrals).
//   4. Writes an AiCallRecord with model, token counts, computed cost,
//      latency, and the rate-limit decision — always, even on failure.
//
// Keeping cost accounting consistent is more important than keeping the
// prompt literal: a request that was PII-scrubbed and refused still gets
// a record (with inputTokens=0, errorCode='rate_limited').

import type { PrismaClient } from '@prisma/client'
import { computeCostUsdWithCard, getActiveRateCard } from './rate-card.js'
import { scrubPii } from './pii-scrub.js'

export interface ChatArgs {
  tenantId: string | null
  projectId?: string | null
  actorId: string
  module: 'A' | 'B' | 'C' | 'D' | 'E' | 'platform'
  intent: string                                    // 'draft_section' | 'claims_harvest' | …
  model: string
  prompt: string
  maxOutputTokens?: number
}

export interface ChatResult {
  responseText: string
  model: string
  inputTokens: number
  outputTokens: number
  costUsd: number
  limitDecision: 'allowed' | 'allowed_approaching_cap' | 'rejected_cap'
  piiScrubbed: boolean
  piiCategories: string[]
  recordId: string
}

export class RateLimitedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RateLimitedError'
  }
}

/** Interface over the real Anthropic SDK call. */
export interface LlmClient {
  send(args: {
    model: string
    prompt: string
    maxOutputTokens?: number
  }): Promise<{ responseText: string; inputTokens: number; outputTokens: number }>
}

// --- Stub client — deterministic, no network. Swap for the real Anthropic
// SDK wrapper when the API key arrives. The intent is to keep the service
// shape stable so the swap is a single file change.
class StubLlmClient implements LlmClient {
  async send(args: { model: string; prompt: string; maxOutputTokens?: number }) {
    // Token estimates: Anthropic's rough rule is ~4 chars per token.
    const inputTokens = Math.max(1, Math.ceil(args.prompt.length / 4))
    const responseText = `[STUB_${args.model}] Would respond to a prompt of length ${args.prompt.length}.`
    const outputTokens = Math.max(1, Math.ceil(responseText.length / 4))
    return { responseText, inputTokens, outputTokens }
  }
}

/**
 * Factory that picks the real Anthropic SDK wrapper when
 * ANTHROPIC_API_KEY is set in env, else falls back to the deterministic
 * StubLlmClient. Keeps dev + CI runnable without an API key.
 * See apps/api/src/modules/platform/ai-gateway/anthropic-client.ts.
 */
export function createLlmClient(): LlmClient {
  // Dynamic require pattern avoids pulling @anthropic-ai/sdk into the
  // bundle when the key isn't set.
  if (!process.env.ANTHROPIC_API_KEY?.trim()) return new StubLlmClient()
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createAnthropicClientFromEnv } = require('./anthropic-client.js')
  return createAnthropicClientFromEnv() ?? new StubLlmClient()
}

export class AiGatewayService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly llm: LlmClient = createLlmClient(),
  ) {}

  async chat(args: ChatArgs): Promise<ChatResult> {
    const start = Date.now()
    const { scrubbed, piiFound, categories } = scrubPii(args.prompt)

    // Load the active rate card up front (cached). All AiCallRecord writes
    // in this call tag the row with versionId so the audit trail knows
    // which rates priced this record.
    const rateCard = await getActiveRateCard(this.prisma)

    // --- Quota check (per-tenant monthly cap) -----------------------------
    const quota = args.tenantId
      ? await this.prisma.aiTenantQuota.findUnique({ where: { tenantId: args.tenantId } })
      : null

    let limitDecision: ChatResult['limitDecision'] = 'allowed'
    if (quota) {
      const start = startOfMonth(quota.rolloverDay, new Date())
      const agg = await this.prisma.aiCallRecord.aggregate({
        _sum: { costUsd: true },
        where: { tenantId: args.tenantId, createdAt: { gte: start } },
      })
      const spentUsd = Number(agg._sum.costUsd ?? 0)
      const cap = Number(quota.monthlyCapUsd)
      // cap=0 means "no AI allowed" — reject every call. Keeps the semantic
      // intuitive: setting a $0 cap disables AI for the tenant.
      if (cap === 0) {
        limitDecision = 'rejected_cap'
      } else {
        const pct = (spentUsd / cap) * 100
        if (pct >= quota.rejectAtPct) limitDecision = 'rejected_cap'
        else if (pct >= quota.warnAtPct) limitDecision = 'allowed_approaching_cap'
      }
    }

    if (limitDecision === 'rejected_cap') {
      // Still record the attempt so the dashboards reflect reality.
      const record = await this.prisma.aiCallRecord.create({
        data: {
          tenantId: args.tenantId,
          projectId: args.projectId ?? null,
          actorId: args.actorId,
          module: args.module,
          intent: args.intent,
          model: args.model,
          inputTokens: 0,
          outputTokens: 0,
          cachedTokens: 0,
          costUsd: 0,
          latencyMs: Date.now() - start,
          limitDecision,
          piiScrubbed: piiFound,
          errorCode: 'rate_limited',
          rateCardVersionId: rateCard.versionId,
        },
      })
      throw Object.assign(new RateLimitedError('Monthly AI spend cap reached for this tenant'), {
        recordId: record.id,
        limitDecision,
      })
    }

    // --- Forward to LLM ---------------------------------------------------
    let responseText = ''
    let inputTokens = 0
    let outputTokens = 0
    let errorCode: string | null = null
    try {
      const r = await this.llm.send({ model: args.model, prompt: scrubbed, maxOutputTokens: args.maxOutputTokens })
      responseText = r.responseText
      inputTokens = r.inputTokens
      outputTokens = r.outputTokens
    } catch (err) {
      errorCode = 'provider_err'
      responseText = ''
      // Preserve the message for logging; the audit stays via the record below.
      throw Object.assign(
        new Error(err instanceof Error ? err.message : 'AI provider error'),
        { errorCode },
      )
    } finally {
      // Always write the record — success or failure. Priced from the
      // active rate card (DB-backed); tagged with its version id so the
      // audit trail shows which rates applied to this row.
      const cost = computeCostUsdWithCard(rateCard.rates, { model: args.model, inputTokens, outputTokens })
      const record = await this.prisma.aiCallRecord.create({
        data: {
          tenantId: args.tenantId,
          projectId: args.projectId ?? null,
          actorId: args.actorId,
          module: args.module,
          intent: args.intent,
          model: args.model,
          inputTokens,
          outputTokens,
          cachedTokens: 0,
          costUsd: cost,
          latencyMs: Date.now() - start,
          limitDecision,
          piiScrubbed: piiFound,
          errorCode,
          rateCardVersionId: rateCard.versionId,
        },
      })
      // Attach record id so callers can log it alongside their own audit.
      ;(this as unknown as { _lastRecordId: string })._lastRecordId = record.id
    }

    const recordId = (this as unknown as { _lastRecordId: string })._lastRecordId
    return {
      responseText,
      model: args.model,
      inputTokens,
      outputTokens,
      costUsd: computeCostUsdWithCard(rateCard.rates, { model: args.model, inputTokens, outputTokens }),
      limitDecision,
      piiScrubbed: piiFound,
      piiCategories: categories,
      recordId,
    }
  }
}

// --- helpers -------------------------------------------------------------

function startOfMonth(rolloverDay: number, now: Date): Date {
  // Period boundary: 'monthly cap' uses the tenant's rolloverDay. If today
  // is before rolloverDay this month, we're still in the previous period.
  const d = new Date(now)
  if (d.getUTCDate() < rolloverDay) d.setUTCMonth(d.getUTCMonth() - 1)
  d.setUTCDate(rolloverDay)
  d.setUTCHours(0, 0, 0, 0)
  return d
}
