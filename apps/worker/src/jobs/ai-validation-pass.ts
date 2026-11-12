// AI validation-pass worker — M4 of the New Document rework.
//
// Runs after clinical.ai_initial_draft completes a document (chained via
// the enqueue in ai-initial-draft.ts). Each pass evaluates every section
// against a battery of checks, collects the failing sections, and — if
// any fail AND the iteration cap isn't reached — enqueues a targeted
// re-draft that only touches the failing sections, then re-enqueues
// itself for the next iteration.
//
// Checks (in order):
//   1. Completeness (deterministic) — contentHtml must have ≥
//      MIN_CONTENT_CHARS visible characters after stripping tags.
//      Catches sections the drafter left blank or that stub-returned
//      an empty string. Always runs.
//   2. AI self-critique (LLM-gated) — Claude reviews the whole doc
//      and flags sections with coherence / factual-gap / template-
//      mismatch issues. Only runs when ANTHROPIC_API_KEY is set.
//   3. Cross-source consistency (LLM-gated) — Claude verifies the
//      drafted claims against the attached source PDFs and flags
//      sections with unsupported assertions. Only runs when the key
//      AND source PDFs are available.
//
// If any check fails for a section, the section is added to the
// re-draft set. One re-draft call fixes everything the pass found
// across all three check kinds; the next pass re-evaluates everything
// again from scratch.
//
// Loop protection:
//   - MAX_ITERATIONS caps the chain at 5 passes. Beyond that the handler
//     logs the final failing set and stops without re-enqueueing.
//   - On idle passes (nothing failing), the handler returns clean and
//     does NOT re-enqueue itself — the loop ends cleanly.
//   - Each enqueued pass carries a deterministic jobId so BullMQ dedupes
//     accidental double-fires.

import { createBlobReaderFromEnv } from '../blob-reader.js'
import { resolveDraftModel } from '../ai-engine-settings.js'
import type { JobHandler } from './types.js'

interface AiValidationPassPayload {
  documentId:      string
  versionId:       string
  projectId:       string
  type:            string
  sourceUploadIds: string[]
  assigneeId:      string
  actorId:         string
  iteration:       number
}

// ────────────────────────────────────────────────────────────────────────
// Confidence rubric. Keep in sync with
// apps/api/src/modules/clinical-writing/documents/ai-confidence.ts — the
// worker inlines the constants so this file stays a zero-dependency
// handler (worker is a separate package from the API).

const FLAG_WEIGHTS: Readonly<Record<string, number>> = {
  'completeness:too_short': 40,
  'ai:self_critique':       30,
  'ai:template_mismatch':   20,
  'ai:coherence_issue':     20,
  'ai:unsupported_claim':   30,
}
const AI_UNKNOWN_WEIGHT = 15

function scoreSection(flags: ReadonlyArray<string>): number {
  if (flags.length === 0) return 100
  let penalty = 0
  for (const f of flags) penalty += FLAG_WEIGHTS[f] ?? AI_UNKNOWN_WEIGHT
  return Math.max(0, Math.min(100, 100 - penalty))
}

function overallConfidence(scores: ReadonlyArray<number>): number {
  if (scores.length === 0) return 0
  return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
}

const CONFIDENCE_TARGET = 85
const MIN_ITERATIONS = 3
const MAX_ITERATIONS = 5

function shouldStopLoop(a: { iteration: number; confidenceOverall: number; failingCount: number }): boolean {
  if (a.iteration >= MAX_ITERATIONS) return true
  if (a.failingCount === 0) return true
  if (a.iteration >= MIN_ITERATIONS && a.confidenceOverall >= CONFIDENCE_TARGET) return true
  return false
}

// ────────────────────────────────────────────────────────────────────────

// Minimum visible-text length (stripped of HTML tags) a drafted section
// must have to count as "complete". Set deliberately low — the point is
// to catch empty / near-empty sections, not to enforce page counts.
const MIN_CONTENT_CHARS = 80

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

