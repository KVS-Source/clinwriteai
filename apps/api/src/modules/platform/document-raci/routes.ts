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
import { evaluateStageTransition, type RaciRowForEval } from './transition-engine.js'
import { canTransitionDocument, type DocumentStatus } from '../../clinical-writing/document-status.js'
import { actorCanEditDocumentRaci } from './access.js'

const completeSchema = z.object({
  signatureId: z.string().min(1).nullable().optional(),
})

const rejectSchema = z.object({
  note: z.string().min(1),
})

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

    // §5a: only R-on-this-doc (or admin) can edit RACI on the doc.
    if (!(await actorCanEditDocumentRaci(app.prisma, actor, documentId))) {
      return reply.code(403).send({
        error: 'raci_edit_forbidden',
        message: 'Only an R on this document (or an admin) can assign RACI. Ask the lead writer.',
      })
    }
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

    // §5a: only R-on-this-doc (or admin) can remove RACI rows. Exception:
    // a user can always remove their own row (self-opt-out) — otherwise a
    // reviewer couldn't excuse themselves from a doc.
    const isSelfRow = existing.userId === actor.id
    if (!isSelfRow && !(await actorCanEditDocumentRaci(app.prisma, actor, documentId))) {
      return reply.code(403).send({
        error: 'raci_edit_forbidden',
        message: 'Only an R on this document (or an admin) can remove other users\' RACI assignments.',
      })
    }
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

  // --- Complete my part ---------------------------------------------------
  // The person holding the letter clicks "Submit my part" / "I'm done
  // reviewing" / "Approve" — sets the appropriate timestamp. For rows with
  // signature_required=true, a signatureId MUST be supplied (the DB CHECK
  // would reject anyway; we return a cleaner 400 up here).
  //
  // After the write, we evaluate the stage transition. The engine's
  // decision is reported in the response for the client to react to; the
  // actual Document.status transition still goes through the existing
  // document state machine (see document-status.ts), so this endpoint
  // doesn't yet mutate Document.status itself. That lands when the
  // stage-auto-transition is wired in Chunk 2.
  app.post('/:documentId/raci/:raciId/complete', { preHandler: requireAuth() }, async (request, reply) => {
    const { documentId, raciId } = request.params as { documentId: string; raciId: string }
    const parsed = completeSchema.safeParse(request.body ?? {})
    if (!parsed.success) {
      return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })
    }

    const row = await app.prisma.documentRaci.findUnique({ where: { id: raciId } })
    if (!row || row.documentId !== documentId) return reply.code(404).send({ error: 'not_found' })
    if (row.removedAt) return reply.code(409).send({ error: 'row_removed' })
    if (row.rejectedAt) return reply.code(409).send({ error: 'row_rejected' })

    const actor = request.user!
    if (row.userId !== actor.id) {
      return reply.code(403).send({ error: 'only_assignee_can_complete' })
    }

    // Already-done check — the per-letter timestamp fields are the source of truth.
    const alreadyDone =
      (row.letter === 'R' && row.submittedAt !== null) ||
      (row.letter === 'C' && row.reviewedAt !== null) ||
      (row.letter === 'A' && row.approvedAt !== null) ||
      row.letter === 'I'
    if (alreadyDone) return reply.code(409).send({ error: 'already_complete' })

    if (row.signatureRequired && !parsed.data.signatureId) {
      return reply.code(400).send({
        error: 'signature_required',
        message: 'This row requires an e-signature; provide signatureId pointing to a completed SignatureRecord',
      })
    }

    const now = new Date()
    const data: Record<string, unknown> = { signatureId: parsed.data.signatureId ?? row.signatureId }
    if (row.letter === 'R') data.submittedAt = now
    if (row.letter === 'C') data.reviewedAt = now
    if (row.letter === 'A') data.approvedAt = now

    const updated = await app.prisma.documentRaci.update({ where: { id: raciId }, data })

    await app.audit.append({
      timestamp: now.toISOString(),
      actorId: actor.id,
      action: 'document_raci.completed',
      entityType: 'document_raci',
      entityId: raciId,
      details: {
        documentId,
        letter: row.letter,
        sectionId: row.sectionId,
        signatureId: updated.signatureId,
      },
      ipAddress: request.ip ?? null,
    })

    // Evaluate the stage transition. If the gating cohort is complete AND
    // the state machine permits the move, flip Document.status here. The
    // canTransitionDocument guard preserves the Part 11-aware invariant:
    // we never jump a stage, never move from a terminal state, never
    // bypass the explicit edges in document-status.ts.
    const doc = await app.prisma.document.findUnique({
      where: { id: documentId },
      select: { status: true },
    })
    const allRows = await app.prisma.documentRaci.findMany({
      where: { documentId },
      select: {
        letter: true, signatureRequired: true,
        submittedAt: true, reviewedAt: true, approvedAt: true,
        signatureId: true, rejectedAt: true, removedAt: true,
      },
    })
    const currentStatus = (doc?.status ?? 'not_started') as DocumentStatus
    const evaluation = evaluateStageTransition(currentStatus, allRows as RaciRowForEval[])

    let transitioned = false
    if (
      evaluation.cohortComplete &&
      evaluation.nextStatus !== null &&
      canTransitionDocument(currentStatus, evaluation.nextStatus)
    ) {
      await app.prisma.document.update({
        where: { id: documentId },
        data: { status: evaluation.nextStatus },
      })
      transitioned = true

      await app.audit.append({
        timestamp: new Date().toISOString(),
        actorId: actor.id,
        action: 'document_status.auto_transition',
        entityType: 'document',
        entityId: documentId,
        details: {
          from: currentStatus,
          to: evaluation.nextStatus,
          gatingLetter: evaluation.gatingLetter,
          cohortTotal: evaluation.cohortTotal,
          trigger: 'raci_cohort_complete',
          raciId,
        },
        ipAddress: request.ip ?? null,
      })
    }

    return reply.send({ row: updated, transition: evaluation, transitioned })
  })

  // --- Reject (bounce back a stage) ---------------------------------------
  // Any single C or A rejecting pulls the doc back to the previous stage,
  // per docs/roles-and-permissions.md §3.2 "Rejection at any gate…".
  // This endpoint sets rejected_at + rejectionNote; the status rollback
  // still goes through the existing state machine for now.
  app.post('/:documentId/raci/:raciId/reject', { preHandler: requireAuth() }, async (request, reply) => {
    const { documentId, raciId } = request.params as { documentId: string; raciId: string }
    const parsed = rejectSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })
    }

    const row = await app.prisma.documentRaci.findUnique({ where: { id: raciId } })
    if (!row || row.documentId !== documentId) return reply.code(404).send({ error: 'not_found' })
    if (row.removedAt) return reply.code(409).send({ error: 'row_removed' })
    if (row.rejectedAt) return reply.code(409).send({ error: 'already_rejected' })

    const actor = request.user!
    if (row.userId !== actor.id) {
      return reply.code(403).send({ error: 'only_assignee_can_reject' })
    }

    if (row.letter !== 'C' && row.letter !== 'A') {
      return reply.code(422).send({ error: 'only_reviewer_or_approver_can_reject' })
    }

    const now = new Date()
    const updated = await app.prisma.documentRaci.update({
      where: { id: raciId },
      data: { rejectedAt: now, rejectionNote: parsed.data.note },
    })

    await app.audit.append({
      timestamp: now.toISOString(),
      actorId: actor.id,
      action: 'document_raci.rejected',
      entityType: 'document_raci',
      entityId: raciId,
      details: {
        documentId,
        letter: row.letter,
        sectionId: row.sectionId,
        note: parsed.data.note,
      },
      ipAddress: request.ip ?? null,
    })

    return reply.send(updated)
  })
}
