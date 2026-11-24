// /med-content-type-policies + /med-content-ai-prompts +
// /med-content-best-practice-records admin routes — Phase M-C.1.
// Mirror of Module B's publication policy routes.
//
// Reads: any authenticated Module-C user. Writes (patch / approve /
// retire / distill): PM-only. AI readiness gated on prompt + distill.

import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { requireAuth } from '../../../auth/rbac.js'
import { resolveAiEngineSettings } from '../../platform/config/ai-engine-settings.js'
import { MedContentAiPromptService, MedContentAiPromptServiceError } from './ai-prompt-service.js'
import { MedContentBestPracticeService, MedContentBpServiceError } from './best-practice-service.js'
import { MedContentTypePolicyService, MedContentTypePolicyServiceError } from './type-policy-service.js'
import { policyRequirementsSchema, requirementsOf } from '../../platform/policy-requirements.js'

const readGate  = requireAuth({ modules: ['C'] })
const writeGate = requireAuth({ modules: ['C'], roles: ['pm'] })

const AI_NOT_CONFIGURED = {
  error:     'ai_not_configured',
  message:   'Set up an AI engine (API key) before editing medical-content prompts.',
  setupPath: '/admin',
} as const

const sectionRuleSchema = z.object({
  severity: z.enum(['must', 'should', 'nice']),
  text:     z.string().min(1).max(2_000),
})
const sectionRulesSchema = z.record(
  z.string().regex(/^[a-zA-Z0-9_.\-§]+$/),
  z.array(sectionRuleSchema),
)

const principleSchema = z.object({
  scope:    z.string().min(1).max(200),
  severity: z.enum(['must', 'should', 'nice']),
  text:     z.string().min(1).max(2_000),
})
const digestSchema = z.object({
  principles:     z.array(principleSchema).max(200),
  sourcePdfId:    z.string().optional(),
  distilledAt:    z.string().optional(),
  distilledModel: z.string().optional(),
})

const retireSchema = z.object({ reason: z.string().min(1).max(500) })

interface PolicyRow {
  id: string; docType: string; version: number; isCurrent: boolean
  templateId: string | null; checklistTemplateId: string | null
  complianceTrack: string | null; reviewTierFormula: string | null
  smePrompt: string; bestPracticeDigest: unknown; sectionRules: unknown
  requirements: unknown
  effectiveDate: Date; retiredAt: Date | null; retiredBy: string | null
  retireReason: string | null; supersededBy: string | null
  createdBy: string; updatedBy: string
  createdAt: Date; updatedAt: Date
}

function shapePolicy(row: PolicyRow) {
  return {
    id:                  row.id,
    docType:             row.docType,
    version:             row.version,
    isCurrent:           row.isCurrent,
    templateId:          row.templateId,
    checklistTemplateId: row.checklistTemplateId,
    complianceTrack:     row.complianceTrack,
    reviewTierFormula:   row.reviewTierFormula,
    smePrompt:           row.smePrompt,
    bestPracticeDigest:  row.bestPracticeDigest,
    sectionRules:        row.sectionRules,
    requirements:        requirementsOf(row),
    effectiveDate:       row.effectiveDate.toISOString(),
    retiredAt:           row.retiredAt?.toISOString() ?? null,
    retiredBy:           row.retiredBy,
    retireReason:        row.retireReason,
    supersededBy:        row.supersededBy,
    createdBy:           row.createdBy,
    updatedBy:           row.updatedBy,
    createdAt:           row.createdAt.toISOString(),
    updatedAt:           row.updatedAt.toISOString(),
  }
}

interface AiPromptRow {
  id: string; docType: string; version: number; status: string
  smePrompt: string; sectionRules: unknown
  supersededBy: string | null; effectiveDate: Date | null
  retiredAt: Date | null; retireReason: string | null
  approvedBy: string | null; approvedAt: Date | null
  createdBy: string; updatedBy: string
  createdAt: Date; updatedAt: Date
}

