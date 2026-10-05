// Aurora/ClinWrite API — Fastify entrypoint.
//
// Phase 1 scaffold (per docs/architecture-implementation-plan.md Phase 1).
// Boots cleanly against a Postgres from Testcontainers or docker-compose.local.yml.
// Wires config + secrets provider; subsequent commits add auth, audit plugin,
// Prisma client, OpenAPI, Zod routes.

import 'dotenv/config'
import Fastify from 'fastify'
import { loadEnv } from './config/env.js'
import { createSecretsProvider } from './config/secrets.js'

async function buildServer() {
  const env = loadEnv()

  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      transport: env.NODE_ENV === 'development'
        ? { target: 'pino-pretty' }
        : undefined,
    },
    requestIdHeader: 'x-request-id',
    disableRequestLogging: false,
  })

  // ---- Decorate with providers (DI pattern) ----
  const secrets = createSecretsProvider(env)
  app.decorate('env', env)
  app.decorate('secrets', secrets)

  // ---- Health + readiness ----
  app.get('/health', async () => ({
    status: 'ok',
    service: env.OTEL_SERVICE_NAME,
    version: process.env.npm_package_version ?? '0.1.0',
    uptime: process.uptime(),
    phase: 'Phase 1 scaffold',
  }))

  app.get('/ready', async () => {
    // Phase 1 Week 3: check Postgres + Redis + secrets backend liveness here
    return { ready: true }
  })

  // ---------- Phase 1 Week 3-5: register plugins + routes ----------
  // await app.register(import('@fastify/cors'),       { origin: env.CORS_ORIGIN, credentials: env.CORS_CREDENTIALS })
  // await app.register(import('@fastify/helmet'))
  // await app.register(import('@fastify/cookie'))
  // await app.register(import('@fastify/sensible'))
  // await app.register(import('@fastify/rate-limit'), { max: 100, timeWindow: '1 minute' })
  // await app.register(import('@fastify/swagger'),    { ... })      // OpenAPI from Zod schemas
  // await app.register(import('@fastify/swagger-ui'), { routePrefix: '/docs' })
  //
  // await app.register(import('./prisma/plugin.js'))                // Prisma client as decorator
  // await app.register(import('./audit/plugin.js'))                 // onResponse hook writes audit events
  // await app.register(import('./auth/plugin.js'))                  // WorkOS SSO + MFA + JWT session
  //
  // await app.register(import('./modules/platform/routes.js'),      { prefix: '/admin' })
  // await app.register(import('./modules/projects/routes.js'),      { prefix: '/projects' })
  //
  // // Module route registrations land in Phase 3A-3E:
  // // await app.register(import('./modules/clinical-writing/routes.js'),   { prefix: '/documents' })
  // // await app.register(import('./modules/scientific-writing/routes.js'), { prefix: '/publications' })
  // // await app.register(import('./modules/medical-writing/routes.js'),    { prefix: '/med-content' })
  // // await app.register(import('./modules/regulatory-writing/routes.js'), { prefix: '/reg-submissions' })
  // // await app.register(import('./modules/ideation/routes.js'),           { prefix: '/ideation' })

  return app
}

async function main() {
  const app = await buildServer()
  const env = app.env

  try {
    await app.listen({ port: env.PORT, host: env.HOST })
    app.log.info(
      { phase: 'Phase 1 scaffold', env: env.NODE_ENV, secretsProvider: env.SECRETS_PROVIDER },
      `Aurora API listening on http://${env.HOST}:${env.PORT}`,
    )
  } catch (err) {
    app.log.error(err)
    process.exit(1)
  }
}

// Fastify type augmentation — so `app.env` and `app.secrets` are typed everywhere
declare module 'fastify' {
  interface FastifyInstance {
    env: ReturnType<typeof loadEnv>
    secrets: ReturnType<typeof createSecretsProvider>
  }
}

// Export buildServer for integration tests
export { buildServer }

// Boot when run directly (not when imported)
if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}
