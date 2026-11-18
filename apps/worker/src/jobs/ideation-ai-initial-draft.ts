// Ideation artefact AI initial-draft worker — Module D analogue of
// med_content.ai_initial_draft. Section-by-section Claude call on
// every IdeationArtefactSection row of the current version.
//
// Scope:
//   - Load IdeationArtefact + current version + section rows
//   - Attach source PDFs from DocumentUpload rows scoped to the parent
//     submission's project (ideation sources are project-scoped in the
//     current schema so we scope by project).
//   - Compose policy block (SME + channel hint + BP digest + section
//     rules) + SECTION_GROUNDING_RULES + author aiInstructions
//   - Call Claude per section; write results to IdeationArtefactSection
//   - On completion: flip aiDraftState → 'validating' and chain to
//     ideation.ai_validation_pass

import { createBlobReaderFromEnv } from '../blob-reader.js'
import { resolveDraftModel } from '../ai-engine-settings.js'
import {
  resolveIdeationPolicyForArtefact,
  renderIdeaPolicyPromptBlock,
  SECTION_GROUNDING_RULES,
  type IdeaPolicyRowForAi,
} from './ideation-policy-prompt.js'
import type { JobHandler } from './types.js'

interface IdeationAiInitialDraftPayload {
  ideationArtefactId: string
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
  policy:         IdeaPolicyRowForAi | null
}): Promise<string> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk').catch(() => {
    throw new Error('ANTHROPIC_API_KEY set but @anthropic-ai/sdk is not installed in apps/worker.')
  })
  const client = new Anthropic({ apiKey: args.apiKey })

  const authorBlock = args.aiInstructions
    ? ['', `Author's instructions for this draft (follow these in addition to the rules above):`, args.aiInstructions, ''].join('\n')
    : ''

  const policyBlock = renderIdeaPolicyPromptBlock(args.policy, args.section.id)
  const policySection = policyBlock ? `\n\n${policyBlock}\n` : ''

  const trackHint = args.policy?.channelHint
    ? `Regulatory track: ${args.policy.channelHint}. Keep the tone + content appropriate to that channel (KOL = formal scientific exchange; HCP = concise clinical message; patient = plain language; press = headline-oriented factual claims).`
    : ''

  const system = [
    `You are drafting a single section of a ideation / KOL engagement artefact.`,
    `Document type: ${args.docType} (KOL brief, patient story, HCP insight report, medical affairs narrative, press release, or congress summary).`,
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
  if (!text) throw new Error('Claude returned no text content for ideation artefact section draft')
  return stripCodeFence(text)
}

