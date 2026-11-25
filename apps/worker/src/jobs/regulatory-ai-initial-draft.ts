// Regulatory document AI initial-draft worker — Module D analogue of
// med_content.ai_initial_draft. Section-by-section Claude call on
// every RegulatoryDocumentSection row of the current version.
//
// Scope:
//   - Load RegulatoryDocument + current version + section rows
//   - Attach source PDFs from DocumentUpload rows scoped to the parent
//     submission's project (regulatory sources aren't per-document in the
//     current schema so we scope by project).
//   - Compose policy block (SME + regulatory track + BP digest + section
//     rules) + SECTION_GROUNDING_RULES + author aiInstructions
//   - Call Claude per section; write results to RegulatoryDocumentSection
//   - On completion: flip aiDraftState → 'validating' and chain to
//     regulatory.ai_validation_pass

import { createBlobReaderFromEnv } from '../blob-reader.js'
import { resolveDraftModel } from '../ai-engine-settings.js'
import {
  resolveRegPolicyForDocument,
  renderRegPolicyPromptBlock,
  SECTION_GROUNDING_RULES,
  type RegPolicyRowForAi,
} from './regulatory-policy-prompt.js'
import type { JobHandler } from './types.js'

interface RegAiInitialDraftPayload {
  regulatoryDocumentId: string
  projectId:            string
  actorId:              string
  targetSectionIds?:    string[]
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
const MAX_SECTION_OUTPUT_TOKENS = 2000

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
  policy:         RegPolicyRowForAi | null
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

  const policyBlock = renderRegPolicyPromptBlock(args.policy, args.section.id)
  const policySection = policyBlock ? `\n\n${policyBlock}\n` : ''

  const trackHint = args.policy?.regulatoryTrack
    ? `Regulatory track: ${args.policy.regulatoryTrack}. Observe the matching guidance (IND → FDA 21 CFR 312; NDA → FDA 21 CFR 314; MAA → EMA / EU 2001/83; BLA → FDA 21 CFR 601; variation → EMA Variation Regulation (EC) No 1234/2008).`
    : ''

  // Per-section template content guidance (migration 105 Package R-6)
  // — snapshotted from RegulatoryDocumentTemplate at document-create
  // by the API (R-3) and read here from the RegulatoryDocumentSection
  // row. Identical block shape Clinical P11 + Publication B-6 + Medical
  // C-6 use.
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
    `You are drafting a single section of a regulatory submission narrative document.`,
    `Document type: ${args.docType} (CTD Module 2 overview / summary, QOS, cover letter, HA response narrative, or risk-benefit statement).`,
    `Section id: ${args.section.id} — number ${args.section.number} — title ${args.section.title}.`,
    `Write a thorough first-pass draft of this section ONLY based strictly on the attached source documents.`,
    `Return clean HTML with <p>, <ul>/<li>, and <table> as appropriate — no Markdown, no code fences, no commentary before or after the HTML.`,
    `Where the sources do not contain a piece of information this section needs, insert [TBD: what is needed] markers — never fabricate numbers, patient counts, dates, trial identifiers, SMPC sentences, or citations.`,
    `NEVER write a sentence that explains sources are incomplete — the section must read as submission-ready text with [TBD: ...] placeholders in the gaps.`,
    trackHint,
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
  if (!text) throw new Error('Claude returned no text content for regulatory document section draft')
  return stripCodeFence(text)
}

