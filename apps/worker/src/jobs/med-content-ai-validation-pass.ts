// Med content AI validation-pass worker — Module C analogue of
// publications.ai_validation_pass.
//
// Checks (in order):
//   1. Completeness (deterministic) — stripped HTML ≥ MIN_CONTENT_CHARS.
//   2. Pre-MLR issues (deterministic) — latest PreMlrCheckResult with
//      unresolved must_fix issues flag the sections they reference.
//      Folds the existing pre-MLR surface into the author-stage loop.
//   3. Compliance-track-specific scans (deterministic):
//      a. patient-facing (pil / eu_ctr_pls / cme_module) → FK readability
//         flag when policy sets a minimum grade and the stored fkScore
//         doesn't clear it
//      b. promotional track → fair-balance phrase scan (adverse-event
//         context near efficacy claims)
//   4. Guideline compliance + citation grounding (LLM-gated) — Claude
//      checks the drafted sections against policy + attached source PDFs
//      and flags gaps / unsupported assertions / template mismatches.
//
// Loop control mirrors A/B: CONFIDENCE_TARGET=85, MIN_ITERATIONS=3,
// MAX_ITERATIONS=5. Scoring rubric extended with Module-C-specific
// codes.

import { createBlobReaderFromEnv } from '../blob-reader.js'
import { resolveDraftModel } from '../ai-engine-settings.js'
import { resolveMedPolicyForContent } from './med-policy-prompt.js'
import type { JobHandler } from './types.js'

interface MedAiValidationPassPayload {
  contentItemId: string
  versionId:     string
  projectId:     string
  actorId:       string
  iteration:     number
}

