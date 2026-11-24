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
import { resolveAiEngineSettings } from '../config/ai-engine-settings.js'
import { resolveAnthropicKey } from '../ai-gateway/resolve-anthropic-key.js'
import {
  bumpVersionSchema,
  createPolicySchema,
  retireSchema,
  requirementsOf,
  updatePolicySchema,
} from './schema.js'
import {
  DocumentTypePolicyService,
  PolicyServiceError,
  digestOf,
  sectionRulesOf,
} from './service.js'
import { resolvePolicyAssets } from './resolve-assets.js'
import { extractSectionRulesWithClaude, buildStubSectionRules } from './ai-extract-section-rules.js'

// Admin writes to policy rows (create / update / bump / BP distill) are
// pointless when the platform has no AI configured — the prompts never
// reach a model. Refuse early with a dedicated 503 so the admin screens
// can surface an inline "Set up AI first" CTA rather than looking like
// a generic server error.
const AI_NOT_CONFIGURED = {
  error:   'ai_not_configured',
  message: 'Set up an AI engine (API key) before editing policies — prompts here never reach a model until AI is configured.',
  setupPath: '/admin',
} as const

// Reads open to any authenticated user — the wizard preview and the
// section-context endpoint both consume policy data for authoring.
// Writes locked to PM: the 2026-11-10 role model separates IT Admin
// (system operator, no content rights) from PM (content admin).
const readGate  = requireAuth({})
const writeGate = requireAuth({ roles: ['pm'] })

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
  ichFrameworkNames:   string[]
  requirements:        unknown
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
    // Legacy single-value field kept for one transition release; UI now
    // consumes ichFrameworkNames (array). Dropped in a follow-up.
    ichFramework:        row.ichFramework,
    ichFrameworkNames:   row.ichFrameworkNames,
    requirements:        requirementsOf(row),
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

  // Checks the default AI engine has credentials before letting an
  // admin write to a policy. Reads are never gated — the wizard preview
  // and admin screens need to render even in a no-AI state so the
  // "Set up AI" banner knows what to recommend.
  async function assertAiReady(): Promise<boolean> {
    const engine = await resolveAiEngineSettings(app.prisma)
    return app.aiGateway.isConfigured(engine.default)
  }

  // GET /document-type-policies — list every current policy.
  // Each policy's response carries `resolved: { template, checklist }`
  // so the admin UI can render auto-match chips without a separate
  // per-row query. See resolve-assets.ts for the matching rules.
  app.get('/', { preHandler: readGate }, async () => {
    const rows = await svc.listAllCurrent()
    const policies = await Promise.all(rows.map(async r => ({
      ...shape(r as PolicyRow),
      resolved: await resolvePolicyAssets(app.prisma, r as PolicyRow),
    })))
    return { policies }
  })

  // GET /document-type-policies/:docType — current policy for a doc type.
  // Response shape includes `resolved` (see list route above).
  app.get('/:docType', { preHandler: readGate }, async (request, reply) => {
    const { docType } = request.params as { docType: string }
    const row = await svc.getCurrent(docType)
    if (!row) return reply.code(404).send({ error: 'not_found', message: `No current policy for '${docType}'` })
    const resolved = await resolvePolicyAssets(app.prisma, row as PolicyRow)
    return { ...shape(row as PolicyRow), resolved }
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
    if (!(await assertAiReady())) return reply.code(503).send(AI_NOT_CONFIGURED)
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
    if (!(await assertAiReady())) return reply.code(503).send(AI_NOT_CONFIGURED)
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
    if (!(await assertAiReady())) return reply.code(503).send(AI_NOT_CONFIGURED)
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

  // POST /document-type-policies/:docType/distill-best-practice — RETIRED.
  // BP is author guidance now, not AI steering (M-F.1). SectionTemplate
  // (migration 90) carries the per-section formatting rules the model
  // used to pick up from BP's structured principles.
  app.post('/:docType/distill-best-practice', { preHandler: writeGate }, async (_request, reply) =>
    reply.code(410).send({
      error:   'bp_distill_retired',
      message: 'Best-Practice distillation is retired. BP is now author guidance only — use the Best Practices tab to curate user-facing content. Formatting hints that used to flow through BP are now modelled as Section Templates (admin panel → Section Templates).',
    }),
  )

  // POST /document-type-policies/:docType/distill-best-practice-file —
  // RETIRED. See /distill-best-practice tombstone above for rationale.
  app.post('/:docType/distill-best-practice-file', { preHandler: writeGate }, async (_request, reply) =>
    reply.code(410).send({
      error:   'bp_distill_retired',
      message: 'Best-Practice distillation is retired. BP is now author guidance only. Formatting hints that used to flow through BP are now modelled as Section Templates.',
    }),
  )

  // POST /document-type-policies/:docType/extract-section-rules —
  // run the SME prompt through Claude and get back a sectionRules JSON
  // object. Does NOT write to the policy automatically — returns the
  // extracted shape so the admin reviews the draft, edits, then clicks
  // Save on the policy editor to persist. Keeps the human-in-the-loop
  // step that the BP distiller's auto-write skips (BP writes straight to
  // the digest because PDFs are vetted source documents; the SME prompt
  // is admin free-text and the extractor is best-effort inference).
  app.post('/:docType/extract-section-rules', { preHandler: writeGate }, async (request, reply) => {
    if (!(await assertAiReady())) return reply.code(503).send(AI_NOT_CONFIGURED)
    const { docType } = request.params as { docType: string }

    const policy = await svc.getCurrent(docType)
    if (!policy) return reply.code(404).send({ error: 'no_current_policy' })
    if (!policy.smePrompt.trim()) {
      return reply.code(422).send({
        error:   'empty_sme_prompt',
        message: 'Nothing to extract from — this policy has no SME prompt yet. Save a prompt first, then try again.',
      })
    }

    const engine = await resolveAiEngineSettings(app.prisma)
    // DB-only key lookup — admin pastes via Settings → AI engine → API keys.
    const apiKey = await resolveAnthropicKey(app.prisma)
    const stubAllowed = process.env.AI_ALLOW_STUB === '1'

    let rules: Awaited<ReturnType<typeof extractSectionRulesWithClaude>>
    try {
      rules = apiKey
        ? await extractSectionRulesWithClaude({
            prisma:    app.prisma,
            docType:   policy.docType,
            smePrompt: policy.smePrompt,
            model:     engine.default,
            apiKey,
          })
        : stubAllowed
          ? buildStubSectionRules()
          : (() => { throw new Error('ai_not_configured') })()
    } catch (err) {
      app.log.warn({ err, docType }, 'section-rules extract: Claude call failed')
      return reply.code(502).send({
        error:   'ai_call_failed',
        message: err instanceof Error ? err.message : 'AI extraction failed',
      })
    }

    const sectionCount      = Object.keys(rules.sectionRules).length
    const ruleCount         = Object.values(rules.sectionRules).reduce((n, arr) => n + arr.length, 0)
    const crossCuttingCount = rules.crossCuttingRules.length

    await app.audit.append({
      timestamp:  new Date().toISOString(),
      actorId:    request.user!.id,
      action:     'document_type_policy.section_rules_extracted',
      entityType: 'document_type_policy',
      entityId:   policy.id,
      details:    {
        docType, version: policy.version, sectionCount, ruleCount, crossCuttingCount,
        extractionEngine: apiKey ? engine.default : 'stub',
      },
      ipAddress:  request.ip ?? null,
    })

    return {
      crossCuttingRules: rules.crossCuttingRules,
      sectionRules:      rules.sectionRules,
      crossCuttingCount, sectionCount, ruleCount,
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
