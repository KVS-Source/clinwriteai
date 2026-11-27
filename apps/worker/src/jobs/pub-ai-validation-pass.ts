// Publications AI validation-pass worker — Module B analogue of
// clinical.ai_validation_pass. Runs after publications.ai_initial_draft
// commits (chained via enqueue on complete). Each pass evaluates every
// section against four check kinds, collects failing sections, and —
// if any fail AND the iteration cap isn't reached — enqueues a
// targeted re-draft of the failing sections, then re-enqueues itself
// for the next pass.
//
// Checks (in order):
//   1. Completeness (deterministic) — stripped HTML ≥ MIN_CONTENT_CHARS.
//   2. ICMJE / authorship (deterministic) — every PublicationAuthor has
//      confirmed all four ICMJE criteria (met=true on PubIcmjeCriterion).
//   3. Disclosure scan (deterministic, Phase M-B.7):
//      a. data-availability statement present somewhere in the body
//      b. funding statement present somewhere in the body
//   4. Guideline compliance (LLM-gated) — Claude checks that items
//      required by the policy's guidelineKey (CONSORT/STROBE/PRISMA/
//      MOOSE/ICMJE/CARE/SPIRIT/ARRIVE) are present across the draft.
//   5. Citation grounding (LLM-gated) — Claude verifies drafted claims
//      against attached source PDFs and flags unsupported assertions.
//
// Loop control (same thresholds as Module A):
//   CONFIDENCE_TARGET = 85, MIN_ITERATIONS = 3, MAX_ITERATIONS = 5.
//
// Rubric mirrors Module A's weights + extends with Module-B-specific
// flag codes:
//   completeness:too_short       = 40
//   ai:guideline_gap             = 30   (new — unmet CONSORT/STROBE/…)
//   ai:unsupported_claim         = 30
//   ai:self_critique             = 30
//   ai:coherence_issue           = 20
//   ai:template_mismatch         = 20
//   icmje:author_incomplete      = 25   (new — ICMJE criteria not acknowledged)
// Everything else → AI_UNKNOWN_WEIGHT = 15.

import { createBlobReaderFromEnv } from '../blob-reader.js'
import { resolveDraftModel } from '../ai-engine-settings.js'
import { resolvePubPolicyForPublication } from './pub-policy-prompt.js'
import { CRITIQUE_OUTPUT_TOKENS } from '../token-limits.js'
import type { JobHandler } from './types.js'

interface PubAiValidationPassPayload {
  publicationId: string
  versionId:     string
  projectId:     string
  actorId:       string
  iteration:     number
}

// ────────────────────────────────────────────────────────────────────────
// Confidence rubric. Keep in sync with Module A's weights where codes
// overlap; Module-B codes (ai:guideline_gap, icmje:author_incomplete)
// are additive.