function shapeAiPrompt(row: AiPromptRow) {
  return {
    id:            row.id,
    docType:       row.docType,
    version:       row.version,
    status:        row.status,
    smePrompt:     row.smePrompt,
    sectionRules:  row.sectionRules,
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

interface BpRow {
  id: string; docType: string; version: number; status: string
  digest: unknown
  sourcePdfId: string | null; distilledAt: Date | null; distilledModel: string | null
  supersededBy: string | null; effectiveDate: Date | null
  retiredAt: Date | null; retireReason: string | null
  approvedBy: string | null; approvedAt: Date | null
  createdBy: string; updatedBy: string
  createdAt: Date; updatedAt: Date
}

function shapeBp(row: BpRow) {
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

// -------- Type Policy routes ---------------------------------------------
export const medContentTypePolicyRoutes: FastifyPluginAsync = async (app) => {
  const svc = new MedContentTypePolicyService(app.prisma)

  const createSchema = z.object({
    docType:             z.string().min(1).max(80),
    smePrompt:           z.string().min(1).max(100_000),
    bestPracticeDigest:  z.unknown().optional(),
    sectionRules:        sectionRulesSchema.optional(),
    templateId:          z.string().nullable().optional(),
    checklistTemplateId: z.string().nullable().optional(),
    complianceTrack:     z.enum(['promotional', 'non_promotional', 'cme', 'advisory']).nullable().optional(),
    reviewTierFormula:   z.string().nullable().optional(),
    requirements:        policyRequirementsSchema.optional(),
  })

  const patchSchema = z.object({
    smePrompt:           z.string().min(1).max(100_000).optional(),
    bestPracticeDigest:  z.unknown().optional(),
    sectionRules:        sectionRulesSchema.optional(),
    templateId:          z.string().nullable().optional(),
    checklistTemplateId: z.string().nullable().optional(),
    complianceTrack:     z.enum(['promotional', 'non_promotional', 'cme', 'advisory']).nullable().optional(),
    reviewTierFormula:   z.string().nullable().optional(),
    requirements:        policyRequirementsSchema.optional(),
  })

  function mapServiceError(err: unknown): { code: number; body: Record<string, unknown> } | null {
    if (!(err instanceof MedContentTypePolicyServiceError)) return null
    switch (err.code) {
      case 'not_found': return { code: 404, body: { error: 'not_found', message: err.message } }
      case 'duplicate': return { code: 409, body: { error: 'duplicate', message: err.message } }
    }
  }

  app.get('/', { preHandler: readGate }, async () => {
    const rows = await svc.listAll()
    return { policies: rows.map(r => shapePolicy(r as PolicyRow)) }
  })

  app.get('/:docType', { preHandler: readGate }, async (request, reply) => {
    const { docType } = request.params as { docType: string }
    const row = await svc.getCurrent(docType.replace(/-/g, '_'))
    if (!row) return reply.code(404).send({ error: 'not_found' })
    return shapePolicy(row as PolicyRow)
  })

  app.post('/', { preHandler: writeGate }, async (request, reply) => {
    const parsed = createSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })
    try {
      const row = await svc.create(parsed.data, request.user!.id)
      await app.audit.append({
        timestamp:  new Date().toISOString(),
        actorId:    request.user!.id,
        action:     'med_content_type_policy.created',
        entityType: 'med_content_type_policy',
        entityId:   row.id,
        details:    { docType: row.docType, version: row.version },
        ipAddress:  request.ip ?? null,
      })
      return reply.code(201).send(shapePolicy(row as PolicyRow))
    } catch (err) {
      const mapped = mapServiceError(err)
      if (mapped) return reply.code(mapped.code).send(mapped.body)
      throw err
    }
  })

  app.patch('/:docType', { preHandler: writeGate }, async (request, reply) => {
    const { docType } = request.params as { docType: string }
    const parsed = patchSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })
    try {
      const row = await svc.update(docType, parsed.data, request.user!.id)
      await app.audit.append({
        timestamp:  new Date().toISOString(),
        actorId:    request.user!.id,
        action:     'med_content_type_policy.updated',
        entityType: 'med_content_type_policy',
        entityId:   row.id,
        details:    { docType: row.docType, version: row.version, changedKeys: Object.keys(parsed.data) },
        ipAddress:  request.ip ?? null,
      })
      return shapePolicy(row as PolicyRow)
    } catch (err) {
      const mapped = mapServiceError(err)
      if (mapped) return reply.code(mapped.code).send(mapped.body)
      throw err
    }
  })

  app.post('/:docType/retire', { preHandler: writeGate }, async (request, reply) => {
    const { docType } = request.params as { docType: string }
    const parsed = retireSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })
    try {
      const row = await svc.retire(docType, parsed.data.reason, request.user!.id)
      await app.audit.append({
        timestamp:  new Date().toISOString(),
        actorId:    request.user!.id,
        action:     'med_content_type_policy.retired',
        entityType: 'med_content_type_policy',
        entityId:   row.id,
        details:    { docType: row.docType, version: row.version, reason: parsed.data.reason },
        ipAddress:  request.ip ?? null,
      })
      return shapePolicy(row as PolicyRow)
    } catch (err) {
      const mapped = mapServiceError(err)
      if (mapped) return reply.code(mapped.code).send(mapped.body)
      throw err
    }
  })

  // BP distill upload — RETIRED (M-F.1). See scientific-writing routes
  // for the migration rationale. Section Templates now carry formatting.
  app.post('/:docType/distill-best-practice-file', { preHandler: writeGate }, async (_request, reply) =>
    reply.code(410).send({
      error:   'bp_distill_retired',
      message: 'Medical-content BP distillation is retired. BP is now author guidance only; use Section Templates for AI-visible formatting rules.',
    }),
  )
}

