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
import { createAnthropicClientFromEnv } from './anthropic-client.js'
import { createOpenAIClientFromEnv } from './openai-client.js'
import { createGeminiClientFromEnv } from './gemini-client.js'

/**
 * Image attachment for multimodal (vision) calls. Base64 encoded; the
 * Anthropic client wraps these into `type: 'image'` content blocks
 * alongside the prompt text. Caller is responsible for keeping the
 * payload under provider limits (~5MB per image for Anthropic). An
 * image whose data length exceeds the cap is dropped with an inline
 * note in the final prompt — see routes using images for the current
 * cap enforcement.
 */
export interface ChatImage {
  /** Image MIME type: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp' */
  mediaType: string
  /** Raw image bytes. The client base64-encodes before sending. */
  data: Buffer
  /** Optional human-friendly label shown in audit logs. */
  label?: string
}

/**
 * Document attachment (currently PDF only). Used for image-only /
 * scanned PDFs that pdf-parse can't read as text — Anthropic supports
 * PDFs natively as `type: 'document'` content blocks and the model
 * reads both text layer AND images inside. Billed by page (~1500-3000
 * tokens / page), so document attachment is the EXPENSIVE path — text
 * extraction is preferred when it works.
 *
 * Caps: Anthropic documents max 100 pages, 32MB. Enforced in the client.
 */
export interface ChatDocument {
  /** 'application/pdf' — only PDF is supported today. */
  mediaType: string
  /** Raw PDF bytes. The client base64-encodes before sending. */
  data: Buffer
  /** Optional human-friendly label (filename). */
  label?: string
}

export interface ChatArgs {
  tenantId: string | null
  projectId?: string | null
  actorId: string
  module: 'A' | 'B' | 'C' | 'D' | 'E' | 'platform'
  intent: string                                    // 'draft_section' | 'claims_harvest' | …
  model: string
  prompt: string
  maxOutputTokens?: number
  /** Optional image attachments for vision-capable models. See ChatImage. */
  images?: ChatImage[]
  /** Optional PDF document attachments. See ChatDocument. */
  documents?: ChatDocument[]
  // Prompt-history + section-level Undo scope (sPM-history).
  // All optional — gateway calls that aren't tied to a document section
  // (module-level claims harvest, platform jobs) leave them unset. When
  // populated, the AiCallRecord stores them so the UI can later show
  // "what was in the section before this ran" and offer Undo.
  documentId?: string
  sectionId?: string
  documentVersionId?: string
  preCallSectionHtml?: string
  // promptText: what to STORE in AiCallRecord.promptText (may differ from
  // `prompt` which is forwarded to the LLM — e.g. caller may want to store
  // the user's natural-language instruction while sending a composed prompt
  // with system context). Defaults to the forwarded prompt when unset.
  promptText?: string
  promptMeta?: Record<string, unknown>
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
    images?: ChatImage[]
    documents?: ChatDocument[]
  }): Promise<{ responseText: string; inputTokens: number; outputTokens: number }>
}

// --- Stub client — deterministic, no network. Swap for the real Anthropic
// SDK wrapper when the API key arrives. The intent is to keep the service
// shape stable so the swap is a single file change.
class StubLlmClient implements LlmClient {
  async send(args: { model: string; prompt: string; maxOutputTokens?: number; images?: ChatImage[]; documents?: ChatDocument[] }) {
    // Token estimates: Anthropic's rough rule is ~4 chars per token.
    // Vision estimate: ~1500 tokens per image. PDF estimate: ~2500
    // tokens per document (rough — real cost scales with page count,
    // typically 1500-3000/page). Suffices for the stub so cost tracking
    // shows a non-zero number in dev.
    const textTokens = Math.max(1, Math.ceil(args.prompt.length / 4))
    const imgCount = args.images?.length ?? 0
    const docCount = args.documents?.length ?? 0
    const inputTokens = textTokens + imgCount * 1500 + docCount * 2500
    const attachNote = [
      imgCount > 0 ? `${imgCount} image(s)` : '',
      docCount > 0 ? `${docCount} PDF document(s)` : '',
    ].filter(Boolean).join(' + ')
    const responseText = attachNote
      ? `[STUB_${args.model}] Would respond to a prompt of length ${args.prompt.length} with ${attachNote}.`
      : `[STUB_${args.model}] Would respond to a prompt of length ${args.prompt.length}.`
    const outputTokens = Math.max(1, Math.ceil(responseText.length / 4))
    return { responseText, inputTokens, outputTokens }
  }
}

/**
 * Routes LlmClient.send to the right provider based on the model id:
 *
 *   model starts with 'claude-'  → AnthropicLlmClient (requires ANTHROPIC_API_KEY)
 *   model starts with 'gpt-'     → OpenAILlmClient (requires OPENAI_API_KEY)
 *   model starts with 'gemini-'  → GeminiLlmClient (requires GOOGLE_API_KEY or GEMINI_API_KEY)
 *   anything else / no key set   → StubLlmClient (deterministic, no network)
 *
 * All three provider clients lazy-load their SDK on first call, so a
 * deployment that only uses Anthropic doesn't pay the openai /
 * @google/generative-ai import cost.
 */
class MultiProviderLlmClient implements LlmClient {
  private readonly anthropic = createAnthropicClientFromEnv()
  private readonly openai    = createOpenAIClientFromEnv()
  private readonly gemini    = createGeminiClientFromEnv()
  private readonly stub      = new StubLlmClient()

  async send(args: Parameters<LlmClient['send']>[0]) {
    const model = (args.model ?? '').toLowerCase()
    if (model.startsWith('claude-') && this.anthropic) return this.anthropic.send(args)
    if (model.startsWith('gpt-')    && this.openai)    return this.openai.send(args)
    if (model.startsWith('gemini-') && this.gemini)    return this.gemini.send(args)
    return this.stub.send(args)
  }
}

/**
 * Factory that returns a MultiProviderLlmClient capable of routing to
 * every provider whose API key is present in env. Falls back to the
 * stub for any model id whose provider isn't configured.
 */
export function createLlmClient(): LlmClient {
  return new MultiProviderLlmClient()
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
          promptText:        args.promptText ?? args.prompt,
          preCallSectionHtml: args.preCallSectionHtml ?? null,
          documentId:        args.documentId ?? null,
          sectionId:         args.sectionId  ?? null,
          documentVersionId: args.documentVersionId ?? null,
          promptMeta:        (args.promptMeta ?? undefined) as object | undefined,
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
      const r = await this.llm.send({
        model: args.model,
        prompt: scrubbed,
        maxOutputTokens: args.maxOutputTokens,
        images: args.images,
        documents: args.documents,
      })
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
          promptText:        args.promptText ?? args.prompt,
          preCallSectionHtml: args.preCallSectionHtml ?? null,
          documentId:        args.documentId ?? null,
          sectionId:         args.sectionId  ?? null,
          documentVersionId: args.documentVersionId ?? null,
          promptMeta:        (args.promptMeta ?? undefined) as object | undefined,
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