async function draftSection(args: {
  section:        SectionTemplate
  sourcePdfs:     SourcePdfPayload[]
  docType:        string
  model:          string
  aiInstructions: string | null
  policy:         RegPolicyRowForAi | null
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

export const handleAiInitialDraftRegulatoryDocument: JobHandler<RegAiInitialDraftPayload> = async (
  job, { prisma, log, enqueue },
) => {
  const { regulatoryDocumentId, targetSectionIds } = job.data

  if (!aiConfigured()) {
    log.warn({ regulatoryDocumentId }, 'reg_ai_initial_draft: AI not configured — sections left empty')
    if (!targetSectionIds || targetSectionIds.length === 0) {
      await prisma.regulatoryDocument.update({
        where: { id: regulatoryDocumentId },
        data:  { aiDraftState: 'idle' },
      }).catch(() => undefined)
    }
    return { skipped: 'ai_not_configured' }
  }

  if (!targetSectionIds || targetSectionIds.length === 0) {
    await prisma.regulatoryDocument.update({
      where: { id: regulatoryDocumentId },
      data:  { aiDraftState: 'drafting' },
    }).catch((err: unknown) => {
      log.warn({ err, regulatoryDocumentId }, 'reg_ai_initial_draft: could not set aiDraftState=drafting')
    })
  }

  const doc = await prisma.regulatoryDocument.findUnique({
    where: { id: regulatoryDocumentId },
    select: {
      id: true, docType: true, currentVersionId: true, archivedAt: true,
      projectId: true, aiInstructions: true,
      regTypePolicyVersionAtCreate:   true,
      regAiPromptRecordId:            true,
      regBestPracticeRecordId:        true,
    },
  })
  if (!doc || doc.archivedAt) {
    log.warn({ regulatoryDocumentId }, 'reg_ai_initial_draft: document not found or archived')
    return { skipped: 'not_found' }
  }
  if (!doc.currentVersionId) {
    log.warn({ regulatoryDocumentId }, 'reg_ai_initial_draft: no current version — create flow did not seed v0.1?')
    return { skipped: 'no_current_version' }
  }

  const docType = doc.docType.toLowerCase().replace(/-/g, '_')

  const project = await prisma.project.findUnique({
    where: { id: job.data.projectId },
    select: { tenantId: true },
  })
  const resolvedModel = await resolveDraftModel(prisma, project?.tenantId ?? null)

  const policy = await resolveRegPolicyForDocument(prisma, {
    docType,
    regTypePolicyVersionAtCreate: doc.regTypePolicyVersionAtCreate,
    regAiPromptRecordId:          doc.regAiPromptRecordId,
    regBestPracticeRecordId:      doc.regBestPracticeRecordId,
  })
  if (policy) {
    log.info({ regulatoryDocumentId, policyId: policy.id, policyVersion: policy.version, regulatoryTrack: policy.regulatoryTrack }, 'reg_ai_initial_draft: policy resolved')
  }

  // Source PDFs for regulatory drafting: project-scoped DocumentUpload
  // rows marked as source documents. (Regulatory doesn't have a
  // per-document upload scoping yet; source auto-attach refines to
  // per-doc when that scoping lands.)
  const sourcePdfs: SourcePdfPayload[] = []
  if (process.env.ANTHROPIC_API_KEY?.trim()) {
    const uploads = await prisma.documentUpload.findMany({
      where: {
        projectId: doc.projectId,
        contentType: 'application/pdf',
        status: 'confirmed',
      },
      select: { id: true, fileName: true, blobKey: true, contentType: true },
      take: 10,
    }).catch(() => [])
    const reader = createBlobReaderFromEnv()
    for (const u of uploads) {
      try {
        const { bytes } = await reader.read('documents', u.blobKey)
        if (bytes.length > MAX_SOURCE_BYTES) {
          log.warn({ regulatoryDocumentId, uploadId: u.id, size: bytes.length }, 'reg_ai_initial_draft: source exceeds cap — dropped')
          continue
        }
        sourcePdfs.push({ title: u.fileName, bytes })
      } catch (err) {
        log.warn({ regulatoryDocumentId, uploadId: u.id, err: err instanceof Error ? err.message : String(err) }, 'reg_ai_initial_draft: blob read failed — dropped')
      }
    }
  }

  const existing = await prisma.regulatoryDocumentSection.findMany({
    where:  { regulatoryDocumentVersionId: doc.currentVersionId },
    // Package R-6 (migration 105): pull templateInstructions +
    // templateGuidance snapshotted at document-create (R-3) so the
    // drafter prompt gets the authored intent on first pass.
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
        aiInstructions: doc.aiInstructions?.trim() || null,
        policy,
        sectionTemplateInstructions: sec.templateInstructions ?? null,
        sectionTemplateGuidance:     sec.templateGuidance     ?? null,
      })
      await prisma.regulatoryDocumentSection.update({
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
      log.info({ regulatoryDocumentId, sectionId: sec.sectionId, engine, length: contentHtml.length }, 'reg_ai_initial_draft: section drafted')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.error({ regulatoryDocumentId, sectionId: sec.sectionId, err: message }, 'reg_ai_initial_draft: section failed')
      report.errored.push({ sectionId: sec.sectionId, error: message })
    }
  }

  log.info({
    regulatoryDocumentId,
    sectionsTotal: sections.length,
    drafted: report.drafted,
    skipped: report.skipped,
    errored: report.errored.length,
  }, 'reg_ai_initial_draft: complete')

  if (!targetSet && report.drafted === 0 && report.errored.length > 0) {
    await prisma.regulatoryDocument.update({
      where: { id: regulatoryDocumentId }, data: { aiDraftState: 'idle' },
    }).catch(() => undefined)
    return { regulatoryDocumentId, sectionsTotal: sections.length, drafted: 0, skipped: report.skipped, errored: report.errored }
  }

  if (!targetSet) {
    await prisma.regulatoryDocument.update({
      where: { id: regulatoryDocumentId }, data: { aiDraftState: 'validating' },
    }).catch((err: unknown) => {
      log.warn({ err, regulatoryDocumentId }, 'reg_ai_initial_draft: could not set aiDraftState=validating')
    })
    try {
      await enqueue('regulatory.ai_validation_pass', {
        regulatoryDocumentId,
        versionId:   doc.currentVersionId,
        projectId:   job.data.projectId,
        actorId:     job.data.actorId,
        iteration:   1,
      }, { delayMs: 2_000, jobId: `reg-ai-validation-${regulatoryDocumentId}-1` })
    } catch (err) {
      log.warn({ err, regulatoryDocumentId }, 'reg_ai_initial_draft: failed to enqueue validation — draft stands')
      await prisma.regulatoryDocument.update({
        where: { id: regulatoryDocumentId }, data: { aiDraftState: 'complete' },
      }).catch(() => undefined)
    }
  }

  return { regulatoryDocumentId, sectionsTotal: sections.length, drafted: report.drafted, skipped: report.skipped, errored: report.errored }
}
