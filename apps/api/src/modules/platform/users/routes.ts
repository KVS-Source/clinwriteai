// Admin-only user management.
//
// What's here:
//   - Listing / lookup for users, scoped to the caller's tenant.
//   - Invite (one-time 7-day link, AC-PM-007), resend (rotates the link).
//   - Role + modules mutation and status transitions guarded by the pure
//     state machine in ./status-machine.ts.
//
// What's NOT here (owned elsewhere):
//   - Invitation preview/accept: public, lives in auth/invitation-routes.ts.
//   - User self-service profile edits: lands under /me in Phase 1 Week 5.
//   - SCIM provisioning: wired by the WorkOS provider (Phase 1 Week 5-6).
//
// Scope rules:
//   - super-admin: all users.
//   - admin with a tenantId: only users in that tenant; cannot create,
//     modify or grant super-admin.
//   - admin without a tenantId (platform admin): all users, as before.
//   - An out-of-scope target is reported as 404, not 403.
//
// Safety rules (409): no self suspend/deprovision/demote, and never remove
// the last active admin in a scope.

import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify'
import type { Prisma, User } from '@prisma/client'
import { z } from 'zod'
import { requireAuth } from '../../../auth/rbac.js'
import { buildInviteUrl, generateInvitationToken } from './invitations.js'
import { eventForTarget, isUserStatus, transition, type UserEvent, type UserStatus } from './status-machine.js'

const ROLES = [
  'admin', 'clinical-writer', 'scientific-writer',
  'medical-writer', 'regulatory-writer', 'ideation-lead', 'reviewer', 'read-only',
] as const
const ADMIN_ROLES = new Set<string>(['admin'])

const inviteSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).optional(),
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  role: z.enum(ROLES),
  modules: z.array(z.enum(['A', 'B', 'C', 'D', 'E'])).default([]),
  initials: z.string().max(5).optional(),
  tenantId: z.string().optional(),
}).refine(v => v.name || (v.firstName && v.lastName), {
  message: 'Provide name, or both firstName and lastName',
  path: ['name'],
})

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  role: z.enum(ROLES).optional(),
  modules: z.array(z.enum(['A', 'B', 'C', 'D', 'E'])).optional(),
  initials: z.string().max(5).optional(),
  tenantId: z.string().optional(),
  status: z.enum(['invited', 'active', 'suspended', 'deprovisioned']).optional(),
})

const listQuerySchema = z.object({
  q: z.string().trim().min(1).optional(),
  role: z.enum(ROLES).optional(),
  status: z.enum(['invited', 'active', 'suspended', 'deprovisioned']).optional(),
  module: z.enum(['A', 'B', 'C', 'D', 'E']).optional(),
  tenantId: z.string().optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
})

type Actor = NonNullable<FastifyRequest['user']>

