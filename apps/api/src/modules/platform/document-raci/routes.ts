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
import { actorCanEditRaciAssignments, actorIsDocumentAuthor, NUDGE_FORBIDDEN, RACI_LOCKED_ROLES } from './access.js'
import { nudgePendingCohort } from './nudge.js'

const nudgeSchema = z.object({
  targetUserIds: z.array(z.string().min(1)).max(50).optional(),
  channels:      z.array(z.enum(['in_app', 'email'])).optional(),
  message:       z.string().max(500).optional(),
})

const completeSchema = z.object({
  signatureId: z.string().min(1).nullable().optional(),
})

const rejectSchema = z.object({
  note: z.string().min(1),
})

const signatureSchema = z.object({
  signatureRequired: z.boolean(),
  signatureMeaning:  z.string().min(1).nullable().optional(),
})

const insertSchema = z.object({
  userId: z.string().min(1),
  letter: z.enum(VALID_LETTERS as readonly ['R', 'A', 'C', 'I', 'Q']),
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
  // While a signature chain is in progress the chain is fixed (who signs, and as what). Changing the
  // RACI underneath it would leave the chain out of step with the RACI, so assigning, removing others
  // and changing signature settings wait until the chain is cancelled or complete. A person can still
  // remove their own assignment.
  const activeChainBlocks = async (documentId: string) =>
    (await app.prisma.signatureChain.findFirst({
      where: { documentId, status: { in: ['initiated', 'in_progress'] } },
      select: { id: true },
    })) !== null
  const CHAIN_ACTIVE = {
    error: 'signature_chain_active',
    message: "A signature chain is in progress for this document, so its RACI can't be changed. Cancel the chain first.",
  }

  app.get('/:documentId/raci', { preHandler: requireAuth() }, async (request, reply) => {
    const { documentId } = request.params as { documentId: string }
    const document = await app.prisma.document.findUnique({ where: { id: documentId }, select: { id: true } })
    if (!document) return reply.code(404).send({ error: 'document_not_found' })

    const rows = await app.prisma.documentRaci.findMany({
      where: { documentId },
      orderBy: [{ letter: 'asc' }, { assignedAt: 'asc' }],
    })
    // Carry each assignee's name: the client's only other source is the admin-only,
    // tenant-scoped /admin/users, so contributors (and admins of another tenant)
    // otherwise see raw user ids.
    const users = await app.prisma.user.findMany({
      where: { id: { in: [...new Set(rows.map(r => r.userId))] } },
      select: { id: true, name: true },
    })
    const nameById = new Map(users.map(u => [u.id, u.name]))
    return rows.map(r => ({ ...r, userName: nameById.get(r.userId) ?? null }))
  })

  // Whether the caller may change this document's RACI — lets the panel render
  // read-only up front instead of failing every click with a 403.
  app.get('/:documentId/raci/can-edit', { preHandler: requireAuth() }, async (request) => {
    const { documentId } = request.params as { documentId: string }
    return { canEdit: await actorCanEditRaciAssignments(app.prisma, request.user!, documentId) }
  })

  app.post('/:documentId/raci', { preHandler: requireAuth() }, async (request, reply) => {
    const { documentId } = request.params as { documentId: string }
    const parsed = insertSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })
    }

    const actor = request.user!
    const isActorTenantAdmin = actor.role === 'tenant-admin' || actor.role === 'admin'

    // §5a: only R-on-this-doc can edit RACI on the doc (never admins / PMs).
    if (!(await actorCanEditRaciAssignments(app.prisma, actor, documentId))) {
      return reply.code(403).send({
        error: 'raci_edit_forbidden',
        message: 'Only an author (R) on this document can assign RACI. Ask the lead writer.',
      })
    }
    if (await activeChainBlocks(documentId)) return reply.code(409).send(CHAIN_ACTIVE)
    const sectionId = parsed.data.sectionId ?? null
    const approvalOrder = parsed.data.approvalOrder ?? null
    // Default signature_required: true for A (per §3.2), false otherwise.
    // Q defaults false but QC-release gates commonly turn it on in the UI.
    const signatureRequired = parsed.data.signatureRequired ?? (parsed.data.letter === 'A')
    // The defaulted A signature needs a meaning too, or the insert fails its own
    // validation — 'Medical approval' matches the RACI panel's default for A.
    const signatureMeaning = parsed.data.signatureMeaning
      ?? (signatureRequired && parsed.data.signatureRequired === undefined ? 'Medical approval' : null)

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
      autoGrantCapability: true,
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
        case 'role_cannot_author':
          return reply.code(422).send({
            error: 'role_cannot_author',
            message: 'An admin cannot be assigned as an author (R) of a document.',
          })
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

    // Assignee lacked the letter's capability: the picker offers every non-admin,
    // so assigning grants it (audited as its own event, like a User Management change).
    if (validation.grant) {
      const grant = validation.grant
      const target = await app.prisma.user.update({
        where: { id: parsed.data.userId },
        data: { capabilities: { push: grant } },
        select: { capabilities: true },
      })
      await app.audit.append({
        timestamp: new Date().toISOString(),
        actorId: actor.id,
        action: 'user.capability_granted',
        entityType: 'user',
        entityId: parsed.data.userId,
        details: { capability: grant, capabilities: target.capabilities, reason: 'raci_assignment', documentId, letter: parsed.data.letter },
        ipAddress: request.ip ?? null,
      })
    }

    // Re-assigning someone who was removed from this letter: the soft-removed row
    // still holds the (document, user, letter, section) unique key, so a plain
    // create would fail. Revive that row as a fresh assignment instead.
    const [removed] = await app.prisma.documentRaci.findMany({
      where: { documentId, userId: parsed.data.userId, letter: parsed.data.letter, sectionId, removedAt: { not: null } },
      select: { id: true },
      take: 1,
    })
    const fields = { approvalOrder, signatureRequired, signatureMeaning, assignedBy: actor.id }
    const created = removed
      ? await app.prisma.documentRaci.update({
          where: { id: removed.id },
          data: {
            ...fields,
            assignedAt: new Date(), removedAt: null,
            submittedAt: null, reviewedAt: null, approvedAt: null, signatureId: null, rejectedAt: null, rejectionNote: null,
          },
        })
      : await app.prisma.documentRaci.create({
          data: { documentId, userId: parsed.data.userId, letter: parsed.data.letter, sectionId, ...fields },
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

    // §5a: only R-on-this-doc can remove RACI rows (never admins / PMs). Exception:
    // a user can always remove their own row (self-opt-out) — otherwise a
    // reviewer couldn't excuse themselves from a doc.
    const isSelfRow = existing.userId === actor.id
    if (!isSelfRow && !(await actorCanEditRaciAssignments(app.prisma, actor, documentId))) {
      return reply.code(403).send({
        error: 'raci_edit_forbidden',
        message: 'Only an author (R) on this document can remove other users\' RACI assignments.',
      })
    }
    if (!isSelfRow && (await activeChainBlocks(documentId))) return reply.code(409).send(CHAIN_ACTIVE)

    // Removing an author. A document must keep someone able to edit it, and since the assignee can
    // edit whether or not they hold an R row, removing the assignee hands the document to the next
    // author; otherwise they would keep editing after being "removed".
    let newAssignee: string | null = null
    let previousAssignee: string | null = null
    if (existing.letter === 'R') {
      const [doc, otherRows] = await Promise.all([
        app.prisma.document.findUnique({ where: { id: documentId }, select: { assigneeId: true } }),
        app.prisma.documentRaci.findMany({
          where: { documentId, letter: 'R', removedAt: null, id: { not: raciId } },
          orderBy: { assignedAt: 'asc' },
          select: { userId: true },
        }),
      ])
      const assigneeId = doc?.assigneeId ?? null
      const ids = [...new Set([existing.userId, ...otherRows.map(r => r.userId), ...(assigneeId ? [assigneeId] : [])])]
      const users = await app.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, role: true } })
      const canAuthor = (id: string) => !RACI_LOCKED_ROLES.has(users.find(u => u.id === id)?.role ?? '')
      const authors = [...new Set(otherRows.map(r => r.userId))].filter(canAuthor)
      const assigneeRemains = !!assigneeId && assigneeId !== existing.userId && canAuthor(assigneeId)
      if (canAuthor(existing.userId) && authors.length === 0 && !assigneeRemains) {
        return reply.code(409).send({
          error: 'last_author',
          message: 'This is the only author on the document, and someone must be able to edit it. Add another author first.',
        })
      }
      if (assigneeId === existing.userId && !authors.includes(existing.userId) && authors[0]) {
        previousAssignee = assigneeId
        newAssignee = authors[0]
        await app.prisma.document.update({ where: { id: documentId }, data: { assigneeId: newAssignee } })
      }
    }

    const removed = await app.prisma.documentRaci.update({
      where: { id: raciId },
      data: { removedAt: new Date() },
    })

    if (newAssignee) {
      await app.audit.append({
        timestamp: new Date().toISOString(),
        actorId: actor.id,
        action: 'document.assignee_changed',
        entityType: 'document',
        entityId: documentId,
        details: { from: previousAssignee, to: newAssignee, reason: 'assignee_removed_from_raci' },
        ipAddress: request.ip ?? null,
      })
    }

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

  // --- Change a row's signature requirement -------------------------------
  // Updated in place (before/after in the audit trail). Remove + re-assign
  // used to do this from the client: a failed re-assign (e.g. the user
  // lacks the letter's capability) left the assignment deleted, and the
  // unique index blocks re-adding a per-section row whose removed copy is
  // still kept. Refused once the row's part is done — the signature
  // terms it was completed under must not change afterwards.
  app.patch('/:documentId/raci/:raciId/signature', { preHandler: requireAuth() }, async (request, reply) => {
    const { documentId, raciId } = request.params as { documentId: string; raciId: string }
    const parsed = signatureSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })
    const { signatureRequired } = parsed.data
    const signatureMeaning = signatureRequired ? (parsed.data.signatureMeaning ?? null) : null
    if (signatureRequired && !signatureMeaning) {
      return reply.code(400).send({ error: 'signature_meaning_required', message: 'signatureMeaning is required when signatureRequired = true' })
    }

    const existing = await app.prisma.documentRaci.findUnique({ where: { id: raciId } })
    if (!existing || existing.documentId !== documentId) return reply.code(404).send({ error: 'not_found' })
    if (existing.removedAt) return reply.code(409).send({ error: 'row_removed', message: 'This assignment was removed.' })
    if (existing.submittedAt || existing.reviewedAt || existing.approvedAt || existing.rejectedAt || existing.signatureId) {
      return reply.code(409).send({ error: 'row_completed', message: 'This person has already completed their part, so the signature requirement can no longer change.' })
    }

    const actor = request.user!
    if (!(await actorCanEditRaciAssignments(app.prisma, actor, documentId))) {
      return reply.code(403).send({
        error: 'raci_edit_forbidden',
        message: 'Only an author (R) on this document can change RACI assignments.',
      })
    }
    if (await activeChainBlocks(documentId)) return reply.code(409).send(CHAIN_ACTIVE)

    const updated = await app.prisma.documentRaci.update({
      where: { id: raciId },
      data:  { signatureRequired, signatureMeaning },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: actor.id,
      action: 'document_raci.signature_changed',
      entityType: 'document_raci',
      entityId: raciId,
      details: {
        documentId,
        userId: existing.userId,
        letter: existing.letter,
        sectionId: existing.sectionId,
        before: { signatureRequired: existing.signatureRequired, signatureMeaning: existing.signatureMeaning },
        after:  { signatureRequired, signatureMeaning },
      },
      ipAddress: request.ip ?? null,
    })

    return updated
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

    // An author's part is submitted through submit-for-review, which applies
    // the mandatory-checklist gate and moves the document to review once every
    // R has submitted. One path, so neither can be skipped.
    if (row.letter === 'R') {
      return reply.code(409).send({
        error:   'use_submit_for_review',
        message: 'Authors (R) submit their part with Submit for review.',
      })
    }

    // Already-done check — the per-letter timestamp fields are the source
    // of truth. C and Q share reviewedAt (the row's letter column
    // distinguishes them in the audit trail).
    const alreadyDone =
      (row.letter === 'R' && row.submittedAt !== null) ||
      (row.letter === 'C' && row.reviewedAt !== null) ||
      (row.letter === 'Q' && row.reviewedAt !== null) ||
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
    if (row.letter === 'Q') data.reviewedAt = now  // shares reviewedAt with C; letter column disambiguates
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

    if (row.letter !== 'C' && row.letter !== 'A' && row.letter !== 'Q') {
      return reply.code(422).send({ error: 'only_reviewer_or_approver_or_qc_can_reject' })
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

  // ---------------------------------------------------------------------
  // POST /:documentId/nudge — notify pending users in the gating cohort.
  //
  // Authors only: the caller must be an author (R) on the document — an
  // active R row, or the assignee on a document with no R rows yet (see
  // actorIsDocumentAuthor). C, Q, A, I, auditors, admins and PMs without R
  // get 403. The nudge function then decides who can be nudged — users who
  // aren't in the current gate come back as not_in_cohort / already_done.
  //
  // 24h throttle per (documentId, actorId, targetUserId). Returns a
  // per-target decision + the current gating letters so the UI can
  // render "3 nudged, 1 throttled, 1 not in cohort".
  // ---------------------------------------------------------------------
  app.post('/:documentId/nudge', { preHandler: requireAuth({ modules: ['A'] }) }, async (request, reply) => {
    const { documentId } = request.params as { documentId: string }
    const parsed = nudgeSchema.safeParse(request.body ?? {})
    if (!parsed.success) {
      return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })
    }

    const actor = request.user!
    if (!(await actorIsDocumentAuthor(app.prisma, actor, documentId))) return reply.code(403).send(NUDGE_FORBIDDEN)
    const result = await nudgePendingCohort(app.prisma, {
      documentId,
      actor,
      targetUserIds: parsed.data.targetUserIds,
      channels: parsed.data.channels,
      message: parsed.data.message,
    })

    // One audit event per actual nudge — throttled / not-in-cohort are
    // not auditable (no state change).
    const nudged = result.decisions.filter(d => d.status === 'nudged')
    for (const d of nudged) {
      await app.audit.append({
        timestamp: new Date().toISOString(),
        actorId: actor.id,
        action: 'document_raci.nudged',
        entityType: 'document',
        entityId: documentId,
        details: {
          targetUserId: d.targetUserId,
          gatingLetters: result.gatingLetters,
          messagePresent: !!parsed.data.message,
        },
        ipAddress: request.ip ?? null,
      })
    }

    return reply.send(result)
  })
}
