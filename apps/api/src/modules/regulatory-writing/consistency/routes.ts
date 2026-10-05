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
  resolutionNote: z.string().optional(),      // required for major via refine below
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

    // DD-D-002: resolving a MAJOR contradiction requires a non-empty note.
    if (row.severity === 'major' && !parsed.data.resolutionNote?.trim()) {
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
          resolutionNote: parsed.data.resolutionNote ?? null,
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
}
