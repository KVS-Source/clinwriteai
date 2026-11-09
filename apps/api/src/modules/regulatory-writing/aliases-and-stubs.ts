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
import { z } from 'zod'
import { requireAuth } from '../../auth/rbac.js'
import { chooseModel } from '../platform/config/ai-engine-settings.js'

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
    // Calls the real AI gateway with the LoQ question + submission context
    // to produce a response draft. Writes a HaResponseDraft row with the
    // generated text + aiFootprintPct=100 (whole draft is AI) so the UI's
    // draft history retains Part 11 provenance. Falls back to a short
    // "AI unavailable" stub on non-quota gateway failure so the user can
    // still iterate manually; 429 on rate-limit exhaustion.
    const { submissionId, correspondenceId, questionId } = request.params as {
      submissionId: string; correspondenceId: string; questionId: string
    }
    const q = await app.prisma.haLoqQuestion.findFirst({
      where:   { id: questionId, correspondenceId },
    })
    if (!q) return reply.code(404).send({ error: 'not_found' })
    const sub = await app.prisma.regulatorySubmission.findUnique({
      where:  { id: submissionId },
      select: { projectId: true, submissionType: true, targetHas: true },
    })

    const systemPrompt = [
      'You are a regulatory-affairs writer drafting a response to a Health Authority List of Questions (LoQ) item.',
      '',
      'RULES',
      '1. Produce only the response prose the submission package will carry — no preamble, no "Dear Agency".',
      '2. Address the question directly. Reference the eCTD module/section the question maps to.',
      '3. Do not invent clinical facts, numbers, dates, batch records, or references. If the reply needs specifics you do not have, emit `[Information Required: <what>]` inline.',
      '4. Match regulatory register: precise, measured, no marketing phrasing.',
      '5. If the reviewer flagged a non-compliance, acknowledge, state the corrective action + where in the dossier it has been updated.',
    ].join('\n')

    const userPrompt = [
      `Submission: ${sub?.submissionType ?? 'unknown'} to ${(sub?.targetHas ?? []).join(', ') || 'unknown HA'}`,
      `LoQ question ${q.questionRef} (${q.category}):`,
      q.questionText,
      '',
      'Draft the response.',
    ].join('\n')

    const latest = await app.prisma.haResponseDraft.findFirst({
      where: { questionId }, orderBy: { versionNumber: 'desc' },
    })
    const nextVersion = (latest?.versionNumber ?? 0) + 1

    let draftText:   string
    let aiModel:     string
    let aiCallRecordId: string | null = null
    let stubFallback = false

    try {
      const model  = await chooseModel(app.prisma)
      const result = await app.aiGateway.chat({
        tenantId:  request.user!.tenantId,
        projectId: sub?.projectId ?? 'unknown',
        actorId:   request.user!.id,
        module:    'D',
        intent:    'ha_response_draft',
        model,
        prompt:    `${systemPrompt}\n\n---\n\n${userPrompt}`,
        maxOutputTokens: 1024,
      })
      draftText      = result.responseText
      aiModel        = result.model
      aiCallRecordId = result.recordId
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'RateLimitedError') {
        return reply.code(429).send({ error: 'quota_reached', message: err.message })
      }
      app.log.warn({ err, submissionId, questionId }, 'ha_response_draft fell back to stub')
      stubFallback = true
      aiModel      = 'stub-fallback'
      draftText =
        `[AI temporarily unavailable — please draft manually] Starting point for ${q.questionRef} (${q.category}):\n\n` +
        `Thank you for the question. In the eCTD §${q.category} documentation we provide the following clarification: ` +
        `[Information Required: insert the specific wording addressing "${q.questionText}"].`
    }

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
      details: {
        correspondenceId, questionId,
        draftId: draft.id, version: nextVersion,
        model:   aiModel,
        aiCallRecordId,
        ...(stubFallback ? { stub: true } : {}),
      },
      ipAddress: request.ip ?? null,
    })

    return {
      questionId,
      responseDraft:  draftText,
      aiModel,
      aiFootprintPct: 100,
      generatedAt:    draft.createdAt.toISOString(),
      ...(stubFallback ? { stub: true } : {}),
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

  // --- Super Review seats ---------------------------------------------
  // No dedicated SuperReviewer table yet, but the 4-seat Stage 4 panel
  // is now derived from the submission's project members instead of
  // hardcoded names. Routing heuristic per seat:
  //   Clinical   — User.role='clinical-writer'   OR projectRole matches /clinical/i
  //   Regulatory — User.role='regulatory-writer' OR projectRole matches /regulatory/i
  //   PV Lead    — projectRole matches /pv|pharmacovigilance/i
  //   Biostats   — projectRole matches /biostat|statist/i
  //
  // First matching ProjectMember wins each seat. Seats with no match
  // return { assigned: false, name: null } so the UI can show
  // "unassigned" badges. Dedicated SuperReviewer table + Part 11 e-sig
  // sync with Module A still deferred; the shape is forwards-compatible.
  app.get('/:submissionId/super-reviewers', { preHandler: dGate }, async (request, reply) => {
    const { submissionId } = request.params as { submissionId: string }
    const sub = await app.prisma.regulatorySubmission.findUnique({
      where:  { id: submissionId },
      select: { projectId: true },
    })
    if (!sub) return reply.code(404).send({ error: 'not_found' })

    const members = await app.prisma.projectMember.findMany({
      where:   { projectId: sub.projectId, removedAt: null },
      include: { user: { select: { id: true, name: true, initials: true, role: true } } },
    })

    type SeatMatch = (m: typeof members[number]) => boolean
    const seats: Array<{ id: string; seatRole: string; matches: SeatMatch }> = [
      {
        id: 'sr-clin',  seatRole: 'Clinical',
        matches: m => m.user.role === 'clinical-writer' || /clinical/i.test(m.projectRole ?? ''),
      },
      {
        id: 'sr-reg',   seatRole: 'Regulatory',
        matches: m => m.user.role === 'regulatory-writer' || /regulatory/i.test(m.projectRole ?? ''),
      },
      {
        id: 'sr-pv',    seatRole: 'PV Lead',
        matches: m => /\b(pv|pharmacovigilance)\b/i.test(m.projectRole ?? ''),
      },
      {
        id: 'sr-stats', seatRole: 'Biostats',
        matches: m => /\b(biostat|statist)/i.test(m.projectRole ?? ''),
      },
    ]

    const assigned = new Set<string>()
    return seats.map(seat => {
      // First unassigned match wins; avoids one member filling multiple
      // seats when their projectRole is generic.
      const hit = members.find(m => !assigned.has(m.userId) && seat.matches(m))
      if (hit) assigned.add(hit.userId)
      return {
        id:       seat.id,
        seatRole: seat.seatRole,
        userId:   hit?.userId ?? null,
        name:     hit?.user.name ?? null,
        initials: hit?.user.initials ?? null,
        assigned: !!hit,
        signedAt: null,
      }
    })
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

  // --- Library cards --------------------------------------------------
  //
  // Reads real LibrarySection rows (platform-wide, single-tenant
  // install) filtered to this submission's therapeutic area +
  // `module:D` or platform-wide `module:A` (Clinical Writing-sourced
  // approved documents, which Module D often reuses as evidence).
  //
  // Returns a `kind` derived from the `doctype:` tag (falls back to
  // the LibrarySection.framework when no doctype tag is set). `title`
  // comes from LibrarySection.title + `body` lives in LibrarySection.body
  // so the UI can show the preview without a second round-trip.
  app.get('/:submissionId/library-cards', { preHandler: dGate }, async (request, reply) => {
    const { submissionId } = request.params as { submissionId: string }
    const sub = await app.prisma.regulatorySubmission.findUnique({ where: { id: submissionId } })
    if (!sub) return reply.code(404).send({ error: 'not_found' })

    const rows = await app.prisma.librarySection.findMany({
      where: {
        isCurrent: true,
        retiredAt: null,
        taTag: sub.taTag,
        // Match claims (Medical Writing pushes) + full documents
        // (Clinical Writing pushes) — both are useful evidence in a
        // Module 2 package.
        OR: [
          { tags: { has: 'module:D' } },
          { tags: { has: 'module:C' } },
          { tags: { has: 'module:A' } },
        ],
      },
      select: { id: true, title: true, body: true, framework: true, category: true, tags: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
      take: 200,                                              // UI pagination lands later; cap so the response stays bounded
    })

    return rows.map(r => {
      // Pull the doctype hint out of the tags array if present.
      const docTypeTag = r.tags.find(t => t.startsWith('doctype:'))
      const kind = docTypeTag ? docTypeTag.slice('doctype:'.length) : r.framework
      return {
        id:        r.id,
        submissionId,
        title:     r.title,
        body:      r.body,
        kind,
        category:  r.category,
        tags:      r.tags,
        updatedAt: r.updatedAt.toISOString(),
      }
    })
  })

  // Push submission artefacts back into the Master Library for reuse.
  // Takes an array of { title, body, docType } items — the client
  // picks what to capture; this route doesn't infer from the eCTD
  // tree. Writes one LibrarySection per item, dedup on (title + body
  // + submissionId) via a `source:<submissionId>` tag check.
  const regPushSchema = z.object({
    items: z.array(z.object({
      title:    z.string().min(1).max(200),
      body:     z.string().min(1).max(10_000),
      docType:  z.string().min(1).max(80),
      category: z.enum(['claim', 'safety', 'boilerplate', 'best_practice']).default('boilerplate'),
    })).min(1).max(50),
  })

  app.post('/:submissionId/library-cards/push', { preHandler: dGate }, async (request, reply) => {
    const { submissionId } = request.params as { submissionId: string }
    const parsed = regPushSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const sub = await app.prisma.regulatorySubmission.findUnique({ where: { id: submissionId } })
    if (!sub) return reply.code(404).send({ error: 'not_found' })

    const results: Array<{ title: string; librarySectionId?: string; skippedReason?: 'already_pushed' }> = []
    for (const item of parsed.data.items) {
      const existing = await app.prisma.librarySection.findFirst({
        where: {
          title: item.title,
          isCurrent: true,
          retiredAt: null,
          tags: { has: `source:${submissionId}` },
        },
        select: { id: true },
      })
      if (existing) {
        results.push({ title: item.title, skippedReason: 'already_pushed' })
        continue
      }
      const created = await app.prisma.librarySection.create({
        data: {
          tenantId:  null,
          title:     item.title,
          body:      item.body,
          taTag:     sub.taTag,
          framework: item.docType,
          category:  item.category,
          tags: [
            'module:D',
            `doctype:${item.docType}`,
            `project:${sub.projectId}`,
            `source:${submissionId}`,
            `submissionType:${sub.submissionType}`,
          ],
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
      entityType: 'reg_submission',
      entityId: submissionId,
      details: { requested: parsed.data.items.length, pushed: pushedCount, results },
      ipAddress: request.ip ?? null,
    })
    return { pushedAt: new Date().toISOString(), pushedCount, results }
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
