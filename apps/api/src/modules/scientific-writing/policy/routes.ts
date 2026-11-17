// /publication-type-policies + /publication-ai-prompts +
// /publication-best-practice-records admin routes — Module B analogue of
// Module A's three policy-admin route plugins.
//
// Reads: any authenticated user. Writes: PM-only (content-admin pattern).
// AI readiness gated on prompt + distill writes.

import type { FastifyPluginAsync } from 'fastify'
import type { MultipartFile } from '@fastify/multipart'
import { z } from 'zod'
import { requireAuth } from '../../../auth/rbac.js'
import { resolveAiEngineSettings } from '../../platform/config/ai-engine-settings.js'
import { generateBlobKey } from '../../platform/blob/local-storage.js'
import { PublicationAiPromptService, PublicationAiPromptServiceError } from './ai-prompt-service.js'
import { PublicationBestPracticeService, PublicationBpServiceError } from './best-practice-service.js'
import { PublicationTypePolicyService, PublicationTypePolicyServiceError } from './type-policy-service.js'

const MAX_BP_PDF_BYTES = 50 * 1024 * 1024    // 50 MB — same ceiling as clinical BP uploads

const readGate  = requireAuth({ modules: ['B'] })
const writeGate = requireAuth({ modules: ['B'], roles: ['pm'] })

const AI_NOT_CONFIGURED = {
  error:     'ai_not_configured',
  message:   'Set up an AI engine (API key) before editing publication prompts — prompts never reach a model until AI is configured.',
  setupPath: '/admin',
} as const

// -------- shared Zod shapes ----------------------------------------------
const sectionRuleSchema = z.object({
  severity: z.enum(['must', 'should', 'nice']),
  text:     z.string().min(1).max(2_000),
})
const sectionRulesSchema = z.record(
  z.string().regex(/^[a-zA-Z0-9_.\-§]+$/),
  z.array(sectionRuleSchema),
)

const principleSchema = z.object({
  scope:    z.string().min(1).max(200),
  severity: z.enum(['must', 'should', 'nice']),
  text:     z.string().min(1).max(2_000),
})
const digestSchema = z.object({
  principles:     z.array(principleSchema).max(200),
  sourcePdfId:    z.string().optional(),
  distilledAt:    z.string().optional(),
  distilledModel: z.string().optional(),
})

const retireSchema = z.object({ reason: z.string().min(1).max(500) })

// -------- shape helpers --------------------------------------------------
function shapeAiPrompt(row: {
  id: string; docType: string; version: number; status: string
  smePrompt: string; sectionRules: unknown
  supersededBy: string | null; effectiveDate: Date | null
  retiredAt: Date | null; retireReason: string | null
  approvedBy: string | null; approvedAt: Date | null
  createdBy: string; updatedBy: string
  createdAt: Date; updatedAt: Date
}) {
  return {
    id:            row.id,
    docType:       row.docType,
    version:       row.version,
    status:        row.status,
    smePrompt:     row.smePrompt,
    sectionRules:  row.sectionRules,
    supersededBy:  row.supersededBy,
    effectiveDate: row.effectiveDate?.toISOString() ?? null,
    retiredAt:     row.retiredAt?.toISOString() ?? null,
    retireReason:  row.retireReason,
    approvedBy:    row.approvedBy,
    approvedAt:    row.approvedAt?.toISOString() ?? null,
    createdBy:     row.createdBy,
    updatedBy:     row.updatedBy,
    createdAt:     row.createdAt.toISOString(),
    updatedAt:     row.updatedAt.toISOString(),
  }
}

