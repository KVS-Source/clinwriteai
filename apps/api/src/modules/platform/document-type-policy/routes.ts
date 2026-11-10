// Admin CRUD routes for DocumentTypePolicy.
//
// Reads: any authenticated user (the New Document wizard + the AI
//        Chat panel's "rules applied" view both need it).
// Writes: super-admin only. Edits to a used version 409; must bump.
//
// All responses include a `shape`-wrapped policy with the digest +
// section rules already JSON-typed so the client doesn't have to
// re-parse.

import type { FastifyPluginAsync } from 'fastify'
import type { MultipartFile } from '@fastify/multipart'
import { z } from 'zod'
import { requireAuth } from '../../../auth/rbac.js'
import { generateBlobKey } from '../blob/local-storage.js'
import { resolveAiEngineSettings } from '../config/ai-engine-settings.js'
import {
  bumpVersionSchema,
  createPolicySchema,
  retireSchema,
  updatePolicySchema,
} from './schema.js'
import {
  DocumentTypePolicyService,
  PolicyServiceError,
  digestOf,
  sectionRulesOf,
} from './service.js'

const MAX_BP_PDF_BYTES = 50 * 1024 * 1024    // 50 MB — same ceiling as source uploads

// Admin writes to policy rows (create / update / bump / BP distill) are
// pointless when the platform has no AI configured — the prompts never
// reach a model. Refuse early with a dedicated 503 so the admin screens
// can surface an inline "Set up AI first" CTA rather than looking like
// a generic server error.
const AI_NOT_CONFIGURED = {
  error:   'ai_not_configured',
  message: 'Set up an AI engine (API key) before editing policies — prompts here never reach a model until AI is configured.',
  setupPath: '/admin',
} as const

// Reads open to any authenticated user — the wizard preview and the
// section-context endpoint both consume policy data for authoring.
// Writes locked to PM: the 2026-11-10 role model separates IT Admin
// (system operator, no content rights) from PM (content admin).
const readGate  = requireAuth({})
const writeGate = requireAuth({ roles: ['pm'] })

interface PolicyRow {
  id:                  string
  docType:             string
  version:             number
  isCurrent:           boolean
  smePrompt:           string
  bestPracticeDigest:  unknown
  sectionRules:        unknown
  templateId:          string | null
  checklistTemplateId: string | null
  ichFramework:        string | null
  effectiveDate:       Date
  supersededBy:        string | null
  retiredAt:           Date | null
  retiredBy:           string | null
  retireReason:        string | null
  createdBy:           string
  updatedBy:           string
  createdAt:           Date
  updatedAt:           Date
}

function shape(row: PolicyRow) {
  return {
    id:                  row.id,
    docType:             row.docType,
    version:             row.version,
    isCurrent:           row.isCurrent,
    smePrompt:           row.smePrompt,
    bestPracticeDigest:  digestOf(row),
    sectionRules:        sectionRulesOf(row),
    templateId:          row.templateId,
    checklistTemplateId: row.checklistTemplateId,
    ichFramework:        row.ichFramework,
    effectiveDate:       row.effectiveDate.toISOString(),
    supersededBy:        row.supersededBy,
    retiredAt:           row.retiredAt?.toISOString() ?? null,
    retiredBy:           row.retiredBy,
    retireReason:        row.retireReason,
    createdBy:           row.createdBy,
    updatedBy:           row.updatedBy,
    createdAt:           row.createdAt.toISOString(),
    updatedAt:           row.updatedAt.toISOString(),
  }
}

function mapServiceError(err: unknown): { code: number; body: Record<string, unknown> } | null {
  if (!(err instanceof PolicyServiceError)) return null
  switch (err.code) {
    case 'already_exists':    return { code: 409, body: { error: 'already_exists',    message: err.message } }
    case 'no_current_policy': return { code: 404, body: { error: 'no_current_policy', message: err.message } }
    case 'version_in_use':    return { code: 409, body: { error: 'version_in_use',    message: err.message } }
  }
}