export const userRoutes: FastifyPluginAsync = async (app) => {
  const adminGate = requireAuth({ roles: ['admin'] })

  // --- scope helpers -------------------------------------------------------

  // Platform-wide actors (admin with tenantId=null) see every tenant;
  // tenant-scoped admins only see their own tenant. The 2026-10-27 role
  // consolidation collapsed 'super-admin' into 'admin + tenantId=null'.
  function isPlatformWide(actor: Actor): boolean {
    return actor.tenantId == null
  }

  function scopeWhere(actor: Actor): Prisma.UserWhereInput {
    return isPlatformWide(actor) ? {} : { tenantId: actor.tenantId }
  }

  async function loadTarget(actor: Actor, id: string): Promise<User | null> {
    const user = await app.prisma.user.findFirst({ where: { id, ...scopeWhere(actor) } })
    if (!user) return null
    // Tenant-scoped admins can't touch platform admins (users with
    // tenantId=null). Prevents a tenant admin from deprovisioning the
    // platform ops team by accident.
    if (!isPlatformWide(actor) && user.tenantId == null) return null
    return user
  }

  function reject(reply: FastifyReply, code: number, error: string, message: string) {
    return reply.code(code).send({ error, message })
  }

  // Would removing `target` from the active-admin pool leave nobody in scope?
  async function isLastActiveAdmin(target: User): Promise<boolean> {
    if (target.status !== 'active' || !ADMIN_ROLES.has(target.role)) return false
    const others = await app.prisma.user.count({
      where: {
        id: { not: target.id },
        status: 'active',
        role: { in: ['admin'] },
        // Platform admins (tenantId null) are cross-tenant, so they count
        // for every tenant; tenant admins only count for their own.
        OR: target.tenantId ? [{ tenantId: target.tenantId }, { tenantId: null }] : [{ tenantId: null }],
      },
    })
    return others === 0
  }

  // Shared guard for anything that removes a user's admin standing or access.
  async function guardAdminLoss(
    actor: Actor, target: User, reply: FastifyReply, what: string,
  ): Promise<boolean> {
    if (target.id === actor.id) {
      reject(reply, 409, 'self_action', `You cannot ${what} your own account`)
      return false
    }
    if (await isLastActiveAdmin(target)) {
      reject(reply, 409, 'last_admin', `Cannot ${what} the last active admin`)
      return false
    }
    return true
  }

  // Apply a state-machine event: update status, revoke sessions when access
  // ends, withdraw pending invitations on deprovision. Caller has already
  // validated the transition.
  async function applyEvent(user: User, event: UserEvent, to: UserStatus): Promise<User> {
    const ops: Prisma.PrismaPromise<unknown>[] = [
      app.prisma.user.update({ where: { id: user.id }, data: { status: to } }),
    ]
    if (event === 'suspend' || event === 'deprovision') {
      ops.push(app.prisma.session.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      }))
    }
    if (event === 'deprovision') {
      ops.push(app.prisma.userInvitation.updateMany({
        where: { userId: user.id, acceptedAt: null, revokedAt: null },
        data: { revokedAt: new Date() },
      }))
    }
    const [updated] = await app.prisma.$transaction(ops)
    return updated as User
  }

  async function audit(request: FastifyRequest, action: string, entityId: string, details: Record<string, unknown>) {
    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action,
      entityType: 'user',
      entityId,
      details,
      ipAddress: request.ip ?? null,
    })
  }

  // Rotate the invitation: revoke any live one, issue a fresh token, and
  // queue the invitation email. Email failure never fails the invite — the
  // admin still gets the link in the response and `emailQueued` says whether
  // the message was handed to the delivery queue.
  async function issueInvitation(user: User, invitedBy: string) {
    const { token, tokenHash, expiresAt } = generateInvitationToken()
    await app.prisma.$transaction([
      app.prisma.userInvitation.updateMany({
        where: { userId: user.id, acceptedAt: null, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
      app.prisma.userInvitation.create({ data: { userId: user.id, tokenHash, expiresAt, invitedBy } }),
    ])
    const inviteUrl = buildInviteUrl(app.env.CORS_ORIGIN, token)
    const inviteExpiresAt = expiresAt.toISOString()

    let emailQueued = false
    try {
      await app.notifications.send({
        recipientId: user.id,
        kind: 'user.invitation',
        title: 'You have been invited to ClinWrite',
        body:
          `Hello ${user.name},

` +
          `You have been invited to ClinWrite as ${user.role}. ` +
          `Open the link below, accept the Terms & Conditions, then sign in with ${user.email}.

` +
          `${inviteUrl}

` +
          `This link expires on ${expiresAt.toUTCString()}.`,
        channels: ['email'],
        // The raw link is deliberately kept out of `payload` (and so out of
        // the persisted notification metadata); it travels only in the body.
        payload: { userId: user.id, expiresAt: inviteExpiresAt },
      })
      emailQueued = true
    } catch (err) {
      app.log.error({ err, userId: user.id }, 'failed to queue invitation email')
    }
    return { inviteUrl, inviteExpiresAt, emailQueued }
  }

  function illegalTransition(reply: FastifyReply, from: string, event: string) {
    return reject(reply, 409, 'invalid_transition', `User status is '${from}'; '${event}' is not allowed`)
  }

  // --- reads ---------------------------------------------------------------

  // Without query params this returns the full scoped array (existing
  // clients). Any of q/role/status/module/tenantId/page/pageSize switches
  // to a paginated envelope { items, total, page, pageSize }.
  app.get('/', { preHandler: adminGate }, async (request, reply) => {
    const actor = request.user!
    const parsedQuery = listQuerySchema.safeParse(request.query)
    if (!parsedQuery.success) return reply.code(400).send({ error: 'validation', issues: parsedQuery.error.issues })
    const { q, role, status, module, tenantId, page, pageSize } = parsedQuery.data

    const where: Prisma.UserWhereInput = { ...scopeWhere(actor) }
    // Tenant-scoped admins can't see platform admins; the scopeWhere
    // already pins tenantId, which is the only lever that matters now
    // that 'super-admin' is gone (platform admins have tenantId=null).
    if (role) where.role = role
    if (status) where.status = status
    if (module) where.modules = { has: module }
    // tenantId filter only narrows; tenant admins are already pinned to theirs.
    if (tenantId && isPlatformWide(actor)) where.tenantId = tenantId
    if (q) {
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
      ]
    }

    if (page === undefined && pageSize === undefined && Object.keys(request.query as object).length === 0) {
      return app.prisma.user.findMany({ where, orderBy: { createdAt: 'desc' } })
    }

    const p = page ?? 1
    const size = pageSize ?? 50
    const [items, total] = await Promise.all([
      app.prisma.user.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (p - 1) * size, take: size }),
      app.prisma.user.count({ where }),
    ])
    return { items, total, page: p, pageSize: size }
  })

  app.get('/:id', { preHandler: adminGate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const user = await loadTarget(request.user!, id)
    if (!user) return reply.code(404).send({ error: 'not_found' })
    return user
  })

  // --- invite --------------------------------------------------------------

  const inviteHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    const actor = request.user!
    const parsed = inviteSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })
    const { firstName, lastName, name, ...rest } = parsed.data

    // (The 2026-10-27 role consolidation retired 'super-admin'; the only
    // admin role left is 'admin'. Platform admins have tenantId=null.)
    // Tenant admins can only invite into their own tenant.
    let tenantId = rest.tenantId
    if (!isPlatformWide(actor)) {
      if (tenantId && tenantId !== actor.tenantId) {
        return reject(reply, 403, 'forbidden', 'Cannot invite users into another tenant')
      }
      tenantId = actor.tenantId!
    }

    if (tenantId && !(await app.prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } }))) {
      return reject(reply, 400, 'tenant_not_found', `Tenant '${tenantId}' does not exist`)
    }

    const email = rest.email.trim().toLowerCase()
    const existing = await app.prisma.user.findUnique({ where: { email } })
    if (existing) return reply.code(409).send({ error: 'conflict', message: 'Email already registered' })

    const created = await app.prisma.user.create({
      data: { ...rest, email, tenantId, name: name ?? `${firstName} ${lastName}`, status: 'invited' },
    })
    const invite = await issueInvitation(created, actor.id)

    await audit(request, 'user.invite', created.id, {
      email: created.email, role: created.role, modules: created.modules, inviteExpiresAt: invite.inviteExpiresAt, emailQueued: invite.emailQueued,
    })

    return reply.code(201).send({ ...created, ...invite })
  }
  app.post('/', { preHandler: adminGate }, inviteHandler)

  // --- update (role / modules / name) --------------------------------------

  app.patch('/:id', { preHandler: adminGate }, async (request, reply) => {
    const actor = request.user!
    const { id } = request.params as { id: string }
    const parsed = updateSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const existing = await loadTarget(actor, id)
    if (!existing) return reply.code(404).send({ error: 'not_found' })

    const { status: requestedStatus, ...fields } = parsed.data

    if (fields.tenantId !== undefined && fields.tenantId !== existing.tenantId && !isPlatformWide(actor)) {
      return reject(reply, 403, 'forbidden', 'Cannot move users between tenants')
    }
    if (existing.status === 'deprovisioned') {
      return reject(reply, 409, 'deprovisioned', 'User is deprovisioned and can no longer be modified')
    }
    if (fields.tenantId && fields.tenantId !== existing.tenantId
        && !(await app.prisma.tenant.findUnique({ where: { id: fields.tenantId }, select: { id: true } }))) {
      return reject(reply, 400, 'tenant_not_found', `Tenant '${fields.tenantId}' does not exist`)
    }

    // Demoting (or de-moduling is fine) an admin: same protections as losing access.
    const losesAdmin = fields.role !== undefined && ADMIN_ROLES.has(existing.role) && !ADMIN_ROLES.has(fields.role)
    if (losesAdmin && !(await guardAdminLoss(actor, existing, reply, 'demote'))) return reply

    // Status goes through the state machine, never straight to the column.
    let event: UserEvent | null = null
    let target: UserStatus | null = null
    if (requestedStatus && requestedStatus !== existing.status) {
      if (!isUserStatus(existing.status)) return reject(reply, 409, 'invalid_transition', `Unknown status '${existing.status}'`)
      event = eventForTarget(existing.status, requestedStatus)
      const result = event ? transition(existing.status, event) : null
      if (!event || !result?.ok) return illegalTransition(reply, existing.status, requestedStatus)
      target = result.to
      if ((event === 'suspend' || event === 'deprovision') && !(await guardAdminLoss(actor, existing, reply, event))) return reply
    }

    let updated = Object.keys(fields).length > 0
      ? await app.prisma.user.update({ where: { id }, data: fields })
      : existing
    if (event && target) updated = await applyEvent(updated, event, target)

    await audit(request, 'user.update', id, {
      changedFields: Object.keys(fields),
      ...(fields.role !== undefined && { roleFrom: existing.role, roleTo: fields.role }),
      ...(event && { statusFrom: existing.status, statusTo: target }),
    })

    return updated
  })

  // --- lifecycle -----------------------------------------------------------

  // Deprovision = status transition + session revocation. We never hard-delete
  // users; their id lives on in audit_events and would orphan references.
  app.delete('/:id', { preHandler: adminGate }, async (request, reply) => {
    const actor = request.user!
    const { id } = request.params as { id: string }
    const existing = await loadTarget(actor, id)
    if (!existing) return reply.code(404).send({ error: 'not_found' })
    if (existing.status === 'deprovisioned') return { ok: true }
    if (!isUserStatus(existing.status)) return illegalTransition(reply, existing.status, 'deprovision')

    const result = transition(existing.status, 'deprovision')
    if (!result.ok) return illegalTransition(reply, existing.status, 'deprovision')
    if (!(await guardAdminLoss(actor, existing, reply, 'deprovision'))) return reply

    await applyEvent(existing, 'deprovision', result.to)
    await audit(request, 'user.deprovision', id, { email: existing.email, statusFrom: existing.status })
    return { ok: true }
  })

  // Suspend / reactivate / resend-invite sit alongside the invite +
  // deprovision above. Suspend also revokes active sessions so the user
  // bounces at their next request.
  app.post('/:id/suspend', { preHandler: adminGate }, async (request, reply) => {
    const actor = request.user!
    const { id } = request.params as { id: string }
    const existing = await loadTarget(actor, id)
    if (!existing) return reply.code(404).send({ error: 'not_found' })
    if (existing.status === 'deprovisioned') {
      return reply.code(409).send({ error: 'deprovisioned', message: 'User is deprovisioned; cannot suspend' })
    }
    if (existing.status === 'suspended') return existing
    if (!isUserStatus(existing.status)) return illegalTransition(reply, existing.status, 'suspend')

    const result = transition(existing.status, 'suspend')
    if (!result.ok) return illegalTransition(reply, existing.status, 'suspend')
    if (!(await guardAdminLoss(actor, existing, reply, 'suspend'))) return reply

    const updated = await applyEvent(existing, 'suspend', result.to)
    await audit(request, 'user.suspend', id, { email: existing.email })
    return updated
  })

  app.post('/:id/reactivate', { preHandler: adminGate }, async (request, reply) => {
    const actor = request.user!
    const { id } = request.params as { id: string }
    const existing = await loadTarget(actor, id)
    if (!existing) return reply.code(404).send({ error: 'not_found' })
    if (existing.status === 'deprovisioned') {
      return reply.code(409).send({ error: 'deprovisioned', message: 'Deprovisioned users cannot be reactivated; invite as a new user' })
    }
    if (existing.status === 'active') return existing
    if (!isUserStatus(existing.status)) return illegalTransition(reply, existing.status, 'reactivate')

    // Only suspended users reactivate; invitees must accept their invitation.
    const result = transition(existing.status, 'reactivate')
    if (!result.ok) return illegalTransition(reply, existing.status, 'reactivate')

    const updated = await applyEvent(existing, 'reactivate', result.to)
    await audit(request, 'user.reactivate', id, { email: existing.email, previousStatus: existing.status })
    return updated
  })

  // Resend invite — valid only for users still in 'invited' status. Rotates
  // the token (old link stops working) and restarts the 7-day window.
  app.post('/:id/resend-invite', { preHandler: adminGate }, async (request, reply) => {
    const actor = request.user!
    const { id } = request.params as { id: string }
    const existing = await loadTarget(actor, id)
    if (!existing) return reply.code(404).send({ error: 'not_found' })
    if (existing.status !== 'invited') {
      return reply.code(409).send({ error: 'not_invited', message: `User status is '${existing.status}'; resend-invite only valid for 'invited'` })
    }

    const invite = await issueInvitation(existing, actor.id)
    await audit(request, 'user.invite.resend', id, { email: existing.email, inviteExpiresAt: invite.inviteExpiresAt })

    return {
      ok: true,
      email: existing.email,
      ...invite,
      note: invite.emailQueued ? 'New invitation link issued and emailed' : 'New invitation link issued; email could not be queued, share the link manually',
    }
  })
}
