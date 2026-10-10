// Documents routes — Module A core.
//
// Endpoints landed in this batch (API contract §3):
//   GET    /projects/:projectId/documents          — list
//   GET    /documents/:documentId                  — get with sections
//   POST   /projects/:projectId/documents          — create
//   PATCH  /documents/:documentId/sections/:sectionId
//   GET    /documents/:documentId/versions
//   POST   /documents/:documentId/restore
//   POST   /documents/:documentId/submit-for-review
//   POST   /documents/:documentId/transition       — explicit status change
//
// Mounted twice from server.ts: once under /projects and once under /documents
// so a single plugin file owns both URL shapes without rewriting the handlers.
// Not landed yet (future Module A sessions): upload + classify (needs S3),
// ai-suggest / ai-accept (needs Anthropic connector + prompt-cache service),
// signature chain (Part 11 — compliance review).

import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { requireAuth } from '../../../auth/rbac.js'
import { DocumentService } from './service.js'
import {
  canTransitionDocument,
  DOCUMENT_STATUSES,
  InvalidDocumentTransitionError,
  type DocumentStatus,
} from '../document-status.js'

const createSchema = z.object({
  type: z.string().min(1),
  title: z.string().min(1),
  therapeuticArea: z.string().min(1).optional(),
  assigneeId: z.string().min(1),
  templateId: z.string().optional(),
  targetCompletionDate: z.string().datetime().optional(),
})

const sectionUpdateSchema = z.object({
  contentHtml: z.string(),
  sectionNumber: z.string().optional(),
  sectionTitle: z.string().optional(),
  aiDrafted: z.boolean().optional(),
  aiModel: z.string().optional(),
  sourceRef: z.string().optional(),
}).refine(
  v => !v.aiDrafted || !!v.aiModel,
  { message: 'aiModel is required when aiDrafted is true (Part 11 provenance)' },
)

// Shape doc rows for the UI's packages/types `Document` interface.
// Prisma stores version + sections on currentVersion; UI flattens them
// onto the document itself with aliased section field names:
//   Prisma sectionNumber → UI Section.number
//   Prisma sectionTitle  → UI Section.title
//   Prisma ichStatus     → UI Section.status
// List-shape excludes sections (UI's list view only wants metadata); detail
// shape includes them.
function sectionShape(s: { id: string; sectionNumber: string; sectionTitle: string; ichStatus: string; contentHtml?: string | null }) {
  return {
    id: s.id,
    number: s.sectionNumber,
    title: s.sectionTitle,
    status: s.ichStatus,
    // contentHtml is lazy — detail route includes it, list route omits
    // it. UI editor pane reads this directly instead of fetching per-
    // section separately.
    contentHtml: s.contentHtml ?? '',
  }
}

function documentShapeMeta(d: { version?: string } & Record<string, unknown>) {
  // Metadata-only shape for list views. version is already a column on
  // Document? No — version lives on DocumentVersion. For list view, we
  // return 'v0.0' when no current version is set. Detail route overrides.
  return {
    ...d,
    version: d.version ?? 'v0.0',
    sections: [] as Array<ReturnType<typeof sectionShape>>,
  }
}

function documentShapeFull(d: { currentVersion?: { versionNumber: string; sections: Array<Parameters<typeof sectionShape>[0]> } | null } & Record<string, unknown>) {
  const { currentVersion, ...rest } = d
  return {
    ...rest,
    version: currentVersion?.versionNumber ?? 'v0.0',
    sections: (currentVersion?.sections ?? []).map(sectionShape),
  }
}

const restoreSchema = z.object({
  sections: z.array(z.object({
    sectionId: z.string(),
    fromVersionId: z.string(),
  })).min(1),
  reason: z.string().min(1),
})

const transitionSchema = z.object({
  to: z.enum(DOCUMENT_STATUSES),
  reason: z.string().max(500).optional(),
})

export const documentsProjectScopedRoutes: FastifyPluginAsync = async (app) => {
  const svc = new DocumentService(app.prisma)

  // List all documents under a project.
  // Returns metadata-only shape — section bodies are too heavy for a list.
  // UI's Document interface expects `sections: []` + `version: string`;
  // documentShapeMeta fills both with defaults the UI can live with.
  app.get('/:projectId/documents', { preHandler: requireAuth({ modules: ['A'] }) }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string }
    const project = await app.prisma.project.findUnique({ where: { id: projectId }, select: { id: true } })
    if (!project) return reply.code(404).send({ error: 'project_not_found' })

    const rows = await app.prisma.document.findMany({
      where: { projectId, deletedAt: null },
      orderBy: { updatedAt: 'desc' },
      include: { currentVersion: { select: { versionNumber: true } } },
    })
    return rows.map(r => documentShapeMeta({ ...r, version: r.currentVersion?.versionNumber }))
  })

  // Create a new document for a project.
  app.post('/:projectId/documents', { preHandler: requireAuth({ modules: ['A'] }) }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string }
    const parsed = createSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const project = await app.prisma.project.findUnique({ where: { id: projectId } })
    if (!project) return reply.code(404).send({ error: 'project_not_found' })

    const { document, version } = await svc.create({
      projectId,
      type: parsed.data.type,
      title: parsed.data.title,
      // The project's therapeuticArea is copied in and immutable per FR-A-002.
      therapeuticArea: parsed.data.therapeuticArea ?? project.therapeuticArea,
      assigneeId: parsed.data.assigneeId,
      createdBy: request.user!.id,
      templateId: parsed.data.templateId,
      targetCompletionDate: parsed.data.targetCompletionDate ? new Date(parsed.data.targetCompletionDate) : undefined,
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'document_created',
      entityType: 'document',
      entityId: document.id,
      details: { projectId, type: document.type, title: document.title, initialVersion: version.versionNumber },
      ipAddress: request.ip ?? null,
    })

    return reply.code(201).send(documentShapeMeta({ ...document, version: version.versionNumber }))
  })
}

