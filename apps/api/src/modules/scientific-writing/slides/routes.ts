// Slide deck routes (sPM-slide-deck-backend).
//
// Real backing for the Module B SlidedeckGenerator UI, which until this
// batch spoke to non-existent endpoints. The UI expects:
//   GET   /publications/:publicationId/slides/:jobId      — full deck
//   PATCH /publications/:publicationId/slides/:jobId/slides/:slideId
//   POST  /publications/:publicationId/slides/:jobId/export
//
// Plus the per-slide edit history + revert endpoints added here:
//   GET   /slides/:slideId/history
//   POST  /slide-edits/:editId/revert
//
// Content model: Slide carries title + bodyText + speakerNotes. Edit history
// serialises all three fields into one JSON payload per edit so revert can
// restore the whole slide atomically.

import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { requireAuth } from '../../../auth/rbac.js'

// --- Serialisation helpers for edit history payloads -----------------------

interface SlideContent { title: string; bodyText: string; speakerNotes: string }

function serialiseSlide(s: SlideContent): string {
  return JSON.stringify({ title: s.title, bodyText: s.bodyText, speakerNotes: s.speakerNotes })
}

function parseSlideSnapshot(json: string | null): SlideContent | null {
  if (!json) return null
  try {
    const parsed = JSON.parse(json)
    if (typeof parsed !== 'object' || parsed === null) return null
    return {
      title:        typeof parsed.title === 'string'        ? parsed.title        : '',
      bodyText:     typeof parsed.bodyText === 'string'     ? parsed.bodyText     : '',
      speakerNotes: typeof parsed.speakerNotes === 'string' ? parsed.speakerNotes : '',
    }
  } catch { return null }
}

const slidePatchSchema = z.object({
  title:        z.string().max(500).optional(),
  bodyText:     z.string().max(10_000).optional(),
  speakerNotes: z.string().max(10_000).optional(),
  position:     z.number().int().min(1).max(999).optional(),
})

// Shape a Slide row for the UI's packages/types Slide interface.
function slideShape(s: {
  id: string
  position: number
  title: string
  bodyText: string
  speakerNotes: string
  figures: Array<{ id: string; figureRef: string; altText: string | null; figureDescription: string | null }>
}) {
  return {
    id:           s.id,
    position:     s.position,
    title:        s.title,
    bodyText:     s.bodyText,
    speakerNotes: s.speakerNotes,
    figures: s.figures.map(f => ({
      figureId:          f.figureRef,
      altText:           f.altText,
      figureDescription: f.figureDescription ?? undefined,
    })),
  }
}

const createJobSchema = z.object({
  styleProfileId: z.string().min(1).optional(),
}).partial()

