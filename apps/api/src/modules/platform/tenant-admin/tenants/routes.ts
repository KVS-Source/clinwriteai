// Tenant CRUD + module toggles — Arc 3.1 + 3.2 of docs/pivot-plan.md.
//
// Routes mounted at root:
//   GET    /admin/tenants                            super-admin: list
//   POST   /admin/tenants                            super-admin: create
//   GET    /admin/tenants/:tenantId                  super-admin OR member admin
//   PATCH  /admin/tenants/:tenantId                  super-admin OR tenant owner (name/slug only)
//   POST   /admin/tenants/:tenantId/suspend          super-admin
//   POST   /admin/tenants/:tenantId/archive          super-admin
//   PATCH  /admin/tenants/:tenantId/modules          super-admin OR tenant owner
//
// Module-toggle semantics (3.2): PATCH /modules replaces the enabled set.
// Runtime effective modules = intersect(FEATURE_MODULES_ENABLED env, tenant.modulesEnabled).
// The admin UI can show "deployment capped" when a tenant asks for a module
// the deployment doesn't offer — this route accepts the request + records
// intent (so re-enabling the module at the deployment level flips the
// tenant on without a second edit).

import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { enabledModules, requireAuth } from '../../../../auth/rbac.js'

const createSchema = z.object({
  slug: z.string().min(2).max(64).regex(/^[a-z0-9-]+$/, 'slug must be lowercase alphanumeric + hyphens'),
  name: z.string().min(1).max(128),
  modulesEnabled: z.array(z.enum(['A', 'B', 'C', 'D', 'E'])).default(['A']),
})

const updateSchema = z.object({
  name: z.string().min(1).max(128).optional(),
  slug: z.string().min(2).max(64).regex(/^[a-z0-9-]+$/).optional(),
})

const modulesSchema = z.object({
  modulesEnabled: z.array(z.enum(['A', 'B', 'C', 'D', 'E'])),
})

// Shape tenants for the UI's Tenant interface. Includes a derived
// `effectiveModules` list that intersects the tenant's modulesEnabled
// with the deployment-wide kill-switch (so a UI chip can show the
// difference when a tenant has requested but can't yet use a module).
function tenantShape(t: {
  id: string
  slug: string
  name: string
  status: string
  modulesEnabled: string[]
  createdAt: Date
  updatedAt: Date
  archivedAt: Date | null
}) {
  const deployment = enabledModules()
  const effective = t.modulesEnabled.filter(m => deployment.has(m as 'A' | 'B' | 'C' | 'D' | 'E'))
  return {
    id: t.id,
    slug: t.slug,
    name: t.name,
    status: t.status,
    modulesEnabled: t.modulesEnabled,
    effectiveModules: effective,
    deploymentCapped: effective.length < t.modulesEnabled.length,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    archivedAt: t.archivedAt ? t.archivedAt.toISOString() : null,
  }
}

