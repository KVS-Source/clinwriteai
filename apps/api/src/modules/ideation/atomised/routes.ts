// Atomised content + claim currency check routes — Module E.
//
// AtomisedContent model: one row per channel adaptation of a card. The DB
// has a UNIQUE(card, channel) constraint — attempts to upsert via POST are
// 409 unless the caller used PUT (which replaces the existing row).
//
// aiFootprintHash is a stable sha256 of the generated text + model + card.
// It lets the UI chip "AI 100%" or similar without re-running the LLM.
//
// claim_currency_checks: scoped to the artefact (not the card). The real
// pipeline cross-references each extracted claim against the Master Library;
// the stub records the arrays as-is so the UI can seed test fixtures.

import type { FastifyPluginAsync } from 'fastify'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { requireAuth } from '../../../auth/rbac.js'
import { bestLibraryMatch } from '../../platform/library/text-match.js'

const atomiseSchema = z.object({
  channel: z.enum([
    'linkedin', 'twitter', 'blog', 'email',
    'hcp', 'medical_affairs', 'instagram', 'facebook',
  ]),
  contentText: z.string().min(1),
  aiGenerated: z.boolean().default(true),
  aiModel: z.string().default('claude-sonnet-4-6'),
  brandScreenPassed: z.boolean().default(false),
  complianceScreenPassed: z.boolean().default(false),
})

// Currency-check request. Two input modes:
//
//   mode A (preferred — server-driven):
//     { claimTexts: ['claim one', 'claim two'] }
//     The route matches each text against LibrarySection (category=
//     'claim', isCurrent + non-retired) via token Jaccard and
//     classifies each result:
//       - matches current library row  → current (extracted)
//       - matches retired library row  → superseded
//       - matches 80%+ a library row that was itself superseded by
//         another isCurrent row                → superseded
//       - no match above threshold             → extracted (new)
//     Conflicting detection (semantic contradiction) still needs the
//     AI pass — caller can supply conflictingClaims explicitly.
//
//   mode B (legacy passthrough):
//     { claimsExtracted, supersededClaims, conflictingClaims }
//     Caller already classified; we persist as-is. Kept for backward
//     compatibility with UIs that haven't adopted claimTexts yet.
//
// At least one of claimTexts or the three legacy arrays must be
// supplied (else the request has nothing to record).
const runCurrencySchema = z.object({
  claimTexts: z.array(z.string().min(1).max(2000)).max(100).optional(),
  claimsExtracted: z.array(z.unknown()).default([]),
  supersededClaims: z.array(z.unknown()).default([]),
  conflictingClaims: z.array(z.unknown()).default([]),
})

/** Similarity floor to consider a claim "matched" to a library row. */
const CURRENCY_MATCH_THRESHOLD = 60

function computeFootprintHash(cardId: string, channel: string, text: string, model: string): string {
  return createHash('sha256')
    .update(cardId).update('|').update(channel).update('|').update(model).update('|').update(text)
    .digest('hex')
}

// Shape AtomisedContent rows for the UI's packages/types interface. Adds
// derived display fields the Prisma row doesn't carry:
//   - channelLabel: human-readable channel ('linkedin' → 'LinkedIn')
//   - characterCount / wordCount: computed from contentText (UI shows
//     these in the atomised list header; UI could compute client-side
//     but server-computed keeps the display consistent across clients)
//   - complianceFixes: [] placeholder (future: structured fix suggestions
//     from the compliance screen)
const CHANNEL_LABELS: Record<string, string> = {
  linkedin: 'LinkedIn',
  twitter: 'X / Twitter',
  blog: 'Blog',
  email: 'Email',
  hcp: 'HCP',
  medical_affairs: 'Medical Affairs',
  instagram: 'Instagram',
  facebook: 'Facebook',
}

function atomisedShape(a: { channel: string; contentText: string } & Record<string, unknown>) {
  const text = a.contentText ?? ''
  return {
    ...a,
    channelLabel: CHANNEL_LABELS[a.channel] ?? a.channel,
    characterCount: text.length,
    wordCount: text.trim() ? text.trim().split(/\s+/).length : 0,
    complianceFixes: [] as unknown[],
  }
}

