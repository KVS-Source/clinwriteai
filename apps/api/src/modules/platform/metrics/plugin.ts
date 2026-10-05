// Prometheus metrics plugin.
//
// Wires `fastify-metrics` for HTTP + process + Node metrics (status_code,
// route, http_request_duration_seconds_bucket, http_requests_total, event
// loop lag, GC, heap, …). Also exposes a shared prom-client Registry so
// feature modules can register their own counters/gauges (audit events,
// AI calls, chain integrity gauges).
//
// Mount order in server.ts: BEFORE routes so the Fastify metrics plugin
// catches every handler. The /metrics endpoint it exposes is scraped by
// Prometheus from the loopback interface — no auth, no CORS.

import type { FastifyPluginAsync } from 'fastify'
import fp from 'fastify-plugin'
import fastifyMetrics from 'fastify-metrics'
import { Counter, Gauge, Registry } from 'prom-client'

export interface PlatformMetrics {
  registry: Registry
  // Business counters feature modules bump directly.
  auditEventsTotal: Counter<'action' | 'entity_type' | 'actor_id'>
  aiCallsTotal: Counter<'module' | 'intent' | 'model' | 'limit_decision' | 'pii_scrubbed'>
  aiCostUsdTotal: Counter<'module' | 'model'>
  // Compliance gauges updated by the sidecar cron (/admin/compliance/*).
  auditChainIntact: Gauge<never>
  auditChainLastVerify: Gauge<never>
  accessReviewLastExport: Gauge<never>
  backupLastSuccess: Gauge<never>
  backupDrillLastSuccess: Gauge<never>
}

const metricsPlugin: FastifyPluginAsync = async (app) => {
  await app.register(fastifyMetrics, {
    endpoint: '/metrics',
    routeMetrics: {
      enabled: true,
      // Request duration histogram with the buckets the SLO alerts expect.
      // 10ms → 10s covers everything from a hot /health to a cold AI call.
      overrides: {
        histogram: {
          buckets: [0.01, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10],
        },
      },
    },
  })

  // Everything we expose for business metrics shares the fastify-metrics
  // registry so a single /metrics scrape returns both HTTP + custom.
  const registry = app.metrics.client.register

  const auditEventsTotal = new app.metrics.client.Counter({
    name: 'platform_audit_events_total',
    help: 'Count of append-only audit events written to audit_events.',
    labelNames: ['action', 'entity_type', 'actor_id'] as const,
    registers: [registry],
  })

  const aiCallsTotal = new app.metrics.client.Counter({
    name: 'platform_ai_calls_total',
    help: 'Count of AI gateway calls, labelled by module/intent/model/decision.',
    labelNames: ['module', 'intent', 'model', 'limit_decision', 'pii_scrubbed'] as const,
    registers: [registry],
  })

  const aiCostUsdTotal = new app.metrics.client.Counter({
    name: 'platform_ai_cost_usd_total',
    help: 'Running total USD cost of AI gateway calls.',
    labelNames: ['module', 'model'] as const,
    registers: [registry],
  })

  const auditChainIntact = new app.metrics.client.Gauge({
    name: 'platform_audit_chain_intact',
    help: '1 if the audit chain is intact at last verification, 0 if broken.',
    registers: [registry],
  })

  const auditChainLastVerify = new app.metrics.client.Gauge({
    name: 'platform_audit_chain_last_verify_seconds',
    help: 'Unix timestamp of the last audit chain verification run.',
    registers: [registry],
  })

  const accessReviewLastExport = new app.metrics.client.Gauge({
    name: 'platform_access_review_last_export_seconds',
    help: 'Unix timestamp of the last SOC 2 access review export.',
    registers: [registry],
  })

  const backupLastSuccess = new app.metrics.client.Gauge({
    name: 'platform_backup_last_success_seconds',
    help: 'Unix timestamp of the last successful backup run.',
    registers: [registry],
  })

  const backupDrillLastSuccess = new app.metrics.client.Gauge({
    name: 'platform_backup_drill_last_success_seconds',
    help: 'Unix timestamp of the last successful backup-restore drill.',
    registers: [registry],
  })

  app.decorate('platformMetrics', {
    registry,
    auditEventsTotal,
    aiCallsTotal,
    aiCostUsdTotal,
    auditChainIntact,
    auditChainLastVerify,
    accessReviewLastExport,
    backupLastSuccess,
    backupDrillLastSuccess,
  } satisfies PlatformMetrics)
}

declare module 'fastify' {
  interface FastifyInstance {
    platformMetrics: PlatformMetrics
  }
}

export default fp(metricsPlugin, { name: 'platform-metrics' })
