// Med content section + version + lock routes — Phase M-C.2.
// Mirror of PublicationSection routes.
//
//   GET    /med-content/:id/sections                       — current-version sections
//   PATCH  /med-content/:id/sections/:sectionId            — save HTML (lock-gated)
//   POST   /med-content/:id/sections/:sectionId/lock       — acquire / extend
//   DELETE /med-content/:id/sections/:sectionId/lock       — release
//   GET    /med-content/:id/locks                          — live section locks
//   GET    /med-content/:id/versions                       — version history
//   POST   /med-content/:id/versions/bump                  — new version
//
// Slide-level locks live under /med-slides (hcp_slide_deck surface):
//   POST   /med-slides/:slideId/lock                       — acquire / extend
//   DELETE /med-slides/:slideId/lock                       — release
//   GET    /med-slide-decks/:deckJobId/locks               — live deck locks
//
// Full RACI gating (actorCanEditMedContent) lands in Phase M-C.5.

import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { requireAuth, hasAnyRole } from '../../../auth/rbac.js'
import {
  MedContentSectionService,
  MedContentSectionServiceError,
} from './section-service.js'
import {
  acquireMedContentSectionLock,
  acquireMedSlideLock,
  getMedContentSectionLockHolder,
  listMedContentSectionLocks,
  listMedSlideLocks,
  releaseMedContentSectionLock,
  releaseMedSlideLock,
  requireMedContentSectionLockHeldBy,
  MED_CONTENT_LOCK_STALE_SECONDS,
} from './section-lock-service.js'
import {
  actorCanEditMedContent,
  actorCanEditMedSlide,
  MED_CONTENT_EDIT_FORBIDDEN,
} from '../access/med-content-raci.js'

const gate      = requireAuth({ modules: ['C'] })
const writeGate = requireAuth({ modules: ['C'] })

const patchSectionSchema = z.object({
  contentHtml: z.string().max(5_000_000),
})

const bumpSchema = z.object({
  label:            z.string().min(1).max(80),
  newVersionNumber: z.string().regex(/^v\d+\.\d+$/, 'use vN.M'),
  note:             z.string().max(500).optional(),
})

