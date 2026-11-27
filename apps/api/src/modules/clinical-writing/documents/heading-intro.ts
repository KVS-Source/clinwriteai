// Main-heading introductions after drafting. A main heading (a number with sub-sections, e.g. "5" over 5.1–5.4)
// gets an introduction written from its own sub-sections (build plan headings: 'lead_in', worker build-plan.ts).
// This module flags the headings that need one and lets an author redraft it from the editor's right panel:
//
//   missing — the heading has no text, though its sub-sections do;
//   stale   — a sub-section changed after the heading's introduction was written.
//
// "Keep as it is" records the decision (documents.heading_reviews); the heading is flagged again only when a
// sub-section changes after that. Redraft returns a preview only; Accept saves it as an AI-drafted edit.
//
//   GET  /documents/:documentId/heading-flags
//   POST /documents/:documentId/headings/:sectionId/redraft   → { html, aiCallRecordId, model } (not saved)
//   POST /documents/:documentId/headings/:sectionId/accept    { html, aiCallRecordId?, model? } or { html, manual: true }
//   POST /documents/:documentId/headings/:sectionId/keep
//
// Only the document's authors (R) and its creator may redraft, accept or keep.

import type { FastifyPluginAsync } from 'fastify'
import type { PrismaClient } from '@prisma/client'
import { z } from 'zod'
import { requireAuth, type AuthenticatedUser } from '../../../auth/rbac.js'
import { actorIsDocumentAuthor } from '../../platform/document-raci/access.js'
import { canSeeDocument } from '../../projects/visibility.js'
import { authoringLockReason } from '../document-status.js'
import { requireLockHeldBy, SECTION_LOCK_STALE_SECONDS } from '../section-locks/service.js'
import { chooseModel } from '../../platform/config/ai-engine-settings.js'
import { classifyAiError } from '../../platform/ai-gateway/ai-error.js'
import { asCostLimit, documentSpend, limitReached } from './ai-cost.js'
import { containsAiPlaceholder, AI_PLACEHOLDER_REFUSAL } from './ai-placeholder.js'
import { DocumentService } from './service.js'
import { runAutocheckForDocument } from '../checklist/autocheck/runner.js'
import { regenBriefInBackground } from '../document-brief/service.js'

// ------------------------------------------------------------------------------------------------ flags

export interface HeadingRow {
  sectionId:    string
  number:       string
  title:        string
  html:         string
  lastEditedAt: Date | null
}

export type HeadingReviews = Record<string, { keptAt: string; keptBy: string }>

export interface HeadingFlag {
  sectionId: string
  number:    string
  title:     string
  reason:    'missing' | 'stale'
  /** Sub-sections changed after the introduction was written (stale), or that have text (missing). */
  changed:   Array<{ number: string; title: string }>
}

const textOf = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()

// Finishing and the validation pass save several sections within moments of each other; a sub-section saved within
// this window after its heading did not change after it.
const SAME_RUN_MS = 2 * 60_000

/**
 * Headings that need an introduction (missing) or a fresh one (stale). Code-built sections are left out.
 * draftDoneAt: when the AI draft last did anything. Its own later saves (validation redrafts, finishing resolving
 * cross-references) don't make a heading stale; only changes after it do.
 */
export function headingFlags(rows: HeadingRow[], reviews: HeadingReviews | null, opts: { exclude?: Set<string>; draftDoneAt?: Date | null } = {}): HeadingFlag[] {
  const flags: HeadingFlag[] = []
  const numbers = rows.map(r => r.number.trim())
  for (const h of rows) {
    const n = h.number.trim()
    if (!n || opts.exclude?.has(n)) continue
    const children = rows.filter(r => r.number.trim().startsWith(`${n}.`))
    if (children.length === 0 || !numbers.includes(n)) continue
    const withText = children.filter(c => textOf(c.html).length > 0)
    if (withText.length === 0) continue
    const kept = reviews?.[h.sectionId]?.keptAt ? new Date(reviews[h.sectionId]!.keptAt).getTime() : 0
    const childChangedAfter = (t: number) => withText.filter(c => (c.lastEditedAt?.getTime() ?? 0) > t)
    const list = (cs: HeadingRow[]) => cs.map(c => ({ number: c.number.trim(), title: c.title }))

    if (textOf(h.html).length === 0) {
      // Kept empty: flagged again only when a sub-section changes after the decision.
      if (kept && childChangedAfter(kept).length === 0) continue
      flags.push({ sectionId: h.sectionId, number: n, title: h.title, reason: 'missing', changed: list(kept ? childChangedAfter(kept) : withText) })
      continue
    }
    const since = Math.max((h.lastEditedAt?.getTime() ?? 0) + SAME_RUN_MS, kept, opts.draftDoneAt?.getTime() ?? 0)
    if (!h.lastEditedAt) continue
    const changed = childChangedAfter(since)
    if (changed.length) flags.push({ sectionId: h.sectionId, number: n, title: h.title, reason: 'stale', changed: list(changed) })
  }
  return flags
}

