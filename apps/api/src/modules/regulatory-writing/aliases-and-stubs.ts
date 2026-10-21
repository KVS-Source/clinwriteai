// Module D (Regulatory Writing) — path aliases + endpoint stubs.
//
// This plugin exists to close the gap between the web client's API
// surface (apps/web/src/modules/regulatory-writing/api/
// regulatoryWriting.ts, 32 endpoints) and the canonical API routes
// scattered across submissions/, canonical/, consistency/, ha-
// correspondence/, odd/, safety-reports/.
//
// Two kinds of entries:
//   1. Aliases — forward to an existing canonical handler using the UI's
//      preferred path/body shape (e.g. /ha-correspondence/upload-loq
//      aliases /regulatory-submissions/:id/ha-correspondence/loq;
//      ODD /sign aliases /odd/:id/outcome with decision defaulted).
//   2. Stubs — endpoints the web client expects but no handler exists
//      yet because the underlying feature is externally blocked
//      (EXTEDO/Lorenz validators, FDA ESG / EMA CESP gateway, PubMed-
//      alerts feed, Master Library model). Each stub audit-logs with
//      stub:true and returns a deterministic placeholder shape so the
//      UI's buttons + screens render instead of 404'ing.
//
// Mounted at the /reg-submissions prefix in server.ts (matches the
// web client's regulatoryWriting.ts endpoint shapes). Regulatory
// alerts mount at the root prefix separately (also exported below).

import type { FastifyPluginAsync } from 'fastify'
import { requireAuth } from '../../auth/rbac.js'