// -------- AI Prompt routes -----------------------------------------------
export const medContentAiPromptRoutes: FastifyPluginAsync = async (app) => {
  const svc = new MedContentAiPromptService(app.prisma)

  const createSchema = z.object({
    docType:      z.string().min(1).max(80),
    smePrompt:    z.string().min(1).max(100_000),
    sectionRules: sectionRulesSchema.optional(),
  })
  const patchSchema = z.object({
    smePrompt:    z.string().min(1).max(100_000).optional(),
    sectionRules: sectionRulesSchema.optional(),
  })

  async function assertAiReady(): Promise<boolean> {
    const engine = await resolveAiEngineSettings(app.prisma)
    return app.aiGateway.isConfigured(engine.default)
  }

  function mapServiceError(err: unknown): { code: number; body: Record<string, unknown> } | null {
    if (!(err instanceof MedContentAiPromptServiceError)) return null
    switch (err.code) {
      case 'not_found':       return { code: 404, body: { error: 'not_found',       message: err.message } }
      case 'draft_exists':    return { code: 409, body: { error: 'draft_exists',    message: err.message } }
      case 'not_a_draft':     return { code: 409, body: { error: 'not_a_draft',     message: err.message } }
      case 'already_retired': return { code: 409, body: { error: 'already_retired', message: err.message } }
    }
  }

  app.get('/', { preHandler: readGate }, async () => {
    const rows = await svc.listAllApproved()
    return { prompts: rows.map(r => shapeAiPrompt(r as AiPromptRow)) }
  })

  app.get('/:docType', { preHandler: readGate }, async (request, reply) => {
    const { docType } = request.params as { docType: string }
    const row = await svc.getApproved(docType.replace(/-/g, '_'))
    if (!row) return reply.code(404).send({ error: 'no_approved_prompt' })
    return shapeAiPrompt(row as AiPromptRow)
  })

  app.get('/:docType/versions', { preHandler: readGate }, async (request) => {
    const { docType } = request.params as { docType: string }
    const rows = await svc.listVersions(docType.replace(/-/g, '_'))
    return { versions: rows.map(r => shapeAiPrompt(r as AiPromptRow)) }
  })

  app.post('/', { preHandler: writeGate }, async (request, reply) => {
    if (!(await assertAiReady())) return reply.code(503).send(AI_NOT_CONFIGURED)
    const parsed = createSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })
    try {
      const row = await svc.createDraft(parsed.data, request.user!.id)
      await app.audit.append({
        timestamp:  new Date().toISOString(),
        actorId:    request.user!.id,
        action:     'med_content_ai_prompt.draft_created',
        entityType: 'med_content_ai_prompt_record',
        entityId:   row.id,
        details:    { docType: row.docType, version: row.version, promptChars: row.smePrompt.length },
        ipAddress:  request.ip ?? null,
      })
      return reply.code(201).send(shapeAiPrompt(row as AiPromptRow))
    } catch (err) {
      const mapped = mapServiceError(err)
      if (mapped) return reply.code(mapped.code).send(mapped.body)
      throw err
    }
  })

  app.patch('/:id', { preHandler: writeGate }, async (request, reply) => {
    if (!(await assertAiReady())) return reply.code(503).send(AI_NOT_CONFIGURED)
    const { id } = request.params as { id: string }
    const parsed = patchSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })
    try {
      const row = await svc.updateDraft(id, parsed.data, request.user!.id)
      await app.audit.append({
        timestamp:  new Date().toISOString(),
        actorId:    request.user!.id,
        action:     'med_content_ai_prompt.draft_updated',
        entityType: 'med_content_ai_prompt_record',
        entityId:   row.id,
        details:    { docType: row.docType, version: row.version, changedKeys: Object.keys(parsed.data) },
        ipAddress:  request.ip ?? null,
      })
      return shapeAiPrompt(row as AiPromptRow)
    } catch (err) {
      const mapped = mapServiceError(err)
      if (mapped) return reply.code(mapped.code).send(mapped.body)
      throw err
    }
  })

  app.post('/:id/approve', { preHandler: writeGate }, async (request, reply) => {
    if (!(await assertAiReady())) return reply.code(503).send(AI_NOT_CONFIGURED)
    const { id } = request.params as { id: string }
    try {
      const row = await svc.approve(id, request.user!.id)
      await app.audit.append({
        timestamp:  new Date().toISOString(),
        actorId:    request.user!.id,
        action:     'med_content_ai_prompt.approved',
        entityType: 'med_content_ai_prompt_record',
        entityId:   row.id,
        details:    { docType: row.docType, version: row.version },
        ipAddress:  request.ip ?? null,
      })
      return shapeAiPrompt(row as AiPromptRow)
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
        action:     'med_content_ai_prompt.retired',
        entityType: 'med_content_ai_prompt_record',
        entityId:   row.id,
        details:    { docType: row.docType, version: row.version, reason: parsed.data.reason },
        ipAddress:  request.ip ?? null,
      })
      return shapeAiPrompt(row as AiPromptRow)
    } catch (err) {
      const mapped = mapServiceError(err)
      if (mapped) return reply.code(mapped.code).send(mapped.body)
      throw err
    }
  })
}

