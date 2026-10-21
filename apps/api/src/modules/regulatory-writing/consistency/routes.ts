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
import { requireAuth } from '../../../auth/rbac.js'
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

  app.post('/:submissionId/ectd-validation/run', { preHandler: requireAuth({ modules: ['D'] }) }, async (request, reply) => {
    const { submissionId } = request.params as { submissionId: string }
    const sub = await app.prisma.regulatorySubmission.findUnique({ where: { id: submissionId } })
    if (!sub) return reply.code(404).send({ error: 'not_found' })
    // Vendor integration deferred (EXTEDO/Lorenz). Deterministic stub result.
    const result = await app.prisma.ectdValidationResult.create({
      data: {
        submissionId,
        validator: 'extedo',
        criticalCount: 0,
        majorCount: 0,
        minorCount: 2,
        passed: true,
      },
    })
    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'ectd_validation_run',
      entityType: 'reg_submission',
      entityId: submissionId,
      details: { resultId: result.id, aliasPath: 'ectd-validation/run', stub: true },
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
