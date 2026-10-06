// Ideation project + artefact + content card routes — Module E.
//
// Routes landed this batch:
//   POST  /projects/:projectId/ideation         — create ideation project
//   GET   /projects/:projectId/ideation
//   GET   /ideation/:ideationProjectId
//   POST  /ideation/:ideationProjectId/artefacts  — add source artefact
//   GET   /ideation/:ideationProjectId/artefacts
//   POST  /ideation/artefacts/:artefactId/cards   — create content card
//   GET   /ideation/artefacts/:artefactId/cards
//   PATCH /ideation/cards/:cardId/review          — set kol/ma status, derive overall
//
// The overall_status derivation (deriveOverallStatus) runs on every review
// write. We track "wasSeen" by checking whether EITHER status has ever
// moved out of 'pending' at least once; the simplest signal is "the card
// has at least one review PATCH applied" so we flip wasSeen=true the first
// time this endpoint is hit regardless of the direction of change.

import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { requireAuth } from '../../auth/rbac.js'
import { deriveOverallStatus, type ReviewStatus } from './card-status.js'

const createIdeationSchema = z.object({
  sourceType: z.enum(['master_library', 'upload', 'external']),
  taTag: z.string().min(1),
})

const createArtefactSchema = z.object({
  sourceModule: z.enum(['A', 'B', 'C', 'D', 'external']).optional(),
  sourceDocId: z.string().optional(),
  filePath: z.string().optional(),
  title: z.string().min(1),
  originalApprovalDate: z.string().datetime(),
  version: z.string().min(1),
  masterLibraryPushDate: z.string().datetime().optional(),
})

const createCardSchema = z.object({
  sourceSection: z.string().min(1),
  sourcePassage: z.string().min(1),
  channelFormats: z.array(z.string()).default([]),
  claimCurrencyStatus: z.enum(['current', 'potentially_superseded', 'conflicting']).default('current'),
  provenance: z.record(z.unknown()).optional(),
})

const reviewCardSchema = z.object({
  kolStatus: z.enum(['pending', 'approved', 'rejected']).optional(),
  maStatus: z.enum(['pending', 'approved', 'rejected']).optional(),
}).refine(v => v.kolStatus !== undefined || v.maStatus !== undefined, {
  message: 'At least one of kolStatus or maStatus must be provided',
})

// Shape ideation project rows for the UI's packages/types IdeationProject
// interface. UI expects enum variant 'master-library' (hyphen), Prisma stores
// 'master_library' (underscore). UI also wants synthesised fields (title,
// compound, indication, createdByName, createdByRole) + aggregate counts
// (contentCardCount, approvedCardCount, scheduledCount, publishedCount).
//
// Status → stage number mapping — UI shows stage pill 1-5 derived from the
// ideation_stage enum:
//   uploaded          → 1
//   content_cards     → 2
//   atomised          → 3
//   under_review      → 4
//   calendar_approved → 5
//   published         → 5
function stageOfStatus(status: string): number {
  switch (status) {
    case 'uploaded':          return 1
    case 'content_cards':     return 2
    case 'atomised':          return 3
    case 'under_review':      return 4
    case 'calendar_approved': return 5
    case 'published':         return 5
    default:                  return 1
  }
}

interface IdeationCounts {
  contentCardCount: number
  approvedCardCount: number
  scheduledCount: number
  publishedCount: number
}

