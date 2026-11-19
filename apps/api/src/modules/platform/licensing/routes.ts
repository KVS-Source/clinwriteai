// /license — IT-admin surface for the per-install licensing token.
//
// Reads: any authenticated user (every screen needs to know whether
// the install is licensed; the sidebar + <ModuleGate /> on the web
// side read this). The response never includes the raw token.
//
// Writes: IT-admin-only (role='admin'). Importing a token requires
// a fresh verification server-side — a UI that lets admins paste any
// string won't widen the trust boundary.

import type { FastifyPluginAsync } from 'fastify'
import { requireAuth } from '../../../auth/rbac.js'
import { LicenseService } from './service.js'
import { importLicenseSchema } from './schema.js'

const readGate  = requireAuth({})
const writeGate = requireAuth({ roles: ['admin'] })

export const licenseRoutes: FastifyPluginAsync = async (app) => {
  const svc = new LicenseService(app.prisma)

  // GET /license — current license view (re-verified on every read).
  app.get('/', { preHandler: readGate }, async () => {
    return await svc.getActive()
  })

  // POST /license/import — IT admin pastes a token issued by GenBioCa HQ.
  // Returns the structured view when the import succeeds; a typed error
  // body (reason + message) when verification fails so the UI can
  // explain why (expired, tampered, wrong issuer, ...).
  app.post('/import', { preHandler: writeGate }, async (request, reply) => {
    const parsed = importLicenseSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const result = await svc.importLicense(parsed.data.token, request.user!.id)
    if (!result.ok) {
      // Audit the failed import so we have a trail of "admin tried to
      // import a bad token" — useful if a customer is pasting
      // tampered / stale tokens by mistake.
      await app.audit.append({
        timestamp:  new Date().toISOString(),
        actorId:    request.user!.id,
        action:     'license.import_failed',
        entityType: 'license',
        entityId:   'n/a',
        details:    { reason: result.reason, message: result.message },
        ipAddress:  request.ip ?? null,
      })
      return reply.code(422).send({ error: result.reason, message: result.message })
    }

    await app.audit.append({
      timestamp:  new Date().toISOString(),
      actorId:    request.user!.id,
      action:     'license.imported',
      entityType: 'license',
      entityId:   result.license.installId ?? 'unknown',
      details:    {
        installId:    result.license.installId,
        customerName: result.license.customerName,
        modules:      result.license.modules,
        features:     result.license.features,
        expiry:       result.license.expiry,
      },
      ipAddress:  request.ip ?? null,
    })
    return result.license
  })
}