// ------------------------------------------------------------------------------------------------ prompt

/** Same text as the worker's SECTION_INTRO_RULE (worker build-plan.ts); heading-intro.test.ts keeps them equal. */
export const SECTION_INTRO_RULE = [
  'THIS IS A MAIN SECTION HEADING. Write its introduction, after which its sub-sections (given above) follow in the document.',
  '- Follow the template guidance for this section, at the length it needs.',
  '- Use only facts stated in the sub-sections above (and the study fact sheet). Add no fact that is not in them, even if a source has it; where the guidance asks for something they do not state, write [TBD: what is needed].',
  '- Do not repeat the sub-sections at length: summarise them and refer the reader to them (with cross-reference markers when the instructions ask for them).',
].join('\n')

const SUBSECTIONS_BUDGET_CHARS = 40_000

interface FactLike { label: string; value: string; status: string; source?: { title: string; page: number | null } }

export function headingIntroPrompt(args: {
  docType:      string
  heading:      { number: string; title: string; html: string; instructions?: string | null; guidance?: string | null }
  subSections:  Array<{ number: string; title: string; html: string }>
  facts?:       FactLike[] | null
}): string {
  const { heading } = args
  let budget = SUBSECTIONS_BUDGET_CHARS
  const subs = args.subSections.map(s => {
    const text = textOf(s.html)
    const take = text.slice(0, Math.max(0, budget))
    budget -= take.length
    return `### ${s.number} ${s.title}\n${take || '(no text yet)'}${take.length < text.length ? ' …' : ''}`
  })
  const instructions = (heading.instructions ?? '').trim()
  const guidance = (heading.guidance ?? '').trim()
  const facts = (args.facts ?? []).filter(f => f && typeof f.label === 'string')
  return [
    `You are writing part of a ${args.docType.replace(/_/g, ' ')} document.`,
    `SECTION: ${heading.number} ${heading.title}`,
    instructions || guidance
      ? [
          'TEMPLATE GUIDANCE for this section:',
          instructions ? `  Content requirements:\n    ${instructions.replace(/\n/g, '\n    ')}` : '',
          guidance ? `  Writing guidance:\n    ${guidance.replace(/\n/g, '\n    ')}` : '',
        ].filter(Boolean).join('\n')
      : 'The template gives no guidance for this section: write a short introduction that leads into its sub-sections.',
    facts.length
      ? [
          'STUDY FACT SHEET (checked against the evidence). Wherever the introduction states one of these facts, use exactly this value. A value of [TBD] is not stated in the evidence: write [TBD: <the fact>].',
          ...facts.map(f => `- ${f.label}: ${f.status === 'verified' ? f.value : '[TBD]'}`),
        ].join('\n')
      : '',
    `SUB-SECTIONS of ${heading.number} (as they stand in the document):\n\n${subs.join('\n\n')}`,
    textOf(heading.html) ? `THE CURRENT INTRODUCTION (replace it):\n${textOf(heading.html)}` : '',
    SECTION_INTRO_RULE,
    `- Refer to a sub-section as "Section ${args.subSections[0]?.number ?? `${heading.number}.1`}", using only the numbers listed above.`,
    '- Write the introduction only: no heading, no sub-section text.',
    'Return clean HTML with <p>, <ul>/<li> as appropriate — no Markdown, no code fences, no commentary before or after the HTML.',
  ].filter(Boolean).join('\n\n')
}

/** "Section 9.9" to a number that is not one of the sub-sections → a [TBD] so nobody is pointed at nothing. */
export function checkSectionRefs(html: string, known: Set<string>): string {
  return html.replace(/\bSection\s+(\d+(?:\.\d+)+)\b/g, (m, n: string) => (known.has(n) ? m : `[TBD: cross-reference to Section ${n}]`))
}

const stripFence = (text: string) => {
  const m = /^\s*```[a-zA-Z]*\s*\n([\s\S]*?)\n?```\s*$/.exec(text)
  return (m ? m[1]! : text).trim()
}

// ------------------------------------------------------------------------------------------------ routes