async function fetchIdeationCounts(
  prisma: import('@prisma/client').PrismaClient,
  ideationIds: string[],
): Promise<Map<string, IdeationCounts>> {
  if (ideationIds.length === 0) return new Map()
  // Nested count via raw aggregation: cards belong to artefacts which belong to
  // ideation projects. Three group-bys in parallel. Returns zeros for projects
  // with no cards.
  const [cards, approved, scheduled, published] = await Promise.all([
    prisma.ideationContentCard.groupBy({
      by: ['ideationArtefactId'],
      where: { artefact: { ideationProjectId: { in: ideationIds } } },
      _count: { _all: true },
    }),
    prisma.ideationContentCard.groupBy({
      by: ['ideationArtefactId'],
      where: { artefact: { ideationProjectId: { in: ideationIds } }, overallStatus: 'approved' },
      _count: { _all: true },
    }),
    prisma.calendarEntry.groupBy({
      by: ['ideationContentCardId'],
      where: { card: { artefact: { ideationProjectId: { in: ideationIds } } }, status: 'scheduled' },
      _count: { _all: true },
    }),
    prisma.calendarEntry.groupBy({
      by: ['ideationContentCardId'],
      where: { card: { artefact: { ideationProjectId: { in: ideationIds } } }, status: 'published' },
      _count: { _all: true },
    }),
  ])
  // We asked groupBy by artefactId/cardId, not ideationProjectId directly, so
  // we need the artefact → ideationProjectId map to aggregate. Second query
  // in exchange for not doing N project-level counts.
  const artefactMap = ideationIds.length === 0 ? new Map() : new Map(
    (await prisma.ideationArtefact.findMany({
      where: { ideationProjectId: { in: ideationIds } },
      select: { id: true, ideationProjectId: true },
    })).map(a => [a.id, a.ideationProjectId]),
  )
  const cardMap = new Map(
    (await prisma.ideationContentCard.findMany({
      where: { artefact: { ideationProjectId: { in: ideationIds } } },
      select: { id: true, ideationArtefactId: true },
    })).map(c => [c.id, c.ideationArtefactId]),
  )

  const out = new Map<string, IdeationCounts>()
  for (const id of ideationIds) out.set(id, { contentCardCount: 0, approvedCardCount: 0, scheduledCount: 0, publishedCount: 0 })
  for (const r of cards) {
    const ip = artefactMap.get(r.ideationArtefactId); if (!ip) continue
    out.get(ip)!.contentCardCount += r._count._all
  }
  for (const r of approved) {
    const ip = artefactMap.get(r.ideationArtefactId); if (!ip) continue
    out.get(ip)!.approvedCardCount += r._count._all
  }
  for (const r of scheduled) {
    const ar = cardMap.get(r.ideationContentCardId); if (!ar) continue
    const ip = artefactMap.get(ar); if (!ip) continue
    out.get(ip)!.scheduledCount += r._count._all
  }
  for (const r of published) {
    const ar = cardMap.get(r.ideationContentCardId); if (!ar) continue
    const ip = artefactMap.get(ar); if (!ip) continue
    out.get(ip)!.publishedCount += r._count._all
  }
  return out
}

function ideationShape(
  r: { id: string; sourceType: string; status: string; createdBy: string; projectId: string } & Record<string, unknown>,
  parent: { name: string; indication: string | null } | null,
  creator: { name: string; role: string } | null,
  counts: IdeationCounts,
) {
  return {
    ...r,
    sourceType: r.sourceType === 'master_library' ? 'master-library' : r.sourceType,
    stage: stageOfStatus(r.status),
    title: parent?.name ?? r.projectId,
    compound: parent?.indication ?? '',
    indication: parent?.indication ?? '',
    createdByName: creator?.name ?? r.createdBy,
    createdByRole: creator?.role ?? '',
    ...counts,
  }
}

async function fetchIdeationContext(
  prisma: import('@prisma/client').PrismaClient,
  rows: Array<{ id: string; projectId: string; createdBy: string }>,
) {
  const parentIds = Array.from(new Set(rows.map(r => r.projectId)))
  const creatorIds = Array.from(new Set(rows.map(r => r.createdBy)))
  const [parents, creators, counts] = await Promise.all([
    prisma.project.findMany({ where: { id: { in: parentIds } }, select: { id: true, name: true, indication: true } }),
    prisma.user.findMany({ where: { id: { in: creatorIds } }, select: { id: true, name: true, role: true } }),
    fetchIdeationCounts(prisma, rows.map(r => r.id)),
  ])
  return {
    parentMap: new Map(parents.map(p => [p.id, { name: p.name, indication: p.indication }])),
    creatorMap: new Map(creators.map(c => [c.id, { name: c.name, role: c.role }])),
    countsMap: counts,
  }
}

