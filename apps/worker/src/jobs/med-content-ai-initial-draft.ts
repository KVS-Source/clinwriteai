// Med content AI initial-draft worker — Module C analogue of
// publications.ai_initial_draft. Section-by-section Claude call on
// every MedContentSection row of the current version.
//
// Scope:
//   - Load MedContentItem + current version + section rows
//   - Attach source PDFs from ContentUpload rows linked to this item
//     (via upload.contentItemId) — same shape as pub source auto-attach
//   - Compose policy block (SME + compliance track + BP digest + section rules)
//     + SECTION_GROUNDING_RULES + author aiInstructions
//   - Call Claude per section; write results to MedContentSection.contentHtml
//   - On completion: flip aiDraftState → 'validating' and chain to
//     med_content.ai_validation_pass
//
// hcp_slide_deck still uses the existing generate-med-slide worker
// for slide authoring — this worker's "overview" section stays as a
// scaffold on that content type.

import { createBlobReaderFromEnv } from '../blob-reader.js'
import { resolveDraftModel } from '../ai-engine-settings.js'
import {
  resolveMedPolicyForContent,
  renderMedPolicyPromptBlock,
  SECTION_GROUNDING_RULES,
  type MedPolicyRowForAi,
} from './med-policy-prompt.js'
import { DRAFT_OUTPUT_TOKENS } from '../token-limits.js'
import type { JobHandler } from './types.js'

interface MedAiInitialDraftPayload {
  contentItemId:    string
  projectId:        string
  actorId:          string
  targetSectionIds?: string[]
}

interface SectionTemplate {
  id:     string
  number: string
  title:  string
}

interface SourcePdfPayload {
  title: string
  bytes: Buffer
}

const MAX_SOURCE_BYTES = 20 * 1024 * 1024
// Env-tunable via AI_MAX_OUTPUT_TOKENS_DRAFT (default 8000, centralised
// 2026-11-27). Was 2000 historically.
const MAX_SECTION_OUTPUT_TOKENS = DRAFT_OUTPUT_TOKENS

function stubAllowed(): boolean { return process.env.AI_ALLOW_STUB === '1' }
function aiConfigured(): boolean { return !!process.env.ANTHROPIC_API_KEY?.trim() || stubAllowed() }

