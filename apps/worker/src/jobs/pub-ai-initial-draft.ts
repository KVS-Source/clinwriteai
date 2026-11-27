// Publications AI initial-draft worker — Module B analogue of
// clinical.ai_initial_draft. Scope:
//
//   - Load the publication + its currentVersion + section_contents
//   - Attach source PDFs from the linked source document (Publication
//     → sourceDocumentId → DocumentSource → DocumentUpload rows). The
//     publication's own future source-upload table hooks in cleanly
//     when it lands.
//   - For each section the API seeded on v0.1, call Claude with the
//     publication policy block (SME prompt + guideline + BP digest +
//     section rules) + the shared SECTION_GROUNDING_RULES.
//   - Write results to PublicationSectionContent rows + bump the AI
//     span count on the row so the drafter's provenance is visible.
//   - On completion, chain to publications.ai_validation_pass.
//
// Idempotency: enqueued with jobId=`pub-ai-initial-draft-${publicationId}`.
// Writer-edited sections (non-empty contentHtml) are preserved on the
// full-document initial draft; the validation-pass loop's targeted
// re-draft (targetSectionIds set) bypasses this guard because those
// sections failed a check.

import { createBlobReaderFromEnv } from '../blob-reader.js'
import { resolveDraftModel } from '../ai-engine-settings.js'
import {
  resolvePubPolicyForPublication,
  renderPubPolicyPromptBlock,
  SECTION_GROUNDING_RULES,
  type PubPolicyRowForAi,
} from './pub-policy-prompt.js'
import { DRAFT_OUTPUT_TOKENS } from '../token-limits.js'
import type { JobHandler } from './types.js'

