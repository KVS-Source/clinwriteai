// Module C content item routes.
//
// Endpoints landed this batch (API contract §30):
//   GET  /projects/:projectId/med-content
//   GET  /med-content/:contentId
//   POST /projects/:projectId/med-content
//   PATCH /med-content/:contentId
//   POST /med-content/:contentId/advance-stage
//   POST /med-content/:contentId/archive
//
// Business rules enforced here:
//   - compliance_track is locked from stage 2 onward (DD-C-001). PATCH 422s
//     if the client tries to change it after stage 2.
//   - ta_tag is mandatory and inherited at creation.
//   - Final output (stage 6, approved) items cannot be archived — 422.
//   - Advancing from stage 3→4 for patient-facing types requires fkPassed=true
//     (fk-score records populated by Batch 4).
//   - Advancing to stage 6 (approved) sets approved_at + expiry_date (+24m).

import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { requireAuth } from '../../../auth/rbac.js'
import {
  complianceTrackIsLocked,
  nextContentStage,
  STAGE_LABELS,
  type ContentStage,
} from '../content-stage.js'

const PATIENT_FACING_TYPES: ReadonlySet<string> = new Set([
  'pil', 'pls_eu_ctr', 'patient_education',
])

// UI sends type in hyphen-case (hcp-slide-deck); DB stores snake_case.
// UI sends complianceTrack in short form (mlr | accme); DB stores
// promotional | non_promotional | cme | advisory. Translate both so the
// web New-content panel can submit the UI vocab directly.
const UI_TYPE_TO_DB: Record<string, string> = {
  'hcp-slide-deck': 'hcp_slide_deck', 'mi-letter': 'mi_letter', 'pil': 'pil',
  'cme-module': 'cme_module', 'disease-dossier': 'disease_dossier',
  'eu-ctr-pls': 'eu_ctr_pls', 'advisory-report': 'advisory_report',
}
const UI_TRACK_TO_DB: Record<string, string> = {
  mlr: 'promotional', accme: 'cme',
  promotional: 'promotional', non_promotional: 'non_promotional',
  cme: 'cme', advisory: 'advisory',
}
const createSchema = z.object({
  type: z.string().min(1),
  title: z.string().min(1),
  sourceModuleAProjectId: z.string().optional(),   // defaults to :projectId from URL
  sourceModuleBPubId: z.string().optional(),
  complianceTrack: z.string().optional(),          // accepts UI's 'mlr' | 'accme' too; defaults to 'promotional'
  taTag: z.string().min(1),
  channels: z.array(z.string()).default([]),
  targetAudience: z.array(z.string()).default([]),
  ownerId: z.string().optional(),                   // defaults to creator
})

const patchSchema = z.object({
  title: z.string().min(1).optional(),
  complianceTrack: z.enum(['promotional', 'non_promotional', 'cme', 'advisory']).optional(),
  taTag: z.string().min(1).optional(),
  channels: z.array(z.string()).optional(),
  targetAudience: z.array(z.string()).optional(),
  ownerId: z.string().optional(),
})

const archiveSchema = z.object({
  reason: z.string().min(3, 'An archive reason is required (audit trail)'),
})

const listQuerySchema = z.object({
  status: z.string().optional(),
  type: z.string().optional(),
  taTag: z.string().optional(),
})

// Shape med-content rows for the UI's packages/types `MedContentItem`
// interface. Name + type mismatches between Prisma + UI we fix here:
//   - Prisma `tierOverriddenBy`        → UI `reviewTierOverriddenBy`
//   - Prisma `sourceModuleBPubId`      → UI `sourceModuleBPublicationId`
//   - Prisma `reviewTier` string A|B|C → UI numeric 1|2|3 (ReviewTier type)
// UI also expects aiFootprintPct as number-not-null; Prisma stores Int?,
// so we default to 0 when null (matches "no AI assist" semantics).
const TIER_DB_TO_UI: Record<string, 1 | 2 | 3> = { A: 1, B: 2, C: 3 }
export function medContentShape(m: {
  tierOverriddenBy: string | null
  sourceModuleBPubId: string | null
  aiFootprintPct: number | null
  reviewTier: string | null
} & Record<string, unknown>) {
  const { tierOverriddenBy, sourceModuleBPubId, aiFootprintPct, reviewTier, ...rest } = m
  return {
    ...rest,
    reviewTier: reviewTier ? (TIER_DB_TO_UI[reviewTier] ?? null) : null,
    reviewTierOverriddenBy: tierOverriddenBy,
    sourceModuleBPublicationId: sourceModuleBPubId,
    aiFootprintPct: aiFootprintPct ?? 0,
  }
}

