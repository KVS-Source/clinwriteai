// Document upload + classification routes — Module A (API contract §3).
//
//   POST /projects/:projectId/documents/upload
//     Accepts a multipart file, writes it to BlobStorage, creates a
//     DocumentUpload row with status='pending_classification', returns
//     the stubbed classification result.
//
//   POST /projects/:projectId/documents/confirm-classification
//     Takes the uploadId + user overrides, creates the real Document via
//     DocumentService, marks the upload row 'confirmed' and links documentId.
//     Audits both the creation and any overrides.
//
// Classification is a stub — filename heuristic for documentType +
// defaults for other fields. Real AI classification lands when the
// Anthropic connector arrives (same procurement gate as other AI code).

import type { FastifyPluginAsync } from 'fastify'
import type { MultipartFile } from '@fastify/multipart'
import { z } from 'zod'
import { requireAuth } from '../../../auth/rbac.js'
import { findActiveTaLabel, invalidTaBody, sameTa } from '../../platform/taxonomy/validate.js'
import { templateSections } from './templates.js'
import { generateBlobKey } from '../../../modules/platform/blob/local-storage.js'
import { DocumentService } from './service.js'
import { isSupportedSourceFile, SUPPORTED_SOURCE_LABEL } from '../../platform/uploads/source-files.js'
import { SOURCE_CATEGORIES, suggestSourceCategory } from './source-categories.js'

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024   // 50 MB per API contract

const confirmSchema = z.object({
  uploadId: z.string().min(1),
  documentType: z.string().min(1),
  title: z.string().min(1),
  version: z.string().min(1),
  therapeuticArea: z.string().min(1),
  assigneeId: z.string().min(1),
  overrides: z.array(z.string()).default([]),
})

const saveSchema = z.object({
  title: z.string().trim().min(1).max(300),
  category: z.enum(SOURCE_CATEGORIES),
  origin: z.string().trim().max(200).optional(),
  version: z.string().trim().max(50).optional(),
  overrides: z.array(z.string()).default([]),
})

// Heuristic-based classification stub. Returns a reasonable guess based on
// the filename until the real AI classifier lands.
// Exported for unit-test coverage; routes still call it via the local name.
export function classifyByFilename(filename: string) {
  const lc = filename.toLowerCase()
  let documentType = 'protocol'
  let typeConfidence = 60
  if (/csr|clinical.?study.?report/.test(lc)) { documentType = 'csr_full'; typeConfidence = 85 }
  else if (/protocol/.test(lc)) { documentType = 'protocol'; typeConfidence = 90 }
  else if (/\bib\b|investigator.?brochure/.test(lc)) { documentType = 'ib'; typeConfidence = 88 }
  else if (/\bicf\b|informed.?consent/.test(lc)) { documentType = 'icf'; typeConfidence = 85 }
  else if (/dsur/.test(lc)) { documentType = 'dsur'; typeConfidence = 92 }

  const versionMatch = lc.match(/v(\d+(?:\.\d+)?)/)
  const source = suggestSourceCategory(filename)
  return {
    // Source category is what the upload flow uses; documentType is kept for the
    // legacy confirm-classification shortcut (create a document straight from a file).
    sourceCategory: source.category,
    sourceCategoryConfidence: source.confidence,
    documentType,
    typeConfidence,
    studyTitle: '(unidentified — human review)',
    studyConfidence: 20,
    version: versionMatch ? `v${versionMatch[1]}` : 'v0.1',
    versionConfidence: versionMatch ? 85 : 20,
    therapeuticArea: '(inherit from project)',
    taConfidence: 0,
    frameworks: ['ICH E6(R3)'],
    stub: true,                  // flagged so UI can show "AI classifier not yet live"
  }
}

