// Medical template PDF distiller endpoint (migration 105, Package C-2).
//
// POST /med-content-templates/:templateId/parse-file — multipart PDF
// upload → DocumentUpload row → enqueue med_content.distill_template.
// The worker (apps/worker/src/jobs/distill-med-template.ts) fills
// formatRules + instructions + guidance per section on the target
// MedContentTemplate.
//
// Admin-only. Writes gate on AI readiness because a parse call without
// AI configured is a no-op.

import type { FastifyPluginAsync } from 'fastify'
import type { MultipartFile } from '@fastify/multipart'
import { requireAuth } from '../../../auth/rbac.js'
import { generateBlobKey } from '../../platform/blob/local-storage.js'
import { resolveAiEngineSettings } from '../../platform/config/ai-engine-settings.js'

const MAX_TEMPLATE_PDF_BYTES = 50 * 1024 * 1024    // 50 MB

const AI_NOT_CONFIGURED = {
  error:     'ai_not_configured',
  message:   'Set up an AI engine (API key) before parsing medical templates — the distiller needs it.',
  setupPath: '/admin',
} as const

export const medContentTemplateParseRoutes: FastifyPluginAsync = async (app) => {
  const writeGate = requireAuth({ roles: ['pm'], modules: ['C'] })

  async function assertAiReady(): Promise<boolean> {
    const engine = await resolveAiEngineSettings(app.prisma)
    return app.aiGateway.isConfigured(engine.default)
  }

  app.post('/:templateId/parse-file', { preHandler: writeGate }, async (request, reply) => {
    if (!(await assertAiReady())) return reply.code(503).send(AI_NOT_CONFIGURED)

    const { templateId } = request.params as { templateId: string }
    const template = await app.prisma.medContentTemplate.findUnique({ where: { id: templateId } })
    if (!template) return reply.code(404).send({ error: 'template_not_found' })

    const file: MultipartFile | undefined = await request.file().catch(() => undefined)
    if (!file) return reply.code(400).send({ error: 'no_file', message: 'multipart file part is required' })

    const buf = await file.toBuffer()
    if (buf.length > MAX_TEMPLATE_PDF_BYTES) {
      return reply.code(413).send({ error: 'too_large', message: `File > ${MAX_TEMPLATE_PDF_BYTES / 1024 / 1024}MB` })
    }
    if ((file.mimetype ?? '').toLowerCase() !== 'application/pdf') {
      return reply.code(400).send({ error: 'not_pdf', mimetype: file.mimetype, message: 'Medical template parser only accepts application/pdf.' })
    }

    const blobKey = generateBlobKey(`med-content/templates/${template.id}`, 'pdf')
    try {
      await app.blob.put({
        bucket: 'documents',
        key:    blobKey,
        body:   buf,
        contentType: file.mimetype,
        metadata: {
          originalFilename:     file.filename,
          medContentTemplateId: template.id,
          docType:              template.docType,
          uploadedBy:           request.user!.id,
          kind:                 'med_content_template',
        },
      })
    } catch (err) {
      app.log.warn({ err, templateId: template.id }, 'med template parse: blob put failed')
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

    const jobId = `med-template-parse-${template.id}-${upload.id}`
    try {
      await app.queue.enqueue('med_content.distill_template', {
        templateId: template.id,
        uploadId:   upload.id,
        actorId:    request.user!.id,
      }, { jobId })
    } catch (err) {
      app.log.warn({ err, templateId: template.id }, 'med template parse enqueue failed')
      return reply.code(503).send({ error: 'enqueue_failed', message: 'PDF stored but could not enqueue parser. Try again.' })
    }

    await app.audit.append({
      timestamp:  new Date().toISOString(),
      actorId:    request.user!.id,
      action:     'med_content_template.parse_enqueued',
      entityType: 'med_content_template',
      entityId:   template.id,
      details:    {
        docType: template.docType, uploadId: upload.id, jobId,
        fileName: file.filename, fileSizeBytes: buf.length,
      },
      ipAddress:  request.ip ?? null,
    })

    return reply.code(202).send({
      jobId,
      templateId: template.id,
      uploadId:   upload.id,
      docType:    template.docType,
      fileName:   file.filename,
      sizeBytes:  buf.length,
    })
  })
}