function escapeHtml(input: string): string {
  return input.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function buildStubDraftHtml(args: { section: SectionTemplate; sourcePdfs: SourcePdfPayload[]; docType: string }): string {
  const sourcesList = args.sourcePdfs.length === 0
    ? '<p><em>No source documents attached.</em></p>'
    : `<ul>${args.sourcePdfs.map(p => `<li>${escapeHtml(p.title)}</li>`).join('')}</ul>`
  return [
    `<p><em>[AI-drafted initial content — ANTHROPIC_API_KEY not set, deterministic stub shown instead.]</em></p>`,
    `<p>Section <strong>${escapeHtml(args.section.number)}</strong> &mdash; <strong>${escapeHtml(args.section.title)}</strong> (${escapeHtml(args.docType)})</p>`,
    sourcesList,
  ].join('\n')
}

function stripCodeFence(text: string): string {
  const m = /^\s*```[a-zA-Z]*\s*\n([\s\S]*?)\n?```\s*$/.exec(text)
  return (m ? m[1]! : text).trim()
}

async function draftWithClaude(args: {
  section:        SectionTemplate
  sourcePdfs:     SourcePdfPayload[]
  docType:        string
  model:          string
  apiKey:         string
  aiInstructions: string | null
  policy:         MedPolicyRowForAi | null
  sectionTemplateInstructions: string | null
  sectionTemplateGuidance:     string | null
}): Promise<string> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk').catch(() => {
    throw new Error('ANTHROPIC_API_KEY set but @anthropic-ai/sdk is not installed in apps/worker.')
  })
  const client = new Anthropic({ apiKey: args.apiKey })

  const authorBlock = args.aiInstructions
    ? ['', `Author's instructions for this draft (follow these in addition to the rules above):`, args.aiInstructions, ''].join('\n')
    : ''

  const policyBlock = renderMedPolicyPromptBlock(args.policy, args.section.id)
  const policySection = policyBlock ? `\n\n${policyBlock}\n` : ''

  const complianceHint = args.policy?.complianceTrack
    ? `Compliance track: ${args.policy.complianceTrack}. Draft content so it can pass the matching review path (promotional → MLR ad review; non_promotional → scientific review; cme → ACCME; advisory → KOL board summary).`
    : ''

  // Per-section template content guidance (migration 105 Package C-6)
  // — snapshotted from MedContentTemplate at content-create by the API
  // (Package C-3) and read here from the MedContentSection row.
  // Identical block shape Clinical P11 + Publication B-6 use so the
  // first draft and subsequent rewrites answer against the same
  // authored intent.
  const tIns  = (args.sectionTemplateInstructions ?? '').trim()
  const tGuid = (args.sectionTemplateGuidance     ?? '').trim()
  const templateGuidanceBlock = tIns || tGuid
    ? [
        ``,
        `TEMPLATE GUIDANCE for this section (from the template authored for ${args.docType}):`,
        tIns  ? `  Content requirements:\n    ${tIns.replace(/\n/g, '\n    ')}` : '',
        tGuid ? `  Writing guidance:\n    ${tGuid.replace(/\n/g, '\n    ')}` : '',
        `Follow these precisely — they are the template's authored intent for this section.`,
        ``,
      ].filter(Boolean).join('\n')
    : ''

  const system = [
    `You are drafting a single section of a medical-communications deliverable.`,
    `Document type: ${args.docType}.`,
    `Section id: ${args.section.id} — number ${args.section.number} — title ${args.section.title}.`,
    `Write a thorough first-pass draft of this section ONLY based strictly on the attached source documents.`,
    `Return clean HTML with <p>, <ul>/<li>, and <table> as appropriate — no Markdown, no code fences, no commentary before or after the HTML.`,
    `Where the sources do not contain a piece of information this section needs, insert [TBD: what is needed] markers — never fabricate numbers, patient counts, dates, trial identifiers, or citations.`,
    `NEVER write a sentence that explains sources are incomplete — the section must read as document text with [TBD: ...] placeholders in the gaps.`,
    complianceHint,
    '',
    SECTION_GROUNDING_RULES,
    authorBlock,
    policySection,
    templateGuidanceBlock,
  ].filter(Boolean).join('\n')

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
    `Draft section ${args.section.number} "${args.section.title}" of a ${args.docType}.`,
    args.sourcePdfs.length === 0
      ? 'No source PDFs attached — write the section structure with [TBD: ...] markers.'
      : `Attached sources:\n${args.sourcePdfs.map(p => `- ${p.title}`).join('\n')}`,
    '',
    'Return HTML only.',
  ].join('\n')

  const message = await client.messages.create({
    model:      args.model,
    max_tokens: MAX_SECTION_OUTPUT_TOKENS,
    system,
    messages: [
      { role: 'user', content: [...pdfBlocks, { type: 'text', text: userPrompt }] },
    ],
  })

  const text = message.content
    .map(b => (b.type === 'text' ? (b as { type: 'text'; text: string }).text : ''))
    .join('\n')
    .trim()
  if (!text) throw new Error('Claude returned no text content for med content section draft')
  return stripCodeFence(text)
}

async function draftSection(args: {
  section:        SectionTemplate
  sourcePdfs:     SourcePdfPayload[]
  docType:        string
  model:          string
  aiInstructions: string | null
  policy:         MedPolicyRowForAi | null
  sectionTemplateInstructions: string | null
  sectionTemplateGuidance:     string | null
}): Promise<{ contentHtml: string; engine: string }> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim()
  if (!apiKey) {
    if (!stubAllowed()) throw new Error('AI not configured')
    return { contentHtml: buildStubDraftHtml(args), engine: 'stub' }
  }
  const html = await draftWithClaude({ ...args, apiKey })
  return { contentHtml: html, engine: args.model }
}

