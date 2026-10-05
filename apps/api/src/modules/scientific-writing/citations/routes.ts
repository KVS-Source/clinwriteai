// Citations routes — Module B (API contract §18).
//
// Vancouver numbering model: labels `[N]` are NOT stored. They're assigned
// at read time by ordering non-removed citations by insertedAt ASC. This
// means remove→renumber is automatic (one PATCH to removedAt propagates to
// every subsequent label on the next GET).
//
// Soft-delete-only: source-document citations (isSourceDocument=true) are
// locked for the publication's active life per FR-B-025 — the DB CHECK
// constraint enforces it, but the route also 422s with the friendly message.

import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { requireAuth } from '../../../auth/rbac.js'

const createSchema = z.object({
  pmid: z.string().optional(),
  title: z.string().min(1),
  shortRef: z.string().min(1),
  fullRef: z.string().min(1),
  locus: z.string().min(1),
  isSourceDocument: z.boolean().default(false),
})

export const citationsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/:publicationId/citations', { preHandler: requireAuth({ modules: ['B'] }) }, async (request, reply) => {
    const { publicationId } = request.params as { publicationId: string }
    const pub = await app.prisma.publication.findUnique({ where: { id: publicationId } })
    if (!pub) return reply.code(404).send({ error: 'not_found' })

    const rows = await app.prisma.citation.findMany({
      where: { publicationId, removedAt: null },
      orderBy: { insertedAt: 'asc' },
    })

    // Attach computed Vancouver label — insertion-order 1-based.
    return rows.map((c, idx) => ({ ...c, label: `[${idx + 1}]` }))
  })

  app.post('/:publicationId/citations', { preHandler: requireAuth({ modules: ['B'] }) }, async (request, reply) => {
    const { publicationId } = request.params as { publicationId: string }
    const parsed = createSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const pub = await app.prisma.publication.findUnique({ where: { id: publicationId } })
    if (!pub) return reply.code(404).send({ error: 'not_found' })

    // Duplicate PMID check — only against live (non-removed) rows. A citation
    // can be re-added after soft-remove without colliding; the previous
    // removed row stays in the audit record.
    if (parsed.data.pmid) {
      const dup = await app.prisma.citation.findFirst({
        where: { publicationId, pmid: parsed.data.pmid, removedAt: null },
      })
      if (dup) {
        return reply.code(409).send({
          error: 'conflict',
          message: `PMID ${parsed.data.pmid} already inserted (citation ${dup.id})`,
        })
      }
    }

    const created = await app.prisma.citation.create({
      data: {
        publicationId,
        pmid: parsed.data.pmid ?? null,
        title: parsed.data.title,
        shortRef: parsed.data.shortRef,
        fullRef: parsed.data.fullRef,
        locus: parsed.data.locus,
        isSourceDocument: parsed.data.isSourceDocument,
        insertedBy: request.user!.id,
      },
    })

    // The new label is simply the count of live citations after insertion —
    // one count query avoids pulling every row back for the handler.
    const liveCount = await app.prisma.citation.count({
      where: { publicationId, removedAt: null },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'citation_inserted',
      entityType: 'publication',
      entityId: publicationId,
      details: {
        citationId: created.id,
        pmid: parsed.data.pmid ?? null,
        label: `[${liveCount}]`,
        isSourceDocument: parsed.data.isSourceDocument,
      },
      ipAddress: request.ip ?? null,
    })

    return reply.code(201).send({ ...created, label: `[${liveCount}]` })
  })

  app.delete('/:publicationId/citations/:citationId', { preHandler: requireAuth({ modules: ['B'] }) }, async (request, reply) => {
    const { publicationId, citationId } = request.params as { publicationId: string; citationId: string }

    const citation = await app.prisma.citation.findFirst({ where: { id: citationId, publicationId } })
    if (!citation) return reply.code(404).send({ error: 'not_found' })
    if (citation.removedAt) return reply.code(204).send()   // idempotent

    if (citation.isSourceDocument) {
      return reply.code(422).send({
        error: 'source_document_locked',
        message: 'Source document citations cannot be removed while the publication is active (FR-B-025).',
      })
    }

    await app.prisma.citation.update({
      where: { id: citationId },
      data: { removedAt: new Date(), removedBy: request.user!.id },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'citation_removed',
      entityType: 'publication',
      entityId: publicationId,
      details: { citationId, pmid: citation.pmid, title: citation.title },
      ipAddress: request.ip ?? null,
    })

    return reply.code(204).send()
  })
}