const acceptSchema = z.object({
  html:           z.string().trim().min(1).max(200_000),
  aiCallRecordId: z.string().trim().min(1).max(200).optional(),
  model:          z.string().trim().min(1).max(200).optional(),
  /** Text the writer typed in the panel instead of the AI's: saved as a manual edit. */
  manual:         z.boolean().optional(),
})

export const HEADING_ACTION_FORBIDDEN = {
  error:   'heading_action_forbidden',
  message: 'Only the document’s authors and its creator can redraft or keep a section introduction.',
}

async function canActOnHeadings(prisma: PrismaClient, actor: AuthenticatedUser, doc: { id: string; createdBy: string }) {
  return doc.createdBy === actor.id || (await actorIsDocumentAuthor(prisma, actor, doc.id))
}

const asReviews = (raw: unknown): HeadingReviews =>
  raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as HeadingReviews) : {}

const RUNNING = new Set(['queued', 'drafting', 'validating', 'running', 'pending'])

export const documentsHeadingIntroRoutes: FastifyPluginAsync = async (app) => {
  const gate = requireAuth({ modules: ['A'] })
  const svc = new DocumentService(app.prisma)

  async function load(documentId: string) {
    const doc = await app.prisma.document.findUnique({
      where:  { id: documentId },
      select: {
        id: true, type: true, status: true, projectId: true, createdBy: true, deletedAt: true, aiDraftState: true,
        currentVersionId: true, policyVersionAtCreate: true, headingReviews: true, factSheet: true, aiCostLimit: true,
      },
    })
    if (!doc || doc.deletedAt || !doc.currentVersionId) return null
    const rows = await app.prisma.sectionContent.findMany({
      where:  { documentVersionId: doc.currentVersionId },
      select: {
        sectionId: true, sectionNumber: true, sectionTitle: true, contentHtml: true, lastEditedAt: true,
        templateInstructions: true, templateGuidance: true,
      },
    })
    return { doc, rows }
  }

  // Code-built sections (build plan builtByCode) never get an AI introduction.
  async function codeBuilt(doc: { type: string; policyVersionAtCreate: number | null }): Promise<Set<string>> {
    if (doc.policyVersionAtCreate == null) return new Set()
    const policy = await app.prisma.documentTypePolicy.findUnique({
      where:  { docType_version: { docType: doc.type.replace(/-/g, '_'), version: doc.policyVersionAtCreate } },
      select: { buildPlan: true },
    }).catch(() => null)
    const built = (policy?.buildPlan as { builtByCode?: unknown } | null)?.builtByCode
    return new Set(Array.isArray(built) ? built.flatMap(b => (b && typeof (b as { number?: unknown }).number === 'string' ? [(b as { number: string }).number] : [])) : [])
  }

  const rowsForFlags = (rows: NonNullable<Awaited<ReturnType<typeof load>>>['rows']): HeadingRow[] =>
    rows.map(r => ({ sectionId: r.sectionId, number: r.sectionNumber, title: r.sectionTitle, html: r.contentHtml ?? '', lastEditedAt: r.lastEditedAt }))

  async function authoringLock(doc: { status: string; projectId: string }) {
    const project = await app.prisma.project.findUnique({ where: { id: doc.projectId }, select: { status: true } })
    return authoringLockReason(doc.status, project?.status)
  }

  /** The heading row and its sub-sections, or null when the section is not a main heading of this document. */
  function headingOf(rows: NonNullable<Awaited<ReturnType<typeof load>>>['rows'], sectionId: string) {
    const h = rows.find(r => r.sectionId === sectionId)
    if (!h) return null
    const n = h.sectionNumber.trim()
    const subs = rows
      .filter(r => r.sectionNumber.trim().startsWith(`${n}.`))
      .sort((a, b) => a.sectionNumber.localeCompare(b.sectionNumber, undefined, { numeric: true }))
    return subs.length ? { h, subs } : null
  }

  // ---- GET flags -----------------------------------------------------------------------------------
  app.get('/:documentId/heading-flags', { preHandler: gate }, async (request, reply) => {
    const { documentId } = request.params as { documentId: string }
    if (!(await canSeeDocument(app.prisma, request.user!, documentId))) return reply.code(404).send({ error: 'not_found' })
    const loaded = await load(documentId)
    if (!loaded) return reply.code(404).send({ error: 'not_found' })
    const { doc, rows } = loaded
    const drafting = RUNNING.has(doc.aiDraftState ?? '')
    const locked = await authoringLock(doc)
    // The draft's own steps (not a writer's TBD auto-fill) mark when the AI draft last changed sections.
    const lastStep = drafting ? null : await app.prisma.aiDraftStep.findFirst({
      where: { documentId, kind: { not: 'tbd_autofill_run' } }, orderBy: { timestamp: 'desc' }, select: { timestamp: true },
    }).catch(() => null)
    const flags = drafting ? [] : headingFlags(rowsForFlags(rows), asReviews(doc.headingReviews), { exclude: await codeBuilt(doc), draftDoneAt: lastStep?.timestamp ?? null })
    return {
      flags,
      // While the AI draft runs, headings are drafted in turn; nothing is flagged until it is done.
      drafting,
      canAct: !locked && (await canActOnHeadings(app.prisma, request.user!, doc)),
      locked: locked ? locked.message ?? null : null,
    }
  })

  // ---- POST redraft (preview) ----------------------------------------------------------------------
  app.post('/:documentId/headings/:sectionId/redraft', { preHandler: gate }, async (request, reply) => {
    const { documentId, sectionId } = request.params as { documentId: string; sectionId: string }
    const loaded = await load(documentId)
    if (!loaded) return reply.code(404).send({ error: 'not_found' })
    const { doc, rows } = loaded
    if (!(await canActOnHeadings(app.prisma, request.user!, doc))) return reply.code(403).send(HEADING_ACTION_FORBIDDEN)
    const locked = await authoringLock(doc)
    if (locked) return reply.code(409).send(locked)
    if (RUNNING.has(doc.aiDraftState ?? '')) {
      return reply.code(409).send({ error: 'draft_running', message: 'The AI draft is still running. Section introductions can be redrafted once it is done.' })
    }
    const found = headingOf(rows, sectionId)
    if (!found || (await codeBuilt(doc)).has(found.h.sectionNumber.trim())) {
      return reply.code(422).send({ error: 'not_a_heading', message: 'This section has no sub-sections, so it has no introduction to draft.' })
    }
    const limit = asCostLimit(doc.aiCostLimit)
    if (limit && limitReached(await documentSpend(app.prisma, documentId), limit)) {
      return reply.code(409).send({ error: 'cost_limit_reached', message: 'This document has reached its AI cost limit. A project manager can raise it in AI Debug.' })
    }
    const model = await chooseModel(app.prisma)
    if (!app.aiGateway.isConfigured(model)) {
      return reply.code(503).send({ error: 'ai_not_configured', message: 'No AI engine is configured — paste a key in Admin → AI engine first.' })
    }
    const facts = (doc.factSheet as { facts?: FactLike[] } | null)?.facts ?? null
    const prompt = headingIntroPrompt({
      docType: doc.type,
      heading: {
        number: found.h.sectionNumber.trim(), title: found.h.sectionTitle, html: found.h.contentHtml ?? '',
        instructions: found.h.templateInstructions, guidance: found.h.templateGuidance,
      },
      subSections: found.subs.map(s => ({ number: s.sectionNumber.trim(), title: s.sectionTitle, html: s.contentHtml ?? '' })),
      facts: Array.isArray(facts) ? facts : null,
    })
    let res: Awaited<ReturnType<typeof app.aiGateway.chat>>
    try {
      res = await app.aiGateway.chat({
        tenantId: request.user!.tenantId, projectId: doc.projectId, actorId: request.user!.id, module: 'A',
        intent: 'edit', model, prompt, maxOutputTokens: 2048, documentId,
        sectionId, documentVersionId: doc.currentVersionId ?? undefined, preCallSectionHtml: found.h.contentHtml ?? '',
      })
    } catch (err) {
      // The provider's raw error goes to the log; the writer gets what happened and who can fix it.
      const { status, body } = classifyAiError(err)
      app.log.warn({ err, documentId, sectionId, code: body.error }, 'heading introduction redraft: AI call failed')
      return reply.code(status).send(body)
    }
    const html = checkSectionRefs(stripFence(res.responseText), new Set(found.subs.map(s => s.sectionNumber.trim())))
    if (!textOf(html) || containsAiPlaceholder(html)) {
      return reply.code(502).send({ error: 'ai_empty', message: 'The AI returned no introduction. Try again.' })
    }
    await app.audit.append({
      timestamp: new Date().toISOString(), actorId: request.user!.id, action: 'document.heading_intro_drafted',
      entityType: 'document', entityId: documentId,
      details: { sectionId, sectionNumber: found.h.sectionNumber, aiCallRecordId: res.recordId ?? null, model: res.model ?? model },
      ipAddress: request.ip ?? null,
    })
    return { html, aiCallRecordId: res.recordId ?? null, model: res.model ?? model }
  })

  // ---- POST accept ---------------------------------------------------------------------------------
  app.post('/:documentId/headings/:sectionId/accept', { preHandler: gate }, async (request, reply) => {
    const { documentId, sectionId } = request.params as { documentId: string; sectionId: string }
    const parsed = acceptSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })
    const loaded = await load(documentId)
    if (!loaded) return reply.code(404).send({ error: 'not_found' })
    const { doc, rows } = loaded
    if (!(await canActOnHeadings(app.prisma, request.user!, doc))) return reply.code(403).send(HEADING_ACTION_FORBIDDEN)
    const locked = await authoringLock(doc)
    if (locked) return reply.code(409).send(locked)
    const manual = parsed.data.manual === true
    if (!manual && containsAiPlaceholder(parsed.data.html)) return reply.code(422).send(AI_PLACEHOLDER_REFUSAL)
    if (!textOf(parsed.data.html)) return reply.code(400).send({ error: 'validation', message: 'Write the introduction first.' })
    const found = headingOf(rows, sectionId)
    if (!found) return reply.code(422).send({ error: 'not_a_heading', message: 'This section has no sub-sections, so it has no introduction to draft.' })
    const holder = await requireLockHeldBy(app.prisma, { documentId, sectionId, userId: request.user!.id })
    if (holder) return reply.code(423).send({ error: 'locked', holder, staleSeconds: SECTION_LOCK_STALE_SECONDS })

    const beforeHtml = found.h.contentHtml ?? ''
    const result = await svc.updateSection({
      documentId, sectionId, sectionNumber: found.h.sectionNumber, sectionTitle: found.h.sectionTitle,
      contentHtml: parsed.data.html, editorUserId: request.user!.id,
      ...(manual ? {} : { aiDrafted: true, aiModel: parsed.data.model, aiCallRecordId: parsed.data.aiCallRecordId }),
    })
    if (!manual && parsed.data.aiCallRecordId) {
      await app.prisma.aiCallRecord.updateMany({ where: { id: parsed.data.aiCallRecordId }, data: { postCallDocumentVersionId: result.version.id } })
    }
    await app.audit.append({
      timestamp: new Date().toISOString(), actorId: request.user!.id, action: manual ? 'section_edited' : 'ai_draft_accepted',
      entityType: 'document', entityId: documentId,
      details: {
        sectionId, kind: manual ? 'heading_intro_manual' : 'heading_intro', versionCreated: result.created, versionNumber: result.version.versionNumber,
        aiCallRecordId: manual ? null : parsed.data.aiCallRecordId ?? null, aiModel: manual ? null : parsed.data.model ?? null,
        before: textOf(beforeHtml).slice(0, 2000), after: textOf(parsed.data.html).slice(0, 2000),
      },
      ipAddress: request.ip ?? null,
    })
    void runAutocheckForDocument(app.prisma, { documentId, triggeredBy: `system:autocheck-section-save:${request.user!.id}`, audit: app.audit })
      .catch((err: unknown) => app.log.warn({ err, documentId, sectionId }, 'autocheck after heading accept failed'))
    regenBriefInBackground(app.prisma, documentId, app.log)
    return { ok: true, versionNumber: result.version.versionNumber }
  })

  // ---- POST keep -----------------------------------------------------------------------------------
  app.post('/:documentId/headings/:sectionId/keep', { preHandler: gate }, async (request, reply) => {
    const { documentId, sectionId } = request.params as { documentId: string; sectionId: string }
    const loaded = await load(documentId)
    if (!loaded) return reply.code(404).send({ error: 'not_found' })
    const { doc, rows } = loaded
    if (!(await canActOnHeadings(app.prisma, request.user!, doc))) return reply.code(403).send(HEADING_ACTION_FORBIDDEN)
    const locked = await authoringLock(doc)
    if (locked) return reply.code(409).send(locked)
    const found = headingOf(rows, sectionId)
    if (!found) return reply.code(422).send({ error: 'not_a_heading', message: 'This section has no sub-sections, so it has no introduction to draft.' })
    const reviews = { ...asReviews(doc.headingReviews), [sectionId]: { keptAt: new Date().toISOString(), keptBy: request.user!.id } }
    await app.prisma.document.update({ where: { id: documentId }, data: { headingReviews: reviews as unknown as object } })
    await app.audit.append({
      timestamp: new Date().toISOString(), actorId: request.user!.id, action: 'document.heading_intro_kept',
      entityType: 'document', entityId: documentId,
      details: { sectionId, sectionNumber: found.h.sectionNumber, empty: !textOf(found.h.contentHtml ?? '') },
      ipAddress: request.ip ?? null,
    })
    return { ok: true }
  })
}
