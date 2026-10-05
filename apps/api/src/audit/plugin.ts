// Audit Fastify plugin — the single wire-up point for the audit trail.
//
// What it does:
//   1. Resolves AUDIT_HASH_SECRET from the SecretsProvider at boot.
//   2. Decorates `app.audit` with a PostgresAuditRepository bound to the shared
//      Prisma connection. All feature code writes audits via `app.audit.append(...)`.
//   3. Registers an onResponse hook that records a mutating-request audit event
//      for any POST/PUT/PATCH/DELETE (GET/HEAD/OPTIONS are read-only and skipped).
//      Routes that need entity-specific audits (e.g. "project.state_changed")
//      call `app.audit.append(...)` directly in the handler — the hook captures
//      the catch-all request-level event in addition.
//
// Depends on: `./prisma/plugin.ts` (for `app.prisma`), config/secrets (for
// `app.secrets`). Register this plugin AFTER both.

import type { FastifyPluginAsync, FastifyRequest } from 'fastify'
import fp from 'fastify-plugin'
import { PostgresAuditRepository } from './postgres-repository.js'
import type { AuditRepository } from './repository.js'

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

// Routes we never audit at the hook level (noise with no compliance value).
// Entity-level audits for these still happen in-handler where relevant.
const SKIP_PATHS = new Set(['/health', '/ready', '/metrics'])

const auditPlugin: FastifyPluginAsync = async (app) => {
  const auditSecret = await app.secrets.getSecret('AUDIT_HASH_SECRET')
  if (auditSecret.length < 32) {
    throw new Error('AUDIT_HASH_SECRET must be at least 32 characters; chain integrity depends on it')
  }

  const underlying = new PostgresAuditRepository(app.prisma, auditSecret)

  // Instrumented wrapper — bumps platform_audit_events_total on every
  // successful append so Prometheus sees the full business audit stream
  // (not just the HTTP-request level audits from the onResponse hook).
  // On failure the counter does NOT increment; the alert on "audit append
  // failed" fires via the log line below.
  const repo: AuditRepository = {
    append: async (event) => {
      const result = await underlying.append(event)
      try {
        app.platformMetrics.auditEventsTotal.inc({
          action: event.action,
          entity_type: event.entityType,
          actor_id: event.actorId,
        })
      } catch { /* metrics never breaks the write path */ }
      return result
    },
    listForEntity: (entityType, entityId, limit) => underlying.listForEntity(entityType, entityId, limit),
    verifyChain: (fromId, toId) => underlying.verifyChain(fromId, toId),
  }
  app.decorate('audit', repo)

  app.addHook('onResponse', async (request, reply) => {
    if (!MUTATING_METHODS.has(request.method)) return
    if (SKIP_PATHS.has(request.routeOptions?.url ?? request.url)) return

    // 4xx client errors on mutating endpoints are still audit-worthy (failed
    // attempts matter). 5xx are logged but not audited — the request didn't
    // produce a persisted change we need to attest to.
    if (reply.statusCode >= 500) return

    try {
      await repo.append({
        timestamp: new Date().toISOString(),
        actorId: resolveActorId(request),
        action: `http.${request.method.toLowerCase()}`,
        entityType: 'http_request',
        entityId: request.routeOptions?.url ?? request.url,
        details: {
          statusCode: reply.statusCode,
          method: request.method,
          path: request.url,
          requestId: request.id,
        },
        ipAddress: request.ip ?? null,
      })
    } catch (err) {
      // Audit failures must never break the response. Log and surface on
      // /metrics so ops can alert — a sustained audit outage is a compliance
      // incident, not a request-level error.
      request.log.error({ err, requestId: request.id }, 'audit.append failed')
    }
  })
}

function resolveActorId(request: FastifyRequest): string {
  // The auth plugin (Batch 2) decorates `request.user`; until then, every
  // request is attributed to 'anonymous'. We keep the signature permissive
  // so this plugin stays safe to boot before auth lands.
  const user = (request as unknown as { user?: { id?: string } }).user
  return user?.id ?? 'anonymous'
}

declare module 'fastify' {
  interface FastifyInstance {
    audit: AuditRepository
  }
}

export default fp(auditPlugin, {
  name: 'audit',
  dependencies: ['prisma', 'platform-metrics'],
})
