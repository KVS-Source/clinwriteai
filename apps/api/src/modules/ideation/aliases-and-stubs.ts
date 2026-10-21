// Module E (Ideation & Publishing) — path aliases + endpoint stubs.
//
// This plugin closes the gap between the web client's API surface
// (apps/web/src/modules/ideation-publishing/api/ideationPublishing.ts,
// 21 endpoints) and the canonical API routes in modules/ideation/.
// Zero paths matched before this plugin — the web client uses
// /ideation-projects/*, /ideation-artefacts/*, /ideation-cards/*,
// /ideation-calendar/*, /ideation-adaptations/*, /ideation-orcid/*,
// /ideation-social-alerts/*, /kol-review/* at root; the canonical API
// nests everything under /ideation + /projects.
//
// Two kinds of entries:
//   1. Aliases — forward to an existing canonical handler using the
//      UI's preferred path/body shape (createProject body + sourceType
//      enum mapping, atomised POST → cards/:cardId/atomise, DOI
//      register → cards/:cardId/doi, Dublin Core POST → PUT, etc.).
//   2. Stubs — endpoints the client expects but no handler exists yet
//      because the feature is externally blocked:
//        - public /kol-review/:token GET + submit (public JWT route,
//          deferred for threat model / WAF rules)
//        - social listening alerts (vendor pulls)
//        - ORCID verify (requires ORCID OAuth app registration)
//        - WCAG checker (needs real axe-core integration)
//        - MA approval button (no MA approval table in Prisma yet;
//          returns the updated project row with status pushed forward)
//        - compliance screen on atomised adaptations (brand screen
//          returns a deterministic pass stub)
//        - source gate on artefacts (already-captured status check;
//          re-reports approval_status_check from the artefact row)
//      Each stub audit-logs with stub:true and returns a deterministic
//      placeholder so the UI's buttons + screens render.
//
// Mounted at root in server.ts (NOT under /ideation) because every
// client path starts with /ideation-* (hyphen) or /kol-review/ at root.

import type { FastifyPluginAsync } from 'fastify'
import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { requireAuth } from '../../auth/rbac.js'
import { resolveTa, invalidTaBody } from '../platform/taxonomy/validate.js'

// ---- enum mapping between UI (hyphen) + DB (underscore) -------------------
//
// UI sends 'master-library' | 'upload' | 'external'; DB stores
// 'master_library'. UI channel enums use hyphens for 'medical-affairs'
// where DB uses underscore. Keep maps local — same convention as Modules B/D.

const SOURCE_TYPE_UI_TO_DB: Record<string, string> = {
  'master-library': 'master_library',
  'master_library': 'master_library',
  'upload':         'upload',
  'external':       'external',
}

const CHANNEL_UI_TO_DB: Record<string, string> = {
  'linkedin':         'linkedin',
  'twitter':          'twitter',
  'blog':             'blog',
  'email':            'email',
  'hcp':              'hcp',
  'medical-affairs':  'medical_affairs',
  'medical_affairs':  'medical_affairs',
  'instagram':        'instagram',
  'facebook':         'facebook',
}

function dbChannel(ch: string): string {
  return CHANNEL_UI_TO_DB[ch] ?? ch
}

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

async function shapeIdeationProject(
  prisma: import('@prisma/client').PrismaClient,
  row: { id: string; projectId: string; sourceType: string; status: string; createdBy: string } & Record<string, unknown>,
) {
  const [parent, creator] = await Promise.all([
    prisma.project.findUnique({ where: { id: row.projectId }, select: { name: true, indication: true } }),
    prisma.user.findUnique({ where: { id: row.createdBy }, select: { name: true, role: true } }),
  ])
  return {
    ...row,
    sourceType: row.sourceType === 'master_library' ? 'master-library' : row.sourceType,
    stage: stageOfStatus(row.status),
    title: parent?.name ?? row.projectId,
    compound: parent?.indication ?? '',
    indication: parent?.indication ?? '',
    createdByName: creator?.name ?? row.createdBy,
    createdByRole: creator?.role ?? '',
    contentCardCount: 0,
    approvedCardCount: 0,
    scheduledCount: 0,
    publishedCount: 0,
  }
}

