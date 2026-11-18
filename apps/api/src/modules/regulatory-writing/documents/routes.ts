// Regulatory document CRUD routes — Phase M-D.2.
//
//   GET    /reg-submissions/:submissionId/documents
//   POST   /reg-submissions/:submissionId/documents
//   GET    /regulatory-documents/:id
//
// Mirror of med-content routes: pins MedContentTypePolicy equivalents
// at create time + seeds v0.1 + per-docType fallback sections.

import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { requireAuth } from '../../../auth/rbac.js'

const gate      = requireAuth({ modules: ['D'] })
const writeGate = requireAuth({ modules: ['D'] })

const ALLOWED_DOC_TYPES = [
  'ctd_m2_3_qos',
  'ctd_m2_4_nonclin_overview',
  'ctd_m2_5_clinical_overview',
  'ctd_m2_6_nonclin_summary',
  'ctd_m2_7_clinical_summary',
  'cover_letter',
  'ha_response_narrative',
  'risk_benefit_statement',
] as const

const TRACK_ENUM = ['ind', 'nda', 'maa', 'bla', 'variation', 'other'] as const

const createSchema = z.object({
  docType:         z.enum(ALLOWED_DOC_TYPES),
  title:           z.string().min(1).max(500),
  regulatoryTrack: z.enum(TRACK_ENUM).optional(),
  ownerId:         z.string().optional(),
  aiInstructions:  z.string().max(2000).optional(),
})

// Per-docType fallback section skeletons. Template pins (policy.templateId)
// override these when present.
const FALLBACK_SECTIONS: Record<typeof ALLOWED_DOC_TYPES[number], Array<{ id: string; number: string; title: string }>> = {
  ctd_m2_3_qos: [
    { id: 'introduction',       number: '2.3.S', title: 'Drug substance (introduction)' },
    { id: 'drug_product',       number: '2.3.P', title: 'Drug product' },
    { id: 'appendices',         number: '2.3.A', title: 'Appendices' },
    { id: 'regional',           number: '2.3.R', title: 'Regional information' },
  ],
  ctd_m2_4_nonclin_overview: [
    { id: 'pharmacology',       number: '2.4.1', title: 'Pharmacology overview' },
    { id: 'pharmacokinetics',   number: '2.4.2', title: 'Pharmacokinetics overview' },
    { id: 'toxicology',         number: '2.4.3', title: 'Toxicology overview' },
    { id: 'integrated_overview', number: '2.4.4', title: 'Integrated overview + conclusions' },
    { id: 'references',         number: '2.4.5', title: 'References' },
  ],
  ctd_m2_5_clinical_overview: [
    { id: 'product_development_rationale', number: '2.5.1', title: 'Product development rationale' },
    { id: 'biopharmaceutics',   number: '2.5.2', title: 'Overview of biopharmaceutics' },
    { id: 'clinical_pharmacology', number: '2.5.3', title: 'Overview of clinical pharmacology' },
    { id: 'efficacy',           number: '2.5.4', title: 'Overview of efficacy' },
    { id: 'safety',             number: '2.5.5', title: 'Overview of safety' },
    { id: 'benefits_risks',     number: '2.5.6', title: 'Benefits + risks conclusions' },
    { id: 'references',         number: '2.5.7', title: 'References' },
  ],
  ctd_m2_6_nonclin_summary: [
    { id: 'pharmacology_summary',  number: '2.6.2', title: 'Pharmacology written summary' },
    { id: 'pharmacokinetics_summary', number: '2.6.4', title: 'Pharmacokinetics written summary' },
    { id: 'toxicology_summary',    number: '2.6.6', title: 'Toxicology written summary' },
  ],
  ctd_m2_7_clinical_summary: [
    { id: 'biopharmaceutic_studies', number: '2.7.1', title: 'Biopharmaceutic studies summary' },
    { id: 'clinical_pharmacology',   number: '2.7.2', title: 'Clinical pharmacology studies summary' },
    { id: 'clinical_efficacy',       number: '2.7.3', title: 'Clinical efficacy summary' },
    { id: 'clinical_safety',         number: '2.7.4', title: 'Clinical safety summary' },
    { id: 'literature_references',   number: '2.7.5', title: 'Literature references' },
    { id: 'synopses',                number: '2.7.6', title: 'Synopses of individual studies' },
  ],
  cover_letter: [
    { id: 'body', number: '1', title: 'Cover letter' },
  ],
  ha_response_narrative: [
    { id: 'summary',       number: '1', title: 'Summary of HA questions + responses' },
    { id: 'detailed_body', number: '2', title: 'Detailed responses' },
    { id: 'appendices',    number: '3', title: 'Appendices + supporting data' },
  ],
  risk_benefit_statement: [
    { id: 'indication',    number: '1', title: 'Indication context' },
    { id: 'benefits',      number: '2', title: 'Benefits' },
    { id: 'risks',         number: '3', title: 'Risks' },
    { id: 'conclusion',    number: '4', title: 'Overall benefit-risk conclusion' },
  ],
}

