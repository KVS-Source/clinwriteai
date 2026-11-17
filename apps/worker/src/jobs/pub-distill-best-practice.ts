// Publication BP distillation worker — Module B analogue of
// distill-best-practice.ts (Module A clinical).
//
// Scope: admin uploads a BP PDF against a publication docType; this
// job extracts the structured principles JSON that
// PublicationBestPracticeRecord.digest will serve on every AI call
// for that doc type. Writes to a DRAFT PublicationBestPracticeRecord
// (one pending draft per docType; a second upload for the same docType
// overwrites the first), plus mirrors to the legacy
// PublicationTypePolicy.bestPracticeDigest column until Phase 3 of the
// pointer refactor drops the legacy read path.
//
// Pipeline:
//   1. Load the publication policy row for the docType to prove it
//      still exists + is current.
//   2. Load the DocumentUpload row + fetch the blob.
//   3. Hand the PDF to Claude with the same strict-JSON contract
//      Module A uses.
//   4. Parse + validate. Any failure returns a failure Report.
//   5. On success: upsert a draft PublicationBestPracticeRecord +
//      mirror to policy.bestPracticeDigest.
//
// Idempotency: enqueued with jobId=`pub-bp-distill-${docType}-${uploadId}`.

import { createBlobReaderFromEnv } from '../blob-reader.js'
import { resolveDraftModel } from '../ai-engine-settings.js'
import type { JobHandler } from './types.js'
import type { Prisma } from '@prisma/client'

interface DistillPubBpPayload {
  docType:   string
  uploadId:  string
  actorId:   string
}

interface Principle {
  scope:    string
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

const MAX_OUTPUT_TOKENS = 4_000
const SECTION_SCOPE_RE = /^section:[a-zA-Z0-9_.\-§]+$/

function isValidScope(s: unknown): s is string {
  return typeof s === 'string' && (s === 'whole-doc' || SECTION_SCOPE_RE.test(s))
}
function isValidSeverity(s: unknown): s is 'must' | 'should' | 'nice' {
  return s === 'must' || s === 'should' || s === 'nice'
}

function stripJsonFence(text: string): string {
  const m = /^\s*```(?:json)?\s*\n([\s\S]*?)\n?```\s*$/i.exec(text.trim())
  return (m ? m[1]! : text).trim()
}

function parseDigestResponse(raw: string): { ok: Principle[] } | { fail: string } {
  const stripped = stripJsonFence(raw)
  let parsed: unknown
  try { parsed = JSON.parse(stripped) }
  catch (err) { return { fail: `json_parse: ${err instanceof Error ? err.message : String(err)}` } }
  if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as { principles?: unknown }).principles)) {
    return { fail: 'shape: missing principles array' }
  }
  const out: Principle[] = []
  for (const [i, p] of ((parsed as { principles: unknown[] }).principles).entries()) {
    if (!p || typeof p !== 'object') return { fail: `shape: principle[${i}] is not an object` }
    const pp = p as Record<string, unknown>
    if (!isValidScope(pp.scope))       return { fail: `shape: principle[${i}].scope invalid (${String(pp.scope)})` }
    if (!isValidSeverity(pp.severity)) return { fail: `shape: principle[${i}].severity invalid (${String(pp.severity)})` }
    if (typeof pp.text !== 'string' || pp.text.trim().length === 0) return { fail: `shape: principle[${i}].text missing` }
    if (pp.text.length > 2_000) return { fail: `shape: principle[${i}].text exceeds 2000 chars` }
    out.push({ scope: pp.scope, severity: pp.severity, text: pp.text.trim() })
  }
  return { ok: out }
}

function stubAllowed(): boolean { return process.env.AI_ALLOW_STUB === '1' }
function buildStubDigest(): Principle[] {
  return [
    { scope: 'whole-doc', severity: 'must',   text: '[stub] Adhere to ICMJE authorship requirements throughout.' },
    { scope: 'whole-doc', severity: 'should', text: '[stub] Lead with a plain-English summary when the journal permits.' },
    { scope: 'section:methods', severity: 'must', text: '[stub] Report sample-size justification and randomisation method.' },
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
    `You are a scientific-writing style editor. Read the attached Best-Practice document and distil it into a strict JSON array of actionable principles for the AI drafter.`,
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
    `1. "scope" is "whole-doc" for cross-cutting rules; "section:<key>" where <key> is a stable section identifier like "methods", "results", "discussion", "introduction", "abstract", "references" — or a numbered id like "3.2.1" when the source uses them.`,
    `2. "severity":`,
    `   - "must"   = compliance / regulatory requirement; failing this is a finding`,
    `   - "should" = strong preference the drafter should honor`,
    `   - "nice"   = style suggestion`,
    `3. "text" is one sentence, imperative mood ("Use …", "List …", "Lead with …"). ≤ 2000 chars. Do NOT paraphrase to add detail the source did not include.`,
    `4. Do not invent principles not in the source. Short source → short list.`,
    `5. Maximum 80 principles per response. Prefer merging near-duplicates.`,
  ].join('\n')

  const userPrompt = `Distil the attached Best-Practice document into the principles JSON. Return the JSON object only.`

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
  if ('fail' in parsed) throw new Error(`distillation_output_${parsed.fail}`)
  return parsed.ok
}

