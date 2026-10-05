// Publications routes — Module B core.
//
// Endpoints landed this batch (API contract §16):
//   GET    /projects/:projectId/publications
//   GET    /publications/:publicationId
//   POST   /projects/:projectId/publications
//   POST   /publications/:publicationId/advance-stage
//   POST   /publications/:publicationId/transition
//   GET    /publications/:publicationId/footprint
//
// Not landed yet (future Module B sessions):
//   - PubMed / CrossRef / ORCID lookups (externally blocked — procurement)
//   - GPP-2022 report generator (PDF — scope choice)
//   - Congress exports (OQ-B-004 — no live portal API)
//
// Mounted twice: once under /projects for project-scoped list/create, once
// under /publications for singular get + stage mutations.

import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { requireAuth } from '../../../auth/rbac.js'
import { buildGppReport } from './gpp/builder.js'
import { renderGppReportPdf } from './gpp/pdf-renderer.js'
import {
  canAdvancePublication,
  InvalidPublicationStageError,
  nextPublicationStage,
  PUBLICATION_STAGES,
  type PublicationStage,
} from '../publication-stage.js'

const createSchema = z.object({
  type: z.string().min(1),
  subtype: z.string().optional(),
  title: z.string().min(1),
  guideline: z.string().min(1),
  journal: z.string().optional(),
  targetSubmissionDate: z.string().datetime().optional(),
  keyMessage: z.string().optional(),
  baaStatus: z.enum(['not_applicable', 'required', 'in_progress', 'executed']).default('not_applicable'),
  sourceDocumentId: z.string().optional(),
  teamRoles: z.array(z.object({
    userId: z.string(),
    raci: z.enum(['R', 'A', 'C', 'I']),
  })).min(1, 'At least one team role is required'),
}).refine(
  v => v.type !== 'manuscript' || !!v.subtype,
  { message: 'subtype is required when type = manuscript', path: ['subtype'] },
).refine(
  v => v.subtype !== 'case_report' || v.baaStatus !== 'not_applicable',
  { message: 'case_report subtype requires a BAA status other than not_applicable (FR-B-025)', path: ['baaStatus'] },
)

const listQuerySchema = z.object({
  stage: z.enum(PUBLICATION_STAGES).optional(),
  type: z.string().optional(),
  search: z.string().optional(),
})

const transitionSchema = z.object({
  to: z.enum(PUBLICATION_STAGES),
  reason: z.string().max(500).optional(),
})