export const TIER_UI_TO_DB: Record<number, 'A' | 'B' | 'C'> = { 1: 'A', 2: 'B', 3: 'C' }

export const medContentProjectScopedRoutes: FastifyPluginAsync = async (app) => {
  app.get('/:projectId/med-content', { preHandler: requireAuth({ modules: ['C'] }) }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string }
    const parsed = listQuerySchema.safeParse(request.query)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', message: parsed.error.issues[0]?.message ?? 'invalid request body', issues: parsed.error.issues })

    const project = await app.prisma.project.findUnique({ where: { id: projectId } })
    if (!project) return reply.code(404).send({ error: 'project_not_found' })

    const rows = await app.prisma.medContentItem.findMany({
      where: {
        projectId,
        archivedAt: null,
        ...(parsed.data.status && { status: parsed.data.status }),
        ...(parsed.data.type && { type: parsed.data.type }),
        ...(parsed.data.taTag && { taTag: parsed.data.taTag }),
      },
      orderBy: { updatedAt: 'desc' },
    })
    return rows.map(medContentShape)
  })

  app.post('/:projectId/med-content', { preHandler: requireAuth({ modules: ['C'] }) }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string }
    const parsed = createSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', message: parsed.error.issues[0]?.message ?? 'invalid request body', issues: parsed.error.issues })

    const project = await app.prisma.project.findUnique({ where: { id: projectId } })
    if (!project) return reply.code(404).send({ error: 'project_not_found' })

    const srcProjectId = parsed.data.sourceModuleAProjectId ?? projectId
    const srcA = await app.prisma.project.findUnique({ where: { id: srcProjectId } })
    if (!srcA) return reply.code(400).send({ error: 'validation', message: 'sourceModuleAProjectId not found' })

    if (parsed.data.sourceModuleBPubId) {
      const srcB = await app.prisma.publication.findUnique({ where: { id: parsed.data.sourceModuleBPubId } })
      if (!srcB) return reply.code(400).send({ error: 'validation', message: 'sourceModuleBPubId not found' })
    }

    const dbType  = UI_TYPE_TO_DB[parsed.data.type]  ?? parsed.data.type
    const dbTrack = UI_TRACK_TO_DB[parsed.data.complianceTrack ?? 'promotional'] ?? 'promotional'

    const created = await app.prisma.medContentItem.create({
      data: {
        projectId,
        sourceModuleAProjectId: srcProjectId,
        sourceModuleBPubId: parsed.data.sourceModuleBPubId ?? null,
        type: dbType,
        title: parsed.data.title,
        complianceTrack: dbTrack,
        taTag: parsed.data.taTag,
        channels: parsed.data.channels,
        targetAudience: parsed.data.targetAudience,
        ownerId: parsed.data.ownerId ?? request.user!.id,
        createdBy: request.user!.id,
      },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'med_content_created',
      entityType: 'med_content',
      entityId: created.id,
      details: {
        projectId,
        type: created.type,
        title: created.title,
        complianceTrack: created.complianceTrack,
        taTag: created.taTag,
      },
      ipAddress: request.ip ?? null,
    })

    return reply.code(201).send(medContentShape(created))
  })

  // Portfolio = same list but with the optional ?scope filter the UI's
  // ContentPortfolio screen passes. Implemented as a thin wrapper so the
  // UI route lands end-to-end; richer analytics (channel/TA/status roll-ups)
  // can swap in without breaking the client contract.
  app.get('/:projectId/med-content/portfolio', { preHandler: requireAuth({ modules: ['C'] }) }, async (request) => {
    const { projectId } = request.params as { projectId: string }
    const { scope } = (request.query ?? {}) as { scope?: string }
    const rows = await app.prisma.medContentItem.findMany({
      where: {
        projectId,
        archivedAt: null,
        ...(scope === 'approved' && { status: 'approved' }),
        ...(scope === 'in_mlr_review' && { status: 'in_mlr_review' }),
        ...(scope === 'in_authoring' && { status: 'in_authoring' }),
      },
      orderBy: { updatedAt: 'desc' },
    })
    return rows.map(medContentShape)
  })
}

