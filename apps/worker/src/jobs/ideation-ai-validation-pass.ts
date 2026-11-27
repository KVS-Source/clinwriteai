// Ideation artefact AI validation-pass worker — Module E analogue of
// med_content.ai_validation_pass / regulatory.ai_validation_pass.
//
// Checks (in order):
//   1. Completeness (deterministic) — stripped HTML ≥ MIN_CONTENT_CHARS.
//   2. Source-currency scan (deterministic) — the parent artefact's
//      sourceCurrencyStatus and any unresolved ClaimCurrencyCheck rows
//      bubble up as section flags so the 85 % gate can't clear while
//      the source is known to be stale.
//   3. Compliance + citation grounding (LLM-gated) — Claude checks
//      the drafted sections against policy + attached source PDFs and
//      flags gaps / unsupported assertions / template mismatches.
//
// Loop control mirrors A/B/C/D: CONFIDENCE_TARGET=85, MIN_ITERATIONS=3,
// MAX_ITERATIONS=5.

import { createBlobReaderFromEnv } from '../blob-reader.js'
import { resolveDraftModel } from '../ai-engine-settings.js'
import { resolveIdeationPolicyForArtefact } from './ideation-policy-prompt.js'
import { CRITIQUE_OUTPUT_TOKENS } from '../token-limits.js'
import type { JobHandler } from './types.js'

interface IdeationAiValidationPassPayload {
  ideationArtefactId: string
  versionId:            string
  projectId:            string
  actorId:              string
  iteration:            number
}

