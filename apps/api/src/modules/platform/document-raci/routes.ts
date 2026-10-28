// DocumentRaci routes — the authoritative per-document ACL.
//
// Prefix: '/documents'. Routes:
//   GET    /:documentId/raci                     list rows (active + removed)
//   POST   /:documentId/raci                     add a RACI row
//   DELETE /:documentId/raci/:raciId             soft-remove a row (sets removedAt)
//
// Enforcement lives in service.ts (validateRaciInsert). The route layer
// handles HTTP shape, audit emission, and the `admin.self_grant` event
// when a tenant-admin assigns themselves — see
// docs/roles-and-permissions.md §4.2.

import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { requireAuth } from '../../../auth/rbac.js'
import { validateRaciInsert, VALID_LETTERS, type RaciLetter } from './service.js'

const insertSchema = z.object({
  userId: z.string().min(1),
  letter: z.enum(VALID_LETTERS as readonly ['R', 'A', 'C', 'I']),
  sectionId: z.string().min(1).nullable().optional(),
  approvalOrder: z.number().int().min(1).nullable().optional(),
  signatureRequired: z.boolean().optional(),
  signatureMeaning: z.string().min(1).nullable().optional(),
  // Required only when the assignment is a tenant-admin self-grant.
  // Captured on the admin.self_grant audit event. Rejected (400) when
  // the branch triggers but reason is missing.
  selfGrantReason: z.string().min(1).optional(),
})

type RaciAuditSnapshot = {
  documentId: string
  userId: string
  letter: RaciLetter
  sectionId: string | null
  approvalOrder: number | null
  signatureRequired: boolean
  signatureMeaning: string | null
  assignedBy: string
}

