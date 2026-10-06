// Pre-MLR + FK score routes — Module C (API contract §33-§34).
//
// Design:
//   - Pre-MLR runs are rows in pre_mlr_check_results with child pre_mlr_issues.
//     Each run is immutable; a re-run creates a new row (history preserved).
//     passed = (must_fix_count == 0) is service-computed and mirrored in a
//     stored Boolean column (Prisma can't express GENERATED columns).
//   - FK score rows are append-only and the latest row is the source of truth
//     for the stage-3→4 patient-facing gate (enforced in content/routes.ts).
//   - Must-fix issues cannot be acknowledged — they must be fixed. Should-fix
//     and note can be acknowledged with 'ack=true'.
//
// Not landed here (bigger scope — see memory project_phase_3c_deferrals):
//   - Agentic report generation (needs Anthropic key).
//   - MLR comments + decision workflow.

import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { requireAuth } from '../../../auth/rbac.js'

const PATIENT_FACING_TYPES: ReadonlySet<string> = new Set([
  'pil', 'pls_eu_ctr', 'patient_education',
])

const runPreMlrSchema = z.object({
  // Clients can inject known issues (e.g. from a client-side linter); the
  // route also seeds a deterministic baseline so the UI always has something.
  issues: z.array(z.object({
    severity: z.enum(['must_fix', 'should_fix', 'note']),
    slide: z.string().optional(),
    title: z.string().min(1),
    detail: z.string().min(1),
    suggestedFix: z.string().optional(),
  })).optional(),
})

const fkScoreSchema = z.object({
  score: z.number().min(0).max(20),
  bySection: z.array(z.object({
    sectionId: z.string(),
    sectionLabel: z.string(),
    score: z.number().min(0).max(20),
  })).default([]),
})

// Shape helpers for the UI's packages/types PreMLRResult + PreMLRIssue.
// Two vocab/shape differences to reconcile:
//   - severity: Prisma uses must_fix / should_fix / note (underscore);
//     UI's PreMLRSeverity is 'must-fix' / 'should-fix' / 'note' (hyphen).
//   - auditEntryId: UI treats it as a required string field on PreMLRResult
//     (not nullable). The audit module's append() returns { id }, so when
//     the run handler emits a fresh result it threads that id back on the
//     response. For reads where the id wasn't captured at insert time, we
//     fall back to '' — the UI treats empty as "no linked audit entry".
const SEVERITY_TO_UI: Record<string, 'must-fix' | 'should-fix' | 'note'> = {
  must_fix: 'must-fix',
  should_fix: 'should-fix',
  note: 'note',
}

function preMlrIssueShape(i: {
  id: string
  severity: string
  slide: string | null
  title: string
  detail: string
  suggestedFix: string | null
  acknowledged: boolean
  acknowledgedBy: string | null
  acknowledgedAt: Date | null
}) {
  return {
    id: i.id,
    severity: SEVERITY_TO_UI[i.severity] ?? 'note',
    slide: i.slide,
    title: i.title,
    detail: i.detail,
    suggestedFix: i.suggestedFix,
    acknowledged: i.acknowledged,
    acknowledgedBy: i.acknowledgedBy,
    acknowledgedAt: i.acknowledgedAt ? i.acknowledgedAt.toISOString() : null,
  }
}

function preMlrResultShape(
  r: {
    id: string
    contentItemId: string
    runAt: Date
    mustFixCount: number
    shouldFixCount: number
    noteCount: number
    passed: boolean
    runBy: string
    issues: Parameters<typeof preMlrIssueShape>[0][]
  },
  auditEntryId: string,
) {
  return {
    id: r.id,
    contentItemId: r.contentItemId,
    runAt: r.runAt.toISOString(),
    mustFixCount: r.mustFixCount,
    shouldFixCount: r.shouldFixCount,
    noteCount: r.noteCount,
    passed: r.passed,
    runBy: r.runBy,
    auditEntryId,
    issues: r.issues.map(preMlrIssueShape),
  }
}