export const handleAiValidationPass: JobHandler<AiValidationPassPayload> = async (job, { prisma, log, enqueue }) => {
  const { documentId, versionId, iteration } = job.data
  const passStartedAt = new Date()

  if (iteration > MAX_ITERATIONS) {
    log.warn({ documentId, iteration }, 'ai_validation_pass: iteration cap reached — stopping chain')
    await prisma.document.update({
      where: { id: documentId },
      data:  { aiDraftState: 'complete' },
    }).catch(() => undefined)
    return { skipped: 'iteration_cap_reached', iteration }
  }

  const rows = await prisma.sectionContent.findMany({
    where: { documentVersionId: versionId },
    select: { id: true, sectionId: true, sectionNumber: true, contentHtml: true },
  })
  if (rows.length === 0) {
    log.warn({ documentId, versionId }, 'ai_validation_pass: no section_content rows — nothing to validate')
    await prisma.document.update({
      where: { id: documentId },
      data:  { aiDraftState: 'complete' },
    }).catch(() => undefined)
    return { skipped: 'no_sections', iteration }
  }

  // Flag collector keyed by sectionId. Each section accumulates ≥0 flag
  // codes from the three check kinds; the rubric scores them.
  const flagsBySection = new Map<string, string[]>()
  const reasonsBySection = new Map<string, string[]>()
  for (const row of rows) flagsBySection.set(row.sectionId, [])

  // --- 1. Completeness check (deterministic) ----------------------------
  for (const row of rows) {
    const visible = stripTags(row.contentHtml ?? '')
    if (visible.length < MIN_CONTENT_CHARS) {
      flagsBySection.get(row.sectionId)!.push('completeness:too_short')
      ;(reasonsBySection.get(row.sectionId) ?? reasonsBySection.set(row.sectionId, []).get(row.sectionId)!)
        .push(`content too short (${visible.length} < ${MIN_CONTENT_CHARS} chars)`)
    }
  }

  // --- 2+3. LLM self-critique + cross-source consistency ----------------
  // Combined into one Claude call per pass. Only runs when a key is set
  // AND there's enough drafted content to be worth critiquing.
  let modelUsed: string | null = null
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim()
  const hasDraftedContent = rows.some(r => stripTags(r.contentHtml ?? '').length >= MIN_CONTENT_CHARS)
  if (apiKey && hasDraftedContent) {
    try {
      const project = await prisma.project.findUnique({
        where: { id: job.data.projectId },
        select: { tenantId: true },
      })
      modelUsed = await resolveDraftModel(prisma, project?.tenantId ?? null)
      const sourcePdfs = await loadSourcePdfsForJob(prisma, job.data.sourceUploadIds, log)
      // Thread the author's instructions through so the critique scores
      // sections against the SAME directives the drafter was asked to
      // follow (e.g. "draft in Japanese" — the validator shouldn't flag
      // Japanese prose as off-template).
      const docRow = await prisma.document.findUnique({
        where:  { id: documentId },
        select: { aiInstructions: true },
      })
      const aiInstructions = docRow?.aiInstructions?.trim() || null
      const aiFlagged = await runLlmChecks({
        apiKey,
        model:     modelUsed,
        docType:   job.data.type,
        sections:  rows.map(r => ({ id: r.sectionId, html: r.contentHtml ?? '' })),
        sourcePdfs,
        aiInstructions,
      })
      for (const flag of aiFlagged) {
        const bucket = flagsBySection.get(flag.sectionId)
        if (!bucket) continue
        // Map the free-text reason to one of the three AI flag codes so
        // the rubric can weight it. Simple heuristic — the LLM's own
        // narrative is kept in reasonsBySection for the report panel.
        const code = classifyAiReason(flag.reason)
        bucket.push(code)
        ;(reasonsBySection.get(flag.sectionId) ?? reasonsBySection.set(flag.sectionId, []).get(flag.sectionId)!)
          .push(flag.reason)
      }
      log.info({ documentId, iteration, aiFlaggedCount: aiFlagged.length }, 'ai_validation_pass: Claude critique applied')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.warn({ documentId, iteration, err: message }, 'ai_validation_pass: Claude critique failed — continuing with completeness only')
    }
  }

  // --- Compute scores + persist per-section + build report snapshot -----
  const perSectionScores: number[] = []
  const reportSnapshot: Array<{
    sectionId: string
    sectionNumber: string
    confidence: number
    flags: string[]
    reasons: string[]
  }> = []
  const failingIds: string[] = []

  await prisma.$transaction(async (tx) => {
    for (const row of rows) {
      const flags = flagsBySection.get(row.sectionId) ?? []
      const reasons = reasonsBySection.get(row.sectionId) ?? []
      const confidence = scoreSection(flags)
      perSectionScores.push(confidence)
      reportSnapshot.push({
        sectionId:     row.sectionId,
        sectionNumber: row.sectionNumber,
        confidence,
        flags,
        reasons,
      })
      if (flags.length > 0) failingIds.push(row.sectionId)
      await tx.sectionContent.update({
        where: { id: row.id },
        data:  { aiConfidence: confidence, aiFlags: flags },
      })
    }
  })

  const confidenceOverall = overallConfidence(perSectionScores)
  const stop = shouldStopLoop({ iteration, confidenceOverall, failingCount: failingIds.length })

  log.info({
    documentId,
    iteration,
    sectionsTotal: rows.length,
    failing:       failingIds.length,
    confidenceOverall,
    willStop:      stop,
  }, 'ai_validation_pass: evaluated')

  // --- Persist document roll-up + log this pass -------------------------
  const nextState: 'validating' | 'complete' = stop ? 'complete' : 'validating'
  const passFinishedAt = new Date()
  await prisma.$transaction([
    prisma.document.update({
      where: { id: documentId },
      data: {
        aiDraftState:        nextState,
        aiConfidenceOverall: confidenceOverall,
        aiLastPassAt:        passFinishedAt,
        aiLastPassNumber:    iteration,
      },
    }),
    prisma.aiDraftingPass.upsert({
      where:  { documentId_passNumber: { documentId, passNumber: iteration } },
      create: {
        documentId,
        versionId,
        passNumber:      iteration,
        startedAt:       passStartedAt,
        finishedAt:      passFinishedAt,
        sectionsFlagged: failingIds.length,
        confidenceAfter: confidenceOverall,
        modelUsed,
        flagsJson:       reportSnapshot as unknown as object,
      },
      update: {
        finishedAt:      passFinishedAt,
        sectionsFlagged: failingIds.length,
        confidenceAfter: confidenceOverall,
        modelUsed,
        flagsJson:       reportSnapshot as unknown as object,
      },
    }),
  ])

  if (stop) {
    log.info({ documentId, iteration, confidenceOverall, residualFailing: failingIds.length }, 'ai_validation_pass: loop stopped')
    return {
      documentId,
      iteration,
      passing:            rows.length - failingIds.length,
      failing:            failingIds.length,
      failingIds,
      confidenceOverall,
      status:             failingIds.length === 0 ? 'complete' : 'complete_with_residuals',
    }
  }

  // Still below target + under the cap. Enqueue a targeted re-draft of
  // the failing sections followed by the next validation pass.
  try {
    await enqueue('clinical.ai_initial_draft', {
      documentId,
      versionId,
      projectId:        job.data.projectId,
      type:             job.data.type,
      sourceUploadIds:  job.data.sourceUploadIds,
      assigneeId:       job.data.assigneeId,
      actorId:          job.data.actorId,
      targetSectionIds: failingIds,
    }, { delayMs: 1_000, jobId: `ai-redraft-${documentId}-${iteration}` })

    await enqueue('clinical.ai_validation_pass', {
      ...job.data,
      iteration: iteration + 1,
    }, { delayMs: 10_000, jobId: `ai-validation-${documentId}-${iteration + 1}` })
  } catch (err) {
    log.error({ err, documentId, iteration }, 'ai_validation_pass: failed to enqueue re-draft or next pass — chain breaks')
    // Chain broke mid-loop; mark complete so the SPA stops polling.
    await prisma.document.update({
      where: { id: documentId },
      data:  { aiDraftState: 'complete' },
    }).catch(() => undefined)
  }

  return {
    documentId,
    iteration,
    passing:            rows.length - failingIds.length,
    failing:            failingIds.length,
    failingIds,
    confidenceOverall,
    status:             'reworking',
  }
}

