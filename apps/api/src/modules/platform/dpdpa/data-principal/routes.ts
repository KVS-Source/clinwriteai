// DataPrincipalRequest routes — Arc 10.2.
//
//   POST   /dpdpa/requests                     public intake (unauthenticated)
//   GET    /admin/dpdpa/requests?tenantId=...  admin inbox
//   POST   /admin/dpdpa/requests/:id/claim     admin assigns to self
//   POST   /admin/dpdpa/requests/:id/fulfill   admin marks fulfilled
//   POST   /admin/dpdpa/requests/:id/reject    admin marks rejected
//   POST   /admin/dpdpa/requests/:id/erase     admin triggers erasure cascade
//
// Erasure cascade is a worker job (apps/worker/src/jobs/dpdpa-erasure.ts
// in a follow-up); for now the admin endpoint records intent + schedules
// the job and sets status=in_progress. The worker completes the cascade
// and flips status to fulfilled with the erasureAuditEventId pointer.

import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { requireAuth } from '../../../../auth/rbac.js'

// Config-driven SLA — flip when MeitY Rules finalise. Draft Rules say
// 30 days; set here so a single env var change updates the SLA across
// all new rights requests.
const SLA_DAYS = Number(process.env.DPDPA_RIGHTS_SLA_DAYS ?? '30')

const SUBJECT_TYPES = ['user', 'kol_contact', 'ma_contact'] as const
const REQUEST_TYPES = ['access', 'correction', 'erasure', 'grievance'] as const

const intakeSchema = z.object({
  tenantSlug: z.string().min(1),                 // public endpoint uses slug not id
  subjectType: z.enum(SUBJECT_TYPES),
  subjectId: z.string().min(1).optional(),       // optional for grievance — email alone suffices
  subjectEmail: z.string().email(),
  requestType: z.enum(REQUEST_TYPES),
  details: z.string().min(1).max(4000),
})

const listQuerySchema = z.object({
  tenantId: z.string().min(1),
  status: z.enum(['received', 'in_progress', 'fulfilled', 'rejected', 'cancelled']).optional(),
})

const fulfillSchema = z.object({
  resolutionNote: z.string().min(1).max(4000),
})

const rejectSchema = z.object({
  resolutionNote: z.string().min(1).max(4000),
})