function shapeBp(row: {
  id: string; docType: string; version: number; status: string
  digest: unknown
  sourcePdfId: string | null; distilledAt: Date | null; distilledModel: string | null
  supersededBy: string | null; effectiveDate: Date | null
  retiredAt: Date | null; retireReason: string | null
  approvedBy: string | null; approvedAt: Date | null
  createdBy: string; updatedBy: string
  createdAt: Date; updatedAt: Date
}) {
  return {
    id:             row.id,
    docType:        row.docType,
    version:        row.version,
    status:         row.status,
    digest:         row.digest,
    sourcePdfId:    row.sourcePdfId,
    distilledAt:    row.distilledAt?.toISOString() ?? null,
    distilledModel: row.distilledModel,
    supersededBy:   row.supersededBy,
    effectiveDate:  row.effectiveDate?.toISOString() ?? null,
    retiredAt:      row.retiredAt?.toISOString() ?? null,
    retireReason:   row.retireReason,
    approvedBy:     row.approvedBy,
    approvedAt:     row.approvedAt?.toISOString() ?? null,
    createdBy:      row.createdBy,
    updatedBy:      row.updatedBy,
    createdAt:      row.createdAt.toISOString(),
    updatedAt:      row.updatedAt.toISOString(),
  }
}

function shapePolicy(row: {
  id: string; docType: string; version: number; isCurrent: boolean
  templateId: string | null; checklistTemplateId: string | null; guidelineKey: string | null
  smePrompt: string; bestPracticeDigest: unknown; sectionRules: unknown
  effectiveDate: Date; retiredAt: Date | null; retiredBy: string | null
  retireReason: string | null; supersededBy: string | null
  createdBy: string; updatedBy: string
  createdAt: Date; updatedAt: Date
}) {
  return {
    id:                  row.id,
    docType:             row.docType,
    version:             row.version,
    isCurrent:           row.isCurrent,
    templateId:          row.templateId,
    checklistTemplateId: row.checklistTemplateId,
    guidelineKey:        row.guidelineKey,
    smePrompt:           row.smePrompt,
    bestPracticeDigest:  row.bestPracticeDigest,
    sectionRules:        row.sectionRules,
    effectiveDate:       row.effectiveDate.toISOString(),
    retiredAt:           row.retiredAt?.toISOString() ?? null,
    retiredBy:           row.retiredBy,
    retireReason:        row.retireReason,
    supersededBy:        row.supersededBy,
    createdBy:           row.createdBy,
    updatedBy:           row.updatedBy,
    createdAt:           row.createdAt.toISOString(),
    updatedAt:           row.updatedAt.toISOString(),
  }
}

