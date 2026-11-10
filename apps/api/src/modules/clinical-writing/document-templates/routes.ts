// Document templates — read + admin write + PDF parser.
//
// Reads: any authenticated user (the New Document wizard calls GET /).
// Writes: tenant-admin / super-admin / admin only. All writes gate on
// AI readiness because a template without AI is useless — the drafter
// is what fills in the sections.
//
// Routes (prefix /document-templates):
//   GET  /                  — list every current template (one row per type)
//   GET  /:type             — single template by UI type key ('csr-full', …)
//   POST /                  — create a new template (admin)
//   PATCH /:id              — update sections / label / description / framework (admin)
//   POST /:id/retire        — soft-retire a template (admin)
//   POST /parse-file        — multipart PDF upload → platform DocumentUpload
//                             → enqueue platform.distill_template, writes
//                             the parsed sections onto an existing (or
//                             freshly created) DocumentTemplate row.
//                             Returns 202 Accepted + jobId.

import type { FastifyPluginAsync } from 'fastify'
import type { MultipartFile } from '@fastify/multipart'
import { z } from 'zod'
import { requireAuth } from '../../../auth/rbac.js'
import { generateBlobKey } from '../../platform/blob/local-storage.js'
import { resolveAiEngineSettings } from '../../platform/config/ai-engine-settings.js'

const MAX_TEMPLATE_PDF_BYTES = 50 * 1024 * 1024    // 50 MB

const AI_NOT_CONFIGURED = {
  error:     'ai_not_configured',
  message:   'Set up an AI engine (API key) before editing or parsing templates — a template without AI is useless.',
  setupPath: '/admin',
} as const

// Mirrors the Zod shape the worker's parser produces + what the UI edits.
const sectionSchema = z.object({
  id:      z.string().min(1).max(80).regex(/^[a-zA-Z0-9_.\-§]+$/, 'id must be a slug'),
  number:  z.string().min(1).max(30),
  title:   z.string().min(1).max(300),
  usOnly:  z.boolean().optional(),
})

const createTemplateSchema = z.object({
  type:                     z.string().min(1).max(80),
  label:                    z.string().min(1).max(200),
  description:              z.string().min(1).max(500),
  framework:                z.string().min(1).max(80),
  sections:                 z.array(sectionSchema).max(200).default([]),
  requiredSourceCategories: z.array(z.string().min(1).max(80)).default([]),
})

const updateTemplateSchema = createTemplateSchema.partial().omit({ type: true })

const parseFileQuerySchema = z.object({
  // The template row to receive parsed sections. Optional: when absent,
  // the route creates a bare template for `type` first (admin must then
  // fill in label / description / framework).
  templateId: z.string().optional(),
  // Used only when creating a template on the fly (no templateId).
  type:       z.string().min(1).max(80).optional(),
  label:      z.string().min(1).max(200).optional(),
  description: z.string().min(1).max(500).optional(),
  framework:  z.string().min(1).max(80).optional(),
})

interface TemplateRow {
  id:                       string
  type:                     string
  label:                    string
  description:              string
  framework:                string
  sections:                 unknown
  requiredSourceCategories: string[]
  version:                  number
  isCurrent:                boolean
  supersededBy:             string | null
  retiredAt:                Date | null
  createdBy:                string
  createdAt:                Date
  updatedAt:                Date
}

function toApiShape(row: TemplateRow) {
  return {
    id:                       row.id,
    type:                     row.type,
    label:                    row.label,
    description:              row.description,
    framework:                row.framework,
    sections:                 row.sections,
    requiredSourceCategories: row.requiredSourceCategories,
    version:                  row.version,
    isCurrent:                row.isCurrent,
    retiredAt:                row.retiredAt?.toISOString() ?? null,
    updatedAt:                row.updatedAt.toISOString(),
    createdAt:                row.createdAt.toISOString(),
    createdBy:                row.createdBy,
  }
}

// modules: ['A'] marks these as Clinical Writing writes, which fires the
// auditor-read-only guard before the role check — auditors get a 403
// with error='auditor_read_only' (rather than a generic forbidden) and
// the audit-read-only sweep test is satisfied.
const writeGate = requireAuth({ roles: ['tenant-admin', 'super-admin', 'admin'], modules: ['A'] })