interface Report {
  drafted: number
  skipped: number
  errored: Array<{ sectionId: string; error: string }>
}

export const handleAiInitialDraftMedContent: JobHandler<MedAiInitialDraftPayload> = async (
  job, { prisma, log, enqueue },
) => {
  const { contentItemId, targetSectionIds } = job.data

  if (!aiConfigured()) {
    log.warn({ contentItemId }, 'med_ai_initial_draft: AI not configured — sections left empty')
    if (!targetSectionIds || targetSectionIds.length === 0) {
      await prisma.medContentItem.update({
        where: { id: contentItemId },
        data:  { aiDraftState: 'idle' },
      }).catch(() => undefined)
    }
    return { skipped: 'ai_not_configured' }
  }

  if (!targetSectionIds || targetSectionIds.length === 0) {
    await prisma.medContentItem.update({
      where: { id: contentItemId },
      data:  { aiDraftState: 'drafting' },
    }).catch((err: unknown) => {
      log.warn({ err, contentItemId }, 'med_ai_initial_draft: could not set aiDraftState=drafting')
    })
  }

  const item = await prisma.medContentItem.findUnique({
    where: { id: contentItemId },
    select: {
      id: true, type: true, currentVersionId: true, archivedAt: true,
      aiInstructions: true,
      medContentTypePolicyVersionAtCreate:   true,
      medContentAiPromptRecordId:            true,
      medContentBestPracticeRecordId:        true,
    },
  })
  if (!item || item.archivedAt) {
    log.warn({ contentItemId }, 'med_ai_initial_draft: item not found or archived')
    return { skipped: 'not_found' }
  }
  if (!item.currentVersionId) {
    log.warn({ contentItemId }, 'med_ai_initial_draft: no current version — create flow did not seed v0.1?')
    return { skipped: 'no_current_version' }
  }

  const docType = item.type.toLowerCase().replace(/-/g, '_')

  const project = await prisma.project.findUnique({
    where: { id: job.data.projectId },
    select: { tenantId: true },
  })
  const resolvedModel = await resolveDraftModel(prisma, project?.tenantId ?? null)

  const policy = await resolveMedPolicyForContent(prisma, {
    docType,
    medContentTypePolicyVersionAtCreate:  item.medContentTypePolicyVersionAtCreate,
    medContentAiPromptRecordId:           item.medContentAiPromptRecordId,
    medContentBestPracticeRecordId:       item.medContentBestPracticeRecordId,
  })
  if (policy) {
    log.info({ contentItemId, policyId: policy.id, policyVersion: policy.version, complianceTrack: policy.complianceTrack }, 'med_ai_initial_draft: policy resolved')
  }

  // Load source PDFs: ContentUpload rows scoped to this content item.
  const sourcePdfs: SourcePdfPayload[] = []
  if (process.env.ANTHROPIC_API_KEY?.trim()) {
    const uploads = await prisma.contentUpload.findMany({
      where:  { contentItemId },
      select: { id: true, fileName: true, blobKey: true, contentType: true },
    }).catch(() => [])
    const reader = createBlobReaderFromEnv()
    for (const u of uploads) {
      if ((u.contentType ?? '').toLowerCase() !== 'application/pdf') continue
      try {
        const { bytes } = await reader.read('documents', u.blobKey)
        if (bytes.length > MAX_SOURCE_BYTES) {
          log.warn({ contentItemId, uploadId: u.id, size: bytes.length }, 'med_ai_initial_draft: source exceeds cap — dropped')
          continue
        }
        sourcePdfs.push({ title: u.fileName, bytes })
      } catch (err) {
        log.warn({ contentItemId, uploadId: u.id, err: err instanceof Error ? err.message : String(err) }, 'med_ai_initial_draft: blob read failed — dropped')
      }
    }
  }

  const existing = await prisma.medContentSection.findMany({
    where: { medContentVersionId: item.currentVersionId },
    // Package C-6 (migration 105): pull the templateInstructions +
    // templateGuidance snapshotted at content-create (Package C-3)
    // so the drafter prompt gets the authored intent on first pass.
    select: {
      id: true, sectionId: true, sectionNumber: true, sectionTitle: true, contentHtml: true,
      templateInstructions: true, templateGuidance: true,
    },
  })
  const targetSet = targetSectionIds && targetSectionIds.length > 0 ? new Set(targetSectionIds) : null
  const sections = targetSet ? existing.filter(s => targetSet.has(s.sectionId)) : existing

  const report: Report = { drafted: 0, skipped: 0, errored: [] }

  for (const sec of sections) {
    if (!targetSet && sec.contentHtml && sec.contentHtml.trim().length > 0) {
      report.skipped++
      continue
    }
    const template: SectionTemplate = { id: sec.sectionId, number: sec.sectionNumber, title: sec.sectionTitle }
    try {
      const { contentHtml, engine } = await draftSection({
        section:        template,
        sourcePdfs,
        docType,
        model:          resolvedModel,
        aiInstructions: item.aiInstructions?.trim() || null,
        policy,
        sectionTemplateInstructions: sec.templateInstructions ?? null,
        sectionTemplateGuidance:     sec.templateGuidance     ?? null,
      })
      await prisma.medContentSection.update({
        where: { id: sec.id },
        data:  {
          contentHtml,
          wordCount:    contentHtml.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length,
          aiSpanCount:  1,
          lastEditedBy: job.data.actorId,
          lastEditedAt: new Date(),
        },
      })
      report.drafted++
      log.info({ contentItemId, sectionId: sec.sectionId, engine, length: contentHtml.length }, 'med_ai_initial_draft: section drafted')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.error({ contentItemId, sectionId: sec.sectionId, err: message }, 'med_ai_initial_draft: section failed')
      report.errored.push({ sectionId: sec.sectionId, error: message })
    }
  }

  log.info({
    contentItemId,
    sectionsTotal: sections.length,
    drafted: report.drafted,
    skipped: report.skipped,
    errored: report.errored.length,
  }, 'med_ai_initial_draft: complete')

  if (!targetSet && report.drafted === 0 && report.errored.length > 0) {
    await prisma.medContentItem.update({
      where: { id: contentItemId }, data: { aiDraftState: 'idle' },
    }).catch(() => undefined)
    return { contentItemId, sectionsTotal: sections.length, drafted: 0, skipped: report.skipped, errored: report.errored }
  }

  if (!targetSet) {
    await prisma.medContentItem.update({
      where: { id: contentItemId }, data: { aiDraftState: 'validating' },
    }).catch((err: unknown) => {
      log.warn({ err, contentItemId }, 'med_ai_initial_draft: could not set aiDraftState=validating')
    })
    try {
      await enqueue('med_content.ai_validation_pass', {
        contentItemId,
        versionId:   item.currentVersionId,
        projectId:   job.data.projectId,
        actorId:     job.data.actorId,
        iteration:   1,
      }, { delayMs: 2_000, jobId: `med-ai-validation-${contentItemId}-1` })
    } catch (err) {
      log.warn({ err, contentItemId }, 'med_ai_initial_draft: failed to enqueue validation — draft stands')
      await prisma.medContentItem.update({
        where: { id: contentItemId }, data: { aiDraftState: 'complete' },
      }).catch(() => undefined)
    }
  }

  return { contentItemId, sectionsTotal: sections.length, drafted: report.drafted, skipped: report.skipped, errored: report.errored }
}
