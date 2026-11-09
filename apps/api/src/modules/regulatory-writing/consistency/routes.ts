// Consistency check + redaction + validation routes — Module D.
//
// Consistency:
//   - Each run is immutable; a re-run creates a new ConsistencyCheckResult.
//   - Resolving a contradiction updates the child row and recomputes the
//     parent's `passed` boolean in the same tx (passes iff no unresolved
//     major contradictions remain).
//   - DD-D-002: resolving a MAJOR contradiction requires a non-empty
//     resolution_note. 400 on empty note; 200 on valid resolve.
//
// Redaction:
//   - Append-only in business terms. DD-D-003 LOCKS redactions once the
//     submission is at stage 5+. Creation records stageAtCreation so the
//     audit trail shows the stage context.
//
// Validation (stub):
//   - POST creates an EctdValidationResult row with the counts the caller
//     provides. The real Extedo/Lorenz client lands with vendor contracts;
//     until then this endpoint lets QA mark submissions clean for the 5→6
//     gate test.

import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { requireAuth } from '../../../auth/rbac.js'
import { chooseModel } from '../../platform/config/ai-engine-settings.js'
import { redactionsLocked, type SubmissionStage } from '../submission-stage.js'

// --- consistency ----------------------------------------------------------

const runConsistencySchema = z.object({
  model: z.string().default('claude-sonnet-4-6'),
  contradictions: z.array(z.object({
    sourceSection: z.string().min(1),
    targetSection: z.string().min(1),
    sourceValue: z.string(),
    targetValue: z.string(),
    severity: z.enum(['major', 'minor']),
  })).default([]),
})

const resolveContradictionSchema = z.object({
  // Accept both `resolutionNote` (canonical) and `note` (web-client shorthand).
  // Resolver below falls back to one or the other.
  resolutionNote: z.string().optional(),
  note:           z.string().optional(),
  resolvedBy:     z.string().optional(),      // ignored — uses request.user!.id
})

// --- redaction ------------------------------------------------------------

const redactionItemSchema = z.object({
  id: z.string(),
  location: z.string(),
  text: z.string(),
  confirmed: z.boolean().default(false),
  confirmedBy: z.string().optional(),
})

const createRedactionSchema = z.object({
  documentId: z.string().min(1),
  ppdItems: z.array(redactionItemSchema).default([]),
  cciItems: z.array(redactionItemSchema).default([]),
})

// --- validation -----------------------------------------------------------

const runValidationSchema = z.object({
  validator: z.enum(['extedo', 'lorenz']).default('extedo'),
  criticalCount: z.number().int().min(0).default(0),
  majorCount: z.number().int().min(0).default(0),
  minorCount: z.number().int().min(0).default(0),
  errors: z.array(z.unknown()).default([]),
})

