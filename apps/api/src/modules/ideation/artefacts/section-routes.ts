// Ideation artefact section + version + lock routes — Phase M-E.2.
// Mirror of MedContentSection routes.
//
//   GET    /ideation-artefacts/:id/sections
//   PATCH  /ideation-artefacts/:id/sections/:sectionId
//   POST   /ideation-artefacts/:id/sections/:sectionId/lock
//   DELETE /ideation-artefacts/:id/sections/:sectionId/lock
//   GET    /ideation-artefacts/:id/locks
//   GET    /ideation-artefacts/:id/versions
//   POST   /ideation-artefacts/:id/versions/bump

import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { requireAuth, hasAnyRole } from '../../../auth/rbac.js'
import {
  IdeationArtefactSectionService,
  IdeationArtefactSectionServiceError,
} from './section-service.js'
import {
  acquireIdeationArtefactSectionLock,
  getIdeationArtefactSectionLockHolder,
  listIdeationArtefactSectionLocks,
  releaseIdeationArtefactSectionLock,
  requireIdeationArtefactSectionLockHeldBy,
  IDEA_ART_LOCK_STALE_SECONDS,
} from './section-lock-service.js'
import {
  actorCanEditIdeationArtefact,
  IDEATION_ARTEFACT_EDIT_FORBIDDEN,
} from '../access/ideation-artefact-raci.js'

const gate      = requireAuth({ modules: ['E'] })
const writeGate = requireAuth({ modules: ['E'] })

const patchSectionSchema = z.object({
  contentHtml: z.string().max(5_000_000),
})

const bumpSchema = z.object({
  label:            z.string().min(1).max(80),
  newVersionNumber: z.string().regex(/^v\d+\.\d+$/, 'use vN.M'),
  note:             z.string().max(500).optional(),
})

