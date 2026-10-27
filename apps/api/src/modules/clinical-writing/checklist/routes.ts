// Checklist routes — Module A (API contract §4).
//
// Workflow:
//   - A ChecklistInstance is materialised at document creation time via
//     DocumentService.create (see ../documents/service.ts). This GET is a
//     pure read for freshly-created documents; the fallback-create below
//     is kept to handle legacy documents that pre-date eager materialisation.
//   - Framework Mandatory items (ICH E3, 21 CFR Part 11, …) require a
//     waiver_reason when waived. Non-mandatory items can be waived freely.
//   - User-added items (isUserAdded = true) have no templateItemId.
//
// Deliverable type normalisation: historically the frontend sent hyphenated
// keys ('csr-full') while the seed stored underscored ('csr_full'), producing
// duplicate ChecklistTemplate rows. All template lookups + writes now go
// through ensureChecklistInstance which normalises to the underscored form.

import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { requireAuth } from '../../../auth/rbac.js'
import {
  computeProjectChecklistSummary,
  ensureChecklistInstance,
} from './service.js'

const waiveSchema = z.object({
  reason: z.string().min(3, 'A waiver reason is required (21 CFR Part 11)'),
})

const addCustomSchema = z.object({
  text: z.string().min(1),
  framework: z.string().default('Custom'),
})

export const checklistRoutes: FastifyPluginAsync = async (app) => {
  app.get('/:documentId/checklist', { preHandler: requireAuth({ modules: ['A'] }) }, async (request, reply) => {
    const { documentId } = request.params as { documentId: string }

    const doc = await app.prisma.document.findUnique({ where: { id: documentId } })
    if (!doc) return reply.code(404).send({ error: 'not_found' })

    // ensureChecklistInstance is idempotent — it short-circuits when the
    // instance already exists (the common case now that create() materialises
    // eagerly). Fallback-creates for pre-existing documents.
    const instance = await ensureChecklistInstance(app.prisma, {
      documentId,
      deliverableType: doc.type,
      actorId: request.user!.id,
    })

    return instance.items
  })

  app.patch('/:documentId/checklist/:itemId/complete', { preHandler: requireAuth({ modules: ['A'] }) }, async (request, reply) => {
    const { documentId, itemId } = request.params as { documentId: string; itemId: string }
    const item = await loadItem(app.prisma, documentId, itemId)
    if (!item) return reply.code(404).send({ error: 'not_found' })
    if (item.status === 'complete' || item.status === 'waived') {
      return reply.code(409).send({ error: 'conflict', message: `Item already ${item.status}` })
    }

    const updated = await app.prisma.checklistInstanceItem.update({
      where: { id: itemId },
      data: {
        status: 'complete',
        completedBy: request.user!.id,
        completedAt: new Date(),
      },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'checklist_item_completed',
      entityType: 'document',
      entityId: documentId,
      details: { itemId, framework: item.framework, text: item.text },
      ipAddress: request.ip ?? null,
    })

    return updated
  })

  app.patch('/:documentId/checklist/:itemId/waive', { preHandler: requireAuth({ modules: ['A'] }) }, async (request, reply) => {
    const { documentId, itemId } = request.params as { documentId: string; itemId: string }
    const parsed = waiveSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const item = await loadItem(app.prisma, documentId, itemId)
    if (!item) return reply.code(404).send({ error: 'not_found' })

    const updated = await app.prisma.checklistInstanceItem.update({
      where: { id: itemId },
      data: {
        status: 'waived',
        waivedBy: request.user!.id,
        waivedAt: new Date(),
        waiverReason: parsed.data.reason,
      },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'checklist_item_waived',
      entityType: 'document',
      entityId: documentId,
      details: {
        itemId,
        framework: item.framework,
        frameworkMandatory: item.frameworkMandatory,
        reason: parsed.data.reason,
      },
      ipAddress: request.ip ?? null,
    })

    return updated
  })

  app.post('/:documentId/checklist', { preHandler: requireAuth({ modules: ['A'] }) }, async (request, reply) => {
    const { documentId } = request.params as { documentId: string }
    const parsed = addCustomSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const instance = await app.prisma.checklistInstance.findUnique({ where: { documentId } })
    if (!instance) {
      return reply.code(409).send({ error: 'conflict', message: 'Fetch /checklist first to materialise the instance' })
    }

    const maxSort = await app.prisma.checklistInstanceItem.aggregate({
      where: { instanceId: instance.id },
      _max: { sortOrder: true },
    })

    const created = await app.prisma.checklistInstanceItem.create({
      data: {
        instanceId: instance.id,
        text: parsed.data.text,
        framework: parsed.data.framework,
        frameworkMandatory: false,
        isUserAdded: true,
        sortOrder: (maxSort._max.sortOrder ?? 0) + 10,
      },
    })

    return reply.code(201).send(created)
  })
}

// Project-scoped checklist route — one endpoint, mounted under /projects
// so the home page can read the rollup without triggering any writes.
export const projectChecklistRoutes: FastifyPluginAsync = async (app) => {
  app.get('/:projectId/checklist-summary', { preHandler: requireAuth({ modules: ['A'] }) }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string }

    const project = await app.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true },
    })
    if (!project) return reply.code(404).send({ error: 'project_not_found' })

    return computeProjectChecklistSummary(app.prisma, projectId)
  })
}

// Admin-only template management — approve/lock a draft, or create a new
// draft version to customise. Admin UI (phase 4) will drive this; the
// endpoints exist now so phase 2 gates can rely on a locked template.
export const checklistTemplateAdminRoutes: FastifyPluginAsync = async (app) => {
  // Approve + lock a template. Admin only. Transitions a draft project
  // override into the "locked, cloneable at document create" state.
  // Platform baselines are already locked by the seed; this endpoint
  // targets project-level overrides.
  app.post(
    '/:templateId/approve',
    { preHandler: requireAuth({ roles: ['admin'], modules: ['A'] }) },
    async (request, reply) => {
      const { templateId } = request.params as { templateId: string }
      const template = await app.prisma.checklistTemplate.findUnique({
        where: { id: templateId },
      })
      if (!template) return reply.code(404).send({ error: 'not_found' })
      if (template.templateStatus === 'locked') {
        return reply.code(409).send({ error: 'already_locked', message: 'This template is already locked.' })
      }

      const updated = await app.prisma.checklistTemplate.update({
        where: { id: templateId },
        data: {
          templateStatus: 'locked',
          approvedBy: request.user!.id,
          approvedAt: new Date(),
        },
      })

      await app.audit.append({
        timestamp: new Date().toISOString(),
        actorId: request.user!.id,
        action: 'checklist_template_approved',
        entityType: 'checklist_template',
        entityId: updated.id,
        details: {
          deliverableType: updated.deliverableType,
          projectId: updated.projectId,
          version: updated.version,
        },
        ipAddress: request.ip ?? null,
      })

      return updated
    },
  )
}

async function loadItem(prisma: FastifyInstanceType, documentId: string, itemId: string) {
  return prisma.checklistInstanceItem.findFirst({
    where: {
      id: itemId,
      instance: { documentId },
    },
  })
}

// Narrow Prisma type alias — avoids repeating the full PrismaClient type.
type FastifyInstanceType = import('@prisma/client').PrismaClient