function documentShape(row: {
  id: string; submissionId: string; projectId: string; docType: string; title: string
  status: string; stage: number; regulatoryTrack: string | null; version: string
  regTypePolicyVersionAtCreate: number | null
  regAiPromptRecordId: string | null; regAiPromptVersionAtCreate: number | null
  regBestPracticeRecordId: string | null; regBestPracticeVersionAtCreate: number | null
  aiDraftState: string; aiInstructions: string | null
  ownerId: string; createdBy: string; createdAt: Date; updatedAt: Date
  archivedAt: Date | null; archiveReason: string | null
  currentVersionId: string | null
}) {
  return {
    id:                             row.id,
    submissionId:                   row.submissionId,
    projectId:                      row.projectId,
    docType:                        row.docType,
    title:                          row.title,
    status:                         row.status,
    stage:                          row.stage,
    regulatoryTrack:                row.regulatoryTrack,
    version:                        row.version,
    regTypePolicyVersionAtCreate:   row.regTypePolicyVersionAtCreate,
    regAiPromptRecordId:            row.regAiPromptRecordId,
    regAiPromptVersionAtCreate:     row.regAiPromptVersionAtCreate,
    regBestPracticeRecordId:        row.regBestPracticeRecordId,
    regBestPracticeVersionAtCreate: row.regBestPracticeVersionAtCreate,
    aiDraftState:                   row.aiDraftState,
    aiInstructions:                 row.aiInstructions,
    ownerId:                        row.ownerId,
    createdBy:                      row.createdBy,
    createdAt:                      row.createdAt.toISOString(),
    updatedAt:                      row.updatedAt.toISOString(),
    archivedAt:                     row.archivedAt?.toISOString() ?? null,
    archiveReason:                  row.archiveReason,
    currentVersionId:               row.currentVersionId,
  }
}

export const regulatorySubmissionDocumentRoutes: FastifyPluginAsync = async (app) => {
  // GET /reg-submissions/:submissionId/documents
  app.get('/:submissionId/documents', { preHandler: gate }, async (request, reply) => {
    const { submissionId } = request.params as { submissionId: string }
    const submission = await app.prisma.regulatorySubmission.findUnique({
      where: { id: submissionId }, select: { id: true },
    })
    if (!submission) return reply.code(404).send({ error: 'not_found' })
    const rows = await app.prisma.regulatoryDocument.findMany({
      where:   { submissionId, archivedAt: null },
      orderBy: { createdAt: 'desc' },
    })
    return rows.map(documentShape)
  })

  // POST /reg-submissions/:submissionId/documents
  app.post('/:submissionId/documents', { preHandler: writeGate }, async (request, reply) => {
    const { submissionId } = request.params as { submissionId: string }
    const parsed = createSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const submission = await app.prisma.regulatorySubmission.findUnique({
      where: { id: submissionId },
      select: { id: true, projectId: true },
    })
    if (!submission) return reply.code(404).send({ error: 'not_found' })

    const docType = parsed.data.docType
    // Pin the current policy + latest-approved records.
    const policy = await app.prisma.regulatoryTypePolicy.findFirst({
      where: { docType, isCurrent: true, retiredAt: null },
    })
    const promptPin = await app.prisma.regulatoryAiPromptRecord.findFirst({
      where:   { docType, status: 'approved' },
      orderBy: { version: 'desc' },
      select:  { id: true, version: true },
    })
    const bpPin = await app.prisma.regulatoryBestPracticeRecord.findFirst({
      where:   { docType, status: 'approved' },
      orderBy: { version: 'desc' },
      select:  { id: true, version: true },
    })

    // Resolve section template. Policy templateId overrides; fallback
    // skeleton otherwise.
    let sectionPayload: Array<{ sectionId: string; sectionNumber: string; sectionTitle: string }>
    if (policy?.templateId) {
      const tmpl = await app.prisma.regulatoryDocumentTemplate.findUnique({ where: { id: policy.templateId } })
      const tmplSections = (tmpl?.sections as unknown as Array<{ id: string; number?: string; title: string }>) ?? []
      sectionPayload = tmplSections.length > 0
        ? tmplSections.map((s, i) => ({
            sectionId:     String(s.id ?? `s${i + 1}`),
            sectionNumber: String(s.number ?? i + 1),
            sectionTitle:  String(s.title ?? `Section ${i + 1}`),
          }))
        : FALLBACK_SECTIONS[docType].map(s => ({ sectionId: s.id, sectionNumber: s.number, sectionTitle: s.title }))
    } else {
      sectionPayload = FALLBACK_SECTIONS[docType].map(s => ({ sectionId: s.id, sectionNumber: s.number, sectionTitle: s.title }))
    }

    const { initialiseRegulatoryDocumentVersion } = await import('./section-service.js')

    const created = await app.prisma.$transaction(async (tx) => {
      const doc = await tx.regulatoryDocument.create({
        data: {
          submissionId,
          projectId:        submission.projectId,
          docType,
          title:            parsed.data.title,
          regulatoryTrack:  parsed.data.regulatoryTrack ?? policy?.regulatoryTrack ?? null,
          ownerId:          parsed.data.ownerId ?? request.user!.id,
          createdBy:        request.user!.id,
          aiInstructions:   parsed.data.aiInstructions?.trim() || null,
          regTypePolicyVersionAtCreate:   policy?.version       ?? null,
          regAiPromptRecordId:            promptPin?.id         ?? null,
          regAiPromptVersionAtCreate:     promptPin?.version    ?? null,
          regBestPracticeRecordId:        bpPin?.id             ?? null,
          regBestPracticeVersionAtCreate: bpPin?.version        ?? null,
        },
      })
      await initialiseRegulatoryDocumentVersion(tx, {
        regulatoryDocumentId: doc.id,
        actorId:              request.user!.id,
        sections:             sectionPayload,
        docType,                                                    // migration 90: SectionTemplate snapshot
      })
      return doc
    })

    await app.audit.append({
      timestamp:  new Date().toISOString(),
      actorId:    request.user!.id,
      action:     'regulatory_document_created',
      entityType: 'regulatory_document',
      entityId:   created.id,
      details:    {
        submissionId,
        docType,
        title: created.title,
        sectionCount: sectionPayload.length,
        regulatoryTypePolicyVersionAtCreate: policy?.version ?? null,
        regulatoryAiPromptRecordId:          promptPin?.id ?? null,
        regulatoryBestPracticeRecordId:      bpPin?.id ?? null,
      },
      ipAddress: request.ip ?? null,
    })

    const refreshed = await app.prisma.regulatoryDocument.findUnique({ where: { id: created.id } })
    return reply.code(201).send(documentShape(refreshed!))
  })
}