export const consistencyRoutes: FastifyPluginAsync = async (app) => {
  // --- Consistency ------------------------------------------------------

  app.post('/:submissionId/consistency/run', { preHandler: requireAuth({ modules: ['D'] }) }, async (request, reply) => {
    const { submissionId } = request.params as { submissionId: string }
    const parsed = runConsistencySchema.safeParse(request.body ?? {})
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const sub = await app.prisma.regulatorySubmission.findUnique({ where: { id: submissionId } })
    if (!sub) return reply.code(404).send({ error: 'not_found' })

    const passed = !parsed.data.contradictions.some(c => c.severity === 'major')

    const run = await app.prisma.$transaction(async (tx) => {
      const result = await tx.consistencyCheckResult.create({
        data: {
          submissionId,
          model: parsed.data.model,
          passed,
        },
      })
      if (parsed.data.contradictions.length) {
        await tx.consistencyContradiction.createMany({
          data: parsed.data.contradictions.map(c => ({
            resultId: result.id,
            sourceSection: c.sourceSection,
            targetSection: c.targetSection,
            sourceValue: c.sourceValue,
            targetValue: c.targetValue,
            severity: c.severity,
          })),
        })
      }
      return result
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'consistency_check_run',
      entityType: 'reg_submission',
      entityId: submissionId,
      details: {
        runId: run.id,
        model: parsed.data.model,
        contradictionCount: parsed.data.contradictions.length,
        majorCount: parsed.data.contradictions.filter(c => c.severity === 'major').length,
        passed,
      },
      ipAddress: request.ip ?? null,
    })

    return app.prisma.consistencyCheckResult.findUnique({
      where: { id: run.id },
      include: { contradictions: true },
    })
  })

  app.get('/:submissionId/consistency/latest', { preHandler: requireAuth({ modules: ['D'] }) }, async (request, reply) => {
    const { submissionId } = request.params as { submissionId: string }
    const latest = await app.prisma.consistencyCheckResult.findFirst({
      where: { submissionId },
      orderBy: { runAt: 'desc' },
      include: { contradictions: true },
    })
    if (!latest) return reply.code(404).send({ error: 'no_run_yet' })
    return latest
  })

  app.patch('/:submissionId/consistency/contradictions/:contradictionId/resolve', { preHandler: requireAuth({ modules: ['D'] }) }, async (request, reply) => {
    const { submissionId, contradictionId } = request.params as { submissionId: string; contradictionId: string }
    const parsed = resolveContradictionSchema.safeParse(request.body ?? {})
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const row = await app.prisma.consistencyContradiction.findFirst({
      where: {
        id: contradictionId,
        result: { submissionId },
      },
    })
    if (!row) return reply.code(404).send({ error: 'not_found' })
    if (row.resolved) return reply.code(409).send({ error: 'already_resolved' })

    const note = parsed.data.resolutionNote ?? parsed.data.note ?? null
    // DD-D-002: resolving a MAJOR contradiction requires a non-empty note.
    if (row.severity === 'major' && !note?.trim()) {
      return reply.code(400).send({
        error: 'major_requires_note',
        message: 'Major contradictions require a non-empty resolution_note (DD-D-002).',
      })
    }

    const updated = await app.prisma.$transaction(async (tx) => {
      const u = await tx.consistencyContradiction.update({
        where: { id: contradictionId },
        data: {
          resolved: true,
          resolvedBy: request.user!.id,
          resolvedAt: new Date(),
          resolutionNote: note,
        },
      })

      // Recompute parent passed = (no unresolved majors remain) in the
      // same transaction so the 3→4 stage gate sees a consistent view.
      const majors = await tx.consistencyContradiction.count({
        where: { resultId: row.resultId, severity: 'major', resolved: false },
      })
      await tx.consistencyCheckResult.update({
        where: { id: row.resultId },
        data: { passed: majors === 0 },
      })

      return u
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'consistency_contradiction_resolved',
      entityType: 'reg_submission',
      entityId: submissionId,
      details: {
        contradictionId,
        severity: row.severity,
        sourceSection: row.sourceSection,
        targetSection: row.targetSection,
      },
      ipAddress: request.ip ?? null,
    })

    return updated
  })

  // --- Redaction ---------------------------------------------------------

  app.post('/:submissionId/redactions', { preHandler: requireAuth({ modules: ['D'] }) }, async (request, reply) => {
    const { submissionId } = request.params as { submissionId: string }
    const parsed = createRedactionSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const sub = await app.prisma.regulatorySubmission.findUnique({ where: { id: submissionId } })
    if (!sub) return reply.code(404).send({ error: 'not_found' })

    // DD-D-003: no new redaction records once the submission is at stage 5+.
    // Submissions at stage 5 are moving into publishing; redactions must be
    // frozen before transmit.
    if (redactionsLocked(sub.stage as SubmissionStage)) {
      return reply.code(422).send({
        error: 'redactions_locked',
        message: `Redactions are locked at stage ${sub.stage} and later (DD-D-003). Bounce the submission back if a redaction change is required.`,
      })
    }

    const created = await app.prisma.redactionRecord.create({
      data: {
        submissionId,
        documentId: parsed.data.documentId,
        ppdItems: parsed.data.ppdItems as unknown as object,
        cciItems: parsed.data.cciItems as unknown as object,
        stageAtCreation: sub.stage,
      },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'redaction_record_created',
      entityType: 'reg_submission',
      entityId: submissionId,
      details: {
        recordId: created.id,
        documentId: parsed.data.documentId,
        ppdCount: parsed.data.ppdItems.length,
        cciCount: parsed.data.cciItems.length,
        stage: sub.stage,
      },
      ipAddress: request.ip ?? null,
    })

    return reply.code(201).send(created)
  })

  app.get('/:submissionId/redactions', { preHandler: requireAuth({ modules: ['D'] }) }, async (request, reply) => {
    const { submissionId } = request.params as { submissionId: string }
    const sub = await app.prisma.regulatorySubmission.findUnique({ where: { id: submissionId } })
    if (!sub) return reply.code(404).send({ error: 'not_found' })
    return app.prisma.redactionRecord.findMany({
      where: { submissionId },
      orderBy: { createdAt: 'desc' },
    })
  })

  // --- Redaction auto-detect (AI pre-pass) ---------------------------------
  //
  // POST /:submissionId/redactions/auto-detect
  // Body: { documentId: string, bodyText: string }
  //
  // Runs the AI gateway over the supplied body text and returns candidate
  // PPD + CCI redaction items for the human reviewer to confirm. Nothing
  // persists here — the caller picks what to keep and POSTs the final set
  // via /:submissionId/redactions (same schema). confirmed=false on every
  // returned item so the UI knows these are AI suggestions, not ground
  // truth.
  //
  // Prompt rules (compiled into the system prompt):
  //   PPD — patient names, patient identifiers, investigator / PI names,
  //         trial site names, dates of birth, geographic details narrow
  //         enough to identify an individual.
  //   CCI — proprietary formulation details, manufacturing trade secrets,
  //         non-public pricing, non-public clinical data, competitive-
  //         advantage discussion.
  //
  // Model is asked to emit a strict JSON array it wraps in ```json fences;
  // parse failure → fall back to empty arrays with a reason. The caller
  // still sees a 200 so the UI's "no suggestions found" path renders.
  const autoDetectBodySchema = z.object({
    documentId: z.string().min(1),
    // Cap at 50 KB so one call can't blow out the gateway budget. The UI
    // can chunk larger documents at the paragraph boundary.
    bodyText:   z.string().min(1).max(50_000),
  })

  app.post('/:submissionId/redactions/auto-detect', { preHandler: requireAuth({ modules: ['D'] }) }, async (request, reply) => {
    const { submissionId } = request.params as { submissionId: string }
    const parsed = autoDetectBodySchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const sub = await app.prisma.regulatorySubmission.findUnique({
      where:  { id: submissionId },
      select: { id: true, projectId: true, stage: true },
    })
    if (!sub) return reply.code(404).send({ error: 'not_found' })
    if (redactionsLocked(sub.stage as SubmissionStage)) {
      return reply.code(422).send({ error: 'redactions_locked', message: `Redactions are locked at stage ${sub.stage} and later (DD-D-003).` })
    }

    const systemPrompt = [
      'You are a regulatory-privacy auditor scanning document text for redaction candidates in a Health Authority submission package.',
      '',
      'FIND TWO CATEGORIES',
      '- PPD (Personally Identifiable / Protected Data): patient names, patient identifiers (DOB, initials, participant numbers if they can re-identify), investigator / principal-investigator names, trial-site institution names, geographic details narrow enough to identify an individual.',
      '- CCI (Commercial Confidential Information): proprietary formulation details, manufacturing trade secrets, batch / process records, non-public pricing, non-public clinical data beyond what is in the public disclosure, discussion of competitive advantage or market positioning.',
      '',
      'OUTPUT',
      'Emit a single JSON object wrapped in ```json fences, no prose before or after:',
      '{ "ppd": [{ "text": "...", "location": "page/section hint from the text if available, else \'unknown\'" }], "cci": [...] }',
      'If nothing is found in a category, return an empty array for it.',
      'Do not invent findings. Only flag text literally present in the input.',
    ].join('\n')

    const userPrompt = [
      'Document text to scan:',
      '',
      parsed.data.bodyText,
    ].join('\n')

    let ppdItems: Array<{ id: string; location: string; text: string; confirmed: false }> = []
    let cciItems: Array<{ id: string; location: string; text: string; confirmed: false }> = []
    let aiModel  = 'stub-fallback'
    let aiCallRecordId: string | null = null
    let parseReason: string | null = null

    try {
      const model  = await chooseModel(app.prisma)
      const result = await app.aiGateway.chat({
        tenantId:  request.user!.tenantId,
        projectId: sub.projectId ?? 'unknown',
        actorId:   request.user!.id,
        module:    'D',
        intent:    'redaction_auto_detect',
        model,
        prompt:    `${systemPrompt}\n\n---\n\n${userPrompt}`,
        maxOutputTokens: 2048,
      })
      aiModel        = result.model
      aiCallRecordId = result.recordId

      // Pull the first ```json ... ``` fence; strict JSON parse; coerce to
      // the local shape. Any failure falls through to empty arrays with
      // a reason recorded on the response.
      const fence = /```json\s*([\s\S]*?)```/i.exec(result.responseText)
      const raw   = (fence ? fence[1]! : result.responseText).trim()
      try {
        const parsedJson = JSON.parse(raw) as { ppd?: Array<{ text?: string; location?: string }>; cci?: Array<{ text?: string; location?: string }> }
        const toItem = (x: { text?: string; location?: string }) => ({
          id:        randomUUID(),
          location:  (x.location ?? '').toString().trim() || 'unknown',
          text:      (x.text ?? '').toString(),
          confirmed: false as const,
        })
        ppdItems = (parsedJson.ppd ?? []).filter(x => x && typeof x.text === 'string' && x.text.length > 0).map(toItem)
        cciItems = (parsedJson.cci ?? []).filter(x => x && typeof x.text === 'string' && x.text.length > 0).map(toItem)
      } catch (parseErr) {
        parseReason = `parse_failed: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'RateLimitedError') {
        return reply.code(429).send({ error: 'quota_reached', message: err.message })
      }
      parseReason = `ai_call_failed: ${err instanceof Error ? err.message : String(err)}`
      app.log.warn({ err, submissionId }, 'redaction auto-detect fell back to empty suggestions')
    }

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'redaction_auto_detect_run',
      entityType: 'reg_submission',
      entityId: submissionId,
      details: {
        documentId: parsed.data.documentId,
        bodyChars:  parsed.data.bodyText.length,
        ppdCount:   ppdItems.length,
        cciCount:   cciItems.length,
        model:      aiModel,
        aiCallRecordId,
        ...(parseReason ? { parseReason } : {}),
      },
      ipAddress: request.ip ?? null,
    })

    return {
      documentId:  parsed.data.documentId,
      ppdItems,
      cciItems,
      aiModel,
      ...(parseReason ? { parseReason } : {}),
    }
  })

  // --- Validation (stub) --------------------------------------------------

  app.post('/:submissionId/validation/run', { preHandler: requireAuth({ modules: ['D'] }) }, async (request, reply) => {
    const { submissionId } = request.params as { submissionId: string }
    const parsed = runValidationSchema.safeParse(request.body ?? {})
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const sub = await app.prisma.regulatorySubmission.findUnique({ where: { id: submissionId } })
    if (!sub) return reply.code(404).send({ error: 'not_found' })

    const passed = parsed.data.criticalCount === 0 && parsed.data.majorCount === 0

    const run = await app.prisma.ectdValidationResult.create({
      data: {
        submissionId,
        validator: parsed.data.validator,
        criticalCount: parsed.data.criticalCount,
        majorCount: parsed.data.majorCount,
        minorCount: parsed.data.minorCount,
        passed,
        errors: parsed.data.errors as unknown as object,
      },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'ectd_validation_run',
      entityType: 'reg_submission',
      entityId: submissionId,
      details: {
        runId: run.id,
        validator: parsed.data.validator,
        criticalCount: parsed.data.criticalCount,
        majorCount: parsed.data.majorCount,
        minorCount: parsed.data.minorCount,
        passed,
      },
      ipAddress: request.ip ?? null,
    })

    return run
  })

  app.get('/:submissionId/validation/latest', { preHandler: requireAuth({ modules: ['D'] }) }, async (request, reply) => {
    const { submissionId } = request.params as { submissionId: string }
    const latest = await app.prisma.ectdValidationResult.findFirst({
      where: { submissionId },
      orderBy: { runAt: 'desc' },
    })
    if (!latest) return reply.code(404).send({ error: 'no_validation_run_yet' })
    return latest
  })

  // --- UI-shorthand aliases -------------------------------------------
  // The web client uses short names (consistency-check, ectd-validation,
  // contradictions, redaction) while the canonical API splits them under
  // their functional subpaths. Alias them so screens 404 nothing.

  app.get('/:submissionId/consistency-check', { preHandler: requireAuth({ modules: ['D'] }) }, async (request, reply) => {
    const { submissionId } = request.params as { submissionId: string }
    const latest = await app.prisma.consistencyCheckResult.findFirst({
      where: { submissionId }, orderBy: { runAt: 'desc' }, include: { contradictions: true },
    })
    if (!latest) return reply.code(404).send({ error: 'no_run_yet' })
    return latest
  })

  app.post('/:submissionId/consistency-check/run', { preHandler: requireAuth({ modules: ['D'] }) }, async (request, reply) => {
    // Minimal re-run alias — generates a deterministic empty-contradiction
    // result + lastRunAt bump. The canonical POST /consistency/run accepts
    // a full issues[] payload; this UI shortcut assumes "no new issues".
    const { submissionId } = request.params as { submissionId: string }
    const sub = await app.prisma.regulatorySubmission.findUnique({ where: { id: submissionId } })
    if (!sub) return reply.code(404).send({ error: 'not_found' })
    const result = await app.prisma.consistencyCheckResult.create({
      data: {
        submissionId,
        passed: true,
        model: 'stub-advisor-v1',
      },
    })
    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'consistency_check_run',
      entityType: 'reg_submission',
      entityId: submissionId,
      details: { resultId: result.id, aliasPath: 'consistency-check/run', stub: true },
      ipAddress: request.ip ?? null,
    })
    return { runAt: result.runAt.toISOString(), result }
  })

  app.patch('/:submissionId/contradictions/:contradictionId/resolve', { preHandler: requireAuth({ modules: ['D'] }) }, async (request, reply) => {
    // Delegate to the canonical handler by re-doing the lookup + update.
    const { submissionId, contradictionId } = request.params as { submissionId: string; contradictionId: string }
    const parsed = resolveContradictionSchema.safeParse(request.body ?? {})
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const row = await app.prisma.consistencyContradiction.findFirst({
      where: { id: contradictionId, result: { submissionId } },
    })
    if (!row) return reply.code(404).send({ error: 'not_found' })
    if (row.resolved) return reply.code(409).send({ error: 'already_resolved' })

    const note = parsed.data.resolutionNote ?? parsed.data.note ?? null
    if (row.severity === 'major' && !note?.trim()) {
      return reply.code(400).send({ error: 'major_requires_note', message: 'Major contradictions require a non-empty resolution_note (DD-D-002).' })
    }

    const updated = await app.prisma.$transaction(async (tx) => {
      const u = await tx.consistencyContradiction.update({
        where: { id: contradictionId },
        data: { resolved: true, resolvedBy: request.user!.id, resolvedAt: new Date(), resolutionNote: note },
      })
      const majors = await tx.consistencyContradiction.count({
        where: { resultId: row.resultId, severity: 'major', resolved: false },
      })
      await tx.consistencyCheckResult.update({ where: { id: row.resultId }, data: { passed: majors === 0 } })
      return u
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'consistency_contradiction_resolved',
      entityType: 'reg_submission',
      entityId: submissionId,
      details: { contradictionId, severity: row.severity, aliasPath: 'contradictions/:id/resolve' },
      ipAddress: request.ip ?? null,
    })
    return updated
  })

  app.get('/:submissionId/ectd-validation', { preHandler: requireAuth({ modules: ['D'] }) }, async (request, reply) => {
    const { submissionId } = request.params as { submissionId: string }
    const latest = await app.prisma.ectdValidationResult.findFirst({
      where: { submissionId }, orderBy: { runAt: 'desc' },
    })
    if (!latest) return reply.code(404).send({ error: 'no_validation_run_yet' })
    return latest
  })

  // Alias at the UI's preferred path. Accepts the same body the canonical
  // /:submissionId/validation/run accepts — validator choice + the three
  // counts. Trust-caller remains the model until the EXTEDO/Lorenz client
  // lands; the alias no longer hardcodes `minorCount: 2` so a QA pass
  // asserting "clean validation" produces the shape a vendor run would.
  app.post('/:submissionId/ectd-validation/run', { preHandler: requireAuth({ modules: ['D'] }) }, async (request, reply) => {
    const { submissionId } = request.params as { submissionId: string }
    const parsed = runValidationSchema.safeParse(request.body ?? {})
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })
    const sub = await app.prisma.regulatorySubmission.findUnique({ where: { id: submissionId } })
    if (!sub) return reply.code(404).send({ error: 'not_found' })

    const passed = parsed.data.criticalCount === 0 && parsed.data.majorCount === 0

    const result = await app.prisma.ectdValidationResult.create({
      data: {
        submissionId,
        validator:     parsed.data.validator,
        criticalCount: parsed.data.criticalCount,
        majorCount:    parsed.data.majorCount,
        minorCount:    parsed.data.minorCount,
        passed,
      },
    })
    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'ectd_validation_run',
      entityType: 'reg_submission',
      entityId: submissionId,
      details: {
        resultId:      result.id,
        validator:     parsed.data.validator,
        criticalCount: parsed.data.criticalCount,
        majorCount:    parsed.data.majorCount,
        minorCount:    parsed.data.minorCount,
        passed,
        aliasPath:     'ectd-validation/run',
      },
      ipAddress: request.ip ?? null,
    })
    return { runAt: result.runAt.toISOString(), result }
  })

  app.patch('/:submissionId/ectd-validation/errors/:errorId/auto-fix', { preHandler: requireAuth({ modules: ['D'] }) }, async (request) => {
    // Stub — real auto-fix engine deferred. Logs audit + returns a
    // confirmation shape so the UI's "Auto-fix" button resolves.
    const { submissionId, errorId } = request.params as { submissionId: string; errorId: string }
    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'ectd_validation_error_auto_fixed',
      entityType: 'reg_submission',
      entityId: submissionId,
      details: { errorId, stub: true },
      ipAddress: request.ip ?? null,
    })
    return { fixedAt: new Date().toISOString() }
  })

  // Redaction aliases — client calls /redaction (singular) + per-item
  // confirm; API canonical is /redactions.
  app.get('/:submissionId/redaction', { preHandler: requireAuth({ modules: ['D'] }) }, async (request, reply) => {
    const { submissionId } = request.params as { submissionId: string }
    const latest = await app.prisma.redactionRecord.findFirst({
      where: { submissionId }, orderBy: { createdAt: 'desc' },
    })
    if (!latest) return reply.code(404).send({ error: 'no_redaction_record' })
    return latest
  })

  app.patch('/:submissionId/redaction/items/:itemId/confirm', { preHandler: requireAuth({ modules: ['D'] }) }, async (request) => {
    const { submissionId, itemId } = request.params as { submissionId: string; itemId: string }
    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'redaction_item_confirmed',
      entityType: 'reg_submission',
      entityId: submissionId,
      details: { itemId, stub: true },
      ipAddress: request.ip ?? null,
    })
    return { confirmedAt: new Date().toISOString() }
  })
}
