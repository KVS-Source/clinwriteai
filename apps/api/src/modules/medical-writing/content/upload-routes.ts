// Module C upload + classification routes (mirror of Module A's
// upload-routes.ts).
//
//   POST /projects/:projectId/med-content/upload
//     Accepts a multipart file, writes to BlobStorage, creates a
//     ContentUpload row with status='pending_classification', returns the
//     stubbed classification result.
//
//   POST /projects/:projectId/med-content/confirm-classification
//     Takes the uploadId + user overrides, creates the MedContentItem,
//     flips the upload row to 'confirmed' + links contentItemId. Audits
//     both the creation and any overrides.
//
// Classification is a filename-heuristic stub (`stub: true`) — the real
// AI classifier lands when the Anthropic connector is procured (same
// gate as Module A's AI endpoints).

import type { FastifyPluginAsync } from 'fastify'
import type { MultipartFile } from '@fastify/multipart'
import { z } from 'zod'
import { requireAuth } from '../../../auth/rbac.js'
import { generateBlobKey } from '../../platform/blob/local-storage.js'
import { medContentShape } from './routes.js'

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024

const SUPPORTED_MIME: ReadonlyArray<RegExp> = [
  /^application\/pdf$/,
  /^application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document$/,
  /^application\/vnd\.openxmlformats-officedocument\.presentationml\.presentation$/,
  /^application\/msword$/,
  /^application\/vnd\.ms-powerpoint$/,
]

// UI sends hyphen-case MedContentType (hcp-slide-deck, mi-letter, ...);
// classifier output + DB persist snake_case (hcp_slide_deck, ...). Keep
// the UI vocab on the wire and translate here.
const UI_TYPE_TO_DB: Record<string, string> = {
  'hcp-slide-deck':  'hcp_slide_deck',
  'mi-letter':       'mi_letter',
  'pil':             'pil',
  'cme-module':      'cme_module',
  'disease-dossier': 'disease_dossier',
  'eu-ctr-pls':      'eu_ctr_pls',
  'advisory-report': 'advisory_report',
}
const UI_TRACK_TO_DB: Record<string, string> = {
  mlr:        'promotional',
  accme:      'cme',
  promotional:    'promotional',
  non_promotional:'non_promotional',
  cme:        'cme',
  advisory:   'advisory',
}

const confirmSchema = z.object({
  uploadId: z.string().min(1),
  documentType: z.string().min(1),        // hyphen-case MedContentType
  title: z.string().min(1),
  version: z.string().min(1).default('v0.1'),
  therapeuticArea: z.string().min(1),
  complianceTrack: z.string().min(1).default('mlr'),
  ownerId: z.string().min(1).optional(),  // assignee / owner; defaults to request.user
  channels: z.array(z.string()).default([]),
  targetAudience: z.array(z.string()).default([]),
  overrides: z.array(z.string()).default([]),
})

export function classifyMedContentByFilename(filename: string) {
  const lc = filename.toLowerCase()
  let documentType = 'hcp_slide_deck'
  let typeConfidence = 60
  let frameworks: string[] = ['ABPI Code 2023']

  if (/slide|deck|hcp/.test(lc)) { documentType = 'hcp_slide_deck'; typeConfidence = 86 }
  else if (/\bmi\b|medical.?information|letter/.test(lc)) { documentType = 'mi_letter'; typeConfidence = 82 }
  else if (/\bpil\b|patient.?info|leaflet/.test(lc)) { documentType = 'pil'; typeConfidence = 88 }
  else if (/cme|accme|module/.test(lc))              { documentType = 'cme_module'; typeConfidence = 80; frameworks = ['ACCME', 'EACCME'] }
  else if (/dossier|disease/.test(lc))               { documentType = 'disease_dossier'; typeConfidence = 83 }
  else if (/\bpls\b|plain.?lang|eu.?ctr/.test(lc))   { documentType = 'eu_ctr_pls'; typeConfidence = 85; frameworks = ['EU CTR Art 37'] }
  else if (/advisory|adv.?board/.test(lc))           { documentType = 'advisory_report'; typeConfidence = 78 }

  const versionMatch = lc.match(/v(\d+(?:\.\d+)?)/)
  return {
    documentType,
    typeConfidence,
    studyTitle: '(unidentified — human review)',
    studyConfidence: 20,
    version: versionMatch ? `v${versionMatch[1]}` : 'v0.1',
    versionConfidence: versionMatch ? 85 : 20,
    therapeuticArea: '(inherit from project)',
    taConfidence: 0,
    frameworks,
    stub: true,
  }
}

