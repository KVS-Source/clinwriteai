// R-driven checklist actions — reorder + submit-gate check.
//
// Lives in a sibling file to checklist/routes.ts so the two can evolve
// independently. The existing routes.ts handles complete / waive / add
// (any auth user with module A today); this file adds the R-only slice
// per docs/roles-and-permissions.md §11.
//
// Routes (mounted under /documents):
//   PATCH /:documentId/checklist/reorder         — R-only, reorders items
//   GET   /:documentId/checklist/submit-check    — any-auth; returns gate decision
//   POST  /:documentId/checklist/submit-with-reason — R-only, logs the override
//                                                     reason for a 'warn' submit
//
// The gate decision itself is pure — see submit-gate.ts.

import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { requireAuth } from '../../../auth/rbac.js'
import { actorCanEditDocumentRaci } from '../../platform/document-raci/access.js'
import { evaluateSubmitGate, type ChecklistItemForGate } from './submit-gate.js'

const reorderSchema = z.object({
  // Compact body: list of {itemId, sortOrder}. Caller sends every item
  // whose sortOrder is changing; omitted items keep their current value.
  // Zero-length is a no-op (returns 200 immediately).
  items: z.array(z.object({
    itemId: z.string().min(1),
    sortOrder: z.number().int(),
  })).max(500),
})

const submitWithReasonSchema = z.object({
  reason: z.string().min(3, 'A reason is required when submitting with pending optional items'),
})

export const checklistRActionRoutes: FastifyPluginAsync = async (app) => {
  // ---------------------------------------------------------------------
  // PATCH /:documentId/checklist/reorder — R-only.
  //
  // Writes sortOrder for the submitted item ids. Each item is verified
  // to belong to this document's instance to avoid cross-doc tampering.
  // Returns the updated items (so the client can reconcile).
  // ---------------------------------------------------------------------
  app.patch('/:documentId/checklist/reorder', { preHandler: requireAuth({ modules: ['A'] }) }, async (request, reply) => {
    const { documentId } = request.params as { documentId: string }
    const parsed = reorderSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })
    }

    const actor = request.user!
    if (!(await actorCanEditDocumentRaci(app.prisma, actor, documentId))) {
      return reply.code(403).send({
        error: 'checklist_edit_forbidden',
        message: 'Only an R on this document (or an admin) can reorder the checklist.',
      })
    }

    if (parsed.data.items.length === 0) {
      return reply.send({ updated: 0, items: [] })
    }

    const instance = await app.prisma.checklistInstance.findUnique({
      where: { documentId },
      select: { id: true },
    })
    if (!instance) {
      return reply.code(409).send({
        error: 'no_checklist_instance',
        message: 'Fetch GET /:documentId/checklist first to materialise the instance before reordering.',
      })
    }

    // Fetch ids once and verify every submitted id lives inside this instance.
    const ids = parsed.data.items.map(i => i.itemId)
    const existing = await app.prisma.checklistInstanceItem.findMany({
      where: { id: { in: ids }, instanceId: instance.id },
      select: { id: true },
    })
    const owned = new Set(existing.map(e => e.id))
    const foreign = ids.filter(id => !owned.has(id))
    if (foreign.length > 0) {
      return reply.code(400).send({
        error: 'foreign_items',
        message: 'One or more itemIds do not belong to this document',
        foreign,
      })
    }

    // Fire the updates in parallel. These are indexed by primary key so
    // the write cost is small; batching into a single $executeRaw would
    // be a premature optimisation here.
    await Promise.all(parsed.data.items.map(i =>
      app.prisma.checklistInstanceItem.update({
        where: { id: i.itemId },
        data: { sortOrder: i.sortOrder },
      }),
    ))

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: actor.id,
      action: 'checklist_reordered',
      entityType: 'document',
      entityId: documentId,
      details: {
        itemCount: parsed.data.items.length,
        itemIds: ids,
      },
      ipAddress: request.ip ?? null,
    })

    const updated = await app.prisma.checklistInstanceItem.findMany({
      where: { id: { in: ids } },
      select: { id: true, sortOrder: true },
      orderBy: { sortOrder: 'asc' },
    })
    return reply.send({ updated: updated.length, items: updated })
  })

  // ---------------------------------------------------------------------
  // GET /:documentId/checklist/submit-check — any authenticated user.
  //
  // Non-mutating preview of the submit gate. The UI uses this to pre-fill
  // the "Submit for Review" modal with the pending-mandatory / pending-
  // optional lists.
  // ---------------------------------------------------------------------
  app.get('/:documentId/checklist/submit-check', { preHandler: requireAuth({ modules: ['A'] }) }, async (request, reply) => {
    const { documentId } = request.params as { documentId: string }

    const instance = await app.prisma.checklistInstance.findUnique({
      where: { documentId },
      include: {
        items: {
          select: {
            id: true, text: true, framework: true, frameworkMandatory: true,
            status: true, stage: true,
          },
        },
      },
    })
    if (!instance) {
      // No instance → nothing to block on.
      return reply.send({ decision: { kind: 'clean' as const }, totalItems: 0 })
    }

    const decision = evaluateSubmitGate(instance.items as ChecklistItemForGate[])
    return reply.send({ decision, totalItems: instance.items.length })
  })

  // ---------------------------------------------------------------------
  // POST /:documentId/checklist/submit-with-reason — R-only.
  //
  // The R calls this with the override reason BEFORE invoking the actual
  // "Submit for Review" transition. We don't flip Document.status here —
  // that still happens via the existing clinical-writing flow — but we
  // persist the reason as an audit event so there's a Part 11 trail of
  // "the R acknowledged these pending optional items and submitted
  // anyway". If the gate blocks (any mandatory pending), this endpoint
  // refuses with 422.
  // ---------------------------------------------------------------------
  app.post('/:documentId/checklist/submit-with-reason', { preHandler: requireAuth({ modules: ['A'] }) }, async (request, reply) => {
    const { documentId } = request.params as { documentId: string }
    const parsed = submitWithReasonSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })
    }

    const actor = request.user!
    if (!(await actorCanEditDocumentRaci(app.prisma, actor, documentId))) {
      return reply.code(403).send({
        error: 'checklist_edit_forbidden',
        message: 'Only an R on this document (or an admin) can submit for review.',
      })
    }

    const instance = await app.prisma.checklistInstance.findUnique({
      where: { documentId },
      include: {
        items: {
          select: {
            id: true, text: true, framework: true, frameworkMandatory: true,
            status: true, stage: true,
          },
        },
      },
    })
    const items = (instance?.items ?? []) as ChecklistItemForGate[]
    const decision = evaluateSubmitGate(items)

    if (decision.kind === 'block') {
      return reply.code(422).send({
        error: 'mandatory_items_pending',
        message: 'Cannot submit: mandatory checklist items are still pending',
        pendingMandatory: decision.pendingMandatory.map(i => ({
          id: i.id, text: i.text, framework: i.framework,
        })),
      })
    }

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: actor.id,
      action: decision.kind === 'warn'
        ? 'document.submit_with_pending_optional'
        : 'document.submit_clean',
      entityType: 'document',
      entityId: documentId,
      details: {
        reason: parsed.data.reason,
        pendingOptional: decision.kind === 'warn'
          ? decision.pendingOptional.map(i => ({ id: i.id, text: i.text, framework: i.framework }))
          : [],
      },
      ipAddress: request.ip ?? null,
    })

    return reply.send({ decision, acknowledged: true })
  })
}