export const tenantsRoutes: FastifyPluginAsync = async (app) => {
  const superAdminGate = requireAuth({ roles: ['super-admin'] })
  // Both super-admin and tenant-scoped owners can touch their own tenant.
  // Membership check happens inside the handler since requireAuth doesn't
  // know about tenant scope yet.
  const anyAdminGate = requireAuth({ roles: ['super-admin', 'admin'] })

  async function assertTenantAccess(request: { user?: { id: string; role: string } }, tenantId: string): Promise<'owner' | 'admin' | 'super-admin' | null> {
    const user = request.user
    if (!user) return null
    if (user.role === 'super-admin') return 'super-admin'
    const membership = await app.prisma.membership.findUnique({
      where: { tenantId_userId: { tenantId, userId: user.id } },
      select: { role: true, status: true },
    })
    if (!membership || membership.status !== 'active') return null
    if (membership.role === 'owner') return 'owner'
    if (membership.role === 'admin') return 'admin'
    return null
  }

  // --- List + create (super-admin only) ----------------------------------

  app.get('/admin/tenants', { preHandler: superAdminGate }, async () => {
    const rows = await app.prisma.tenant.findMany({ orderBy: { createdAt: 'desc' } })
    return rows.map(tenantShape)
  })

  app.post('/admin/tenants', { preHandler: superAdminGate }, async (request, reply) => {
    const parsed = createSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const existing = await app.prisma.tenant.findUnique({ where: { slug: parsed.data.slug } })
    if (existing) return reply.code(409).send({ error: 'slug_taken', message: `Tenant slug '${parsed.data.slug}' already exists` })

    const created = await app.prisma.tenant.create({
      data: {
        slug: parsed.data.slug,
        name: parsed.data.name,
        modulesEnabled: parsed.data.modulesEnabled,
      },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'tenant.create',
      entityType: 'tenant',
      entityId: created.id,
      details: { slug: created.slug, name: created.name, modulesEnabled: created.modulesEnabled },
      ipAddress: request.ip ?? null,
    })

    return reply.code(201).send(tenantShape(created))
  })

  // --- Detail / rename / module toggles ----------------------------------

  app.get('/admin/tenants/:tenantId', { preHandler: anyAdminGate }, async (request, reply) => {
    const { tenantId } = request.params as { tenantId: string }
    const access = await assertTenantAccess(request, tenantId)
    if (!access) return reply.code(403).send({ error: 'forbidden' })
    const row = await app.prisma.tenant.findUnique({ where: { id: tenantId } })
    if (!row) return reply.code(404).send({ error: 'not_found' })
    return tenantShape(row)
  })

  app.patch('/admin/tenants/:tenantId', { preHandler: anyAdminGate }, async (request, reply) => {
    const { tenantId } = request.params as { tenantId: string }
    const access = await assertTenantAccess(request, tenantId)
    // Rename restricted to super-admin + tenant owner (not plain admin role).
    if (access !== 'super-admin' && access !== 'owner') return reply.code(403).send({ error: 'forbidden' })

    const parsed = updateSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    if (parsed.data.slug) {
      const slugDupe = await app.prisma.tenant.findFirst({ where: { slug: parsed.data.slug, NOT: { id: tenantId } } })
      if (slugDupe) return reply.code(409).send({ error: 'slug_taken' })
    }

    const updated = await app.prisma.tenant.update({ where: { id: tenantId }, data: parsed.data })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'tenant.update',
      entityType: 'tenant',
      entityId: tenantId,
      details: { changedFields: Object.keys(parsed.data) },
      ipAddress: request.ip ?? null,
    })

    return tenantShape(updated)
  })

  // Module toggles (Arc 3.2). Replaces the enabled set wholesale — the UI
  // posts the full desired set each time.
  app.patch('/admin/tenants/:tenantId/modules', { preHandler: anyAdminGate }, async (request, reply) => {
    const { tenantId } = request.params as { tenantId: string }
    const access = await assertTenantAccess(request, tenantId)
    if (access !== 'super-admin' && access !== 'owner') return reply.code(403).send({ error: 'forbidden' })

    const parsed = modulesSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const updated = await app.prisma.tenant.update({
      where: { id: tenantId },
      data: { modulesEnabled: parsed.data.modulesEnabled },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'tenant.modules.update',
      entityType: 'tenant',
      entityId: tenantId,
      details: { modulesEnabled: parsed.data.modulesEnabled },
      ipAddress: request.ip ?? null,
    })

    return tenantShape(updated)
  })

  // --- Suspend / archive (super-admin only) ------------------------------

  app.post('/admin/tenants/:tenantId/suspend', { preHandler: superAdminGate }, async (request, reply) => {
    const { tenantId } = request.params as { tenantId: string }
    const row = await app.prisma.tenant.findUnique({ where: { id: tenantId } })
    if (!row) return reply.code(404).send({ error: 'not_found' })
    if (row.status === 'archived') return reply.code(409).send({ error: 'archived' })
    if (row.status === 'suspended') return tenantShape(row)
    const updated = await app.prisma.tenant.update({ where: { id: tenantId }, data: { status: 'suspended' } })
    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'tenant.suspend',
      entityType: 'tenant',
      entityId: tenantId,
      details: {},
      ipAddress: request.ip ?? null,
    })
    return tenantShape(updated)
  })

  app.post('/admin/tenants/:tenantId/archive', { preHandler: superAdminGate }, async (request, reply) => {
    const { tenantId } = request.params as { tenantId: string }
    const row = await app.prisma.tenant.findUnique({ where: { id: tenantId } })
    if (!row) return reply.code(404).send({ error: 'not_found' })
    if (row.status === 'archived') return tenantShape(row)
    const updated = await app.prisma.tenant.update({
      where: { id: tenantId },
      data: { status: 'archived', archivedAt: new Date() },
    })
    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'tenant.archive',
      entityType: 'tenant',
      entityId: tenantId,
      details: {},
      ipAddress: request.ip ?? null,
    })
    return tenantShape(updated)
  })
}
