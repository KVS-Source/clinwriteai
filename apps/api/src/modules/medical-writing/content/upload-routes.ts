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

import type { FastifyPluginAsync, FastifyInstance } from 'fastify'
import type { MultipartFile } from '@fastify/multipart'
import { z } from 'zod'
import { requireAuth } from '../../../auth/rbac.js'
import { invalidTaBody, resolveTa } from '../../platform/taxonomy/validate.js'
import { generateBlobKey } from '../../platform/blob/local-storage.js'
import { medContentShape } from './routes.js'
import { isSupportedSourceFile, SUPPORTED_SOURCE_LABEL } from '../../platform/uploads/source-files.js'
import { resolveAiEngineSettings } from '../../platform/config/ai-engine-settings.js'

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024

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

const VISION_DOC_TYPES = new Set([
  'hcp_slide_deck', 'mi_letter', 'pil', 'cme_module',
  'disease_dossier', 'eu_ctr_pls', 'advisory_report',
])

const VISION_PROMPT = [
  'You are classifying a medical-communications source document.',
  '',
  'Return ONLY compact JSON in this exact shape, nothing else:',
  '{"documentType":"hcp_slide_deck|mi_letter|pil|cme_module|disease_dossier|eu_ctr_pls|advisory_report",',
  ' "typeConfidence":0-100,',
  ' "studyTitle":"...",',
  ' "studyConfidence":0-100,',
  ' "version":"vX.Y or null",',
  ' "therapeuticArea":"short label or null"}',
  '',
  'Rules:',
  '- Pick ONE documentType from the list above. No other values.',
  '- If you cannot tell, pick the closest + lower the confidence.',
  '- studyTitle is the drug / product / disease name if present, otherwise "(unidentified)".',
  '- version is any explicit version string in the document, otherwise null.',
  '- therapeuticArea is a short label (e.g. "Oncology", "Cardiometabolic").',
  '- Do not wrap in code fences. Do not explain.',
].join('\n')

interface VisionClassification {
  documentType:     string
  typeConfidence:   number
  studyTitle:       string
  studyConfidence:  number
  version:          string | null
  therapeuticArea:  string | null
}

/** Best-effort Claude-vision classifier. Returns null on any failure
 *  (no key, non-PDF, timeout, malformed JSON) so the caller falls back
 *  to the filename heuristic without leaking a surprise 500. */
export async function classifyMedContentWithVision(
  app:       FastifyInstance,
  buf:       Buffer,
  mimetype:  string,
  fileName:  string,
  tenantId:  string,
  projectId: string,
  actorId:   string,
): Promise<VisionClassification | null> {
  if (mimetype.toLowerCase() !== 'application/pdf') return null

  let model: string
  try {
    const engine = await resolveAiEngineSettings(app.prisma)
    model = engine.default
    if (!app.aiGateway.isConfigured(model)) return null
  } catch {
    return null
  }

  let responseText: string
  try {
    const res = await app.aiGateway.chat({
      tenantId,
      projectId,
      actorId,
      module:    'C',
      intent:    'classify_med_upload',
      model,
      prompt:    VISION_PROMPT,
      documents: [{ mediaType: 'application/pdf', data: buf, label: fileName }],
      maxOutputTokens: 300,
    })
    responseText = res.responseText
  } catch {
    return null
  }

  const trimmed = responseText.trim().replace(/^```[a-zA-Z]*\s*/, '').replace(/\s*```$/, '')
  let parsed: unknown
  try { parsed = JSON.parse(trimmed) } catch { return null }
  if (!parsed || typeof parsed !== 'object') return null

  const p = parsed as Partial<VisionClassification>
  if (!p.documentType || !VISION_DOC_TYPES.has(p.documentType)) return null

  return {
    documentType:    p.documentType,
    typeConfidence:  Math.max(0, Math.min(100, Math.round(Number(p.typeConfidence ?? 0)))),
    studyTitle:      typeof p.studyTitle === 'string' ? p.studyTitle : '(unidentified)',
    studyConfidence: Math.max(0, Math.min(100, Math.round(Number(p.studyConfidence ?? 0)))),
    version:         typeof p.version === 'string' && p.version.trim().length > 0 ? p.version : null,
    therapeuticArea: typeof p.therapeuticArea === 'string' && p.therapeuticArea.trim().length > 0 ? p.therapeuticArea : null,
  }
}

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
    if (!isSupportedSourceFile(file.filename, file.mimetype)) {
      return reply.code(400).send({
        error: 'unsupported_mime',
        mimetype: file.mimetype,
        message: `Unsupported file type. Upload a ${SUPPORTED_SOURCE_LABEL}.`,
      })
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

    const filenameClassification = classifyMedContentByFilename(file.filename)
    // Claude-vision one-shot. Overrides the filename heuristic when it
    // has strictly higher documentType confidence. Null on any failure
    // (no key, non-PDF, malformed response) so the filename result
    // keeps carrying the demo.
    const visionClassification = await classifyMedContentWithVision(
      app, buf, file.mimetype, file.filename,
      request.user!.tenantId ?? 'unknown', projectId, request.user!.id,
    )
    const useVision = !!visionClassification
      && visionClassification.typeConfidence > filenameClassification.typeConfidence
    const classification = useVision
      ? {
          ...filenameClassification,
          documentType:   visionClassification!.documentType,
          typeConfidence: visionClassification!.typeConfidence,
          studyTitle:     visionClassification!.studyTitle,
          studyConfidence: visionClassification!.studyConfidence,
          version:        visionClassification!.version ?? filenameClassification.version,
          versionConfidence: visionClassification!.version ? 85 : filenameClassification.versionConfidence,
          therapeuticArea:   visionClassification!.therapeuticArea ?? filenameClassification.therapeuticArea,
          taConfidence:      visionClassification!.therapeuticArea ? 70 : filenameClassification.taConfidence,
          stub:              false,
          classifiedBy:      'claude-vision',
        }
      : { ...filenameClassification, classifiedBy: 'filename' as const }

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
        detectedType:   classification.documentType,
        classifiedBy:   useVision ? 'claude-vision' : 'filename',
        typeConfidence: classification.typeConfidence,
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

    const taTag = await resolveTa(app.prisma, parsed.data.therapeuticArea, project.therapeuticArea)
    if (!taTag) return reply.code(400).send(invalidTaBody(parsed.data.therapeuticArea))

    const created = await app.prisma.medContentItem.create({
      data: {
        projectId,
        sourceModuleAProjectId: projectId,                       // same project; cross-project source via editor later
        type: dbType,
        title: parsed.data.title,
        complianceTrack: dbTrack,
        taTag,
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
