// Canonical JSON + CMC readiness routes — Module D.
//
// Canonical JSON: a submission accumulates indexed data points from Module A
// source documents (CSRs, IBs, SAPs, TLFs, CMC docs). The real indexing
// service parses PDFs/Word into structured JSON; this scaffold ships the
// append endpoint + list queries so the consistency check (Batch 4) has
// something to reason over.
//
// CMC readiness: one row per submission. Idempotent regenerate on POST
// (upsert pattern), explicit acknowledgement endpoint to clear the gate
// before the 3→4 stage advance.

import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { requireAuth } from '../../../auth/rbac.js'

const indexEntrySchema = z.object({
  sourceDocId: z.string().min(1),
  sourceType: z.enum(['csr', 'ib', 'sap', 'tlf', 'cmc', 'nonclin']),
  version: z.string().min(1),
  content: z.record(z.unknown()),
})

const cmcGenerateSchema = z.object({
  completenessPct: z.number().int().min(0).max(100),
  missingItems: z.array(z.unknown()).default([]),
  riskNote: z.string().optional(),
})

export const canonicalRoutes: FastifyPluginAsync = async (app) => {
  app.get('/:submissionId/canonical-json', { preHandler: requireAuth({ modules: ['D'] }) }, async (request, reply) => {
    const { submissionId } = request.params as { submissionId: string }
    const sub = await app.prisma.regulatorySubmission.findUnique({ where: { id: submissionId } })
    if (!sub) return reply.code(404).send({ error: 'not_found' })

    // Optional filters so a UI panel can scope by sourceType.
    const q = z.object({
      sourceType: z.enum(['csr', 'ib', 'sap', 'tlf', 'cmc', 'nonclin']).optional(),
    }).safeParse(request.query)
    if (!q.success) return reply.code(400).send({ error: 'validation', issues: q.error.issues })

    return app.prisma.canonicalJsonEntry.findMany({
      where: {
        submissionId,
        ...(q.data.sourceType && { sourceType: q.data.sourceType }),
      },
      orderBy: { indexedAt: 'desc' },
    })
  })

  app.post('/:submissionId/canonical-json', { preHandler: requireAuth({ modules: ['D'] }) }, async (request, reply) => {
    const { submissionId } = request.params as { submissionId: string }
    const parsed = indexEntrySchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const sub = await app.prisma.regulatorySubmission.findUnique({ where: { id: submissionId } })
    if (!sub) return reply.code(404).send({ error: 'not_found' })

    const created = await app.prisma.canonicalJsonEntry.create({
      data: {
        submissionId,
        sourceDocId: parsed.data.sourceDocId,
        sourceType: parsed.data.sourceType,
        version: parsed.data.version,
        content: parsed.data.content as object,
      },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'canonical_json_indexed',
      entityType: 'reg_submission',
      entityId: submissionId,
      details: {
        sourceDocId: parsed.data.sourceDocId,
        sourceType: parsed.data.sourceType,
        version: parsed.data.version,
      },
      ipAddress: request.ip ?? null,
    })

    return reply.code(201).send(created)
  })

  // --- CMC readiness ------------------------------------------------------

  app.get('/:submissionId/cmc-readiness', { preHandler: requireAuth({ modules: ['D'] }) }, async (request, reply) => {
    const { submissionId } = request.params as { submissionId: string }
    const sub = await app.prisma.regulatorySubmission.findUnique({ where: { id: submissionId } })
    if (!sub) return reply.code(404).send({ error: 'not_found' })

    const report = await app.prisma.cmcReadinessReport.findUnique({ where: { submissionId } })
    if (!report) return reply.code(404).send({ error: 'no_cmc_report_yet' })
    return report
  })

  app.post('/:submissionId/cmc-readiness/generate', { preHandler: requireAuth({ modules: ['D'] }) }, async (request, reply) => {
    const { submissionId } = request.params as { submissionId: string }
    const parsed = cmcGenerateSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const sub = await app.prisma.regulatorySubmission.findUnique({ where: { id: submissionId } })
    if (!sub) return reply.code(404).send({ error: 'not_found' })

    // Upsert — regenerating the report resets completeness + missingItems but
    // deliberately preserves the previous acknowledgedBy/At. Rationale: the
    // user's ack is on the *state they saw*. If completeness drops, the ack
    // is stale and the gate re-opens, but the audit record stays authoritative.
    const report = await app.prisma.cmcReadinessReport.upsert({
      where: { submissionId },
      create: {
        submissionId,
        completenessPct: parsed.data.completenessPct,
        missingItems: parsed.data.missingItems as unknown as object,
        riskNote: parsed.data.riskNote ?? null,
      },
      update: {
        completenessPct: parsed.data.completenessPct,
        missingItems: parsed.data.missingItems as unknown as object,
        riskNote: parsed.data.riskNote ?? null,
        generatedAt: new Date(),
      },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'cmc_readiness_generated',
      entityType: 'reg_submission',
      entityId: submissionId,
      details: {
        completenessPct: report.completenessPct,
        missingCount: Array.isArray(parsed.data.missingItems) ? parsed.data.missingItems.length : 0,
      },
      ipAddress: request.ip ?? null,
    })

    return report
  })

  app.post('/:submissionId/cmc-readiness/acknowledge', { preHandler: requireAuth({ modules: ['D'] }) }, async (request, reply) => {
    const { submissionId } = request.params as { submissionId: string }
    const report = await app.prisma.cmcReadinessReport.findUnique({ where: { submissionId } })
    if (!report) return reply.code(404).send({ error: 'no_cmc_report_yet' })
    if (report.acknowledgedBy) {
      return reply.code(409).send({ error: 'already_acknowledged' })
    }

    const updated = await app.prisma.cmcReadinessReport.update({
      where: { submissionId },
      data: {
        acknowledgedBy: request.user!.id,
        acknowledgedAt: new Date(),
      },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'cmc_readiness_acknowledged',
      entityType: 'reg_submission',
      entityId: submissionId,
      details: { completenessPct: report.completenessPct },
      ipAddress: request.ip ?? null,
    })

    return updated
  })

  // --- UI-shorthand alias ---------------------------------------------
  // Web client calls POST /canonical-json/index; canonical API is just
  // POST /canonical-json. Alias reports the current indexed state so the
  // UI's "Index now" button has real counts to render. Real indexing
  // engine (PDF/Word → structured JSON extractor) still lands later;
  // this just surfaces what's already stored.
  //
  // `dataPoints` = sum of top-level keys across every entry's `content`
  // JSON (a proxy; the extractor will produce a true data-point count
  // when it lands). `sources` = unique sourceDocId per entry with its
  // type + the version string the caller recorded.
  app.post('/:submissionId/canonical-json/index', { preHandler: requireAuth({ modules: ['D'] }) }, async (request, reply) => {
    const { submissionId } = request.params as { submissionId: string }
    const sub = await app.prisma.regulatorySubmission.findUnique({ where: { id: submissionId } })
    if (!sub) return reply.code(404).send({ error: 'not_found' })

    const entries = await app.prisma.canonicalJsonEntry.findMany({
      where:   { submissionId },
      select:  { sourceDocId: true, sourceType: true, version: true, content: true, indexedAt: true },
      orderBy: { indexedAt: 'desc' },
    })

    const sources = entries.map(e => ({
      sourceDocId: e.sourceDocId,
      sourceType:  e.sourceType,
      version:     e.version,
      indexedAt:   e.indexedAt.toISOString(),
    }))
    const dataPoints = entries.reduce((sum, e) => {
      // `content` is `Json` on Prisma — usually an object with named
      // fields, occasionally an array. Count top-level keys for object,
      // length for array, 0 for a bare scalar / null.
      if (e.content && typeof e.content === 'object') {
        return sum + (Array.isArray(e.content) ? e.content.length : Object.keys(e.content as object).length)
      }
      return sum
    }, 0)

    const indexedAt = new Date()
    await app.audit.append({
      timestamp: indexedAt.toISOString(),
      actorId: request.user!.id,
      action: 'canonical_json_indexed',
      entityType: 'reg_submission',
      entityId: submissionId,
      details: { aliasPath: 'canonical-json/index', sourceCount: sources.length, dataPoints },
      ipAddress: request.ip ?? null,
    })

    return {
      submissionId,
      indexedAt: indexedAt.toISOString(),
      dataPoints,
      sources,
    }
  })
}