export const medContentSectionRoutes: FastifyPluginAsync = async (app) => {
  const sectionSvc = new MedContentSectionService(app.prisma)

  function mapError(err: unknown): { code: number; body: Record<string, unknown> } | null {
    if (!(err instanceof MedContentSectionServiceError)) return null
    switch (err.code) {
      case 'no_current_version': return { code: 409, body: { error: 'no_current_version', message: err.message } }
      case 'section_not_found':  return { code: 404, body: { error: 'section_not_found',  message: err.message } }
    }
  }

  app.get('/:id/sections', { preHandler: gate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const item = await app.prisma.medContentItem.findUnique({
      where: { id }, select: { id: true, archivedAt: true },
    })
    if (!item || item.archivedAt) return reply.code(404).send({ error: 'not_found' })
    const sections = await sectionSvc.listCurrentSections(id)
    return {
      contentItemId: id,
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

    const item = await app.prisma.medContentItem.findUnique({
      where: { id }, select: { id: true, archivedAt: true },
    })
    if (!item || item.archivedAt) return reply.code(404).send({ error: 'not_found' })

    if (!(await actorCanEditMedContent(app.prisma, request.user!, id))) {
      return reply.code(403).send(MED_CONTENT_EDIT_FORBIDDEN)
    }

    const blocker = await requireMedContentSectionLockHeldBy(app.prisma, {
      contentItemId: id, sectionId, userId: request.user!.id,
    })
    if (blocker) {
      return reply.code(423).send({
        error:        'locked',
        holder:       blocker,
        staleSeconds: MED_CONTENT_LOCK_STALE_SECONDS,
      })
    }

    try {
      const row = await sectionSvc.upsertSectionContent({
        contentItemId: id, sectionId, contentHtml: parsed.data.contentHtml, actorId: request.user!.id,
      })
      await app.audit.append({
        timestamp:  new Date().toISOString(),
        actorId:    request.user!.id,
        action:     'med_content_section_edited',
        entityType: 'med_content_item',
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
    const item = await app.prisma.medContentItem.findUnique({
      where: { id }, select: { id: true, archivedAt: true },
    })
    if (!item || item.archivedAt) return reply.code(404).send({ error: 'not_found' })
    if (!(await actorCanEditMedContent(app.prisma, request.user!, id))) {
      return reply.code(403).send(MED_CONTENT_EDIT_FORBIDDEN)
    }
    const result = await acquireMedContentSectionLock(app.prisma, {
      contentItemId: id, sectionId, userId: request.user!.id,
    })
    if (result.outcome === 'conflict') {
      return reply.code(423).send({ error: 'locked', holder: result.holder, staleSeconds: MED_CONTENT_LOCK_STALE_SECONDS })
    }
    if (result.outcome === 'acquired' || result.outcome === 'stolen') {
      await app.audit.append({
        timestamp:  new Date().toISOString(),
        actorId:    request.user!.id,
        action:     result.outcome === 'stolen' ? 'med_content_section_lock_stolen' : 'med_content_section_lock_acquired',
        entityType: 'med_content_item',
        entityId:   id,
        details:    { sectionId },
        ipAddress:  request.ip ?? null,
      })
    }
    return reply.code(result.outcome === 'extended' ? 200 : 201).send({
      outcome: result.outcome, holder: result.holder, staleSeconds: MED_CONTENT_LOCK_STALE_SECONDS,
    })
  })

  app.delete('/:id/sections/:sectionId/lock', { preHandler: writeGate }, async (request) => {
    const { id, sectionId } = request.params as { id: string; sectionId: string }
    const isAdmin = hasAnyRole(request.user!, 'admin')
    const existing = await getMedContentSectionLockHolder(app.prisma, { contentItemId: id, sectionId })
    const released = await releaseMedContentSectionLock(app.prisma, {
      contentItemId: id, sectionId, userId: request.user!.id, force: isAdmin,
    })
    if (released && existing && existing.userId !== request.user!.id) {
      await app.audit.append({
        timestamp:  new Date().toISOString(),
        actorId:    request.user!.id,
        action:     'med_content_section_lock_force_released',
        entityType: 'med_content_item',
        entityId:   id,
        details:    { sectionId, previousHolderId: existing.userId },
        ipAddress:  request.ip ?? null,
      })
    }
    return { released }
  })

  app.get('/:id/locks', { preHandler: gate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const item = await app.prisma.medContentItem.findUnique({
      where: { id }, select: { id: true, archivedAt: true },
    })
    if (!item || item.archivedAt) return reply.code(404).send({ error: 'not_found' })
    const locks = await listMedContentSectionLocks(app.prisma, id)
    return { contentItemId: id, staleSeconds: MED_CONTENT_LOCK_STALE_SECONDS, locks }
  })

  app.get('/:id/versions', { preHandler: gate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const item = await app.prisma.medContentItem.findUnique({
      where: { id }, select: { id: true, archivedAt: true, currentVersionId: true },
    })
    if (!item || item.archivedAt) return reply.code(404).send({ error: 'not_found' })
    const versions = await sectionSvc.listVersions(id)
    return {
      contentItemId: id,
      currentVersionId: item.currentVersionId,
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
    const item = await app.prisma.medContentItem.findUnique({
      where: { id }, select: { id: true, archivedAt: true },
    })
    if (!item || item.archivedAt) return reply.code(404).send({ error: 'not_found' })
    if (!(await actorCanEditMedContent(app.prisma, request.user!, id))) {
      return reply.code(403).send(MED_CONTENT_EDIT_FORBIDDEN)
    }
    try {
      const version = await sectionSvc.bumpVersion({
        contentItemId: id, label: parsed.data.label,
        newVersionNumber: parsed.data.newVersionNumber,
        actorId: request.user!.id, note: parsed.data.note,
      })
      await app.audit.append({
        timestamp:  new Date().toISOString(),
        actorId:    request.user!.id,
        action:     'med_content_version_bumped',
        entityType: 'med_content_item',
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
}

// -------- Slide-level locks ----------------------------------------------

export const medSlideLockRoutes: FastifyPluginAsync = async (app) => {
  app.post('/med-slides/:slideId/lock', { preHandler: writeGate }, async (request, reply) => {
    const { slideId } = request.params as { slideId: string }
    const slide = await app.prisma.medSlide.findUnique({
      where: { id: slideId }, select: { id: true, deckJobId: true },
    })
    if (!slide) return reply.code(404).send({ error: 'not_found' })
    const slideGate = await actorCanEditMedSlide(app.prisma, request.user!, slideId)
    if (!slideGate.allowed) return reply.code(403).send(MED_CONTENT_EDIT_FORBIDDEN)
    const result = await acquireMedSlideLock(app.prisma, {
      slideId, userId: request.user!.id,
    })
    if (result.outcome === 'conflict') {
      return reply.code(423).send({ error: 'locked', holder: result.holder, staleSeconds: MED_CONTENT_LOCK_STALE_SECONDS })
    }
    return reply.code(result.outcome === 'extended' ? 200 : 201).send({
      outcome: result.outcome, holder: result.holder, staleSeconds: MED_CONTENT_LOCK_STALE_SECONDS,
    })
  })

  app.delete('/med-slides/:slideId/lock', { preHandler: writeGate }, async (request) => {
    const { slideId } = request.params as { slideId: string }
    const isAdmin = hasAnyRole(request.user!, 'admin')
    const released = await releaseMedSlideLock(app.prisma, {
      slideId, userId: request.user!.id, force: isAdmin,
    })
    return { released }
  })

  app.get('/med-slide-decks/:deckJobId/locks', { preHandler: gate }, async (request, reply) => {
    const { deckJobId } = request.params as { deckJobId: string }
    const deck = await app.prisma.medSlideDeckJob.findUnique({
      where: { id: deckJobId }, select: { id: true },
    })
    if (!deck) return reply.code(404).send({ error: 'not_found' })
    const locks = await listMedSlideLocks(app.prisma, deckJobId)
    return { deckJobId, staleSeconds: MED_CONTENT_LOCK_STALE_SECONDS, locks }
  })
}
