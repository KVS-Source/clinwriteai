// /section-templates — admin-facing CRUD + lifecycle for the SectionTemplate
// entity (migration 90). Mirrors /ai-prompts routes structure.
//
// Reads: any authenticated user (admin UI + AI resolver).
// Writes: PM-only (content-admin pattern).

import type { FastifyPluginAsync } from 'fastify'
import { requireAuth } from '../../../auth/rbac.js'
import {
  SectionTemplateService,
  SectionTemplateServiceError,
} from './service.js'
import {
  createSectionTemplateSchema,
  updateSectionTemplateDraftSchema,
  retireSectionTemplateSchema,
} from './schema.js'

const readGate  = requireAuth({})
const writeGate = requireAuth({ roles: ['pm'] })

interface Row {
  id: string; docType: string; sectionKey: string; version: number; status: string
  formatJson: unknown
  supersededBy: string | null; effectiveDate: Date | null
  retiredAt: Date | null; retireReason: string | null
  approvedBy: string | null; approvedAt: Date | null
  createdBy: string; updatedBy: string; createdAt: Date; updatedAt: Date
}

function shape(row: Row) {
  return {
    id:            row.id,
    docType:       row.docType,
    sectionKey:    row.sectionKey,
    version:       row.version,
    status:        row.status,
    formatJson:    row.formatJson,
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

function mapServiceError(err: unknown): { code: number; body: Record<string, unknown> } | null {
  if (!(err instanceof SectionTemplateServiceError)) return null
  switch (err.code) {
    case 'not_found':       return { code: 404, body: { error: 'not_found',       message: err.message } }
    case 'draft_exists':    return { code: 409, body: { error: 'draft_exists',    message: err.message } }
    case 'not_a_draft':     return { code: 409, body: { error: 'not_a_draft',     message: err.message } }
    case 'already_retired': return { code: 409, body: { error: 'already_retired', message: err.message } }
  }
}

export const sectionTemplateRoutes: FastifyPluginAsync = async (app) => {
  const svc = new SectionTemplateService(app.prisma)

  // ------ reads -----------------------------------------------------------

  // GET /section-templates — latest approved row per (docType, sectionKey).
  app.get('/', { preHandler: readGate }, async () => {
    const rows = await svc.listAllApproved()
    return { templates: rows.map(r => shape(r as Row)) }
  })

  // GET /section-templates/:docType — all approved rows for one docType
  // (used by document-create to assemble the snapshot map).
  app.get('/:docType', { preHandler: readGate }, async (request) => {
    const { docType } = request.params as { docType: string }
    const rows = await svc.listApprovedForDocType(docType.replace(/-/g, '_'))
    return { templates: rows.map(r => shape(r as Row)) }
  })

  // GET /section-templates/:docType/:sectionKey — current approved row.
  // 404 when no approved row exists.
  app.get('/:docType/:sectionKey', { preHandler: readGate }, async (request, reply) => {
    const { docType, sectionKey } = request.params as { docType: string; sectionKey: string }
    const row = await svc.getApproved(docType.replace(/-/g, '_'), sectionKey)
    if (!row) return reply.code(404).send({ error: 'no_approved_template' })
    return shape(row as Row)
  })

  // GET /section-templates/:docType/:sectionKey/versions — history.
  app.get('/:docType/:sectionKey/versions', { preHandler: readGate }, async (request) => {
    const { docType, sectionKey } = request.params as { docType: string; sectionKey: string }
    const rows = await svc.listVersions(docType.replace(/-/g, '_'), sectionKey)
    return { versions: rows.map(r => shape(r as Row)) }
  })

  // ------ writes ----------------------------------------------------------

  // POST /section-templates — create a new draft. 409 if an unresolved
  // draft already exists for the same (docType, sectionKey).
  app.post('/', { preHandler: writeGate }, async (request, reply) => {
    const parsed = createSectionTemplateSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })
    try {
      const row = await svc.createDraft(parsed.data, request.user!.id)
      await app.audit.append({
        timestamp:  new Date().toISOString(),
        actorId:    request.user!.id,
        action:     'section_template.draft_created',
        entityType: 'section_template',
        entityId:   row.id,
        details:    { docType: row.docType, sectionKey: row.sectionKey, version: row.version },
        ipAddress:  request.ip ?? null,
      })
      return reply.code(201).send(shape(row as Row))
    } catch (err) {
      const mapped = mapServiceError(err)
      if (mapped) return reply.code(mapped.code).send(mapped.body)
      throw err
    }
  })

  // PATCH /section-templates/:id — edit a draft. Only drafts are mutable.
  app.patch('/:id', { preHandler: writeGate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const parsed = updateSectionTemplateDraftSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })
    try {
      const row = await svc.updateDraft(id, parsed.data, request.user!.id)
      await app.audit.append({
        timestamp:  new Date().toISOString(),
        actorId:    request.user!.id,
        action:     'section_template.draft_updated',
        entityType: 'section_template',
        entityId:   row.id,
        details:    { docType: row.docType, sectionKey: row.sectionKey, version: row.version },
        ipAddress:  request.ip ?? null,
      })
      return shape(row as Row)
    } catch (err) {
      const mapped = mapServiceError(err)
      if (mapped) return reply.code(mapped.code).send(mapped.body)
      throw err
    }
  })

  // POST /section-templates/:id/approve — promote a draft to approved.
  app.post('/:id/approve', { preHandler: writeGate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    try {
      const row = await svc.approve(id, request.user!.id)
      await app.audit.append({
        timestamp:  new Date().toISOString(),
        actorId:    request.user!.id,
        action:     'section_template.approved',
        entityType: 'section_template',
        entityId:   row.id,
        details:    { docType: row.docType, sectionKey: row.sectionKey, version: row.version },
        ipAddress:  request.ip ?? null,
      })
      return shape(row as Row)
    } catch (err) {
      const mapped = mapServiceError(err)
      if (mapped) return reply.code(mapped.code).send(mapped.body)
      throw err
    }
  })

  // POST /section-templates/:id/retire — pull a row from production.
  app.post('/:id/retire', { preHandler: writeGate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const parsed = retireSectionTemplateSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })
    try {
      const row = await svc.retire(id, parsed.data.reason, request.user!.id)
      await app.audit.append({
        timestamp:  new Date().toISOString(),
        actorId:    request.user!.id,
        action:     'section_template.retired',
        entityType: 'section_template',
        entityId:   row.id,
        details:    { docType: row.docType, sectionKey: row.sectionKey, version: row.version, reason: parsed.data.reason },
        ipAddress:  request.ip ?? null,
      })
      return shape(row as Row)
    } catch (err) {
      const mapped = mapServiceError(err)
      if (mapped) return reply.code(mapped.code).send(mapped.body)
      throw err
    }
  })
}
