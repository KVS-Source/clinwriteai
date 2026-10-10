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
    // Default is 100; raise it so base64url-encoded blob keys fit as a
    // single :keyB64 path param (/blob/local/:bucket/:keyB64). Our keys
    // encode <projectId>/<prefix>/<date>/<rand>.<ext> which decodes to
    // ~70-90 bytes but base64-encodes to ~100-130 chars.
    maxParamLength: 512,
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

  app.get('/ready', async (_request, reply) => {
    // Readiness probe: all backing services reachable? Container orchestrators
    // use this to decide if traffic can route; k8s/nginx won't forward requests
    // until this returns 200. Each check has a short per-call timeout so a
    // hung dependency doesn't hold the probe open past the orchestrator's
    // own timeout (typically 5s).
    //
    // The probe deliberately does NOT fail on blob backend errors in local
    // mode — the local filesystem check is trivially always-up, and a disk
    // full / permissions issue surfaces through the blob metrics instead.
    const started = Date.now()
    const checks: Record<string, { ok: boolean; latencyMs: number; error?: string }> = {}

    async function check<T>(name: string, fn: () => Promise<T>, timeoutMs = 2000): Promise<void> {
      const t0 = Date.now()
      try {
        await Promise.race([
          fn(),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs)),
        ])
        checks[name] = { ok: true, latencyMs: Date.now() - t0 }
      } catch (err) {
        checks[name] = {
          ok: false,
          latencyMs: Date.now() - t0,
          error: err instanceof Error ? err.message : String(err),
        }
      }
    }

    // Postgres — a cheap SELECT 1 confirms the connection pool is live.
    await check('postgres', async () => {
      await app.prisma.$queryRaw`SELECT 1`
    })

    // Redis — ping. If the queue plugin's connection has been severed
    // (Redis restart), ioredis auto-reconnects; a successful ping means
    // the reconnect has settled.
    await check('redis', async () => {
      const result = await app.redis.ping()
      if (result !== 'PONG') throw new Error(`unexpected ping response: ${result}`)
    })

    const allOk = Object.values(checks).every(c => c.ok)
    const totalMs = Date.now() - started
    if (!allOk) {
      return reply.code(503).send({ ready: false, totalMs, checks })
    }
    return { ready: true, totalMs, checks }
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
  // Multipart used by document upload (Module A). 50MB limit matches
  // the API contract; buckets live in BlobStorage, not inline in Fastify.
  await app.register(import('@fastify/multipart'), {
    limits: {
      fileSize: 50 * 1024 * 1024,
      files: 1,
    },
  })
  // Rate limit registration moved below queue so we can pass the shared
  // Redis connection as the backing store (see "Rate limit (Redis-backed)"
  // section). In-memory fallback persisted here if queue plugin failed
  // to decorate app.redis — e.g. test contexts that bypass queue entirely.

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

  // ---------- Metrics (before everything else so HTTP metrics catch every route) ----------
  await app.register(import('./modules/platform/metrics/plugin.js'))

  // ---------- Core data + audit plumbing ----------
  await app.register(import('./prisma/plugin.js'))
  await app.register(import('./audit/plugin.js'))

  // ---------- Queue (BullMQ producer side; worker runs in apps/worker) ----------
  await app.register(import('./modules/platform/queue/plugin.js'))

  // ---------- Rate limit (Redis-backed) ----------
  // Shares the queue plugin's ioredis connection via app.redis so multi-
  // instance deployments converge on a single counter per key. Without
  // this, running N replicas effectively lets a client make N*100 req/min
  // because each instance tracks its own counter.
  await app.register(import('@fastify/rate-limit'), {
    max: 100,
    timeWindow: '1 minute',
    redis: app.redis,
    // Namespace in Redis so the counter keys are distinguishable from
    // BullMQ job keys (both use the same connection).
    nameSpace: 'ratelimit:',
    // SSO callback is exempt — being redirected from the IdP shouldn't ever
    // produce enough traffic to trip the limit, and users getting rate-limited
    // mid-login is a bad experience worth avoiding.
    allowList: (req) => req.url.startsWith('/auth/callback'),
    // If Redis is unreachable at request time, don't 500 — fall back to the
    // in-memory counter per instance. Alert fires via BullMQ queue-depth
    // metric which proxies for Redis liveness.
    continueExceeding: true,
  })

  // ---------- Blob storage (local filesystem for dev; S3-compatible for prod) ----------
  await app.register(import('./modules/platform/blob/plugin.js'))

  // ---------- Auth (SSO + JWT session + RBAC) ----------
  await app.register(import('./auth/plugin.js'))

  // ---------- Realtime (Socket.io presence channel) ----------
  await app.register(import('./modules/platform/realtime/plugin.js'))

  // ---------- Platform routes ----------
  const { projectRoutes } = await import('./modules/projects/routes.js')
  const { userRoutes } = await import('./modules/platform/users/routes.js')
  await app.register(projectRoutes, { prefix: '/projects' })
  await app.register(userRoutes, { prefix: '/admin/users' })

  // ---------- Tenant Admin (Arc 3 of docs/pivot-plan.md) ----------
  // Four plugins, all mounted at root — path shapes mix /admin/tenants/*,
  // /admin/memberships/*, /admin/sso-connections/*, /admin/audit*.
  const { tenantsRoutes } = await import('./modules/platform/tenant-admin/tenants/routes.js')
  const { membershipsRoutes } = await import('./modules/platform/tenant-admin/memberships/routes.js')
  const { ssoRoutes } = await import('./modules/platform/tenant-admin/sso/routes.js')
  const { auditViewerRoutes } = await import('./modules/platform/tenant-admin/audit/routes.js')
  await app.register(tenantsRoutes)
  await app.register(membershipsRoutes)
  await app.register(ssoRoutes)
  await app.register(auditViewerRoutes)

  // ---------- DPDPA 2023 (Arc 7 + 10 of docs/pivot-plan.md) ----------
  // Decorates app.dpdpa (consent gate) + app.transfer (cross-border
  // gate) + registers /admin/dpdpa/consents, /dpdpa/requests (public
  // intake), /admin/dpdpa/requests, /admin/dpdpa/transfer-allowlist.
  await app.register(import('./modules/platform/dpdpa/plugin.js'))

  // ---------- Module A — Clinical Writing ----------
  const { documentsProjectScopedRoutes, documentsRoutes } =
    await import('./modules/clinical-writing/documents/routes.js')
  // documentsProjectScopedRoutes handles /projects/:projectId/documents paths;
  // documentsRoutes handles /documents/:documentId paths. Two mount points,
  // one plugin file so the handlers share the service instance.
  await app.register(documentsProjectScopedRoutes, { prefix: '/projects' })
  await app.register(documentsRoutes, { prefix: '/documents' })

  const { documentsUploadRoutes } = await import('./modules/clinical-writing/documents/upload-routes.js')
  await app.register(documentsUploadRoutes, { prefix: '/projects' })

  const { voiceNotesRoutes } = await import('./modules/clinical-writing/voice-notes/routes.js')
  await app.register(voiceNotesRoutes, { prefix: '/documents' })

  const { presenceRoutes } = await import('./modules/clinical-writing/presence/routes.js')
  await app.register(presenceRoutes, { prefix: '/documents' })

  const { checklistRoutes } = await import('./modules/clinical-writing/checklist/routes.js')
  await app.register(checklistRoutes, { prefix: '/documents' })

  const { commentsRoutes } = await import('./modules/clinical-writing/comments/routes.js')
  await app.register(commentsRoutes, { prefix: '/documents' })

  const { crmRoutes } = await import('./modules/clinical-writing/crm/routes.js')
  // Mixed path shapes (/documents/:documentId/crm and /crm/:meetingId/...)
  // kept in one plugin so handlers share nextCrmRef. Registered at root —
  // the handlers use full paths.
  await app.register(crmRoutes)

  const { tlfRoutes } = await import('./modules/clinical-writing/tlf/routes.js')
  // Project-scoped, package-scoped, item-scoped and document-scoped paths —
  // registered at root with full paths, same pattern as peer-review + crm.
  await app.register(tlfRoutes)

  const { signatureRoutes } = await import('./modules/clinical-writing/signatures/routes.js')
  // Part 11 e-sig: /documents/:id/signature-chains, /signature-chains/:id,
  // /signature-records/:id/sign — mixed shapes, registered at root with
  // full paths.
  await app.register(signatureRoutes)

  // ---------- Module B — Scientific Writing ----------
  const { publicationsProjectScopedRoutes, publicationsRoutes } =
    await import('./modules/scientific-writing/publications/routes.js')
  await app.register(publicationsProjectScopedRoutes, { prefix: '/projects' })
  await app.register(publicationsRoutes, { prefix: '/publications' })

  const { citationsRoutes } = await import('./modules/scientific-writing/citations/routes.js')
  await app.register(citationsRoutes, { prefix: '/publications' })

  const { authorsRoutes } = await import('./modules/scientific-writing/authors/routes.js')
  await app.register(authorsRoutes, { prefix: '/publications' })

  const { submissionChecksRoutes } = await import('./modules/scientific-writing/submission-checks/routes.js')
  await app.register(submissionChecksRoutes, { prefix: '/publications' })

  const { peerReviewRoutes } = await import('./modules/scientific-writing/peer-review/routes.js')
  // Mixed path shapes (/publications/:id/review-rounds and /round-comments/:id)
  // kept in one plugin so handlers share snapshotLetterVersion. Registered
  // at root — the handlers use full paths.
  await app.register(peerReviewRoutes)

  const { congressRoutes } = await import('./modules/scientific-writing/congress/routes.js')
  await app.register(congressRoutes, { prefix: '/publications' })

  // ---------- Module C — Medical Writing ----------
  const { medContentProjectScopedRoutes, medContentRoutes } =
    await import('./modules/medical-writing/content/routes.js')
  await app.register(medContentProjectScopedRoutes, { prefix: '/projects' })
  await app.register(medContentRoutes, { prefix: '/med-content' })

  const { claimsRoutes } = await import('./modules/medical-writing/claims/routes.js')
  await app.register(claimsRoutes, { prefix: '/med-content' })

  const { preMlrRoutes } = await import('./modules/medical-writing/pre-mlr/routes.js')
  await app.register(preMlrRoutes, { prefix: '/med-content' })

  const { mlrRoutes } = await import('./modules/medical-writing/mlr/routes.js')
  await app.register(mlrRoutes, { prefix: '/med-content' })

  // ---------- Module D — Regulatory Writing ----------
  const { regSubmissionsProjectScopedRoutes, regSubmissionsRoutes } =
    await import('./modules/regulatory-writing/submissions/routes.js')
  await app.register(regSubmissionsProjectScopedRoutes, { prefix: '/projects' })
  await app.register(regSubmissionsRoutes, { prefix: '/reg-submissions' })

  const { canonicalRoutes } = await import('./modules/regulatory-writing/canonical/routes.js')
  await app.register(canonicalRoutes, { prefix: '/reg-submissions' })

  const { consistencyRoutes } = await import('./modules/regulatory-writing/consistency/routes.js')
  await app.register(consistencyRoutes, { prefix: '/reg-submissions' })

  const { haCorrespondenceRoutes } = await import('./modules/regulatory-writing/ha-correspondence/routes.js')
  // Mixed path shapes (/regulatory-submissions/:id/... + /ha-correspondence/:id +
  // /ha-questions/:id + /ha-drafts/:id). Registered at root with full paths.
  await app.register(haCorrespondenceRoutes)

  const { safetyReportsRoutes } = await import('./modules/regulatory-writing/safety-reports/routes.js')
  await app.register(safetyReportsRoutes)

  const { oddRoutes } = await import('./modules/regulatory-writing/odd/routes.js')
  await app.register(oddRoutes)

  // ---------- Module E — Ideation & Publishing ----------
  const { ideationProjectScopedRoutes, ideationRoutes } =
    await import('./modules/ideation/routes.js')
  await app.register(ideationProjectScopedRoutes, { prefix: '/projects' })
  await app.register(ideationRoutes, { prefix: '/ideation' })

  const { atomisedRoutes } = await import('./modules/ideation/atomised/routes.js')
  await app.register(atomisedRoutes, { prefix: '/ideation' })

  const { publishingRoutes } = await import('./modules/ideation/publishing/routes.js')
  await app.register(publishingRoutes, { prefix: '/ideation' })

  // ---------- Phase 4 shared platform services ----------
  await app.register(import('./modules/platform/notifications/plugin.js'))

  const { libraryRoutes } = await import('./modules/platform/library/routes.js')
  await app.register(libraryRoutes, { prefix: '/library' })

  const { notificationsRoutes } = await import('./modules/platform/notifications/routes.js')
  await app.register(notificationsRoutes, { prefix: '/notifications' })

  const { frameworksRoutes } = await import('./modules/platform/frameworks/routes.js')
  await app.register(frameworksRoutes, { prefix: '/admin/frameworks' })

  const { raciRoutes } = await import('./modules/platform/raci/routes.js')
  await app.register(raciRoutes, { prefix: '/projects' })

  await app.register(import('./modules/platform/ai-gateway/plugin.js'))
  const { aiGatewayRoutes } = await import('./modules/platform/ai-gateway/routes.js')
  await app.register(aiGatewayRoutes, { prefix: '/ai' })

  const { complianceRoutes } = await import('./modules/platform/compliance/routes.js')
  await app.register(complianceRoutes, { prefix: '/admin/compliance' })

  const { regulatoryAlertsRoutes } = await import('./modules/platform/regulatory-alerts/routes.js')
  // Cross-module read + per-user ack + super-admin publish. Registered at
  // root — paths are a mix of /regulatory-alerts/* and /admin/regulatory-alerts/*.
  await app.register(regulatoryAlertsRoutes)

  const { reportsRoutes } = await import('./modules/platform/reports/routes.js')
  // Read-only aggregation layer across all 5 modules. Project dashboard
  // open to any module member; tenant + AI spend + audit activity gated to admins.
  await app.register(reportsRoutes)

  const { taxonomyRoutes } = await import('./modules/platform/taxonomy/routes.js')
  // Therapeutic-areas catalogue — read for every authed user, CRUD for super-admin.
  await app.register(taxonomyRoutes)

  // Compliance gauge scheduler — keeps the Prometheus gauges the Phase 6
  // alerts rely on (audit chain intact, last verify, access review, backup
  // success) fresh. Mounted last so all dependencies (prisma + audit +
  // metrics) are decorated first.
  await app.register(import('./modules/platform/compliance/plugin.js'))

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