export const ideationProjectScopedRoutes: FastifyPluginAsync = async (app) => {
  app.get('/:projectId/ideation', { preHandler: requireAuth({ modules: ['E'] }) }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string }
    const project = await app.prisma.project.findUnique({ where: { id: projectId }, select: { id: true } })
    if (!project) return reply.code(404).send({ error: 'project_not_found' })
    const rows = await app.prisma.ideationProject.findMany({ where: { projectId }, orderBy: { updatedAt: 'desc' } })
    const ctx = await fetchIdeationContext(app.prisma, rows)
    return rows.map(r => ideationShape(
      r,
      ctx.parentMap.get(r.projectId) ?? null,
      ctx.creatorMap.get(r.createdBy) ?? null,
      ctx.countsMap.get(r.id) ?? { contentCardCount: 0, approvedCardCount: 0, scheduledCount: 0, publishedCount: 0 },
    ))
  })

  app.post('/:projectId/ideation', { preHandler: requireAuth({ modules: ['E'] }) }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string }
    const parsed = createIdeationSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const project = await app.prisma.project.findUnique({ where: { id: projectId } })
    if (!project) return reply.code(404).send({ error: 'project_not_found' })

    const created = await app.prisma.ideationProject.create({
      data: {
        projectId,
        sourceType: parsed.data.sourceType,
        taTag: parsed.data.taTag,
        createdBy: request.user!.id,
      },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'ideation_project_created',
      entityType: 'ideation_project',
      entityId: created.id,
      details: { projectId, sourceType: parsed.data.sourceType, taTag: parsed.data.taTag },
      ipAddress: request.ip ?? null,
    })
    const ctx = await fetchIdeationContext(app.prisma, [created])
    return reply.code(201).send(ideationShape(
      created,
      ctx.parentMap.get(created.projectId) ?? null,
      ctx.creatorMap.get(created.createdBy) ?? null,
      ctx.countsMap.get(created.id) ?? { contentCardCount: 0, approvedCardCount: 0, scheduledCount: 0, publishedCount: 0 },
    ))
  })
}

