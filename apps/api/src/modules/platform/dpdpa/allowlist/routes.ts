// Cross-border transfer allow-list — Arc 7.4 admin surface.
//
//   GET    /admin/dpdpa/transfer-allowlist           list current entries
//   PUT    /admin/dpdpa/transfer-allowlist/:code     add/replace a jurisdiction
//   DELETE /admin/dpdpa/transfer-allowlist/:code     remove a jurisdiction
//
// Super-admin only. The list is operator-managed from MeitY
// notifications (blacklist model → the list OF what is NOT blocked;
// empty list = all cross-border blocked). The transfer-gate wrapper
// (apps/api/src/modules/platform/dpdpa/transfer-gate.ts) reads this
// to decide whether a blob or queue write destination is allowed for
// an IN-residency tenant.

import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { requireAuth } from '../../../../auth/rbac.js'

const putSchema = z.object({
  displayName: z.string().min(1).max(128),
  notes: z.string().max(500).optional(),
})

export const transferAllowlistRoutes: FastifyPluginAsync = async (app) => {
  const superAdmin = requireAuth({ roles: ['super-admin'] })

  app.get('/admin/dpdpa/transfer-allowlist', { preHandler: superAdmin }, async () => {
    return app.prisma.allowedTransferJurisdiction.findMany({
      orderBy: { code: 'asc' },
    })
  })

  app.put('/admin/dpdpa/transfer-allowlist/:code', { preHandler: superAdmin }, async (request, reply) => {
    const { code } = request.params as { code: string }
    if (!/^[A-Z]{2}$/.test(code)) {
      return reply.code(400).send({ error: 'invalid_code', message: 'Country code must be ISO-3166-1 alpha-2 (two uppercase letters).' })
    }

    const parsed = putSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const upserted = await app.prisma.allowedTransferJurisdiction.upsert({
      where: { code },
      create: {
        code,
        displayName: parsed.data.displayName,
        notes: parsed.data.notes ?? null,
        addedByUserId: request.user!.id,
      },
      update: {
        displayName: parsed.data.displayName,
        notes: parsed.data.notes ?? null,
      },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'transfer_allowlist.upsert',
      entityType: 'allowed_transfer_jurisdiction',
      entityId: code,
      details: { displayName: parsed.data.displayName },
      ipAddress: request.ip ?? null,
    })

    return upserted
  })

  app.delete('/admin/dpdpa/transfer-allowlist/:code', { preHandler: superAdmin }, async (request, reply) => {
    const { code } = request.params as { code: string }
    const existing = await app.prisma.allowedTransferJurisdiction.findUnique({ where: { code } })
    if (!existing) return reply.code(404).send({ error: 'not_found' })

    await app.prisma.allowedTransferJurisdiction.delete({ where: { code } })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'transfer_allowlist.remove',
      entityType: 'allowed_transfer_jurisdiction',
      entityId: code,
      details: {},
      ipAddress: request.ip ?? null,
    })

    return reply.code(204).send()
  })
}