export const publicationsProjectScopedRoutes: FastifyPluginAsync = async (app) => {
  app.get('/:projectId/publications', { preHandler: requireAuth({ modules: ['B'] }) }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string }
    const parsed = listQuerySchema.safeParse(request.query)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const project = await app.prisma.project.findUnique({ where: { id: projectId } })
    if (!project) return reply.code(404).send({ error: 'project_not_found' })

    return app.prisma.publication.findMany({
      where: {
        projectId,
        deletedAt: null,
        ...(parsed.data.stage && { stage: parsed.data.stage }),
        ...(parsed.data.type && { type: parsed.data.type }),
        ...(parsed.data.search && { title: { contains: parsed.data.search, mode: 'insensitive' } }),
      },
      orderBy: { updatedAt: 'desc' },
    })
  })

  app.post('/:projectId/publications', { preHandler: requireAuth({ modules: ['B'] }) }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string }
    const parsed = createSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const project = await app.prisma.project.findUnique({ where: { id: projectId } })
    if (!project) return reply.code(404).send({ error: 'project_not_found' })

    // Resolve the source document label at link time (OQ-B-001). This is
    // denormalised to preserve the label even if the source doc is renamed.
    let sourceLabel: string | null = null
    if (parsed.data.sourceDocumentId) {
      const srcDoc = await app.prisma.document.findUnique({
        where: { id: parsed.data.sourceDocumentId },
        include: { currentVersion: { select: { versionNumber: true } } },
      })
      if (!srcDoc) return reply.code(400).send({ error: 'validation', message: 'sourceDocumentId not found' })
      sourceLabel = `${srcDoc.title} ${srcDoc.currentVersion?.versionNumber ?? ''} · Module A`.trim()
    }

    // Pick the ownerId from the first R (responsible) role; fall back to the
    // creator if the team didn't nominate one.
    const responsible = parsed.data.teamRoles.find(r => r.raci === 'R')
    const ownerId = responsible?.userId ?? request.user!.id

    const created = await app.prisma.$transaction(async (tx) => {
      const pub = await tx.publication.create({
        data: {
          projectId,
          type: parsed.data.type,
          subtype: parsed.data.subtype ?? null,
          title: parsed.data.title,
          guideline: parsed.data.guideline,
          journal: parsed.data.journal ?? null,
          targetSubmissionDate: parsed.data.targetSubmissionDate ? new Date(parsed.data.targetSubmissionDate) : null,
          keyMessage: parsed.data.keyMessage ?? null,
          baaStatus: parsed.data.baaStatus,
          sourceDocumentId: parsed.data.sourceDocumentId ?? null,
          sourceDocumentLabel: sourceLabel,
          ownerId,
          createdBy: request.user!.id,
        },
      })

      // Materialise authors + exactly 4 ICMJE criterion rows per author.
      for (const role of parsed.data.teamRoles) {
        const u = await tx.user.findUnique({ where: { id: role.userId } })
        const author = await tx.publicationAuthor.create({
          data: {
            publicationId: pub.id,
            userId: role.userId,
            name: u?.name ?? 'Unknown author',
            initials: u?.initials ?? role.userId.slice(0, 2).toUpperCase(),
            role: role.raci === 'R' ? 'Medical writer / publication lead' : 'Co-author',
            raci: role.raci,
            isExternal: false,
            addedBy: request.user!.id,
          },
        })
        await tx.pubIcmjeCriterion.createMany({
          data: [0, 1, 2, 3].map(i => ({ authorId: author.id, criterionIndex: i })),
        })
      }

      return pub
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'publication_created',
      entityType: 'publication',
      entityId: created.id,
      details: { projectId, type: created.type, subtype: created.subtype, title: created.title },
      ipAddress: request.ip ?? null,
    })

    return reply.code(201).send(created)
  })

  // --- Portfolio dashboard (API §24; Module B B10) -----------------------
  // Rolls up all publications under the project — status/stage/type/journal
  // counts, open peer-review rounds, submission-check pass rate, average
  // target-to-submission days. Used by the Portfolio Dashboard (B10) UI.

  app.get('/:projectId/publications/portfolio', { preHandler: requireAuth({ modules: ['B'] }) }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string }
    const project = await app.prisma.project.findUnique({ where: { id: projectId } })
    if (!project) return reply.code(404).send({ error: 'project_not_found' })

    const [pubs, byStage, byStatus, byType, journalRows, openRounds, authorBreakdown] = await Promise.all([
      app.prisma.publication.findMany({
        where: { projectId, deletedAt: null },
        select: { id: true, title: true, stage: true, status: true, type: true, subtype: true, journal: true, targetSubmissionDate: true, updatedAt: true, ownerId: true, keyMessage: true },
        orderBy: { updatedAt: 'desc' },
      }),
      app.prisma.publication.groupBy({ by: ['stage'], where: { projectId, deletedAt: null }, _count: { _all: true } }),
      app.prisma.publication.groupBy({ by: ['status'], where: { projectId, deletedAt: null }, _count: { _all: true } }),
      app.prisma.publication.groupBy({ by: ['type'], where: { projectId, deletedAt: null }, _count: { _all: true } }),
      app.prisma.publication.groupBy({
        by: ['journal'],
        where: { projectId, deletedAt: null, journal: { not: null } },
        _count: { _all: true },
      }),
      app.prisma.peerReviewRound.count({
        where: { publication: { projectId, deletedAt: null }, submittedAt: null },
      }),
      app.prisma.publicationAuthor.groupBy({
        by: ['publicationId'],
        where: { publication: { projectId, deletedAt: null } },
        _count: { _all: true },
      }),
    ])

    const authorCountByPub = new Map(authorBreakdown.map(r => [r.publicationId, r._count._all]))

    // Average days-to-target for pubs with a submission date in the future.
    const now = Date.now()
    const upcoming = pubs
      .filter(p => p.targetSubmissionDate && p.targetSubmissionDate.getTime() > now)
      .map(p => Math.round((p.targetSubmissionDate!.getTime() - now) / 86400_000))
    const avgDaysToTarget = upcoming.length > 0 ? Math.round(upcoming.reduce((a, b) => a + b, 0) / upcoming.length) : null

    return {
      project: { id: project.id, name: project.name, therapeuticArea: project.therapeuticArea },
      counts: {
        total: pubs.length,
        openPeerReviewRounds: openRounds,
        byStage: Object.fromEntries(byStage.map(r => [r.stage, r._count._all])),
        byStatus: Object.fromEntries(byStatus.map(r => [r.status, r._count._all])),
        byType: Object.fromEntries(byType.map(r => [r.type, r._count._all])),
        byJournal: Object.fromEntries(journalRows.map(r => [r.journal ?? 'unspecified', r._count._all])),
      },
      upcoming: {
        count: upcoming.length,
        avgDaysToTarget,
      },
      publications: pubs.map(p => ({
        ...p,
        authorCount: authorCountByPub.get(p.id) ?? 0,
      })),
      generatedAt: new Date().toISOString(),
    }
  })

  // --- GPP-2022 compliance report (API §24; Module B B10) ----------------
  // Attests Good Publication Practice 2022 adherence per-publication across
  // the eight pillars (authorship, writing-assistance disclosure, trial
  // registration, data sharing, COI, authorship criteria, acknowledgement,
  // timely publication). Returns structured JSON — the PDF stack choice
  // is a Phase 5+ decision (see Phase 3B deferral note). UI can print-to-PDF.

  app.post('/:projectId/publications/gpp-report', { preHandler: requireAuth({ modules: ['B'] }) }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string }
    const report = await buildGppReport(app.prisma, projectId)
    if (!report) return reply.code(404).send({ error: 'project_not_found' })

    await app.audit.append({
      timestamp: report.generatedAt,
      actorId: request.user!.id,
      action: 'gpp_report_generated',
      entityType: 'project',
      entityId: projectId,
      details: { publicationCount: report.scope.publicationCount, overallPct: report.scope.overallPct, format: 'json' },
      ipAddress: request.ip ?? null,
    })

    return report
  })

  // Same report, PDF-rendered server-side via pdfkit. Streams bytes with
  // Content-Disposition set so the browser triggers a download. Same audit
  // event with `format: 'pdf'` so the two surfaces are distinguishable.
  app.post('/:projectId/publications/gpp-report.pdf', { preHandler: requireAuth({ modules: ['B'] }) }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string }
    const report = await buildGppReport(app.prisma, projectId)
    if (!report) return reply.code(404).send({ error: 'project_not_found' })

    await app.audit.append({
      timestamp: report.generatedAt,
      actorId: request.user!.id,
      action: 'gpp_report_generated',
      entityType: 'project',
      entityId: projectId,
      details: { publicationCount: report.scope.publicationCount, overallPct: report.scope.overallPct, format: 'pdf' },
      ipAddress: request.ip ?? null,
    })

    const filename = `gpp-2022-${report.project.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${report.generatedAt.slice(0, 10)}.pdf`
    reply
      .type('application/pdf')
      .header('Content-Disposition', `attachment; filename="${filename}"`)
    return reply.send(renderGppReportPdf(report))
  })
}

