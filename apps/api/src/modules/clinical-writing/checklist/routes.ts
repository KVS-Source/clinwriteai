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
import { actorCanEditDocumentRaci } from '../../platform/document-raci/access.js'
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

  // Compliance Summary appendix for the output document (FR-A-030, FR-A-001d,
  // AC-A-029, AC-A-013): the frameworks the document's checklist applies, the
  // rules (checklist items) applied under each with their outcome, the
  // frameworks' references, and every waived Framework Mandatory item with who
  // waived it, when and why. Read-only — never creates a checklist instance.
  app.get('/:documentId/compliance-summary', { preHandler: requireAuth({ modules: ['A'] }) }, async (request, reply) => {
    const { documentId } = request.params as { documentId: string }
    const doc = await app.prisma.document.findUnique({ where: { id: documentId }, select: { id: true } })
    if (!doc) return reply.code(404).send({ error: 'not_found' })

    const instance = await app.prisma.checklistInstance.findUnique({
      where:  { documentId },
      select: { templateVersion: true, items: { orderBy: { sortOrder: 'asc' } } },
    })
    const items = instance?.items ?? []

    const userIds = [...new Set(items.flatMap(i => [i.waivedBy, i.completedBy]).filter((v): v is string => !!v))]
    const users = userIds.length
      ? await app.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })
      : []
    const nameOf = (id: string | null) => (id ? users.find(u => u.id === id)?.name ?? id : null)

    const frameworkNames = [...new Set(items.map(i => i.framework))]
    const registry = frameworkNames.length
      ? await app.prisma.regulatoryFramework.findMany({ where: { name: { in: frameworkNames } } })
      : []

    const frameworks = frameworkNames.map(name => {
      const reg = registry.find(r => r.name === name) ?? null
      const rules = items.filter(i => i.framework === name)
      return {
        name,
        version:       reg?.version ?? null,
        jurisdiction:  reg?.jurisdiction ?? null,
        description:   reg?.description ?? null,
        sourceUrl:     reg?.sourceUrl ?? null,
        inRegistry:    !!reg,
        rules: rules.map(i => ({
          text:      i.text,
          mandatory: i.frameworkMandatory,
          status:    i.status,
        })),
      }
    })

    const waivedMandatory = items
      .filter(i => i.status === 'waived' && i.frameworkMandatory)
      .map(i => ({
        text:      i.text,
        framework: i.framework,
        waivedBy:  nameOf(i.waivedBy),
        waivedAt:  i.waivedAt?.toISOString() ?? null,
        reason:    i.waiverReason ?? null,
      }))

    return {
      documentId,
      checklistTemplateVersion: instance?.templateVersion ?? null,
      generatedAt: new Date().toISOString(),
      frameworks,
      waivedMandatory,
    }
  })

  app.patch('/:documentId/checklist/:itemId/complete', { preHandler: requireAuth({ modules: ['A'] }) }, async (request, reply) => {
    const { documentId, itemId } = request.params as { documentId: string; itemId: string }

    // §11.1: only an R on this doc (or an admin) can tick items.
    if (!(await actorCanEditDocumentRaci(app.prisma, request.user!, documentId))) {
      return reply.code(403).send({
        error: 'checklist_edit_forbidden',
        message: 'Only an R on this document (or an admin) can mark checklist items complete.',
      })
    }

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

    // §11.1: only an R on this doc (or an admin) can waive items.
    if (!(await actorCanEditDocumentRaci(app.prisma, request.user!, documentId))) {
      return reply.code(403).send({
        error: 'checklist_edit_forbidden',
        message: 'Only an R on this document (or an admin) can waive checklist items.',
      })
    }

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

    // §11.1: only an R on this doc (or an admin) can add user items.
    if (!(await actorCanEditDocumentRaci(app.prisma, request.user!, documentId))) {
      return reply.code(403).send({
        error: 'checklist_edit_forbidden',
        message: 'Only an R on this document (or an admin) can add checklist items.',
      })
    }

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

// Admin-only template management — list + detail + approve/lock. Keeps
// the per-document checklist routes above untouched. UI arrives in Phase 4b.
//
// All endpoints require role='admin'. Tenant-vs-platform scope isn't enforced
// here yet (editing endpoints TBD); platform admins see every project, tenant
// admins see their tenant's projects (via the project query filter below).
export const checklistTemplateAdminRoutes: FastifyPluginAsync = async (app) => {
  const adminGate = requireAuth({ roles: ['admin'], modules: ['A'] })

  // GET /checklist-templates — list all templates. Platform admin (tenantId
  // null) sees every row; tenant admin only sees platform baselines +
  // overrides owned by projects in their tenant. Ordered: platform
  // baselines first, then project overrides, then by deliverable type and
  // version (desc so the latest is at the top).
  app.get('/', { preHandler: adminGate }, async (request) => {
    const actor = request.user!
    // Resolve tenant-scoped visibility — platform admins see all projects.
    let allowedProjectIds: Set<string> | null = null
    if (actor.tenantId != null) {
      const projects = await app.prisma.project.findMany({
        where: { tenantId: actor.tenantId },
        select: { id: true },
      })
      allowedProjectIds = new Set(projects.map(p => p.id))
    }

    const rows = await app.prisma.checklistTemplate.findMany({
      where: allowedProjectIds
        ? { OR: [{ projectId: null }, { projectId: { in: Array.from(allowedProjectIds) } }] }
        : {},
      orderBy: [
        { projectId: 'asc' },           // null first (platform baselines)
        { deliverableType: 'asc' },
        { version: 'desc' },
      ],
      include: { _count: { select: { items: true, instances: true } } },
    })

    return rows.map(r => ({
      id: r.id,
      deliverableType: r.deliverableType,
      projectId: r.projectId,
      version: r.version,
      effectiveDate: r.effectiveDate.toISOString(),
      changeReason: r.changeReason,
      isCurrent: r.isCurrent,
      templateStatus: r.templateStatus,                       // 'draft' | 'locked'
      approvedBy: r.approvedBy,
      approvedAt: r.approvedAt ? r.approvedAt.toISOString() : null,
      createdBy: r.createdBy,
      createdAt: r.createdAt.toISOString(),
      itemCount:     r._count.items,
      instanceCount: r._count.instances,
    }))
  })

  // GET /checklist-templates/:id — detail with items ordered by stage, then
  // by sortOrder. Admin only; same tenant visibility rule.
  app.get('/:templateId', { preHandler: adminGate }, async (request, reply) => {
    const { templateId } = request.params as { templateId: string }
    const actor = request.user!

    const template = await app.prisma.checklistTemplate.findUnique({
      where: { id: templateId },
      include: {
        items: { orderBy: [{ stage: 'asc' }, { sortOrder: 'asc' }] },
        _count: { select: { instances: true } },
      },
    })
    if (!template) return reply.code(404).send({ error: 'not_found' })

    // Tenant admins can't peek at other tenants' project overrides.
    if (actor.tenantId != null && template.projectId != null) {
      const project = await app.prisma.project.findUnique({
        where: { id: template.projectId },
        select: { tenantId: true },
      })
      if (!project || project.tenantId !== actor.tenantId) {
        return reply.code(404).send({ error: 'not_found' })
      }
    }

    return {
      id: template.id,
      deliverableType: template.deliverableType,
      projectId: template.projectId,
      version: template.version,
      effectiveDate: template.effectiveDate.toISOString(),
      changeReason: template.changeReason,
      isCurrent: template.isCurrent,
      templateStatus: template.templateStatus,
      approvedBy: template.approvedBy,
      approvedAt: template.approvedAt ? template.approvedAt.toISOString() : null,
      createdBy: template.createdBy,
      createdAt: template.createdAt.toISOString(),
      instanceCount: template._count.instances,
      items: template.items.map(it => ({
        id: it.id,
        text: it.text,
        framework: it.framework,
        frameworkMandatory: it.frameworkMandatory,
        ownerRaci: it.ownerRaci,
        stage: it.stage,
        autoCompleteOn: it.autoCompleteOn,
        sortOrder: it.sortOrder,
      })),
    }
  })

  // POST /checklist-templates/:id/clone-to-project — create a project-
  // scoped draft override by cloning the platform baseline (or any other
  // template) onto a chosen project. The new row is `(projectId, deliverableType,
  // version=1, templateStatus=draft)` with all items copied. Tenant admins
  // can only clone onto projects in their own tenant; platform admins can
  // target any tenant's project.
  //
  // Refuses when:
  //   - project does not exist                                        → 404
  //   - project belongs to a different tenant (for tenant admins)     → 403
  //   - an override already exists for (project, deliverableType)     → 409
  const cloneSchema = z.object({ projectId: z.string().min(1) })
  app.post('/:templateId/clone-to-project', { preHandler: adminGate }, async (request, reply) => {
    const { templateId } = request.params as { templateId: string }
    const parsed = cloneSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const actor = request.user!
    const source = await app.prisma.checklistTemplate.findUnique({
      where: { id: templateId },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
    })
    if (!source) return reply.code(404).send({ error: 'not_found' })

    const project = await app.prisma.project.findUnique({
      where: { id: parsed.data.projectId },
      select: { id: true, tenantId: true, name: true, shortTitle: true },
    })
    if (!project) return reply.code(404).send({ error: 'project_not_found' })

    // Tenant isolation: tenant-scoped admins can't clone onto other tenants.
    if (actor.tenantId != null && project.tenantId !== actor.tenantId) {
      return reply.code(403).send({ error: 'forbidden', message: 'Cannot clone into a project outside your tenant.' })
    }

    // Reject if an override (any version) already exists on this project.
    const existing = await app.prisma.checklistTemplate.findFirst({
      where: { deliverableType: source.deliverableType, projectId: project.id },
      select: { id: true, version: true, templateStatus: true },
    })
    if (existing) {
      return reply.code(409).send({
        error: 'override_exists',
        existingTemplateId: existing.id,
        message: 'This project already has a checklist template for this deliverable type — edit that one instead.',
      })
    }

    const created = await app.prisma.$transaction(async (tx) => {
      const t = await tx.checklistTemplate.create({
        data: {
          deliverableType: source.deliverableType,
          projectId: project.id,
          version: 1,
          effectiveDate: new Date(),
          changeReason: `Project override cloned from ${source.projectId == null ? 'platform baseline' : 'template'} v${source.version} on ${new Date().toISOString().slice(0, 10)}`,
          isCurrent: false,                                   // becomes current on approve
          templateStatus: 'draft',
          createdBy: actor.id,
        },
      })
      if (source.items.length > 0) {
        await tx.checklistTemplateItem.createMany({
          data: source.items.map(it => ({
            templateId: t.id,
            text: it.text,
            framework: it.framework,
            frameworkMandatory: it.frameworkMandatory,
            ownerRaci: it.ownerRaci,
            stage: it.stage,
            autoCompleteOn: it.autoCompleteOn,
            sortOrder: it.sortOrder,
          })),
        })
      }
      return t
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: actor.id,
      action: 'checklist_template_project_override_created',
      entityType: 'checklist_template',
      entityId: created.id,
      details: {
        deliverableType: created.deliverableType,
        projectId: project.id,
        projectName: project.shortTitle ?? project.name,
        clonedFromId: source.id,
        clonedFromProjectId: source.projectId,
        clonedFromVersion: source.version,
        itemCount: source.items.length,
      },
      ipAddress: request.ip ?? null,
    })

    return reply.code(201).send(created)
  })

  // POST /checklist-templates/:id/bump-draft — clone a locked template
  // into a new draft version so an Admin can customise without touching
  // the live row. Fails if the source template is already a draft
  // (409 — finish the existing draft first).
  app.post('/:templateId/bump-draft', { preHandler: adminGate }, async (request, reply) => {
    const { templateId } = request.params as { templateId: string }
    const source = await app.prisma.checklistTemplate.findUnique({
      where: { id: templateId },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
    })
    if (!source) return reply.code(404).send({ error: 'not_found' })
    if (source.templateStatus === 'draft') {
      return reply.code(409).send({ error: 'already_draft', message: 'This template is already a draft.' })
    }
    // Also refuse if a sibling draft exists on the same (deliverableType, projectId)
    const sibling = await app.prisma.checklistTemplate.findFirst({
      where: {
        deliverableType: source.deliverableType,
        projectId: source.projectId,
        templateStatus: 'draft',
      },
    })
    if (sibling) {
      return reply.code(409).send({ error: 'draft_exists', draftId: sibling.id, message: 'An unapproved draft already exists for this type.' })
    }

    // Determine next version — max over the (deliverableType, projectId) set.
    const existing = await app.prisma.checklistTemplate.findMany({
      where: { deliverableType: source.deliverableType, projectId: source.projectId },
      select: { version: true },
    })
    const nextVersion = existing.reduce((m, r) => Math.max(m, r.version), 0) + 1

    const draft = await app.prisma.$transaction(async (tx) => {
      const t = await tx.checklistTemplate.create({
        data: {
          deliverableType: source.deliverableType,
          projectId: source.projectId,
          version: nextVersion,
          effectiveDate: new Date(),
          changeReason: `Draft branched from v${source.version} on ${new Date().toISOString().slice(0, 10)}`,
          isCurrent: false,
          templateStatus: 'draft',
          createdBy: request.user!.id,
        },
      })
      if (source.items.length > 0) {
        await tx.checklistTemplateItem.createMany({
          data: source.items.map(it => ({
            templateId: t.id,
            text: it.text,
            framework: it.framework,
            frameworkMandatory: it.frameworkMandatory,
            ownerRaci: it.ownerRaci,
            stage: it.stage,
            autoCompleteOn: it.autoCompleteOn,
            sortOrder: it.sortOrder,
          })),
        })
      }
      return t
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'checklist_template_draft_created',
      entityType: 'checklist_template',
      entityId: draft.id,
      details: {
        deliverableType: draft.deliverableType,
        projectId: draft.projectId,
        version: draft.version,
        clonedFromId: source.id,
        clonedFromVersion: source.version,
        itemCount: source.items.length,
      },
      ipAddress: request.ip ?? null,
    })

    return reply.code(201).send(draft)
  })

  // POST /checklist-templates/:id/items — add a new item to a draft.
  // Fails if the template is locked (admins must bump a new draft first).
  const addItemSchema = z.object({
    text: z.string().min(1).max(500),
    framework: z.string().min(1).max(100),
    frameworkMandatory: z.boolean().default(false),
    ownerRaci: z.enum(['R', 'A', 'C', 'I']).default('R'),
    stage: z.enum(['study_start_up', 'during_study', 'reporting', 'cross_functional_review', 'crm', 'final_output']),
    autoCompleteOn: z.enum(['submit_for_review', 'crm_complete', 'document_signed']).nullable().optional(),
  })
  app.post('/:templateId/items', { preHandler: adminGate }, async (request, reply) => {
    const { templateId } = request.params as { templateId: string }
    const parsed = addItemSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const template = await app.prisma.checklistTemplate.findUnique({ where: { id: templateId } })
    if (!template) return reply.code(404).send({ error: 'not_found' })
    if (template.templateStatus === 'locked') {
      return reply.code(409).send({ error: 'template_locked', message: 'Locked templates are immutable — bump a new draft first.' })
    }

    const maxSort = await app.prisma.checklistTemplateItem.aggregate({
      where: { templateId },
      _max: { sortOrder: true },
    })
    const sortOrder = (maxSort._max.sortOrder ?? 0) + 10

    const created = await app.prisma.checklistTemplateItem.create({
      data: {
        templateId,
        text: parsed.data.text,
        framework: parsed.data.framework,
        frameworkMandatory: parsed.data.frameworkMandatory,
        ownerRaci: parsed.data.ownerRaci,
        stage: parsed.data.stage,
        autoCompleteOn: parsed.data.autoCompleteOn ?? null,
        sortOrder,
      },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'checklist_template_item_added',
      entityType: 'checklist_template',
      entityId: templateId,
      details: { itemId: created.id, text: created.text, stage: created.stage, ownerRaci: created.ownerRaci },
      ipAddress: request.ip ?? null,
    })

    return reply.code(201).send(created)
  })

  // PATCH /checklist-template-items/:id — edit any editable field on a
  // draft item. Locked templates are rejected.
  const patchItemSchema = z.object({
    text: z.string().min(1).max(500).optional(),
    framework: z.string().min(1).max(100).optional(),
    frameworkMandatory: z.boolean().optional(),
    ownerRaci: z.enum(['R', 'A', 'C', 'I']).optional(),
    stage: z.enum(['study_start_up', 'during_study', 'reporting', 'cross_functional_review', 'crm', 'final_output']).optional(),
    autoCompleteOn: z.enum(['submit_for_review', 'crm_complete', 'document_signed']).nullable().optional(),
  })
  app.patch('/items/:itemId', { preHandler: adminGate }, async (request, reply) => {
    const { itemId } = request.params as { itemId: string }
    const parsed = patchItemSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const item = await app.prisma.checklistTemplateItem.findUnique({
      where: { id: itemId },
      include: { template: true },
    })
    if (!item) return reply.code(404).send({ error: 'not_found' })
    if (item.template.templateStatus === 'locked') {
      return reply.code(409).send({ error: 'template_locked', message: 'Locked templates are immutable — bump a new draft first.' })
    }

    const data: Record<string, unknown> = {}
    if (parsed.data.text !== undefined)                data.text               = parsed.data.text
    if (parsed.data.framework !== undefined)           data.framework          = parsed.data.framework
    if (parsed.data.frameworkMandatory !== undefined)  data.frameworkMandatory = parsed.data.frameworkMandatory
    if (parsed.data.ownerRaci !== undefined)           data.ownerRaci          = parsed.data.ownerRaci
    if (parsed.data.stage !== undefined)               data.stage              = parsed.data.stage
    if (parsed.data.autoCompleteOn !== undefined)      data.autoCompleteOn     = parsed.data.autoCompleteOn

    const updated = await app.prisma.checklistTemplateItem.update({ where: { id: itemId }, data })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'checklist_template_item_updated',
      entityType: 'checklist_template',
      entityId: item.templateId,
      details: { itemId, changedFields: Object.keys(data) },
      ipAddress: request.ip ?? null,
    })

    return updated
  })

  // DELETE /checklist-template-items/:id — remove an item from a draft.
  // Guard rails:
  //   - locked template → 409
  //   - framework-mandatory item → 409 (admins must waive on the instance,
  //     not delete from the template, so Part 11 reviewers can still see
  //     the item existed on prior document copies).
  app.delete('/items/:itemId', { preHandler: adminGate }, async (request, reply) => {
    const { itemId } = request.params as { itemId: string }
    const item = await app.prisma.checklistTemplateItem.findUnique({
      where: { id: itemId },
      include: { template: true },
    })
    if (!item) return reply.code(404).send({ error: 'not_found' })
    if (item.template.templateStatus === 'locked') {
      return reply.code(409).send({ error: 'template_locked', message: 'Locked templates are immutable — bump a new draft first.' })
    }
    if (item.frameworkMandatory) {
      return reply.code(409).send({ error: 'mandatory_item', message: 'Framework-mandatory items can\'t be deleted; waive on the instance instead.' })
    }

    await app.prisma.checklistTemplateItem.delete({ where: { id: itemId } })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'checklist_template_item_deleted',
      entityType: 'checklist_template',
      entityId: item.templateId,
      details: { itemId, text: item.text, stage: item.stage },
      ipAddress: request.ip ?? null,
    })

    return reply.code(204).send()
  })

  // POST /checklist-template-items/:id/move — move an item up or down
  // within its stage group. Swaps sortOrder with the neighbour. Only
  // moves within the same stage (changing stage goes through PATCH).
  const moveSchema = z.object({ direction: z.enum(['up', 'down']) })
  app.post('/items/:itemId/move', { preHandler: adminGate }, async (request, reply) => {
    const { itemId } = request.params as { itemId: string }
    const parsed = moveSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const item = await app.prisma.checklistTemplateItem.findUnique({
      where: { id: itemId },
      include: { template: true },
    })
    if (!item) return reply.code(404).send({ error: 'not_found' })
    if (item.template.templateStatus === 'locked') {
      return reply.code(409).send({ error: 'template_locked', message: 'Locked templates are immutable — bump a new draft first.' })
    }

    // Find the neighbour in the same stage with the next/prev sortOrder.
    const neighbour = await app.prisma.checklistTemplateItem.findFirst({
      where: {
        templateId: item.templateId,
        stage: item.stage,
        id: { not: item.id },
        sortOrder: parsed.data.direction === 'up'
          ? { lt: item.sortOrder }
          : { gt: item.sortOrder },
      },
      orderBy: { sortOrder: parsed.data.direction === 'up' ? 'desc' : 'asc' },
    })
    if (!neighbour) {
      return reply.code(409).send({ error: 'at_boundary', message: `Item is already at the ${parsed.data.direction === 'up' ? 'top' : 'bottom'} of its stage.` })
    }

    // Atomic swap.
    await app.prisma.$transaction([
      app.prisma.checklistTemplateItem.update({ where: { id: item.id },      data: { sortOrder: neighbour.sortOrder } }),
      app.prisma.checklistTemplateItem.update({ where: { id: neighbour.id }, data: { sortOrder: item.sortOrder } }),
    ])

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'checklist_template_item_reordered',
      entityType: 'checklist_template',
      entityId: item.templateId,
      details: { itemId: item.id, direction: parsed.data.direction, swappedWithId: neighbour.id, stage: item.stage },
      ipAddress: request.ip ?? null,
    })

    return { ok: true }
  })

  // POST /checklist-templates/:id/approve — approve + lock a draft. The
  // 2026-10-27 Phase-1 shipped this before any UI existed so the gates
  // could rely on a locked template; the Phase-4b admin UI drives it now.
  // Side-effect on approve: the newly-locked template becomes the current
  // one for its (deliverableType, projectId) scope. Any previous current
  // row is demoted so new documents clone the fresh template.
  app.post('/:templateId/approve', { preHandler: adminGate }, async (request, reply) => {
    const { templateId } = request.params as { templateId: string }
    const template = await app.prisma.checklistTemplate.findUnique({
      where: { id: templateId },
    })
    if (!template) return reply.code(404).send({ error: 'not_found' })
    if (template.templateStatus === 'locked') {
      return reply.code(409).send({ error: 'already_locked', message: 'This template is already locked.' })
    }

    const updated = await app.prisma.$transaction(async (tx) => {
      // Demote any sibling current template on the same (type, projectId)
      // so there's exactly one row with isCurrent=true at the end.
      await tx.checklistTemplate.updateMany({
        where: {
          deliverableType: template.deliverableType,
          projectId: template.projectId,
          isCurrent: true,
          id: { not: templateId },
        },
        data: { isCurrent: false },
      })
      return tx.checklistTemplate.update({
        where: { id: templateId },
        data: {
          templateStatus: 'locked',
          isCurrent: true,
          approvedBy: request.user!.id,
          approvedAt: new Date(),
        },
      })
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

// Narrow Prisma type alias — avoids repeating the full PrismaClient type.
type FastifyInstanceType = import('@prisma/client').PrismaClient
