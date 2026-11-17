// /best-practice-records routes — admin-facing read + workflow for the
// BestPracticeRecord entity (Phase 2 of the pointer refactor).
//
// Reads: any authenticated user. Writes (patch / approve / retire): PM-only
// (content-admin pattern, matching AiPromptRecord + DocumentTypePolicy).
//
// Distillation itself still flows through the existing
// /document-type-policies/:docType/distill-best-practice-file route — only
// what the worker DOES with the parsed digest changed. The worker now
// writes to a draft BestPracticeRecord instead of policy.bestPracticeDigest.

import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { requireAuth } from '../../../auth/rbac.js'
import { BestPracticeService, BestPracticeServiceError } from './service.js'

const readGate  = requireAuth({})
const writeGate = requireAuth({ roles: ['pm'] })

const principleSchema = z.object({
  scope:    z.string().min(1).max(200),            // 'whole-doc' | 'section:<key>'
  severity: z.enum(['must', 'should', 'nice']),
  text:     z.string().min(1).max(2_000),
})
const digestSchema = z.object({
  principles:     z.array(principleSchema).max(200),
  sourcePdfId:    z.string().optional(),
  distilledAt:    z.string().optional(),
  distilledModel: z.string().optional(),
})

const patchSchema  = z.object({
  digest: digestSchema.optional(),
})
const retireSchema = z.object({ reason: z.string().min(1).max(500) })

interface Row {
  id: string; docType: string; version: number; status: string
  digest: unknown
  sourcePdfId: string | null
  distilledAt: Date | null
  distilledModel: string | null
  supersededBy: string | null
  effectiveDate: Date | null
  retiredAt: Date | null
  retireReason: string | null
  approvedBy: string | null
  approvedAt: Date | null
  createdBy: string; updatedBy: string
  createdAt: Date; updatedAt: Date
}

function shape(row: Row) {
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

function mapServiceError(err: unknown): { code: number; body: Record<string, unknown> } | null {
  if (!(err instanceof BestPracticeServiceError)) return null
  switch (err.code) {
    case 'not_found':       return { code: 404, body: { error: 'not_found',       message: err.message } }
    case 'not_a_draft':     return { code: 409, body: { error: 'not_a_draft',     message: err.message } }
    case 'already_retired': return { code: 409, body: { error: 'already_retired', message: err.message } }
  }
}

export const bestPracticeRoutes: FastifyPluginAsync = async (app) => {
  const svc = new BestPracticeService(app.prisma)

  // ------ reads -----------------------------------------------------------

  app.get('/', { preHandler: readGate }, async () => {
    const rows = await svc.listAllApproved()
    return { records: rows.map(r => shape(r as Row)) }
  })

  app.get('/:docType', { preHandler: readGate }, async (request, reply) => {
    const { docType } = request.params as { docType: string }
    const row = await svc.getApproved(docType.replace(/-/g, '_'))
    if (!row) return reply.code(404).send({ error: 'no_approved_record' })
    return shape(row as Row)
  })

  app.get('/:docType/versions', { preHandler: readGate }, async (request) => {
    const { docType } = request.params as { docType: string }
    const rows = await svc.listVersions(docType.replace(/-/g, '_'))
    return { versions: rows.map(r => shape(r as Row)) }
  })

  // ------ writes ----------------------------------------------------------

  app.patch('/:id', { preHandler: writeGate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const parsed = patchSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })
    try {
      const row = await svc.updateDraft(id, parsed.data, request.user!.id)
      await app.audit.append({
        timestamp:  new Date().toISOString(),
        actorId:    request.user!.id,
        action:     'best_practice.draft_updated',
        entityType: 'best_practice_record',
        entityId:   row.id,
        details:    { docType: row.docType, version: row.version, principleCount: parsed.data.digest?.principles?.length ?? null },
        ipAddress:  request.ip ?? null,
      })
      return shape(row as Row)
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
        action:     'best_practice.approved',
        entityType: 'best_practice_record',
        entityId:   row.id,
        details:    { docType: row.docType, version: row.version },
        ipAddress:  request.ip ?? null,
      })
      return shape(row as Row)
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
        action:     'best_practice.retired',
        entityType: 'best_practice_record',
        entityId:   row.id,
        details:    { docType: row.docType, version: row.version, reason: parsed.data.reason },
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
