// Module C slide-deck routes.
//
// Mirrors the Module A document flow at /documents:
//   GET   /med-content/:id/slide-deck       — load (or init) the deck + its slides
//   POST  /med-content/:id/slides/ai-generate
//                                           — enqueue a single-slide AI draft
//   PATCH /med-slides/:slideId              — edit title / body / notes (human)
//   DELETE /med-slides/:slideId             — drop a slide + renumber
//
// Writes gate on AI readiness only for the generator; manual edits + reads
// are always allowed. Module C auditor-read-only is enforced by the shared
// requireAuth({ modules: ['C'] }) guard.

import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { requireAuth } from '../../../auth/rbac.js'
import { resolveAiEngineSettings } from '../../platform/config/ai-engine-settings.js'

const AI_NOT_CONFIGURED = {
  error:     'ai_not_configured',
  message:   'AI is not set up on this platform. Ask an admin to configure the AI engine before generating slides.',
  setupPath: '/admin',
} as const

const generateSchema = z.object({
  prompt:   z.string().max(500).optional().default(''),
  position: z.number().int().positive().optional(),             // 1-based; omit → append
})

const updateSchema = z.object({
  title:        z.string().min(1).max(200).optional(),
  bodyHtml:     z.string().min(0).max(8_000).optional(),
  speakerNotes: z.string().min(0).max(4_000).optional(),
})

interface SlideRow {
  id:              string
  deckJobId:       string
  position:        number
  title:           string
  bodyHtml:        string
  speakerNotes:    string
  aiGenerated:     boolean
  aiModel:         string | null
  aiGeneratedAt:   Date | null
  aiPrompt:        string | null
  lastEditedBy:    string | null
  lastEditedAt:    Date | null
  createdAt:       Date
  updatedAt:       Date
}

function slideShape(s: SlideRow) {
  return {
    id:            s.id,
    deckJobId:     s.deckJobId,
    position:      s.position,
    title:         s.title,
    bodyHtml:      s.bodyHtml,
    speakerNotes:  s.speakerNotes,
    aiGenerated:   s.aiGenerated,
    aiModel:       s.aiModel,
    aiGeneratedAt: s.aiGeneratedAt?.toISOString() ?? null,
    aiPrompt:      s.aiPrompt,
    lastEditedBy:  s.lastEditedBy,
    lastEditedAt:  s.lastEditedAt?.toISOString() ?? null,
    createdAt:     s.createdAt.toISOString(),
    updatedAt:     s.updatedAt.toISOString(),
  }
}

export const slideDeckRoutes: FastifyPluginAsync = async (app) => {
  async function assertAiReady(): Promise<boolean> {
    const engine = await resolveAiEngineSettings(app.prisma)
    return app.aiGateway.isConfigured(engine.default)
  }

  // Resolve (or lazily create) the deck job for this content item. There's
  // one deck per content item in Module C for now; a later change could
  // let the author keep multiple deck variants.
  async function loadOrInitDeck(contentItemId: string, actorId: string) {
    const existing = await app.prisma.medSlideDeckJob.findFirst({
      where: { contentItemId },
      orderBy: { createdAt: 'asc' },
    })
    if (existing) return existing
    // Pin the current DocumentTypePolicy version at creation so later policy
    // bumps don't rewrite this deck's rule-set (same pattern as Document).
    const content = await app.prisma.medContentItem.findUnique({ where: { id: contentItemId } })
    const policy = content
      ? await app.prisma.documentTypePolicy.findFirst({
          where: { docType: content.type, isCurrent: true, retiredAt: null },
          select: { version: true },
        })
      : null
    return app.prisma.medSlideDeckJob.create({
      data: {
        contentItemId,
        createdBy:              actorId,
        policyVersionAtCreate:  policy?.version ?? null,
      },
    })
  }

  // GET /med-content/:id/slide-deck — the deck + its slides in position order.
  app.get('/:contentItemId/slide-deck', { preHandler: requireAuth({ modules: ['C'] }) }, async (request, reply) => {
    const { contentItemId } = request.params as { contentItemId: string }
    const content = await app.prisma.medContentItem.findUnique({ where: { id: contentItemId } })
    if (!content) return reply.code(404).send({ error: 'content_not_found' })
    const deck = await loadOrInitDeck(contentItemId, request.user!.id)
    const slides = await app.prisma.medSlide.findMany({
      where:   { deckJobId: deck.id },
      orderBy: { position: 'asc' },
    })
    return {
      deck: {
        id:                    deck.id,
        contentItemId:         deck.contentItemId,
        source:                deck.source,
        congressTarget:        deck.congressTarget,
        slideCountLimit:       deck.slideCountLimit,
        status:                deck.status,
        aiModel:               deck.aiModel,
        aiFootprintPct:        deck.aiFootprintPct,
        policyVersionAtCreate: deck.policyVersionAtCreate,
        generatedAt:           deck.generatedAt?.toISOString() ?? null,
        createdAt:             deck.createdAt.toISOString(),
        updatedAt:             deck.updatedAt.toISOString(),
      },
      slides: slides.map(s => slideShape(s as SlideRow)),
    }
  })

  // POST /med-content/:id/slides/ai-generate — enqueue a single-slide AI
  // draft. Body: { prompt?: string; position?: number }. Returns 202 + the
  // jobId; the UI polls GET /slide-deck to pick up the new row.
  app.post('/:contentItemId/slides/ai-generate', { preHandler: requireAuth({ modules: ['C'] }) }, async (request, reply) => {
    if (!(await assertAiReady())) return reply.code(503).send(AI_NOT_CONFIGURED)
    const { contentItemId } = request.params as { contentItemId: string }
    const parsed = generateSchema.safeParse(request.body ?? {})
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const content = await app.prisma.medContentItem.findUnique({ where: { id: contentItemId } })
    if (!content) return reply.code(404).send({ error: 'content_not_found' })
    const deck = await loadOrInitDeck(contentItemId, request.user!.id)

    const existingCount = await app.prisma.medSlide.count({ where: { deckJobId: deck.id } })
    const position = parsed.data.position ?? existingCount + 1
    // Dedup the enqueue: an accidental double-click produces the same jobId
    // within the same millisecond → BullMQ collapses it.
    const jobId = `med-slide-${deck.id}-${position}-${Date.now()}`
    try {
      await app.queue.enqueue('med_content.ai_slide_draft', {
        deckJobId: deck.id,
        position,
        prompt:    parsed.data.prompt ?? '',
        actorId:   request.user!.id,
      }, { jobId })
    } catch (err) {
      app.log.warn({ err, deckJobId: deck.id }, 'med slide gen enqueue failed')
      return reply.code(503).send({ error: 'enqueue_failed', message: 'Could not enqueue slide generation. Try again.' })
    }

    await app.audit.append({
      timestamp:  new Date().toISOString(),
      actorId:    request.user!.id,
      action:     'med_content.slide_ai_enqueued',
      entityType: 'med_slide_deck_job',
      entityId:   deck.id,
      details:    {
        contentItemId, deckJobId: deck.id, position,
        promptChars: (parsed.data.prompt ?? '').length,
        jobId,
      },
      ipAddress:  request.ip ?? null,
    })

    // Flip the deck to 'generating' so the UI can show a pending state
    // without polling the queue directly. The worker flips back to 'ready'
    // on success.
    await app.prisma.medSlideDeckJob.update({
      where: { id: deck.id },
      data:  { status: 'generating' },
    }).catch(() => undefined)

    return reply.code(202).send({ jobId, deckJobId: deck.id, position })
  })
}

