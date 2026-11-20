// /ai-prompts routes — admin-facing CRUD + workflow for the AiPromptRecord
// entity (Phase 1 of the pointer refactor).
//
// Reads: any authenticated user (the AI Prompts tab + AI assembly use
// these). Writes: PM-only (content-admin pattern, matching Doc Type
// Policies).

import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { requireAuth } from '../../../auth/rbac.js'
import { resolveAiEngineSettings } from '../config/ai-engine-settings.js'
import { resolveAnthropicKey } from '../ai-gateway/resolve-anthropic-key.js'
import { AiPromptService, AiPromptServiceError } from './service.js'
import { extractSectionRulesWithClaude, buildStubSectionRules } from '../document-type-policy/ai-extract-section-rules.js'

const readGate  = requireAuth({})
const writeGate = requireAuth({ roles: ['pm'] })

const AI_NOT_CONFIGURED = {
  error:     'ai_not_configured',
  message:   'Set up an AI engine (API key) before editing prompts — prompts here never reach a model until AI is configured.',
  setupPath: '/admin',
} as const

const sectionRuleSchema = z.object({
  severity: z.enum(['must', 'should', 'nice']),
  text:     z.string().min(1).max(2_000),
})
const sectionRulesSchema  = z.record(z.string().regex(/^[a-zA-Z0-9_.\-§]+$/), z.array(sectionRuleSchema))
const crossCuttingSchema  = z.array(sectionRuleSchema).max(30)

const createSchema = z.object({
  docType:            z.string().min(1).max(80),
  smePrompt:          z.string().min(1).max(100_000),
  sectionRules:       sectionRulesSchema.optional(),
  crossCuttingRules:  crossCuttingSchema.optional(),
})
const patchSchema = z.object({
  smePrompt:          z.string().min(1).max(100_000).optional(),
  sectionRules:       sectionRulesSchema.optional(),
  crossCuttingRules:  crossCuttingSchema.optional(),
})
const retireSchema = z.object({ reason: z.string().min(1).max(500) })

interface Row {
  id: string; docType: string; version: number; status: string
  smePrompt: string; sectionRules: unknown; crossCuttingRules?: unknown
  supersededBy: string | null; effectiveDate: Date | null
  retiredAt: Date | null; retireReason: string | null
  approvedBy: string | null; approvedAt: Date | null
  createdBy: string; updatedBy: string; createdAt: Date; updatedAt: Date
}

function shape(row: Row) {
  return {
    id:                row.id,
    docType:           row.docType,
    version:           row.version,
    status:            row.status,
    smePrompt:         row.smePrompt,
    sectionRules:      row.sectionRules,
    crossCuttingRules: row.crossCuttingRules ?? [],
    supersededBy:      row.supersededBy,
    effectiveDate:     row.effectiveDate?.toISOString() ?? null,
    retiredAt:         row.retiredAt?.toISOString() ?? null,
    retireReason:      row.retireReason,
    approvedBy:        row.approvedBy,
    approvedAt:        row.approvedAt?.toISOString() ?? null,
    createdBy:         row.createdBy,
    updatedBy:         row.updatedBy,
    createdAt:         row.createdAt.toISOString(),
    updatedAt:         row.updatedAt.toISOString(),
  }
}

function mapServiceError(err: unknown): { code: number; body: Record<string, unknown> } | null {
  if (!(err instanceof AiPromptServiceError)) return null
  switch (err.code) {
    case 'not_found':       return { code: 404, body: { error: 'not_found',       message: err.message } }
    case 'draft_exists':    return { code: 409, body: { error: 'draft_exists',    message: err.message } }
    case 'not_a_draft':     return { code: 409, body: { error: 'not_a_draft',     message: err.message } }
    case 'already_retired': return { code: 409, body: { error: 'already_retired', message: err.message } }
  }
}