export const documentTemplatesRoutes: FastifyPluginAsync = async (app) => {
  async function assertAiReady(): Promise<boolean> {
    const engine = await resolveAiEngineSettings(app.prisma)
    return app.aiGateway.isConfigured(engine.default)
  }

  app.get('/', { preHandler: requireAuth() }, async () => {
    const rows = await app.prisma.documentTemplate.findMany({
      where: { isCurrent: true, retiredAt: null },
      orderBy: [{ label: 'asc' }],
    })
    return rows.map(r => toApiShape(r as TemplateRow))
  })

  app.get('/:type', { preHandler: requireAuth() }, async (request, reply) => {
    const { type } = request.params as { type: string }
    const row = await app.prisma.documentTemplate.findFirst({
      where: { type, isCurrent: true, retiredAt: null },
    })
    if (!row) return reply.code(404).send({ error: 'not_found' })
    return toApiShape(row as TemplateRow)
  })

  // POST / — create a brand-new template row. Fails 409 if a current
  // template already exists for `type` (admin should PATCH it instead).
  app.post('/', { preHandler: writeGate }, async (request, reply) => {
    if (!(await assertAiReady())) return reply.code(503).send(AI_NOT_CONFIGURED)
    const parsed = createTemplateSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const existing = await app.prisma.documentTemplate.findFirst({
      where: { type: parsed.data.type, isCurrent: true, retiredAt: null },
    })
    if (existing) return reply.code(409).send({ error: 'already_exists', message: `A current template already exists for '${parsed.data.type}' (id ${existing.id}). PATCH it instead.` })

    const row = await app.prisma.documentTemplate.create({
      data: {
        type:                     parsed.data.type,
        label:                    parsed.data.label,
        description:              parsed.data.description,
        framework:                parsed.data.framework,
        sections:                 parsed.data.sections as unknown as object,
        requiredSourceCategories: parsed.data.requiredSourceCategories,
        createdBy:                request.user!.id,
      },
    })
    await app.audit.append({
      timestamp:  new Date().toISOString(),
      actorId:    request.user!.id,
      action:     'document_template.created',
      entityType: 'document_template',
      entityId:   row.id,
      details:    { type: row.type, label: row.label, sectionCount: parsed.data.sections.length },
      ipAddress:  request.ip ?? null,
    })
    return reply.code(201).send(toApiShape(row as TemplateRow))
  })

  // PATCH /:id — in-place edit. The current-template invariant stays
  // intact (no new row); call retire + create to supersede with a new
  // version instead. All fields are optional; only provided keys change.
  app.patch('/:id', { preHandler: writeGate }, async (request, reply) => {
    if (!(await assertAiReady())) return reply.code(503).send(AI_NOT_CONFIGURED)
    const { id } = request.params as { id: string }
    const parsed = updateTemplateSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })
    const existing = await app.prisma.documentTemplate.findUnique({ where: { id } })
    if (!existing) return reply.code(404).send({ error: 'not_found' })
    const row = await app.prisma.documentTemplate.update({
      where: { id },
      data: {
        ...(parsed.data.label                    !== undefined && { label:                    parsed.data.label }),
        ...(parsed.data.description              !== undefined && { description:              parsed.data.description }),
        ...(parsed.data.framework                !== undefined && { framework:                parsed.data.framework }),
        ...(parsed.data.sections                 !== undefined && { sections:                 parsed.data.sections as unknown as object }),
        ...(parsed.data.requiredSourceCategories !== undefined && { requiredSourceCategories: parsed.data.requiredSourceCategories }),
      },
    })
    await app.audit.append({
      timestamp:  new Date().toISOString(),
      actorId:    request.user!.id,
      action:     'document_template.updated',
      entityType: 'document_template',
      entityId:   row.id,
      details:    { type: row.type, changedKeys: Object.keys(parsed.data) },
      ipAddress:  request.ip ?? null,
    })
    return toApiShape(row as TemplateRow)
  })

  // POST /:id/retire — soft retire (isCurrent=false + retiredAt).
  app.post('/:id/retire', { preHandler: writeGate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const existing = await app.prisma.documentTemplate.findUnique({ where: { id } })
    if (!existing) return reply.code(404).send({ error: 'not_found' })
    const row = await app.prisma.documentTemplate.update({
      where: { id },
      data: { isCurrent: false, retiredAt: new Date() },
    })
    await app.audit.append({
      timestamp:  new Date().toISOString(),
      actorId:    request.user!.id,
      action:     'document_template.retired',
      entityType: 'document_template',
      entityId:   row.id,
      details:    { type: row.type },
      ipAddress:  request.ip ?? null,
    })
    return toApiShape(row as TemplateRow)
  })

  // POST /parse-file — one-shot admin upload: multipart PDF + optional
  // query params. Stores the PDF as a platform DocumentUpload
  // (projectId=null, sourceCategory='template'), enqueues
  // platform.distill_template, and writes parsed sections onto either
  // an existing template (?templateId) or a freshly-created bare
  // template (?type=&label=&description=&framework=).
  //
  // Returns 202 Accepted + { jobId, templateId, uploadId }. UI polls
  // the template row for sections to populate.
  app.post('/parse-file', { preHandler: writeGate }, async (request, reply) => {
    if (!(await assertAiReady())) return reply.code(503).send(AI_NOT_CONFIGURED)
    const q = parseFileQuerySchema.safeParse(request.query)
    if (!q.success) return reply.code(400).send({ error: 'validation', issues: q.error.issues })

    const file: MultipartFile | undefined = await request.file().catch(() => undefined)
    if (!file) return reply.code(400).send({ error: 'no_file', message: 'multipart file part is required' })

    const buf = await file.toBuffer()
    if (buf.length > MAX_TEMPLATE_PDF_BYTES) {
      return reply.code(413).send({ error: 'too_large', message: `File > ${MAX_TEMPLATE_PDF_BYTES / 1024 / 1024}MB` })
    }
    if ((file.mimetype ?? '').toLowerCase() !== 'application/pdf') {
      return reply.code(400).send({
        error: 'not_pdf',
        mimetype: file.mimetype,
        message: 'Template parser only accepts application/pdf.',
      })
    }

    // Resolve or create the target template row.
    let template: { id: string; type: string } | null = null
    if (q.data.templateId) {
      const row = await app.prisma.documentTemplate.findUnique({ where: { id: q.data.templateId } })
      if (!row) return reply.code(404).send({ error: 'template_not_found' })
      template = { id: row.id, type: row.type }
    } else {
      if (!q.data.type || !q.data.label || !q.data.description || !q.data.framework) {
        return reply.code(400).send({
          error:   'validation',
          message: 'Pass either ?templateId=... OR all of ?type=&label=&description=&framework= to create a template on the fly.',
        })
      }
      const dup = await app.prisma.documentTemplate.findFirst({
        where: { type: q.data.type, isCurrent: true, retiredAt: null },
      })
      if (dup) return reply.code(409).send({ error: 'already_exists', message: `Template for '${q.data.type}' already exists. Pass ?templateId=${dup.id} to parse into it instead.` })
      const row = await app.prisma.documentTemplate.create({
        data: {
          type:        q.data.type,
          label:       q.data.label,
          description: q.data.description,
          framework:   q.data.framework,
          sections:    [] as unknown as object,
          requiredSourceCategories: [],
          createdBy:   request.user!.id,
        },
      })
      template = { id: row.id, type: row.type }
    }

    // Store PDF in the 'documents' bucket.
    const blobKey = generateBlobKey(`platform/templates/${template.id}`, 'pdf')
    try {
      await app.blob.put({
        bucket: 'documents',
        key:    blobKey,
        body:   buf,
        contentType: file.mimetype,
        metadata: {
          originalFilename: file.filename,
          templateId:       template.id,
          type:             template.type,
          uploadedBy:       request.user!.id,
          kind:             'template',
        },
      })
    } catch (err) {
      app.log.warn({ err, templateId: template.id }, 'template parse: blob put failed')
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
        sourceCategory:  'template',
        status:          'confirmed',
        title:           file.filename,
      },
    })

    const jobId = `template-parse-${template.id}-${upload.id}`
    try {
      await app.queue.enqueue('platform.distill_template', {
        templateId: template.id,
        uploadId:   upload.id,
        actorId:    request.user!.id,
      }, { jobId })
    } catch (err) {
      app.log.warn({ err, templateId: template.id }, 'template parse enqueue failed')
      return reply.code(503).send({ error: 'enqueue_failed', message: 'PDF stored but could not enqueue parser. Try again.' })
    }

    await app.audit.append({
      timestamp:  new Date().toISOString(),
      actorId:    request.user!.id,
      action:     'document_template.parse_enqueued',
      entityType: 'document_template',
      entityId:   template.id,
      details:    {
        type: template.type, uploadId: upload.id, jobId,
        fileName: file.filename, fileSizeBytes: buf.length,
      },
      ipAddress:  request.ip ?? null,
    })

    return reply.code(202).send({
      jobId,
      templateId: template.id,
      uploadId:   upload.id,
      type:       template.type,
      fileName:   file.filename,
      sizeBytes:  buf.length,
    })
  })
}