export const ideationArtefactSectionRoutes: FastifyPluginAsync = async (app) => {
  const sectionSvc = new IdeationArtefactSectionService(app.prisma)

  // GET /ideation-artefacts/:id — header read for the Live editor.
  app.get('/:id', { preHandler: gate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const row = await app.prisma.ideationArtefact.findUnique({ where: { id } })
    if (!row) return reply.code(404).send({ error: 'not_found' })
    return {
      id:                   row.id,
      ideationProjectId:    row.ideationProjectId,
      title:                row.title,
      version:              row.version,
      docType:              row.docType,
      aiDraftState:         row.aiDraftState,
      aiInstructions:       row.aiInstructions,
      currentVersionId:     row.currentVersionId,
      ownerId:              row.ownerId,
      sourceCurrencyStatus: row.sourceCurrencyStatus,
      approvalStatusCheck:  row.approvalStatusCheck,
      createdAt:            row.originalApprovalDate.toISOString(),
    }
  })

  function mapError(err: unknown): { code: number; body: Record<string, unknown> } | null {
    if (!(err instanceof IdeationArtefactSectionServiceError)) return null
    switch (err.code) {
      case 'no_current_version': return { code: 409, body: { error: 'no_current_version', message: err.message } }
      case 'section_not_found':  return { code: 404, body: { error: 'section_not_found',  message: err.message } }
    }
  }

  app.get('/:id/sections', { preHandler: gate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const doc = await app.prisma.ideationArtefact.findUnique({
      where: { id }, select: { id: true },
    })
    if (!doc) return reply.code(404).send({ error: 'not_found' })
    const sections = await sectionSvc.listCurrentSections(id)
    return {
      ideationArtefactId: id,
      sections: sections.map(s => ({
        id:            s.id,
        sectionId:     s.sectionId,
        sectionNumber: s.sectionNumber,
        sectionTitle:  s.sectionTitle,
        contentHtml:   s.contentHtml,
        wordCount:     s.wordCount,
        aiConfidence:  s.aiConfidence,
        aiFlags:       s.aiFlags,
        lastEditedBy:  s.lastEditedBy,
        lastEditedAt:  s.lastEditedAt?.toISOString() ?? null,
      })),
    }
  })

  app.patch('/:id/sections/:sectionId', { preHandler: writeGate }, async (request, reply) => {
    const { id, sectionId } = request.params as { id: string; sectionId: string }
    const parsed = patchSectionSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const doc = await app.prisma.ideationArtefact.findUnique({
      where: { id }, select: { id: true },
    })
    if (!doc) return reply.code(404).send({ error: 'not_found' })

    if (!(await actorCanEditIdeationArtefact(app.prisma, request.user!, id))) {
      return reply.code(403).send(IDEATION_ARTEFACT_EDIT_FORBIDDEN)
    }

    const blocker = await requireIdeationArtefactSectionLockHeldBy(app.prisma, {
      ideationArtefactId: id, sectionId, userId: request.user!.id,
    })
    if (blocker) {
      return reply.code(423).send({
        error:        'locked',
        holder:       blocker,
        staleSeconds: IDEA_ART_LOCK_STALE_SECONDS,
      })
    }

    try {
      const row = await sectionSvc.upsertSectionContent({
        ideationArtefactId: id, sectionId, contentHtml: parsed.data.contentHtml, actorId: request.user!.id,
      })
      await app.audit.append({
        timestamp:  new Date().toISOString(),
        actorId:    request.user!.id,
        action:     'ideation_artefact_section_edited',
        entityType: 'ideation_artefact',
        entityId:   id,
        details:    { sectionId, wordCount: row.wordCount, htmlChars: parsed.data.contentHtml.length },
        ipAddress:  request.ip ?? null,
      })
      return {
        id: row.id, sectionId: row.sectionId, contentHtml: row.contentHtml,
        wordCount: row.wordCount, lastEditedAt: row.lastEditedAt?.toISOString() ?? null,
      }
    } catch (err) {
      const mapped = mapError(err)
      if (mapped) return reply.code(mapped.code).send(mapped.body)
      throw err
    }
  })

  app.post('/:id/sections/:sectionId/lock', { preHandler: writeGate }, async (request, reply) => {
    const { id, sectionId } = request.params as { id: string; sectionId: string }
    const doc = await app.prisma.ideationArtefact.findUnique({
      where: { id }, select: { id: true },
    })
    if (!doc) return reply.code(404).send({ error: 'not_found' })
    if (!(await actorCanEditIdeationArtefact(app.prisma, request.user!, id))) {
      return reply.code(403).send(IDEATION_ARTEFACT_EDIT_FORBIDDEN)
    }
    const result = await acquireIdeationArtefactSectionLock(app.prisma, {
      ideationArtefactId: id, sectionId, userId: request.user!.id,
    })
    if (result.outcome === 'conflict') {
      return reply.code(423).send({ error: 'locked', holder: result.holder, staleSeconds: IDEA_ART_LOCK_STALE_SECONDS })
    }
    if (result.outcome === 'acquired' || result.outcome === 'stolen') {
      await app.audit.append({
        timestamp:  new Date().toISOString(),
        actorId:    request.user!.id,
        action:     result.outcome === 'stolen' ? 'ideation_artefact_section_lock_stolen' : 'ideation_artefact_section_lock_acquired',
        entityType: 'ideation_artefact',
        entityId:   id,
        details:    { sectionId },
        ipAddress:  request.ip ?? null,
      })
    }
    return reply.code(result.outcome === 'extended' ? 200 : 201).send({
      outcome: result.outcome, holder: result.holder, staleSeconds: IDEA_ART_LOCK_STALE_SECONDS,
    })
  })

  app.delete('/:id/sections/:sectionId/lock', { preHandler: writeGate }, async (request) => {
    const { id, sectionId } = request.params as { id: string; sectionId: string }
    const isAdmin = hasAnyRole(request.user!, 'admin')
    const existing = await getIdeationArtefactSectionLockHolder(app.prisma, { ideationArtefactId: id, sectionId })
    const released = await releaseIdeationArtefactSectionLock(app.prisma, {
      ideationArtefactId: id, sectionId, userId: request.user!.id, force: isAdmin,
    })
    if (released && existing && existing.userId !== request.user!.id) {
      await app.audit.append({
        timestamp:  new Date().toISOString(),
        actorId:    request.user!.id,
        action:     'ideation_artefact_section_lock_force_released',
        entityType: 'ideation_artefact',
        entityId:   id,
        details:    { sectionId, previousHolderId: existing.userId },
        ipAddress:  request.ip ?? null,
      })
    }
    return { released }
  })

  app.get('/:id/locks', { preHandler: gate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const doc = await app.prisma.ideationArtefact.findUnique({
      where: { id }, select: { id: true },
    })
    if (!doc) return reply.code(404).send({ error: 'not_found' })
    const locks = await listIdeationArtefactSectionLocks(app.prisma, id)
    return { ideationArtefactId: id, staleSeconds: IDEA_ART_LOCK_STALE_SECONDS, locks }
  })

  app.get('/:id/versions', { preHandler: gate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const doc = await app.prisma.ideationArtefact.findUnique({
      where: { id }, select: { id: true, currentVersionId: true },
    })
    if (!doc) return reply.code(404).send({ error: 'not_found' })
    const versions = await sectionSvc.listVersions(id)
    return {
      ideationArtefactId: id,
      currentVersionId: doc.currentVersionId,
      versions: versions.map(v => ({
        id: v.id, versionNumber: v.versionNumber, label: v.label,
        isCurrent: v.isCurrent, createdBy: v.createdBy, createdAt: v.createdAt.toISOString(),
      })),
    }
  })

  app.post('/:id/versions/bump', { preHandler: writeGate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const parsed = bumpSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })
    const doc = await app.prisma.ideationArtefact.findUnique({
      where: { id }, select: { id: true },
    })
    if (!doc) return reply.code(404).send({ error: 'not_found' })
    if (!(await actorCanEditIdeationArtefact(app.prisma, request.user!, id))) {
      return reply.code(403).send(IDEATION_ARTEFACT_EDIT_FORBIDDEN)
    }
    try {
      const version = await sectionSvc.bumpVersion({
        ideationArtefactId: id, label: parsed.data.label,
        newVersionNumber: parsed.data.newVersionNumber,
        actorId: request.user!.id, note: parsed.data.note,
      })
      await app.audit.append({
        timestamp:  new Date().toISOString(),
        actorId:    request.user!.id,
        action:     'ideation_artefact_version_bumped',
        entityType: 'ideation_artefact',
        entityId:   id,
        details:    { versionNumber: version.versionNumber, label: version.label, note: parsed.data.note ?? null },
        ipAddress:  request.ip ?? null,
      })
      return reply.code(201).send({
        id: version.id, versionNumber: version.versionNumber, label: version.label,
        createdAt: version.createdAt.toISOString(),
      })
    } catch (err) {
      const mapped = mapError(err)
      if (mapped) return reply.code(mapped.code).send(mapped.body)
      throw err
    }
  })

  // Phase M-E.3 — kick off the AI initial-draft worker.
  const draftRequestSchema = z.object({
    aiInstructions: z.string().max(2000).optional(),
  })
  app.post('/:ideationArtefactId/ai-initial-draft', { preHandler: writeGate }, async (request, reply) => {
    const { ideationArtefactId } = request.params as { ideationArtefactId: string }
    const parsed = draftRequestSchema.safeParse(request.body ?? {})
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const art = await app.prisma.ideationArtefact.findUnique({
      where: { id: ideationArtefactId },
      select: {
        id: true, ideationProjectId: true,
        aiDraftState: true, currentVersionId: true,
      },
    })
    if (!art) return reply.code(404).send({ error: 'not_found' })
    if (!art.currentVersionId) {
      return reply.code(409).send({
        error:   'no_current_version',
        message: 'Ideation artefact has no current version. Create flow should have seeded v0.1 when a docType was provided.',
      })
    }
    if (!(await actorCanEditIdeationArtefact(app.prisma, request.user!, ideationArtefactId))) {
      return reply.code(403).send(IDEATION_ARTEFACT_EDIT_FORBIDDEN)
    }
    if (art.aiDraftState === 'drafting' || art.aiDraftState === 'validating') {
      return reply.code(409).send({
        error:   'already_running',
        state:   art.aiDraftState,
        message: `AI draft chain is already ${art.aiDraftState} for this artefact.`,
      })
    }

    if (parsed.data.aiInstructions !== undefined) {
      await app.prisma.ideationArtefact.update({
        where: { id: ideationArtefactId },
        data:  { aiInstructions: parsed.data.aiInstructions.trim() || null, aiDraftState: 'idle' },
      })
    }

    const parent = await app.prisma.ideationProject.findUnique({
      where: { id: art.ideationProjectId }, select: { projectId: true },
    })

    const jobId = `idea-ai-initial-draft-${ideationArtefactId}`
    try {
      await app.queue.enqueue('ideation.ai_initial_draft', {
        ideationArtefactId,
        projectId: parent?.projectId ?? art.ideationProjectId,
        actorId:   request.user!.id,
      }, { jobId })
    } catch (err) {
      request.log.warn({ err, ideationArtefactId }, 'idea ai-initial-draft: enqueue failed')
      return reply.code(503).send({ error: 'enqueue_failed', message: 'Could not enqueue the draft job.' })
    }

    await app.audit.append({
      timestamp:  new Date().toISOString(),
      actorId:    request.user!.id,
      action:     'ideation_artefact_ai_initial_draft_enqueued',
      entityType: 'ideation_artefact',
      entityId:   ideationArtefactId,
      details:    { jobId, hasAiInstructions: parsed.data.aiInstructions !== undefined },
      ipAddress:  request.ip ?? null,
    })

    return reply.code(202).send({ jobId, ideationArtefactId, state: 'enqueued' })
  })
}