const FLAG_WEIGHTS: Readonly<Record<string, number>> = {
  'completeness:too_short':   40,
  'ai:self_critique':         30,
  'ai:template_mismatch':     20,
  'ai:coherence_issue':       20,
  'ai:unsupported_claim':     30,
  'ai:guideline_gap':         30,
  'icmje:author_incomplete':  25,
  // Phase M-B.7 — deterministic disclosure checks.
  'disclosure:das_missing':      20,
  'disclosure:funding_missing':  20,
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

// ────────────────────────────────────────────────────────────────────────

const MIN_CONTENT_CHARS = 80
const MAX_SOURCE_BYTES_PER_DOC = 20 * 1024 * 1024
// Env-tunable via AI_MAX_OUTPUT_TOKENS_CRITIQUE (default 8000,
// centralised 2026-11-27). Was 3000 historically.
const MAX_CRITIQUE_OUTPUT_TOKENS = CRITIQUE_OUTPUT_TOKENS

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

interface SourcePdfPayload {
  title: string
  bytes: Buffer
}

async function loadSourcePdfsFromSourceDoc(
  prisma: Parameters<JobHandler>[1]['prisma'],
  sourceDocumentId: string | null,
  log: Parameters<JobHandler>[1]['log'],
): Promise<SourcePdfPayload[]> {
  if (!sourceDocumentId) return []
  const links = await prisma.documentSource.findMany({
    where: { documentId: sourceDocumentId },
    select: { uploadId: true },
  })
  if (links.length === 0) return []
  const uploads = await prisma.documentUpload.findMany({
    where: { id: { in: links.map(l => l.uploadId) } },
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
      log.warn({ uploadId: u.id, err: err instanceof Error ? err.message : String(err) }, 'pub_validation: could not read source blob')
    }
  }
  return out
}

interface AiCheckFlag {
  sectionId: string
  code:      string       // mapped to FLAG_WEIGHTS key
  reason:    string
}

function stripJsonFence(text: string): string {
  const m = /^\s*```(?:json)?\s*\n([\s\S]*?)\n?```\s*$/i.exec(text.trim())
  return (m ? m[1]! : text).trim()
}

/** One Claude call that runs guideline compliance + citation grounding
 *  + general self-critique. Returns a flat list of { sectionId, code,
 *  reason }. Sections not in the list are clean. JSON parse failure =
 *  no flags (deterministic checks still apply). */
async function runLlmChecks(args: {
  apiKey:        string
  model:         string
  docType:       string
  guidelineKey:  string | null
  sections:      Array<{ id: string; number: string; title: string; html: string }>
  sourcePdfs:    SourcePdfPayload[]
  aiInstructions: string | null
}): Promise<AiCheckFlag[]> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk').catch(() => {
    throw new Error('ANTHROPIC_API_KEY is set but @anthropic-ai/sdk is not installed in apps/worker.')
  })
  const client = new Anthropic({ apiKey: args.apiKey })

  const guidelineLine = args.guidelineKey
    ? `Reporting guideline to check: ${args.guidelineKey}. Flag any required checklist items that are missing from the drafted sections.`
    : 'No specific reporting guideline configured — skip guideline-compliance flags.'

  const authorBlock = args.aiInstructions
    ? `\nAuthor's style / scope directives (consider when deciding what counts as a template mismatch): ${args.aiInstructions}\n`
    : ''

  const system = [
    `You are the validation reviewer for a scientific-writing deliverable (${args.docType}).`,
    ``,
    `Evaluate the drafted sections below against three checks:`,
    `  (a) GUIDELINE COMPLIANCE — ${guidelineLine}`,
    `  (b) CITATION GROUNDING — Flag any claim (numeric value, named intervention, patient count, effect size, date) that is not supported by the attached source PDFs. "Not supported" means the attached PDFs do not contain the figure or assertion verbatim or near-verbatim.`,
    `  (c) SELF-CRITIQUE — Flag sections with coherence problems, template mismatch (wrong structure for the section id), or obvious fabrication.`,
    authorBlock,
    ``,
    `OUTPUT CONTRACT — return ONLY a JSON array of objects, each shaped:`,
    `  { "sectionId": "<matching section id>", "code": "ai:guideline_gap" | "ai:unsupported_claim" | "ai:coherence_issue" | "ai:template_mismatch" | "ai:self_critique", "reason": "<one sentence>" }`,
    `No prose before or after the JSON. No markdown fences. An empty array means every section passed every LLM check.`,
    ``,
    `Rules:`,
    `  - Report AT MOST one flag per (sectionId, code) combination.`,
    `  - Only flag issues you are confident about. If the sources are silent on a claim, prefer "ai:unsupported_claim" over "ai:self_critique".`,
    `  - Skip ICMJE / authorship checks — those are handled by a separate deterministic check.`,
    `  - Section ids MUST match the ones in the drafted-sections block exactly.`,
  ].join('\n')

  const pdfBlocks = args.sourcePdfs.map(p => ({
    type: 'document' as const,
    source: {
      type:       'base64' as const,
      media_type: 'application/pdf' as const,
      data:       p.bytes.toString('base64'),
    },
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

export const handleAiValidationPassPublication: JobHandler<PubAiValidationPassPayload> = async (
  job, { prisma, log, enqueue },
) => {
  const { publicationId, versionId, iteration } = job.data

  if (iteration > MAX_ITERATIONS) {
    log.warn({ publicationId, iteration }, 'pub_ai_validation_pass: iteration cap reached')
    await prisma.publication.update({
      where: { id: publicationId }, data: { aiDraftState: 'complete' },
    }).catch(() => undefined)
    return { skipped: 'iteration_cap_reached', iteration }
  }

  const rows = await prisma.publicationSectionContent.findMany({
    where: { publicationVersionId: versionId },
    select: { id: true, sectionId: true, sectionNumber: true, sectionTitle: true, contentHtml: true },
  })
  if (rows.length === 0) {
    log.warn({ publicationId, versionId }, 'pub_ai_validation_pass: no section rows — nothing to validate')
    await prisma.publication.update({
      where: { id: publicationId }, data: { aiDraftState: 'complete' },
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

  // --- 2. ICMJE authorship / disclosures (deterministic) -----------------
  // Each PublicationAuthor must have all four PubIcmjeCriterion rows
  // with .met=true. Missing confirmations flag the 'disclosures'
  // section if one exists, else the first section (so the failure is
  // visible somewhere).
  const authors = await prisma.publicationAuthor.findMany({
    where:   { publicationId, removedAt: null },
    select:  { id: true, name: true },
  })
  if (authors.length > 0) {
    const criteria = await prisma.pubIcmjeCriterion.findMany({
      where:  { authorId: { in: authors.map(a => a.id) } },
      select: { authorId: true, criterionIndex: true, met: true },
    })
    const metByAuthor = new Map<string, Set<number>>()
    for (const a of authors) metByAuthor.set(a.id, new Set())
    for (const c of criteria) {
      if (c.met) metByAuthor.get(c.authorId)?.add(c.criterionIndex)
    }
    const incomplete = authors.filter(a => (metByAuthor.get(a.id)?.size ?? 0) < 4)
    if (incomplete.length > 0) {
      const target = rows.find(r => r.sectionId === 'disclosures') ?? rows[0]!
      flagsBySection.get(target.sectionId)!.push('icmje:author_incomplete')
      ;(reasonsBySection.get(target.sectionId) ?? reasonsBySection.set(target.sectionId, []).get(target.sectionId)!)
        .push(`${incomplete.length} co-author${incomplete.length === 1 ? '' : 's'} have not confirmed all four ICMJE criteria (${incomplete.map(a => a.name).slice(0, 3).join(', ')}${incomplete.length > 3 ? `, +${incomplete.length - 3}` : ''})`)
    }
  }

  // --- 3. Disclosure scans (deterministic, Phase M-B.7) ------------------
  // Scan the whole-document body for data-availability + funding
  // disclosures. Missing ones flag the 'disclosures' section if one
  // exists, else the first section — same fallback as the ICMJE check.
  // Phrase lists cover common wording; false negatives are acceptable
  // (admin can force-approve) — false positives are the risk to avoid.
  const DAS_PATTERNS = [
    /data\s+availability/i,
    /data\s+sharing\s+statement/i,
    /underlying\s+data/i,
    /supporting\s+data\s+(are|will be|is)\s+available/i,
  ]
  const FUNDING_PATTERNS = [
    /\bfunding\b/i,
    /\bfunded\s+by\b/i,
    /\bsponsored\s+by\b/i,
    /\bgrant\s+(number|no\.|#)/i,
    /\bno\s+external\s+funding\b/i,
  ]
  const wholeDocText = rows.map(r => stripTags(r.contentHtml ?? '')).join('\n\n')
  const disclosureTarget = rows.find(r => r.sectionId === 'disclosures') ?? rows[0]!
  if (wholeDocText.length > 0) {
    if (!DAS_PATTERNS.some(re => re.test(wholeDocText))) {
      flagsBySection.get(disclosureTarget.sectionId)!.push('disclosure:das_missing')
      ;(reasonsBySection.get(disclosureTarget.sectionId) ?? reasonsBySection.set(disclosureTarget.sectionId, []).get(disclosureTarget.sectionId)!)
        .push('No data-availability statement found. Journals (ICMJE, PLoS, Nature family) require one; add a sentence covering where / how the underlying data can be obtained.')
    }
    if (!FUNDING_PATTERNS.some(re => re.test(wholeDocText))) {
      flagsBySection.get(disclosureTarget.sectionId)!.push('disclosure:funding_missing')
      ;(reasonsBySection.get(disclosureTarget.sectionId) ?? reasonsBySection.set(disclosureTarget.sectionId, []).get(disclosureTarget.sectionId)!)
        .push('No funding disclosure found. Add a funding statement (grant numbers + sponsor, or explicitly "No external funding").')
    }
  }

  // --- 4+5. LLM (guideline + citation grounding + self-critique) ---------
  let modelUsed: string | null = null
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim()
  const hasDraftedContent = rows.some(r => stripTags(r.contentHtml ?? '').length >= MIN_CONTENT_CHARS)
  if (apiKey && hasDraftedContent) {
    try {
      const project = await prisma.project.findUnique({
        where: { id: job.data.projectId },
        select: { tenantId: true },
      })
      modelUsed = await resolveDraftModel(prisma, project?.tenantId ?? null)

      const pub = await prisma.publication.findUnique({
        where: { id: publicationId },
        select: {
          type: true, subtype: true, sourceDocumentId: true, aiInstructions: true,
          pubTypePolicyVersionAtCreate:    true,
          publicationAiPromptRecordId:     true,
          publicationBestPracticeRecordId: true,
        },
      })
      if (pub) {
        const docType = (pub.subtype ? `${pub.type}_${pub.subtype}` : pub.type).toLowerCase().replace(/-/g, '_')
        const policy = await resolvePubPolicyForPublication(prisma, {
          docType,
          pubTypePolicyVersionAtCreate:     pub.pubTypePolicyVersionAtCreate,
          publicationAiPromptRecordId:      pub.publicationAiPromptRecordId,
          publicationBestPracticeRecordId:  pub.publicationBestPracticeRecordId,
        })
        const sourcePdfs = await loadSourcePdfsFromSourceDoc(prisma, pub.sourceDocumentId, log)

        const aiFlagged = await runLlmChecks({
          apiKey,
          model:         modelUsed,
          docType,
          guidelineKey:  policy?.guidelineKey ?? null,
          sections:      rows.map(r => ({ id: r.sectionId, number: r.sectionNumber, title: r.sectionTitle, html: r.contentHtml ?? '' })),
          sourcePdfs,
          aiInstructions: pub.aiInstructions?.trim() || null,
        })
        for (const flag of aiFlagged) {
          const bucket = flagsBySection.get(flag.sectionId)
          if (!bucket) continue
          // Prevent duplicate (sectionId, code) — LLM may still repeat.
          if (!bucket.includes(flag.code)) bucket.push(flag.code)
          ;(reasonsBySection.get(flag.sectionId) ?? reasonsBySection.set(flag.sectionId, []).get(flag.sectionId)!)
            .push(flag.reason)
        }
        log.info({ publicationId, iteration, aiFlaggedCount: aiFlagged.length }, 'pub_ai_validation_pass: LLM checks applied')
      }
    } catch (err) {
      log.warn({
        publicationId, iteration,
        err: err instanceof Error ? err.message : String(err),
      }, 'pub_ai_validation_pass: LLM checks failed — continuing with deterministic only')
    }
  }

  // --- Compute scores + persist per-section ------------------------------
  const perSectionScores: number[] = []
  const failingIds: string[] = []
  await prisma.$transaction(async (tx) => {
    for (const row of rows) {
      const flags = flagsBySection.get(row.sectionId) ?? []
      const confidence = scoreSection(flags)
      perSectionScores.push(confidence)
      if (flags.length > 0) failingIds.push(row.sectionId)
      await tx.publicationSectionContent.update({
        where: { id: row.id },
        data:  { aiConfidence: confidence, aiFlags: flags },
      })
    }
  })

  const confidenceOverall = overallConfidence(perSectionScores)
  const stop = shouldStopLoop({ iteration, confidenceOverall, failingCount: failingIds.length })

  log.info({
    publicationId, iteration,
    sectionsTotal: rows.length,
    failing:       failingIds.length,
    confidenceOverall,
    willStop:      stop,
  }, 'pub_ai_validation_pass: evaluated')

  const nextState: 'validating' | 'complete' = stop ? 'complete' : 'validating'
  await prisma.publication.update({
    where: { id: publicationId },
    data:  { aiDraftState: nextState },
  }).catch(() => undefined)

  if (stop) {
    // Phase M-B.5 — notify all co-authors that the drafting + validation
    // chain finished. Includes the residual-failing count so the author
    // knows whether sections still need manual fixes. Direct Prisma
    // insert (worker can't use app.notifications.send).
    try {
      const pubRow = await prisma.publication.findUnique({
        where:  { id: publicationId },
        select: { title: true, projectId: true },
      })
      const authors = await prisma.publicationAuthor.findMany({
        where:  { publicationId, removedAt: null, userId: { not: null } },
        select: { userId: true },
      })
      const recipientIds = Array.from(new Set(authors.map(a => a.userId!)))
      const severity = failingIds.length === 0 ? 'info' : 'warning'
      const body = failingIds.length === 0
        ? `All sections cleared validation at ${confidenceOverall}% confidence (${iteration} pass${iteration === 1 ? '' : 'es'}).`
        : `${failingIds.length} section${failingIds.length === 1 ? '' : 's'} still failing after ${iteration} pass${iteration === 1 ? '' : 'es'} (${confidenceOverall}% overall).`
      for (const recipientId of recipientIds) {
        await prisma.notification.create({
          data: {
            recipientId,
            kind:        'publication.validation_complete',
            severity,
            title:       `AI validation ${failingIds.length === 0 ? 'complete' : 'complete (with residuals)'} — "${pubRow?.title ?? ''}"`,
            body,
            linkPath:    pubRow ? `/projects/${pubRow.projectId}/scientific-writing/publications/${publicationId}/edit` : null,
            channels:    ['in_app'],
            payload:     { publicationId, iteration, confidenceOverall, failing: failingIds.length },
          },
        }).catch(err => log.warn({ err, recipientId }, 'publication.validation_complete: notification write failed'))
      }
    } catch (err) {
      log.warn({ err, publicationId }, 'publication.validation_complete: fan-out failed')
    }

    return {
      publicationId, iteration,
      passing:           rows.length - failingIds.length,
      failing:           failingIds.length,
      failingIds,
      confidenceOverall,
      status:            failingIds.length === 0 ? 'complete' : 'complete_with_residuals',
    }
  }

  try {
    await enqueue('publications.ai_initial_draft', {
      publicationId,
      projectId:        job.data.projectId,
      actorId:          job.data.actorId,
      targetSectionIds: failingIds,
    }, { delayMs: 1_000, jobId: `pub-ai-redraft-${publicationId}-${iteration}` })

    await enqueue('publications.ai_validation_pass', {
      ...job.data,
      iteration: iteration + 1,
    }, { delayMs: 10_000, jobId: `pub-ai-validation-${publicationId}-${iteration + 1}` })
  } catch (err) {
    log.error({ publicationId, iteration, err: err instanceof Error ? err.message : String(err) }, 'pub_ai_validation_pass: enqueue failed — chain breaks')
    await prisma.publication.update({
      where: { id: publicationId }, data: { aiDraftState: 'complete' },
    }).catch(() => undefined)
  }

  return {
    publicationId, iteration,
    passing:           rows.length - failingIds.length,
    failing:           failingIds.length,
    failingIds,
    confidenceOverall,
    status:            'chained',
  }
}
