// ICH E3 Validator — Module A reference tooling (FR-A-026).
//
// Reads the document's current section set + any waiver rows and returns
// one row per catalog section with a status (complete / in_progress /
// not_started / waived). The old /documents/:id/ich-e3 endpoint was mock-
// only; this real implementation computes from the live DB.
//
// Routes:
//   GET  /documents/:documentId/ich-e3                   — compute report
//   POST /documents/:documentId/ich-e3/:code/waive       — admin only
//   DELETE /documents/:documentId/ich-e3/:code/waive     — admin only
//
// All routes module-gate on 'A'. Waive is additionally role-gated to
// 'admin' or 'reviewer' per the "designated role" clause of FR-A-026.

import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { requireAuth } from '../../../auth/rbac.js'
import {
  buildIchE3Report,
  ICH_E3_SECTION_CODES,
} from './catalog.js'

const waiveSchema = z.object({
  reason: z.string().min(10, 'Waiver reason must be at least 10 characters (Part 11 trail)').max(500),
})

export const ichE3Routes: FastifyPluginAsync = async (app) => {
  // --- Report ------------------------------------------------------------

  app.get('/:documentId/ich-e3', { preHandler: requireAuth({ modules: ['A'] }) }, async (request, reply) => {
    const { documentId } = request.params as { documentId: string }

    const doc = await app.prisma.document.findUnique({
      where: { id: documentId },
      include: {
        currentVersion: {
          include: { sections: { select: { sectionId: true, contentHtml: true, ichStatus: true } } },
        },
      },
    })
    if (!doc || doc.deletedAt) return reply.code(404).send({ error: 'not_found' })

    const waivers = await app.prisma.ichSectionWaiver.findMany({
      where: { documentId },
      select: { sectionCode: true, waivedBy: true, waivedAt: true, reason: true, versionAtWaiver: true },
    })

    return buildIchE3Report({
      sections: doc.currentVersion?.sections ?? [],
      waivers,
    })
  })

  // --- Waive + unwaive ---------------------------------------------------

  app.post(
    '/:documentId/ich-e3/:sectionCode/waive',
    { preHandler: requireAuth({ modules: ['A'], roles: ['admin', 'reviewer'] }) },
    async (request, reply) => {
      const { documentId, sectionCode } = request.params as { documentId: string; sectionCode: string }

      if (!ICH_E3_SECTION_CODES.has(sectionCode)) {
        return reply.code(400).send({ error: 'unknown_section', message: `Unknown ICH E3 section '${sectionCode}'` })
      }

      const parsed = waiveSchema.safeParse(request.body)
      if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

      const doc = await app.prisma.document.findUnique({
        where: { id: documentId },
        include: { currentVersion: { select: { versionNumber: true } } },
      })
      if (!doc || doc.deletedAt) return reply.code(404).send({ error: 'not_found' })

      const versionAtWaiver = doc.currentVersion?.versionNumber ?? 'v0.0'

      // Upsert so a Reviewer can refresh the waiver reason without having
      // to unwaive first — the audit event still fires with before/after.
      const existing = await app.prisma.ichSectionWaiver.findUnique({
        where: { documentId_sectionCode: { documentId, sectionCode } },
      })

      const waiver = await app.prisma.ichSectionWaiver.upsert({
        where: { documentId_sectionCode: { documentId, sectionCode } },
        create: {
          documentId,
          sectionCode,
          waivedBy: request.user!.id,
          reason: parsed.data.reason,
          versionAtWaiver,
        },
        update: {
          reason: parsed.data.reason,
          waivedBy: request.user!.id,
          waivedAt: new Date(),
          versionAtWaiver,
        },
      })

      await app.audit.append({
        timestamp: new Date().toISOString(),
        actorId: request.user!.id,
        action: existing ? 'ich_section_waiver_updated' : 'ich_section_waived',
        entityType: 'document',
        entityId: documentId,
        details: {
          sectionCode,
          reason: parsed.data.reason,
          versionAtWaiver,
          previousReason: existing?.reason ?? null,
        },
        ipAddress: request.ip ?? null,
      })

      return reply.code(existing ? 200 : 201).send(waiver)
    },
  )

  app.delete(
    '/:documentId/ich-e3/:sectionCode/waive',
    { preHandler: requireAuth({ modules: ['A'], roles: ['admin', 'reviewer'] }) },
    async (request, reply) => {
      const { documentId, sectionCode } = request.params as { documentId: string; sectionCode: string }

      const existing = await app.prisma.ichSectionWaiver.findUnique({
        where: { documentId_sectionCode: { documentId, sectionCode } },
      })
      if (!existing) return reply.code(404).send({ error: 'not_waived' })

      await app.prisma.ichSectionWaiver.delete({ where: { id: existing.id } })

      await app.audit.append({
        timestamp: new Date().toISOString(),
        actorId: request.user!.id,
        action: 'ich_section_waiver_cleared',
        entityType: 'document',
        entityId: documentId,
        details: {
          sectionCode,
          clearedReason: existing.reason,
          waivedBy: existing.waivedBy,
          waivedAt: existing.waivedAt.toISOString(),
        },
        ipAddress: request.ip ?? null,
      })

      return reply.code(204).send()
    },
  )
}