// -------- Publication TypePolicy routes ----------------------------------
export const publicationTypePolicyRoutes: FastifyPluginAsync = async (app) => {
  const svc = new PublicationTypePolicyService(app.prisma)

  const createSchema = z.object({
    docType:             z.string().min(1).max(80),
    smePrompt:           z.string().min(1).max(100_000),
    bestPracticeDigest:  z.unknown().optional(),
    sectionRules:        sectionRulesSchema.optional(),
    templateId:          z.string().nullable().optional(),
    checklistTemplateId: z.string().nullable().optional(),
    guidelineKey:        z.string().nullable().optional(),
  })

  const patchSchema = z.object({
    smePrompt:           z.string().min(1).max(100_000).optional(),
    bestPracticeDigest:  z.unknown().optional(),
    sectionRules:        sectionRulesSchema.optional(),
    templateId:          z.string().nullable().optional(),
    checklistTemplateId: z.string().nullable().optional(),
    guidelineKey:        z.string().nullable().optional(),
  })

  function mapServiceError(err: unknown): { code: number; body: Record<string, unknown> } | null {
    if (!(err instanceof PublicationTypePolicyServiceError)) return null
    switch (err.code) {
      case 'not_found': return { code: 404, body: { error: 'not_found', message: err.message } }
      case 'duplicate': return { code: 409, body: { error: 'duplicate', message: err.message } }
    }
  }

  app.get('/', { preHandler: readGate }, async () => {
    const rows = await svc.listAll()
    return { policies: rows.map(r => shapePolicy(r as Parameters<typeof shapePolicy>[0])) }
  })

  app.get('/:docType', { preHandler: readGate }, async (request, reply) => {
    const { docType } = request.params as { docType: string }
    const row = await svc.getCurrent(docType.replace(/-/g, '_'))
    if (!row) return reply.code(404).send({ error: 'not_found' })
    return shapePolicy(row as Parameters<typeof shapePolicy>[0])
  })

  app.post('/', { preHandler: writeGate }, async (request, reply) => {
    const parsed = createSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })
    try {
      const row = await svc.create(parsed.data, request.user!.id)
      await app.audit.append({
        timestamp:  new Date().toISOString(),
        actorId:    request.user!.id,
        action:     'publication_type_policy.created',
        entityType: 'publication_type_policy',
        entityId:   row.id,
        details:    { docType: row.docType, version: row.version },
        ipAddress:  request.ip ?? null,
      })
      return reply.code(201).send(shapePolicy(row as Parameters<typeof shapePolicy>[0]))
    } catch (err) {
      const mapped = mapServiceError(err)
      if (mapped) return reply.code(mapped.code).send(mapped.body)
      throw err
    }
  })

  app.patch('/:docType', { preHandler: writeGate }, async (request, reply) => {
    const { docType } = request.params as { docType: string }
    const parsed = patchSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })
    try {
      const row = await svc.update(docType, parsed.data, request.user!.id)
      await app.audit.append({
        timestamp:  new Date().toISOString(),
        actorId:    request.user!.id,
        action:     'publication_type_policy.updated',
        entityType: 'publication_type_policy',
        entityId:   row.id,
        details:    { docType: row.docType, version: row.version, changedKeys: Object.keys(parsed.data) },
        ipAddress:  request.ip ?? null,
      })
      return shapePolicy(row as Parameters<typeof shapePolicy>[0])
    } catch (err) {
      const mapped = mapServiceError(err)
      if (mapped) return reply.code(mapped.code).send(mapped.body)
      throw err
    }
  })

  app.post('/:docType/retire', { preHandler: writeGate }, async (request, reply) => {
    const { docType } = request.params as { docType: string }
    const parsed = retireSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })
    try {
      const row = await svc.retire(docType, parsed.data.reason, request.user!.id)
      await app.audit.append({
        timestamp:  new Date().toISOString(),
        actorId:    request.user!.id,
        action:     'publication_type_policy.retired',
        entityType: 'publication_type_policy',
        entityId:   row.id,
        details:    { docType: row.docType, version: row.version, reason: parsed.data.reason },
        ipAddress:  request.ip ?? null,
      })
      return shapePolicy(row as Parameters<typeof shapePolicy>[0])
    } catch (err) {
      const mapped = mapServiceError(err)
      if (mapped) return reply.code(mapped.code).send(mapped.body)
      throw err
    }
  })

  // POST /publication-type-policies/:docType/distill-best-practice-file
  // One-shot admin upload: accepts a multipart PDF, stores it as a
  // platform-scoped DocumentUpload (projectId=null, sourceCategory=
  // 'best_practice'), AND enqueues publications.distill_best_practice
  // in the same request. Mirror of /document-type-policies/.../
  // distill-best-practice-file. Worker writes to a draft
  // PublicationBestPracticeRecord; admin approves via POST
  // /publication-best-practice-records/:id/approve.
  async function assertAiReady(): Promise<boolean> {
    const engine = await resolveAiEngineSettings(app.prisma)
    return app.aiGateway.isConfigured(engine.default)
  }

  app.post('/:docType/distill-best-practice-file', { preHandler: writeGate }, async (request, reply) => {
    if (!(await assertAiReady())) return reply.code(503).send(AI_NOT_CONFIGURED)
    const { docType: rawDocType } = request.params as { docType: string }
    const docType = rawDocType.replace(/-/g, '_')

    const policy = await svc.getCurrent(docType)
    if (!policy) return reply.code(404).send({ error: 'no_current_policy' })

    const file: MultipartFile | undefined = await request.file().catch(() => undefined)
    if (!file) return reply.code(400).send({ error: 'no_file', message: 'multipart file part is required' })

    const buf = await file.toBuffer()
    if (buf.length > MAX_BP_PDF_BYTES) {
      return reply.code(413).send({ error: 'too_large', message: `File > ${MAX_BP_PDF_BYTES / 1024 / 1024}MB` })
    }
    if ((file.mimetype ?? '').toLowerCase() !== 'application/pdf') {
      return reply.code(400).send({ error: 'not_pdf', mimetype: file.mimetype, message: 'Best-Practice uploads must be application/pdf.' })
    }

    const blobKey = generateBlobKey(`platform/publication-best-practices/${policy.id}`, 'pdf')
    try {
      await app.blob.put({
        bucket: 'documents',
        key:    blobKey,
        body:   buf,
        contentType: file.mimetype,
        metadata: {
          originalFilename: file.filename,
          publicationPolicyId: policy.id,
          docType,
          uploadedBy:       request.user!.id,
          kind:             'publication-best-practice',
        },
      })
    } catch (err) {
      app.log.warn({ err, policyId: policy.id }, 'pub bp pdf blob put failed')
      return reply.code(503).send({ error: 'storage_failed', message: 'Could not store the PDF. Try again.' })
    }

    const upload = await app.prisma.documentUpload.create({
      data: {
        projectId:       null,
        uploadedBy:      request.user!.id,
        blobKey,
        fileName:        file.filename,
        fileSizeBytes:   buf.length,
        contentType:     file.mimetype,
        virusScanStatus: 'passed',
        sourceCategory:  'best_practice',
        status:          'confirmed',
        title:           file.filename,
      },
    })

    const jobId = `pub-bp-distill-${docType}-${upload.id}`
    try {
      await app.queue.enqueue('publications.distill_best_practice', {
        docType,
        uploadId: upload.id,
        actorId:  request.user!.id,
      }, { jobId })
    } catch (err) {
      app.log.warn({ err, policyId: policy.id, uploadId: upload.id }, 'pub bp distill enqueue failed')
      return reply.code(503).send({ error: 'enqueue_failed', message: 'PDF stored but could not enqueue distillation. Try again.' })
    }

    await app.audit.append({
      timestamp:  new Date().toISOString(),
      actorId:    request.user!.id,
      action:     'publication_type_policy.bp_distill_enqueued',
      entityType: 'publication_type_policy',
      entityId:   policy.id,
      details:    { docType, version: policy.version, uploadId: upload.id, jobId, fileName: file.filename, fileSizeBytes: buf.length },
      ipAddress:  request.ip ?? null,
    })

    return reply.code(202).send({
      jobId,
      uploadId:  upload.id,
      policyId:  policy.id,
      docType,
      version:   policy.version,
      fileName:  file.filename,
      sizeBytes: buf.length,
    })
  })
}