/** Collapse Claude's free-text reason into one of the weighted codes. */
function classifyAiReason(reason: string): string {
  const r = reason.toLowerCase()
  if (/\b(unsupported|not supported by|no evidence|invent(ed)?|fabricat)/.test(r)) {
    return 'ai:unsupported_claim'
  }
  if (/\b(template|section (number|title|structure)|should (contain|include))/.test(r)) {
    return 'ai:template_mismatch'
  }
  if (/\b(coherence|incoherent|disjointed|inconsistent|contradict)/.test(r)) {
    return 'ai:coherence_issue'
  }
  return 'ai:self_critique'
}

// -------- LLM-gated check helpers ------------------------------------------

const MAX_SOURCE_BYTES_PER_DOC = 20 * 1024 * 1024
const MAX_CRITIQUE_OUTPUT_TOKENS = 2000

interface SourcePdfPayload {
  title: string
  bytes: Buffer
}

async function loadSourcePdfsForJob(
  prisma: Parameters<JobHandler>[1]['prisma'],
  sourceUploadIds: string[],
  log: Parameters<JobHandler>[1]['log'],
): Promise<SourcePdfPayload[]> {
  if (sourceUploadIds.length === 0) return []
  const uploads = await prisma.documentUpload.findMany({
    where: { id: { in: sourceUploadIds } },
    select: { id: true, title: true, fileName: true, blobKey: true, contentType: true },
  })
  const reader = createBlobReaderFromEnv()
  const out: SourcePdfPayload[] = []
  for (const u of uploads) {
    if (u.contentType !== 'application/pdf') continue
    try {
      const { bytes } = await reader.read('documents', u.blobKey)
      if (bytes.length > MAX_SOURCE_BYTES_PER_DOC) continue
      out.push({ title: u.title ?? u.fileName, bytes })
    } catch (err) {
      log.warn({ sourceId: u.id, err: err instanceof Error ? err.message : String(err) }, 'validation: could not read source blob')
    }
  }
  return out
}