export const publicationsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/:publicationId', { preHandler: requireAuth({ modules: ['B'] }) }, async (request, reply) => {
    const { publicationId } = request.params as { publicationId: string }
    const pub = await app.prisma.publication.findUnique({ where: { id: publicationId } })
    if (!pub || pub.deletedAt) return reply.code(404).send({ error: 'not_found' })
    return pub
  })

  app.post('/:publicationId/advance-stage', { preHandler: requireAuth({ modules: ['B'] }) }, async (request, reply) => {
    const { publicationId } = request.params as { publicationId: string }
    const pub = await app.prisma.publication.findUnique({ where: { id: publicationId } })
    if (!pub) return reply.code(404).send({ error: 'not_found' })

    const from = pub.stage as PublicationStage
    const to = nextPublicationStage(from)
    if (!to) {
      return reply.code(422).send({ error: 'terminal', message: `Publication is at terminal stage ${from}` })
    }

    // Gate: no blocking submission check may remain unresolved before leaving
    // `submission`. Submission checks won't exist until Batch 4+, so this is a
    // no-op guard today — but it stays correct once checks ship.
    if (from === 'submission') {
      const blocking = await app.prisma.submissionCheck.count({
        where: { publicationId, state: 'block' },
      })
      if (blocking > 0) {
        return reply.code(422).send({
          error: 'blocking_checks',
          message: `${blocking} blocking submission checks remain unresolved`,
        })
      }
    }

    const updated = await app.prisma.publication.update({
      where: { id: publicationId },
      data: { stage: to },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'publication_stage_advanced',
      entityType: 'publication',
      entityId: publicationId,
      details: { from, to },
      ipAddress: request.ip ?? null,
    })

    return updated
  })

  app.post('/:publicationId/transition', { preHandler: requireAuth({ modules: ['B'] }) }, async (request, reply) => {
    const { publicationId } = request.params as { publicationId: string }
    const parsed = transitionSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const pub = await app.prisma.publication.findUnique({ where: { id: publicationId } })
    if (!pub) return reply.code(404).send({ error: 'not_found' })

    const from = pub.stage as PublicationStage
    const to = parsed.data.to
    if (!canAdvancePublication(from, to)) {
      const err = new InvalidPublicationStageError(from, to)
      return reply.code(409).send({ error: 'invalid_transition', message: err.message })
    }

    const updated = await app.prisma.publication.update({
      where: { id: publicationId },
      data: { stage: to },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'publication_stage_changed',
      entityType: 'publication',
      entityId: publicationId,
      details: { from, to, reason: parsed.data.reason ?? null },
      ipAddress: request.ip ?? null,
    })

    return updated
  })

  // AI footprint summary — computed, not stored.
  // Sum of (end-start) char spans per section → percent of total content.
  // Denominator comes from publication_section_totals (populated by the
  // manuscript editor via PUT /:id/section-totals). Sections without a
  // recorded total fall back to the "100% if any AI" approximation for
  // backwards compat; the response marks them with `estimated: true`.
  app.get('/:publicationId/footprint', { preHandler: requireAuth({ modules: ['B'] }) }, async (request, reply) => {
    const { publicationId } = request.params as { publicationId: string }
    const pub = await app.prisma.publication.findUnique({ where: { id: publicationId } })
    if (!pub) return reply.code(404).send({ error: 'not_found' })

    const [spans, totals] = await Promise.all([
      app.prisma.aiFootprintSpan.findMany({ where: { publicationId } }),
      app.prisma.publicationSectionTotal.findMany({ where: { publicationId } }),
    ])

    const bySection = new Map<string, number>()
    let aiChars = 0
    for (const s of spans) {
      const len = s.endOffset - s.startOffset
      aiChars += len
      bySection.set(s.sectionId, (bySection.get(s.sectionId) ?? 0) + len)
    }

    const totalByCode = new Map(totals.map(t => [t.sectionId, t.totalChars]))
    // Include sections that have a total but no spans so the UI shows them
    // at 0% AI (useful for the editor's progress overview).
    for (const t of totals) {
      if (!bySection.has(t.sectionId)) bySection.set(t.sectionId, 0)
    }

    const sections = Array.from(bySection.entries()).map(([sectionId, aiCharsHere]) => {
      const totalHere = totalByCode.get(sectionId)
      if (totalHere && totalHere > 0) {
        const pct = Math.min(100, Math.round((aiCharsHere / totalHere) * 100))
        return {
          sectionId,
          sectionLabel: sectionId,
          aiChars: aiCharsHere,
          totalChars: totalHere,
          aiPercent: pct,
          estimated: false,
        }
      }
      return {
        sectionId,
        sectionLabel: sectionId,
        aiChars: aiCharsHere,
        totalChars: aiCharsHere,
        aiPercent: aiCharsHere > 0 ? 100 : 0,
        estimated: true,
      }
    })

    const totalChars = Array.from(totalByCode.values()).reduce((a, b) => a + b, 0) || aiChars
    const aiPercent = totalChars > 0 ? Math.min(100, Math.round((aiChars / totalChars) * 100)) : 0

    return {
      publicationId,
      totalChars,
      aiChars,
      humanChars: Math.max(0, totalChars - aiChars),
      aiPercent,
      hasAnyRecordedTotals: totals.length > 0,
      bySection: sections,
    }
  })

  // Manuscript editor reports per-section char totals here. Idempotent
  // upsert per sectionId; UNIQUE(publicationId, sectionId) is the backstop.
  app.put('/:publicationId/section-totals', { preHandler: requireAuth({ modules: ['B'] }) }, async (request, reply) => {
    const { publicationId } = request.params as { publicationId: string }
    const bodySchema = z.object({
      totals: z.array(z.object({
        sectionId: z.string().min(1),
        totalChars: z.number().int().min(0),
      })).min(1),
    })
    const parsed = bodySchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const pub = await app.prisma.publication.findUnique({ where: { id: publicationId } })
    if (!pub) return reply.code(404).send({ error: 'not_found' })

    // Dedupe at input layer — if the caller sends two entries for the same
    // sectionId we take the last-write-wins without eating an opaque unique
    // violation.
    const dedup = new Map<string, number>()
    for (const t of parsed.data.totals) dedup.set(t.sectionId, t.totalChars)

    const results = await app.prisma.$transaction(
      Array.from(dedup.entries()).map(([sectionId, totalChars]) =>
        app.prisma.publicationSectionTotal.upsert({
          where: { publicationId_sectionId: { publicationId, sectionId } },
          create: { publicationId, sectionId, totalChars },
          update: { totalChars },
        }),
      ),
    )

    return { publicationId, updated: results.length, totals: results }
  })
}