export const documentRaciRoutes: FastifyPluginAsync = async (app) => {
  app.get('/:documentId/raci', { preHandler: requireAuth() }, async (request, reply) => {
    const { documentId } = request.params as { documentId: string }
    const document = await app.prisma.document.findUnique({ where: { id: documentId }, select: { id: true } })
    if (!document) return reply.code(404).send({ error: 'document_not_found' })

    const rows = await app.prisma.documentRaci.findMany({
      where: { documentId },
      orderBy: [{ letter: 'asc' }, { assignedAt: 'asc' }],
    })
    return rows
  })

  app.post('/:documentId/raci', { preHandler: requireAuth() }, async (request, reply) => {
    const { documentId } = request.params as { documentId: string }
    const parsed = insertSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })
    }

    const actor = request.user!
    const isActorTenantAdmin = actor.role === 'tenant-admin' || actor.role === 'admin'
    const sectionId = parsed.data.sectionId ?? null
    const approvalOrder = parsed.data.approvalOrder ?? null
    // Default signature_required: true for A (per §3.2), false otherwise.
    const signatureRequired = parsed.data.signatureRequired ?? (parsed.data.letter === 'A')
    const signatureMeaning = parsed.data.signatureMeaning ?? null

    const validation = await validateRaciInsert(app.prisma, {
      documentId,
      userId: parsed.data.userId,
      letter: parsed.data.letter,
      sectionId,
      approvalOrder,
      signatureRequired,
      signatureMeaning,
      assignedBy: actor.id,
      isActorTenantAdmin,
    })

    if (!validation.ok) {
      // Map every failure kind to an HTTP shape. Keeps the route-level
      // branching here rather than spreading HTTP concerns into the service.
      const failure = validation.failure
      switch (failure.kind) {
        case 'invalid_letter':
          return reply.code(400).send({ error: 'invalid_letter', letter: failure.letter })
        case 'user_not_found':
          return reply.code(400).send({ error: 'user_not_found', userId: failure.userId })
        case 'document_not_found':
          return reply.code(404).send({ error: 'document_not_found' })
        case 'missing_capability':
          return reply.code(422).send({
            error: 'missing_capability',
            message: `Letter ${failure.letter} requires capability ${failure.required}`,
            required: failure.required,
          })
        case 'self_grant_denied':
          return reply.code(422).send({ error: 'self_grant_denied', message: failure.reason })
        case 'duplicate_letter_on_section':
          return reply.code(409).send({
            error: 'duplicate_letter_on_section',
            message: `User already holds letter ${failure.existingLetter} on this section`,
            existingLetter: failure.existingLetter,
          })
        case 'whole_doc_vs_section_conflict':
          return reply.code(409).send({
            error: 'whole_doc_vs_section_conflict',
            message: 'User cannot hold a whole-document letter alongside a per-section letter on the same document',
          })
        case 'approval_order_requires_a_letter':
          return reply.code(400).send({
            error: 'approval_order_requires_a_letter',
            message: 'approvalOrder is only valid when letter = A',
          })
        case 'signature_meaning_required':
          return reply.code(400).send({
            error: 'signature_meaning_required',
            message: 'signatureMeaning is required when signatureRequired = true',
          })
      }
    }

    // --- Self-grant branch audit (per §4.2) --------------------------
    const isSelfGrant = parsed.data.userId === actor.id
    const isAdminSelfGrant = isSelfGrant && isActorTenantAdmin
    if (isAdminSelfGrant && !parsed.data.selfGrantReason) {
      return reply.code(400).send({
        error: 'self_grant_reason_required',
        message: 'A tenant-admin granting themselves a RACI letter must supply selfGrantReason',
      })
    }

    const created = await app.prisma.documentRaci.create({
      data: {
        documentId,
        userId: parsed.data.userId,
        letter: parsed.data.letter,
        sectionId,
        approvalOrder,
        signatureRequired,
        signatureMeaning,
        assignedBy: actor.id,
      },
    })

    const after: RaciAuditSnapshot = {
      documentId,
      userId: parsed.data.userId,
      letter: parsed.data.letter,
      sectionId,
      approvalOrder,
      signatureRequired,
      signatureMeaning,
      assignedBy: actor.id,
    }

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: actor.id,
      action: 'document_raci.assigned',
      entityType: 'document_raci',
      entityId: created.id,
      details: { ...after, raciId: created.id },
      ipAddress: request.ip ?? null,
    })

    if (isAdminSelfGrant) {
      await app.audit.append({
        timestamp: new Date().toISOString(),
        actorId: actor.id,
        action: 'admin.self_grant',
        entityType: 'document_raci',
        entityId: created.id,
        details: {
          documentId,
          letter: parsed.data.letter,
          sectionId,
          reason: parsed.data.selfGrantReason!,
          raciId: created.id,
        },
        ipAddress: request.ip ?? null,
      })
    }

    return reply.code(201).send(created)
  })

  app.delete('/:documentId/raci/:raciId', { preHandler: requireAuth() }, async (request, reply) => {
    const { documentId, raciId } = request.params as { documentId: string; raciId: string }
    const existing = await app.prisma.documentRaci.findUnique({ where: { id: raciId } })
    if (!existing || existing.documentId !== documentId) {
      return reply.code(404).send({ error: 'not_found' })
    }
    if (existing.removedAt) {
      return reply.code(409).send({ error: 'already_removed' })
    }

    const actor = request.user!
    const removed = await app.prisma.documentRaci.update({
      where: { id: raciId },
      data: { removedAt: new Date() },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: actor.id,
      action: 'document_raci.removed',
      entityType: 'document_raci',
      entityId: raciId,
      details: {
        documentId,
        userId: existing.userId,
        letter: existing.letter,
        sectionId: existing.sectionId,
        removedAt: removed.removedAt?.toISOString() ?? null,
      },
      ipAddress: request.ip ?? null,
    })

    // Self-removal by a tenant-admin flagged with the same event as self-grant
    // per §4.2: "The same event fires if an admin self-removes a RACI row."
    const isSelfRemoval = existing.userId === actor.id
    const isActorTenantAdmin = actor.role === 'tenant-admin' || actor.role === 'admin'
    if (isSelfRemoval && isActorTenantAdmin) {
      await app.audit.append({
        timestamp: new Date().toISOString(),
        actorId: actor.id,
        action: 'admin.self_grant',
        entityType: 'document_raci',
        entityId: raciId,
        details: {
          documentId,
          letter: existing.letter,
          sectionId: existing.sectionId,
          direction: 'self_remove',
          raciId,
        },
        ipAddress: request.ip ?? null,
      })
    }

    return reply.code(204).send()
  })
}
