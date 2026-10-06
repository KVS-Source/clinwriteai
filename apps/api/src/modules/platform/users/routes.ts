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

  // Arc 3.3 — user lifecycle extensions. Suspend / reactivate / resend-invite
  // sit alongside the existing invite + deprovision above. All transition
  // through User.status; suspend also revokes active sessions so the user
  // bounces at their next request.
  app.post('/:id/suspend', { preHandler: adminGate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const existing = await app.prisma.user.findUnique({ where: { id } })
    if (!existing) return reply.code(404).send({ error: 'not_found' })
    if (existing.status === 'deprovisioned') {
      return reply.code(409).send({ error: 'deprovisioned', message: 'User is deprovisioned; cannot suspend' })
    }
    if (existing.status === 'suspended') return existing

    const [updated] = await app.prisma.$transaction([
      app.prisma.user.update({ where: { id }, data: { status: 'suspended' } }),
      app.prisma.session.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ])

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'user.suspend',
      entityType: 'user',
      entityId: id,
      details: { email: existing.email },
      ipAddress: request.ip ?? null,
    })

    return updated
  })

  app.post('/:id/reactivate', { preHandler: adminGate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const existing = await app.prisma.user.findUnique({ where: { id } })
    if (!existing) return reply.code(404).send({ error: 'not_found' })
    if (existing.status === 'deprovisioned') {
      return reply.code(409).send({ error: 'deprovisioned', message: 'Deprovisioned users cannot be reactivated; invite as a new user' })
    }
    if (existing.status === 'active') return existing

    const updated = await app.prisma.user.update({ where: { id }, data: { status: 'active' } })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'user.reactivate',
      entityType: 'user',
      entityId: id,
      details: { email: existing.email, previousStatus: existing.status },
      ipAddress: request.ip ?? null,
    })

    return updated
  })

  // Resend invite — valid only for users still in 'invited' status.
  // Real email dispatch wires through the notifications plugin when the
  // SES/Twilio adapter lands (project_phase_4_deferrals). For now this
  // bumps a timestamp + records the attempt in the audit log so operators
  // can see who re-nudged whom.
  app.post('/:id/resend-invite', { preHandler: adminGate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const existing = await app.prisma.user.findUnique({ where: { id } })
    if (!existing) return reply.code(404).send({ error: 'not_found' })
    if (existing.status !== 'invited') {
      return reply.code(409).send({ error: 'not_invited', message: `User status is '${existing.status}'; resend-invite only valid for 'invited'` })
    }

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'user.invite.resend',
      entityType: 'user',
      entityId: id,
      details: { email: existing.email },
      ipAddress: request.ip ?? null,
    })

    return { ok: true, email: existing.email, note: 'invite re-send recorded; real email dispatch pending notifications adapter' }
  })
}
