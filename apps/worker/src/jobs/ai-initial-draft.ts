// AI initial-draft worker — Module A New Document "Draft with AI" opt-in.
//
// Scope (M3 of the Create-Document rework):
//   - Load the DocumentTemplate for the document's type
//   - Load the source documents attached to the new document
//   - For each section in the template, generate initial content and
//     write it to the SectionContent row + an EditHistory entry so the
//     editor's per-section Undo stack respects the AI origin
//   - On completion, log the sections drafted + total length
//
// Current implementation: deterministic stub content per section (see
// buildStubDraftHtml). Mirrors the pattern already shipped for Whisper
// voice transcription (apps/worker/src/jobs/voice-transcribe.ts) — real
// LLM swap is a focused change in draftSection() once an API key is
// provisioned, and the surrounding wiring stays identical.
//
// Idempotency: enqueued with jobId=`ai-initial-draft-${documentId}` so
// BullMQ dedupes retries. The handler also skips any section whose
// SectionContent.contentHtml is non-empty — writers who've already
// started typing in a section before the worker ran don't lose their
// edits.
//
// Observability: failures per section are logged but don't fail the
// whole job; the handler returns a report of drafted + skipped +
// errored sections so the generic worker wrapper's log line captures
// the useful numbers.

import type { JobHandler } from './types.js'

interface AiInitialDraftPayload {
  documentId:       string
  versionId:        string
  projectId:        string
  type:             string                                   // 'csr-full', 'protocol', …
  sourceUploadIds:  string[]
  assigneeId:       string
  actorId:          string                                   // the user who clicked Create
  // When set, only these sections are (re)drafted. Used by the
  // clinical.ai_validation_pass loop to re-draft a specific subset of
  // sections that failed validation, rather than redoing the whole doc.
  // Omit for the initial full-document draft.
  targetSectionIds?: string[]
}

interface SectionTemplate {
  id:      string
  number:  string
  title:   string
  usOnly?: boolean
}

interface SourceSummary {
  id:        string
  title:     string
  fileName:  string
  category:  string | null
}

const STUB_HEAD = '[AI-drafted initial content — real LLM swap pending ANTHROPIC_API_KEY provisioning.]'

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Deterministic stub draft for one section. Shows the writer where the
 * content *would* come from so the architecture is visibly working
 * end-to-end even without a real LLM in place.
 *
 * When draftSection() is swapped for a real Claude / GPT call, this
 * function becomes the system-prompt scaffolding and the LLM response
 * is substituted for the stub body.
 */
function buildStubDraftHtml(args: {
  section:  SectionTemplate
  sources:  SourceSummary[]
  docType:  string
}): string {
  const { section, sources, docType } = args
  const srcList = sources.length === 0
    ? '<p><em>No source documents attached.</em></p>'
    : `<ul>${sources
          .map(s => `<li>${escapeHtml(s.title || s.fileName)}${s.category ? ` <span>(${escapeHtml(s.category)})</span>` : ''}</li>`)
          .join('')}</ul>`
  return [
    `<p><em>${STUB_HEAD}</em></p>`,
    `<p>Section <strong>${escapeHtml(section.number)}</strong> &mdash; <strong>${escapeHtml(section.title)}</strong></p>`,
    `<p>Document type: <code>${escapeHtml(docType)}</code>. The following source documents were referenced:</p>`,
    srcList,
  ].join('\n')
}

/**
 * Section-drafting dispatch. Returns the HTML to write into the
 * section's contentHtml. Stub for now; swap for a real LLM call once a
 * provider key is available. Keep the signature stable so the swap is
 * mechanical.
 */
async function draftSection(args: {
  section:  SectionTemplate
  sources:  SourceSummary[]
  docType:  string
}): Promise<{ contentHtml: string; engine: string }> {
  // Real LLM path will go here — e.g.:
  //   const key = process.env.ANTHROPIC_API_KEY
  //   if (key) {
  //     const text = await draftWithClaude({ ...args, apiKey: key })
  //     return { contentHtml: text, engine: 'claude-sonnet-4-6' }
  //   }
  // For now, every section gets the deterministic stub so the worker +
  // UI wiring is end-to-end testable without an API key.
  return { contentHtml: buildStubDraftHtml(args), engine: 'stub' }
}

interface Report {
  drafted:  number
  skipped:  number   // section already had content; left alone
  errored:  Array<{ sectionId: string; error: string }>
}