// --- slide edit / delete routes (/med-slides/:slideId) ------------------
// Separate plugin because it's mounted under a different prefix in server.ts,
// matching the Module A split between /projects/:projectId/documents and
// /documents/:documentId.

export const slideItemRoutes: FastifyPluginAsync = async (app) => {
  app.patch('/:slideId', { preHandler: requireAuth({ modules: ['C'] }) }, async (request, reply) => {
    const { slideId } = request.params as { slideId: string }
    const parsed = updateSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const existing = await app.prisma.medSlide.findUnique({ where: { id: slideId } })
    if (!existing) return reply.code(404).send({ error: 'slide_not_found' })

    const updated = await app.prisma.medSlide.update({
      where: { id: slideId },
      data: {
        ...(parsed.data.title        !== undefined && { title:        parsed.data.title }),
        ...(parsed.data.bodyHtml     !== undefined && { bodyHtml:     parsed.data.bodyHtml }),
        ...(parsed.data.speakerNotes !== undefined && { speakerNotes: parsed.data.speakerNotes }),
        // Author edit clears the AI-generated flag — pre-MLR + audit should
        // treat human-edited slides differently from pristine AI output.
        aiGenerated:  false,
        lastEditedBy: request.user!.id,
        lastEditedAt: new Date(),
      },
    })

    await app.audit.append({
      timestamp:  new Date().toISOString(),
      actorId:    request.user!.id,
      action:     'med_content.slide_edited',
      entityType: 'med_slide',
      entityId:   slideId,
      details:    { changedKeys: Object.keys(parsed.data) },
      ipAddress:  request.ip ?? null,
    })
    return slideShape(updated as SlideRow)
  })

  app.delete('/:slideId', { preHandler: requireAuth({ modules: ['C'] }) }, async (request, reply) => {
    const { slideId } = request.params as { slideId: string }
    const existing = await app.prisma.medSlide.findUnique({ where: { id: slideId } })
    if (!existing) return reply.code(404).send({ error: 'slide_not_found' })

    // Delete + renumber inside a transaction so the (deckJobId, position)
    // unique constraint holds without a race.
    await app.prisma.$transaction(async (tx) => {
      await tx.medSlide.delete({ where: { id: slideId } })
      const laterSlides = await tx.medSlide.findMany({
        where:   { deckJobId: existing.deckJobId, position: { gt: existing.position } },
        orderBy: { position: 'asc' },
      })
      for (const s of laterSlides) {
        await tx.medSlide.update({ where: { id: s.id }, data: { position: s.position - 1 } })
      }
    })

    await app.audit.append({
      timestamp:  new Date().toISOString(),
      actorId:    request.user!.id,
      action:     'med_content.slide_deleted',
      entityType: 'med_slide',
      entityId:   slideId,
      details:    { deckJobId: existing.deckJobId, position: existing.position },
      ipAddress:  request.ip ?? null,
    })
    return reply.code(204).send()
  })
}
