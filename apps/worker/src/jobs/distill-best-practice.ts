// Best-Practice distillation worker.
//
// Scope: admin uploads a Best-Practice PDF; this job extracts its
// essence into the structured `bestPracticeDigest` JSON that
// DocumentTypePolicy.bestPracticeDigest will serve on every AI call
// for that doc type. One-time cost per BP doc — avoids re-parsing the
// PDF on every drafting / rewrite call later.
//
// Pipeline:
//   1. Load the policy row to prove it still exists + is current.
//   2. Load the DocumentUpload row + fetch the blob (reusing the
//      worker's own BlobReader surface).
//   3. Hand the PDF to Claude with a system prompt that insists on a
//      strict JSON output matching the digest shape; max_tokens
//      scaled to fit ~60 principles comfortably.
//   4. Parse + validate. Any failure (parse error, structural mismatch)
//      → leave the policy row untouched + return a failure Report so
//      BullMQ records the outcome. No partial writes.
//   5. On success: `prisma.documentTypePolicy.update({ bestPracticeDigest })`
//      with `sourcePdfId` + `distilledAt` + `distilledModel` stamped.
//
// Observability: the API side audits
// `document_type_policy.bp_distill_enqueued` at enqueue time. This
// worker does NOT write audit rows itself — the audit trail is
// hash-chained in `audit_events` (raw-SQL only, no Prisma model;
// see schema.prisma) and writes must go through src/audit/repository
// on the API. Outcome signals here: pino log + the Report return +
// the policy row's updatedAt / bestPracticeDigest changing.
//
// Idempotency: enqueued with `jobId=bp-distill-${policyId}-${uploadId}`
// so BullMQ dedupes retries. Re-running against a different PDF is
// intentional — each run replaces the whole digest.

import { createBlobReaderFromEnv } from '../blob-reader.js'
import { resolveDraftModel } from '../ai-engine-settings.js'
import type { JobHandler } from './types.js'

interface DistillBpPayload {
  policyId:  string
  uploadId:  string
  actorId:   string                                          // admin who triggered the job
}

interface Principle {
  scope:    string                                           // 'whole-doc' | 'section:<key>'
  severity: 'must' | 'should' | 'nice'
  text:     string
}

interface Digest {
  principles:     Principle[]
  sourcePdfId:    string
  distilledAt:    string
  distilledModel: string
}

interface Report {
  status:        'ok' | 'failed'
  reason?:       string
  principlesIn?: number
}

// Max output tokens. ~60 principles at 25 tokens each + JSON overhead.
const MAX_OUTPUT_TOKENS = 4_000

// Scope validation — 'whole-doc' or 'section:<key>'. Matches the Zod
// shape over on the API side (platform/document-type-policy/schema.ts).
const SECTION_SCOPE_RE = /^section:[a-zA-Z0-9_.\-§]+$/
function isValidScope(s: unknown): s is string {
  return typeof s === 'string' && (s === 'whole-doc' || SECTION_SCOPE_RE.test(s))
}
function isValidSeverity(s: unknown): s is 'must' | 'should' | 'nice' {
  return s === 'must' || s === 'should' || s === 'nice'
}

/** Strict JSON parse + structural validation. Any failure → null + reason. */
function parseDigestResponse(raw: string): { ok: Principle[] } | { fail: string } {
  const stripped = stripJsonFence(raw)
  let parsed: unknown
  try {
    parsed = JSON.parse(stripped)
  } catch (err) {
    return { fail: `json_parse: ${err instanceof Error ? err.message : String(err)}` }
  }
  if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as { principles?: unknown }).principles)) {
    return { fail: 'shape: missing principles array' }
  }
  const out: Principle[] = []
  for (const [i, p] of ((parsed as { principles: unknown[] }).principles).entries()) {
    if (!p || typeof p !== 'object') return { fail: `shape: principle[${i}] is not an object` }
    const pp = p as Record<string, unknown>
    if (!isValidScope(pp.scope))       return { fail: `shape: principle[${i}].scope invalid (${String(pp.scope)})` }
    if (!isValidSeverity(pp.severity)) return { fail: `shape: principle[${i}].severity invalid (${String(pp.severity)})` }
    if (typeof pp.text !== 'string' || pp.text.trim().length === 0) {
      return { fail: `shape: principle[${i}].text missing or empty` }
    }
    if (pp.text.length > 2_000) {
      return { fail: `shape: principle[${i}].text exceeds 2000 chars` }
    }
    out.push({ scope: pp.scope, severity: pp.severity, text: pp.text.trim() })
  }
  return { ok: out }
}

function stripJsonFence(text: string): string {
  const m = /^\s*```(?:json)?\s*\n([\s\S]*?)\n?```\s*$/i.exec(text.trim())
  return (m ? m[1]! : text).trim()
}

/** Dev/CI only: AI_ALLOW_STUB=1 lets this job write a deterministic
 *  synthetic digest so the integration test can exercise the whole
 *  pipeline without an API key. Off by default. */
function stubAllowed(): boolean {
  return process.env.AI_ALLOW_STUB === '1'
}

function buildStubDigest(): Principle[] {
  return [
    { scope: 'whole-doc',    severity: 'must',   text: '[stub] Follow ICH M11 structural register throughout.' },
    { scope: 'whole-doc',    severity: 'should', text: '[stub] Prefer the active voice in Methods and Results.' },
    { scope: 'section:s6_2', severity: 'must',   text: '[stub] List inclusion criteria as a numbered list, one criterion per line.' },
  ]
}

