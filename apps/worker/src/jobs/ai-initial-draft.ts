// AI initial-draft worker — Module A New Document "Draft with AI" opt-in.
//
// Scope (M3 + M5 of the Create-Document rework):
//   - Load the DocumentTemplate for the document's type
//   - Load the source documents attached to the new document (as PDF
//     attachments on the Claude message when the key is present)
//   - For each section in the template, generate initial content and
//     write it to the SectionContent row + an EditHistory entry so the
//     editor's per-section Undo stack respects the AI origin
//   - On completion, chain to clinical.ai_validation_pass
//
// LLM provider: Anthropic Claude when ANTHROPIC_API_KEY is set, with
// the model id taken from ANTHROPIC_DRAFT_MODEL (default
// 'claude-sonnet-4-5'). Mirrors the pattern already used by the
// Whisper transcription job — admins override per deployment via env.
// When no key is present, falls back to a deterministic stub so the
// pipeline is still testable without network calls.
//
// Idempotency: enqueued with jobId=`ai-initial-draft-${documentId}` so
// BullMQ dedupes retries. The handler also skips any section whose
// SectionContent.contentHtml is non-empty — writers who've already
// started typing in a section before the worker ran don't lose their
// edits. The validation-loop re-draft path (targetSectionIds) bypasses
// this guard intentionally; those sections failed a check and need to
// be rewritten.
//
// Observability: failures per section are logged but don't fail the
// whole job; the handler returns a report of drafted + skipped +
// errored sections so the generic worker wrapper's log line captures
// the useful numbers.

import { createBlobReaderFromEnv } from '../blob-reader.js'
import { resolveDraftModel } from '../ai-engine-settings.js'
import { resolveForDocument, renderPolicyPromptBlock, type PolicyRowForAi } from './policy-prompt.js'
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
  id:          string
  title:       string
  fileName:    string
  category:    string | null
  blobKey:     string
  contentType: string
}

interface SourcePdfPayload {
  title:    string
  category: string | null
  bytes:    Buffer
}

// Only ever written when AI_ALLOW_STUB=1 (dev/CI). Matched by the API's placeholder guard.
const STUB_HEAD = '[AI-drafted initial content — ANTHROPIC_API_KEY not set, deterministic stub shown instead.]'

// Max bytes any single source attachment is allowed to contribute.
// Anthropic's per-document limit is 25MB; capping at 20MB leaves
// headroom for the surrounding JSON wrapper.
const MAX_SOURCE_BYTES = 20 * 1024 * 1024

// Max output tokens per section. Enough for ~1500-2000 words of
// Clinical prose at typical ICH density. Can tune per section number
// later (e.g. §16 appendices need more).
const MAX_SECTION_OUTPUT_TOKENS = 2000

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
 * section's contentHtml. Routes to Anthropic Claude when
 * ANTHROPIC_API_KEY is present; otherwise falls back to a deterministic
 * stub so the pipeline is end-to-end testable without an API key.
 *
 * Model id: ANTHROPIC_DRAFT_MODEL env (default 'claude-sonnet-4-5').
 * Admins override per deployment; a future Admin Panel field will
 * configure this per-tenant.
 */
async function draftSection(args: {
  section:   SectionTemplate
  sources:   SourceSummary[]
  sourcePdfs: SourcePdfPayload[]
  docType:   string
  model:     string
  aiInstructions: string | null
  policy:    PolicyRowForAi | null
}): Promise<{ contentHtml: string; engine: string }> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim()
  if (!apiKey) {
    // The caller checks aiConfigured() first, so this is only reached with the dev/CI flag on.
    if (!stubAllowed()) throw new Error('AI not configured')
    return { contentHtml: buildStubDraftHtml(args), engine: 'stub' }
  }
  // A failed Claude call throws: the section is left empty and reported as errored. Placeholder
  // text is never written into a document as if it were a draft.
  const html = await draftWithClaude({ ...args, apiKey })
  return { contentHtml: html, engine: args.model }
}

/** Dev/CI only: AI_ALLOW_STUB=1 lets the placeholder drafter run. Off by default. */
function stubAllowed(): boolean {
  return process.env.AI_ALLOW_STUB === '1'
}

/** A real provider is available (an Anthropic key), or the dev/CI stub is explicitly allowed. */
function aiConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY?.trim() || stubAllowed()
}

/**
 * Call Claude once with the attached source PDFs and the section brief.
 * Response is coerced to HTML — the system prompt tells Claude to emit
 * HTML paragraphs/lists, but if it leaves a code-fence wrapper or
 * trailing commentary we strip it.
 */