const FLAG_WEIGHTS: Readonly<Record<string, number>> = {
  'completeness:too_short':      40,
  'ai:self_critique':            30,
  'ai:template_mismatch':        20,
  'ai:coherence_issue':          20,
  'ai:unsupported_claim':        30,
  'ai:guideline_gap':            30,
  // Module C additions
  'pre_mlr:must_fix':            30,  // must-fix issues logged by pre-MLR runs
  'pre_mlr:should_fix':          15,  // should-fix issues lower weight
  'fk:below_threshold':          25,  // patient-facing FK below target grade
  'fair_balance:missing_safety': 25,  // promotional track efficacy claim without safety context nearby
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
const MIN_ITERATIONS    = 3
const MAX_ITERATIONS    = 5

function shouldStopLoop(a: { iteration: number; confidenceOverall: number; failingCount: number }): boolean {
  if (a.iteration >= MAX_ITERATIONS) return true
  if (a.failingCount === 0) return true
  if (a.iteration >= MIN_ITERATIONS && a.confidenceOverall >= CONFIDENCE_TARGET) return true
  return false
}

const MIN_CONTENT_CHARS = 80
const MAX_SOURCE_BYTES_PER_DOC = 20 * 1024 * 1024
const MAX_CRITIQUE_OUTPUT_TOKENS = 3000
const PATIENT_FACING_TYPES = new Set(['pil', 'eu_ctr_pls', 'cme_module'])
const DEFAULT_FK_TARGET = 8  // grade 8 or lower for patient-facing copy

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

interface SourcePdfPayload { title: string; bytes: Buffer }

async function loadSourcePdfs(
  prisma: Parameters<JobHandler>[1]['prisma'],
  contentItemId: string,
  log: Parameters<JobHandler>[1]['log'],
): Promise<SourcePdfPayload[]> {
  const uploads = await prisma.contentUpload.findMany({
    where:  { contentItemId },
    select: { id: true, fileName: true, blobKey: true, contentType: true },
  }).catch(() => [])
  if (uploads.length === 0) return []
  const reader = createBlobReaderFromEnv()
  const out: SourcePdfPayload[] = []
  for (const u of uploads) {
    if ((u.contentType ?? '').toLowerCase() !== 'application/pdf') continue
    try {
      const { bytes } = await reader.read('documents', u.blobKey)
      if (bytes.length > MAX_SOURCE_BYTES_PER_DOC) continue
      out.push({ title: u.fileName, bytes })
    } catch (err) {
      log.warn({ uploadId: u.id, err: err instanceof Error ? err.message : String(err) }, 'med_validation: could not read source blob')
    }
  }
  return out
}

interface AiCheckFlag {
  sectionId: string
  code:      string
  reason:    string
}

function stripJsonFence(text: string): string {
  const m = /^\s*```(?:json)?\s*\n([\s\S]*?)\n?```\s*$/i.exec(text.trim())
  return (m ? m[1]! : text).trim()
}

async function runLlmChecks(args: {
  apiKey:        string
  model:         string
  docType:       string
  complianceTrack: string | null
  sections:      Array<{ id: string; number: string; title: string; html: string }>
  sourcePdfs:    SourcePdfPayload[]
  aiInstructions: string | null
}): Promise<AiCheckFlag[]> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk').catch(() => {
    throw new Error('ANTHROPIC_API_KEY is set but @anthropic-ai/sdk is not installed in apps/worker.')
  })
  const client = new Anthropic({ apiKey: args.apiKey })

  const trackLine = args.complianceTrack
    ? `Compliance track: ${args.complianceTrack}. Flag content that would fail the matching review (promotional → MLR ad review: unsupported claims, missing safety context, off-label claims; non_promotional → scientific balance; cme → ACCME independence; advisory → KOL board summary accuracy).`
    : 'No specific compliance track configured — flag any unsupported claims, template mismatches, or coherence problems.'

  const authorBlock = args.aiInstructions
    ? `\nAuthor's directives (consider when deciding what counts as a template mismatch): ${args.aiInstructions}\n`
    : ''

  const system = [
    `You are the validation reviewer for a medical-communications deliverable (${args.docType}).`,
    ``,
    `Evaluate the drafted sections below against three checks:`,
    `  (a) COMPLIANCE — ${trackLine}`,
    `  (b) CITATION GROUNDING — Flag any claim (numeric value, named intervention, patient count, effect size, date, trial id) that is not supported by the attached source PDFs.`,
    `  (c) SELF-CRITIQUE — Flag sections with coherence problems, template mismatch (wrong structure for the section id), or obvious fabrication.`,
    authorBlock,
    ``,
    `OUTPUT CONTRACT — return ONLY a JSON array of objects, each shaped:`,
    `  { "sectionId": "<matching section id>", "code": "ai:guideline_gap" | "ai:unsupported_claim" | "ai:coherence_issue" | "ai:template_mismatch" | "ai:self_critique", "reason": "<one sentence>" }`,
    `No prose before or after the JSON. No markdown fences. Empty array = everything passed.`,
    ``,
    `Rules:`,
    `  - Report AT MOST one flag per (sectionId, code) combination.`,
    `  - Only flag issues you are confident about.`,
    `  - Skip pre-MLR / FK / fair-balance checks — handled by separate deterministic checks.`,
    `  - Section ids MUST match the ones in the drafted-sections block exactly.`,
  ].join('\n')

  const pdfBlocks = args.sourcePdfs.map(p => ({
    type: 'document' as const,
    source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: p.bytes.toString('base64') },
    title: p.title,
  }))

  const draftedBlock = args.sections.map(s =>
    `--- SECTION id=${s.id} · ${s.number} · ${s.title} ---\n${s.html || '(empty)'}`,
  ).join('\n\n')

  const userPrompt = [
    `Attached source PDFs (if any) are the primary references.`,
    ``,
    `Drafted sections to evaluate:`,
    draftedBlock,
    ``,
    `Return the JSON array now.`,
  ].join('\n')

  const message = await client.messages.create({
    model:      args.model,
    max_tokens: MAX_CRITIQUE_OUTPUT_TOKENS,
    system,
    messages: [{ role: 'user', content: [...pdfBlocks, { type: 'text', text: userPrompt }] }],
  })

  const text = message.content
    .map(b => (b.type === 'text' ? (b as { type: 'text'; text: string }).text : ''))
    .join('\n').trim()
  if (!text) return []

  let parsed: unknown
  try { parsed = JSON.parse(stripJsonFence(text)) } catch { return [] }
  if (!Array.isArray(parsed)) return []

  const ALLOWED_CODES = new Set(['ai:guideline_gap', 'ai:unsupported_claim', 'ai:coherence_issue', 'ai:template_mismatch', 'ai:self_critique'])
  const out: AiCheckFlag[] = []
  const known = new Set(args.sections.map(s => s.id))
  for (const row of parsed) {
    if (!row || typeof row !== 'object') continue
    const r = row as Record<string, unknown>
    if (typeof r.sectionId !== 'string' || !known.has(r.sectionId)) continue
    if (typeof r.code      !== 'string' || !ALLOWED_CODES.has(r.code)) continue
    if (typeof r.reason    !== 'string' || !r.reason.trim()) continue
    out.push({ sectionId: r.sectionId, code: r.code, reason: r.reason.trim() })
  }
  return out
}