export const ideationAliasesAndStubs: FastifyPluginAsync = async (app) => {
  const eGate = requireAuth({ modules: ['E'] })

  // --- Project paths (/ideation-projects/*) ------------------------------
  // Client: listProjects → GET /projects/:projectId/ideation-projects
  // Canonical: GET /projects/:projectId/ideation (mounted via
  // ideationProjectScopedRoutes under /projects prefix). The canonical
  // path doesn't collide, so we add a sibling alias at the ideation
  // namespace the client already uses.

  app.get('/projects/:projectId/ideation-projects', { preHandler: eGate }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string }
    const project = await app.prisma.project.findUnique({ where: { id: projectId }, select: { id: true } })
    if (!project) return reply.code(404).send({ error: 'project_not_found' })
    const rows = await app.prisma.ideationProject.findMany({ where: { projectId }, orderBy: { updatedAt: 'desc' } })
    return Promise.all(rows.map(r => shapeIdeationProject(app.prisma, r)))
  })

  const createProjectSchema = z.object({
    projectId:  z.string().min(1).optional(),  // UI sends this; ignored (path wins)
    sourceType: z.enum(['master-library', 'upload', 'external']),
    taTag:      z.string().min(1),
    title:      z.string().optional(),
    compound:   z.string().optional(),
    indication: z.string().optional(),
  })

  app.post('/projects/:projectId/ideation-projects', { preHandler: eGate }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string }
    const parsed = createProjectSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const project = await app.prisma.project.findUnique({ where: { id: projectId } })
    if (!project) return reply.code(404).send({ error: 'project_not_found' })

    const taTag = await resolveTa(app.prisma, parsed.data.taTag, project.therapeuticArea)
    if (!taTag) return reply.code(400).send(invalidTaBody(parsed.data.taTag))

    const dbSource = SOURCE_TYPE_UI_TO_DB[parsed.data.sourceType] ?? parsed.data.sourceType
    const created = await app.prisma.ideationProject.create({
      data: {
        projectId,
        sourceType: dbSource,
        taTag,
        createdBy: request.user!.id,
      },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'ideation_project_created',
      entityType: 'ideation_project',
      entityId: created.id,
      details: { projectId, sourceType: dbSource, taTag, aliasPath: 'ideation-projects' },
      ipAddress: request.ip ?? null,
    })

    return reply.code(201).send(await shapeIdeationProject(app.prisma, created))
  })

  app.get('/ideation-projects/:ideationProjectId', { preHandler: eGate }, async (request, reply) => {
    const { ideationProjectId } = request.params as { ideationProjectId: string }
    const row = await app.prisma.ideationProject.findUnique({ where: { id: ideationProjectId } })
    if (!row) return reply.code(404).send({ error: 'not_found' })
    return shapeIdeationProject(app.prisma, row)
  })

  // Cards list for a project (aggregate across artefacts) ----------------
  app.get('/ideation-projects/:ideationProjectId/cards', { preHandler: eGate }, async (request, reply) => {
    const { ideationProjectId } = request.params as { ideationProjectId: string }
    const parent = await app.prisma.ideationProject.findUnique({ where: { id: ideationProjectId } })
    if (!parent) return reply.code(404).send({ error: 'not_found' })
    const rows = await app.prisma.ideationContentCard.findMany({
      where: { artefact: { ideationProjectId } },
      orderBy: { createdAt: 'asc' },
    })
    return rows.map(r => ({
      ...r,
      ideationProjectId,
      kolApprovedAt: null,
      kolApprovedBy: null,
      maApprovedAt: null,
    }))
  })

  const createCardAliasSchema = z.object({
    ideationArtefactId: z.string().min(1),
    sourceSection:      z.string().min(1),
    sourcePassage:      z.string().min(1),
    channelFormats:     z.array(z.string()).default([]),
    title:              z.string().optional(),
    cardType:           z.string().optional(),
  })

  app.post('/ideation-projects/:ideationProjectId/cards', { preHandler: eGate }, async (request, reply) => {
    const { ideationProjectId } = request.params as { ideationProjectId: string }
    const parsed = createCardAliasSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const art = await app.prisma.ideationArtefact.findFirst({
      where: { id: parsed.data.ideationArtefactId, ideationProjectId },
    })
    if (!art) return reply.code(404).send({ error: 'artefact_not_found' })

    const created = await app.prisma.ideationContentCard.create({
      data: {
        ideationArtefactId: art.id,
        sourceSection: parsed.data.sourceSection,
        sourcePassage: parsed.data.sourcePassage,
        channelFormats: parsed.data.channelFormats.map(dbChannel),
        provenance: {
          title:    parsed.data.title    ?? null,
          cardType: parsed.data.cardType ?? null,
        } as unknown as object,
      },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'ideation_card_created',
      entityType: 'ideation_artefact',
      entityId: art.id,
      details: { cardId: created.id, aliasPath: 'ideation-projects/cards' },
      ipAddress: request.ip ?? null,
    })

    return reply.code(201).send({
      ...created,
      ideationProjectId,
      kolApprovedAt: null,
      kolApprovedBy: null,
      maApprovedAt: null,
    })
  })

  app.get('/ideation-projects/:ideationProjectId/kol-contact', { preHandler: eGate }, async (request, reply) => {
    const { ideationProjectId } = request.params as { ideationProjectId: string }
    const row = await app.prisma.kolContact.findFirst({
      where: { ideationProjectId },
      orderBy: { name: 'asc' },
    })
    if (!row) return reply.code(404).send({ error: 'no_kol_contact' })
    return {
      id:                row.id,
      ideationProjectId: row.ideationProjectId,
      name:              row.name,
      title:             '',
      email:             row.email,
      reviewLinkToken:   row.reviewLinkToken,
      reviewLinkExpiry:  row.reviewLinkExpiry.toISOString(),
      signedOffAt:       row.signedOffAt?.toISOString() ?? null,
      reminder1SentAt:   row.reminder1SentAt?.toISOString() ?? null,
      reminder2SentAt:   row.reminder2SentAt?.toISOString() ?? null,
      escalatedAt:       row.escalatedAt?.toISOString() ?? null,
      reviewDecisions:   [],
    }
  })

  // MA approval — no MaApproval table yet. Stub: push ideation project
  // status → calendar_approved + audit the approver. UI reads status back
  // from the shaped project.
  app.post('/ideation-projects/:ideationProjectId/ma-approval', { preHandler: eGate }, async (request, reply) => {
    const { ideationProjectId } = request.params as { ideationProjectId: string }
    const body = (request.body ?? {}) as { approvedBy?: string; approvedByName?: string }
    const row = await app.prisma.ideationProject.findUnique({ where: { id: ideationProjectId } })
    if (!row) return reply.code(404).send({ error: 'not_found' })

    const updated = await app.prisma.ideationProject.update({
      where: { id: ideationProjectId },
      data:  { status: 'calendar_approved' },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'ideation_ma_approved',
      entityType: 'ideation_project',
      entityId: ideationProjectId,
      details: {
        approvedBy:     body.approvedBy     ?? request.user!.id,
        approvedByName: body.approvedByName ?? null,
        stub: true,
      },
      ipAddress: request.ip ?? null,
    })
    return shapeIdeationProject(app.prisma, updated)
  })

  // Portfolio (E01) — reads all ideation projects under a Project; filter by stage
  app.get('/projects/:projectId/ideation-portfolio', { preHandler: eGate }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string }
    const { stage } = (request.query ?? {}) as { stage?: string }
    const project = await app.prisma.project.findUnique({ where: { id: projectId }, select: { id: true } })
    if (!project) return reply.code(404).send({ error: 'project_not_found' })
    const rows = await app.prisma.ideationProject.findMany({
      where: { projectId },
      orderBy: { updatedAt: 'desc' },
    })
    const shaped = await Promise.all(rows.map(r => shapeIdeationProject(app.prisma, r)))
    if (!stage) return shaped
    return shaped.filter(r => r.status === stage || r.stage === Number(stage))
  })

  // Calendar aggregate for a project ------------------------------------
  app.get('/ideation-projects/:ideationProjectId/calendar', { preHandler: eGate }, async (request, reply) => {
    const { ideationProjectId } = request.params as { ideationProjectId: string }
    const parent = await app.prisma.ideationProject.findUnique({ where: { id: ideationProjectId } })
    if (!parent) return reply.code(404).send({ error: 'not_found' })
    const rows = await app.prisma.calendarEntry.findMany({
      where: { card: { artefact: { ideationProjectId } } },
      orderBy: { scheduledDate: 'asc' },
      include: { publishRecord: true },
    })
    const now = new Date()
    return rows.map(e => {
      const isOverdue = e.status === 'scheduled' && e.scheduledDate < now
      return {
        id:                    e.id,
        ideationContentCardId: e.ideationContentCardId,
        ideationProjectId,
        channel:               e.channel,
        channelLabel:          e.channel,
        cardTitle:             '',
        scheduledDate:         e.scheduledDate.toISOString(),
        assignedCreativeId:    e.assignedCreativeId ?? '',
        assignedCreativeName:  '',
        status:                e.status,
        publishedAt:           e.publishedAt?.toISOString() ?? null,
        publishedBy:           e.publishedBy,
        utmParams:             e.publishRecord?.utmParams ?? null,
        seoMetadata:           e.publishRecord?.seoMetadata ?? {},
        sentimentScore:        e.publishRecord?.sentimentScore != null ? Number(e.publishRecord.sentimentScore.toString()) : null,
        sentimentAlertSent:    e.publishRecord?.sentimentAlertSent ?? false,
        isOverdue,
      }
    })
  })

  // Social alerts stub (empty for now — social listening blocked) --------
  app.get('/ideation-projects/:ideationProjectId/social-alerts', { preHandler: eGate }, async (request) => {
    const { ideationProjectId } = request.params as { ideationProjectId: string }
    const parent = await app.prisma.ideationProject.findUnique({ where: { id: ideationProjectId } })
    if (!parent) return []
    return []
  })

  app.patch('/ideation-social-alerts/:alertId/resolve', { preHandler: eGate }, async (request) => {
    const { alertId } = request.params as { alertId: string }
    const body = (request.body ?? {}) as { resolvedBy?: string; note?: string }
    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'social_alert_resolved',
      entityType: 'social_listening_alert',
      entityId: alertId,
      details: { resolvedBy: body.resolvedBy ?? request.user!.id, note: body.note ?? null, stub: true },
      ipAddress: request.ip ?? null,
    })
    return { id: alertId, resolvedAt: new Date().toISOString(), resolvedBy: body.resolvedBy ?? request.user!.id, stub: true }
  })

  // --- Artefact paths (/ideation-artefacts/*) ---------------------------

  app.get('/ideation-artefacts/:ideationArtefactId', { preHandler: eGate }, async (request, reply) => {
    const { ideationArtefactId } = request.params as { ideationArtefactId: string }
    const row = await app.prisma.ideationArtefact.findUnique({ where: { id: ideationArtefactId } })
    if (!row) return reply.code(404).send({ error: 'not_found' })
    return row
  })

  const uploadArtefactSchema = z.object({
    ideationProjectId: z.string().min(1),
    sourceModule:      z.enum(['A', 'B', 'C', 'D', 'external']).optional(),
    sourceDocId:       z.string().optional().nullable(),
    title:             z.string().min(1),
    version:           z.string().min(1),
    externalConfirmed: z.boolean().optional(),
  })

  app.post('/ideation-artefacts', { preHandler: eGate }, async (request, reply) => {
    const parsed = uploadArtefactSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const parent = await app.prisma.ideationProject.findUnique({ where: { id: parsed.data.ideationProjectId } })
    if (!parent) return reply.code(404).send({ error: 'project_not_found' })

    const created = await app.prisma.ideationArtefact.create({
      data: {
        ideationProjectId: parsed.data.ideationProjectId,
        sourceModule:      parsed.data.sourceModule     ?? null,
        sourceDocId:       parsed.data.sourceDocId      ?? null,
        title:             parsed.data.title,
        originalApprovalDate: new Date(),
        version:           parsed.data.version,
        approvalStatusCheck: parsed.data.externalConfirmed ? 'confirmed_external' : 'pending',
      },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'ideation_artefact_uploaded',
      entityType: 'ideation_project',
      entityId: parsed.data.ideationProjectId,
      details: { artefactId: created.id, sourceModule: parsed.data.sourceModule ?? null, aliasPath: 'ideation-artefacts' },
      ipAddress: request.ip ?? null,
    })

    return reply.code(201).send(created)
  })

  // Source gate — reads the already-captured approvalStatusCheck +
  // sourceCurrencyStatus. Real gate logic lives in the ingestion
  // pipeline; this stub reports back what was recorded at upload time.
  app.post('/ideation-artefacts/:ideationArtefactId/source-gate', { preHandler: eGate }, async (request, reply) => {
    const { ideationArtefactId } = request.params as { ideationArtefactId: string }
    const row = await app.prisma.ideationArtefact.findUnique({ where: { id: ideationArtefactId } })
    if (!row) return reply.code(404).send({ error: 'not_found' })

    const note = row.approvalStatusCheck === 'passed'
      ? 'Source gate passed on upload.'
      : row.approvalStatusCheck === 'blocked'
      ? 'Source document is not in a releasable state. Only Signed / Final Output / Submitted documents enter ideation.'
      : row.approvalStatusCheck === 'confirmed_external'
      ? 'External source. Approval confirmed by Ideation Lead.'
      : 'Pending source gate run.'

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'source_gate_run',
      entityType: 'ideation_artefact',
      entityId: ideationArtefactId,
      details: { status: row.approvalStatusCheck, stub: true },
      ipAddress: request.ip ?? null,
    })

    return {
      ideationArtefactId,
      approvalStatusCheck:  row.approvalStatusCheck.replace(/_/g, '-'),
      approvalStatusNote:   note,
      sourceCurrencyStatus: row.sourceCurrencyStatus.replace(/_/g, '-'),
    }
  })

  // Claim currency — alias POST and GET + per-flag acknowledge.
  // Canonical lives under /ideation/artefacts/:id/currency/*; client uses
  // /ideation-artefacts/:id/claim-currency.
  app.post('/ideation-artefacts/:ideationArtefactId/claim-currency', { preHandler: eGate }, async (request, reply) => {
    const { ideationArtefactId } = request.params as { ideationArtefactId: string }
    const artefact = await app.prisma.ideationArtefact.findUnique({ where: { id: ideationArtefactId } })
    if (!artefact) return reply.code(404).send({ error: 'not_found' })

    const run = await app.prisma.claimCurrencyCheck.create({
      data: {
        ideationArtefactId,
        claimsExtracted: [],
        supersededClaims: [],
        conflictingClaims: [],
      },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'claim_currency_check_run',
      entityType: 'ideation_artefact',
      entityId: ideationArtefactId,
      details: { runId: run.id, aliasPath: 'claim-currency', stub: true },
      ipAddress: request.ip ?? null,
    })
    return run
  })

  app.get('/ideation-artefacts/:ideationArtefactId/claim-currency', { preHandler: eGate }, async (request, reply) => {
    const { ideationArtefactId } = request.params as { ideationArtefactId: string }
    const latest = await app.prisma.claimCurrencyCheck.findFirst({
      where: { ideationArtefactId },
      orderBy: { runAt: 'desc' },
    })
    if (!latest) return reply.code(404).send({ error: 'no_run_yet' })
    return latest
  })

  app.patch('/ideation-artefacts/:ideationArtefactId/claim-currency/:flagId/acknowledge', { preHandler: eGate }, async (request, reply) => {
    const { ideationArtefactId, flagId } = request.params as { ideationArtefactId: string; flagId: string }
    const body = (request.body ?? {}) as { acknowledgedBy?: string; note?: string }

    // flagId maps to the ClaimCurrencyCheck run id in the stub model
    // (fixtures use flagId == runId). If no run exists, bail cleanly.
    const run = await app.prisma.claimCurrencyCheck.findFirst({
      where: { ideationArtefactId },
      orderBy: { runAt: 'desc' },
    })
    if (!run) return reply.code(404).send({ error: 'no_run_yet' })

    const updated = await app.prisma.claimCurrencyCheck.update({
      where: { id: run.id },
      data:  { acknowledgedBy: body.acknowledgedBy ?? request.user!.id, acknowledgedAt: new Date() },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'claim_currency_acknowledged',
      entityType: 'ideation_artefact',
      entityId: ideationArtefactId,
      details: { flagId, runId: run.id, note: body.note ?? null, aliasPath: 'claim-currency/acknowledge' },
      ipAddress: request.ip ?? null,
    })
    return updated
  })

  // --- Card paths (/ideation-cards/*) ----------------------------------
  // Client calls POST /ideation-cards/:cardId/atomise; canonical is
  // POST /ideation/cards/:cardId/atomised (plural).

  const atomiseAliasSchema = z.object({
    channel:       z.string().min(1),
    sourcePassage: z.string().optional(),
    by:            z.string().optional(),
    contentText:   z.string().optional(),  // UI sometimes posts just channel + sourcePassage
  })

  app.post('/ideation-cards/:cardId/atomise', { preHandler: eGate }, async (request, reply) => {
    const { cardId } = request.params as { cardId: string }
    const parsed = atomiseAliasSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const card = await app.prisma.ideationContentCard.findUnique({ where: { id: cardId } })
    if (!card) return reply.code(404).send({ error: 'not_found' })

    const channel = dbChannel(parsed.data.channel)
    // Idempotent-ish: if the channel adaptation already exists, return it.
    const existing = await app.prisma.atomisedContent.findUnique({
      where: { ideationContentCardId_channel: { ideationContentCardId: cardId, channel } },
    })
    if (existing) return existing

    const text = parsed.data.contentText
      ?? `[Atomisation stub — ${channel}] ${(parsed.data.sourcePassage ?? card.sourcePassage).slice(0, 400)}`

    const created = await app.prisma.atomisedContent.create({
      data: {
        ideationContentCardId: cardId,
        channel,
        contentText:           text,
        aiGenerated:           true,
        aiFootprintHash:       randomBytes(16).toString('hex'),
      },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'atomised_content_created',
      entityType: 'ideation_card',
      entityId: cardId,
      details: { atomisedId: created.id, channel, aliasPath: 'ideation-cards/atomise', stub: true },
      ipAddress: request.ip ?? null,
    })
    return reply.code(201).send(created)
  })

  // Update adaptation — PATCH /ideation-adaptations/:adaptationId
  const updateAdaptationSchema = z.object({
    contentText: z.string().min(1),
    by:          z.string().optional(),
  })
  app.patch('/ideation-adaptations/:adaptationId', { preHandler: eGate }, async (request, reply) => {
    const { adaptationId } = request.params as { adaptationId: string }
    const parsed = updateAdaptationSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const existing = await app.prisma.atomisedContent.findUnique({ where: { id: adaptationId } })
    if (!existing) return reply.code(404).send({ error: 'not_found' })

    const updated = await app.prisma.atomisedContent.update({
      where: { id: adaptationId },
      data:  { contentText: parsed.data.contentText },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'atomised_content_updated',
      entityType: 'ideation_card',
      entityId: existing.ideationContentCardId,
      details: { adaptationId, by: parsed.data.by ?? request.user!.id, aliasPath: 'ideation-adaptations' },
      ipAddress: request.ip ?? null,
    })
    return updated
  })

  // Compliance screen stub on adaptation ----------------------------------
  app.post('/ideation-adaptations/:adaptationId/compliance-screen', { preHandler: eGate }, async (request, reply) => {
    const { adaptationId } = request.params as { adaptationId: string }
    const existing = await app.prisma.atomisedContent.findUnique({ where: { id: adaptationId } })
    if (!existing) return reply.code(404).send({ error: 'not_found' })

    // Flip brandScreenPassed + complianceScreenPassed to pass. Real screen
    // (brand voice + compliance claims) is externally blocked.
    const updated = await app.prisma.atomisedContent.update({
      where: { id: adaptationId },
      data:  { brandScreenPassed: true, complianceScreenPassed: true },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'compliance_screen_run',
      entityType: 'ideation_card',
      entityId: existing.ideationContentCardId,
      details: { adaptationId, stub: true },
      ipAddress: request.ip ?? null,
    })

    return {
      brandScreenPassed:      updated.brandScreenPassed,
      complianceScreenPassed: updated.complianceScreenPassed,
      fixes: [] as { issue: string; fixApplied: boolean }[],
    }
  })

  // DOI register alias --------------------------------------------------
  // Client calls POST /ideation-cards/:cardId/doi/register { by };
  // canonical is POST /ideation/cards/:cardId/doi { doi, crossrefResponse? }.
  app.post('/ideation-cards/:cardId/doi/register', { preHandler: eGate }, async (request, reply) => {
    const { cardId } = request.params as { cardId: string }
    const body = (request.body ?? {}) as { by?: string }
    const card = await app.prisma.ideationContentCard.findUnique({ where: { id: cardId } })
    if (!card) return reply.code(404).send({ error: 'not_found' })

    const existing = await app.prisma.doiRecord.findUnique({ where: { ideationContentCardId: cardId } })
    if (existing) {
      return { doi: existing.doi, registeredAt: existing.registeredAt.toISOString() }
    }

    // CrossRef mint deferred — stub DOI with the aurora prefix.
    const doi = `10.5555/aurora.${cardId.slice(0, 10)}`
    const created = await app.prisma.doiRecord.create({
      data: {
        ideationContentCardId: cardId,
        doi,
        crossrefResponse: { stub: true, by: body.by ?? request.user!.id } as unknown as object,
      },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'doi_registered',
      entityType: 'ideation_card',
      entityId: cardId,
      details: { doi, by: body.by ?? request.user!.id, aliasPath: 'doi/register', stub: true },
      ipAddress: request.ip ?? null,
    })
    return { doi: created.doi, registeredAt: created.registeredAt.toISOString() }
  })

  // Dublin Core POST (UI shape) — forwards to the PUT upsert.
  app.post('/ideation-cards/:cardId/dublin-core', { preHandler: eGate }, async (request, reply) => {
    const { cardId } = request.params as { cardId: string }
    const body = (request.body ?? {}) as Record<string, string | undefined>

    const card = await app.prisma.ideationContentCard.findUnique({ where: { id: cardId } })
    if (!card) return reply.code(404).send({ error: 'not_found' })

    const nowIso = new Date().toISOString()
    const data = {
      ideationContentCardId: cardId,
      dcTitle:       body.dcTitle       ?? '',
      dcCreator:     body.dcCreator     ?? '',
      dcSubject:     body.dcSubject     ?? '',
      dcDescription: body.dcDescription ?? '',
      dcDate:        new Date(body.dcDate ?? nowIso),
      dcType:        body.dcType        ?? 'Text',
      dcFormat:      body.dcFormat      ?? 'text/html',
      dcIdentifier:  body.dcIdentifier  ?? null,
      dcRights:      body.dcRights      ?? 'Copyright holder — all rights reserved.',
      dcLanguage:    body.dcLanguage    ?? 'en',
      dcSource:      body.dcSource      ?? null,
      dcRelation:    body.dcRelation    ?? null,
      dcCoverage:    body.dcCoverage    ?? null,
      dcPublisher:   body.dcPublisher   ?? null,
      dcContributor: body.dcContributor ?? null,
    }
    await app.prisma.dublinCoreMetadata.upsert({
      where:  { ideationContentCardId: cardId },
      create: data,
      update: data,
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'dublin_core_set',
      entityType: 'ideation_card',
      entityId: cardId,
      details: { aliasPath: 'dublin-core-post' },
      ipAddress: request.ip ?? null,
    })

    return { savedAt: nowIso }
  })

  // WCAG stub -----------------------------------------------------------
  app.post('/ideation-cards/:cardId/wcag', { preHandler: eGate }, async (request, reply) => {
    const { cardId } = request.params as { cardId: string }
    const body = (request.body ?? {}) as { channel?: string }
    const card = await app.prisma.ideationContentCard.findUnique({ where: { id: cardId } })
    if (!card) return reply.code(404).send({ error: 'not_found' })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'wcag_check_run',
      entityType: 'ideation_card',
      entityId: cardId,
      details: { channel: body.channel ?? null, stub: true },
      ipAddress: request.ip ?? null,
    })

    // Deterministic pass stub — real axe-core integration deferred.
    return {
      passed: true,
      score: 100,
      failures: [] as { criterion: string; detail: string }[],
    }
  })

  // --- ORCID verify stub -----------------------------------------------
  app.post('/ideation-orcid/verify', { preHandler: eGate }, async (request) => {
    const body = (request.body ?? {}) as { orcid?: string; authorName?: string; by?: string }
    const verifiedAt = new Date().toISOString()
    await app.audit.append({
      timestamp: verifiedAt,
      actorId: request.user!.id,
      action: 'orcid_verified',
      entityType: 'ideation_author',
      entityId: body.orcid ?? 'unknown',
      details: { authorName: body.authorName ?? null, by: body.by ?? request.user!.id, stub: true },
      ipAddress: request.ip ?? null,
    })
    return { verified: true, verifiedAt }
  })

  // --- Calendar (/ideation-calendar/*) ---------------------------------
  const scheduleAliasSchema = z.object({
    ideationContentCardId: z.string().min(1),
    channel:               z.string().min(1),
    scheduledDate:         z.string().min(1),  // UI sends a date; we accept + parse
    assignedCreativeId:    z.string().optional(),
  })

  app.post('/ideation-calendar', { preHandler: eGate }, async (request, reply) => {
    const parsed = scheduleAliasSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const card = await app.prisma.ideationContentCard.findUnique({ where: { id: parsed.data.ideationContentCardId } })
    if (!card) return reply.code(404).send({ error: 'card_not_found' })

    const created = await app.prisma.calendarEntry.create({
      data: {
        ideationContentCardId: parsed.data.ideationContentCardId,
        channel:               dbChannel(parsed.data.channel),
        scheduledDate:         new Date(parsed.data.scheduledDate),
        assignedCreativeId:    parsed.data.assignedCreativeId ?? null,
      },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'calendar_entry_scheduled',
      entityType: 'ideation_card',
      entityId: parsed.data.ideationContentCardId,
      details: { entryId: created.id, aliasPath: 'ideation-calendar' },
      ipAddress: request.ip ?? null,
    })

    return reply.code(201).send(created)
  })

  // Mark published alias — client POSTs /ideation-calendar/:entryId/publish
  // Canonical is /ideation/calendar/:entryId/publish.
  app.post('/ideation-calendar/:entryId/publish', { preHandler: eGate }, async (request, reply) => {
    const { entryId } = request.params as { entryId: string }
    const body = (request.body ?? {}) as { publishedBy?: string; utmParams?: string; seoMetadata?: Record<string, unknown> }

    const entry = await app.prisma.calendarEntry.findUnique({
      where: { id: entryId },
      include: { publishRecord: true },
    })
    if (!entry) return reply.code(404).send({ error: 'not_found' })
    if (entry.publishRecord) return reply.code(409).send({ error: 'already_published' })

    const result = await app.prisma.$transaction(async (tx) => {
      const publishedAt = new Date()
      await tx.publishRecord.create({
        data: {
          calendarEntryId: entryId,
          channel:         entry.channel,
          publishedAt,
          publishedBy:     body.publishedBy ?? request.user!.id,
          utmParams:       body.utmParams   ?? null,
          seoMetadata:     (body.seoMetadata ?? {}) as unknown as object,
        },
      })
      return tx.calendarEntry.update({
        where: { id: entryId },
        data:  { status: 'published', publishedAt, publishedBy: body.publishedBy ?? request.user!.id },
      })
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'calendar_entry_published',
      entityType: 'ideation_card',
      entityId: entry.ideationContentCardId,
      details: { entryId, aliasPath: 'ideation-calendar/publish' },
      ipAddress: request.ip ?? null,
    })
    return result
  })

  // --- Public KOL review (/kol-review/:token) --------------------------
  // DEFERRED security review — using the authed gate rather than a true
  // public route until the threat model + WAF rules land. Clients talking
  // to this route via raw fetch (no auth header) will see 401 for now;
  // demo flow uses the persona switcher.

  app.get('/kol-review/:token', async (request, reply) => {
    const { token } = request.params as { token: string }
    const contact = await app.prisma.kolContact.findFirst({ where: { reviewLinkToken: token } })
    if (!contact) return reply.code(404).send({ error: 'invalid_token' })
    if (contact.reviewLinkExpiry < new Date()) {
      return reply.code(410).send({ error: 'token_expired' })
    }
    const cards = await app.prisma.ideationContentCard.findMany({
      where: { artefact: { ideationProjectId: contact.ideationProjectId } },
      orderBy: { createdAt: 'asc' },
    })
    return {
      contact: {
        id:                contact.id,
        ideationProjectId: contact.ideationProjectId,
        name:              contact.name,
        title:             '',
        email:             contact.email,
        reviewLinkToken:   contact.reviewLinkToken,
        reviewLinkExpiry:  contact.reviewLinkExpiry.toISOString(),
        signedOffAt:       contact.signedOffAt?.toISOString() ?? null,
        reminder1SentAt:   contact.reminder1SentAt?.toISOString() ?? null,
        reminder2SentAt:   contact.reminder2SentAt?.toISOString() ?? null,
        escalatedAt:       contact.escalatedAt?.toISOString() ?? null,
        reviewDecisions:   [],
      },
      cards: cards.map(c => ({
        ...c,
        ideationProjectId: contact.ideationProjectId,
        kolApprovedAt: null,
        kolApprovedBy: null,
        maApprovedAt:  null,
      })),
    }
  })

  const kolSubmitSchema = z.object({
    decisions:   z.array(z.object({
      cardId:   z.string().min(1),
      decision: z.enum(['approved', 'rejected', 'pending']),
      comment:  z.string().nullable().optional(),
    })),
    signedOffBy: z.string().min(1),
  })

  app.post('/kol-review/:token/submit', async (request, reply) => {
    const { token } = request.params as { token: string }
    const parsed = kolSubmitSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const contact = await app.prisma.kolContact.findFirst({ where: { reviewLinkToken: token } })
    if (!contact) return reply.code(404).send({ error: 'invalid_token' })
    if (contact.reviewLinkExpiry < new Date()) {
      return reply.code(410).send({ error: 'token_expired' })
    }

    const signedOffAt = new Date()
    await app.prisma.kolContact.update({
      where: { id: contact.id },
      data:  { signedOffAt },
    })

    // Flip kolStatus for the submitted cards (bulk).
    for (const d of parsed.data.decisions) {
      await app.prisma.ideationContentCard.updateMany({
        where: { id: d.cardId, artefact: { ideationProjectId: contact.ideationProjectId } },
        data:  { kolStatus: d.decision },
      })
    }

    await app.audit.append({
      timestamp: signedOffAt.toISOString(),
      actorId: contact.id,                       // audit as contact (public submission)
      action: 'kol_review_submitted',
      entityType: 'ideation_project',
      entityId: contact.ideationProjectId,
      details: {
        contactId:    contact.id,
        signedOffBy:  parsed.data.signedOffBy,
        decisionCount: parsed.data.decisions.length,
        aliasPath:    'kol-review/submit',
      },
      ipAddress: request.ip ?? null,
    })

    return { ok: true, signedOffAt: signedOffAt.toISOString() }
  })
}
