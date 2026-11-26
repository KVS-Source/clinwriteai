// /policy-packages — the tenant admin imports a signed policy package from GenBioCa (docs/policy-packages.md).
//
//   POST /policy-packages/preview   what importing would change; writes nothing
//   POST /policy-packages/import    applies it: one new policy version per document type it covers
//
// Admin only, like the license import: the package changes how documents are drafted for every project.

import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { requireAuth } from '../../../auth/rbac.js'
import { LicenseService } from '../licensing/service.js'
import { resolveLicensePublicKey } from '../licensing/keys.js'
import { PolicyPackageService } from './package.js'

const writeGate = requireAuth({ roles: ['admin'] })
const bodySchema = z.object({ package: z.string().trim().min(20).max(2_000_000) })

export const policyPackageRoutes: FastifyPluginAsync = async (app) => {
  const service = async () => {
    // The install's own id comes from its (verified) license; a package for specific installs needs it.
    const license = await new LicenseService(app.prisma).getActive()
    return new PolicyPackageService(app.prisma, { publicKeyPem: resolveLicensePublicKey().pem, installId: license.installId })
  }

  app.post('/preview', { preHandler: writeGate }, async (request, reply) => {
    const parsed = bodySchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })
    const result = await (await service()).preview(parsed.data.package)
    if (!result.ok) return reply.code(422).send({ error: result.reason, message: result.message })
    const { plans: _plans, ...view } = result.value
    return view
  })

  app.post('/import', { preHandler: writeGate }, async (request, reply) => {
    const parsed = bodySchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })
    let result: Awaited<ReturnType<PolicyPackageService['importPackage']>>
    try {
      result = await (await service()).importPackage(parsed.data.package, request.user!.id)
    } catch (err) {
      // Two imports (or an import and a PM's new version) at the same moment both take the next version number.
      if ((err as { code?: string }).code === 'P2002') {
        return reply.code(409).send({ error: 'policy_changed', message: 'The policy changed while importing. Preview the package again, then import.' })
      }
      throw err
    }
    if (!result.ok || !result.value.ok) {
      const failure = result.ok
        ? { error: 'package_not_importable', message: 'The package can’t be imported as it is. Preview it to see why.', items: result.value.items }
        : { error: result.reason, message: result.message }
      await app.audit.append({
        timestamp:  new Date().toISOString(),
        actorId:    request.user!.id,
        action:     'policy_package.import_failed',
        entityType: 'policy_package',
        entityId:   result.ok ? result.value.packageId : 'unknown',
        details:    result.ok
          ? { packageVersion: result.value.packageVersion, sha256: result.value.sha256, errors: result.value.items.flatMap(i => i.errors) }
          : { reason: result.reason, message: result.message },
        ipAddress:  request.ip ?? null,
      })
      return reply.code(422).send(failure)
    }
    const v = result.value
    await app.audit.append({
      timestamp:  new Date().toISOString(),
      actorId:    request.user!.id,
      action:     'policy_package.imported',
      entityType: 'policy_package',
      entityId:   v.packageId,
      details:    {
        packageVersion: v.packageVersion,
        sha256:         v.sha256,
        description:    v.description,
        applied:        v.applied,
        warnings:       v.items.flatMap(i => i.warnings.map(w => `${i.docType}: ${w}`)),
      },
      ipAddress:  request.ip ?? null,
    })
    for (const a of v.applied) {
      await app.audit.append({
        timestamp:  new Date().toISOString(),
        actorId:    request.user!.id,
        action:     'document_type_policy.build_plan_imported',
        entityType: 'document_type_policy',
        entityId:   a.policyId,
        details:    { docType: a.docType, version: a.version, packageId: v.packageId, packageVersion: v.packageVersion, sha256: v.sha256 },
        ipAddress:  request.ip ?? null,
      })
    }
    return v
  })
}
