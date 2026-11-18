// Regulatory document section + version + lock routes — Phase M-D.2.
// Mirror of MedContentSection routes.
//
//   GET    /regulatory-documents/:id/sections
//   PATCH  /regulatory-documents/:id/sections/:sectionId
//   POST   /regulatory-documents/:id/sections/:sectionId/lock
//   DELETE /regulatory-documents/:id/sections/:sectionId/lock
//   GET    /regulatory-documents/:id/locks
//   GET    /regulatory-documents/:id/versions
//   POST   /regulatory-documents/:id/versions/bump

import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { requireAuth, hasAnyRole } from '../../../auth/rbac.js'
import {
  RegulatoryDocumentSectionService,
  RegulatoryDocumentSectionServiceError,
} from './section-service.js'
import {
  acquireRegularoryDocumentSectionLock,
  getRegulatoryDocumentSectionLockHolder,
  listRegulatoryDocumentSectionLocks,
  releaseRegulatoryDocumentSectionLock,
  requireRegulatoryDocumentSectionLockHeldBy,
  REG_DOC_LOCK_STALE_SECONDS,
} from './section-lock-service.js'

const gate      = requireAuth({ modules: ['D'] })
const writeGate = requireAuth({ modules: ['D'] })

const patchSectionSchema = z.object({
  contentHtml: z.string().max(5_000_000),
})

const bumpSchema = z.object({
  label:            z.string().min(1).max(80),
  newVersionNumber: z.string().regex(/^v\d+\.\d+$/, 'use vN.M'),
  note:             z.string().max(500).optional(),
})

export const regulatoryDocumentSectionRoutes: FastifyPluginAsync = async (app) => {
  const sectionSvc = new RegulatoryDocumentSectionService(app.prisma)

  function mapError(err: unknown): { code: number; body: Record<string, unknown> } | null {
    if (!(err instanceof RegulatoryDocumentSectionServiceError)) return null
    switch (err.code) {
      case 'no_current_version': return { code: 409, body: { error: 'no_current_version', message: err.message } }
      case 'section_not_found':  return { code: 404, body: { error: 'section_not_found',  message: err.message } }
    }
  }

  app.get('/:id/sections', { preHandler: gate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const doc = await app.prisma.regulatoryDocument.findUnique({
      where: { id }, select: { id: true, archivedAt: true },
    })
    if (!doc || doc.archivedAt) return reply.code(404).send({ error: 'not_found' })
    const sections = await sectionSvc.listCurrentSections(id)
    return {
      regulatoryDocumentId: id,
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

    const doc = await app.prisma.regulatoryDocument.findUnique({
      where: { id }, select: { id: true, archivedAt: true },
    })
    if (!doc || doc.archivedAt) return reply.code(404).send({ error: 'not_found' })

    const blocker = await requireRegulatoryDocumentSectionLockHeldBy(app.prisma, {
      regulatoryDocumentId: id, sectionId, userId: request.user!.id,
    })
    if (blocker) {
      return reply.code(423).send({
        error:        'locked',
        holder:       blocker,
        staleSeconds: REG_DOC_LOCK_STALE_SECONDS,
      })
    }

    try {
      const row = await sectionSvc.upsertSectionContent({
        regulatoryDocumentId: id, sectionId, contentHtml: parsed.data.contentHtml, actorId: request.user!.id,
      })
      await app.audit.append({
        timestamp:  new Date().toISOString(),
        actorId:    request.user!.id,
        action:     'regulatory_document_section_edited',
        entityType: 'regulatory_document',
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
    const doc = await app.prisma.regulatoryDocument.findUnique({
      where: { id }, select: { id: true, archivedAt: true },
    })
    if (!doc || doc.archivedAt) return reply.code(404).send({ error: 'not_found' })
    const result = await acquireRegularoryDocumentSectionLock(app.prisma, {
      regulatoryDocumentId: id, sectionId, userId: request.user!.id,
    })
    if (result.outcome === 'conflict') {
      return reply.code(423).send({ error: 'locked', holder: result.holder, staleSeconds: REG_DOC_LOCK_STALE_SECONDS })
    }
    if (result.outcome === 'acquired' || result.outcome === 'stolen') {
      await app.audit.append({
        timestamp:  new Date().toISOString(),
        actorId:    request.user!.id,
        action:     result.outcome === 'stolen' ? 'regulatory_document_section_lock_stolen' : 'regulatory_document_section_lock_acquired',
        entityType: 'regulatory_document',
        entityId:   id,
        details:    { sectionId },
        ipAddress:  request.ip ?? null,
      })
    }
    return reply.code(result.outcome === 'extended' ? 200 : 201).send({
      outcome: result.outcome, holder: result.holder, staleSeconds: REG_DOC_LOCK_STALE_SECONDS,
    })
  })

  app.delete('/:id/sections/:sectionId/lock', { preHandler: writeGate }, async (request) => {
    const { id, sectionId } = request.params as { id: string; sectionId: string }
    const isAdmin = hasAnyRole(request.user!, 'admin')
    const existing = await getRegulatoryDocumentSectionLockHolder(app.prisma, { regulatoryDocumentId: id, sectionId })
    const released = await releaseRegulatoryDocumentSectionLock(app.prisma, {
      regulatoryDocumentId: id, sectionId, userId: request.user!.id, force: isAdmin,
    })
    if (released && existing && existing.userId !== request.user!.id) {
      await app.audit.append({
        timestamp:  new Date().toISOString(),
        actorId:    request.user!.id,
        action:     'regulatory_document_section_lock_force_released',
        entityType: 'regulatory_document',
        entityId:   id,
        details:    { sectionId, previousHolderId: existing.userId },
        ipAddress:  request.ip ?? null,
      })
    }
    return { released }
  })

  app.get('/:id/locks', { preHandler: gate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const doc = await app.prisma.regulatoryDocument.findUnique({
      where: { id }, select: { id: true, archivedAt: true },
    })
    if (!doc || doc.archivedAt) return reply.code(404).send({ error: 'not_found' })
    const locks = await listRegulatoryDocumentSectionLocks(app.prisma, id)
    return { regulatoryDocumentId: id, staleSeconds: REG_DOC_LOCK_STALE_SECONDS, locks }
  })

  app.get('/:id/versions', { preHandler: gate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const doc = await app.prisma.regulatoryDocument.findUnique({
      where: { id }, select: { id: true, archivedAt: true, currentVersionId: true },
    })
    if (!doc || doc.archivedAt) return reply.code(404).send({ error: 'not_found' })
    const versions = await sectionSvc.listVersions(id)
    return {
      regulatoryDocumentId: id,
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
    const doc = await app.prisma.regulatoryDocument.findUnique({
      where: { id }, select: { id: true, archivedAt: true },
    })
    if (!doc || doc.archivedAt) return reply.code(404).send({ error: 'not_found' })
    try {
      const version = await sectionSvc.bumpVersion({
        regulatoryDocumentId: id, label: parsed.data.label,
        newVersionNumber: parsed.data.newVersionNumber,
        actorId: request.user!.id, note: parsed.data.note,
      })
      await app.audit.append({
        timestamp:  new Date().toISOString(),
        actorId:    request.user!.id,
        action:     'regulatory_document_version_bumped',
        entityType: 'regulatory_document',
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
