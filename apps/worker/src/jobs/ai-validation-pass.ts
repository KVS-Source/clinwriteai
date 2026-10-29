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

const MAX_ITERATIONS = 5

// Minimum visible-text length (stripped of HTML tags) a drafted section
// must have to count as "complete". Set deliberately low — the point is
// to catch empty / near-empty sections, not to enforce page counts.
const MIN_CONTENT_CHARS = 80

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

interface SectionResult {
  sectionId: string
  pass:      boolean
  reason:    string
}

export const handleAiValidationPass: JobHandler<AiValidationPassPayload> = async (job, { prisma, log, enqueue }) => {
  const { documentId, versionId, iteration } = job.data

  if (iteration > MAX_ITERATIONS) {
    log.warn({ documentId, iteration }, 'ai_validation_pass: iteration cap reached — stopping chain')
    return { skipped: 'iteration_cap_reached', iteration }
  }

  const rows = await prisma.sectionContent.findMany({
    where: { documentVersionId: versionId },
    select: { sectionId: true, contentHtml: true },
  })
  if (rows.length === 0) {
    log.warn({ documentId, versionId }, 'ai_validation_pass: no section_content rows — nothing to validate')
    return { skipped: 'no_sections', iteration }
  }

  const results: SectionResult[] = rows.map(row => {
    const visible = stripTags(row.contentHtml ?? '')
    if (visible.length < MIN_CONTENT_CHARS) {
      return { sectionId: row.sectionId, pass: false, reason: `content too short (${visible.length} < ${MIN_CONTENT_CHARS} chars)` }
    }
    return { sectionId: row.sectionId, pass: true, reason: 'completeness ok' }
  })
  const failingSet = new Set(results.filter(r => !r.pass).map(r => r.sectionId))

  // --- LLM-gated checks: self-critique + cross-source consistency ----
  // Only run when a key is present AND there's enough drafted content
  // to be worth critiquing. Combined into a single Claude call per pass
  // (one prompt, both check kinds) to keep cost + latency bounded.
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim()
  const hasDraftedContent = rows.some(r => stripTags(r.contentHtml ?? '').length >= MIN_CONTENT_CHARS)
  if (apiKey && hasDraftedContent) {
    try {
      const project = await prisma.project.findUnique({
        where: { id: job.data.projectId },
        select: { tenantId: true },
      })
      const model = await resolveDraftModel(prisma, project?.tenantId ?? null)
      const sourcePdfs = await loadSourcePdfsForJob(prisma, job.data.sourceUploadIds, log)
      const aiFlagged = await runLlmChecks({
        apiKey,
        model,
        docType:   job.data.type,
        sections:  rows.map(r => ({ id: r.sectionId, html: r.contentHtml ?? '' })),
        sourcePdfs,
      })
      for (const flag of aiFlagged) {
        failingSet.add(flag.sectionId)
        const target = results.find(r => r.sectionId === flag.sectionId)
        if (target && target.pass) {
          target.pass = false
          target.reason = `ai: ${flag.reason}`
        }
      }
      log.info({ documentId, iteration, aiFlaggedCount: aiFlagged.length }, 'ai_validation_pass: Claude critique applied')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.warn({ documentId, iteration, err: message }, 'ai_validation_pass: Claude critique failed — continuing with completeness only')
    }
  }
  const failingIds = Array.from(failingSet)

  log.info({
    documentId,
    iteration,
    sectionsTotal: results.length,
    failing:       failingIds.length,
  }, 'ai_validation_pass: evaluated')

  if (failingIds.length === 0) {
    log.info({ documentId, iteration }, 'ai_validation_pass: all sections passed — chain complete')
    return { documentId, iteration, passing: results.length, failing: 0, status: 'complete' }
  }

  // Still some failures. If we have budget, enqueue a targeted re-draft
  // then re-enqueue ourselves for the follow-up evaluation.
  if (iteration >= MAX_ITERATIONS) {
    log.warn({ documentId, iteration, failingIds }, 'ai_validation_pass: last iteration reached with sections still failing')
    return { documentId, iteration, passing: results.length - failingIds.length, failing: failingIds.length, status: 'exhausted', failingIds }
  }

  try {
    // Re-draft just the failing sections (ai_initial_draft honours
    // targetSectionIds). Delay 1s to let any in-flight writes commit.
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

    // Chase it with the next validation pass. 10s delay gives the draft
    // room to run (stub is instant; real LLM takes seconds per section).
    await enqueue('clinical.ai_validation_pass', {
      ...job.data,
      iteration: iteration + 1,
    }, { delayMs: 10_000, jobId: `ai-validation-${documentId}-${iteration + 1}` })
  } catch (err) {
    log.error({ err, documentId, iteration }, 'ai_validation_pass: failed to enqueue re-draft or next pass — chain breaks')
  }

  return {
    documentId,
    iteration,
    passing:    results.length - failingIds.length,
    failing:    failingIds.length,
    failingIds,
    status:     'reworking',
  }
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
}): Promise<AiCheckFlag[]> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk').catch(() => {
    throw new Error('ANTHROPIC_API_KEY is set but @anthropic-ai/sdk is not installed in apps/worker.')
  })
  const client = new Anthropic({ apiKey: args.apiKey })

  const system = [
    `You are reviewing a draft of a regulatory clinical writing deliverable (${args.docType}) for quality issues.`,
    `For every section, judge:`,
    `  1. Coherence — is the prose internally consistent + well-structured?`,
    `  2. Factual gaps — does it leave required material unaddressed?`,
    `  3. Template compliance — does it match what this section number/title should contain for a ${args.docType}?`,
    `  4. Source consistency — are the quantitative/clinical claims supported by the attached source documents?`,
    `Return ONLY a JSON array of { "sectionId": "...", "reason": "short issue summary" } for sections that need revision.`,
    `Return an EMPTY array ("[]") if every section passes. No prose before or after. No code fences.`,
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
