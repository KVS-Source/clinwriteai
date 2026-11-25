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
import { initialisePublicationVersion, templateSectionPayloads, type PublicationSectionPayload } from './section-service.js'
import { actorCanEditPublicationContent, PUBLICATION_EDIT_FORBIDDEN } from './access/publication-raci.js'
import {
  canAdvancePublication,
  InvalidPublicationStageError,
  nextPublicationStage,
  PUBLICATION_STAGES,
  type PublicationStage,
} from '../publication-stage.js'

// Fallback IMRAD skeleton used when the publication's docType has no
// template configured yet. Keeps the create flow usable end-to-end
// before any admin wires a PublicationTemplate. Phase M-B.6 wizard
// overhaul replaces this with the template picker.
const FALLBACK_IMRAD_SECTIONS: PublicationSectionPayload[] = [
  { sectionId: 'title',       sectionNumber: '0', sectionTitle: 'Title & authors' },
  { sectionId: 'abstract',    sectionNumber: '1', sectionTitle: 'Abstract' },
  { sectionId: 'intro',       sectionNumber: '2', sectionTitle: 'Introduction' },
  { sectionId: 'methods',     sectionNumber: '3', sectionTitle: 'Methods' },
  { sectionId: 'results',     sectionNumber: '4', sectionTitle: 'Results' },
  { sectionId: 'discussion',  sectionNumber: '5', sectionTitle: 'Discussion' },
  { sectionId: 'conclusion',  sectionNumber: '6', sectionTitle: 'Conclusion' },
  { sectionId: 'references',  sectionNumber: '7', sectionTitle: 'References' },
  { sectionId: 'disclosures', sectionNumber: '8', sectionTitle: 'Disclosures' },
]

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

// Shape pub rows for the UI's packages/types `Publication` interface.
// Fills derived display fields the DB doesn't store directly:
//   - ownerInitials: looked up from User.initials when owner is in DB
//   - project: Project.name (not Project.id — UI uses this as a display label)
//   - due: aliased from targetSubmissionDate (UI's "due" column header)
//   - doi / gpp2022 / aiLabel / warning: nulls here — computed server-side
//     by their respective dedicated routes (/doi, /gpp-report, /footprint).
//     UI null-checks these; filling them inline would N+1-query the list.
type PubWithRels = {
  id: string; projectId: string; type: string; subtype: string | null; title: string
  stage: string; status: string; version: string; guideline: string; journal: string | null
  targetSubmissionDate: Date | null; keyMessage: string | null; baaStatus: string
  sourceDocumentId: string | null; sourceDocumentLabel: string | null; ownerId: string
  createdBy: string; createdAt: Date; updatedAt: Date
  owner?: { initials: string | null } | null
  project?: { name: string } | null
}
function publicationShape(p: PubWithRels & Record<string, unknown>) {
  return {
    ...p,
    ownerInitials: p.owner?.initials ?? '',
    project: p.project?.name ?? p.projectId,
    due: p.targetSubmissionDate?.toISOString() ?? null,
    doi: null as string | null,
    gpp2022: 'not_scored' as const,
    aiLabel: null as string | null,
    warning: null as string | null,
    // Internal join artifacts stripped from the wire.
    owner: undefined,
  }
}

// The publication's owner is a User row — Prisma relation lookup requires
// a scoping on the User model side. Since Publication.ownerId is a plain
// String (not a FK with explicit relation in the schema), we fetch owners
// separately. Done in a single query so the list route stays O(1) DB calls.
async function withOwnerInitials<T extends { ownerId: string }>(
  prisma: import('@prisma/client').PrismaClient,
  rows: T[],
): Promise<Array<T & { owner: { initials: string | null } | null }>> {
  if (rows.length === 0) return []
  const ownerIds = Array.from(new Set(rows.map(r => r.ownerId)))
  const owners = await prisma.user.findMany({
    where: { id: { in: ownerIds } },
    select: { id: true, initials: true },
  })
  const byId = new Map(owners.map(o => [o.id, o]))
  return rows.map(r => ({ ...r, owner: byId.get(r.ownerId) ?? null }))
}