export const slidesRoutes: FastifyPluginAsync = async (app) => {
  // ---- POST create slide-job (seed slide-per-section skeleton) -------------
  //
  // The SlidedeckGenerator UI calls this on first-mount for a publication
  // that has no deck yet. We synthesise one slide per IMRAD section of the
  // manuscript (title, body stub) so the editor has something concrete to
  // open against; the real AI render runs server-side later and overwrites
  // the stubs in-place. The job returns `status: 'queued' | 'generating'`
  // so the client can poll /publications/:id/slides/:jobId for progress.
  //
  // The styleProfileId body field is accepted but ignored today — style-
  // profile wiring is a Phase 4+ scope choice and tracked in the Module B
  // deferrals memory.
  app.post('/publications/:publicationId/slides', { preHandler: requireAuth({ modules: ['B'] }) }, async (request, reply) => {
    const { publicationId } = request.params as { publicationId: string }
    const parsed = createJobSchema.safeParse(request.body ?? {})
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const pub = await app.prisma.publication.findUnique({
      where: { id: publicationId },
      select: { id: true, deletedAt: true, title: true },
    })
    if (!pub || pub.deletedAt) return reply.code(404).send({ error: 'not_found' })

    // Section skeleton: the Publication model doesn't own section rows the way
    // Document does — manuscripts are drafted inside the editor and we don't
    // persist a per-section split yet (see ManuscriptEditor TODO). Until that
    // lands we seed from a conservative IMRAD outline. If a prior job for
    // this publication exists we reuse the slide titles from the latest one
    // so repeated job-creates land on a stable skeleton.
    const prior = await app.prisma.slideDeckJob.findFirst({
      where: { publicationId },
      orderBy: { createdAt: 'desc' },
      include: { slides: { orderBy: { position: 'asc' }, select: { title: true, bodyText: true } } },
    })

    const skeletonSections = prior && prior.slides.length > 0
      ? prior.slides.map((s, i) => ({ title: s.title, bullets: s.bodyText || '' , position: i + 1 }))
      : [
          { title: 'Title and authors',              bullets: 'Title · author list · affiliations',                position: 1 },
          { title: 'Background',                      bullets: 'Disease context\nUnmet need',                       position: 2 },
          { title: 'Study design',                    bullets: 'Phase · randomisation · masking',                   position: 3 },
          { title: 'Primary endpoint',                bullets: 'HR point estimate · 95% CI · p-value',              position: 4 },
          { title: 'Safety',                          bullets: 'Grade ≥3 TEAE summary\nTreatment discontinuations', position: 5 },
          { title: 'Conclusions',                     bullets: 'Clinical takeaway · next steps',                    position: 6 },
        ]

    // Carry prior deck's congress target forward if any — otherwise null,
    // the UI's congress-gate chip renders a neutral chip when it's unset.
    const congressTarget = prior?.congressTarget ?? null
    const slideCountLimit = prior?.slideCountLimit ?? 20

    const created = await app.prisma.$transaction(async (tx) => {
      const job = await tx.slideDeckJob.create({
        data: {
          publicationId,
          source:          'full-manuscript',
          congressTarget,
          slideCountLimit,
          status:          'generating',
          aiModel:         'claude-sonnet-4-6',
          aiFootprintPct:  0,
          generatedAt:     new Date(),
        },
      })
      for (const s of skeletonSections) {
        await tx.slide.create({
          data: {
            slideDeckJobId: job.id,
            position:       s.position,
            title:          s.title,
            bodyText:       s.bullets,
            speakerNotes:   '',
          },
        })
      }
      return job
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'scientific-writing.slide.job-created',
      entityType: 'slide_deck',
      entityId: created.id,
      details: {
        publicationId,
        slideCount: skeletonSections.length,
        styleProfileId: parsed.data.styleProfileId ?? null,
      },
      ipAddress: request.ip ?? null,
    })

    const slides = await app.prisma.slide.findMany({
      where: { slideDeckJobId: created.id },
      orderBy: { position: 'asc' },
      include: { figures: true },
    })

    return reply.code(201).send({
      jobId:  created.id,
      status: created.status as 'queued' | 'generating',
      slides: slides.map(slideShape),
    })
  })

  // ---- GET deck ------------------------------------------------------------
  app.get('/publications/:publicationId/slides/:jobId', { preHandler: requireAuth({ modules: ['B'] }) }, async (request, reply) => {
    const { publicationId, jobId } = request.params as { publicationId: string; jobId: string }
    const job = await app.prisma.slideDeckJob.findFirst({
      where:   { id: jobId, publicationId },
      include: {
        publication: { select: { title: true } },
        slides:      { orderBy: { position: 'asc' }, include: { figures: true } },
      },
    })
    if (!job) return reply.code(404).send({ error: 'not_found' })

    const missingAltText = job.slides.flatMap(s => s.figures
      .filter(f => !f.altText || f.altText.trim().length === 0)
      .map(f => ({ slideId: s.id, slidePosition: s.position, figureId: f.figureRef })),
    )

    return {
      id:                job.id,
      publicationId:     job.publicationId,
      publicationTitle:  job.publication.title,
      source:            job.source,
      congressTarget:    job.congressTarget ?? '',
      slideCountLimit:   job.slideCountLimit,
      status:            job.status,
      aiModel:           job.aiModel,
      aiFootprintPct:    job.aiFootprintPct,
      generatedAt:       job.generatedAt.toISOString(),
      totalSlides:       job.slides.length,
      clientTemplate:    { id: 'default', label: 'Default template', applied: true },
      congressGateActive:  job.slides.length > job.slideCountLimit,
      congressGateMessage: job.slides.length > job.slideCountLimit
        ? `${job.slides.length} slides exceeds the ${job.slideCountLimit}-slide congress cap.`
        : '',
      accessibilityGate: {
        active:          missingAltText.length > 0,
        missingAltText,
      },
      slides: job.slides.map(slideShape),
    }
  })

  // ---- PATCH slide (in-place content update) + edit-history hook -----------
  app.patch('/publications/:publicationId/slides/:jobId/slides/:slideId', { preHandler: requireAuth({ modules: ['B'] }) }, async (request, reply) => {
    const { publicationId, jobId, slideId } = request.params as { publicationId: string; jobId: string; slideId: string }
    const parsed = slidePatchSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const job = await app.prisma.slideDeckJob.findFirst({ where: { id: jobId, publicationId } })
    if (!job) return reply.code(404).send({ error: 'not_found' })
    const existing = await app.prisma.slide.findFirst({
      where: { id: slideId, slideDeckJobId: jobId },
      include: { figures: true },
    })
    if (!existing) return reply.code(404).send({ error: 'slide_not_found' })

    const before: SlideContent = {
      title:        existing.title,
      bodyText:     existing.bodyText,
      speakerNotes: existing.speakerNotes,
    }
    const after: SlideContent = {
      title:        parsed.data.title        ?? existing.title,
      bodyText:     parsed.data.bodyText     ?? existing.bodyText,
      speakerNotes: parsed.data.speakerNotes ?? existing.speakerNotes,
    }
    const changed = before.title !== after.title
                 || before.bodyText !== after.bodyText
                 || before.speakerNotes !== after.speakerNotes
                 || (parsed.data.position !== undefined && parsed.data.position !== existing.position)

    const updated = await app.prisma.slide.update({
      where: { id: slideId },
      data: {
        title:        parsed.data.title        ?? undefined,
        bodyText:     parsed.data.bodyText     ?? undefined,
        speakerNotes: parsed.data.speakerNotes ?? undefined,
        position:     parsed.data.position     ?? undefined,
      },
      include: { figures: true },
    })

    if (changed) {
      await app.audit.append({
        timestamp: new Date().toISOString(),
        actorId: request.user!.id,
        action: 'slide_edited',
        entityType: 'slide',
        entityId: slideId,
        details: { jobId, position: updated.position },
        ipAddress: request.ip ?? null,
      })

      // Polymorphic edit history — one row per non-noop slide save. Content
      // JSON serialises all three editable fields so revert can restore the
      // slide atomically. origin='manual' for user edits; AI-origin flagged
      // on the server once the AI slide-draft endpoint lands (see memory).
      await app.editHistory.recordEdit({
        entityType: 'slide',
        entityId:   slideId,
        subUnitId:  jobId,
        actorId:    request.user!.id,
        origin:     'manual',
        beforeHtml: serialiseSlide(before),
        afterHtml:  serialiseSlide(after),
      })
    }

    return slideShape(updated)
  })

  // ---- Export stub ---------------------------------------------------------
  app.post('/publications/:publicationId/slides/:jobId/export', { preHandler: requireAuth({ modules: ['B'] }) }, async (request, reply) => {
    const { publicationId, jobId } = request.params as { publicationId: string; jobId: string }
    const job = await app.prisma.slideDeckJob.findFirst({ where: { id: jobId, publicationId } })
    if (!job) return reply.code(404).send({ error: 'not_found' })

    await app.prisma.slideDeckJob.update({
      where: { id: jobId },
      data:  { status: 'exported' },
    })

    const exportedAt = new Date()
    await app.audit.append({
      timestamp: exportedAt.toISOString(),
      actorId: request.user!.id,
      action: 'slide_deck_exported',
      entityType: 'slide_deck',
      entityId: jobId,
      details: { publicationId, stub: true },
      ipAddress: request.ip ?? null,
    })

    // Download URL is a stub pointer; real export worker lands later.
    return {
      exportedAt: exportedAt.toISOString(),
      downloadUrl: `/publications/${publicationId}/slides/${jobId}/download`,
    }
  })

  // ---- Edit history (per slide) + revert -----------------------------------
  app.get('/slides/:slideId/history', { preHandler: requireAuth({ modules: ['B'] }) }, async (request) => {
    const { slideId } = request.params as { slideId: string }
    const q = request.query as { mine?: string; origin?: string }

    const rows = await app.editHistory.listHistory({
      entityType: 'slide',
      entityId:   slideId,
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
      entityType: 'slide',
      entityId:   slideId,
      entries: rows.map(r => {
        const before = parseSlideSnapshot(r.beforeHtml)
        const after  = parseSlideSnapshot(r.afterHtml)
        return {
          id:                 r.id,
          actorId:            r.actorId,
          actorName:          actorMap.get(r.actorId) ?? r.actorId,
          origin:             r.origin,
          createdAt:          r.createdAt.toISOString(),
          beforeHtml:         before?.title ?? r.beforeHtml,       // display sugar: show the title in the panel
          afterHtml:          after?.title ?? r.afterHtml,
          aiCallRecordId:     r.aiCallRecordId,
          revertedFromId:     r.revertedFromId,
          promptText:         null,
          aiModel:            null,
          interveningCount:   r.interveningCount,
          interveningByActor: r.interveningByActor.map(a => ({ ...a, actorName: actorMap.get(a.actorId) ?? a.actorId })),
          canRevert:          r.beforeHtml !== null,
        }
      }),
    }
  })

  app.post('/slide-edits/:editId/revert', { preHandler: requireAuth({ modules: ['B'] }) }, async (request, reply) => {
    const { editId } = request.params as { editId: string }
    try {
      const result = await app.editHistory.revert(editId, request.user!.id)
      await app.audit.append({
        timestamp: new Date().toISOString(),
        actorId: request.user!.id,
        action: 'slide_reverted',
        entityType: 'slide',
        entityId: editId,
        details: { editId, inPlace: true },
        ipAddress: request.ip ?? null,
      })
      // Return the restored slide shape so the UI can swap it in without a refetch.
      const restored = parseSlideSnapshot(result.contentAfter)
      return {
        ok: true,
        revertedAt: new Date().toISOString(),
        restored: restored ?? null,
      }
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