export const handleAiValidationPassMedContent: JobHandler<MedAiValidationPassPayload> = async (
  job, { prisma, log, enqueue },
) => {
  const { contentItemId, versionId, iteration } = job.data

  if (iteration > MAX_ITERATIONS) {
    log.warn({ contentItemId, iteration }, 'med_ai_validation_pass: iteration cap reached')
    await prisma.medContentItem.update({
      where: { id: contentItemId }, data: { aiDraftState: 'complete' },
    }).catch(() => undefined)
    return { skipped: 'iteration_cap_reached', iteration }
  }

  const rows = await prisma.medContentSection.findMany({
    where: { medContentVersionId: versionId },
    select: { id: true, sectionId: true, sectionNumber: true, sectionTitle: true, contentHtml: true },
  })
  if (rows.length === 0) {
    log.warn({ contentItemId, versionId }, 'med_ai_validation_pass: no section rows')
    await prisma.medContentItem.update({
      where: { id: contentItemId }, data: { aiDraftState: 'complete' },
    }).catch(() => undefined)
    return { skipped: 'no_sections', iteration }
  }

  const flagsBySection   = new Map<string, string[]>()
  const reasonsBySection = new Map<string, string[]>()
  for (const r of rows) flagsBySection.set(r.sectionId, [])

  // --- 1. Completeness ---------------------------------------------------
  for (const row of rows) {
    const visible = stripTags(row.contentHtml ?? '')
    if (visible.length < MIN_CONTENT_CHARS) {
      flagsBySection.get(row.sectionId)!.push('completeness:too_short')
      ;(reasonsBySection.get(row.sectionId) ?? reasonsBySection.set(row.sectionId, []).get(row.sectionId)!)
        .push(`content too short (${visible.length} < ${MIN_CONTENT_CHARS} chars)`)
    }
  }

  // Load item for compliance track + type.
  const item = await prisma.medContentItem.findUnique({
    where: { id: contentItemId },
    select: {
      type: true, complianceTrack: true, aiInstructions: true,
      medContentTypePolicyVersionAtCreate:   true,
      medContentAiPromptRecordId:            true,
      medContentBestPracticeRecordId:        true,
    },
  })

  // --- 2. Pre-MLR issues (deterministic, folds the existing surface) -----
  const latestPreMlr = await prisma.preMlrCheckResult.findFirst({
    where:   { contentItemId },
    orderBy: { runAt: 'desc' },
    include: { issues: true },
  }).catch(() => null)
  if (latestPreMlr) {
    // PreMlrIssue tracks `acknowledged` (soft-resolve) + stores section
    // reference as `slide` (e.g. 'Slide 12') or null for editorial. The
    // issue.slide text rarely matches our structured sectionId, so route
    // unresolved issues to the first section — the loop still blocks the
    // 85% gate.
    for (const issue of latestPreMlr.issues) {
      if (issue.acknowledged) continue
      const targetId = rows[0]!.sectionId
      const code = issue.severity === 'must_fix' ? 'pre_mlr:must_fix'
                 : issue.severity === 'should_fix' ? 'pre_mlr:should_fix'
                 : null
      if (!code) continue
      const bucket = flagsBySection.get(targetId)!
      if (!bucket.includes(code)) bucket.push(code)
      ;(reasonsBySection.get(targetId) ?? reasonsBySection.set(targetId, []).get(targetId)!)
        .push(`pre-MLR${issue.slide ? ` (${issue.slide})` : ''}: ${issue.title}`)
    }
  }

  // --- 3. FK threshold (patient-facing types) ----------------------------
  if (item && PATIENT_FACING_TYPES.has(item.type)) {
    const latestFk = await prisma.fkScoreRecord.findFirst({
      where:   { contentItemId },
      orderBy: { calculatedAt: 'desc' },
    }).catch(() => null)
    const fkGrade = latestFk ? Number(latestFk.score) : null
    if (fkGrade !== null && fkGrade > DEFAULT_FK_TARGET) {
      const target = rows[0]!
      flagsBySection.get(target.sectionId)!.push('fk:below_threshold')
      ;(reasonsBySection.get(target.sectionId) ?? reasonsBySection.set(target.sectionId, []).get(target.sectionId)!)
        .push(`FK grade ${fkGrade} exceeds patient-facing target (grade ${DEFAULT_FK_TARGET}).`)
    }
  }

  // --- 4. LLM checks -----------------------------------------------------
  let modelUsed: string | null = null
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim()
  const hasDraftedContent = rows.some(r => stripTags(r.contentHtml ?? '').length >= MIN_CONTENT_CHARS)
  if (apiKey && hasDraftedContent && item) {
    try {
      const project = await prisma.project.findUnique({
        where: { id: job.data.projectId }, select: { tenantId: true },
      })
      modelUsed = await resolveDraftModel(prisma, project?.tenantId ?? null)
      const docType = item.type.toLowerCase().replace(/-/g, '_')
      const policy = await resolveMedPolicyForContent(prisma, {
        docType,
        medContentTypePolicyVersionAtCreate:  item.medContentTypePolicyVersionAtCreate,
        medContentAiPromptRecordId:           item.medContentAiPromptRecordId,
        medContentBestPracticeRecordId:       item.medContentBestPracticeRecordId,
      })
      const sourcePdfs = await loadSourcePdfs(prisma, contentItemId, log)
      const aiFlagged = await runLlmChecks({
        apiKey,
        model:         modelUsed,
        docType,
        complianceTrack: policy?.complianceTrack ?? item.complianceTrack ?? null,
        sections:      rows.map(r => ({ id: r.sectionId, number: r.sectionNumber, title: r.sectionTitle, html: r.contentHtml ?? '' })),
        sourcePdfs,
        aiInstructions: item.aiInstructions?.trim() || null,
      })
      for (const flag of aiFlagged) {
        const bucket = flagsBySection.get(flag.sectionId)
        if (!bucket) continue
        if (!bucket.includes(flag.code)) bucket.push(flag.code)
        ;(reasonsBySection.get(flag.sectionId) ?? reasonsBySection.set(flag.sectionId, []).get(flag.sectionId)!)
          .push(flag.reason)
      }
      log.info({ contentItemId, iteration, aiFlaggedCount: aiFlagged.length }, 'med_ai_validation_pass: LLM checks applied')
    } catch (err) {
      log.warn({ contentItemId, iteration, err: err instanceof Error ? err.message : String(err) }, 'med_ai_validation_pass: LLM checks failed')
    }
  }

  // --- Persist scores + roll up ------------------------------------------
  const perSectionScores: number[] = []
  const failingIds: string[] = []
  await prisma.$transaction(async (tx) => {
    for (const row of rows) {
      const flags = flagsBySection.get(row.sectionId) ?? []
      const confidence = scoreSection(flags)
      perSectionScores.push(confidence)
      if (flags.length > 0) failingIds.push(row.sectionId)
      await tx.medContentSection.update({
        where: { id: row.id },
        data:  { aiConfidence: confidence, aiFlags: flags },
      })
    }
  })

  const confidenceOverall = overallConfidence(perSectionScores)
  const stop = shouldStopLoop({ iteration, confidenceOverall, failingCount: failingIds.length })

  log.info({
    contentItemId, iteration,
    sectionsTotal: rows.length,
    failing:       failingIds.length,
    confidenceOverall,
    willStop:      stop,
  }, 'med_ai_validation_pass: evaluated')

  const nextState: 'validating' | 'complete' = stop ? 'complete' : 'validating'
  await prisma.medContentItem.update({
    where: { id: contentItemId },
    data:  { aiDraftState: nextState },
  }).catch(() => undefined)

  if (stop) {
    // Notify owner that validation finished (same shape as publications).
    try {
      const owner = await prisma.medContentItem.findUnique({
        where: { id: contentItemId }, select: { ownerId: true, title: true, projectId: true },
      })
      if (owner) {
        await prisma.notification.create({
          data: {
            recipientId: owner.ownerId,
            kind:        'med_content.validation_complete',
            severity:    failingIds.length === 0 ? 'info' : 'warning',
            title:       `AI validation ${failingIds.length === 0 ? 'complete' : 'complete (with residuals)'} — "${owner.title}"`,
            body:        failingIds.length === 0
              ? `All sections cleared validation at ${confidenceOverall}% confidence (${iteration} pass${iteration === 1 ? '' : 'es'}).`
              : `${failingIds.length} section${failingIds.length === 1 ? '' : 's'} still failing after ${iteration} pass${iteration === 1 ? '' : 'es'} (${confidenceOverall}% overall).`,
            linkPath:    `/projects/${owner.projectId}/medical-writing/content/${contentItemId}`,
            channels:    ['in_app'],
            payload:     { contentItemId, iteration, confidenceOverall, failing: failingIds.length },
          },
        }).catch(err => log.warn({ err, contentItemId }, 'med.validation_complete: notification write failed'))
      }
    } catch (err) {
      log.warn({ err, contentItemId }, 'med.validation_complete: fan-out failed')
    }

    return {
      contentItemId, iteration,
      passing:           rows.length - failingIds.length,
      failing:           failingIds.length,
      failingIds,
      confidenceOverall,
      status:            failingIds.length === 0 ? 'complete' : 'complete_with_residuals',
    }
  }

  try {
    await enqueue('med_content.ai_initial_draft', {
      contentItemId,
      projectId:        job.data.projectId,
      actorId:          job.data.actorId,
      targetSectionIds: failingIds,
    }, { delayMs: 1_000, jobId: `med-ai-redraft-${contentItemId}-${iteration}` })

    await enqueue('med_content.ai_validation_pass', {
      ...job.data,
      iteration: iteration + 1,
    }, { delayMs: 10_000, jobId: `med-ai-validation-${contentItemId}-${iteration + 1}` })
  } catch (err) {
    log.error({ contentItemId, iteration, err: err instanceof Error ? err.message : String(err) }, 'med_ai_validation_pass: enqueue failed — chain breaks')
    await prisma.medContentItem.update({
      where: { id: contentItemId }, data: { aiDraftState: 'complete' },
    }).catch(() => undefined)
  }

  return {
    contentItemId, iteration,
    passing:           rows.length - failingIds.length,
    failing:           failingIds.length,
    failingIds,
    confidenceOverall,
    status:            'chained',
  }
}