// -------- Publication AI Prompt routes -----------------------------------
export const publicationAiPromptRoutes: FastifyPluginAsync = async (app) => {
  const svc = new PublicationAiPromptService(app.prisma)

  const createSchema = z.object({
    docType:      z.string().min(1).max(80),
    smePrompt:    z.string().min(1).max(100_000),
    sectionRules: sectionRulesSchema.optional(),
  })
  const patchSchema = z.object({
    smePrompt:    z.string().min(1).max(100_000).optional(),
    sectionRules: sectionRulesSchema.optional(),
  })

  async function assertAiReady(): Promise<boolean> {
    const engine = await resolveAiEngineSettings(app.prisma)
    return app.aiGateway.isConfigured(engine.default)
  }

  function mapServiceError(err: unknown): { code: number; body: Record<string, unknown> } | null {
    if (!(err instanceof PublicationAiPromptServiceError)) return null
    switch (err.code) {
      case 'not_found':       return { code: 404, body: { error: 'not_found',       message: err.message } }
      case 'draft_exists':    return { code: 409, body: { error: 'draft_exists',    message: err.message } }
      case 'not_a_draft':     return { code: 409, body: { error: 'not_a_draft',     message: err.message } }
      case 'already_retired': return { code: 409, body: { error: 'already_retired', message: err.message } }
    }
  }

  app.get('/', { preHandler: readGate }, async () => {
    const rows = await svc.listAllApproved()
    return { prompts: rows.map(r => shapeAiPrompt(r as Parameters<typeof shapeAiPrompt>[0])) }
  })

  app.get('/:docType', { preHandler: readGate }, async (request, reply) => {
    const { docType } = request.params as { docType: string }
    const row = await svc.getApproved(docType.replace(/-/g, '_'))
    if (!row) return reply.code(404).send({ error: 'no_approved_prompt' })
    return shapeAiPrompt(row as Parameters<typeof shapeAiPrompt>[0])
  })

  app.get('/:docType/versions', { preHandler: readGate }, async (request) => {
    const { docType } = request.params as { docType: string }
    const rows = await svc.listVersions(docType.replace(/-/g, '_'))
    return { versions: rows.map(r => shapeAiPrompt(r as Parameters<typeof shapeAiPrompt>[0])) }
  })

  app.post('/', { preHandler: writeGate }, async (request, reply) => {
    if (!(await assertAiReady())) return reply.code(503).send(AI_NOT_CONFIGURED)
    const parsed = createSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })
    try {
      const row = await svc.createDraft(parsed.data, request.user!.id)
      await app.audit.append({
        timestamp:  new Date().toISOString(),
        actorId:    request.user!.id,
        action:     'publication_ai_prompt.draft_created',
        entityType: 'publication_ai_prompt_record',
        entityId:   row.id,
        details:    { docType: row.docType, version: row.version, promptChars: row.smePrompt.length },
        ipAddress:  request.ip ?? null,
      })
      return reply.code(201).send(shapeAiPrompt(row as Parameters<typeof shapeAiPrompt>[0]))
    } catch (err) {
      const mapped = mapServiceError(err)
      if (mapped) return reply.code(mapped.code).send(mapped.body)
      throw err
    }
  })

  app.patch('/:id', { preHandler: writeGate }, async (request, reply) => {
    if (!(await assertAiReady())) return reply.code(503).send(AI_NOT_CONFIGURED)
    const { id } = request.params as { id: string }
    const parsed = patchSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })
    try {
      const row = await svc.updateDraft(id, parsed.data, request.user!.id)
      await app.audit.append({
        timestamp:  new Date().toISOString(),
        actorId:    request.user!.id,
        action:     'publication_ai_prompt.draft_updated',
        entityType: 'publication_ai_prompt_record',
        entityId:   row.id,
        details:    { docType: row.docType, version: row.version, changedKeys: Object.keys(parsed.data) },
        ipAddress:  request.ip ?? null,
      })
      return shapeAiPrompt(row as Parameters<typeof shapeAiPrompt>[0])
    } catch (err) {
      const mapped = mapServiceError(err)
      if (mapped) return reply.code(mapped.code).send(mapped.body)
      throw err
    }
  })

  app.post('/:id/approve', { preHandler: writeGate }, async (request, reply) => {
    if (!(await assertAiReady())) return reply.code(503).send(AI_NOT_CONFIGURED)
    const { id } = request.params as { id: string }
    try {
      const row = await svc.approve(id, request.user!.id)
      await app.audit.append({
        timestamp:  new Date().toISOString(),
        actorId:    request.user!.id,
        action:     'publication_ai_prompt.approved',
        entityType: 'publication_ai_prompt_record',
        entityId:   row.id,
        details:    { docType: row.docType, version: row.version },
        ipAddress:  request.ip ?? null,
      })
      return shapeAiPrompt(row as Parameters<typeof shapeAiPrompt>[0])
    } catch (err) {
      const mapped = mapServiceError(err)
      if (mapped) return reply.code(mapped.code).send(mapped.body)
      throw err
    }
  })

  app.post('/:id/retire', { preHandler: writeGate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const parsed = retireSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })
    try {
      const row = await svc.retire(id, parsed.data.reason, request.user!.id)
      await app.audit.append({
        timestamp:  new Date().toISOString(),
        actorId:    request.user!.id,
        action:     'publication_ai_prompt.retired',
        entityType: 'publication_ai_prompt_record',
        entityId:   row.id,
        details:    { docType: row.docType, version: row.version, reason: parsed.data.reason },
        ipAddress:  request.ip ?? null,
      })
      return shapeAiPrompt(row as Parameters<typeof shapeAiPrompt>[0])
    } catch (err) {
      const mapped = mapServiceError(err)
      if (mapped) return reply.code(mapped.code).send(mapped.body)
      throw err
    }
  })
}

