// /platform-settings — IT-admin surface for install-wide Branding +
// Localisation (Phase 3, migration 93). Reads are open to any authed
// user (sidebar, email composer, PDF header all consume the brand
// name + logo). Writes are IT-admin-only.

import type { FastifyPluginAsync } from 'fastify'
import { requireAuth } from '../../../auth/rbac.js'
import { PlatformSettingsService } from './service.js'
import { updateBrandingSchema, updateLocalisationSchema } from './schema.js'

const readGate  = requireAuth({})
const writeGate = requireAuth({ roles: ['admin'] })

export const platformSettingsRoutes: FastifyPluginAsync = async (app) => {
  const svc = new PlatformSettingsService(app.prisma)

  app.get('/', { preHandler: readGate }, async () => {
    return await svc.get()
  })

  app.patch('/branding', { preHandler: writeGate }, async (request, reply) => {
    const parsed = updateBrandingSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })
    const view = await svc.updateBranding(parsed.data, request.user!.id)
    await app.audit.append({
      timestamp:  new Date().toISOString(),
      actorId:    request.user!.id,
      action:     'platform_settings.branding_updated',
      entityType: 'platform_settings',
      entityId:   'default',
      details:    { changedKeys: Object.keys(parsed.data) },
      ipAddress:  request.ip ?? null,
    })
    return view
  })

  app.patch('/localisation', { preHandler: writeGate }, async (request, reply) => {
    const parsed = updateLocalisationSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })
    const view = await svc.updateLocalisation(parsed.data, request.user!.id)
    await app.audit.append({
      timestamp:  new Date().toISOString(),
      actorId:    request.user!.id,
      action:     'platform_settings.localisation_updated',
      entityType: 'platform_settings',
      entityId:   'default',
      details:    { changedKeys: Object.keys(parsed.data) },
      ipAddress:  request.ip ?? null,
    })
    return view
  })
}
