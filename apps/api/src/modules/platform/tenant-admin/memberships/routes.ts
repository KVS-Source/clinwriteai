// Membership CRUD — Arc 3.4 of docs/pivot-plan.md.
//
// Routes:
//   GET    /admin/tenants/:tenantId/memberships              list
//   POST   /admin/tenants/:tenantId/memberships              create (invite existing user)
//   PATCH  /admin/memberships/:membershipId                  role / status change
//   DELETE /admin/memberships/:membershipId                  remove from tenant
//
// Guards:
//   - super-admin can do everything on any tenant
//   - tenant owners can do everything on their own tenant EXCEPT demote
//     the last remaining owner (would strand the tenant without an owner)
//   - owners can't demote THEMSELVES to viewer / writer / reviewer (same
//     reason — they'd lose control; another owner has to do the demotion)
//   - plain admins can read but not write

import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { requireAuth } from '../../../../auth/rbac.js'

const ROLES = ['owner', 'admin', 'writer', 'reviewer', 'viewer'] as const

const createSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(ROLES).default('viewer'),
})

const patchSchema = z.object({
  role: z.enum(ROLES).optional(),
  status: z.enum(['invited', 'active', 'suspended']).optional(),
})

async function fetchUserName(prisma: import('@prisma/client').PrismaClient, userId: string): Promise<string> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } })
  return u?.name ?? u?.email ?? userId
}

function membershipShape(m: {
  id: string
  tenantId: string
  userId: string
  role: string
  status: string
  invitedAt: Date
  activatedAt: Date | null
  suspendedAt: Date | null
  invitedBy: string | null
}, user?: { name: string; email: string; initials: string | null } | null) {
  return {
    id: m.id,
    tenantId: m.tenantId,
    userId: m.userId,
    role: m.role,
    status: m.status,
    invitedAt: m.invitedAt.toISOString(),
    activatedAt: m.activatedAt ? m.activatedAt.toISOString() : null,
    suspendedAt: m.suspendedAt ? m.suspendedAt.toISOString() : null,
    invitedBy: m.invitedBy,
    userName: user?.name ?? null,
    userEmail: user?.email ?? null,
    userInitials: user?.initials ?? null,
  }
}