// -------- Publication Best-Practice routes -------------------------------
export const publicationBestPracticeRoutes: FastifyPluginAsync = async (app) => {
  const svc = new PublicationBestPracticeService(app.prisma)

  const patchSchema  = z.object({ digest: digestSchema.optional() })

  function mapServiceError(err: unknown): { code: number; body: Record<string, unknown> } | null {
    if (!(err instanceof PublicationBpServiceError)) return null
    switch (err.code) {
      case 'not_found':       return { code: 404, body: { error: 'not_found',       message: err.message } }
      case 'not_a_draft':     return { code: 409, body: { error: 'not_a_draft',     message: err.message } }
      case 'already_retired': return { code: 409, body: { error: 'already_retired', message: err.message } }
    }
  }

  app.get('/', { preHandler: readGate }, async () => {
    const rows = await svc.listAllApproved()
    return { records: rows.map(r => shapeBp(r as Parameters<typeof shapeBp>[0])) }
  })

  app.get('/:docType', { preHandler: readGate }, async (request, reply) => {
    const { docType } = request.params as { docType: string }
    const row = await svc.getApproved(docType.replace(/-/g, '_'))
    if (!row) return reply.code(404).send({ error: 'no_approved_record' })
    return shapeBp(row as Parameters<typeof shapeBp>[0])
  })

  app.get('/:docType/versions', { preHandler: readGate }, async (request) => {
    const { docType } = request.params as { docType: string }
    const rows = await svc.listVersions(docType.replace(/-/g, '_'))
    return { versions: rows.map(r => shapeBp(r as Parameters<typeof shapeBp>[0])) }
  })

  app.patch('/:id', { preHandler: writeGate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const parsed = patchSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })
    try {
      const row = await svc.updateDraft(id, parsed.data, request.user!.id)
      await app.audit.append({
        timestamp:  new Date().toISOString(),
        actorId:    request.user!.id,
        action:     'publication_best_practice.draft_updated',
        entityType: 'publication_best_practice_record',
        entityId:   row.id,
        details:    { docType: row.docType, version: row.version, principleCount: parsed.data.digest?.principles?.length ?? null },
        ipAddress:  request.ip ?? null,
      })
      return shapeBp(row as Parameters<typeof shapeBp>[0])
    } catch (err) {
      const mapped = mapServiceError(err)
      if (mapped) return reply.code(mapped.code).send(mapped.body)
      throw err
    }
  })

  app.post('/:id/approve', { preHandler: writeGate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    try {
      const row = await svc.approve(id, request.user!.id)
      await app.audit.append({
        timestamp:  new Date().toISOString(),
        actorId:    request.user!.id,
        action:     'publication_best_practice.approved',
        entityType: 'publication_best_practice_record',
        entityId:   row.id,
        details:    { docType: row.docType, version: row.version },
        ipAddress:  request.ip ?? null,
      })
      return shapeBp(row as Parameters<typeof shapeBp>[0])
    } catch (err) {
      const mapped = mapServiceError(err)
      if (mapped) return reply.code(mapped.code).send(mapped.body)
      throw err
    }
  })

  app.post('/:id/retire', { preHandler: writeGate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const parsed = retireSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })
    try {
      const row = await svc.retire(id, parsed.data.reason, request.user!.id)
      await app.audit.append({
        timestamp:  new Date().toISOString(),
        actorId:    request.user!.id,
        action:     'publication_best_practice.retired',
        entityType: 'publication_best_practice_record',
        entityId:   row.id,
        details:    { docType: row.docType, version: row.version, reason: parsed.data.reason },
        ipAddress:  request.ip ?? null,
      })
      return shapeBp(row as Parameters<typeof shapeBp>[0])
    } catch (err) {
      const mapped = mapServiceError(err)
      if (mapped) return reply.code(mapped.code).send(mapped.body)
      throw err
    }
  })
}