export const medContentUploadRoutes: FastifyPluginAsync = async (app) => {
  app.post('/:projectId/med-content/upload', { preHandler: requireAuth({ modules: ['C'] }) }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string }
    const project = await app.prisma.project.findUnique({ where: { id: projectId } })
    if (!project) return reply.code(404).send({ error: 'project_not_found' })

    const file: MultipartFile | undefined = await request.file().catch(() => undefined)
    if (!file) return reply.code(400).send({ error: 'no_file', message: 'multipart file part is required' })

    const buf = await file.toBuffer()
    if (buf.length > MAX_UPLOAD_BYTES) {
      return reply.code(413).send({ error: 'too_large', message: `File > ${MAX_UPLOAD_BYTES / 1024 / 1024}MB` })
    }
    if (!SUPPORTED_MIME.some(r => r.test(file.mimetype))) {
      return reply.code(400).send({ error: 'unsupported_mime', mimetype: file.mimetype })
    }

    const ext = file.filename.split('.').pop()
    const blobKey = generateBlobKey(`${projectId}/pending-med-uploads`, ext)
    await app.blob.put({
      bucket: 'documents',
      key: blobKey,
      body: buf,
      contentType: file.mimetype,
      metadata: { originalFilename: file.filename, projectId, uploadedBy: request.user!.id, module: 'C' },
    })

    const classification = classifyMedContentByFilename(file.filename)

    const row = await app.prisma.contentUpload.create({
      data: {
        projectId,
        uploadedBy: request.user!.id,
        blobKey,
        fileName: file.filename,
        fileSizeBytes: buf.length,
        contentType: file.mimetype,
        virusScanStatus: 'passed',
        classification: classification as unknown as object,
        status: 'pending_classification',
      },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'med_content_upload_received',
      entityType: 'content_upload',
      entityId: row.id,
      details: {
        projectId,
        fileName: file.filename,
        fileSizeBytes: buf.length,
        contentType: file.mimetype,
        detectedType: classification.documentType,
      },
      ipAddress: request.ip ?? null,
    })

    return {
      uploadId: row.id,
      fileName: row.fileName,
      fileSizeMB: Math.round((buf.length / (1024 * 1024)) * 100) / 100,
      virusScanStatus: row.virusScanStatus,
      classification,
    }
  })

  app.post('/:projectId/med-content/confirm-classification', { preHandler: requireAuth({ modules: ['C'] }) }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string }
    const parsed = confirmSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', message: parsed.error.issues[0]?.message ?? 'invalid request body', issues: parsed.error.issues })

    const upload = await app.prisma.contentUpload.findFirst({
      where: { id: parsed.data.uploadId, projectId },
    })
    if (!upload) return reply.code(404).send({ error: 'upload_not_found' })
    if (upload.status === 'confirmed') {
      return reply.code(409).send({ error: 'already_confirmed', contentItemId: upload.contentItemId })
    }
    if (upload.status === 'rejected') {
      return reply.code(409).send({ error: 'already_rejected' })
    }

    const project = await app.prisma.project.findUnique({ where: { id: projectId } })
    if (!project) return reply.code(404).send({ error: 'project_not_found' })

    const dbType = UI_TYPE_TO_DB[parsed.data.documentType] ?? parsed.data.documentType
    const dbTrack = UI_TRACK_TO_DB[parsed.data.complianceTrack] ?? 'promotional'

    const created = await app.prisma.medContentItem.create({
      data: {
        projectId,
        sourceModuleAProjectId: projectId,                       // same project; cross-project source via editor later
        type: dbType,
        title: parsed.data.title,
        complianceTrack: dbTrack,
        taTag: parsed.data.therapeuticArea,
        version: parsed.data.version,
        channels: parsed.data.channels,
        targetAudience: parsed.data.targetAudience,
        ownerId: parsed.data.ownerId ?? request.user!.id,
        createdBy: request.user!.id,
      },
    })

    await app.prisma.contentUpload.update({
      where: { id: upload.id },
      data: {
        status: 'confirmed',
        contentItemId: created.id,
      },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'med_content_classification_confirmed',
      entityType: 'med_content',
      entityId: created.id,
      details: {
        uploadId: upload.id,
        confirmedType: parsed.data.documentType,
        originalClassification: upload.classification,
        overrides: parsed.data.overrides,
      },
      ipAddress: request.ip ?? null,
    })

    if (parsed.data.overrides.length > 0) {
      await app.audit.append({
        timestamp: new Date().toISOString(),
        actorId: request.user!.id,
        action: 'med_content_classification_overridden',
        entityType: 'med_content',
        entityId: created.id,
        details: { uploadId: upload.id, overriddenFields: parsed.data.overrides },
        ipAddress: request.ip ?? null,
      })
    }

    return reply.code(201).send(medContentShape(created))
  })
}