export const medContentRoutes: FastifyPluginAsync = async (app) => {
  app.get('/:contentId', { preHandler: requireAuth({ modules: ['C'] }) }, async (request, reply) => {
    const { contentId } = request.params as { contentId: string }
    const item = await app.prisma.medContentItem.findUnique({ where: { id: contentId } })
    if (!item || item.archivedAt) return reply.code(404).send({ error: 'not_found' })
    return medContentShape(item)
  })

  app.patch('/:contentId', { preHandler: requireAuth({ modules: ['C'] }) }, async (request, reply) => {
    const { contentId } = request.params as { contentId: string }
    const parsed = patchSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', message: parsed.error.issues[0]?.message ?? 'invalid request body', issues: parsed.error.issues })

    const existing = await app.prisma.medContentItem.findUnique({ where: { id: contentId } })
    if (!existing || existing.archivedAt) return reply.code(404).send({ error: 'not_found' })

    // DD-C-001: compliance_track is locked once stage 2+ is reached.
    if (
      parsed.data.complianceTrack !== undefined &&
      parsed.data.complianceTrack !== existing.complianceTrack &&
      complianceTrackIsLocked(existing.stage as ContentStage)
    ) {
      return reply.code(422).send({
        error: 'compliance_track_locked',
        message: `compliance_track cannot be changed after stage 2 (currently stage ${existing.stage}). DD-C-001.`,
      })
    }

    const updated = await app.prisma.medContentItem.update({
      where: { id: contentId },
      data: parsed.data,
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'med_content_updated',
      entityType: 'med_content',
      entityId: contentId,
      details: { changedFields: Object.keys(parsed.data) },
      ipAddress: request.ip ?? null,
    })

    return medContentShape(updated)
  })

  app.post('/:contentId/advance-stage', { preHandler: requireAuth({ modules: ['C'] }) }, async (request, reply) => {
    const { contentId } = request.params as { contentId: string }
    const item = await app.prisma.medContentItem.findUnique({ where: { id: contentId } })
    if (!item || item.archivedAt) return reply.code(404).send({ error: 'not_found' })

    const from = item.stage as ContentStage
    const to = nextContentStage(from)
    if (!to) {
      return reply.code(422).send({
        error: 'terminal',
        message: `Content is at terminal stage ${from} (${STAGE_LABELS[from]})`,
      })
    }

    // Stage 3→4 gate for patient-facing types: must have the latest FK score
    // passing. fkScore records populate in Batch 4; items with no fk score
    // yet get a 422 pointing at the missing data.
    if (from === 3 && PATIENT_FACING_TYPES.has(item.type)) {
      if (item.fkPassed !== true) {
        return reply.code(422).send({
          error: 'fk_fail',
          message: `Patient-facing content (${item.type}) must have a passing FK score before advancing to MLR submission. Run POST /fk-score first.`,
        })
      }
    }

    const data: Record<string, unknown> = { stage: to }
    if (to === 6) {
      const now = new Date()
      const expiry = new Date(now)
      expiry.setMonth(expiry.getMonth() + 24)
      data.approvedAt = now
      data.expiryDate = expiry
      data.status = 'approved'
    }

    const updated = await app.prisma.medContentItem.update({
      where: { id: contentId },
      data,
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'med_content_stage_advanced',
      entityType: 'med_content',
      entityId: contentId,
      details: { from, to, fromLabel: STAGE_LABELS[from], toLabel: STAGE_LABELS[to] },
      ipAddress: request.ip ?? null,
    })

    return medContentShape(updated)
  })

  app.post('/:contentId/archive', { preHandler: requireAuth({ modules: ['C'] }) }, async (request, reply) => {
    const { contentId } = request.params as { contentId: string }
    const parsed = archiveSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', message: parsed.error.issues[0]?.message ?? 'invalid request body', issues: parsed.error.issues })

    const item = await app.prisma.medContentItem.findUnique({ where: { id: contentId } })
    if (!item) return reply.code(404).send({ error: 'not_found' })

    // Final output items (stage 6) cannot be archived — they're the live
    // approved asset that MLR + legal are relying on.
    if (item.stage === 6 && !item.archivedAt) {
      return reply.code(422).send({
        error: 'final_output_locked',
        message: 'Approved (stage 6) items cannot be archived while still active',
      })
    }

    const updated = await app.prisma.medContentItem.update({
      where: { id: contentId },
      data: {
        archivedAt: new Date(),
        archiveReason: parsed.data.reason,
        status: 'archived',
      },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'med_content_archived',
      entityType: 'med_content',
      entityId: contentId,
      details: { reason: parsed.data.reason, finalStage: item.stage },
      ipAddress: request.ip ?? null,
    })

    return medContentShape(updated)
  })

  // --- Final output bundle (stage 6 summary screen) --------------------
  // Returns the content item + a derived list of "library cards" + an
  // expiry record + an approvals list sourced from signatures/decisions.
  // Library cards are a stub (one card per channel the content ships to)
  // until the Master Library data model lands. Approvals derive from the
  // latest MLR decision record.
  app.get('/:contentId/final', { preHandler: requireAuth({ modules: ['C'] }) }, async (request, reply) => {
    const { contentId } = request.params as { contentId: string }
    const item = await app.prisma.medContentItem.findUnique({ where: { id: contentId } })
    if (!item) return reply.code(404).send({ error: 'not_found' })

    const decision = await app.prisma.mlrDecisionRecord.findFirst({
      where: { contentItemId: contentId },
      orderBy: { timestampUtc: 'desc' },
    })

    const libraryCards = (item.channels ?? []).map((channel, idx) => ({
      id: `lib-${contentId}-${idx}`,
      channel,
      title: `${item.title} — ${channel}`,
      taTag: item.taTag,
      status: item.status === 'approved' ? 'live' : 'draft',
      pushedAt: item.approvedAt?.toISOString() ?? null,
    }))

    const expiryRecord = item.expiryDate ? {
      contentItemId: contentId,
      expiryDate: item.expiryDate.toISOString().slice(0, 10),
      daysToExpiry: Math.ceil((item.expiryDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)),
      alertRecipients: [],
    } : null

    const approvals = decision ? [{
      name:      decision.decidedByName,
      role:      decision.decidedByRole,
      decidedAt: decision.timestampUtc.toISOString(),
    }] : []

    return {
      contentItem: medContentShape(item),
      libraryCards,
      expiryRecord,
      approvals,
    }
  })

  // --- KOL session (stub) ---------------------------------------------
  // Returns a deterministic placeholder session shape so sPM02 (KOL
  // Advisory Board Session screen) renders without a hard dependency on
  // the real session schema. Replace when the KOL session data model
  // lands (project_phase_3c_deferrals).
  app.get('/:contentId/kol-session', { preHandler: requireAuth({ modules: ['C'] }) }, async (request, reply) => {
    const { contentId } = request.params as { contentId: string }
    const item = await app.prisma.medContentItem.findUnique({ where: { id: contentId } })
    if (!item) return reply.code(404).send({ error: 'not_found' })

    return {
      id: `kol-${contentId}`,
      contentItemId: contentId,
      scheduledFor: null,
      meetingType: 'virtual',
      attendees: [],
      transcriptUploadedAt: null,
      insightsReportGeneratedAt: null,
      status: 'planned',
    }
  })

  // --- WCAG + locales stubs (sPM05 Formatting & Accessibility) --------
  // axe-core integration deferred (project_phase_3c_deferrals). These
  // stubs return deterministic shapes so the UI renders instead of
  // falling through to a 404.
  app.post('/:contentId/wcag/run', { preHandler: requireAuth({ modules: ['C'] }) }, async (request, reply) => {
    const { contentId } = request.params as { contentId: string }
    const item = await app.prisma.medContentItem.findUnique({ where: { id: contentId } })
    if (!item) return reply.code(404).send({ error: 'not_found' })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'wcag_run',
      entityType: 'med_content',
      entityId: contentId,
      details: { stub: true },
      ipAddress: request.ip ?? null,
    })

    return {
      runAt: new Date().toISOString(),
      passed: false,
      score: 92,
      failures: [
        {
          id: `wcag-${contentId}-1`,
          slide: 'Slide 22',
          rule: 'color-contrast',
          wcagRef: '1.4.3',
          detail: 'Caption text contrast 3.1:1 — below the 4.5:1 AA minimum.',
          fixed: false,
          fixedBy: null,
          fixedAt: null,
        },
      ],
      stub: true,
    }
  })

  app.patch('/:contentId/wcag/failures/:failureId/fix', { preHandler: requireAuth({ modules: ['C'] }) }, async (request) => {
    const { contentId, failureId } = request.params as { contentId: string; failureId: string }
    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'wcag_failure_fixed',
      entityType: 'med_content',
      entityId: contentId,
      details: { failureId, stub: true },
      ipAddress: request.ip ?? null,
    })
    return { fixedAt: new Date().toISOString() }
  })

  app.get('/:contentId/locales', { preHandler: requireAuth({ modules: ['C'] }) }, async (request, reply) => {
    const { contentId } = request.params as { contentId: string }
    const item = await app.prisma.medContentItem.findUnique({ where: { id: contentId } })
    if (!item) return reply.code(404).send({ error: 'not_found' })
    // Shared Master Library model (SME direction, 2026-10-05) — primary
    // locale is enabled, others are available but not yet translated.
    return [
      { code: 'en-GB', label: 'English (UK) — primary', enabled: true,  status: 'approved' },
      { code: 'en-US', label: 'English (US)',           enabled: false, status: 'available' },
      { code: 'de-DE', label: 'German (DE)',            enabled: false, status: 'available' },
      { code: 'fr-FR', label: 'French (FR)',            enabled: false, status: 'available' },
      { code: 'es-ES', label: 'Spanish (ES)',           enabled: false, status: 'available' },
    ]
  })

  // --- AI suggest (stub) ---------------------------------------------
  // Deterministic stub pending the Anthropic connector (Arc 8.1).
  app.post('/:contentId/ai-suggest', { preHandler: requireAuth({ modules: ['C'] }) }, async (request, reply) => {
    const { contentId } = request.params as { contentId: string }
    const body = (request.body ?? {}) as { sectionId?: string; prompt?: string }
    const item = await app.prisma.medContentItem.findUnique({ where: { id: contentId } })
    if (!item) return reply.code(404).send({ error: 'not_found' })
    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'ai_suggest_generated',
      entityType: 'med_content',
      entityId: contentId,
      details: { sectionId: body.sectionId, model: 'stub-advisor-v1' },
      ipAddress: request.ip ?? null,
    })
    return {
      responseText:
        `[AI stub — Anthropic connector pending] Suggested wording for ${body.sectionId ?? 'this section'}: ` +
        `Veloricept + pembrolizumab significantly improved PFS vs pembrolizumab alone (HR 0.61; 95% CI 0.48–0.77; p<0.001), ` +
        `with a safety profile consistent with pembrolizumab monotherapy.`,
      aiModel: 'stub-advisor-v1',
      generatedAt: new Date().toISOString(),
    }
  })

  // --- Library push (stub) --------------------------------------------
  // Master Library push: records an audit event and returns pushed card
  // count. Real Master Library persistence lands when the shared card
  // table + versioning model lands (project_phase_3c_deferrals A3).
  app.post('/:contentId/library/push', { preHandler: requireAuth({ modules: ['C'] }) }, async (request, reply) => {
    const { contentId } = request.params as { contentId: string }
    const body = (request.body ?? {}) as { cardIds?: string[]; pushedBy?: string }
    const item = await app.prisma.medContentItem.findUnique({ where: { id: contentId } })
    if (!item) return reply.code(404).send({ error: 'not_found' })
    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'library_push',
      entityType: 'med_content',
      entityId: contentId,
      details: { cardCount: body.cardIds?.length ?? 0, stub: true },
      ipAddress: request.ip ?? null,
    })
    return { pushedAt: new Date().toISOString(), cardCount: body.cardIds?.length ?? 0 }
  })
}