export const regulatoryDocumentRoutes: FastifyPluginAsync = async (app) => {
  // GET /regulatory-documents/:id
  app.get('/:id', { preHandler: gate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const doc = await app.prisma.regulatoryDocument.findUnique({ where: { id } })
    if (!doc || doc.archivedAt) return reply.code(404).send({ error: 'not_found' })
    return documentShape(doc)
  })

  // Phase M-D.3 — kick off the AI initial-draft worker. Mirror of
  // med_content /ai-initial-draft. Idempotent on jobId; 409 when a
  // chain is already in flight. aiInstructions (if sent) persists on
  // the document.
  const draftRequestSchema = z.object({
    aiInstructions: z.string().max(2000).optional(),
  })
  app.post('/:regulatoryDocumentId/ai-initial-draft', { preHandler: writeGate }, async (request, reply) => {
    const { regulatoryDocumentId } = request.params as { regulatoryDocumentId: string }
    const parsed = draftRequestSchema.safeParse(request.body ?? {})
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const doc = await app.prisma.regulatoryDocument.findUnique({
      where: { id: regulatoryDocumentId },
      select: {
        id: true, projectId: true, archivedAt: true,
        aiDraftState: true, currentVersionId: true,
      },
    })
    if (!doc || doc.archivedAt) return reply.code(404).send({ error: 'not_found' })
    if (!doc.currentVersionId) {
      return reply.code(409).send({
        error:   'no_current_version',
        message: 'Regulatory document has no current version. Create flow should have seeded v0.1.',
      })
    }
    {
      const { actorCanEditRegulatoryDocument: canEdit, REG_DOC_EDIT_FORBIDDEN: forbidden } =
        await import('../access/regulatory-document-raci.js')
      if (!(await canEdit(app.prisma, request.user!, regulatoryDocumentId))) {
        return reply.code(403).send(forbidden)
      }
    }
    if (doc.aiDraftState === 'drafting' || doc.aiDraftState === 'validating') {
      return reply.code(409).send({
        error:   'already_running',
        state:   doc.aiDraftState,
        message: `AI draft chain is already ${doc.aiDraftState} for this document.`,
      })
    }

    if (parsed.data.aiInstructions !== undefined) {
      await app.prisma.regulatoryDocument.update({
        where: { id: regulatoryDocumentId },
        data:  {
          aiInstructions: parsed.data.aiInstructions.trim() || null,
          aiDraftState:   'idle',
        },
      })
    }

    const jobId = `reg-ai-initial-draft-${regulatoryDocumentId}`
    try {
      await app.queue.enqueue('regulatory.ai_initial_draft', {
        regulatoryDocumentId,
        projectId: doc.projectId,
        actorId:   request.user!.id,
      }, { jobId })
    } catch (err) {
      request.log.warn({ err, regulatoryDocumentId }, 'reg ai-initial-draft: enqueue failed')
      return reply.code(503).send({ error: 'enqueue_failed', message: 'Could not enqueue the draft job.' })
    }

    await app.audit.append({
      timestamp:  new Date().toISOString(),
      actorId:    request.user!.id,
      action:     'regulatory_document_ai_initial_draft_enqueued',
      entityType: 'regulatory_document',
      entityId:   regulatoryDocumentId,
      details:    { jobId, hasAiInstructions: parsed.data.aiInstructions !== undefined },
      ipAddress:  request.ip ?? null,
    })

    return reply.code(202).send({ jobId, regulatoryDocumentId, state: 'enqueued' })
  })
}