// -------- Best-Practice routes -------------------------------------------
export const medContentBestPracticeRoutes: FastifyPluginAsync = async (app) => {
  const svc = new MedContentBestPracticeService(app.prisma)

  const patchSchema = z.object({ digest: digestSchema.optional() })

  function mapServiceError(err: unknown): { code: number; body: Record<string, unknown> } | null {
    if (!(err instanceof MedContentBpServiceError)) return null
    switch (err.code) {
      case 'not_found':       return { code: 404, body: { error: 'not_found',       message: err.message } }
      case 'not_a_draft':     return { code: 409, body: { error: 'not_a_draft',     message: err.message } }
      case 'already_retired': return { code: 409, body: { error: 'already_retired', message: err.message } }
    }
  }

  app.get('/', { preHandler: readGate }, async () => {
    const rows = await svc.listAllApproved()
    return { records: rows.map(r => shapeBp(r as BpRow)) }
  })

  app.get('/:docType', { preHandler: readGate }, async (request, reply) => {
    const { docType } = request.params as { docType: string }
    const row = await svc.getApproved(docType.replace(/-/g, '_'))
    if (!row) return reply.code(404).send({ error: 'no_approved_record' })
    return shapeBp(row as BpRow)
  })

  app.get('/:docType/versions', { preHandler: readGate }, async (request) => {
    const { docType } = request.params as { docType: string }
    const rows = await svc.listVersions(docType.replace(/-/g, '_'))
    return { versions: rows.map(r => shapeBp(r as BpRow)) }
  })

  app.patch('/:id', { preHandler: writeGate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const parsed = patchSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })
    try {
      const row = await svc.updateDraft(id, parsed.data, request.user!.id)
      await app.audit.append({
        timestamp:  new Date().toISOString(),
        actorId:    request.user!.id,
        action:     'med_content_best_practice.draft_updated',
        entityType: 'med_content_best_practice_record',
        entityId:   row.id,
        details:    { docType: row.docType, version: row.version, principleCount: parsed.data.digest?.principles?.length ?? null },
        ipAddress:  request.ip ?? null,
      })
      return shapeBp(row as BpRow)
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
        action:     'med_content_best_practice.approved',
        entityType: 'med_content_best_practice_record',
        entityId:   row.id,
        details:    { docType: row.docType, version: row.version },
        ipAddress:  request.ip ?? null,
      })
      return shapeBp(row as BpRow)
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
        action:     'med_content_best_practice.retired',
        entityType: 'med_content_best_practice_record',
        entityId:   row.id,
        details:    { docType: row.docType, version: row.version, reason: parsed.data.reason },
        ipAddress:  request.ip ?? null,
      })
      return shapeBp(row as BpRow)
    } catch (err) {
      const mapped = mapServiceError(err)
      if (mapped) return reply.code(mapped.code).send(mapped.body)
      throw err
    }
  })
}
