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
import { z } from 'zod'
import { requireAuth } from '../../../auth/rbac.js'
import { actorCanEditDocumentContent } from '../../platform/document-raci/access.js'
import { canSeeDocument } from '../../projects/visibility.js'
import { DocumentBriefService } from './service.js'
import { OpenFlagService } from './open-flags-service.js'

export const documentBriefRoutes: FastifyPluginAsync = async (app) => {
  const svc = new DocumentBriefService(app.prisma)
  const openFlagSvc = new OpenFlagService(app.prisma)

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

  // --------------------------------------------------------------------
  // Open flags — list + resolve endpoints.
  //
  // The flags are populated by the /ai-suggest call-site every time the
  // model emits an escape-hatch token. This routes let the UI:
  //   - render a full flags-management surface (list)
  //   - let the writer resolve or dismiss a finding (resolve)
  //
  // Read gate: canSeeDocument — anyone who can read the doc sees the
  //            flags (they are not PHI; they are drafting metadata).
  // Write gate: actorCanEditDocumentContent — same scope that controls
  //            section edits. Reviewers / observers can see but can't
  //            resolve, matching the Part 11 principle that the author
  //            (or a QC letter) owns the content decision.
  // --------------------------------------------------------------------

  app.get('/:documentId/brief/open-flags', { preHandler: requireAuth({ modules: ['A'] }) }, async (request, reply) => {
    const { documentId } = request.params as { documentId: string }
    const { status } = request.query as { status?: string }

    const doc = await app.prisma.document.findUnique({
      where:  { id: documentId },
      select: { id: true, deletedAt: true },
    })
    if (!doc || doc.deletedAt) return reply.code(404).send({ error: 'not_found' })
    if (!(await canSeeDocument(app.prisma, request.user!, documentId))) {
      return reply.code(404).send({ error: 'not_found' })
    }

    const validStatus =
      status === 'open' || status === 'resolved' || status === 'dismissed' ? status : undefined
    const rows = await openFlagSvc.listAll({ documentId, status: validStatus })
    return { flags: rows }
  })

  const resolveSchema = z.object({
    status:         z.enum(['resolved', 'dismissed']),
    resolutionNote: z.string().max(2000).nullable().optional(),
  })

  app.post('/:documentId/brief/open-flags/:flagId/resolve', { preHandler: requireAuth({ modules: ['A'] }) }, async (request, reply) => {
    const { documentId, flagId } = request.params as { documentId: string; flagId: string }
    const parsed = resolveSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const doc = await app.prisma.document.findUnique({
      where:  { id: documentId },
      select: { id: true, deletedAt: true },
    })
    if (!doc || doc.deletedAt) return reply.code(404).send({ error: 'not_found' })
    if (!(await canSeeDocument(app.prisma, request.user!, documentId))) {
      return reply.code(404).send({ error: 'not_found' })
    }
    if (!(await actorCanEditDocumentContent(app.prisma, request.user!, documentId))) {
      return reply.code(403).send({ error: 'forbidden', message: 'You can only resolve flags on documents you can edit.' })
    }

    const updated = await openFlagSvc.resolve({
      flagId,
      documentId,
      actorId:        request.user!.id,
      status:         parsed.data.status,
      resolutionNote: parsed.data.resolutionNote ?? null,
    })
    // Service returns null for missing / cross-doc / already-resolved —
    // all collapse to 404 from the caller's point of view (the UI
    // refetches and the stale row disappears).
    if (!updated) return reply.code(404).send({ error: 'not_found' })

    await app.audit.append({
      timestamp:  new Date().toISOString(),
      actorId:    request.user!.id,
      action:     'clinical-writing.document.brief-open-flag-resolved',
      entityType: 'document',
      entityId:   documentId,
      details: {
        flagId,
        sectionId:      updated.sectionId,
        type:           updated.type,
        newStatus:      updated.status,
        resolutionNote: updated.resolutionNote,
      },
      ipAddress:  request.ip ?? null,
    })

    return updated
  })
}