interface AiCheckFlag {
  sectionId: string
  reason:    string
}

/**
 * One Claude call that runs both self-critique and cross-source
 * consistency over the entire drafted document. Returns a flat list of
 * { sectionId, reason } objects; sections not in the list are deemed
 * acceptable by Claude for this pass.
 *
 * Response is coerced through JSON.parse — Claude is told to return a
 * JSON array only. If parsing fails, the caller treats the whole check
 * as a no-op (completeness-only path still applies) rather than
 * failing the chain.
 */
async function runLlmChecks(args: {
  apiKey:     string
  model:      string
  docType:    string
  sections:   Array<{ id: string; html: string }>
  sourcePdfs: SourcePdfPayload[]
  aiInstructions: string | null
}): Promise<AiCheckFlag[]> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk').catch(() => {
    throw new Error('ANTHROPIC_API_KEY is set but @anthropic-ai/sdk is not installed in apps/worker.')
  })
  const client = new Anthropic({ apiKey: args.apiKey })

  // Author's instructions anchor the "Template compliance" judgement
  // when they override defaults (e.g. "draft in Japanese" — the critic
  // mustn't flag Japanese prose as off-template). Omitted when null.
  const authorBlock = args.aiInstructions
    ? [
        ``,
        `Author's instructions for this document (judge sections AGAINST these, not against defaults):`,
        args.aiInstructions,
        ``,
      ].join('\n')
    : ''

  const system = [
    `You are reviewing a draft of a regulatory clinical writing deliverable (${args.docType}) for quality issues.`,
    `For every section, judge:`,
    `  1. Coherence — is the prose internally consistent + well-structured?`,
    `  2. Factual gaps — does it leave required material unaddressed?`,
    `  3. Template compliance — does it match what this section number/title should contain for a ${args.docType}?`,
    `  4. Source consistency — are the quantitative/clinical claims supported by the attached source documents?`,
    `Return ONLY a JSON array of { "sectionId": "...", "reason": "short issue summary" } for sections that need revision.`,
    `Return an EMPTY array ("[]") if every section passes. No prose before or after. No code fences.`,
    authorBlock,
  ].join('\n')

  const sectionList = args.sections
    .map(s => `--- sectionId: ${s.id} ---\n${s.html}`)
    .join('\n\n')

  const pdfBlocks = args.sourcePdfs.map(p => ({
    type: 'document' as const,
    source: {
      type:       'base64' as const,
      media_type: 'application/pdf' as const,
      data:       p.bytes.toString('base64'),
    },
    title: p.title,
  }))

  const userPrompt = [
    `Attached sources (reference for the source-consistency check):`,
    args.sourcePdfs.length === 0 ? '(none)' : args.sourcePdfs.map(p => `- ${p.title}`).join('\n'),
    ``,
    `Draft sections to review:`,
    sectionList,
    ``,
    `Return the JSON array of sections that need revision.`,
  ].join('\n')

  const message = await client.messages.create({
    model:      args.model,
    max_tokens: MAX_CRITIQUE_OUTPUT_TOKENS,
    system,
    messages: [
      {
        role: 'user',
        content: [
          ...pdfBlocks,
          { type: 'text', text: userPrompt },
        ],
      },
    ],
  })

  const text = message.content
    .map(b => (b.type === 'text' ? (b as { type: 'text'; text: string }).text : ''))
    .join('\n')
    .trim()
  if (!text) return []

  // Strip a possible code-fence wrapper; parse; coerce.
  const stripped = text.replace(/^\s*```[a-zA-Z]*\s*\n?/, '').replace(/\n?\s*```\s*$/, '').trim()
  let parsed: unknown
  try {
    parsed = JSON.parse(stripped)
  } catch {
    return []  // malformed response — treat the pass as critique-skipped
  }
  if (!Array.isArray(parsed)) return []

  const validIds = new Set(args.sections.map(s => s.id))
  const out: AiCheckFlag[] = []
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue
    const row = item as { sectionId?: unknown; reason?: unknown }
    if (typeof row.sectionId !== 'string' || !validIds.has(row.sectionId)) continue
    out.push({
      sectionId: row.sectionId,
      reason:    typeof row.reason === 'string' ? row.reason.slice(0, 240) : 'needs revision',
    })
  }
  return out
}