export const atomisedRoutes: FastifyPluginAsync = async (app) => {
  app.get('/cards/:cardId/atomised', { preHandler: requireAuth({ modules: ['E'] }) }, async (request, reply) => {
    const { cardId } = request.params as { cardId: string }
    const card = await app.prisma.ideationContentCard.findUnique({ where: { id: cardId } })
    if (!card) return reply.code(404).send({ error: 'not_found' })
    const rows = await app.prisma.atomisedContent.findMany({
      where: { ideationContentCardId: cardId },
      orderBy: { createdAt: 'asc' },
    })
    return rows.map(atomisedShape)
  })

  app.post('/cards/:cardId/atomised', { preHandler: requireAuth({ modules: ['E'] }) }, async (request, reply) => {
    const { cardId } = request.params as { cardId: string }
    const parsed = atomiseSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const card = await app.prisma.ideationContentCard.findUnique({ where: { id: cardId } })
    if (!card) return reply.code(404).send({ error: 'not_found' })

    const existing = await app.prisma.atomisedContent.findUnique({
      where: { ideationContentCardId_channel: { ideationContentCardId: cardId, channel: parsed.data.channel } },
    })
    if (existing) {
      return reply.code(409).send({
        error: 'already_atomised',
        message: `Card already has a ${parsed.data.channel} adaptation (id ${existing.id}). Use PUT to replace.`,
      })
    }

    const hash = computeFootprintHash(cardId, parsed.data.channel, parsed.data.contentText, parsed.data.aiModel)

    const created = await app.prisma.atomisedContent.create({
      data: {
        ideationContentCardId: cardId,
        channel: parsed.data.channel,
        contentText: parsed.data.contentText,
        aiGenerated: parsed.data.aiGenerated,
        aiFootprintHash: hash,
        brandScreenPassed: parsed.data.brandScreenPassed,
        complianceScreenPassed: parsed.data.complianceScreenPassed,
      },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'atomised_content_created',
      entityType: 'ideation_card',
      entityId: cardId,
      details: {
        atomisedId: created.id,
        channel: parsed.data.channel,
        model: parsed.data.aiModel,
        aiFootprintHash: hash.slice(0, 16),
      },
      ipAddress: request.ip ?? null,
    })

    // Polymorphic edit history — origin='ai' because atomised content is
    // always AI-drafted (aiGenerated defaults true in the schema). First
    // write has no beforeHtml snapshot — nothing existed before.
    await app.editHistory.recordEdit({
      entityType: 'atomised_content',
      entityId:   cardId,
      subUnitId:  parsed.data.channel,
      actorId:    request.user!.id,
      origin:     parsed.data.aiGenerated ? 'ai' : 'manual',
      beforeHtml: null,
      afterHtml:  parsed.data.contentText,
    })

    return reply.code(201).send(atomisedShape(created))
  })

  app.put('/cards/:cardId/atomised/:channel', { preHandler: requireAuth({ modules: ['E'] }) }, async (request, reply) => {
    const { cardId, channel } = request.params as { cardId: string; channel: string }
    const parsed = atomiseSchema.safeParse({ ...(request.body as object), channel })
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const existing = await app.prisma.atomisedContent.findUnique({
      where: { ideationContentCardId_channel: { ideationContentCardId: cardId, channel } },
    })
    if (!existing) return reply.code(404).send({ error: 'not_found' })

    const hash = computeFootprintHash(cardId, channel, parsed.data.contentText, parsed.data.aiModel)

    const updated = await app.prisma.atomisedContent.update({
      where: { id: existing.id },
      data: {
        contentText: parsed.data.contentText,
        aiGenerated: parsed.data.aiGenerated,
        aiFootprintHash: hash,
        brandScreenPassed: parsed.data.brandScreenPassed,
        complianceScreenPassed: parsed.data.complianceScreenPassed,
      },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'atomised_content_replaced',
      entityType: 'ideation_card',
      entityId: cardId,
      details: { atomisedId: updated.id, channel, aiFootprintHash: hash.slice(0, 16) },
      ipAddress: request.ip ?? null,
    })

    // Polymorphic edit history — only write if the text actually changed
    // (keeps history honest; a no-op PUT shouldn't clutter the feed).
    if ((existing.contentText ?? '') !== parsed.data.contentText) {
      await app.editHistory.recordEdit({
        entityType: 'atomised_content',
        entityId:   cardId,
        subUnitId:  channel,
        actorId:    request.user!.id,
        origin:     parsed.data.aiGenerated ? 'ai' : 'manual',
        beforeHtml: existing.contentText ?? null,
        afterHtml:  parsed.data.contentText,
      })
    }

    return updated
  })

  // --- Claim currency check ----------------------------------------------

  app.post('/artefacts/:artefactId/currency/run', { preHandler: requireAuth({ modules: ['E'] }) }, async (request, reply) => {
    const { artefactId } = request.params as { artefactId: string }
    const parsed = runCurrencySchema.safeParse(request.body ?? {})
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const artefact = await app.prisma.ideationArtefact.findUnique({ where: { id: artefactId } })
    if (!artefact) return reply.code(404).send({ error: 'not_found' })

    let claimsExtracted  = parsed.data.claimsExtracted as unknown[]
    let supersededClaims = parsed.data.supersededClaims as unknown[]
    const conflictingClaims = parsed.data.conflictingClaims as unknown[]
    let classifiedByServer = false

    // Server-driven path: when the caller supplied claimTexts, match
    // each against LibrarySection and classify. This REPLACES any
    // empty-default extracted/superseded arrays (the client still
    // keeps full control via the legacy passthrough path).
    if (parsed.data.claimTexts && parsed.data.claimTexts.length > 0) {
      // Pool: every claim-category library row — current + retired +
      // superseded. We need the retired/superseded ones to detect
      // "you're using outdated wording" cases.
      const libraryPool = await app.prisma.librarySection.findMany({
        where: { category: 'claim' },
        select: {
          id: true, title: true, body: true,
          isCurrent: true, retiredAt: true, supersededBy: true,
        },
      })
      const extractedRows: Array<Record<string, unknown>> = []
      const supersededRows: Array<Record<string, unknown>> = []
      for (const text of parsed.data.claimTexts) {
        const match = bestLibraryMatch(text, libraryPool.map(r => ({ id: r.id, title: r.title, body: r.body })))
        if (match.librarySectionId === null || match.similarityPct < CURRENCY_MATCH_THRESHOLD) {
          // No reuse signal — treat as newly-extracted / unmatched.
          extractedRows.push({ text, similarityPct: match.similarityPct, librarySectionId: null })
          continue
        }
        const libRow = libraryPool.find(r => r.id === match.librarySectionId)!
        const isStale = libRow.retiredAt !== null || !libRow.isCurrent || libRow.supersededBy !== null
        const row: Record<string, unknown> = {
          text,
          similarityPct:    match.similarityPct,
          librarySectionId: match.librarySectionId,
          libraryTitle:     match.libraryTitle,
        }
        if (isStale) {
          row.reason = libRow.retiredAt ? 'retired' : (libRow.supersededBy ? 'superseded_by_newer' : 'not_current')
          supersededRows.push(row)
        } else {
          extractedRows.push(row)
        }
      }
      claimsExtracted  = extractedRows
      supersededClaims = supersededRows
      classifiedByServer = true
    }

    const run = await app.prisma.claimCurrencyCheck.create({
      data: {
        ideationArtefactId: artefactId,
        claimsExtracted:    claimsExtracted  as unknown as object,
        supersededClaims:   supersededClaims as unknown as object,
        conflictingClaims:  conflictingClaims as unknown as object,
      },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'claim_currency_check_run',
      entityType: 'ideation_artefact',
      entityId: artefactId,
      details: {
        runId: run.id,
        extracted:          claimsExtracted.length,
        superseded:         supersededClaims.length,
        conflicting:        conflictingClaims.length,
        classifiedByServer,
        similarityEngine:   classifiedByServer ? 'jaccard' : null,  // swap to 'pgvector-cosine' when X-2 lands
      },
      ipAddress: request.ip ?? null,
    })

    return run
  })

  app.get('/artefacts/:artefactId/currency/latest', { preHandler: requireAuth({ modules: ['E'] }) }, async (request, reply) => {
    const { artefactId } = request.params as { artefactId: string }
    const latest = await app.prisma.claimCurrencyCheck.findFirst({
      where: { ideationArtefactId: artefactId },
      orderBy: { runAt: 'desc' },
    })
    if (!latest) return reply.code(404).send({ error: 'no_run_yet' })
    return latest
  })

  app.post('/artefacts/:artefactId/currency/:runId/acknowledge', { preHandler: requireAuth({ modules: ['E'] }) }, async (request, reply) => {
    const { artefactId, runId } = request.params as { artefactId: string; runId: string }
    const run = await app.prisma.claimCurrencyCheck.findFirst({
      where: { id: runId, ideationArtefactId: artefactId },
    })
    if (!run) return reply.code(404).send({ error: 'not_found' })
    if (run.acknowledgedBy) return reply.code(409).send({ error: 'already_acknowledged' })

    const updated = await app.prisma.claimCurrencyCheck.update({
      where: { id: runId },
      data: { acknowledgedBy: request.user!.id, acknowledgedAt: new Date() },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'claim_currency_acknowledged',
      entityType: 'ideation_artefact',
      entityId: artefactId,
      details: { runId },
      ipAddress: request.ip ?? null,
    })
    return updated
  })

  // --- Edit history + revert (polymorphic EditHistory, Module E first consumer) ---
  //
  // GET /cards/:cardId/atomised/:channel/history
  //   Returns the full per-channel edit history for that card+channel pair.
  //   Supports ?mine=true and ?origin=ai|manual|undo|restore like Module A.
  //
  // POST /atomised-edits/:editId/revert
  //   Restores the channel's contentText to the beforeHtml of that history
  //   row via the shared EditHistoryService + its atomised_content handler.
  //
  // Rows persist independent of the atomised row's lifecycle — if a user
  // deletes + recreates a channel adaptation, the earlier edits still show
  // in the panel (chronology preserved).

  app.get('/cards/:cardId/atomised/:channel/history', { preHandler: requireAuth({ modules: ['E'] }) }, async (request) => {
    const { cardId, channel } = request.params as { cardId: string; channel: string }
    const q = request.query as { mine?: string; origin?: string }

    const rows = await app.editHistory.listHistory({
      entityType: 'atomised_content',
      entityId:   cardId,
      subUnitId:  channel,
      actorId:    q.mine === 'true' ? request.user!.id : undefined,
      origin:     (q.origin && ['manual', 'ai', 'undo', 'restore'].includes(q.origin))
                    ? q.origin as 'manual' | 'ai' | 'undo' | 'restore'
                    : undefined,
    })

    const actorIds = Array.from(new Set(rows.map(r => r.actorId)))
    const actors = actorIds.length === 0
      ? []
      : await app.prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } })
    const actorMap = new Map(actors.map(a => [a.id, a.name]))

    return {
      entityType: 'atomised_content',
      entityId:   cardId,
      subUnitId:  channel,
      entries: rows.map(r => ({
        id:                 r.id,
        actorId:            r.actorId,
        actorName:          actorMap.get(r.actorId) ?? r.actorId,
        origin:             r.origin,
        createdAt:          r.createdAt.toISOString(),
        beforeHtml:         r.beforeHtml,
        afterHtml:          r.afterHtml,
        aiCallRecordId:     r.aiCallRecordId,
        revertedFromId:     r.revertedFromId,
        promptText:         null,                     // AI integration for atomised comes later
        aiModel:            null,
        interveningCount:   r.interveningCount,
        interveningByActor: r.interveningByActor.map(a => ({ ...a, actorName: actorMap.get(a.actorId) ?? a.actorId })),
        canRevert:          !!r.beforeHtml,
      })),
    }
  })

  app.post('/atomised-edits/:editId/revert', { preHandler: requireAuth({ modules: ['E'] }) }, async (request, reply) => {
    const { editId } = request.params as { editId: string }
    try {
      const result = await app.editHistory.revert(editId, request.user!.id)
      await app.audit.append({
        timestamp: new Date().toISOString(),
        actorId: request.user!.id,
        action: 'atomised_content_reverted',
        entityType: 'ideation_card',
        entityId: editId,
        details: { editId, inPlace: true },
        ipAddress: request.ip ?? null,
      })
      return { ok: true, contentText: result.contentAfter, revertedAt: new Date().toISOString() }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'revert_failed'
      if (msg === 'cannot_revert_no_snapshot')
        return reply.code(422).send({ error: 'no_snapshot' })
      if (msg.includes('not_found'))
        return reply.code(404).send({ error: 'not_found' })
      throw err
    }
  })
}
