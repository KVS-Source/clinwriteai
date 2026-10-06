// SSO connection management — Arc 3.5 of docs/pivot-plan.md.
//
// Routes:
//   GET    /admin/tenants/:tenantId/sso-connections         list
//   POST   /admin/tenants/:tenantId/sso-connections         create (draft)
//   GET    /admin/sso-connections/:id                       detail
//   PATCH  /admin/sso-connections/:id                       update
//   POST   /admin/sso-connections/:id/test                  WorkOS discovery check
//   DELETE /admin/sso-connections/:id                       disable
//
// Secrets:
//   Never stored here. WORKOS_API_KEY / WORKOS_CLIENT_ID live in
//   /opt/platform/env/api.env.enc. This table only remembers the
//   per-tenant connection id + status so the admin UI can render
//   verified / draft / disabled chips.
//
// /test endpoint:
//   For draft connections, hits the WorkOS SSO discovery endpoint and
//   records status=verified on success. The real WorkOS SDK integration
//   lands when the tenant is provisioned; today the /test endpoint
//   returns a shaped success response when workosConnectionId is set
//   (so the UI can be exercised against the stub).

import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { requireAuth } from '../../../../auth/rbac.js'

const createSchema = z.object({
  type: z.enum(['oidc', 'saml']),
  callbackUrl: z.string().url(),
  workosConnectionId: z.string().optional(),
})

const patchSchema = z.object({
  callbackUrl: z.string().url().optional(),
  workosConnectionId: z.string().optional(),
})

function ssoShape(s: {
  id: string
  tenantId: string
  type: string
  workosConnectionId: string | null
  callbackUrl: string
  status: string
  verifiedAt: Date | null
  disabledAt: Date | null
  createdAt: Date
  updatedAt: Date
}) {
  return {
    id: s.id,
    tenantId: s.tenantId,
    type: s.type as 'oidc' | 'saml',
    workosConnectionId: s.workosConnectionId,
    callbackUrl: s.callbackUrl,
    status: s.status as 'draft' | 'verified' | 'disabled',
    verifiedAt: s.verifiedAt ? s.verifiedAt.toISOString() : null,
    disabledAt: s.disabledAt ? s.disabledAt.toISOString() : null,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  }
}