interface PubAiInitialDraftPayload {
  publicationId:   string
  projectId:       string
  actorId:         string
  targetSectionIds?: string[]              // set by the validation-pass loop
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
// 2026-11-27). Was 2000 historically — too tight for a full manuscript
// section; raised to the unified default so long sections finish.
const MAX_SECTION_OUTPUT_TOKENS = DRAFT_OUTPUT_TOKENS

function stubAllowed(): boolean {
  return process.env.AI_ALLOW_STUB === '1'
}
function aiConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY?.trim() || stubAllowed()
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Dev/CI only. Shown only when ANTHROPIC_API_KEY is unset AND AI_ALLOW_STUB=1. */
function buildStubDraftHtml(args: {
  section:  SectionTemplate
  sourcePdfs: SourcePdfPayload[]
  docType:  string
}): string {
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
  policy:         PubPolicyRowForAi | null
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

  const policyBlock = renderPubPolicyPromptBlock(args.policy, args.section.id)
  const policySection = policyBlock ? `\n\n${policyBlock}\n` : ''

  const guidelineHint = args.policy?.guidelineKey
    ? `Reporting guideline: ${args.policy.guidelineKey}. Draft content so the final document can be mapped onto that checklist.`
    : ''

  // Per-section template content guidance (migration 105, Package B-6)
  // — snapshotted from the publication template at pub-create by the
  // API (Package B-4) and read here from the PublicationSectionContent
  // row. Same shape the /ai-suggest route uses (Package B-5), so the
  // first draft and subsequent rewrites answer against identical
  // guidance. Empty when the template carries no explicit guidance
  // for this section.
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
    `You are drafting a single section of a scientific-writing deliverable (manuscript, abstract, poster, review, letter, or plain-language summary).`,
    `Document type: ${args.docType}.`,
    `Section id: ${args.section.id} — number ${args.section.number} — title ${args.section.title}.`,
    `Write a thorough first-pass draft of this section ONLY based strictly on the attached source documents.`,
    `Return clean HTML with <p>, <ul>/<li>, and <table> as appropriate — no Markdown, no code fences, no commentary before or after the HTML.`,
    `Where the sources do not contain a piece of information this section needs, insert a bracketed marker like [TBD: what is needed] — never fabricate numbers, patient counts, dates, trial identifiers, or citations.`,
    `NEVER write a sentence that explains the sources are incomplete or that information is missing — the section must read as document text with [TBD: ...] placeholders in the gaps.`,
    guidelineHint,
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
  if (!text) throw new Error('Claude returned no text content for publication section draft')
  return stripCodeFence(text)
}

async function draftSection(args: {
  section:        SectionTemplate
  sourcePdfs:     SourcePdfPayload[]
  docType:        string
  model:          string
  aiInstructions: string | null
  policy:         PubPolicyRowForAi | null
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

export const handleAiInitialDraftPublication: JobHandler<PubAiInitialDraftPayload> = async (
  job, { prisma, log, enqueue },
) => {
  const { publicationId, targetSectionIds } = job.data

  if (!aiConfigured()) {
    log.warn({ publicationId }, 'pub_ai_initial_draft: AI not configured — sections left empty')
    if (!targetSectionIds || targetSectionIds.length === 0) {
      await prisma.publication.update({
        where: { id: publicationId },
        data:  { aiDraftState: 'idle' },
      }).catch(() => undefined)
    }
    return { skipped: 'ai_not_configured' }
  }

  // Mark publication as drafting — SPA watches aiDraftState for progress.
  if (!targetSectionIds || targetSectionIds.length === 0) {
    await prisma.publication.update({
      where: { id: publicationId },
      data:  { aiDraftState: 'drafting' },
    }).catch((err: unknown) => {
      log.warn({ err, publicationId }, 'pub_ai_initial_draft: could not set aiDraftState=drafting')
    })
  }

  const pub = await prisma.publication.findUnique({
    where: { id: publicationId },
    select: {
      id: true, type: true, subtype: true, sourceDocumentId: true,
      currentVersionId: true, aiInstructions: true,
      pubTypePolicyVersionAtCreate:           true,
      publicationAiPromptRecordId:            true,
      publicationBestPracticeRecordId:        true,
      deletedAt: true,
    },
  })
  if (!pub || pub.deletedAt) {
    log.warn({ publicationId }, 'pub_ai_initial_draft: publication not found or deleted')
    return { skipped: 'not_found' }
  }
  if (!pub.currentVersionId) {
    log.warn({ publicationId }, 'pub_ai_initial_draft: no current version — create flow did not seed v0.1?')
    return { skipped: 'no_current_version' }
  }

  // Flat docType slug used by the policy resolver.
  const docType = (pub.subtype ? `${pub.type}_${pub.subtype}` : pub.type).toLowerCase().replace(/-/g, '_')

  const project = await prisma.project.findUnique({
    where: { id: job.data.projectId },
    select: { tenantId: true },
  })
  const resolvedModel = await resolveDraftModel(prisma, project?.tenantId ?? null)

  const policy = await resolvePubPolicyForPublication(prisma, {
    docType,
    pubTypePolicyVersionAtCreate:     pub.pubTypePolicyVersionAtCreate,
    publicationAiPromptRecordId:      pub.publicationAiPromptRecordId,
    publicationBestPracticeRecordId:  pub.publicationBestPracticeRecordId,
  })
  if (policy) {
    log.info({ publicationId, policyId: policy.id, policyVersion: policy.version, guideline: policy.guidelineKey }, 'pub_ai_initial_draft: policy resolved')
  }

  // Load source PDFs: for now, follow Publication.sourceDocumentId →
  // Module A document's DocumentSource → DocumentUpload rows. When the
  // publications module gains its own source-attach surface, that's a
  // second branch here (unioned on uploadId).
  const sourcePdfs: SourcePdfPayload[] = []
  if (process.env.ANTHROPIC_API_KEY?.trim() && pub.sourceDocumentId) {
    const links = await prisma.documentSource.findMany({
      where:  { documentId: pub.sourceDocumentId },
      select: { uploadId: true },
    })
    const uploads = links.length === 0
      ? []
      : await prisma.documentUpload.findMany({
          where:  { id: { in: links.map(l => l.uploadId) } },
          select: { id: true, title: true, fileName: true, blobKey: true, contentType: true },
        })
    const reader = createBlobReaderFromEnv()
    for (const u of uploads) {
      if ((u.contentType ?? '').toLowerCase() !== 'application/pdf') continue
      try {
        const { bytes } = await reader.read('documents', u.blobKey)
        if (bytes.length > MAX_SOURCE_BYTES) {
          log.warn({ publicationId, uploadId: u.id, size: bytes.length }, 'pub_ai_initial_draft: source exceeds cap — dropped')
          continue
        }
        sourcePdfs.push({ title: u.title ?? u.fileName, bytes })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        log.warn({ publicationId, uploadId: u.id, err: message }, 'pub_ai_initial_draft: blob read failed — dropped')
      }
    }
  }

  // Load the seeded section rows for the current version.
  //
  // Migration 105 Package B-6: also pull the templateInstructions +
  // templateGuidance snapshotted at pub-create (Package B-4). Without
  // this read the initial draft would only see format rules + policy —
  // same gap Clinical Package 11 closed.
  const existing = await prisma.publicationSectionContent.findMany({
    where: { publicationVersionId: pub.currentVersionId },
    select: {
      id: true, sectionId: true, sectionNumber: true, sectionTitle: true, contentHtml: true,
      templateInstructions: true, templateGuidance: true,
    },
  })
  const targetSet = targetSectionIds && targetSectionIds.length > 0 ? new Set(targetSectionIds) : null
  const sections = targetSet
    ? existing.filter(s => targetSet.has(s.sectionId))
    : existing

  const report: Report = { drafted: 0, skipped: 0, errored: [] }

  for (const sec of sections) {
    // Preserve writer edits on the full-document path.
    if (!targetSet && sec.contentHtml && sec.contentHtml.trim().length > 0) {
      report.skipped++
      continue
    }
    const template: SectionTemplate = {
      id:     sec.sectionId,
      number: sec.sectionNumber,
      title:  sec.sectionTitle,
    }
    try {
      const { contentHtml, engine } = await draftSection({
        section:        template,
        sourcePdfs,
        docType,
        model:          resolvedModel,
        aiInstructions: pub.aiInstructions?.trim() || null,
        policy,
        sectionTemplateInstructions: sec.templateInstructions ?? null,
        sectionTemplateGuidance:     sec.templateGuidance     ?? null,
      })
      await prisma.publicationSectionContent.update({
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
      log.info({ publicationId, sectionId: sec.sectionId, engine, length: contentHtml.length }, 'pub_ai_initial_draft: section drafted')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.error({ publicationId, sectionId: sec.sectionId, err: message }, 'pub_ai_initial_draft: section failed')
      report.errored.push({ sectionId: sec.sectionId, error: message })
    }
  }

  log.info({
    publicationId,
    sectionsTotal: sections.length,
    drafted: report.drafted,
    skipped: report.skipped,
    errored: report.errored.length,
  }, 'pub_ai_initial_draft: complete')

  // All sections errored out mid-draft: stop the chain + surface 'failed'.
  if (!targetSet && report.drafted === 0 && report.errored.length > 0) {
    await prisma.publication.update({
      where: { id: publicationId },
      data:  { aiDraftState: 'idle' },
    }).catch(() => undefined)
    return { publicationId, sectionsTotal: sections.length, drafted: 0, skipped: report.skipped, errored: report.errored }
  }

  if (!targetSet) {
    await prisma.publication.update({
      where: { id: publicationId },
      data:  { aiDraftState: 'validating' },
    }).catch((err: unknown) => {
      log.warn({ err, publicationId }, 'pub_ai_initial_draft: could not set aiDraftState=validating')
    })
    try {
      await enqueue('publications.ai_validation_pass', {
        publicationId,
        versionId:   pub.currentVersionId,
        projectId:   job.data.projectId,
        actorId:     job.data.actorId,
        iteration:   1,
      }, { delayMs: 2_000, jobId: `pub-ai-validation-${publicationId}-1` })
    } catch (err) {
      log.warn({ err, publicationId }, 'pub_ai_initial_draft: failed to enqueue validation — draft stands')
      await prisma.publication.update({
        where: { id: publicationId },
        data:  { aiDraftState: 'complete' },
      }).catch(() => undefined)
    }
  }

  return {
    publicationId,
    sectionsTotal: sections.length,
    drafted:       report.drafted,
    skipped:       report.skipped,
    errored:       report.errored,
  }
}
