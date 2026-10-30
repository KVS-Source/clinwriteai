// ICH E3 Validator â€” Module A reference tooling (FR-A-026).
//
// Reads the document's current section set + any waiver rows and returns
// one row per catalog section with a status (complete / in_progress /
// not_started / waived). The old /documents/:id/ich-e3 endpoint was mock-
// only; this real implementation computes from the live DB.
//
// Routes:
//   GET   /documents/:documentId/ich-e3                        â€” compute report
//   POST  /documents/:documentId/ich-e3/:code/waive            â€” admin / reviewer
//   DELETE /documents/:documentId/ich-e3/:code/waive           â€” admin / reviewer
//   PATCH /documents/:documentId/sections/:sectionId/ich-status â€” mark complete / reopen
//
// All routes module-gate on 'A'. Waive is additionally role-gated to
// 'admin' or 'reviewer' per the "designated role" clause of FR-A-026, and
// only applies to full CSRs (the only document type ICH E3 governs).

import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { hasRole, requireAuth, type Role } from '../../../auth/rbac.js'
import { authoringLockReason } from '../document-status.js'
import {
  buildIchE3Report,
  hasSectionContent,
  ICH_E3_SECTION_CODES,
  isIchE3Applicable,
} from './catalog.js'

const waiveSchema = z.object({
  reason: z.string().min(10, 'Waiver reason must be at least 10 characters (Part 11 trail)').max(500),
})

const ichStatusSchema = z.object({
  status: z.enum(['complete', 'in_progress']),
})

const NOT_APPLICABLE = { error: 'not_applicable', message: 'ICH E3 applies to full Clinical Study Reports only.' } as const

// Who may waive / un-waive. The report echoes the caller's result as
// `canWaive` so the panel shows the button to exactly these users
// (tenant-admin, or a contributor with can-review, via the legacy aliases).
const WAIVE_ROLES: Role[] = ['admin', 'reviewer']

export const ichE3Routes: FastifyPluginAsync = async (app) => {
  // Batched user-id â†’ display-name lookup for waiver rows.
  async function fetchUserNames(ids: ReadonlyArray<string>): Promise<Map<string, string>> {
    const unique = [...new Set(ids)]
    if (unique.length === 0) return new Map()
    const users = await app.prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } })
    return new Map(users.map(u => [u.id, u.name]))
  }

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
    const names = await fetchUserNames(waivers.map(w => w.waivedBy))

    const applicable = isIchE3Applicable(doc.type)
    const report = buildIchE3Report({
      applicable,
      documentTitle: doc.title,
      sections:      doc.currentVersion?.sections ?? [],
      waivers:       waivers.map(w => ({ ...w, waivedByName: names.get(w.waivedBy) ?? null })),
    })
    return { ...report, canWaive: applicable && hasRole(request.user!, WAIVE_ROLES) }
  })

  // --- Section status: mark complete / reopen ----------------------------
  //
  // Saving a section always moves it back to in_progress (changed text must
  // be checked again), so this is the only way a section becomes complete.
  // It changes the status flag on the current version's row in place â€” the
  // content and content hash are untouched, so no new version is cut.

  app.patch(
    '/:documentId/sections/:sectionId/ich-status',
    { preHandler: requireAuth({ modules: ['A'] }) },
    async (request, reply) => {
      const { documentId, sectionId } = request.params as { documentId: string; sectionId: string }

      const parsed = ichStatusSchema.safeParse(request.body)
      if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

      const doc = await app.prisma.document.findUnique({
        where: { id: documentId },
        select: {
          status: true, projectId: true, deletedAt: true,
          currentVersion: { select: { versionNumber: true, sections: {
            where:  { OR: [{ sectionId }, { id: sectionId }] },
            select: { id: true, sectionId: true, contentHtml: true, ichStatus: true },
            take:   1,
          } } },
        },
      })
      if (!doc || doc.deletedAt) return reply.code(404).send({ error: 'not_found' })

      const project = await app.prisma.project.findUnique({ where: { id: doc.projectId }, select: { status: true } })
      const locked = authoringLockReason(doc.status, project?.status)
      if (locked) return reply.code(409).send(locked)

      const section = doc.currentVersion?.sections?.[0]
      if (!section) return reply.code(404).send({ error: 'section_not_found' })

      const next = parsed.data.status
      if (next === 'complete' && !hasSectionContent(section.contentHtml)) {
        return reply.code(400).send({ error: 'section_empty', message: 'An empty section canâ€™t be marked complete.' })
      }
      if (section.ichStatus === next) return { sectionId: section.sectionId, ichStatus: next }

      await app.prisma.sectionContent.update({ where: { id: section.id }, data: { ichStatus: next } })

      await app.audit.append({
        timestamp: new Date().toISOString(),
        actorId: request.user!.id,
        action: next === 'complete' ? 'section_marked_complete' : 'section_reopened',
        entityType: 'document',
        entityId: documentId,
        details: {
          sectionId: section.sectionId,
          versionNumber: doc.currentVersion?.versionNumber ?? null,
          before: section.ichStatus,
          after: next,
        },
        ipAddress: request.ip ?? null,
      })

      return { sectionId: section.sectionId, ichStatus: next }
    },
  )

  // --- Waive + unwaive ---------------------------------------------------

  app.post(
    '/:documentId/ich-e3/:sectionCode/waive',
    { preHandler: requireAuth({ modules: ['A'], roles: WAIVE_ROLES }) },
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
      if (!isIchE3Applicable(doc.type)) return reply.code(400).send(NOT_APPLICABLE)

      const versionAtWaiver = doc.currentVersion?.versionNumber ?? 'v0.0'

      // Upsert so a Reviewer can refresh the waiver reason without having
      // to unwaive first â€” the audit event still fires with before/after.
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
    { preHandler: requireAuth({ modules: ['A'], roles: WAIVE_ROLES }) },
    async (request, reply) => {
      const { documentId, sectionCode } = request.params as { documentId: string; sectionCode: string }

      const doc = await app.prisma.document.findUnique({ where: { id: documentId }, select: { type: true, deletedAt: true } })
      if (!doc || doc.deletedAt) return reply.code(404).send({ error: 'not_found' })
      if (!isIchE3Applicable(doc.type)) return reply.code(400).send(NOT_APPLICABLE)

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
