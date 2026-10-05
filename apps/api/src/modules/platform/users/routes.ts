// Admin-only user management.
//
// What's here:
//   - Listing / lookup for all users.
//   - Role + modules + status mutation (the three fields that drive RBAC).
//
// What's NOT here (owned elsewhere):
//   - User self-service profile edits: lands under /me in Phase 1 Week 5.
//   - SCIM provisioning: wired by the WorkOS provider (Phase 1 Week 5-6).

import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { requireAuth } from '../../../auth/rbac.js'

const inviteSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  role: z.enum([
    'super-admin', 'admin', 'clinical-writer', 'scientific-writer',
    'medical-writer', 'regulatory-writer', 'ideation-lead', 'reviewer', 'read-only',
  ]),
  modules: z.array(z.enum(['A', 'B', 'C', 'D', 'E'])).default([]),
  initials: z.string().max(5).optional(),
  tenantId: z.string().optional(),
})

const updateSchema = inviteSchema.partial().omit({ email: true }).extend({
  status: z.enum(['invited', 'active', 'suspended', 'deprovisioned']).optional(),
})

export const userRoutes: FastifyPluginAsync = async (app) => {
  const adminGate = requireAuth({ roles: ['admin', 'super-admin'] })

  app.get('/', { preHandler: adminGate }, async () => {
    return app.prisma.user.findMany({ orderBy: { createdAt: 'desc' } })
  })

  app.get('/:id', { preHandler: adminGate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const user = await app.prisma.user.findUnique({ where: { id } })
    if (!user) return reply.code(404).send({ error: 'not_found' })
    return user
  })

  app.post('/', { preHandler: adminGate }, async (request, reply) => {
    const parsed = inviteSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const existing = await app.prisma.user.findUnique({ where: { email: parsed.data.email } })
    if (existing) return reply.code(409).send({ error: 'conflict', message: 'Email already registered' })

    const created = await app.prisma.user.create({
      data: {
        ...parsed.data,
        status: 'invited',
      },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'user.invite',
      entityType: 'user',
      entityId: created.id,
      details: { email: created.email, role: created.role, modules: created.modules },
      ipAddress: request.ip ?? null,
    })

    return reply.code(201).send(created)
  })

  app.patch('/:id', { preHandler: adminGate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const parsed = updateSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const existing = await app.prisma.user.findUnique({ where: { id } })
    if (!existing) return reply.code(404).send({ error: 'not_found' })

    const updated = await app.prisma.user.update({ where: { id }, data: parsed.data })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'user.update',
      entityType: 'user',
      entityId: id,
      details: { changedFields: Object.keys(parsed.data) },
      ipAddress: request.ip ?? null,
    })

    return updated
  })

  // Deprovision = status transition + session revocation. We never hard-delete
  // users; their id lives on in audit_events and would orphan references.
  app.delete('/:id', { preHandler: adminGate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const existing = await app.prisma.user.findUnique({ where: { id } })
    if (!existing) return reply.code(404).send({ error: 'not_found' })

    await app.prisma.$transaction([
      app.prisma.user.update({ where: { id }, data: { status: 'deprovisioned' } }),
      app.prisma.session.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ])

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'user.deprovision',
      entityType: 'user',
      entityId: id,
      details: { email: existing.email },
      ipAddress: request.ip ?? null,
    })

    return { ok: true }
  })
}
