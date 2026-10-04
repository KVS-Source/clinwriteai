// Aurora/ClinWrite API — Fastify entrypoint
// Phase 0 scaffold. Fleshes out in Phase 1.
//
// Per ADR 0001 (backend framework) + ADR 0002 (ORM) + ADR 0004 (LLM provider).
// Audit trail write hook per the plan — not yet installed; lands in Phase 1 Week 4.

import 'dotenv/config'
import Fastify from 'fastify'

const PORT = Number(process.env.PORT ?? 3001)
const HOST = process.env.HOST ?? '0.0.0.0'
const LOG_LEVEL = process.env.LOG_LEVEL ?? 'info'

async function buildServer() {
  const app = Fastify({
    logger: {
      level: LOG_LEVEL,
      transport: process.env.NODE_ENV === 'development'
        ? { target: 'pino-pretty' }
        : undefined,
    },
    requestIdHeader: 'x-request-id',
    disableRequestLogging: false,
  })

  // ---------- Health + readiness ----------
  app.get('/health', async () => ({
    status: 'ok',
    service: 'platform-api',
    version: process.env.npm_package_version ?? '0.1.0',
    uptime: process.uptime(),
    phase: 'Phase 0 scaffold',
  }))

  app.get('/ready', async () => ({ ready: true }))

  // ---------- Phase 1 plugins land here ----------
  // await app.register(import('@fastify/cors'), { origin: process.env.CORS_ORIGIN, credentials: true })
  // await app.register(import('@fastify/helmet'))
  // await app.register(import('@fastify/cookie'))
  // await app.register(import('@fastify/jwt'), { secret: process.env.JWT_SECRET! })
  // await app.register(import('@fastify/rate-limit'), { max: 100, timeWindow: '1 minute' })
  // await app.register(import('@fastify/sensible'))
  // await app.register(import('@fastify/swagger'), { ... })
  // await app.register(import('./audit/plugin.js'))     // audit trail hook
  // await app.register(import('./auth/routes.js'), { prefix: '/auth' })
  // await app.register(import('./projects/routes.js'), { prefix: '/projects' })

  // ---------- Module route registration ----------
  // Each module in Phase 3 registers under its own prefix:
  // await app.register(import('./modules/clinical-writing/routes.js'), { prefix: '/documents' })
  // await app.register(import('./modules/scientific-writing/routes.js'), { prefix: '/publications' })
  // await app.register(import('./modules/medical-writing/routes.js'),  { prefix: '/med-content' })
  // await app.register(import('./modules/regulatory-writing/routes.js'),{ prefix: '/reg-submissions' })
  // await app.register(import('./modules/ideation/routes.js'),         { prefix: '/ideation' })

  return app
}

async function main() {
  const app = await buildServer()
  try {
    await app.listen({ port: PORT, host: HOST })
    app.log.info(`Aurora API listening on http://${HOST}:${PORT} (Phase 0 scaffold)`)
  } catch (err) {
    app.log.error(err)
    process.exit(1)
  }
}

main()
