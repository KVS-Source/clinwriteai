// Audit Fastify plugin — the single wire-up point for the audit trail.
//
// What it does:
//   1. Resolves AUDIT_HASH_SECRET from the SecretsProvider at boot.
//   2. Decorates `app.audit` with a PostgresAuditRepository bound to the shared
//      Prisma connection. All feature code writes audits via `app.audit.append(...)`.
//   3. Registers an onResponse hook that records a mutating-request audit event
//      for any POST/PUT/PATCH/DELETE (GET/HEAD/OPTIONS are read-only and skipped).
//      Routes that need entity-specific audits (e.g. "project.state_changed")
//      call `app.audit.append(...)` directly in the handler. When one did and
//      the request succeeded, that named event is the record (it carries
//      requestId/method/path) and the hook writes no extra request row. The
//      hook still records: requests with no named event, failed attempts,
//      document viewing sessions (throttled) and scanner traffic (own category).
//
// Depends on: `./prisma/plugin.ts` (for `app.prisma`), config/secrets (for
// `app.secrets`). Register this plugin AFTER both.

import { AsyncLocalStorage } from 'node:async_hooks'
import type { FastifyPluginAsync, FastifyRequest } from 'fastify'
import fp from 'fastify-plugin'
import { PostgresAuditRepository } from './postgres-repository.js'
import type { AuditRepository } from './repository.js'

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

// Routes we never audit at the hook level (noise with no compliance value).
// Entity-level audits for these still happen in-handler where relevant.
const SKIP_PATHS = new Set(['/health', '/ready', '/metrics'])

// Per-request audit context. `namedWritten` flips when a handler appends its
// own named event, so the onResponse hook doesn't also write a request row
// for the same action (the named event carries requestId/method/path).
interface RequestAuditContext {
  requestId: string
  method: string
  path: string
  namedWritten: boolean
}
const currentRequest = new AsyncLocalStorage<RequestAuditContext>()
const contextByRequest = new WeakMap<object, RequestAuditContext>()

// Events whose back-to-back repeats (same actor, entity and details) within
// COLLAPSE_WINDOW_MS are recorded once.
const COLLAPSE_ACTIONS = new Set([
  'phi_document_accessed',
  'audit.verify',
  'audit.export',
  'audit_trail_exported',
  'audit_log_exported',
])
const COLLAPSE_WINDOW_MS = 2000