export const handleAiInitialDraft: JobHandler<AiInitialDraftPayload> = async (job, { prisma, log, enqueue }) => {
  const { documentId, versionId, type, sourceUploadIds, targetSectionIds } = job.data

  // --- Load the template -------------------------------------------------
  const template = await prisma.documentTemplate.findFirst({
    where: { type, isCurrent: true, retiredAt: null },
    select: { sections: true },
  })
  if (!template || !Array.isArray(template.sections)) {
    log.warn({ documentId, type }, 'ai_initial_draft: no DocumentTemplate found — nothing to draft')
    return { skipped: 'no_template' }
  }
  const allSections: SectionTemplate[] = (template.sections as unknown as SectionTemplate[])
    .filter(s => s && typeof s.id === 'string' && typeof s.number === 'string' && typeof s.title === 'string')

  // When this job was enqueued by the validation loop, only the failing
  // sections should be re-drafted — not the whole document. Falls through
  // to the full set for the initial draft.
  const targetSet = targetSectionIds && targetSectionIds.length > 0 ? new Set(targetSectionIds) : null
  const sections = targetSet ? allSections.filter(s => targetSet.has(s.id)) : allSections

  // --- Load the sources (metadata only — contents are read later if needed) ----
  const sources: SourceSummary[] = sourceUploadIds.length === 0
    ? []
    : (await prisma.documentUpload.findMany({
        where: { id: { in: sourceUploadIds } },
        select: { id: true, title: true, fileName: true, sourceCategory: true },
      })).map(u => ({ id: u.id, title: u.title ?? '', fileName: u.fileName, category: u.sourceCategory }))

  // --- Load the SectionContent rows the API seeded for this version ------
  const existing = await prisma.sectionContent.findMany({
    where: { documentVersionId: versionId },
    select: { id: true, sectionId: true, contentHtml: true },
  })
  const existingBySection = new Map(existing.map(e => [e.sectionId, e]))

  // --- Draft each section ------------------------------------------------
  const report: Report = { drafted: 0, skipped: 0, errored: [] }

  for (const sec of sections) {
    const row = existingBySection.get(sec.id)
    if (!row) {
      log.warn({ documentId, versionId, sectionId: sec.id }, 'ai_initial_draft: section row missing — skipping')
      report.skipped++
      continue
    }
    // Respect writer edits that beat the worker to the section — unless
    // the validation loop targeted this section explicitly (meaning the
    // existing content failed a check and should be rewritten).
    if (!targetSet && row.contentHtml && row.contentHtml.trim().length > 0) {
      report.skipped++
      continue
    }
    try {
      const { contentHtml, engine } = await draftSection({ section: sec, sources, docType: type })

      await prisma.$transaction(async (tx) => {
        await tx.sectionContent.update({
          where: { id: row.id },
          data:  {
            contentHtml,
            wordCount:     contentHtml.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length,
            aiSpanCount:   1,
            lastEditedBy:  job.data.actorId,
            lastEditedAt:  new Date(),
          },
        })
        await tx.editHistory.create({
          data: {
            entityType:   'clinical_section',
            entityId:     documentId,
            subUnitId:    sec.id,
            actorId:      job.data.actorId,
            origin:       'ai',
            beforeHtml:   '',
            afterHtml:    contentHtml,
          },
        })
      })
      report.drafted++
      log.info({ documentId, sectionId: sec.id, engine, length: contentHtml.length }, 'ai_initial_draft: section drafted')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.error({ documentId, sectionId: sec.id, err: message }, 'ai_initial_draft: section failed')
      report.errored.push({ sectionId: sec.id, error: message })
    }
  }

  log.info({
    documentId,
    sectionsTotal: sections.length,
    drafted: report.drafted,
    skipped: report.skipped,
    errored: report.errored.length,
  }, 'ai_initial_draft: complete')

  // M4 chain: enqueue the validation pass once this draft commits.
  // Short delay so the DB writes above are visible on read in the next
  // handler. iteration starts at 1; validation hard-caps at 5. Only
  // chain from a full-document draft (no targetSectionIds) — targeted
  // re-draft calls are themselves enqueued by validation and chaining
  // from them would double-schedule.
  if (!targetSet) {
    try {
      await enqueue('clinical.ai_validation_pass', {
        documentId,
        versionId,
        projectId:       job.data.projectId,
        type,
        sourceUploadIds,
        assigneeId:      job.data.assigneeId,
        actorId:         job.data.actorId,
        iteration:       1,
      }, { delayMs: 2_000, jobId: `ai-validation-${documentId}-1` })
    } catch (err) {
      log.warn({ err, documentId }, 'ai_initial_draft: failed to enqueue validation pass — draft stands')
    }
  }

  return {
    documentId,
    sectionsTotal: sections.length,
    drafted: report.drafted,
    skipped: report.skipped,
    errored: report.errored,
  }
}