export const ideationRoutes: FastifyPluginAsync = async (app) => {
  app.get('/:ideationProjectId', { preHandler: requireAuth({ modules: ['E'] }) }, async (request, reply) => {
    const { ideationProjectId } = request.params as { ideationProjectId: string }
    const row = await app.prisma.ideationProject.findUnique({ where: { id: ideationProjectId } })
    if (!row) return reply.code(404).send({ error: 'not_found' })
    const ctx = await fetchIdeationContext(app.prisma, [row])
    return ideationShape(
      row,
      ctx.parentMap.get(row.projectId) ?? null,
      ctx.creatorMap.get(row.createdBy) ?? null,
      ctx.countsMap.get(row.id) ?? { contentCardCount: 0, approvedCardCount: 0, scheduledCount: 0, publishedCount: 0 },
    )
  })

  app.get('/:ideationProjectId/artefacts', { preHandler: requireAuth({ modules: ['E'] }) }, async (request, reply) => {
    const { ideationProjectId } = request.params as { ideationProjectId: string }
    const row = await app.prisma.ideationProject.findUnique({ where: { id: ideationProjectId } })
    if (!row) return reply.code(404).send({ error: 'not_found' })
    return app.prisma.ideationArtefact.findMany({
      where: { ideationProjectId },
      orderBy: { originalApprovalDate: 'desc' },
    })
  })

  app.post('/:ideationProjectId/artefacts', { preHandler: requireAuth({ modules: ['E'] }) }, async (request, reply) => {
    const { ideationProjectId } = request.params as { ideationProjectId: string }
    const parsed = createArtefactSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const parent = await app.prisma.ideationProject.findUnique({ where: { id: ideationProjectId } })
    if (!parent) return reply.code(404).send({ error: 'not_found' })

    // FR-E-002 (v0.3): Master Library pulls within 90 days bypass the
    // source-currency check. Older items get a lightweight warning status
    // so the UI can flag them for human review before adding to the project.
    let sourceCurrencyStatus: 'current' | 'warned' = 'current'
    if (parsed.data.masterLibraryPushDate) {
      const pushDate = new Date(parsed.data.masterLibraryPushDate)
      const ageDays = Math.floor((Date.now() - pushDate.getTime()) / (1000 * 60 * 60 * 24))
      if (ageDays > 90) sourceCurrencyStatus = 'warned'
    }

    const created = await app.prisma.ideationArtefact.create({
      data: {
        ideationProjectId,
        sourceModule: parsed.data.sourceModule ?? null,
        sourceDocId: parsed.data.sourceDocId ?? null,
        filePath: parsed.data.filePath ?? null,
        title: parsed.data.title,
        originalApprovalDate: new Date(parsed.data.originalApprovalDate),
        version: parsed.data.version,
        masterLibraryPushDate: parsed.data.masterLibraryPushDate ? new Date(parsed.data.masterLibraryPushDate) : null,
        sourceCurrencyStatus,
      },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'ideation_artefact_added',
      entityType: 'ideation_project',
      entityId: ideationProjectId,
      details: {
        artefactId: created.id,
        sourceModule: parsed.data.sourceModule ?? null,
        sourceCurrencyStatus,
        title: parsed.data.title,
      },
      ipAddress: request.ip ?? null,
    })

    return reply.code(201).send(created)
  })

  // --- Content cards (mounted under /ideation/artefacts/:artefactId) ------

  app.get('/artefacts/:artefactId/cards', { preHandler: requireAuth({ modules: ['E'] }) }, async (request, reply) => {
    const { artefactId } = request.params as { artefactId: string }
    const art = await app.prisma.ideationArtefact.findUnique({ where: { id: artefactId } })
    if (!art) return reply.code(404).send({ error: 'not_found' })
    return app.prisma.ideationContentCard.findMany({
      where: { ideationArtefactId: artefactId },
      orderBy: { createdAt: 'asc' },
    })
  })

  app.post('/artefacts/:artefactId/cards', { preHandler: requireAuth({ modules: ['E'] }) }, async (request, reply) => {
    const { artefactId } = request.params as { artefactId: string }
    const parsed = createCardSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const art = await app.prisma.ideationArtefact.findUnique({ where: { id: artefactId } })
    if (!art) return reply.code(404).send({ error: 'not_found' })

    const created = await app.prisma.ideationContentCard.create({
      data: {
        ideationArtefactId: artefactId,
        sourceSection: parsed.data.sourceSection,
        sourcePassage: parsed.data.sourcePassage,
        claimCurrencyStatus: parsed.data.claimCurrencyStatus,
        channelFormats: parsed.data.channelFormats,
        provenance: (parsed.data.provenance ?? {}) as unknown as object,
      },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'ideation_card_created',
      entityType: 'ideation_artefact',
      entityId: artefactId,
      details: { cardId: created.id, section: parsed.data.sourceSection, channels: parsed.data.channelFormats },
      ipAddress: request.ip ?? null,
    })

    return reply.code(201).send(created)
  })

  app.patch('/cards/:cardId/review', { preHandler: requireAuth({ modules: ['E'] }) }, async (request, reply) => {
    const { cardId } = request.params as { cardId: string }
    const parsed = reviewCardSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const card = await app.prisma.ideationContentCard.findUnique({ where: { id: cardId } })
    if (!card) return reply.code(404).send({ error: 'not_found' })

    const nextKol = (parsed.data.kolStatus ?? card.kolStatus) as ReviewStatus
    const nextMa = (parsed.data.maStatus ?? card.maStatus) as ReviewStatus
    // wasSeen = any prior review has been applied. We treat the card as seen
    // the moment this endpoint fires or if a prior non-'uploaded' overall
    // status already exists on the row.
    const wasSeen = card.overallStatus !== 'uploaded' ||
      nextKol !== 'pending' || nextMa !== 'pending'
    const overall = deriveOverallStatus({ kolStatus: nextKol, maStatus: nextMa, wasSeen })

    const updated = await app.prisma.ideationContentCard.update({
      where: { id: cardId },
      data: {
        kolStatus: nextKol,
        maStatus: nextMa,
        overallStatus: overall,
      },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'ideation_card_reviewed',
      entityType: 'ideation_card',
      entityId: cardId,
      details: {
        kolStatus: nextKol,
        maStatus: nextMa,
        overallStatus: overall,
        changed: Object.keys(parsed.data),
      },
      ipAddress: request.ip ?? null,
    })

    return updated
  })
}