export const documentsUploadRoutes: FastifyPluginAsync = async (app) => {
  const svc = new DocumentService(app.prisma)

  app.post('/:projectId/documents/upload', { preHandler: requireAuth({ modules: ['A'] }) }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string }
    const project = await app.prisma.project.findUnique({ where: { id: projectId } })
    if (!project) return reply.code(404).send({ error: 'project_not_found' })

    const file: MultipartFile | undefined = await request.file().catch(() => undefined)
    if (!file) return reply.code(400).send({ error: 'no_file', message: 'multipart file part is required' })

    const buf = await file.toBuffer()
    if (buf.length > MAX_UPLOAD_BYTES) {
      return reply.code(413).send({ error: 'too_large', message: `File > ${MAX_UPLOAD_BYTES / 1024 / 1024}MB` })
    }
    if (!isSupportedSourceFile(file.filename, file.mimetype)) {
      return reply.code(400).send({
        error: 'unsupported_mime',
        mimetype: file.mimetype,
        message: `Unsupported file type. Upload a ${SUPPORTED_SOURCE_LABEL}.`,
      })
    }

    // Store the bytes in BlobStorage first — if that fails, we don't
    // leave a DocumentUpload row referencing a non-existent blob.
    const ext = file.filename.split('.').pop()
    const blobKey = generateBlobKey(`${projectId}/pending-uploads`, ext)
    await app.blob.put({
      bucket: 'documents',
      key: blobKey,
      body: buf,
      contentType: file.mimetype,
      metadata: { originalFilename: file.filename, projectId, uploadedBy: request.user!.id },
    })

    const classification = classifyByFilename(file.filename)

    const row = await app.prisma.documentUpload.create({
      data: {
        projectId,
        uploadedBy: request.user!.id,
        blobKey,
        fileName: file.filename,
        fileSizeBytes: buf.length,
        contentType: file.mimetype,
        virusScanStatus: 'passed',          // real scan integration ships w/ ClamAV or AWS GuardDuty later
        classification: classification as unknown as object,
        status: 'pending_classification',
      },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'document_upload_received',
      entityType: 'document_upload',
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

  // Save an uploaded file to the project's source-document library. No Document is
  // created: a source is evidence, linked to documents later (document_sources).
  app.post('/:projectId/source-documents/:uploadId/save', { preHandler: requireAuth({ modules: ['A'] }) }, async (request, reply) => {
    const { projectId, uploadId } = request.params as { projectId: string; uploadId: string }
    const parsed = saveSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const upload = await app.prisma.documentUpload.findFirst({ where: { id: uploadId, projectId } })
    if (!upload) return reply.code(404).send({ error: 'upload_not_found' })
    if (upload.status === 'rejected') return reply.code(409).send({ error: 'already_rejected' })

    const saved = await app.prisma.documentUpload.update({
      where: { id: upload.id },
      data: {
        status: 'confirmed',
        title: parsed.data.title,
        sourceCategory: parsed.data.category,
        origin: parsed.data.origin || null,
        version: parsed.data.version || null,
      },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'source_document_saved',
      entityType: 'document_upload',
      entityId: saved.id,
      details: {
        projectId,
        fileName: saved.fileName,
        category: parsed.data.category,
        origin: parsed.data.origin ?? null,
        originalClassification: upload.classification,
        overrides: parsed.data.overrides,
      },
      ipAddress: request.ip ?? null,
    })

    return reply.code(200).send({ id: saved.id, title: saved.title, category: saved.sourceCategory, origin: saved.origin, version: saved.version })
  })

  app.post('/:projectId/documents/confirm-classification', { preHandler: requireAuth({ modules: ['A'] }) }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string }
    const parsed = confirmSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const upload = await app.prisma.documentUpload.findFirst({
      where: { id: parsed.data.uploadId, projectId },
    })
    if (!upload) return reply.code(404).send({ error: 'upload_not_found' })
    if (upload.status === 'confirmed') {
      return reply.code(409).send({ error: 'already_confirmed', documentId: upload.documentId })
    }
    if (upload.status === 'rejected') {
      return reply.code(409).send({ error: 'already_rejected' })
    }

    const project = await app.prisma.project.findUnique({ where: { id: projectId } })
    if (!project) return reply.code(404).send({ error: 'project_not_found' })

    // Inheriting the project's TA is always allowed; anything else must be
    // an active TA from the master list.
    let therapeuticArea = project.therapeuticArea
    if (!sameTa(parsed.data.therapeuticArea, project.therapeuticArea)) {
      const canonical = await findActiveTaLabel(app.prisma, parsed.data.therapeuticArea)
      if (!canonical) return reply.code(400).send(invalidTaBody(parsed.data.therapeuticArea))
      therapeuticArea = canonical
    }

    // Create the Document (service enforces version/provenance invariants).
    const { document } = await svc.create({
      projectId,
      type: parsed.data.documentType,
      title: parsed.data.title,
      therapeuticArea,
      assigneeId: parsed.data.assigneeId,
      createdBy: request.user!.id,
      // No content extraction yet — start from the ICH E3 section skeleton
      // so the uploaded document is navigable and editable.
      sections: templateSections(parsed.data.documentType, project.submissionCountries),
    })

    await app.prisma.documentUpload.update({
      where: { id: upload.id },
      data: {
        status: 'confirmed',
        documentId: document.id,
      },
    })
    await app.prisma.documentSource.create({
      data: { documentId: document.id, uploadId: upload.id, linkedBy: request.user!.id },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'document_classification_confirmed',
      entityType: 'document',
      entityId: document.id,
      details: {
        uploadId: upload.id,
        confirmedType: parsed.data.documentType,
        originalClassification: upload.classification,
        overrides: parsed.data.overrides,
      },
      ipAddress: request.ip ?? null,
    })

    // Separate audit if the user manually corrected any detected fields —
    // helps QA review which auto-detections the model got wrong.
    if (parsed.data.overrides.length > 0) {
      await app.audit.append({
        timestamp: new Date().toISOString(),
        actorId: request.user!.id,
        action: 'document_classification_overridden',
        entityType: 'document',
        entityId: document.id,
        details: {
          uploadId: upload.id,
          overriddenFields: parsed.data.overrides,
        },
        ipAddress: request.ip ?? null,
      })
    }

    return reply.code(201).send(document)
  })
}