export const handleDistillPublicationBestPractice: JobHandler<DistillPubBpPayload, Report> = async (job, { prisma, log }) => {
  const { docType, uploadId, actorId } = job.data
  const normalisedDocType = docType.replace(/-/g, '_')

  // 1. Policy row — must still exist + be current.
  const policy = await prisma.publicationTypePolicy.findFirst({
    where: { docType: normalisedDocType, isCurrent: true, retiredAt: null },
  })
  if (!policy) {
    log.warn({ docType: normalisedDocType }, 'pub bp distill: no current policy — abort')
    return { status: 'failed', reason: 'policy_not_current' }
  }

  // 2. Upload row + PDF.
  const upload = await prisma.documentUpload.findUnique({ where: { id: uploadId } })
  if (!upload) {
    log.warn({ uploadId }, 'pub bp distill: upload not found — abort')
    return { status: 'failed', reason: 'upload_not_found' }
  }
  if ((upload.contentType ?? '').toLowerCase() !== 'application/pdf') {
    log.warn({ uploadId, contentType: upload.contentType }, 'pub bp distill: upload is not a PDF')
    return { status: 'failed', reason: 'not_pdf' }
  }

  const reader = createBlobReaderFromEnv()
  let pdfBytes: Buffer
  try {
    const got = await reader.read('documents', upload.blobKey)
    pdfBytes = got.bytes
  } catch (err) {
    log.warn({ err, uploadId }, 'pub bp distill: blob read failed')
    return { status: 'failed', reason: 'blob_read_failed' }
  }

  // 3. Claude (or stub).
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
      log.warn({ docType: normalisedDocType }, 'pub bp distill: AI not configured')
      return { status: 'failed', reason: 'ai_not_configured' }
    }
  } catch (err) {
    log.warn({ err, docType: normalisedDocType }, 'pub bp distill: Claude call failed')
    return { status: 'failed', reason: 'ai_call_failed' }
  }

  // 4. Upsert the draft PublicationBestPracticeRecord for this docType.
  //    One pending draft per docType — a second upload overwrites the
  //    first. Admin approves via POST /publication-best-practice-records/:id/approve.
  const digest: Digest = {
    principles,
    sourcePdfId:    uploadId,
    distilledAt:    new Date().toISOString(),
    distilledModel,
  }
  const now = new Date()
  const existingDraft = await prisma.publicationBestPracticeRecord.findFirst({
    where: { docType: normalisedDocType, status: 'draft' },
  })
  let recordId: string
  if (existingDraft) {
    const updated = await prisma.publicationBestPracticeRecord.update({
      where: { id: existingDraft.id },
      data: {
        digest:         digest as unknown as Prisma.InputJsonValue,
        sourcePdfId:    uploadId,
        distilledAt:    now,
        distilledModel,
        updatedBy:      actorId,
      },
    })
    recordId = updated.id
  } else {
    const last = await prisma.publicationBestPracticeRecord.findFirst({
      where:   { docType: normalisedDocType },
      orderBy: { version: 'desc' },
      select:  { version: true },
    })
    const created = await prisma.publicationBestPracticeRecord.create({
      data: {
        docType:        normalisedDocType,
        version:        (last?.version ?? 0) + 1,
        status:         'draft',
        digest:         digest as unknown as Prisma.InputJsonValue,
        sourcePdfId:    uploadId,
        distilledAt:    now,
        distilledModel,
        createdBy:      actorId,
        updatedBy:      actorId,
      },
    })
    recordId = created.id
  }

  // 5. Legacy mirror — see header. Dropped in Phase 3.
  await prisma.publicationTypePolicy.update({
    where: { id: policy.id },
    data:  {
      bestPracticeDigest: digest as unknown as Prisma.InputJsonValue,
      updatedBy:          actorId,
    },
  }).catch(err => {
    log.warn({ err, policyId: policy.id }, 'pub bp distill: legacy mirror write failed — draft still committed')
  })

  log.info({ docType: normalisedDocType, recordId, principleCount: principles.length, model: distilledModel }, 'pub bp distill: draft record written')
  return { status: 'ok', principlesIn: principles.length }
}
