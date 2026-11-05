// Section-lock routes (sPM-autosave).
//
//   POST   /documents/:documentId/sections/:sectionId/lock
//          Acquire or extend. Returns { outcome, holder, staleSeconds }.
//          Outcomes: 'acquired' | 'extended' | 'stolen' | 'conflict'. 423 Locked
//          on 'conflict' (another user holds a live lock).
//   DELETE /documents/:documentId/sections/:sectionId/lock
//          Release. Only the holder can release unless the caller is admin.
//   GET    /documents/:documentId/locks
//          Snapshot of every live lock on the document.

import type { FastifyPluginAsync } from 'fastify'
import { requireAuth } from '../../../auth/rbac.js'
import { actorCanEditDocumentContent, DOCUMENT_EDIT_FORBIDDEN } from '../../platform/document-raci/access.js'
import {
  acquireLock,
  getHolder,
  listDocumentLocks,
  releaseLock,
  SECTION_LOCK_STALE_SECONDS,
} from './service.js'
import { PROJECT_CLOSED, documentProjectIsClosed } from '../../projects/closed.js'
import { canSeeDocument } from '../../projects/visibility.js'

export const sectionLockRoutes: FastifyPluginAsync = async (app) => {
  app.post('/:documentId/sections/:sectionId/lock', { preHandler: requireAuth({ modules: ['A'] }) }, async (request, reply) => {
    const { documentId, sectionId } = request.params as { documentId: string; sectionId: string }
    if (await documentProjectIsClosed(app.prisma, documentId)) return reply.code(423).send(PROJECT_CLOSED)

    const doc = await app.prisma.document.findUnique({
      where:  { id: documentId },
      select: { id: true, deletedAt: true },
    })
    if (!doc || doc.deletedAt) return reply.code(404).send({ error: 'not_found' })
    // A viewer must never hold a section lock — it would block the authors.
    if (!(await actorCanEditDocumentContent(app.prisma, request.user!, documentId))) return reply.code(403).send(DOCUMENT_EDIT_FORBIDDEN)

    const result = await acquireLock(app.prisma, {
      documentId, sectionId, userId: request.user!.id,
    })

    if (result.outcome === 'conflict') {
      return reply.code(423).send({
        error:        'locked',
        holder:       result.holder,
        staleSeconds: SECTION_LOCK_STALE_SECONDS,
      })
    }

    if (result.outcome === 'stolen' || result.outcome === 'acquired') {
      // Audit only transfers of ownership (new acquire, stolen stale). Routine
      // same-user extends happen every ~30s and would drown the audit chain.
      await app.audit.append({
        timestamp:  new Date().toISOString(),
        actorId:    request.user!.id,
        action:     result.outcome === 'stolen' ? 'section_lock_stolen' : 'section_lock_acquired',
        entityType: 'document',
        entityId:   documentId,
        details:    { sectionId },
        ipAddress:  request.ip ?? null,
      })
      // Push to other sockets in the doc room so their banners clear /
      // acquire-attempts kick off immediately. Extends don't broadcast —
      // nothing has changed from the room's point of view.
      app.emitSectionLockChanged({
        documentId,
        reason:    result.outcome,
        sectionId,
        userId:    request.user!.id,
        at:        new Date().toISOString(),
      })
    }

    return reply.code(result.outcome === 'extended' ? 200 : 201).send({
      outcome:      result.outcome,
      holder:       result.holder,
      staleSeconds: SECTION_LOCK_STALE_SECONDS,
    })
  })

  app.delete('/:documentId/sections/:sectionId/lock', { preHandler: requireAuth({ modules: ['A'] }) }, async (request) => {
    const { documentId, sectionId } = request.params as { documentId: string; sectionId: string }
    const isAdmin = ['admin'].includes(request.user!.role)
    const existing = await getHolder(app.prisma, { documentId, sectionId })

    const released = await releaseLock(app.prisma, {
      documentId, sectionId, userId: request.user!.id, force: isAdmin,
    })

    if (released && existing && existing.userId !== request.user!.id) {
      // Admin force-release of someone else's lock — audit who did it.
      await app.audit.append({
        timestamp:  new Date().toISOString(),
        actorId:    request.user!.id,
        action:     'section_lock_force_released',
        entityType: 'document',
        entityId:   documentId,
        details:    { sectionId, previousHolderId: existing.userId },
        ipAddress:  request.ip ?? null,
      })
    }

    if (released) {
      app.emitSectionLockChanged({
        documentId,
        reason:    (existing && existing.userId !== request.user!.id) ? 'force_released' : 'released',
        sectionId,
        at:        new Date().toISOString(),
      })
    }

    return { released }
  })

  app.get('/:documentId/locks', { preHandler: requireAuth({ modules: ['A'] }) }, async (request, reply) => {
    const { documentId } = request.params as { documentId: string }
    if (!(await canSeeDocument(app.prisma, request.user!, documentId))) return reply.code(404).send({ error: 'not_found' })
    const doc = await app.prisma.document.findUnique({
      where:  { id: documentId },
      select: { id: true, deletedAt: true },
    })
    if (!doc || doc.deletedAt) return reply.code(404).send({ error: 'not_found' })

    const locks = await listDocumentLocks(app.prisma, documentId)
    return { documentId, staleSeconds: SECTION_LOCK_STALE_SECONDS, locks }
  })
}
