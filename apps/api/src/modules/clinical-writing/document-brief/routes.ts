// GET /documents/:documentId/brief — serve the compact derived brief.
//
// Returns the stored row, or lazily generates one on first call if no
// brief exists yet (back-compat for documents created before this
// migration). The lazy regen path is the same code the fire-and-forget
// triggers use, so the two paths can't diverge.
//
// Response shape (matches what the AI carry-prompt assembler expects):
//   { rev, generatedAt, brief: <DocumentBrief> }
//
// Audit: no PHI. The brief contains the document title + protocol
// metadata, which is already readable via GET /documents/:id. We log
// a `brief_accessed` event (not phi_* — different from the full
// section-content read) so a security review can still trace reads.

import type { FastifyPluginAsync } from 'fastify'
import { requireAuth } from '../../../auth/rbac.js'
import { canSeeDocument } from '../../projects/visibility.js'
import { DocumentBriefService } from './service.js'

export const documentBriefRoutes: FastifyPluginAsync = async (app) => {
  const svc = new DocumentBriefService(app.prisma)

  app.get('/:documentId/brief', { preHandler: requireAuth({ modules: ['A'] }) }, async (request, reply) => {
    const { documentId } = request.params as { documentId: string }

    const doc = await app.prisma.document.findUnique({
      where:  { id: documentId },
      select: { id: true, deletedAt: true },
    })
    if (!doc || doc.deletedAt) return reply.code(404).send({ error: 'not_found' })

    // 404 (not 403) when the caller can't see the document — mirrors
    // the GET /documents/:id leak-proofing.
    if (!(await canSeeDocument(app.prisma, request.user!, documentId))) {
      return reply.code(404).send({ error: 'not_found' })
    }

    // Lazy regen when no row exists yet (document predates migration 62
    // or the trigger hasn't fired after a fresh create).
    let row = await svc.get(documentId)
    if (!row) {
      const brief = await svc.upsert(documentId)
      row = { rev: brief.rev, generatedAt: new Date(brief.generatedAt), brief }
    }

    await app.audit.append({
      timestamp:  new Date().toISOString(),
      actorId:    request.user!.id,
      action:     'clinical-writing.document.brief-accessed',
      entityType: 'document',
      entityId:   documentId,
      details:    { rev: row.rev },
      ipAddress:  request.ip ?? null,
    })

    return {
      rev:         row.rev,
      generatedAt: row.generatedAt.toISOString(),
      brief:       row.brief,
    }
  })
}
