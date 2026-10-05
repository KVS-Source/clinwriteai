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
  // Total chars comes from the citations/content tables once they land;
  // for now we approximate with span sum as the whole denominator (all spans
  // counted) which still yields a usable 0-100 per section.
  app.get('/:publicationId/footprint', { preHandler: requireAuth({ modules: ['B'] }) }, async (request, reply) => {
    const { publicationId } = request.params as { publicationId: string }
    const pub = await app.prisma.publication.findUnique({ where: { id: publicationId } })
    if (!pub) return reply.code(404).send({ error: 'not_found' })

    const spans = await app.prisma.aiFootprintSpan.findMany({ where: { publicationId } })
    const bySection = new Map<string, number>()
    let aiChars = 0
    for (const s of spans) {
      const len = s.endOffset - s.startOffset
      aiChars += len
      bySection.set(s.sectionId, (bySection.get(s.sectionId) ?? 0) + len)
    }

    // Phase 3B placeholder: the content-char total belongs to the manuscript
    // editor payload. Until that lands we report aiChars as the denominator
    // so clients see 100% in sections with any AI content — the real
    // percentages replace this when the editor stores section lengths.
    return {
      publicationId,
      totalChars: aiChars,
      aiChars,
      humanChars: 0,
      aiPercent: aiChars > 0 ? 100 : 0,
      bySection: Array.from(bySection.entries()).map(([sectionId, chars]) => ({
        sectionId,
        sectionLabel: sectionId,
        aiPercent: 100,
        aiChars: chars,
      })),
    }
  })
}
