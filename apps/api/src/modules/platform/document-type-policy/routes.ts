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
import { requireAuth } from '../../../auth/rbac.js'
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

// Project admins can read (for the wizard preview); super-admin only can write.
const readGate  = requireAuth({})
const writeGate = requireAuth({ roles: ['tenant-admin', 'super-admin', 'admin'] })

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