export const aiPromptRoutes: FastifyPluginAsync = async (app) => {
  const svc = new AiPromptService(app.prisma)

  async function assertAiReady(): Promise<boolean> {
    const engine = await resolveAiEngineSettings(app.prisma)
    return app.aiGateway.isConfigured(engine.default)
  }

  // ------ reads -----------------------------------------------------------

  // GET /ai-prompts — one row per docType for the admin list. Shows
  // approved rows when present, falls back to the draft otherwise so a
  // brand-new draft doesn't vanish between "Create" and "Approve".
  // Retired rows are always excluded (audit snapshots, not navigation).
  app.get('/', { preHandler: readGate }, async () => {
    const rows = await svc.listVisible()
    return { prompts: rows.map(r => shape(r as Row)) }
  })

  // GET /ai-prompts/:docType — current approved row for a docType.
  // Returns 404 when no approved row exists — admins should promote a
  // draft before AI will see anything.
  app.get('/:docType', { preHandler: readGate }, async (request, reply) => {
    const { docType } = request.params as { docType: string }
    const row = await svc.getApproved(docType.replace(/-/g, '_'))
    if (!row) return reply.code(404).send({ error: 'no_approved_prompt' })
    return shape(row as Row)
  })

  // GET /ai-prompts/:docType/versions — history (approved + draft + retired).
  app.get('/:docType/versions', { preHandler: readGate }, async (request) => {
    const { docType } = request.params as { docType: string }
    const rows = await svc.listVersions(docType.replace(/-/g, '_'))
    return { versions: rows.map(r => shape(r as Row)) }
  })

  // ------ writes ----------------------------------------------------------

  // POST /ai-prompts — create a new draft for a docType. 409 if an
  // unresolved draft already exists (admin should edit that instead).
  app.post('/', { preHandler: writeGate }, async (request, reply) => {
    if (!(await assertAiReady())) return reply.code(503).send(AI_NOT_CONFIGURED)
    const parsed = createSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })
    try {
      const row = await svc.createDraft(parsed.data, request.user!.id)
      await app.audit.append({
        timestamp:  new Date().toISOString(),
        actorId:    request.user!.id,
        action:     'ai_prompt.draft_created',
        entityType: 'ai_prompt_record',
        entityId:   row.id,
        details:    { docType: row.docType, version: row.version, promptChars: row.smePrompt.length },
        ipAddress:  request.ip ?? null,
      })
      return reply.code(201).send(shape(row as Row))
    } catch (err) {
      const mapped = mapServiceError(err)
      if (mapped) return reply.code(mapped.code).send(mapped.body)
      throw err
    }
  })

  // PATCH /ai-prompts/:id — edit a draft. Only draft rows are mutable;
  // approved + retired are audit snapshots.
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
        action:     'ai_prompt.draft_updated',
        entityType: 'ai_prompt_record',
        entityId:   row.id,
        details:    { docType: row.docType, version: row.version, changedKeys: Object.keys(parsed.data) },
        ipAddress:  request.ip ?? null,
      })
      return shape(row as Row)
    } catch (err) {
      const mapped = mapServiceError(err)
      if (mapped) return reply.code(mapped.code).send(mapped.body)
      throw err
    }
  })

  // POST /ai-prompts/:id/approve — promote a draft to approved. Flips
  // the previously-approved row of the same docType to retired. AI
  // assembly immediately starts picking up this row for any document
  // that doesn't have an explicit pin yet.
  app.post('/:id/approve', { preHandler: writeGate }, async (request, reply) => {
    if (!(await assertAiReady())) return reply.code(503).send(AI_NOT_CONFIGURED)
    const { id } = request.params as { id: string }
    try {
      const row = await svc.approve(id, request.user!.id)
      await app.audit.append({
        timestamp:  new Date().toISOString(),
        actorId:    request.user!.id,
        action:     'ai_prompt.approved',
        entityType: 'ai_prompt_record',
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

  // POST /ai-prompts/:id/retire — pull a row from production. Approved
  // rows should normally be retired via approve-of-replacement; this
  // path is for operator cleanup.
  app.post('/:id/retire', { preHandler: writeGate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const parsed = retireSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })
    try {
      const row = await svc.retire(id, parsed.data.reason, request.user!.id)
      await app.audit.append({
        timestamp:  new Date().toISOString(),
        actorId:    request.user!.id,
        action:     'ai_prompt.retired',
        entityType: 'ai_prompt_record',
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

  // POST /ai-prompts/:id/extract-section-rules — same inference step the
  // Doc Type Policies editor exposes, but keyed off the AiPromptRecord
  // row (uses THIS row's smePrompt). Returns the parsed JSON for admin
  // review; admin saves via PATCH to persist. 422 when row is not a
  // draft (approved rows are immutable snapshots).
  app.post('/:id/extract-section-rules', { preHandler: writeGate }, async (request, reply) => {
    if (!(await assertAiReady())) return reply.code(503).send(AI_NOT_CONFIGURED)
    const { id } = request.params as { id: string }
    const row = await svc.findById(id)
    if (!row) return reply.code(404).send({ error: 'not_found' })
    if (!row.smePrompt.trim()) {
      return reply.code(422).send({
        error:   'empty_sme_prompt',
        message: 'Nothing to extract from — this prompt row has no SME text.',
      })
    }
    const engine = await resolveAiEngineSettings(app.prisma)
    // DB-only key lookup — admin pastes via Settings → AI engine → API keys.
    // AI_ALLOW_STUB still permits the stub path for dev/CI without a key.
    const apiKey = await resolveAnthropicKey(app.prisma)
    const stubAllowed = process.env.AI_ALLOW_STUB === '1'
    let rules: Awaited<ReturnType<typeof extractSectionRulesWithClaude>>
    try {
      rules = apiKey
        ? await extractSectionRulesWithClaude({
            prisma:    app.prisma,
            docType:   row.docType,
            smePrompt: row.smePrompt,
            model:     engine.default,
            apiKey,
          })
        : stubAllowed
          ? buildStubSectionRules()
          : (() => { throw new Error('ai_not_configured') })()
    } catch (err) {
      app.log.warn({ err, id, docType: row.docType }, 'ai-prompt section-rules extract: Claude call failed')
      return reply.code(502).send({
        error:   'ai_call_failed',
        message: err instanceof Error ? err.message : 'AI extraction failed',
      })
    }
    const sectionCount       = Object.keys(rules.sectionRules).length
    const ruleCount          = Object.values(rules.sectionRules).reduce((n, arr) => n + arr.length, 0)
    const crossCuttingCount  = rules.crossCuttingRules.length
    await app.audit.append({
      timestamp:  new Date().toISOString(),
      actorId:    request.user!.id,
      action:     'ai_prompt.section_rules_extracted',
      entityType: 'ai_prompt_record',
      entityId:   row.id,
      details:    { docType: row.docType, version: row.version, sectionCount, ruleCount, crossCuttingCount, engine: apiKey ? engine.default : 'stub' },
      ipAddress:  request.ip ?? null,
    })
    return {
      crossCuttingRules: rules.crossCuttingRules,
      sectionRules:      rules.sectionRules,
      crossCuttingCount, sectionCount, ruleCount,
    }
  })
}