export const publicationsProjectScopedRoutes: FastifyPluginAsync = async (app) => {
  app.get('/:projectId/publications', { preHandler: requireAuth({ modules: ['B'] }) }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string }
    const parsed = listQuerySchema.safeParse(request.query)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const project = await app.prisma.project.findUnique({ where: { id: projectId }, select: { id: true, name: true } })
    if (!project) return reply.code(404).send({ error: 'project_not_found' })

    const rows = await app.prisma.publication.findMany({
      where: {
        projectId,
        deletedAt: null,
        ...(parsed.data.stage && { stage: parsed.data.stage }),
        ...(parsed.data.type && { type: parsed.data.type }),
        ...(parsed.data.search && { title: { contains: parsed.data.search, mode: 'insensitive' } }),
      },
      orderBy: { updatedAt: 'desc' },
    })

    const withOwners = await withOwnerInitials(app.prisma, rows)
    return withOwners.map(r => publicationShape({ ...r, project }))
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

    // Phase M-B.1/2 wiring — resolve the publication-type policy for
    // this doc type, pin its template + AI/BP record ids on the new
    // Publication, and seed v0.1 from the template's section skeleton.
    // Falls back to the legacy fixed-IMRAD skeleton when no policy or
    // template is wired yet (so this works end-to-end before any admin
    // has configured a policy).
    const policyDocType = (parsed.data.subtype ? `${parsed.data.type}_${parsed.data.subtype}` : parsed.data.type)
      .toLowerCase()
      .replace(/-/g, '_')
    const policy = await app.prisma.publicationTypePolicy.findFirst({
      where: { docType: policyDocType, isCurrent: true, retiredAt: null },
    })
    const promptPin = await app.prisma.publicationAiPromptRecord.findFirst({
      where:   { docType: policyDocType, status: 'approved' },
      orderBy: { version: 'desc' },
      select:  { id: true, version: true },
    })
    const bpPin = await app.prisma.publicationBestPracticeRecord.findFirst({
      where:   { docType: policyDocType, status: 'approved' },
      orderBy: { version: 'desc' },
      select:  { id: true, version: true },
    })

    let sections: PublicationSectionPayload[] = FALLBACK_IMRAD_SECTIONS
    if (policy?.templateId) {
      const tmpl = await app.prisma.publicationTemplate.findUnique({
        where: { id: policy.templateId },
      })
      if (tmpl) {
        const fromTemplate = templateSectionPayloads(tmpl.sections)
        if (fromTemplate.length > 0) sections = fromTemplate
      }
    }

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
          // Phase M-B.1 pins
          pubTypePolicyVersionAtCreate:           policy?.version ?? null,
          publicationAiPromptRecordId:            promptPin?.id      ?? null,
          publicationAiPromptVersionAtCreate:     promptPin?.version ?? null,
          publicationBestPracticeRecordId:        bpPin?.id      ?? null,
          publicationBestPracticeVersionAtCreate: bpPin?.version ?? null,
        },
      })

      // Phase M-B.2 — seed v0.1 and its section_contents from the template.
      // docType threads through so section rows can be snapshotted against
      // the approved SectionTemplate for this (docType, sectionKey) pair.
      // Package B-4 (migration 105): also pass templateId + pinned
      // AiPromptRecord id so the service can snapshot per-section
      // instructions / guidance / aiPromptSectionRules onto the new
      // PublicationSectionContent rows.
      await initialisePublicationVersion(tx, {
        publicationId:    pub.id,
        actorId:          request.user!.id,
        sections,
        docType:          parsed.data.type,
        templateId:       policy?.templateId ?? undefined,
        aiPromptRecordId: promptPin?.id      ?? undefined,
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

    // Publication.projectId is a plain-string FK (no Prisma relation
    // defined), so project is a separate fetch. Owner initials ditto.
    // Same shape mapping as the list — Fastify auto-serialises Date →
    // ISO string on the wire.
    const [withOwner] = await withOwnerInitials(app.prisma, [pub])
    if (!withOwner) return reply.code(404).send({ error: 'not_found' })
    const project = await app.prisma.project.findUnique({
      where: { id: pub.projectId },
      select: { name: true },
    })
    return publicationShape({ ...withOwner, project })
  })

  // Phase M-B.5 — fan out stage-change notifications to all authors
  // (except the actor). `submission_ready`, `revision_requested`,
  // `published` are the three notification-worthy transitions; other
  // stage changes just audit without a notification.
  async function fanOutStageNotification(args: {
    publicationId: string
    projectId:     string
    title:         string
    from:          PublicationStage
    to:            PublicationStage
    actorId:       string
    reason?:       string | null
  }): Promise<void> {
    if (!app.notifications) return
    let kind: string | null = null
    let heading: string | null = null
    if (args.to === 'submission') {
      kind = 'publication.submission_ready'
      heading = `Publication "${args.title}" is ready for journal submission`
    } else if (args.to === 'authoring' && (args.from === 'review' || args.from === 'submission')) {
      kind = 'publication.revision_requested'
      heading = `Revision requested on "${args.title}"`
    } else if (args.to === 'published') {
      kind = 'publication.published'
      heading = `"${args.title}" has been published`
    }
    if (!kind || !heading) return

    const authors = await app.prisma.publicationAuthor.findMany({
      where:  { publicationId: args.publicationId, removedAt: null, userId: { not: null } },
      select: { userId: true },
    })
    const recipientIds = Array.from(new Set(
      authors.map(a => a.userId!).filter(id => id !== args.actorId),
    ))
    const body = args.reason ? `${args.from} → ${args.to} · ${args.reason}` : `${args.from} → ${args.to}`
    const linkPath = `/projects/${args.projectId}/scientific-writing/publications/${args.publicationId}`
    for (const recipientId of recipientIds) {
      await app.notifications.send({
        recipientId,
        kind,
        severity: kind === 'publication.revision_requested' ? 'warning' : 'info',
        title:    heading,
        body,
        linkPath,
        payload:  { publicationId: args.publicationId, projectId: args.projectId, from: args.from, to: args.to },
      }).catch(err => app.log.warn({ err, kind, recipientId }, 'stage notification send failed'))
    }
  }

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

    await fanOutStageNotification({
      publicationId, projectId: pub.projectId, title: pub.title,
      from, to, actorId: request.user!.id,
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

    await fanOutStageNotification({
      publicationId, projectId: pub.projectId, title: pub.title,
      from, to, actorId: request.user!.id, reason: parsed.data.reason ?? null,
    })

    return updated
  })

  // AI footprint summary — computed, not stored.
  // Sum of (end-start) char spans per section → percent of total content.
  // Denominator comes from publication_section_totals (populated by the
  // manuscript editor via PUT /:id/section-totals). Sections without a
  // recorded total fall back to the "100% if any AI" approximation for
  // backwards compat; the response marks them with `estimated: true`.
  // Phase M-B.3 — kick off the AI initial-draft worker. Idempotent:
  // jobId=`pub-ai-initial-draft-<publicationId>` dedupes retries in
  // BullMQ. Returns 202 with jobId so the SPA can poll aiDraftState
  // for progress. Only allowed when state is 'idle' or 'complete' —
  // re-running on an in-flight draft is a 409. aiInstructions (if
  // supplied) is persisted on the Publication so the worker reads it.
  const draftRequestSchema = z.object({
    aiInstructions: z.string().max(2000).optional(),
  })
  app.post('/:publicationId/ai-initial-draft', { preHandler: requireAuth({ modules: ['B'] }) }, async (request, reply) => {
    const { publicationId } = request.params as { publicationId: string }
    const parsed = draftRequestSchema.safeParse(request.body ?? {})
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const pub = await app.prisma.publication.findUnique({
      where: { id: publicationId },
      select: {
        id: true, projectId: true, deletedAt: true,
        aiDraftState: true, currentVersionId: true,
      },
    })
    if (!pub || pub.deletedAt) return reply.code(404).send({ error: 'not_found' })
    if (!pub.currentVersionId) {
      return reply.code(409).send({
        error:   'no_current_version',
        message: 'Publication has no current version. Create flow should have seeded v0.1.',
      })
    }
    if (!(await actorCanEditPublicationContent(app.prisma, request.user!, publicationId))) {
      return reply.code(403).send(PUBLICATION_EDIT_FORBIDDEN)
    }
    if (pub.aiDraftState === 'drafting' || pub.aiDraftState === 'validating') {
      return reply.code(409).send({
        error:   'already_running',
        state:   pub.aiDraftState,
        message: `AI draft chain is already ${pub.aiDraftState} for this publication.`,
      })
    }

    // Persist aiInstructions on the publication (if sent) so the worker
    // picks it up. Updates are idempotent — same text re-written is a
    // no-op. Reset aiDraftState to 'idle' so the worker's state machine
    // walks cleanly from 'idle' → 'drafting' → 'validating' → 'complete'.
    if (parsed.data.aiInstructions !== undefined) {
      await app.prisma.publication.update({
        where: { id: publicationId },
        data:  {
          aiInstructions: parsed.data.aiInstructions.trim() || null,
          aiDraftState:   'idle',
        },
      })
    }

    const jobId = `pub-ai-initial-draft-${publicationId}`
    try {
      await app.queue.enqueue('publications.ai_initial_draft', {
        publicationId,
        projectId: pub.projectId,
        actorId:   request.user!.id,
      }, { jobId })
    } catch (err) {
      request.log.warn({ err, publicationId }, 'pub ai-initial-draft: enqueue failed')
      return reply.code(503).send({ error: 'enqueue_failed', message: 'Could not enqueue the draft job.' })
    }

    await app.audit.append({
      timestamp:  new Date().toISOString(),
      actorId:    request.user!.id,
      action:     'publication_ai_initial_draft_enqueued',
      entityType: 'publication',
      entityId:   publicationId,
      details:    { jobId, hasAiInstructions: parsed.data.aiInstructions !== undefined },
      ipAddress:  request.ip ?? null,
    })

    return reply.code(202).send({ jobId, publicationId, state: 'enqueued' })
  })

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

  // --- Final output bundle (sB09) --------------------------------------
  // Returns the publication + authors + citations + submission-check
  // summary + latest review-round in one call so FinalOutput.tsx can
  // render the "ready to ship" package without six round-trips. Light
  // joins only — the heavier GPP PDF renderer lives at /gpp-report.pdf.
  app.get('/:publicationId/final', { preHandler: requireAuth({ modules: ['B'] }) }, async (request, reply) => {
    const { publicationId } = request.params as { publicationId: string }
    const pub = await app.prisma.publication.findUnique({ where: { id: publicationId } })
    if (!pub) return reply.code(404).send({ error: 'not_found' })

    const [authors, citations, checks, latestRound] = await Promise.all([
      app.prisma.publicationAuthor.findMany({ where: { publicationId, removedAt: null }, orderBy: { addedAt: 'asc' } }),
      app.prisma.citation.findMany({ where: { publicationId, removedAt: null }, orderBy: { insertedAt: 'asc' } }),
      app.prisma.submissionCheck.findMany({ where: { publicationId } }),
      app.prisma.peerReviewRound.findFirst({ where: { publicationId }, orderBy: { roundNumber: 'desc' } }),
    ])

    const blockCount = checks.filter(c => c.state === 'block').length
    const warnCount  = checks.filter(c => c.state === 'warn').length
    const passCount  = checks.filter(c => c.state === 'pass').length

    return {
      publication: pub,
      authors,
      citations,
      submissionReady: blockCount === 0,
      submissionCheckSummary: {
        total:  checks.length,
        pass:   passCount,
        warn:   warnCount,
        block:  blockCount,
      },
      latestReviewRound: latestRound,
      // No approvedAt/publishedAt yet in the Publication model —
      // derived from stage/status instead so the UI can colour-code
      // without a schema change.
      publishedState: {
        journal: pub.journal,
        stage:   pub.stage,
        status:  pub.status,
      },
    }
  })

  // Download the final package. Deferred to the real renderer (pandoc /
  // puppeteer / zip pipeline — Phase 4). Stub returns a short-lived
  // signed-URL shape so the UI can wire the button + logs the request.
  app.post('/:publicationId/final/download', { preHandler: requireAuth({ modules: ['B'] }) }, async (request, reply) => {
    const { publicationId } = request.params as { publicationId: string }
    const pub = await app.prisma.publication.findUnique({ where: { id: publicationId } })
    if (!pub) return reply.code(404).send({ error: 'not_found' })

    const requestId = `pub-dl-${Date.now().toString(36)}`
    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'publication_final_download_requested',
      entityType: 'publication',
      entityId: publicationId,
      details: { requestId, stub: true },
      ipAddress: request.ip ?? null,
    })

    return {
      requestId,
      downloadUrl: null,                                        // real signed URL when renderer lands
      status: 'queued',
      message: 'Download bundle pipeline is deferred (Phase 4 renderer); request logged to the audit trail.',
      stub: true,
    }
  })

  // --- Master Library push --------------------------------------------
  //
  // POST /:publicationId/library/push
  // Body: { items: [{ title, body, category? }] }
  //
  // A published manuscript is approved content — its key findings can
  // flow into the shared Master Library (LibrarySection) so other
  // modules (Medical Writing claims, Regulatory Writing library
  // cards, Ideation currency check) can reuse the wording.
  //
  // Gate: stage must be 'published'. 409 otherwise — earlier stages
  // haven't cleared peer review and shouldn't land in the reusable
  // pool.
  //
  // Per-item LibrarySection:
  //   tenantId:  null                (single-tenant install)
  //   category:  'claim' (default) or caller-supplied
  //   framework: 'Peer-Reviewed Publication'
  //   tags:      module:B, doctype:publication, project:<id>,
  //              source:<pubId>, journal:<name> (when set)
  //   body:      the item body
  //
  // Dedup: (source:<pubId> + title) short-circuits — a re-push of
  // the same title is a no-op. Later versions should use the
  // platform /library/:id PUT update to supersede; the Phase-4 cadence
  // of "publication is immutable once published" keeps that uncommon.
  const pubLibraryPushSchema = z.object({
    items: z.array(z.object({
      title:    z.string().min(1).max(200),
      body:     z.string().min(1).max(10_000),
      category: z.enum(['claim', 'safety', 'boilerplate', 'best_practice']).default('claim'),
    })).min(1).max(20),
  })

  app.post('/:publicationId/library/push', { preHandler: requireAuth({ modules: ['B'] }) }, async (request, reply) => {
    const { publicationId } = request.params as { publicationId: string }
    const parsed = pubLibraryPushSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const pub = await app.prisma.publication.findUnique({ where: { id: publicationId } })
    if (!pub) return reply.code(404).send({ error: 'not_found' })
    if (pub.stage !== 'published') {
      return reply.code(409).send({ error: 'not_published', message: `Only published publications can push to the Master Library (current stage: ${pub.stage})` })
    }

    const commonTags = [
      'module:B',
      'doctype:publication',
      `project:${pub.projectId}`,
      `source:${publicationId}`,
      ...(pub.journal ? [`journal:${pub.journal}`] : []),
    ]

    const results: Array<{ title: string; librarySectionId?: string; skippedReason?: 'already_pushed' }> = []
    for (const item of parsed.data.items) {
      const existing = await app.prisma.librarySection.findFirst({
        where: {
          title: item.title,
          isCurrent: true,
          retiredAt: null,
          tags: { has: `source:${publicationId}` },
        },
        select: { id: true },
      })
      if (existing) {
        results.push({ title: item.title, skippedReason: 'already_pushed' })
        continue
      }
      const created = await app.prisma.librarySection.create({
        data: {
          tenantId:   null,
          title:      item.title,
          body:       item.body,
          taTag:      pub.guideline,                            // Publication model carries guideline (CONSORT/STROBE…) not TA; use it as the taTag proxy
          framework:  'Peer-Reviewed Publication',
          category:   item.category,
          tags:       commonTags,
          approvedBy: request.user!.id,
        },
      })
      results.push({ title: item.title, librarySectionId: created.id })
    }

    const pushedCount = results.filter(r => r.librarySectionId).length
    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'library_push',
      entityType: 'publication',
      entityId: publicationId,
      details: { requested: parsed.data.items.length, pushed: pushedCount, results },
      ipAddress: request.ip ?? null,
    })
    return { pushedAt: new Date().toISOString(), pushedCount, results }
  })
}
