// DPDPA plugin — Arc 7.
//
// Decorates the Fastify instance with `app.dpdpa` (the write-gate
// helper) and registers consent + DP-request routes under /admin/dpdpa.
// Also installs an error handler so ConsentRequiredError translates
// to 428 Precondition Required cleanly.

import type { FastifyPluginAsync } from 'fastify'
import fp from 'fastify-plugin'
import { createDpdpaGate, ConsentRequiredError, type DpdpaGate } from './gate.js'
import { createTransferGate, CrossBorderBlockedError, type TransferGate } from './transfer-gate.js'
import { consentRoutes } from './consent/routes.js'
import { dataPrincipalRoutes } from './data-principal/routes.js'
import { transferAllowlistRoutes } from './allowlist/routes.js'
import { breachRoutes } from './breach/routes.js'

const dpdpaPlugin: FastifyPluginAsync = async (app) => {
  const consentGate = createDpdpaGate(app.prisma)
  const transferGate = createTransferGate(app.prisma)
  app.decorate('dpdpa', consentGate)
  app.decorate('transfer', transferGate)

  // Translate DPDPA errors to HTTP responses in one place so route
  // handlers can let them bubble.
  const originalErrorHandler = app.errorHandler
  app.setErrorHandler((err, request, reply) => {
    if (err instanceof ConsentRequiredError) {
      return reply.code(428).send({
        error: err.code,
        subjectType: err.subjectType,
        subjectId: err.subjectId,
        purpose: err.purpose,
        intakeUrl: err.intakeUrl,
        message: 'Verifiable consent is required for this write under DPDPA 2023 §6.',
      })
    }
    if (err instanceof CrossBorderBlockedError) {
      return reply.code(451).send({
        error: err.code,
        tenantId: err.tenantId,
        destinationRegion: err.destinationRegion,
        destinationCountry: err.destinationCountry,
        message: 'Cross-border personal-data transfer blocked under DPDPA 2023 §16. Destination jurisdiction is not on the operator allow-list.',
      })
    }
    return originalErrorHandler(err, request, reply)
  })

  await app.register(consentRoutes)
  await app.register(dataPrincipalRoutes)
  await app.register(transferAllowlistRoutes)
  await app.register(breachRoutes)
}

declare module 'fastify' {
  interface FastifyInstance {
    dpdpa: DpdpaGate
    transfer: TransferGate
  }
}

export default fp(dpdpaPlugin, {
  name: 'dpdpa',
  dependencies: ['prisma', 'audit'],
})