const FLAG_WEIGHTS: Readonly<Record<string, number>> = {
  'completeness:too_short':      40,
  'ai:self_critique':            30,
  'ai:template_mismatch':        20,
  'ai:coherence_issue':          20,
  'ai:unsupported_claim':        30,
  'ai:guideline_gap':            30,
  // Module E additions
  'source_currency:stale':       25,   // artefact.sourceCurrencyStatus is 'warned' or 'stale'
  'claim_currency:unresolved':   20,   // open ClaimCurrencyCheck rows on the artefact
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
// Env-tunable via AI_MAX_OUTPUT_TOKENS_CRITIQUE (default 8000,
// centralised 2026-11-27). Was 3000 historically.
const MAX_CRITIQUE_OUTPUT_TOKENS = CRITIQUE_OUTPUT_TOKENS

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

interface SourcePdfPayload { title: string; bytes: Buffer }

async function loadSourcePdfs(
  prisma: Parameters<JobHandler>[1]['prisma'],
  projectId: string,
  log: Parameters<JobHandler>[1]['log'],
): Promise<SourcePdfPayload[]> {
  const uploads = await prisma.documentUpload.findMany({
    where:  { projectId, contentType: 'application/pdf', status: 'confirmed' },
    select: { id: true, fileName: true, blobKey: true, contentType: true },
    take:   10,
  }).catch(() => [])
  if (uploads.length === 0) return []
  const reader = createBlobReaderFromEnv()
  const out: SourcePdfPayload[] = []
  for (const u of uploads) {
    try {
      const { bytes } = await reader.read('documents', u.blobKey)
      if (bytes.length > MAX_SOURCE_BYTES_PER_DOC) continue
      out.push({ title: u.fileName, bytes })
    } catch (err) {
      log.warn({ uploadId: u.id, err: err instanceof Error ? err.message : String(err) }, 'idea_validation: could not read source blob')
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
  apiKey:         string
  model:          string
  docType:        string
  channelHint: string | null
  sections:       Array<{ id: string; number: string; title: string; html: string }>
  sourcePdfs:     SourcePdfPayload[]
  aiInstructions: string | null
}): Promise<AiCheckFlag[]> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk').catch(() => {
    throw new Error('ANTHROPIC_API_KEY is set but @anthropic-ai/sdk is not installed in apps/worker.')
  })
  const client = new Anthropic({ apiKey: args.apiKey })

  const trackLine = args.channelHint
    ? `Regulatory track: ${args.channelHint}. Flag content that would fail the matching review (IND → 21 CFR 312; NDA → 21 CFR 314 / ICH M4E; MAA → EMA guideline Art 8(3); BLA → 21 CFR 601; variation → Variation Regulation (EC) 1234/2008).`
    : 'No specific regulatory track configured — flag unsupported assertions, template mismatches (section not following ICH M4 shape), or coherence problems.'

  const authorBlock = args.aiInstructions
    ? `\nAuthor's directives (consider when deciding what counts as a template mismatch): ${args.aiInstructions}\n`
    : ''

  const system = [
    `You are the validation reviewer for a regulatory submission narrative document (${args.docType}).`,
    ``,
    `Evaluate the drafted sections below against three checks:`,
    `  (a) COMPLIANCE — ${trackLine}`,
    `  (b) CITATION GROUNDING — Flag any claim (numeric value, named intervention, patient count, effect size, date, trial id, SMPC sentence) that is not supported by the attached source PDFs.`,
    `  (c) SELF-CRITIQUE — Flag sections with coherence problems, template mismatch (wrong structure for the CTD section id), or obvious fabrication.`,
    authorBlock,
    ``,
    `OUTPUT CONTRACT — return ONLY a JSON array of objects, each shaped:`,
    `  { "sectionId": "<matching section id>", "code": "ai:guideline_gap" | "ai:unsupported_claim" | "ai:coherence_issue" | "ai:template_mismatch" | "ai:self_critique", "reason": "<one sentence>" }`,
    `No prose before or after the JSON. No markdown fences. Empty array = everything passed.`,
    ``,
    `Rules:`,
    `  - Report AT MOST one flag per (sectionId, code) combination.`,
    `  - Only flag issues you are confident about.`,
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

export const handleAiValidationPassIdeationArtefact: JobHandler<IdeationAiValidationPassPayload> = async (
  job, { prisma, log, enqueue },
) => {
  const { ideationArtefactId, versionId, iteration } = job.data

  if (iteration > MAX_ITERATIONS) {
    log.warn({ ideationArtefactId, iteration }, 'idea_ai_validation_pass: iteration cap reached')
    await prisma.ideationArtefact.update({
      where: { id: ideationArtefactId }, data: { aiDraftState: 'complete' },
    }).catch(() => undefined)
    return { skipped: 'iteration_cap_reached', iteration }
  }

  const rows = await prisma.ideationArtefactSection.findMany({
    where:  { ideationArtefactVersionId: versionId },
    select: { id: true, sectionId: true, sectionNumber: true, sectionTitle: true, contentHtml: true },
  })
  if (rows.length === 0) {
    log.warn({ ideationArtefactId, versionId }, 'idea_ai_validation_pass: no section rows')
    await prisma.ideationArtefact.update({
      where: { id: ideationArtefactId }, data: { aiDraftState: 'complete' },
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

  const doc = await prisma.ideationArtefact.findUnique({
    where:  { id: ideationArtefactId },
    select: {
      docType: true, aiInstructions: true, ideationProjectId: true, sourceCurrencyStatus: true,
      ideationTypePolicyVersionAtCreate: true,
      ideationAiPromptRecordId:          true,
      ideationBestPracticeRecordId:      true,
    },
  })
  const project = doc ? await prisma.ideationProject.findUnique({
    where: { id: doc.ideationProjectId }, select: { projectId: true },
  }) : null

  // --- 2. Source-currency + claim-currency scan (deterministic) ----------
  // Stale source warnings + unresolved ClaimCurrencyCheck rows bubble up
  // as a flag on the first section — the 85% gate stays blocked until
  // the author resolves them or acknowledges the drift.
  if (doc) {
    const targetId = rows[0]!.sectionId
    if (doc.sourceCurrencyStatus && doc.sourceCurrencyStatus !== 'current') {
      const bucket = flagsBySection.get(targetId)!
      if (!bucket.includes('source_currency:stale')) bucket.push('source_currency:stale')
      ;(reasonsBySection.get(targetId) ?? reasonsBySection.set(targetId, []).get(targetId)!)
        .push(`Source artefact marked '${doc.sourceCurrencyStatus}' — confirm or refresh the source document.`)
    }
    const openCurrency = await prisma.claimCurrencyCheck.count({
      where: { ideationArtefactId, acknowledgedBy: null },
    }).catch(() => 0)
    if (openCurrency > 0) {
      const bucket = flagsBySection.get(targetId)!
      if (!bucket.includes('claim_currency:unresolved')) bucket.push('claim_currency:unresolved')
      ;(reasonsBySection.get(targetId) ?? reasonsBySection.set(targetId, []).get(targetId)!)
        .push(`${openCurrency} unresolved claim-currency finding(s) on this artefact.`)
    }
  }

  // --- 3. LLM checks -----------------------------------------------------
  let modelUsed: string | null = null
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim()
  const hasDraftedContent = rows.some(r => stripTags(r.contentHtml ?? '').length >= MIN_CONTENT_CHARS)
  if (apiKey && hasDraftedContent && doc) {
    try {
      const projectRow = project?.projectId
        ? await prisma.project.findUnique({ where: { id: project.projectId }, select: { tenantId: true } })
        : null
      modelUsed = await resolveDraftModel(prisma, projectRow?.tenantId ?? null)
      const docType = (doc.docType ?? 'ideation_artefact').toLowerCase().replace(/-/g, '_')
      const policy = await resolveIdeationPolicyForArtefact(prisma, {
        docType,
        ideationTypePolicyVersionAtCreate: doc.ideationTypePolicyVersionAtCreate,
        ideationAiPromptRecordId:          doc.ideationAiPromptRecordId,
        ideationBestPracticeRecordId:      doc.ideationBestPracticeRecordId,
      })
      const sourcePdfs = project ? await loadSourcePdfs(prisma, project.projectId, log) : []
      const aiFlagged = await runLlmChecks({
        apiKey,
        model:           modelUsed,
        docType,
        channelHint: policy?.channelHint ?? null,
        sections:        rows.map(r => ({ id: r.sectionId, number: r.sectionNumber, title: r.sectionTitle, html: r.contentHtml ?? '' })),
        sourcePdfs,
        aiInstructions:  doc.aiInstructions?.trim() || null,
      })
      for (const flag of aiFlagged) {
        const bucket = flagsBySection.get(flag.sectionId)
        if (!bucket) continue
        if (!bucket.includes(flag.code)) bucket.push(flag.code)
        ;(reasonsBySection.get(flag.sectionId) ?? reasonsBySection.set(flag.sectionId, []).get(flag.sectionId)!)
          .push(flag.reason)
      }
      log.info({ ideationArtefactId, iteration, aiFlaggedCount: aiFlagged.length }, 'idea_ai_validation_pass: LLM checks applied')
    } catch (err) {
      log.warn({ ideationArtefactId, iteration, err: err instanceof Error ? err.message : String(err) }, 'idea_ai_validation_pass: LLM checks failed')
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
      await tx.ideationArtefactSection.update({
        where: { id: row.id },
        data:  { aiConfidence: confidence, aiFlags: flags },
      })
    }
  })

  const confidenceOverall = overallConfidence(perSectionScores)
  const stop = shouldStopLoop({ iteration, confidenceOverall, failingCount: failingIds.length })

  log.info({
    ideationArtefactId, iteration,
    sectionsTotal: rows.length,
    failing:       failingIds.length,
    confidenceOverall,
    willStop:      stop,
  }, 'idea_ai_validation_pass: evaluated')

  const nextState: 'validating' | 'complete' = stop ? 'complete' : 'validating'
  await prisma.ideationArtefact.update({
    where: { id: ideationArtefactId },
    data:  { aiDraftState: nextState },
  }).catch(() => undefined)

  if (stop) {
    try {
      const owner = await prisma.ideationArtefact.findUnique({
        where: { id: ideationArtefactId },
        select: { ownerId: true, title: true, ideationProjectId: true },
      })
      const parent = owner ? await prisma.ideationProject.findUnique({
        where: { id: owner.ideationProjectId }, select: { projectId: true },
      }) : null
      if (owner && owner.ownerId) {
        await prisma.notification.create({
          data: {
            recipientId: owner.ownerId,
            kind:        'ideation_artefact.validation_complete',
            severity:    failingIds.length === 0 ? 'info' : 'warning',
            title:       `AI validation ${failingIds.length === 0 ? 'complete' : 'complete (with residuals)'} — "${owner.title}"`,
            body:        failingIds.length === 0
              ? `All sections cleared validation at ${confidenceOverall}% confidence (${iteration} pass${iteration === 1 ? '' : 'es'}).`
              : `${failingIds.length} section${failingIds.length === 1 ? '' : 's'} still failing after ${iteration} pass${iteration === 1 ? '' : 'es'} (${confidenceOverall}% overall).`,
            linkPath:    parent ? `/projects/${parent.projectId}/ideation-publishing/artefacts/${ideationArtefactId}` : null,
            channels:    ['in_app'],
            payload:     { ideationArtefactId, iteration, confidenceOverall, failing: failingIds.length },
          },
        }).catch(err => log.warn({ err, ideationArtefactId }, 'idea.validation_complete: notification write failed'))
      }
    } catch (err) {
      log.warn({ err, ideationArtefactId }, 'idea.validation_complete: fan-out failed')
    }

    return {
      ideationArtefactId, iteration,
      passing:           rows.length - failingIds.length,
      failing:           failingIds.length,
      failingIds,
      confidenceOverall,
      status:            failingIds.length === 0 ? 'complete' : 'complete_with_residuals',
    }
  }

  try {
    await enqueue('ideation.ai_initial_draft', {
      ideationArtefactId,
      projectId:        job.data.projectId,
      actorId:          job.data.actorId,
      targetSectionIds: failingIds,
    }, { delayMs: 1_000, jobId: `idea-ai-redraft-${ideationArtefactId}-${iteration}` })

    await enqueue('ideation.ai_validation_pass', {
      ...job.data,
      iteration: iteration + 1,
    }, { delayMs: 10_000, jobId: `idea-ai-validation-${ideationArtefactId}-${iteration + 1}` })
  } catch (err) {
    log.error({ ideationArtefactId, iteration, err: err instanceof Error ? err.message : String(err) }, 'idea_ai_validation_pass: enqueue failed — chain breaks')
    await prisma.ideationArtefact.update({
      where: { id: ideationArtefactId }, data: { aiDraftState: 'complete' },
    }).catch(() => undefined)
  }

  return {
    ideationArtefactId, iteration,
    passing:           rows.length - failingIds.length,
    failing:           failingIds.length,
    failingIds,
    confidenceOverall,
    status:            'chained',
  }
}