// Presence pings: one audit row per user+document viewing session, refreshed
// every PRESENCE_INTERVAL_MS while the screen keeps pinging.
const PRESENCE_ROUTE_PREFIX = '/documents/:documentId/presence'
const PRESENCE_INTERVAL_MS = 5 * 60 * 1000

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
  const appendWithMetrics: AuditRepository['append'] = async (event) => {
    const result = await underlying.append(event)
    try {
      app.platformMetrics.auditEventsTotal.inc({
        action: event.action,
        entity_type: event.entityType,
        actor_id: event.actorId,
      })
    } catch { /* metrics never breaks the write path */ }
    return result
  }

  // Immediate repeats of the same event (double click, a screen loading its
  // data twice) collapse into the first one. Only the actions in
  // COLLAPSE_ACTIONS, and only when actor, entity AND details are identical.
  const recent = new Map<string, { at: number; result: { id: string; rowHash: string } }>()

  const repo: AuditRepository = {
    append: async (event) => {
      const key = COLLAPSE_ACTIONS.has(event.action)
        ? JSON.stringify([event.actorId, event.action, event.entityType, event.entityId, event.details])
        : null
      if (key) {
        const now = Date.now()
        for (const [k, v] of recent) if (now - v.at > COLLAPSE_WINDOW_MS) recent.delete(k)
        const prev = recent.get(key)
        if (prev) return prev.result
      }

      // A named event written by a handler carries the request it came from,
      // and tells the onResponse hook the request is already recorded.
      const ctx = currentRequest.getStore()
      let toWrite = event
      if (ctx) {
        ctx.namedWritten = true
        toWrite = { ...event, details: { requestId: ctx.requestId, method: ctx.method, path: ctx.path, ...event.details } }
      }
      const result = await appendWithMetrics(toWrite)
      if (key) recent.set(key, { at: Date.now(), result })
      return result
    },
    listForEntity: (entityType, entityId, limit) => underlying.listForEntity(entityType, entityId, limit),
    pageForEntity: (entityType, entityId, opts) => underlying.pageForEntity(entityType, entityId, opts),
    verifyChain: (fromId, toId) => underlying.verifyChain(fromId, toId),
  }
  app.decorate('audit', repo)

  // Tie each request to its audit context so handler-written events can be
  // matched with the request in the onResponse hook below.
  app.addHook('onRequest', (request, _reply, done) => {
    const ctx: RequestAuditContext = {
      requestId: request.id,
      method: request.method,
      path: request.url,
      namedWritten: false,
    }
    contextByRequest.set(request.raw, ctx)
    currentRequest.run(ctx, done)
  })

  // Presence: last time a (user, document) viewing session was recorded.
  const lastPresenceAt = new Map<string, number>()

  app.addHook('onResponse', async (request, reply) => {
    if (!MUTATING_METHODS.has(request.method)) return
    if (SKIP_PATHS.has(request.routeOptions?.url ?? request.url)) return

    // 4xx client errors on mutating endpoints are still audit-worthy (failed
    // attempts matter). 5xx are logged but not audited — the request didn't
    // produce a persisted change we need to attest to.
    if (reply.statusCode >= 500) return

    const routeUrl = request.routeOptions?.url
    const ctx = contextByRequest.get(request.raw)

    try {
      // Viewing a document: one named "viewing session" row per user and
      // document, repeated at most every PRESENCE_INTERVAL_MS while the screen
      // keeps pinging. Replaces one request row per ping.
      if (reply.statusCode < 400 && routeUrl?.startsWith(PRESENCE_ROUTE_PREFIX)) {
        const documentId = (request.params as { documentId?: string } | undefined)?.documentId
        if (!documentId) return
        const actorId = resolveActorId(request)
        const key = `${actorId}|${documentId}`
        const now = Date.now()
        const last = lastPresenceAt.get(key)
        if (last !== undefined && now - last < PRESENCE_INTERVAL_MS) return
        if (lastPresenceAt.size > 5000) {
          for (const [k, t] of lastPresenceAt) if (now - t >= PRESENCE_INTERVAL_MS) lastPresenceAt.delete(k)
        }
        lastPresenceAt.set(key, now)
        await appendWithMetrics({
          timestamp: new Date().toISOString(),
          actorId,
          action: 'document_presence_session',
          entityType: 'document',
          entityId: documentId,
          details: {
            repeatEveryMinutes: PRESENCE_INTERVAL_MS / 60_000,
            requestId: request.id,
            actorRole: (request as unknown as { user?: { role?: string } }).user?.role ?? null,
            sessionId: (request as unknown as { authClaims?: { jti?: string } }).authClaims?.jti ?? null,
          },
          ipAddress: request.ip ?? null,
        })
        return
      }

      // A handler already wrote a named event for this request, and it
      // succeeded: that event is the record. Failed attempts (4xx) still get
      // the request row below.
      if (ctx?.namedWritten && reply.statusCode < 400) return

      // Unmatched route (scanner traffic such as /wp-json, /graphql): keep it,
      // but as its own category so it doesn't read as user activity.
      if (request.is404) {
        await appendWithMetrics({
          timestamp: new Date().toISOString(),
          actorId: resolveActorId(request),
          action: 'security.probe',
          entityType: 'security_probe',
          entityId: request.url.split('?')[0]!.slice(0, 200),
          details: {
            statusCode: reply.statusCode,
            method: request.method,
            path: request.url.slice(0, 500),
            requestId: request.id,
            userAgent: String(request.headers['user-agent'] ?? '').slice(0, 200),
          },
          ipAddress: request.ip ?? null,
        })
        return
      }

      await appendWithMetrics({
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
          // FR-A-061: who (role) and under which authenticated session.
          actorRole: (request as unknown as { user?: { role?: string } }).user?.role ?? null,
          sessionId: (request as unknown as { authClaims?: { jti?: string } }).authClaims?.jti ?? null,
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