async function draftSection(args: {
  section:        SectionTemplate
  sourcePdfs:     SourcePdfPayload[]
  docType:        string
  model:          string
  aiInstructions: string | null
  policy:         IdeaPolicyRowForAi | null
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

export const handleAiInitialDraftIdeationArtefact: JobHandler<IdeationAiInitialDraftPayload> = async (
  job, { prisma, log, enqueue },
) => {
  const { ideationArtefactId, targetSectionIds } = job.data

  if (!aiConfigured()) {
    log.warn({ ideationArtefactId }, 'idea_ai_initial_draft: AI not configured — sections left empty')
    if (!targetSectionIds || targetSectionIds.length === 0) {
      await prisma.ideationArtefact.update({
        where: { id: ideationArtefactId },
        data:  { aiDraftState: 'idle' },
      }).catch(() => undefined)
    }
    return { skipped: 'ai_not_configured' }
  }

  if (!targetSectionIds || targetSectionIds.length === 0) {
    await prisma.ideationArtefact.update({
      where: { id: ideationArtefactId },
      data:  { aiDraftState: 'drafting' },
    }).catch((err: unknown) => {
      log.warn({ err, ideationArtefactId }, 'idea_ai_initial_draft: could not set aiDraftState=drafting')
    })
  }

  const doc = await prisma.ideationArtefact.findUnique({
    where: { id: ideationArtefactId },
    select: {
      id: true, docType: true, currentVersionId: true,
      ideationProjectId: true, aiInstructions: true,
      ideationTypePolicyVersionAtCreate:   true,
      ideationAiPromptRecordId:            true,
      ideationBestPracticeRecordId:        true,
    },
  })
  if (!doc) {
    log.warn({ ideationArtefactId }, 'idea_ai_initial_draft: artefact not found')
    return { skipped: 'not_found' }
  }
  if (!doc.currentVersionId) {
    log.warn({ ideationArtefactId }, 'idea_ai_initial_draft: no current version — create flow did not seed v0.1?')
    return { skipped: 'no_current_version' }
  }

  const docType = (doc.docType ?? 'ideation_artefact').toLowerCase().replace(/-/g, '_')

  const parentProject = await prisma.ideationProject.findUnique({
    where: { id: doc.ideationProjectId }, select: { projectId: true },
  })
  const resolvedProjectId = parentProject?.projectId ?? job.data.projectId

  const project = await prisma.project.findUnique({
    where: { id: resolvedProjectId },
    select: { tenantId: true },
  })
  const resolvedModel = await resolveDraftModel(prisma, project?.tenantId ?? null)

  const policy = await resolveIdeationPolicyForArtefact(prisma, {
    docType,
    ideationTypePolicyVersionAtCreate: doc.ideationTypePolicyVersionAtCreate,
    ideationAiPromptRecordId:          doc.ideationAiPromptRecordId,
    ideationBestPracticeRecordId:      doc.ideationBestPracticeRecordId,
  })
  if (policy) {
    log.info({ ideationArtefactId, policyId: policy.id, policyVersion: policy.version, channelHint: policy.channelHint }, 'idea_ai_initial_draft: policy resolved')
  }

  // Source PDFs for ideation drafting: project-scoped DocumentUpload
  // rows marked as source documents. (Ideation does not yet have a
  // per-artefact upload scoping; source auto-attach refines to
  // per-artefact when that scoping lands.)
  const sourcePdfs: SourcePdfPayload[] = []
  if (process.env.ANTHROPIC_API_KEY?.trim()) {
    const uploads = await prisma.documentUpload.findMany({
      where: {
        projectId: resolvedProjectId,
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
          log.warn({ ideationArtefactId, uploadId: u.id, size: bytes.length }, 'idea_ai_initial_draft: source exceeds cap — dropped')
          continue
        }
        sourcePdfs.push({ title: u.fileName, bytes })
      } catch (err) {
        log.warn({ ideationArtefactId, uploadId: u.id, err: err instanceof Error ? err.message : String(err) }, 'idea_ai_initial_draft: blob read failed — dropped')
      }
    }
  }

  const existing = await prisma.ideationArtefactSection.findMany({
    where:  { ideationArtefactVersionId: doc.currentVersionId },
    select: { id: true, sectionId: true, sectionNumber: true, sectionTitle: true, contentHtml: true },
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
      })
      await prisma.ideationArtefactSection.update({
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
      log.info({ ideationArtefactId, sectionId: sec.sectionId, engine, length: contentHtml.length }, 'idea_ai_initial_draft: section drafted')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.error({ ideationArtefactId, sectionId: sec.sectionId, err: message }, 'idea_ai_initial_draft: section failed')
      report.errored.push({ sectionId: sec.sectionId, error: message })
    }
  }

  log.info({
    ideationArtefactId,
    sectionsTotal: sections.length,
    drafted: report.drafted,
    skipped: report.skipped,
    errored: report.errored.length,
  }, 'idea_ai_initial_draft: complete')

  if (!targetSet && report.drafted === 0 && report.errored.length > 0) {
    await prisma.ideationArtefact.update({
      where: { id: ideationArtefactId }, data: { aiDraftState: 'idle' },
    }).catch(() => undefined)
    return { ideationArtefactId, sectionsTotal: sections.length, drafted: 0, skipped: report.skipped, errored: report.errored }
  }

  if (!targetSet) {
    await prisma.ideationArtefact.update({
      where: { id: ideationArtefactId }, data: { aiDraftState: 'validating' },
    }).catch((err: unknown) => {
      log.warn({ err, ideationArtefactId }, 'idea_ai_initial_draft: could not set aiDraftState=validating')
    })
    try {
      await enqueue('ideation.ai_validation_pass', {
        ideationArtefactId,
        versionId:   doc.currentVersionId,
        projectId:   job.data.projectId,
        actorId:     job.data.actorId,
        iteration:   1,
      }, { delayMs: 2_000, jobId: `idea-ai-validation-${ideationArtefactId}-1` })
    } catch (err) {
      log.warn({ err, ideationArtefactId }, 'idea_ai_initial_draft: failed to enqueue validation — draft stands')
      await prisma.ideationArtefact.update({
        where: { id: ideationArtefactId }, data: { aiDraftState: 'complete' },
      }).catch(() => undefined)
    }
  }

  return { ideationArtefactId, sectionsTotal: sections.length, drafted: report.drafted, skipped: report.skipped, errored: report.errored }
}