export const regAliasesAndStubs: FastifyPluginAsync = async (app) => {
  const dGate = requireAuth({ modules: ['D'] })

  // --- HA correspondence aliases --------------------------------------
  // Web uses /reg-submissions/:id/ha-correspondence/*; canonical API is
  // at the longer /regulatory-submissions/:id/ha-correspondence/*. Alias
  // the common paths so the UI's HAResponseDrafting + handoff flows work.

  app.get('/:submissionId/ha-correspondence', { preHandler: dGate }, async (request, reply) => {
    const { submissionId } = request.params as { submissionId: string }
    const sub = await app.prisma.regulatorySubmission.findUnique({ where: { id: submissionId } })
    if (!sub) return reply.code(404).send({ error: 'not_found' })
    return app.prisma.haCorrespondence.findMany({
      where: { submissionId },
      include: { questions: { include: { drafts: true } } },
      orderBy: { createdAt: 'desc' },
    })
  })

  app.post('/:submissionId/ha-correspondence/upload-loq', { preHandler: dGate }, async (request, reply) => {
    const { submissionId } = request.params as { submissionId: string }
    const body = (request.body ?? {}) as { title?: string; questionsCount?: number }
    const sub = await app.prisma.regulatorySubmission.findUnique({ where: { id: submissionId } })
    if (!sub) return reply.code(404).send({ error: 'not_found' })

    const corr = await app.prisma.haCorrespondence.create({
      data: {
        submissionId,
        direction:      'inbound',
        type:           'loq',
        contentSummary: body.title ?? 'LoQ (auto-created via upload-loq alias)',
      },
    })
    const qCount = Math.max(1, Math.min(50, body.questionsCount ?? 1))
    await app.prisma.haLoqQuestion.createMany({
      data: Array.from({ length: qCount }, (_, i) => ({
        correspondenceId: corr.id,
        questionRef:      `Q${i + 1}`,
        questionText:     `Reviewer question ${i + 1} — awaiting draft`,
        category:         'cmc',
        status:           'open',
      })),
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'ha_loq_uploaded',
      entityType: 'reg_submission',
      entityId: submissionId,
      details: { correspondenceId: corr.id, title: body.title ?? null, questionsCount: qCount, aliasPath: 'upload-loq' },
      ipAddress: request.ip ?? null,
    })
    return corr
  })

  app.post('/:submissionId/ha-correspondence/:correspondenceId/questions/:questionId/generate', { preHandler: dGate }, async (request, reply) => {
    // Stub — real DD-D-004 LoQ auto-parser + AI draft deferred (Anthropic
    // connector blocker, same as Modules A/B/C AI stubs). Writes a
    // HaResponseDraft row with the stub text so the UI's draft history
    // still has a provenance entry.
    const { submissionId, correspondenceId, questionId } = request.params as {
      submissionId: string; correspondenceId: string; questionId: string
    }
    const q = await app.prisma.haLoqQuestion.findFirst({
      where: { id: questionId, correspondenceId },
    })
    if (!q) return reply.code(404).send({ error: 'not_found' })

    const draftText =
      `[AI stub — Anthropic connector pending] Draft response to ${q.questionRef}:\n\n` +
      `Thank you for the question. In the supporting documentation (eCTD §${q.category}), ` +
      `we provide the following clarification: [placeholder — SME-reviewed wording to replace].`

    const latest = await app.prisma.haResponseDraft.findFirst({
      where: { questionId }, orderBy: { versionNumber: 'desc' },
    })
    const nextVersion = (latest?.versionNumber ?? 0) + 1

    const draft = await app.prisma.haResponseDraft.create({
      data: {
        questionId,
        versionNumber:  nextVersion,
        draftText,
        sourceRefs:     [],
        status:         'draft',
        aiFootprintPct: 100,
        createdBy:      request.user!.id,
      },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'ha_response_draft_generated',
      entityType: 'reg_submission',
      entityId: submissionId,
      details: { correspondenceId, questionId, draftId: draft.id, version: nextVersion, model: 'stub-advisor-v1' },
      ipAddress: request.ip ?? null,
    })

    return {
      questionId,
      responseDraft:  draftText,
      aiModel:        'stub-advisor-v1',
      aiFootprintPct: 100,
      generatedAt:    draft.createdAt.toISOString(),
      stub:           true,
    }
  })

  app.post('/:submissionId/ha-correspondence/:correspondenceId/submit-response', { preHandler: dGate }, async (request, reply) => {
    // Alias to POST /regulatory-submissions/:id/ha-correspondence/:id/response.
    // Finalises the response package by marking respondedAt on the
    // correspondence row.
    const { submissionId, correspondenceId } = request.params as { submissionId: string; correspondenceId: string }
    const corr = await app.prisma.haCorrespondence.findFirst({ where: { id: correspondenceId, submissionId } })
    if (!corr) return reply.code(404).send({ error: 'not_found' })

    const updated = await app.prisma.haCorrespondence.update({
      where: { id: correspondenceId },
      data:  { respondedAt: new Date() },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'ha_response_submitted',
      entityType: 'reg_submission',
      entityId: submissionId,
      details: { correspondenceId, aliasPath: 'submit-response' },
      ipAddress: request.ip ?? null,
    })
    return updated
  })

  // --- ODD sign alias --------------------------------------------------
  // Web calls POST /reg-submissions/:id/odd/sign {signedBy}; canonical
  // is POST /odd/:assessmentId/outcome {decision, issuingAuthority, ...}.
  // Resolve the submission's ODD assessment + flip status to under_review
  // (the demo-safe "sign for authority review" semantic).
  app.post('/:submissionId/odd/sign', { preHandler: dGate }, async (request, reply) => {
    const { submissionId } = request.params as { submissionId: string }
    const assessment = await app.prisma.oddAssessment.findFirst({ where: { submissionId } })
    if (!assessment) return reply.code(404).send({ error: 'no_odd_assessment' })
    if (assessment.status !== 'draft') {
      return reply.code(409).send({ error: 'wrong_state', message: `ODD already in ${assessment.status}; cannot re-sign` })
    }
    const updated = await app.prisma.oddAssessment.update({
      where: { id: assessment.id },
      data:  { status: 'under_review' },
    })
    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'odd_signed_for_review',
      entityType: 'reg_submission',
      entityId: submissionId,
      details: { assessmentId: assessment.id, aliasPath: 'odd/sign' },
      ipAddress: request.ip ?? null,
    })
    return updated
  })

  // --- Super Review stubs ---------------------------------------------
  // No dedicated SuperReviewer table yet — the Stage 4 multi-disciplinary
  // review model is deferred. Stubs return a deterministic 4-seat panel
  // so the UI's Super Review screen (SuperReview.tsx) renders instead of
  // 404'ing. Real sign-off model lands when the role catalogue + e-sig
  // sync up with Module A's signature chain.
  app.get('/:submissionId/super-reviewers', { preHandler: dGate }, async () => {
    return [
      { id: 'sr-clin',   seatRole: 'Clinical',    name: 'Dr Rebecca Morton',   initials: 'RM', signedAt: null, stub: true },
      { id: 'sr-reg',    seatRole: 'Regulatory',  name: 'Dr Priya Nair',       initials: 'PN', signedAt: null, stub: true },
      { id: 'sr-pv',     seatRole: 'PV Lead',     name: 'Dr Elena Vasquez',    initials: 'EV', signedAt: null, stub: true },
      { id: 'sr-stats',  seatRole: 'Biostats',    name: 'Mr David Chen',       initials: 'DC', signedAt: null, stub: true },
    ]
  })

  app.post('/:submissionId/super-reviewers/:reviewerId/sign', { preHandler: dGate }, async (request) => {
    const { submissionId, reviewerId } = request.params as { submissionId: string; reviewerId: string }
    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'super_review_signed',
      entityType: 'reg_submission',
      entityId: submissionId,
      details: { reviewerId, stub: true },
      ipAddress: request.ip ?? null,
    })
    return { reviewerId, signedAt: new Date().toISOString(), stub: true }
  })

  // --- Gateway submission stubs ---------------------------------------
  // FDA ESG / EMA CESP / CDSCO integration externally blocked (vendor
  // contracts + PGP keys). Stubs read nothing (there's no gateway table
  // yet), return canned transmit records so the UI's GatewaySubmission
  // screen's buttons resolve.
  app.get('/:submissionId/gateway', { preHandler: dGate }, async (request) => {
    const { submissionId } = request.params as { submissionId: string }
    return [
      {
        id: `gw-${submissionId}-stub`,
        submissionId,
        gateway: 'fda-esg',
        gatewayLabel: 'FDA ESG (stub)',
        status: 'awaiting_transmit',
        ack1At: null,
        ack2At: null,
        ack3At: null,
        stub: true,
      },
    ]
  })

  app.post('/:submissionId/gateway/transmit', { preHandler: dGate }, async (request) => {
    const { submissionId } = request.params as { submissionId: string }
    const body = (request.body ?? {}) as { gateway?: string }
    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'gateway_transmit_requested',
      entityType: 'reg_submission',
      entityId: submissionId,
      details: { gateway: body.gateway ?? 'fda-esg', stub: true },
      ipAddress: request.ip ?? null,
    })
    return {
      id: `gw-${submissionId}-${Date.now().toString(36)}`,
      submissionId,
      gateway: body.gateway ?? 'fda-esg',
      status: 'transmitted',
      ack1At: new Date().toISOString(),
      stub: true,
    }
  })

  app.post('/:submissionId/gateway/:recordId/simulate-ack', { preHandler: dGate }, async (request) => {
    const { submissionId, recordId } = request.params as { submissionId: string; recordId: string }
    const body = (request.body ?? {}) as { ack?: 'ack1' | 'ack2' | 'ack3' }
    const ack = body.ack ?? 'ack2'
    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'gateway_ack_simulated',
      entityType: 'reg_submission',
      entityId: submissionId,
      details: { recordId, ack, stub: true },
      ipAddress: request.ip ?? null,
    })
    return {
      id: recordId,
      submissionId,
      status: ack === 'ack3' ? 'accepted' : 'in_review',
      [`${ack}At`]: new Date().toISOString(),
      stub: true,
    }
  })

  // --- Library cards stubs --------------------------------------------
  app.get('/:submissionId/library-cards', { preHandler: dGate }, async (request) => {
    const { submissionId } = request.params as { submissionId: string }
    const sub = await app.prisma.regulatorySubmission.findUnique({ where: { id: submissionId } })
    if (!sub) return []
    return [
      { id: `libr-${submissionId}-1`, submissionId, title: `${sub.submissionType.toUpperCase()} summary — ${sub.taTag}`, kind: 'module-2', pushedAt: null, stub: true },
    ]
  })

  app.post('/:submissionId/library-cards/push', { preHandler: dGate }, async (request) => {
    const { submissionId } = request.params as { submissionId: string }
    const body = (request.body ?? {}) as { cardIds?: string[] }
    const count = body.cardIds?.length ?? 0
    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'library_push',
      entityType: 'reg_submission',
      entityId: submissionId,
      details: { cardCount: count, stub: true },
      ipAddress: request.ip ?? null,
    })
    return { pushedAt: new Date().toISOString(), cardCount: count }
  })

  // --- Final record bundle ---------------------------------------------
  app.get('/:submissionId/final', { preHandler: dGate }, async (request, reply) => {
    const { submissionId } = request.params as { submissionId: string }
    const sub = await app.prisma.regulatorySubmission.findUnique({ where: { id: submissionId } })
    if (!sub) return reply.code(404).send({ error: 'not_found' })

    const [ectdNodes, validation, consistency] = await Promise.all([
      app.prisma.ectdGranularityNode.findMany({ where: { submissionId }, orderBy: { moduleSection: 'asc' } }),
      app.prisma.ectdValidationResult.findFirst({ where: { submissionId }, orderBy: { runAt: 'desc' } }),
      app.prisma.consistencyCheckResult.findFirst({ where: { submissionId }, orderBy: { runAt: 'desc' } }),
    ])

    return {
      submission: sub,
      gatewayRecord: {
        id: `gw-${submissionId}-stub`,
        submissionId,
        gateway: 'fda-esg',
        status: 'awaiting_transmit',
        stub: true,
      },
      libraryCards: [],
      ectdNodes,
      validationLatest: validation,
      consistencyLatest: consistency,
    }
  })

  // --- Portfolio aggregator (per-project filter) ----------------------
  app.get('/portfolio/:projectId', { preHandler: dGate }, async (request) => {
    const { projectId } = request.params as { projectId: string }
    const { scope } = (request.query ?? {}) as { scope?: string }
    const subs = await app.prisma.regulatorySubmission.findMany({
      where: {
        projectId,
        ...(scope && { stage: Number(scope) }),
      },
      orderBy: { createdAt: 'desc' },
    })
    return subs
  })
}