export const ssoRoutes: FastifyPluginAsync = async (app) => {
  const anyAdminGate = requireAuth({ roles: ['super-admin', 'admin'] })

  async function assertTenantAccess(userId: string, userRole: string, tenantId: string): Promise<'super-admin' | 'owner' | 'admin' | null> {
    if (userRole === 'super-admin') return 'super-admin'
    const m = await app.prisma.membership.findUnique({
      where: { tenantId_userId: { tenantId, userId } },
      select: { role: true, status: true },
    })
    if (!m || m.status !== 'active') return null
    if (m.role === 'owner') return 'owner'
    if (m.role === 'admin') return 'admin'
    return null
  }

  // --- List + create -----------------------------------------------------

  app.get('/admin/tenants/:tenantId/sso-connections', { preHandler: anyAdminGate }, async (request, reply) => {
    const { tenantId } = request.params as { tenantId: string }
    const access = await assertTenantAccess(request.user!.id, request.user!.role, tenantId)
    if (!access) return reply.code(403).send({ error: 'forbidden' })

    const rows = await app.prisma.ssoConnection.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    })
    return rows.map(ssoShape)
  })

  app.post('/admin/tenants/:tenantId/sso-connections', { preHandler: anyAdminGate }, async (request, reply) => {
    const { tenantId } = request.params as { tenantId: string }
    const access = await assertTenantAccess(request.user!.id, request.user!.role, tenantId)
    if (access !== 'super-admin' && access !== 'owner') return reply.code(403).send({ error: 'forbidden' })

    const parsed = createSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const tenant = await app.prisma.tenant.findUnique({ where: { id: tenantId } })
    if (!tenant) return reply.code(404).send({ error: 'tenant_not_found' })

    const created = await app.prisma.ssoConnection.create({
      data: {
        tenantId,
        type: parsed.data.type,
        callbackUrl: parsed.data.callbackUrl,
        workosConnectionId: parsed.data.workosConnectionId,
      },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'sso.create',
      entityType: 'sso_connection',
      entityId: created.id,
      details: { tenantId, type: parsed.data.type },
      ipAddress: request.ip ?? null,
    })

    return reply.code(201).send(ssoShape(created))
  })

  // --- Detail / update ---------------------------------------------------

  app.get('/admin/sso-connections/:id', { preHandler: anyAdminGate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const row = await app.prisma.ssoConnection.findUnique({ where: { id } })
    if (!row) return reply.code(404).send({ error: 'not_found' })
    const access = await assertTenantAccess(request.user!.id, request.user!.role, row.tenantId)
    if (!access) return reply.code(403).send({ error: 'forbidden' })
    return ssoShape(row)
  })

  app.patch('/admin/sso-connections/:id', { preHandler: anyAdminGate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const parsed = patchSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const existing = await app.prisma.ssoConnection.findUnique({ where: { id } })
    if (!existing) return reply.code(404).send({ error: 'not_found' })

    const access = await assertTenantAccess(request.user!.id, request.user!.role, existing.tenantId)
    if (access !== 'super-admin' && access !== 'owner') return reply.code(403).send({ error: 'forbidden' })

    const updated = await app.prisma.ssoConnection.update({
      where: { id },
      data: parsed.data,
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'sso.update',
      entityType: 'sso_connection',
      entityId: id,
      details: { changedFields: Object.keys(parsed.data) },
      ipAddress: request.ip ?? null,
    })

    return ssoShape(updated)
  })

  // --- Test (verify) + disable ------------------------------------------

  // Stub discovery check: real version calls WorkOS when the SDK lands.
  // Returns ok=true + flips status=verified when workosConnectionId is
  // populated (operator confirms the WorkOS side); returns ok=false
  // otherwise so the UI shows "Connection id not set".
  app.post('/admin/sso-connections/:id/test', { preHandler: anyAdminGate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const existing = await app.prisma.ssoConnection.findUnique({ where: { id } })
    if (!existing) return reply.code(404).send({ error: 'not_found' })

    const access = await assertTenantAccess(request.user!.id, request.user!.role, existing.tenantId)
    if (access !== 'super-admin' && access !== 'owner') return reply.code(403).send({ error: 'forbidden' })

    if (!existing.workosConnectionId) {
      return reply.code(422).send({
        ok: false,
        error: 'no_connection_id',
        message: 'Set workosConnectionId before running /test',
      })
    }

    // When the WorkOS SDK is wired, replace this stub with a real
    // workos.sso.listConnections({ connectionIds: [existing.workosConnectionId] })
    // call. For now we assume present id = verified so the UI can be
    // exercised end-to-end.
    const now = new Date()
    const updated = await app.prisma.ssoConnection.update({
      where: { id },
      data: { status: 'verified', verifiedAt: now, disabledAt: null },
    })

    await app.audit.append({
      timestamp: now.toISOString(),
      actorId: request.user!.id,
      action: 'sso.verify',
      entityType: 'sso_connection',
      entityId: id,
      details: { workosConnectionId: existing.workosConnectionId, stub: true },
      ipAddress: request.ip ?? null,
    })

    return { ok: true, connection: ssoShape(updated) }
  })

  app.delete('/admin/sso-connections/:id', { preHandler: anyAdminGate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const existing = await app.prisma.ssoConnection.findUnique({ where: { id } })
    if (!existing) return reply.code(404).send({ error: 'not_found' })

    const access = await assertTenantAccess(request.user!.id, request.user!.role, existing.tenantId)
    if (access !== 'super-admin' && access !== 'owner') return reply.code(403).send({ error: 'forbidden' })

    const updated = await app.prisma.ssoConnection.update({
      where: { id },
      data: { status: 'disabled', disabledAt: new Date() },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'sso.disable',
      entityType: 'sso_connection',
      entityId: id,
      details: {},
      ipAddress: request.ip ?? null,
    })

    return ssoShape(updated)
  })
}
