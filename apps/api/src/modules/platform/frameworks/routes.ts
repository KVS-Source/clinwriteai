// Regulatory framework registry — platform-wide catalogue of frameworks
// that modules reference. Admins add and edit frameworks. Marking one superseded is a two-person content
// decision: a Project Manager sends it for approval and another PM or a QC approves or rejects it (below).

import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { requireAuth, type Role } from '../../../auth/rbac.js'

const createSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  jurisdiction: z.string().min(1),
  category: z.string().min(1),
  effectiveDate: z.string().datetime(),
  description: z.string().optional(),
  sourceUrl: z.string().url().optional(),
})

const updateSchema = createSchema.partial().omit({ name: true })

const listQuery = z.object({
  jurisdiction: z.string().optional(),
  category: z.string().optional(),
  includeRetired: z.coerce.boolean().default(false),
})

export const frameworksRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', { preHandler: requireAuth() }, async (request, reply) => {
    const parsed = listQuery.safeParse(request.query)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })
    return app.prisma.regulatoryFramework.findMany({
      where: {
        ...(parsed.data.jurisdiction && { jurisdiction: parsed.data.jurisdiction }),
        ...(parsed.data.category && { category: parsed.data.category }),
        ...(!parsed.data.includeRetired && { retiredAt: null }),
      },
      orderBy: [{ jurisdiction: 'asc' }, { name: 'asc' }],
    })
  })

  app.get('/:id', { preHandler: requireAuth() }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const row = await app.prisma.regulatoryFramework.findUnique({ where: { id } })
    if (!row) return reply.code(404).send({ error: 'not_found' })
    return row
  })

  app.post('/', { preHandler: requireAuth({ roles: ['admin'] }) }, async (request, reply) => {
    const parsed = createSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    // Framework names are globally unique — modules reference them by name
    // in free-text columns (library_sections.framework etc.) rather than FK.
    const existing = await app.prisma.regulatoryFramework.findUnique({ where: { name: parsed.data.name } })
    if (existing) return reply.code(409).send({ error: 'name_taken' })

    const created = await app.prisma.regulatoryFramework.create({
      data: {
        name: parsed.data.name,
        version: parsed.data.version,
        jurisdiction: parsed.data.jurisdiction,
        category: parsed.data.category,
        effectiveDate: new Date(parsed.data.effectiveDate),
        description: parsed.data.description ?? null,
        sourceUrl: parsed.data.sourceUrl ?? null,
        createdBy: request.user!.id,
      },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'framework_registered',
      entityType: 'regulatory_framework',
      entityId: created.id,
      details: { name: created.name, version: created.version, jurisdiction: created.jurisdiction },
      ipAddress: request.ip ?? null,
    })
    return reply.code(201).send(created)
  })

  app.patch('/:id', { preHandler: requireAuth({ roles: ['admin'] }) }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const parsed = updateSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const existing = await app.prisma.regulatoryFramework.findUnique({ where: { id } })
    if (!existing) return reply.code(404).send({ error: 'not_found' })

    const updated = await app.prisma.regulatoryFramework.update({
      where: { id },
      data: {
        ...parsed.data,
        effectiveDate: parsed.data.effectiveDate ? new Date(parsed.data.effectiveDate) : undefined,
      },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'framework_updated',
      entityType: 'regulatory_framework',
      entityId: id,
      details: { changedFields: Object.keys(parsed.data) },
      ipAddress: request.ip ?? null,
    })

    return updated
  })

  // --- Marking a framework superseded: a two-person decision ---------------------------------------
  //
  // A Project Manager sends the framework for approval; another PM or a QC approves it (the framework is
  // retired: one-way, audited) or rejects it with a reason. The requester can't decide their own request.
  // Every other active PM and QC is notified of a new request; the requester is notified of the decision.
  // There is no direct "retire" any more: it would skip the second person.

  const DECIDER_ROLES: Role[] = ['pm', 'qc']
  type RequestRow = {
    id: string; frameworkId: string; requestedBy: string; requestedAt: Date; reason: string | null
    status: string; decidedBy: string | null; decidedAt: Date | null; rejectionReason: string | null
  }
  const requestShape = (r: RequestRow, names: Map<string, string>) => ({
    id: r.id, frameworkId: r.frameworkId, status: r.status, reason: r.reason,
    requestedBy: r.requestedBy, requestedByName: names.get(r.requestedBy) ?? null, requestedAt: r.requestedAt.toISOString(),
    decidedBy: r.decidedBy, decidedByName: r.decidedBy ? names.get(r.decidedBy) ?? null : null,
    decidedAt: r.decidedAt?.toISOString() ?? null, rejectionReason: r.rejectionReason,
  })
  const namesOf = async (ids: Array<string | null>) => {
    const unique = [...new Set(ids.filter((v): v is string => !!v))]
    if (unique.length === 0) return new Map<string, string>()
    const users = await app.prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } })
    return new Map(users.map(u => [u.id, u.name]))
  }
  const notify = async (recipientIds: string[], n: { kind: string; title: string; body: string; frameworkId: string; requestId: string }) => {
    if (!app.hasDecorator('notifications') || recipientIds.length === 0) return
    for (const recipientId of recipientIds) {
      try {
        await app.notifications.send({
          recipientId, kind: n.kind, title: n.title, body: n.body,
          linkPath: `/master-library/ich-frameworks?open=${encodeURIComponent(n.frameworkId)}`,
          payload: { frameworkId: n.frameworkId, requestId: n.requestId },
        })
      } catch (err) {
        app.log.warn({ err, recipientId, kind: n.kind }, 'framework request notification failed')
      }
    }
  }

  // Requests, newest first. ?status=pending lists what is waiting for a decision; ?frameworkId= narrows it.
  app.get('/supersede-requests', { preHandler: requireAuth() }, async (request) => {
    const q = (request.query ?? {}) as { status?: string; frameworkId?: string }
    const rows = await app.prisma.frameworkStatusRequest.findMany({
      where: { ...(q.status && { status: q.status }), ...(q.frameworkId && { frameworkId: q.frameworkId }) },
      orderBy: { requestedAt: 'desc' },
      take: 200,
    })
    const names = await namesOf(rows.flatMap(r => [r.requestedBy, r.decidedBy]))
    return rows.map(r => requestShape(r, names))
  })

  // Send for approval (Project Manager).
  const sendSchema = z.object({ reason: z.string().trim().max(1000).optional() })
  app.post('/:id/supersede-request', { preHandler: requireAuth({ roles: ['pm'] }) }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const parsed = sendSchema.safeParse(request.body ?? {})
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })
    const fw = await app.prisma.regulatoryFramework.findUnique({ where: { id } })
    if (!fw) return reply.code(404).send({ error: 'not_found' })
    if (fw.retiredAt) return reply.code(409).send({ error: 'already_retired', message: `${fw.name} is already superseded.` })
    const pending = await app.prisma.frameworkStatusRequest.findFirst({ where: { frameworkId: id, status: 'pending' } })
    if (pending) return reply.code(409).send({ error: 'request_pending', message: `${fw.name} is already waiting for approval.` })

    const user = request.user!
    const created = await app.prisma.frameworkStatusRequest.create({
      data: { frameworkId: id, requestedBy: user.id, reason: parsed.data.reason || null },
    })
    await app.audit.append({
      timestamp: new Date().toISOString(), actorId: user.id, action: 'framework_supersede_requested',
      entityType: 'regulatory_framework', entityId: id,
      details: { name: fw.name, requestId: created.id, ...(created.reason && { reason: created.reason }) },
      ipAddress: request.ip ?? null,
    })

    const deciders = await app.prisma.user.findMany({
      where: {
        status: 'active', id: { not: user.id },
        OR: [{ role: { in: DECIDER_ROLES } }, { additionalRoles: { hasSome: DECIDER_ROLES } }],
      },
      select: { id: true },
    })
    const names = await namesOf([user.id])
    const who = names.get(user.id) ?? user.email
    await notify(deciders.map(d => d.id), {
      kind: 'framework_supersede_requested', frameworkId: id, requestId: created.id,
      title: `Approval needed: mark ${fw.name} as superseded`,
      body: `${who} has asked to mark ${fw.name} (${fw.version}) as superseded.${created.reason ? ` Reason: ${created.reason}` : ''} Approve or reject it in the framework registry.`,
    })
    return reply.code(201).send(requestShape(created, names))
  })

  const loadRequest = (rid: string) =>
    app.prisma.frameworkStatusRequest.findUnique({ where: { id: rid }, include: { framework: true } })

  // Approve (another PM, or a QC): the framework is marked superseded.
  app.post('/supersede-requests/:rid/approve', { preHandler: requireAuth({ roles: DECIDER_ROLES }) }, async (request, reply) => {
    const { rid } = request.params as { rid: string }
    const req = await loadRequest(rid)
    if (!req) return reply.code(404).send({ error: 'not_found' })
    if (req.status !== 'pending') return reply.code(409).send({ error: 'already_decided', message: `This request was already ${req.status}.` })
    const user = request.user!
    if (req.requestedBy === user.id) return reply.code(403).send({ error: 'own_request', message: 'You can’t approve your own request. Another PM or a QC has to.' })

    const now = new Date()
    const [decided] = await app.prisma.$transaction([
      app.prisma.frameworkStatusRequest.update({ where: { id: rid }, data: { status: 'approved', decidedBy: user.id, decidedAt: now } }),
      app.prisma.regulatoryFramework.update({ where: { id: req.frameworkId }, data: { retiredAt: req.framework.retiredAt ?? now } }),
    ])
    await app.audit.append({
      timestamp: now.toISOString(), actorId: user.id, action: 'framework_retired',
      entityType: 'regulatory_framework', entityId: req.frameworkId,
      details: { name: req.framework.name, requestId: rid, requestedBy: req.requestedBy, approvedBy: user.id },
      ipAddress: request.ip ?? null,
    })
    const names = await namesOf([req.requestedBy, user.id])
    await notify([req.requestedBy], {
      kind: 'framework_supersede_approved', frameworkId: req.frameworkId, requestId: rid,
      title: `${req.framework.name} is now superseded`,
      body: `${names.get(user.id) ?? user.email} approved your request to mark ${req.framework.name} as superseded.`,
    })
    return requestShape(decided, names)
  })

  // Reject (another PM, or a QC), with a reason. The framework stays current.
  const rejectSchema = z.object({ reason: z.string().trim().min(3, 'Give a reason (at least 3 characters).').max(1000) })
  app.post('/supersede-requests/:rid/reject', { preHandler: requireAuth({ roles: DECIDER_ROLES }) }, async (request, reply) => {
    const { rid } = request.params as { rid: string }
    const parsed = rejectSchema.safeParse(request.body ?? {})
    if (!parsed.success) return reply.code(400).send({ error: 'validation', message: parsed.error.issues[0]?.message ?? 'A reason is required.', issues: parsed.error.issues })
    const req = await loadRequest(rid)
    if (!req) return reply.code(404).send({ error: 'not_found' })
    if (req.status !== 'pending') return reply.code(409).send({ error: 'already_decided', message: `This request was already ${req.status}.` })
    const user = request.user!
    if (req.requestedBy === user.id) return reply.code(403).send({ error: 'own_request', message: 'You can’t reject your own request. Another PM or a QC has to.' })

    const now = new Date()
    const decided = await app.prisma.frameworkStatusRequest.update({
      where: { id: rid }, data: { status: 'rejected', decidedBy: user.id, decidedAt: now, rejectionReason: parsed.data.reason },
    })
    await app.audit.append({
      timestamp: now.toISOString(), actorId: user.id, action: 'framework_supersede_rejected',
      entityType: 'regulatory_framework', entityId: req.frameworkId,
      details: { name: req.framework.name, requestId: rid, requestedBy: req.requestedBy, reason: parsed.data.reason },
      ipAddress: request.ip ?? null,
    })
    const names = await namesOf([req.requestedBy, user.id])
    await notify([req.requestedBy], {
      kind: 'framework_supersede_rejected', frameworkId: req.frameworkId, requestId: rid,
      title: `Request to supersede ${req.framework.name} was rejected`,
      body: `${names.get(user.id) ?? user.email} rejected your request. Reason: ${parsed.data.reason}`,
    })
    return requestShape(decided, names)
  })
}