export const membershipsRoutes: FastifyPluginAsync = async (app) => {
  const anyAdminGate = requireAuth({ roles: ['super-admin', 'admin'] })

  async function assertTenantAccess(
    userId: string,
    userRole: string,
    tenantId: string,
  ): Promise<'super-admin' | 'owner' | 'admin' | 'read-only' | null> {
    if (userRole === 'super-admin') return 'super-admin'
    const m = await app.prisma.membership.findUnique({
      where: { tenantId_userId: { tenantId, userId } },
      select: { role: true, status: true },
    })
    if (!m || m.status !== 'active') return null
    if (m.role === 'owner') return 'owner'
    if (m.role === 'admin') return 'admin'
    return 'read-only'
  }

  // --- List + create -----------------------------------------------------

  app.get('/admin/tenants/:tenantId/memberships', { preHandler: anyAdminGate }, async (request, reply) => {
    const { tenantId } = request.params as { tenantId: string }
    const access = await assertTenantAccess(request.user!.id, request.user!.role, tenantId)
    if (!access) return reply.code(403).send({ error: 'forbidden' })

    const rows = await app.prisma.membership.findMany({
      where: { tenantId },
      orderBy: { invitedAt: 'desc' },
      include: { user: { select: { name: true, email: true, initials: true } } },
    })
    return rows.map(r => membershipShape(r, r.user))
  })

  app.post('/admin/tenants/:tenantId/memberships', { preHandler: anyAdminGate }, async (request, reply) => {
    const { tenantId } = request.params as { tenantId: string }
    const access = await assertTenantAccess(request.user!.id, request.user!.role, tenantId)
    if (access !== 'super-admin' && access !== 'owner' && access !== 'admin') {
      return reply.code(403).send({ error: 'forbidden' })
    }

    const parsed = createSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const tenant = await app.prisma.tenant.findUnique({ where: { id: tenantId } })
    if (!tenant) return reply.code(404).send({ error: 'tenant_not_found' })

    const user = await app.prisma.user.findUnique({ where: { id: parsed.data.userId } })
    if (!user) return reply.code(404).send({ error: 'user_not_found' })

    const dupe = await app.prisma.membership.findUnique({
      where: { tenantId_userId: { tenantId, userId: parsed.data.userId } },
    })
    if (dupe) return reply.code(409).send({ error: 'already_member', membershipId: dupe.id })

    const created = await app.prisma.membership.create({
      data: {
        tenantId,
        userId: parsed.data.userId,
        role: parsed.data.role,
        status: 'invited',
        invitedBy: request.user!.id,
      },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'membership.invite',
      entityType: 'membership',
      entityId: created.id,
      details: { tenantId, userId: parsed.data.userId, role: parsed.data.role, inviteeName: await fetchUserName(app.prisma, parsed.data.userId) },
      ipAddress: request.ip ?? null,
    })

    return reply.code(201).send(membershipShape(created, { name: user.name, email: user.email, initials: user.initials }))
  })

  // --- Patch (role / status) --------------------------------------------

  app.patch('/admin/memberships/:membershipId', { preHandler: anyAdminGate }, async (request, reply) => {
    const { membershipId } = request.params as { membershipId: string }
    const parsed = patchSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })
    if (!parsed.data.role && !parsed.data.status) {
      return reply.code(400).send({ error: 'empty_update' })
    }

    const existing = await app.prisma.membership.findUnique({ where: { id: membershipId } })
    if (!existing) return reply.code(404).send({ error: 'not_found' })

    const access = await assertTenantAccess(request.user!.id, request.user!.role, existing.tenantId)
    if (access !== 'super-admin' && access !== 'owner') {
      return reply.code(403).send({ error: 'forbidden', message: 'Only super-admin or tenant owner can change memberships' })
    }

    // Owner-protection: can't demote the last remaining owner, and owners
    // can't self-demote (another owner has to do it). Blocks the tenant
    // from accidentally becoming ownerless.
    if (parsed.data.role && existing.role === 'owner' && parsed.data.role !== 'owner') {
      if (request.user!.id === existing.userId && access === 'owner') {
        return reply.code(409).send({ error: 'self_demotion', message: 'Owners cannot demote themselves; another owner must do it' })
      }
      const otherOwners = await app.prisma.membership.count({
        where: { tenantId: existing.tenantId, role: 'owner', status: 'active', NOT: { id: existing.id } },
      })
      if (otherOwners === 0) {
        return reply.code(409).send({ error: 'last_owner', message: 'Cannot demote the last remaining owner' })
      }
    }

    const data: Record<string, unknown> = {}
    if (parsed.data.role) data.role = parsed.data.role
    if (parsed.data.status) {
      data.status = parsed.data.status
      if (parsed.data.status === 'active' && !existing.activatedAt) data.activatedAt = new Date()
      if (parsed.data.status === 'suspended') data.suspendedAt = new Date()
    }

    const updated = await app.prisma.membership.update({
      where: { id: membershipId },
      data,
      include: { user: { select: { name: true, email: true, initials: true } } },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'membership.update',
      entityType: 'membership',
      entityId: membershipId,
      details: {
        tenantId: existing.tenantId,
        userId: existing.userId,
        changes: { role: parsed.data.role ?? null, status: parsed.data.status ?? null },
      },
      ipAddress: request.ip ?? null,
    })

    return membershipShape(updated, updated.user)
  })

  // --- Remove ------------------------------------------------------------

  app.delete('/admin/memberships/:membershipId', { preHandler: anyAdminGate }, async (request, reply) => {
    const { membershipId } = request.params as { membershipId: string }
    const existing = await app.prisma.membership.findUnique({ where: { id: membershipId } })
    if (!existing) return reply.code(404).send({ error: 'not_found' })

    const access = await assertTenantAccess(request.user!.id, request.user!.role, existing.tenantId)
    if (access !== 'super-admin' && access !== 'owner') {
      return reply.code(403).send({ error: 'forbidden' })
    }

    // Same owner-guard as patch: can't remove the last owner.
    if (existing.role === 'owner') {
      const otherOwners = await app.prisma.membership.count({
        where: { tenantId: existing.tenantId, role: 'owner', status: 'active', NOT: { id: existing.id } },
      })
      if (otherOwners === 0) {
        return reply.code(409).send({ error: 'last_owner', message: 'Cannot remove the last remaining owner' })
      }
    }

    await app.prisma.membership.delete({ where: { id: membershipId } })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'membership.delete',
      entityType: 'membership',
      entityId: membershipId,
      details: { tenantId: existing.tenantId, userId: existing.userId, role: existing.role },
      ipAddress: request.ip ?? null,
    })

    return { ok: true }
  })
}