// --- KOL session non-contentId-scoped routes (upload transcript,
// generate insights). Mounted at /kol-sessions in server.ts. Separate
// plugin because the base path differs from the other Module C routes.
export const kolSessionRoutes: FastifyPluginAsync = async (app) => {
  app.post('/:sessionId/transcript', { preHandler: requireAuth({ modules: ['C'] }) }, async (request) => {
    const { sessionId } = request.params as { sessionId: string }
    const body = (request.body ?? {}) as { transcriptText?: string; uploadedBy?: string }
    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'kol_transcript_uploaded',
      entityType: 'kol_session',
      entityId: sessionId,
      details: { bytes: (body.transcriptText ?? '').length, stub: true },
      ipAddress: request.ip ?? null,
    })
    return { uploadedAt: new Date().toISOString() }
  })

  app.post('/:sessionId/insights/generate', { preHandler: requireAuth({ modules: ['C'] }) }, async (request) => {
    const { sessionId } = request.params as { sessionId: string }
    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'kol_insights_generated',
      entityType: 'kol_session',
      entityId: sessionId,
      details: { model: 'stub-advisor-v1' },
      ipAddress: request.ip ?? null,
    })
    return {
      insightsReportText:
        '[Insights stub — Anthropic connector pending]\n\n' +
        'KEY INSIGHTS\n' +
        '1. Clinical consensus on first-line use in PD-L1 ≥50% subgroup, with preference for combination therapy.\n' +
        '2. Need for clearer monitoring guidance in patients with baseline hepatic impairment.\n' +
        '3. Perceived value of real-world evidence from the UK and EU markets to supplement pivotal trial data.\n' +
        '4. Interest in CME content covering biomarker-driven treatment selection.\n',
      generatedAt: new Date().toISOString(),
    }
  })
}
