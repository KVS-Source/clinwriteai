// AI validation-pass worker — M4 of the New Document rework.
//
// Runs after clinical.ai_initial_draft completes a document (chained via
// the enqueue in ai-initial-draft.ts). Each pass evaluates every section
// against a battery of checks, collects the failing sections, and — if
// any fail AND the iteration cap isn't reached — enqueues a targeted
// re-draft that only touches the failing sections, then re-enqueues
// itself for the next iteration.
//
// Current checks (M4 slice):
//   1. Completeness — contentHtml must have at least MIN_CONTENT_CHARS
//      visible characters after stripping tags. Catches sections the
//      drafter left blank or that stub-returned an empty string.
//
// Deferred to a later milestone (needs real LLM):
//   2. AI self-critique — have the model review the drafted doc for
//      coherence, factual gaps, structure mismatches with the template.
//   3. Cross-source consistency — verify every quantitative claim in the
//      draft is supported by one of the attached sources.
//
// Both deferred checks slot into the sections.push(failReason) call sites
// below — just add two more deterministic/LLM-based gates alongside the
// completeness one and the re-draft loop picks them up unchanged.
//
// Loop protection:
//   - MAX_ITERATIONS caps the chain at 5 passes. Beyond that the handler
//     logs the final failing set and stops without re-enqueueing.
//   - On idle passes (nothing failing), the handler returns clean and
//     does NOT re-enqueue itself — the loop ends cleanly.
//   - Each enqueued pass carries a deterministic jobId so BullMQ dedupes
//     accidental double-fires.

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
  const failingIds = results.filter(r => !r.pass).map(r => r.sectionId)

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
