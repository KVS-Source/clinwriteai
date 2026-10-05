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

  // ---------- Security + utility plugins ----------
  // Order matters: cookie before auth, cors + helmet before any routes, rate-limit
  // before heavy handlers. Sensible gives us app.httpErrors.* for consistent 4xx.
  await app.register(import('@fastify/cookie'))
  await app.register(import('@fastify/cors'), {
    origin: env.CORS_ORIGIN,
    credentials: env.CORS_CREDENTIALS,
  })
  await app.register(import('@fastify/helmet'), { contentSecurityPolicy: false })
  await app.register(import('@fastify/sensible'))
  await app.register(import('@fastify/rate-limit'), {
    max: 100,
    timeWindow: '1 minute',
    // SSO callback is exempt — being redirected from the IdP shouldn't ever
    // produce enough traffic to trip the limit, and users getting rate-limited
    // mid-login is a bad experience worth avoiding.
    allowList: (req) => req.url.startsWith('/auth/callback'),
  })

  // ---------- OpenAPI docs ----------
  if (env.NODE_ENV !== 'production' || env.FEATURE_OPENAPI_DOCS) {
    await app.register(import('@fastify/swagger'), {
      openapi: {
        info: {
          title: 'Aurora/ClinWrite Platform API',
          description: 'Phase 1 scaffold. Routes defined by Fastify; schemas added route-by-route.',
          version: process.env.npm_package_version ?? '0.1.0',
        },
        servers: [{ url: `http://${env.HOST}:${env.PORT}` }],
        components: {
          securitySchemes: {
            sessionCookie: { type: 'apiKey', in: 'cookie', name: 'aurora_session' },
          },
        },
      },
    })
    await app.register(import('@fastify/swagger-ui'), { routePrefix: '/docs' })
  }

  // ---------- Core data + audit plumbing ----------
  await app.register(import('./prisma/plugin.js'))
  await app.register(import('./audit/plugin.js'))

  // ---------- Auth (SSO + JWT session + RBAC) ----------
  await app.register(import('./auth/plugin.js'))

  // ---------- Platform routes ----------
  const { projectRoutes } = await import('./modules/projects/routes.js')
  const { userRoutes } = await import('./modules/platform/users/routes.js')
  await app.register(projectRoutes, { prefix: '/projects' })
  await app.register(userRoutes, { prefix: '/admin/users' })

  // ---------- Module A — Clinical Writing ----------
  const { documentsProjectScopedRoutes, documentsRoutes } =
    await import('./modules/clinical-writing/documents/routes.js')
  // documentsProjectScopedRoutes handles /projects/:projectId/documents paths;
  // documentsRoutes handles /documents/:documentId paths. Two mount points,
  // one plugin file so the handlers share the service instance.
  await app.register(documentsProjectScopedRoutes, { prefix: '/projects' })
  await app.register(documentsRoutes, { prefix: '/documents' })

  const { checklistRoutes } = await import('./modules/clinical-writing/checklist/routes.js')
  await app.register(checklistRoutes, { prefix: '/documents' })

  const { commentsRoutes } = await import('./modules/clinical-writing/comments/routes.js')
  await app.register(commentsRoutes, { prefix: '/documents' })

  // ---------- Module B — Scientific Writing ----------
  const { publicationsProjectScopedRoutes, publicationsRoutes } =
    await import('./modules/scientific-writing/publications/routes.js')
  await app.register(publicationsProjectScopedRoutes, { prefix: '/projects' })
  await app.register(publicationsRoutes, { prefix: '/publications' })

  const { citationsRoutes } = await import('./modules/scientific-writing/citations/routes.js')
  await app.register(citationsRoutes, { prefix: '/publications' })

  const { authorsRoutes } = await import('./modules/scientific-writing/authors/routes.js')
  await app.register(authorsRoutes, { prefix: '/publications' })

  // ---------- Module C — Medical Writing ----------
  const { medContentProjectScopedRoutes, medContentRoutes } =
    await import('./modules/medical-writing/content/routes.js')
  await app.register(medContentProjectScopedRoutes, { prefix: '/projects' })
  await app.register(medContentRoutes, { prefix: '/med-content' })

  const { claimsRoutes } = await import('./modules/medical-writing/claims/routes.js')
  await app.register(claimsRoutes, { prefix: '/med-content' })
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

// Boot when run directly (not when imported). pathToFileURL normalises
// Windows-style process.argv[1] ('C:\...') to the triple-slash file URL
// shape import.meta.url produces ('file:///C:/...').
import { pathToFileURL } from 'node:url'
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