async function distillWithClaude(args: {
  pdfBytes: Buffer
  model:    string
  apiKey:   string
}): Promise<Principle[]> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk').catch(() => {
    throw new Error('ANTHROPIC_API_KEY set but @anthropic-ai/sdk is not installed in apps/worker.')
  })
  const client = new Anthropic({ apiKey: args.apiKey })

  const system = [
    `You are a regulatory writing style editor. Read the attached Best-Practice document and distil it into a strict JSON array of actionable principles for the AI drafter.`,
    ``,
    `OUTPUT CONTRACT`,
    `Return ONLY a JSON object matching this shape — no prose before or after, no markdown fences:`,
    `{`,
    `  "principles": [`,
    `    { "scope": "whole-doc" | "section:<key>", "severity": "must" | "should" | "nice", "text": "<the rule in one sentence>" }`,
    `  ]`,
    `}`,
    ``,
    `RULES`,
    `1. "scope" is "whole-doc" for cross-cutting rules; "section:<key>" where <key> is the stable section key (e.g. "section:s6_2", "section:3.2.P.3"). Infer section keys from headings in the source document; keep them close to how the document itself refers to them.`,
    `2. "severity":`,
    `   - "must"   = compliance / regulatory requirement; failing this is a finding`,
    `   - "should" = strong preference the drafter should honor`,
    `   - "nice"   = style suggestion`,
    `3. "text" is one sentence, imperative mood ("Use …", "List …", "Lead with …"). ≤ 2000 chars. Do NOT paraphrase to add detail the source did not include.`,
    `4. Do not invent principles not in the source. If the source is short, return a short list.`,
    `5. Maximum 80 principles per response. Prefer merging near-duplicates over emitting both.`,
  ].join('\n')

  const userPrompt =
    `Distil the attached Best-Practice document into the principles JSON. Return the JSON object only.`

  const message = await client.messages.create({
    model:      args.model,
    max_tokens: MAX_OUTPUT_TOKENS,
    system,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'document' as const,
            source: {
              type:       'base64' as const,
              media_type: 'application/pdf' as const,
              data:       args.pdfBytes.toString('base64'),
            },
          },
          { type: 'text', text: userPrompt },
        ],
      },
    ],
  })

  const text = message.content
    .map(b => (b.type === 'text' ? (b as { type: 'text'; text: string }).text : ''))
    .join('\n')
    .trim()
  if (!text) throw new Error('Claude returned no text content')

  const parsed = parseDigestResponse(text)
  if ('fail' in parsed) {
    throw new Error(`distillation_output_${parsed.fail}`)
  }
  return parsed.ok
}

export const handleDistillBestPractice: JobHandler<DistillBpPayload, Report> = async (job, { prisma, log }) => {
  const { policyId, uploadId, actorId } = job.data

  // 1. Policy must still exist + be current — a retire between enqueue
  // and handler means abort.
  const policy = await prisma.documentTypePolicy.findUnique({ where: { id: policyId } })
  if (!policy) {
    log.warn({ policyId }, 'bp distill: policy not found — abort')
    return { status: 'failed', reason: 'policy_not_found' }
  }
  if (!policy.isCurrent || policy.retiredAt !== null) {
    log.warn({ policyId }, 'bp distill: policy no longer current — abort')
    return { status: 'failed', reason: 'policy_not_current' }
  }

  // 2. Upload must exist + be a PDF.
  const upload = await prisma.documentUpload.findUnique({ where: { id: uploadId } })
  if (!upload) {
    log.warn({ uploadId }, 'bp distill: upload not found — abort')
    return { status: 'failed', reason: 'upload_not_found' }
  }
  if ((upload.contentType ?? '').toLowerCase() !== 'application/pdf') {
    log.warn({ uploadId, contentType: upload.contentType }, 'bp distill: upload is not a PDF')
    return { status: 'failed', reason: 'not_pdf' }
  }

  // 3. Fetch the PDF bytes.
  const reader = createBlobReaderFromEnv()
  let pdfBytes: Buffer
  try {
    const got = await reader.read('documents', upload.blobKey)
    pdfBytes = got.bytes
  } catch (err) {
    log.warn({ err, uploadId }, 'bp distill: blob read failed')
    return { status: 'failed', reason: 'blob_read_failed' }
  }

  // 4. Call Claude (or the dev stub).
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim()
  const model  = await resolveDraftModel(prisma, null)
  let principles: Principle[]
  let distilledModel = model
  try {
    if (apiKey) {
      principles = await distillWithClaude({ pdfBytes, model, apiKey })
    } else if (stubAllowed()) {
      principles = buildStubDigest()
      distilledModel = 'stub'
    } else {
      log.warn({ policyId }, 'bp distill: AI not configured (no ANTHROPIC_API_KEY, AI_ALLOW_STUB off)')
      return { status: 'failed', reason: 'ai_not_configured' }
    }
  } catch (err) {
    log.warn({ err, policyId }, 'bp distill: Claude call failed')
    return { status: 'failed', reason: 'ai_call_failed' }
  }

  // 5. Persist the digest onto the policy row. updatedAt bumps, and the
  // digest's distilledAt gives the admin screen a precise timestamp.
  const digest: Digest = {
    principles,
    sourcePdfId:    uploadId,
    distilledAt:    new Date().toISOString(),
    distilledModel,
  }
  await prisma.documentTypePolicy.update({
    where: { id: policyId },
    data:  {
      bestPracticeDigest: digest as unknown as object,
      updatedBy:          actorId,
    },
  })
  log.info({ policyId, principleCount: principles.length, model: distilledModel }, 'bp distill: digest written')
  return { status: 'ok', principlesIn: principles.length }
}

// Exposed for unit testing the pure parse + validate.
export const __test__ = { parseDigestResponse, stripJsonFence }