export const documentTypePolicyRoutes: FastifyPluginAsync = async (app) => {
  const svc = new DocumentTypePolicyService(app.prisma)

  // Checks the default AI engine has credentials before letting an
  // admin write to a policy. Reads are never gated — the wizard preview
  // and admin screens need to render even in a no-AI state so the
  // "Set up AI" banner knows what to recommend.
  async function assertAiReady(): Promise<boolean> {
    const engine = await resolveAiEngineSettings(app.prisma)
    return app.aiGateway.isConfigured(engine.default)
  }

  // GET /document-type-policies — list every current policy
  app.get('/', { preHandler: readGate }, async () => {
    const rows = await svc.listAllCurrent()
    return { policies: rows.map(r => shape(r as PolicyRow)) }
  })

  // GET /document-type-policies/:docType — current policy for a doc type
  app.get('/:docType', { preHandler: readGate }, async (request, reply) => {
    const { docType } = request.params as { docType: string }
    const row = await svc.getCurrent(docType)
    if (!row) return reply.code(404).send({ error: 'not_found', message: `No current policy for '${docType}'` })
    return shape(row as PolicyRow)
  })

  // GET /document-type-policies/:docType/versions — full history
  app.get('/:docType/versions', { preHandler: readGate }, async (request) => {
    const { docType } = request.params as { docType: string }
    const rows = await svc.listVersions(docType)
    return { versions: rows.map(r => shape(r as PolicyRow)) }
  })

  // GET /document-type-policies/:docType/versions/:version — specific pin
  app.get('/:docType/versions/:version', { preHandler: readGate }, async (request, reply) => {
    const { docType, version } = request.params as { docType: string; version: string }
    const v = Number(version)
    if (!Number.isInteger(v) || v < 1) return reply.code(400).send({ error: 'validation', message: 'version must be a positive integer' })
    const row = await svc.getByVersion(docType, v)
    if (!row) return reply.code(404).send({ error: 'not_found' })
    return shape(row as PolicyRow)
  })

  // POST /document-type-policies — create first version
  app.post('/', { preHandler: writeGate }, async (request, reply) => {
    if (!(await assertAiReady())) return reply.code(503).send(AI_NOT_CONFIGURED)
    const parsed = createPolicySchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })
    try {
      const row = await svc.create(parsed.data, request.user!.id)
      await app.audit.append({
        timestamp:  new Date().toISOString(),
        actorId:    request.user!.id,
        action:     'document_type_policy.created',
        entityType: 'document_type_policy',
        entityId:   row.id,
        details:    { docType: row.docType, version: row.version },
        ipAddress:  request.ip ?? null,
      })
      return reply.code(201).send(shape(row as PolicyRow))
    } catch (err) {
      const mapped = mapServiceError(err)
      if (mapped) return reply.code(mapped.code).send(mapped.body)
      throw err
    }
  })

  // PATCH /document-type-policies/:docType — edit current (only if unused)
  app.patch('/:docType', { preHandler: writeGate }, async (request, reply) => {
    if (!(await assertAiReady())) return reply.code(503).send(AI_NOT_CONFIGURED)
    const { docType } = request.params as { docType: string }
    const parsed = updatePolicySchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })
    try {
      const row = await svc.updateCurrent(docType, parsed.data, request.user!.id)
      await app.audit.append({
        timestamp:  new Date().toISOString(),
        actorId:    request.user!.id,
        action:     'document_type_policy.updated',
        entityType: 'document_type_policy',
        entityId:   row.id,
        details:    { docType, version: row.version, changedKeys: Object.keys(parsed.data) },
        ipAddress:  request.ip ?? null,
      })
      return shape(row as PolicyRow)
    } catch (err) {
      const mapped = mapServiceError(err)
      if (mapped) return reply.code(mapped.code).send(mapped.body)
      throw err
    }
  })

  // POST /document-type-policies/:docType/bump — new version
  app.post('/:docType/bump', { preHandler: writeGate }, async (request, reply) => {
    if (!(await assertAiReady())) return reply.code(503).send(AI_NOT_CONFIGURED)
    const { docType } = request.params as { docType: string }
    const parsed = bumpVersionSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })
    try {
      const row = await svc.bumpVersion(docType, parsed.data, request.user!.id)
      await app.audit.append({
        timestamp:  new Date().toISOString(),
        actorId:    request.user!.id,
        action:     'document_type_policy.bumped',
        entityType: 'document_type_policy',
        entityId:   row.id,
        details:    { docType, newVersion: row.version, changeReason: parsed.data.changeReason },
        ipAddress:  request.ip ?? null,
      })
      return reply.code(201).send(shape(row as PolicyRow))
    } catch (err) {
      const mapped = mapServiceError(err)
      if (mapped) return reply.code(mapped.code).send(mapped.body)
      throw err
    }
  })

  // POST /document-type-policies/:docType/distill-best-practice —
  // enqueue the Best-Practice distillation worker for this doc type's
  // current policy. Body: { uploadId: string } — the DocumentUpload id
  // of the BP PDF. Returns 202 Accepted + jobId. Admins poll the audit
  // chain for document_type_policy.bp_distilled / bp_distilled_failed
  // to see the outcome.
  //
  // Preconditions:
  //   - current policy exists for docType (404 otherwise)
  //   - uploadId references an application/pdf DocumentUpload (400 on
  //     missing / wrong type)
  //
  // Job dedup: jobId = bp-distill-<policyId>-<uploadId>; a retry of the
  // same (policy, upload) pair reuses the job slot.
  const distillSchema = z.object({ uploadId: z.string().min(1) })

  app.post('/:docType/distill-best-practice', { preHandler: writeGate }, async (request, reply) => {
    if (!(await assertAiReady())) return reply.code(503).send(AI_NOT_CONFIGURED)
    const { docType } = request.params as { docType: string }
    const parsed = distillSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const policy = await svc.getCurrent(docType)
    if (!policy) return reply.code(404).send({ error: 'no_current_policy' })

    const upload = await app.prisma.documentUpload.findUnique({ where: { id: parsed.data.uploadId } })
    if (!upload) return reply.code(400).send({ error: 'upload_not_found', message: `DocumentUpload ${parsed.data.uploadId} not found` })
    if ((upload.contentType ?? '').toLowerCase() !== 'application/pdf') {
      return reply.code(400).send({ error: 'not_pdf', message: `Best-Practice upload must be application/pdf (got ${upload.contentType ?? 'unknown'})` })
    }

    const jobId = `bp-distill-${policy.id}-${upload.id}`
    try {
      await app.queue.enqueue('platform.distill_best_practice', {
        policyId: policy.id,
        uploadId: upload.id,
        actorId:  request.user!.id,
      }, { jobId })
    } catch (err) {
      app.log.warn({ err, policyId: policy.id, uploadId: upload.id }, 'bp distill enqueue failed')
      return reply.code(503).send({ error: 'enqueue_failed', message: 'Could not enqueue distillation job. Try again.' })
    }

    await app.audit.append({
      timestamp:  new Date().toISOString(),
      actorId:    request.user!.id,
      action:     'document_type_policy.bp_distill_enqueued',
      entityType: 'document_type_policy',
      entityId:   policy.id,
      details:    { docType, version: policy.version, uploadId: upload.id, jobId },
      ipAddress:  request.ip ?? null,
    })

    return reply.code(202).send({ jobId, policyId: policy.id, docType, version: policy.version })
  })

  // POST /document-type-policies/:docType/distill-best-practice-file —
  // one-shot admin upload: accepts a multipart PDF, stores it as a
  // platform-scoped DocumentUpload (projectId=null,
  // sourceCategory='best_practice'), then enqueues the distillation
  // worker in the same request. Lets the Doc Type Policies admin
  // screen replace the "paste an uploadId" box with a native file
  // picker — no separate project-scoped upload flow required.
  //
  // Returns 202 Accepted with the uploadId + jobId so the UI can
  // either poll the policy row or watch the audit chain for the
  // distilled digest. Dedup jobId matches the paste-uploadId route
  // (bp-distill-<policyId>-<uploadId>).
  app.post('/:docType/distill-best-practice-file', { preHandler: writeGate }, async (request, reply) => {
    if (!(await assertAiReady())) return reply.code(503).send(AI_NOT_CONFIGURED)
    const { docType } = request.params as { docType: string }

    const policy = await svc.getCurrent(docType)
    if (!policy) return reply.code(404).send({ error: 'no_current_policy' })

    const file: MultipartFile | undefined = await request.file().catch(() => undefined)
    if (!file) return reply.code(400).send({ error: 'no_file', message: 'multipart file part is required' })

    const buf = await file.toBuffer()
    if (buf.length > MAX_BP_PDF_BYTES) {
      return reply.code(413).send({ error: 'too_large', message: `File > ${MAX_BP_PDF_BYTES / 1024 / 1024}MB` })
    }
    if ((file.mimetype ?? '').toLowerCase() !== 'application/pdf') {
      return reply.code(400).send({
        error:    'not_pdf',
        mimetype: file.mimetype,
        message:  'Best-Practice uploads must be application/pdf.',
      })
    }

    // Blob first — on failure we don't leave a dangling DocumentUpload row.
    const blobKey = generateBlobKey(`platform/best-practices/${policy.id}`, 'pdf')
    try {
      await app.blob.put({
        bucket: 'documents',
        key:    blobKey,
        body:   buf,
        contentType: file.mimetype,
        metadata: {
          originalFilename: file.filename,
          policyId:         policy.id,
          docType,
          uploadedBy:       request.user!.id,
          kind:             'best-practice',
        },
      })
    } catch (err) {
      app.log.warn({ err, policyId: policy.id }, 'bp pdf blob put failed')
      return reply.code(503).send({ error: 'storage_failed', message: 'Could not store the PDF. Try again.' })
    }

    const upload = await app.prisma.documentUpload.create({
      data: {
        projectId:       null,                                      // platform asset — migration 66
        uploadedBy:      request.user!.id,
        blobKey,
        fileName:        file.filename,
        fileSizeBytes:   buf.length,
        contentType:     file.mimetype,
        virusScanStatus: 'passed',                                  // matches the existing source-upload stance
        sourceCategory:  'best_practice',
        status:          'confirmed',
        title:           file.filename,
      },
    })

    const jobId = `bp-distill-${policy.id}-${upload.id}`
    try {
      await app.queue.enqueue('platform.distill_best_practice', {
        policyId: policy.id,
        uploadId: upload.id,
        actorId:  request.user!.id,
      }, { jobId })
    } catch (err) {
      app.log.warn({ err, policyId: policy.id, uploadId: upload.id }, 'bp distill enqueue (from file) failed')
      return reply.code(503).send({ error: 'enqueue_failed', message: 'PDF stored but could not enqueue distillation. Try again.' })
    }

    await app.audit.append({
      timestamp:  new Date().toISOString(),
      actorId:    request.user!.id,
      action:     'document_type_policy.bp_distill_enqueued',
      entityType: 'document_type_policy',
      entityId:   policy.id,
      details:    {
        docType, version: policy.version, uploadId: upload.id, jobId,
        fileName: file.filename, fileSizeBytes: buf.length, viaFileUpload: true,
      },
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

  // POST /document-type-policies/:docType/retire — retire the current
  app.post('/:docType/retire', { preHandler: writeGate }, async (request, reply) => {
    const { docType } = request.params as { docType: string }
    const parsed = retireSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })
    try {
      const row = await svc.retire(docType, parsed.data.reason, request.user!.id)
      await app.audit.append({
        timestamp:  new Date().toISOString(),
        actorId:    request.user!.id,
        action:     'document_type_policy.retired',
        entityType: 'document_type_policy',
        entityId:   row.id,
        details:    { docType, version: row.version, reason: parsed.data.reason },
        ipAddress:  request.ip ?? null,
      })
      return shape(row as PolicyRow)
    } catch (err) {
      const mapped = mapServiceError(err)
      if (mapped) return reply.code(mapped.code).send(mapped.body)
      throw err
    }
  })
}