// Regulatory Intelligence (sD11) — alerts feed is a cross-platform
// concern (vendor pulls — EMA/FDA/MHRA regulatory newswires). Stub
// mounted at root so GET /regulatory-alerts resolves without external
// vendor keys. The alerts list is derived from recent audit events
// tagged 'regulatory_alert' + a few deterministic seeds so RegulatoryIntelligence
// has something to render on first boot.
export const regulatoryAlertsStubRoutes: FastifyPluginAsync = async (app) => {
  const dGate = requireAuth({ modules: ['D'] })

  const seeded = [
    { id: 'ra-001', title: 'ICH E6(R3) GCP revision — operational implications', issuer: 'ICH', severity: 'medium', publishedAt: '2026-09-15T00:00:00Z', acknowledged: false, stub: true },
    { id: 'ra-002', title: 'FDA guidance update — real-world evidence frameworks for oncology',  issuer: 'FDA', severity: 'low',    publishedAt: '2026-09-28T00:00:00Z', acknowledged: false, stub: true },
    { id: 'ra-003', title: 'EMA Pharmacovigilance Risk Assessment Committee signal update',       issuer: 'EMA', severity: 'high',   publishedAt: '2026-10-05T00:00:00Z', acknowledged: false, stub: true },
    { id: 'ra-004', title: 'CDSCO notification — eCTD submission requirement for new drug apps',  issuer: 'CDSCO', severity: 'medium', publishedAt: '2026-10-12T00:00:00Z', acknowledged: false, stub: true },
  ]

  app.get('/regulatory-alerts', { preHandler: dGate }, async () => seeded)

  app.post('/regulatory-alerts/:alertId/acknowledge', { preHandler: dGate }, async (request) => {
    const { alertId } = request.params as { alertId: string }
    const body = (request.body ?? {}) as { userId?: string }
    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'regulatory_alert_acknowledged',
      entityType: 'regulatory_alert',
      entityId: alertId,
      details: { userId: body.userId ?? request.user!.id, stub: true },
      ipAddress: request.ip ?? null,
    })
    return { ...(seeded.find(a => a.id === alertId) ?? { id: alertId, stub: true }), acknowledged: true, acknowledgedAt: new Date().toISOString() }
  })
}
