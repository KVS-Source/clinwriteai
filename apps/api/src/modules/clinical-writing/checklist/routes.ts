// Checklist routes — Module A (API contract §4).
//
// Workflow:
//   - Each document gets a ChecklistInstance derived from the current
//     ChecklistTemplate for its deliverable type when the first items are
//     requested (lazy — the master template library ships via admin tools
//     in a later session).
//   - Framework Mandatory items (ICH E3, 21 CFR Part 11, …) require a
//     waiver_reason when waived. Non-mandatory items can be waived freely.
//   - User-added items (isUserAdded = true) have no templateItemId.

import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { requireAuth } from '../../../auth/rbac.js'

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

    let instance = await app.prisma.checklistInstance.findUnique({
      where: { documentId },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
    })

    if (!instance) {
      // Lazy bootstrap: materialise the instance from the current template.
      // If no template exists for this document type yet, return an empty
      // (user-additions only) instance rather than erroring — this keeps the
      // UI usable before admins have seeded the master templates.
      const template = await app.prisma.checklistTemplate.findFirst({
        where: { deliverableType: doc.type, isCurrent: true },
        include: { items: { orderBy: { sortOrder: 'asc' } } },
      })
      instance = await app.prisma.checklistInstance.create({
        data: {
          documentId,
          templateId: template?.id ?? await ensureEmptyTemplate(app.prisma, doc.type, request.user!.id),
          templateVersion: template?.version ?? 1,
          items: template
            ? {
                create: template.items.map(ti => ({
                  templateItemId: ti.id,
                  text: ti.text,
                  framework: ti.framework,
                  frameworkMandatory: ti.frameworkMandatory,
                  sortOrder: ti.sortOrder,
                })),
              }
            : undefined,
        },
        include: { items: { orderBy: { sortOrder: 'asc' } } },
      })
    }

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

async function loadItem(prisma: FastifyInstanceType, documentId: string, itemId: string) {
  return prisma.checklistInstanceItem.findFirst({
    where: {
      id: itemId,
      instance: { documentId },
    },
  })
}

// Fallback template so a checklist instance can exist even before the master
// template library is seeded. Reused across documents of the same type.
async function ensureEmptyTemplate(prisma: FastifyInstanceType, deliverableType: string, userId: string): Promise<string> {
  const existing = await prisma.checklistTemplate.findFirst({
    where: { deliverableType, isCurrent: true },
  })
  if (existing) return existing.id

  const created = await prisma.checklistTemplate.create({
    data: {
      deliverableType,
      version: 1,
      effectiveDate: new Date(),
      changeReason: 'Auto-created fallback for first document of this type',
      createdBy: userId,
    },
  })
  return created.id
}

// Narrow Prisma type alias — avoids repeating the full PrismaClient type.
type FastifyInstanceType = import('@prisma/client').PrismaClient