async function draftWithClaude(args: {
  section:    SectionTemplate
  sources:    SourceSummary[]
  sourcePdfs: SourcePdfPayload[]
  docType:    string
  apiKey:     string
  model:      string
  aiInstructions: string | null
  policy:     PolicyRowForAi | null
}): Promise<string> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk').catch(() => {
    throw new Error('ANTHROPIC_API_KEY is set but @anthropic-ai/sdk is not installed in apps/worker.')
  })
  const client = new Anthropic({ apiKey: args.apiKey })

  // Author's instructions are rendered as their own block so they
  // visibly steer the draft without displacing the structural rules
  // (HTML-only output, no invented numbers, etc.). Omitted entirely
  // when null — no empty block, no "Instructions: none" header.
  const authorBlock = args.aiInstructions
    ? [
        ``,
        `Author's instructions for this draft (follow these in addition to the rules above):`,
        args.aiInstructions,
        ``,
      ].join('\n')
    : ''

  // DocumentTypePolicy block — SME prompt + document-wide BP principles +
  // section-scoped rules for THIS section. Empty string when no policy is
  // attached to the doc type (then AI falls back to the built-in rules
  // above). Policy is pinned at document create time so later version
  // bumps don't rewrite drafts of already-authored documents.
  const policyBlock = renderPolicyPromptBlock(args.policy, args.section.id)
  const policySection = policyBlock ? `\n\n${policyBlock}\n` : ''

  const system = [
    `You are drafting a single section of a regulatory clinical writing deliverable.`,
    `Document type: ${args.docType}.`,
    `Section number: ${args.section.number}`,
    `Section title: ${args.section.title}`,
    `Write a thorough first-pass draft of this section ONLY (not the surrounding document) based strictly on the attached source documents.`,
    `Return clean HTML with <p>, <ul>/<li>, and <table> as appropriate — no Markdown, no code fences, no commentary before or after the HTML.`,
    `If the sources genuinely do not contain the information needed for this section, write a short <p>stating what is missing and what the writer should supply.</p>`,
    `Do not invent numeric values, patient counts, dates, or citations. Quote figures only when they appear in the sources.`,
    authorBlock,
    policySection,
  ].join('\n')

  // Build the content array: PDFs first (so Claude reads context before
  // the ask), then the prompt. Each PDF is a 'document' block with
  // base64 bytes. Filename title in the preamble helps Claude cite the
  // right source in prose.
  const pdfBlocks = args.sourcePdfs.map(p => ({
    type: 'document' as const,
    source: {
      type:       'base64' as const,
      media_type: 'application/pdf' as const,
      data:       p.bytes.toString('base64'),
    },
    title: p.title,
  }))

  const sourceList = args.sources.length === 0
    ? '(No source documents attached.)'
    : args.sources.map(s => `- ${s.title || s.fileName}${s.category ? ` [${s.category}]` : ''}`).join('\n')

  const userPrompt =
    `Draft section ${args.section.number} "${args.section.title}" of a ${args.docType}.\n\n` +
    `Attached sources:\n${sourceList}\n\n` +
    `Return HTML only.`

  const message = await client.messages.create({
    model:      args.model,
    max_tokens: MAX_SECTION_OUTPUT_TOKENS,
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

  // Response content is an array of blocks; concatenate text blocks.
  // Narrow via b.type instead of a predicate so we don't drag in the
  // full TextBlock shape (which carries extra fields we don't need).
  const text = message.content
    .map(b => (b.type === 'text' ? (b as { type: 'text'; text: string }).text : ''))
    .join('\n')
    .trim()

  if (!text) {
    throw new Error('Claude returned no text content')
  }
  return stripCodeFence(text)
}

/** "```html\n…\n```" → "…" (Claude occasionally wraps despite the system prompt). */
function stripCodeFence(text: string): string {
  const m = /^\s*```[a-zA-Z]*\s*\n([\s\S]*?)\n?```\s*$/.exec(text)
  return (m ? m[1]! : text).trim()
}

interface Report {
  drafted:  number
  skipped:  number   // section already had content; left alone
  errored:  Array<{ sectionId: string; error: string }>
}

export const handleAiInitialDraft: JobHandler<AiInitialDraftPayload> = async (job, { prisma, log, enqueue }) => {
  const { documentId, versionId, type, sourceUploadIds, targetSectionIds } = job.data

  // --- No AI set up: draft nothing --------------------------------------
  // Sections stay empty (the API seeded them blank), nothing is queued after this, and the document's
  // draft status says "AI not configured" so the writer sees why.
  if (!aiConfigured()) {
    log.warn({ documentId }, 'ai_initial_draft: AI not configured — sections left empty')
    if (!targetSectionIds || targetSectionIds.length === 0) {
      await prisma.document.update({
        where: { id: documentId },
        data:  { aiDraftState: 'not_configured' },
      }).catch(() => undefined)
    }
    return { skipped: 'ai_not_configured' }
  }

  // --- Mark document as drafting (migration 56, 2026-11-02) --------------
  // Writers polling GET /documents/:id/ai-draft-status need a signal that
  // the worker has picked the job up. Only move state → 'drafting' from a
  // full-document initial draft; targeted re-drafts fired by the validator
  // keep state='validating' so the SPA doesn't bounce back to the drafting
  // toast mid-loop.
  if (!targetSectionIds || targetSectionIds.length === 0) {
    await prisma.document.update({
      where: { id: documentId },
      data:  { aiDraftState: 'drafting' },
    }).catch((err: unknown) => {
      log.warn({ err, documentId }, 'ai_initial_draft: could not set aiDraftState=drafting (document gone?)')
    })
  }

  // --- Resolve the drafting model (DB-saved default → env → hardcode) ----
  // tenantId lookup via projectId; passed to resolveDraftModel so the
  // helper is ready for per-tenant selection without further wiring.
  const project = await prisma.project.findUnique({
    where: { id: job.data.projectId },
    select: { tenantId: true },
  })
  const resolvedModel = await resolveDraftModel(prisma, project?.tenantId ?? null)

  // --- Load the author's AI instructions (migration 58) -----------------
  // Flows into the Claude system prompt below so language / tone /
  // structure directives steer every section. Null = default behaviour.
  // Also pick up the pinned policy version so the DocumentTypePolicy
  // block (SME prompt + BP digest + section rules) can be assembled
  // against the same rule-set the document was created under.
  const docRow = await prisma.document.findUnique({
    where:  { id: documentId },
    select: { aiInstructions: true, policyVersionAtCreate: true },
  })
  const aiInstructions = docRow?.aiInstructions?.trim() || null
  const policy = await resolveForDocument(prisma, {
    docType:               type,
    policyVersionAtCreate: docRow?.policyVersionAtCreate ?? null,
  })
  if (policy) {
    log.info({ documentId, policyId: policy.id, policyVersion: policy.version }, 'ai_initial_draft: policy resolved')
  }

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

  // --- Load the sources (metadata) --------------------------------------
  const sources: SourceSummary[] = sourceUploadIds.length === 0
    ? []
    : (await prisma.documentUpload.findMany({
        where: { id: { in: sourceUploadIds } },
        select: {
          id: true, title: true, fileName: true, sourceCategory: true,
          blobKey: true, contentType: true,
        },
      })).map(u => ({
        id: u.id,
        title: u.title ?? '',
        fileName: u.fileName,
        category: u.sourceCategory,
        blobKey: u.blobKey,
        contentType: u.contentType,
      }))

  // --- Load source PDF bytes once (reused across every section call) ----
  // Non-PDF sources are skipped; the stub path doesn't need the bytes at
  // all. Only runs when the Anthropic key is present to avoid wasting IO
  // on stub-mode drafts.
  const sourcePdfs: SourcePdfPayload[] = []
  if (process.env.ANTHROPIC_API_KEY?.trim() && sources.length > 0) {
    const reader = createBlobReaderFromEnv()
    for (const src of sources) {
      if (src.contentType !== 'application/pdf') continue
      try {
        const { bytes } = await reader.read('documents', src.blobKey)
        if (bytes.length > MAX_SOURCE_BYTES) {
          log.warn({ documentId, sourceId: src.id, size: bytes.length }, 'ai_initial_draft: source exceeds per-document cap — dropped')
          continue
        }
        sourcePdfs.push({ title: src.title || src.fileName, category: src.category, bytes })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        log.warn({ documentId, sourceId: src.id, err: message }, 'ai_initial_draft: could not read source blob — dropped')
      }
    }
  }

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
      const { contentHtml, engine } = await draftSection({
        section: sec, sources, sourcePdfs, docType: type, model: resolvedModel, aiInstructions, policy,
      })

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
            // Clinical-section convenience columns. The DB column is
            // NOT NULL (migration 38) even though the Prisma schema has
            // it as optional (migration 39 didn't relax the constraint
            // — drift). Writing them here keeps inserts valid and the
            // Module A index on (documentId, sectionId, createdAt) hot.
            documentId,
            sectionId:          sec.id,
            documentVersionId:  versionId,
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
  // Every section errored (e.g. the provider is down): nothing was drafted, so there is nothing to
  // validate. Mark the chain failed so the writer sees it and can retry; sections stay empty.
  if (!targetSet && report.drafted === 0 && report.errored.length > 0) {
    await prisma.document.update({
      where: { id: documentId },
      data:  { aiDraftState: 'failed' },
    }).catch(() => undefined)
    return { documentId, sectionsTotal: sections.length, drafted: 0, skipped: report.skipped, errored: report.errored }
  }

  if (!targetSet) {
    // Flip state → 'validating' before enqueueing so the SPA's progress
    // toast moves off "Drafting…" the moment the drafter commits.
    await prisma.document.update({
      where: { id: documentId },
      data:  { aiDraftState: 'validating' },
    }).catch((err: unknown) => {
      log.warn({ err, documentId }, 'ai_initial_draft: could not set aiDraftState=validating')
    })
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
      // If we can't enqueue the validator, mark the chain as complete so
      // the SPA stops polling. The sections ARE drafted at this point —
      // only the critique/consistency loop didn't run.
      await prisma.document.update({
        where: { id: documentId },
        data:  { aiDraftState: 'complete' },
      }).catch(() => undefined)
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