export const documentsRoutes: FastifyPluginAsync = async (app) => {
  const svc = new DocumentService(app.prisma)

  app.get('/:documentId', { preHandler: requireAuth({ modules: ['A'] }) }, async (request, reply) => {
    const { documentId } = request.params as { documentId: string }
    const doc = await svc.getWithSections(documentId)
    if (!doc || doc.deletedAt) return reply.code(404).send({ error: 'not_found' })

    // HIPAA minimum-necessary logging: tag every full-body document read
    // as PHI access. The list route (/projects/:id/documents) is NOT tagged
    // because it returns metadata only — no section content. Audit volume
    // trade-off: a user opening 50 docs/day generates 50 phi_document_accessed
    // events; retention policy (indefinite for audit_events) catches these.
    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'phi_document_accessed',
      entityType: 'document',
      entityId: documentId,
      details: {
        module: 'A',
        documentType: doc.type,
        sectionCount: doc.currentVersion?.sections.length ?? 0,
      },
      ipAddress: request.ip ?? null,
    })

    return documentShapeFull(doc)
  })

  app.patch('/:documentId/sections/:sectionId', { preHandler: requireAuth({ modules: ['A'] }) }, async (request, reply) => {
    const { documentId, sectionId } = request.params as { documentId: string; sectionId: string }
    const parsed = sectionUpdateSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const result = await svc.updateSection({
      documentId,
      sectionId,
      sectionNumber: parsed.data.sectionNumber,
      sectionTitle: parsed.data.sectionTitle,
      contentHtml: parsed.data.contentHtml,
      editorUserId: request.user!.id,
      aiDrafted: parsed.data.aiDrafted,
      aiModel: parsed.data.aiModel,
      sourceRef: parsed.data.sourceRef,
    }).catch((err: Error) => {
      if (err.message.includes('not found')) return 'notfound' as const
      throw err
    })

    if (result === 'notfound') return reply.code(404).send({ error: 'not_found' })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: parsed.data.aiDrafted ? 'ai_draft_accepted' : 'section_edited',
      entityType: 'document',
      entityId: documentId,
      details: {
        sectionId,
        versionCreated: result.created,
        versionNumber: result.version.versionNumber,
      },
      ipAddress: request.ip ?? null,
    })

    return svc.getWithSections(documentId)
  })

  app.get('/:documentId/versions', { preHandler: requireAuth({ modules: ['A'] }) }, async (request, reply) => {
    const { documentId } = request.params as { documentId: string }
    const doc = await app.prisma.document.findUnique({ where: { id: documentId } })
    if (!doc) return reply.code(404).send({ error: 'not_found' })

    return app.prisma.documentVersion.findMany({
      where: { documentId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, versionNumber: true, label: true, contentHash: true,
        isCurrent: true, createdBy: true, createdAt: true, restoreSource: true,
      },
    })
  })

  app.post('/:documentId/restore', { preHandler: requireAuth({ modules: ['A'] }) }, async (request, reply) => {
    const { documentId } = request.params as { documentId: string }
    const parsed = restoreSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const job = await app.prisma.versionRestoreJob.create({
      data: {
        sourceDocumentId: documentId,
        sectionsRestored: parsed.data.sections as unknown as object,
        reason: parsed.data.reason,
        status: 'pending',
        createdBy: request.user!.id,
      },
    })

    // Enqueue to the worker. Keeps the HTTP response fast + lets the
    // worker reason about chain-of-section-copies without racing other
    // writers (one worker concurrency on this queue).
    await app.queue.enqueue('clinical.restore_version', {
      jobId: job.id,
      documentId,
      actorId: request.user!.id,
    }).catch(err => {
      // Queue unavailable (dev — no Redis). Job stays 'pending'; a manual
      // retry via the admin API can poke it later.
      app.log.warn({ err, jobId: job.id }, 'restore_version enqueue failed — job stays pending')
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'version_restore_initiated',
      entityType: 'document',
      entityId: documentId,
      details: {
        jobId: job.id,
        sections: parsed.data.sections,
        reason: parsed.data.reason,
      },
      ipAddress: request.ip ?? null,
    })

    return reply.code(202).send({ jobId: job.id, status: 'pending' })
  })

  app.post('/:documentId/submit-for-review', { preHandler: requireAuth({ modules: ['A'] }) }, async (request, reply) => {
    const { documentId } = request.params as { documentId: string }
    const doc = await app.prisma.document.findUnique({ where: { id: documentId } })
    if (!doc) return reply.code(404).send({ error: 'not_found' })

    const from = doc.status as DocumentStatus
    if (!canTransitionDocument(from, 'in_review')) {
      const err = new InvalidDocumentTransitionError(from, 'in_review')
      return reply.code(409).send({ error: 'invalid_transition', message: err.message })
    }

    const updated = await app.prisma.document.update({
      where: { id: documentId },
      data: { status: 'in_review', submittedForReviewAt: new Date() },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'document_submitted_for_review',
      entityType: 'document',
      entityId: documentId,
      details: { from, to: 'in_review' },
      ipAddress: request.ip ?? null,
    })

    return updated
  })

  // Generic status transition — the submit-for-review above is a convenience
  // shortcut for the most common path, but reviewers / signers need the
  // full state machine (bounces, approvals, etc.).
  app.post('/:documentId/transition', { preHandler: requireAuth({ modules: ['A'] }) }, async (request, reply) => {
    const { documentId } = request.params as { documentId: string }
    const parsed = transitionSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const doc = await app.prisma.document.findUnique({ where: { id: documentId } })
    if (!doc) return reply.code(404).send({ error: 'not_found' })

    const from = doc.status as DocumentStatus
    const to = parsed.data.to
    if (!canTransitionDocument(from, to)) {
      const err = new InvalidDocumentTransitionError(from, to)
      return reply.code(409).send({ error: 'invalid_transition', message: err.message })
    }

    const updated = await app.prisma.document.update({
      where: { id: documentId },
      data: { status: to },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'document_status_changed',
      entityType: 'document',
      entityId: documentId,
      details: { from, to, reason: parsed.data.reason ?? null },
      ipAddress: request.ip ?? null,
    })

    return updated
  })

  // AI Suggest — thin wrapper over AI Gateway. Resolves (projectId,
  // sectionNumber+title) → a prompt and dispatches to the gateway.
  // Returns the raw gateway ChatResult; the UI shows accept/reject.
  // When ANTHROPIC_API_KEY is set, this calls real Anthropic; otherwise
  // deterministic stub (Arc 8.1).
  const aiSuggestSchema = z.object({
    intent: z.enum(['draft_from_source', 'tighten', 'explain', 'custom']),
    customPrompt: z.string().min(1).max(2000).optional(),
    model: z.string().default('claude-opus-4-7'),
  })

  app.post('/:documentId/sections/:sectionId/ai-suggest', { preHandler: requireAuth({ modules: ['A'] }) }, async (request, reply) => {
    const { documentId, sectionId } = request.params as { documentId: string; sectionId: string }
    const parsed = aiSuggestSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    // Load the section so the prompt can carry its current content +
    // the section header. Project id is pulled from the document.
    const doc = await app.prisma.document.findUnique({
      where: { id: documentId },
      include: { currentVersion: { include: { sections: { where: { id: sectionId } } } } },
    })
    if (!doc) return reply.code(404).send({ error: 'not_found' })
    const section = doc.currentVersion?.sections[0]
    if (!section) return reply.code(404).send({ error: 'section_not_found' })

    const sectionHeader = `§${section.sectionNumber} ${section.sectionTitle}`
    const currentContent = section.contentHtml ?? ''

    let prompt: string
    switch (parsed.data.intent) {
      case 'draft_from_source':
        prompt = `You are drafting the "${sectionHeader}" section of a Clinical Study Report. Draft the section body in ICH E3 style using the project's linked source documents (CSR, Protocol, IB). Keep it concise; cite the source document where applicable.`
        break
      case 'tighten':
        prompt = `Rewrite the following section for clarity. Preserve every data point and reference. Section: ${sectionHeader}\n\nCurrent content:\n${currentContent}`
        break
      case 'explain':
        prompt = `Summarise the following CSR section in plain English for a non-statistician reviewer. Section: ${sectionHeader}\n\nContent:\n${currentContent}`
        break
      case 'custom':
        prompt = `Section: ${sectionHeader}\n\nCurrent content:\n${currentContent}\n\nUser request:\n${parsed.data.customPrompt ?? ''}`
        break
    }

    try {
      const result = await app.aiGateway.chat({
        tenantId: request.user!.tenantId,
        projectId: doc.projectId,
        actorId: request.user!.id,
        module: 'A',
        intent: parsed.data.intent,
        model: parsed.data.model,
        prompt,
        maxOutputTokens: 2048,
      })
      return result
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'RateLimitedError') {
        return reply.code(429).send({ error: 'quota_reached', message: err.message })
      }
      throw err
    }
  })
}