export const preMlrRoutes: FastifyPluginAsync = async (app) => {
  app.post('/:contentId/pre-mlr/run', { preHandler: requireAuth({ modules: ['C'] }) }, async (request, reply) => {
    const { contentId } = request.params as { contentId: string }
    const parsed = runPreMlrSchema.safeParse(request.body ?? {})
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const item = await app.prisma.medContentItem.findUnique({ where: { id: contentId } })
    if (!item) return reply.code(404).send({ error: 'not_found' })

    // Phase 3C baseline: if the client didn't supply issues, seed a short
    // deterministic set so the UI has something to render. The real linter
    // + agentic report fills this out when the Anthropic connector lands.
    const issues = parsed.data.issues ?? [
      {
        severity: 'should_fix',
        slide: null,
        title: 'Confirm claims are source-linked',
        detail: 'Every claim should link to an approved source reference.',
        suggestedFix: 'Open the claims matrix and verify source_ref is populated.',
      },
      {
        severity: 'note',
        slide: null,
        title: 'FK score pending',
        detail: 'Patient-facing content requires an FK readability check before MLR submission.',
        suggestedFix: 'POST /fk-score with the computed Flesch-Kincaid grade.',
      },
    ]

    const counts = {
      must_fix: issues.filter(i => i.severity === 'must_fix').length,
      should_fix: issues.filter(i => i.severity === 'should_fix').length,
      note: issues.filter(i => i.severity === 'note').length,
    }

    const run = await app.prisma.$transaction(async (tx) => {
      const created = await tx.preMlrCheckResult.create({
        data: {
          contentItemId: contentId,
          mustFixCount: counts.must_fix,
          shouldFixCount: counts.should_fix,
          noteCount: counts.note,
          passed: counts.must_fix === 0,
          runBy: request.user!.id,
        },
      })
      await tx.preMlrIssue.createMany({
        data: issues.map(i => ({
          checkResultId: created.id,
          severity: i.severity,
          slide: i.slide ?? null,
          title: i.title,
          detail: i.detail,
          suggestedFix: i.suggestedFix ?? null,
        })),
      })
      return created
    })

    const auditEntry = await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'pre_mlr_check_run',
      entityType: 'med_content',
      entityId: contentId,
      details: {
        runId: run.id,
        passed: run.passed,
        counts,
      },
      ipAddress: request.ip ?? null,
    })

    const full = await app.prisma.preMlrCheckResult.findUniqueOrThrow({
      where: { id: run.id },
      include: { issues: true },
    })
    return preMlrResultShape(full, auditEntry.id)
  })

  app.get('/:contentId/pre-mlr/latest', { preHandler: requireAuth({ modules: ['C'] }) }, async (request, reply) => {
    const { contentId } = request.params as { contentId: string }
    const latest = await app.prisma.preMlrCheckResult.findFirst({
      where: { contentItemId: contentId },
      orderBy: { runAt: 'desc' },
      include: { issues: true },
    })
    if (!latest) return reply.code(404).send({ error: 'no_pre_mlr_run_yet' })
    // auditEntryId not persisted on the row; empty string is the UI's
    // "no linked audit entry" sentinel until we land a column for it.
    return preMlrResultShape(latest, '')
  })

  app.patch('/:contentId/pre-mlr/issues/:issueId/acknowledge', { preHandler: requireAuth({ modules: ['C'] }) }, async (request, reply) => {
    const { contentId, issueId } = request.params as { contentId: string; issueId: string }

    const issue = await app.prisma.preMlrIssue.findFirst({
      where: {
        id: issueId,
        checkResult: { contentItemId: contentId },
      },
    })
    if (!issue) return reply.code(404).send({ error: 'not_found' })

    if (issue.severity === 'must_fix') {
      return reply.code(422).send({
        error: 'must_fix_not_ackable',
        message: 'Must-fix issues must be resolved, not acknowledged. Fix the content and re-run pre-MLR.',
      })
    }
    if (issue.acknowledged) {
      return reply.code(409).send({ error: 'already_acknowledged' })
    }

    const updated = await app.prisma.preMlrIssue.update({
      where: { id: issueId },
      data: {
        acknowledged: true,
        acknowledgedBy: request.user!.id,
        acknowledgedAt: new Date(),
      },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'pre_mlr_issue_acknowledged',
      entityType: 'med_content',
      entityId: contentId,
      details: { issueId, severity: issue.severity, title: issue.title },
      ipAddress: request.ip ?? null,
    })

    return preMlrIssueShape(updated)
  })

  // --- FK score (API contract §33) ----------------------------------------

  app.get('/:contentId/fk-score', { preHandler: requireAuth({ modules: ['C'] }) }, async (request, reply) => {
    const { contentId } = request.params as { contentId: string }
    const item = await app.prisma.medContentItem.findUnique({ where: { id: contentId } })
    if (!item) return reply.code(404).send({ error: 'not_found' })

    // Non-patient-facing types: null score, passed=true so UI can suppress
    // the FK display without needing to inspect the type on the client.
    if (!PATIENT_FACING_TYPES.has(item.type)) {
      return { score: null, passed: true, bySection: [], calculatedAt: null }
    }

    const latest = await app.prisma.fkScoreRecord.findFirst({
      where: { contentItemId: contentId },
      orderBy: { calculatedAt: 'desc' },
    })
    if (!latest) return { score: null, passed: null, bySection: [], calculatedAt: null }
    return latest
  })

  app.post('/:contentId/fk-score', { preHandler: requireAuth({ modules: ['C'] }) }, async (request, reply) => {
    const { contentId } = request.params as { contentId: string }
    const parsed = fkScoreSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const item = await app.prisma.medContentItem.findUnique({ where: { id: contentId } })
    if (!item) return reply.code(404).send({ error: 'not_found' })

    if (!PATIENT_FACING_TYPES.has(item.type)) {
      return reply.code(422).send({
        error: 'not_patient_facing',
        message: `FK score only meaningful for patient-facing content types (got ${item.type})`,
      })
    }

    const passed = parsed.data.score <= 8.0

    const created = await app.prisma.$transaction(async (tx) => {
      const row = await tx.fkScoreRecord.create({
        data: {
          contentItemId: contentId,
          score: parsed.data.score,
          passed,
          bySection: parsed.data.bySection,
        },
      })
      await tx.medContentItem.update({
        where: { id: contentId },
        data: { fkScore: parsed.data.score, fkPassed: passed },
      })
      return row
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'fk_score_calculated',
      entityType: 'med_content',
      entityId: contentId,
      details: { score: parsed.data.score, passed, sectionCount: parsed.data.bySection.length },
      ipAddress: request.ip ?? null,
    })

    return created
  })

  // --- Agentic MLR report (stub) ----------------------------------------
  // API contract §34. The real report is AI-authored and lands when the
  // Anthropic connector ships. Until then this returns a deterministic
  // advisory derived from the pre-MLR issues + claims matrix state so the
  // UI can render the Agentic Report tab in sC06 without an empty state.
  //
  // Gate: latest pre_mlr_check_results.passed must be true (DD-C-002 —
  // agentic report is only generated after pre-MLR passes).

  app.get('/:contentId/agentic-report', { preHandler: requireAuth({ modules: ['C'] }) }, async (request, reply) => {
    const { contentId } = request.params as { contentId: string }

    const content = await app.prisma.medContentItem.findUnique({
      where: { id: contentId },
      include: {
        claims: true,
        preMlrRuns: {
          orderBy: { runAt: 'desc' },
          take: 1,
          include: { issues: true },
        },
      },
    })
    if (!content) return reply.code(404).send({ error: 'not_found' })

    const latest = content.preMlrRuns[0]
    if (!latest) {
      return reply.code(422).send({
        error: 'pre_mlr_required',
        message: 'Run pre-MLR before requesting the agentic report',
      })
    }
    if (!latest.passed) {
      return reply.code(422).send({
        error: 'pre_mlr_failed',
        message: `Pre-MLR has ${latest.mustFixCount} must-fix issue(s); fix them before requesting the agentic report`,
      })
    }

    // Deterministic advisory. Scored 0-100 based on claim-reuse proportion
    // minus issue weight. Real AI replaces this body when the connector
    // lands; shape stays identical.
    const totalClaims = content.claims.length
    const approvedCount = content.claims.filter(c => c.approvalStatus === 'approved' || c.approvalStatus === 'library_adopted').length
    const rejectedCount = content.claims.filter(c => c.approvalStatus === 'rejected').length
    const needsEditCount = content.claims.filter(c => c.approvalStatus === 'needs_edit').length

    const reuseScore = totalClaims > 0 ? Math.round((approvedCount / totalClaims) * 100) : 0
    const issueWeight = latest.shouldFixCount * 3 + latest.noteCount * 1
    const overallScore = Math.max(0, Math.min(100, reuseScore - issueWeight))

    const findings: Array<{ category: string; severity: 'advisory' | 'suggestion'; message: string }> = []
    if (rejectedCount > 0) findings.push({
      category: 'Claims hygiene',
      severity: 'advisory',
      message: `${rejectedCount} claim(s) rejected. Confirm removal from this piece before MLR submission.`,
    })
    if (needsEditCount > 0) findings.push({
      category: 'Claims hygiene',
      severity: 'advisory',
      message: `${needsEditCount} claim(s) marked needs_edit. Resolve edits before MLR submission.`,
    })
    if (latest.shouldFixCount > 0) findings.push({
      category: 'Editorial',
      severity: 'suggestion',
      message: `${latest.shouldFixCount} should-fix editorial note(s) in the latest pre-MLR run. Review before escalating to MLR.`,
    })
    if (reuseScore < 50 && totalClaims > 0) findings.push({
      category: 'Master Library reuse',
      severity: 'suggestion',
      message: `Claim reuse at ${reuseScore}% — below the 50% target. Consider adopting more Master Library claims to reduce MLR cycle time.`,
    })
    if (findings.length === 0) findings.push({
      category: 'Overall',
      severity: 'suggestion',
      message: 'No material findings. Content ready for MLR review.',
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'agentic_report_generated',
      entityType: 'med_content',
      entityId: contentId,
      details: { preMlrRunId: latest.id, overallScore, findingCount: findings.length, model: 'stub-advisor-v1' },
      ipAddress: request.ip ?? null,
    })

    return {
      contentId,
      model: 'stub-advisor-v1',
      advisoryOnly: true,
      generatedAt: new Date().toISOString(),
      preMlrRunId: latest.id,
      scores: {
        overall: overallScore,
        claimReusePct: reuseScore,
      },
      stats: {
        totalClaims,
        approvedClaims: approvedCount,
        rejectedClaims: rejectedCount,
        needsEditClaims: needsEditCount,
        preMlrShouldFixCount: latest.shouldFixCount,
        preMlrNoteCount: latest.noteCount,
      },
      findings,
    }
  })
}