export const dataPrincipalRoutes: FastifyPluginAsync = async (app) => {
  const anyAdmin = requireAuth({ roles: ['super-admin', 'admin'] })

  // --- Public intake (no auth) --------------------------------------------
  // The Data Principal might not have a platform account — grievance
  // requests in particular come from external people. This is a
  // rate-limited unauthenticated endpoint (the fastify-rate-limit
  // plugin's default 100/min applies, which is enough deterrence for
  // the intake form).
  app.post('/dpdpa/requests', async (request, reply) => {
    const parsed = intakeSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const tenant = await app.prisma.tenant.findUnique({ where: { slug: parsed.data.tenantSlug } })
    if (!tenant) return reply.code(404).send({ error: 'tenant_not_found' })

    const slaDueAt = new Date(Date.now() + SLA_DAYS * 24 * 60 * 60 * 1000)

    const created = await app.prisma.dataPrincipalRequest.create({
      data: {
        tenantId: tenant.id,
        subjectType: parsed.data.subjectType,
        subjectId: parsed.data.subjectId ?? '',   // allowed empty for grievance by email
        subjectEmail: parsed.data.subjectEmail,
        requestType: parsed.data.requestType,
        details: parsed.data.details,
        slaDueAt,
      },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: 'system',
      action: 'dp_request.received',
      entityType: 'data_principal_request',
      entityId: created.id,
      details: {
        tenantId: tenant.id,
        requestType: parsed.data.requestType,
        subjectEmail: parsed.data.subjectEmail,
      },
      ipAddress: request.ip ?? null,
    })

    // 202 Accepted — the request is logged, workflow is async.
    return reply.code(202).send({
      id: created.id,
      status: created.status,
      slaDueAt: created.slaDueAt.toISOString(),
      message: 'Request received. We will respond within the SLA window and may contact you at the email provided.',
    })
  })

  // --- Admin inbox --------------------------------------------------------

  app.get('/admin/dpdpa/requests', { preHandler: anyAdmin }, async (request, reply) => {
    const parsed = listQuerySchema.safeParse(request.query)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const where: Record<string, unknown> = { tenantId: parsed.data.tenantId }
    if (parsed.data.status) where.status = parsed.data.status

    const rows = await app.prisma.dataPrincipalRequest.findMany({
      where,
      orderBy: [{ status: 'asc' }, { slaDueAt: 'asc' }],
      take: 500,
    })
    return rows
  })

  app.post('/admin/dpdpa/requests/:id/claim', { preHandler: anyAdmin }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const existing = await app.prisma.dataPrincipalRequest.findUnique({ where: { id } })
    if (!existing) return reply.code(404).send({ error: 'not_found' })

    const updated = await app.prisma.dataPrincipalRequest.update({
      where: { id },
      data: {
        status: 'in_progress',
        assignedToUserId: request.user!.id,
      },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'dp_request.claim',
      entityType: 'data_principal_request',
      entityId: id,
      details: { assignedToUserId: request.user!.id },
      ipAddress: request.ip ?? null,
    })

    return updated
  })

  app.post('/admin/dpdpa/requests/:id/fulfill', { preHandler: anyAdmin }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const parsed = fulfillSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const existing = await app.prisma.dataPrincipalRequest.findUnique({ where: { id } })
    if (!existing) return reply.code(404).send({ error: 'not_found' })

    const updated = await app.prisma.dataPrincipalRequest.update({
      where: { id },
      data: {
        status: 'fulfilled',
        fulfilledAt: new Date(),
        resolutionNote: parsed.data.resolutionNote,
      },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'dp_request.fulfill',
      entityType: 'data_principal_request',
      entityId: id,
      details: { requestType: existing.requestType },
      ipAddress: request.ip ?? null,
    })

    return updated
  })

  app.post('/admin/dpdpa/requests/:id/reject', { preHandler: anyAdmin }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const parsed = rejectSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const existing = await app.prisma.dataPrincipalRequest.findUnique({ where: { id } })
    if (!existing) return reply.code(404).send({ error: 'not_found' })

    const updated = await app.prisma.dataPrincipalRequest.update({
      where: { id },
      data: { status: 'rejected', resolutionNote: parsed.data.resolutionNote, fulfilledAt: new Date() },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'dp_request.reject',
      entityType: 'data_principal_request',
      entityId: id,
      details: { requestType: existing.requestType, reason: parsed.data.resolutionNote },
      ipAddress: request.ip ?? null,
    })

    return updated
  })

  // Erasure cascade kickoff. Records an audit event + flips status to
  // in_progress; the actual content redaction happens in the worker
  // (dpdpa-erasure job) which preserves the audit-chain hashes.
  app.post('/admin/dpdpa/requests/:id/erase', { preHandler: anyAdmin }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const existing = await app.prisma.dataPrincipalRequest.findUnique({ where: { id } })
    if (!existing) return reply.code(404).send({ error: 'not_found' })
    if (existing.requestType !== 'erasure') return reply.code(409).send({ error: 'not_erasure_request' })

    const auditEvent = await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'dp_request.erasure.start',
      entityType: 'data_principal_request',
      entityId: id,
      details: {
        subjectType: existing.subjectType,
        subjectId: existing.subjectId,
        subjectEmail: existing.subjectEmail,
      },
      ipAddress: request.ip ?? null,
    })

    const updated = await app.prisma.dataPrincipalRequest.update({
      where: { id },
      data: {
        status: 'in_progress',
        assignedToUserId: request.user!.id,
        erasureAuditEventId: auditEvent?.id ?? null,
      },
    })

    // Enqueue the erasure worker job if the queue is available. The
    // worker handles document provenance, comments, voice notes, and
    // signatures — content redaction only, audit-chain hashes
    // preserved. If the queue isn't registered (dev / test), the
    // admin can still manually run the cascade later.
    if (app.queue?.enqueue) {
      await app.queue.enqueue('dpdpa.erasure', {
        requestId: id,
        tenantId: existing.tenantId,
        subjectType: existing.subjectType,
        subjectId: existing.subjectId,
        auditEventId: auditEvent?.id,
      })
    }

    return updated
  })
}
