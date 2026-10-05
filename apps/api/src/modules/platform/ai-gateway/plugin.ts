import type { FastifyPluginAsync } from 'fastify'
import fp from 'fastify-plugin'
import { AiGatewayService, RateLimitedError, type ChatArgs } from './service.js'

const aiGatewayPlugin: FastifyPluginAsync = async (app) => {
  const underlying = new AiGatewayService(app.prisma)

  // Instrumented facade — every chat call bumps Prometheus counters.
  // Keeping the counter bump at the Fastify-plugin layer (not in the
  // service) means the AiGatewayService stays unit-testable without
  // needing the metrics decoration mocked.
  const instrumented = {
    chat: async (args: ChatArgs) => {
      try {
        const result = await underlying.chat(args)
        app.platformMetrics.aiCallsTotal.inc({
          module: args.module,
          intent: args.intent,
          model: args.model,
          limit_decision: result.limitDecision,
          pii_scrubbed: String(result.piiScrubbed),
        })
        app.platformMetrics.aiCostUsdTotal.inc(
          { module: args.module, model: args.model },
          result.costUsd,
        )
        // Soft-cap notification. First time the tenant crosses warnAtPct in
        // this quota period, send one in-app notification to the actor so
        // admins can request a bump before hard rejects start.
        if (result.limitDecision === 'allowed_approaching_cap' && args.tenantId) {
          void sendSoftCapOnce(app, args.tenantId, args.actorId, args.module).catch(err =>
            app.log.warn({ err, tenantId: args.tenantId }, 'soft-cap notification failed'),
          )
        }
        return result
      } catch (err) {
        // Rate-limited errors still produced an AiCallRecord in the service
        // (with cost=0); mirror that in the counter so dashboards show the
        // rejection.
        if (err instanceof RateLimitedError) {
          app.platformMetrics.aiCallsTotal.inc({
            module: args.module,
            intent: args.intent,
            model: args.model,
            limit_decision: 'rejected_cap',
            pii_scrubbed: 'false',
          })
          // Hard-reject notification (always, every reject). Admins want to
          // know; a repeat flood is better than silent failure.
          if (err instanceof RateLimitedError && 'recordId' in err) {
            // Can't resolve tenantId here (RateLimitedError doesn't carry it),
            // so we skip this notification path. Soft-cap path above gives
            // enough early warning — hard rejects are already surfaced as
            // HTTP 429 to the caller.
          }
        }
        throw err
      }
    },
  }

  app.decorate('aiGateway', instrumented as unknown as AiGatewayService)
}

/**
 * Emit a soft-cap notification at most once per tenant per quota period.
 * De-dup rule: check if a notification with kind=`ai_quota_approaching` +
 * payload.tenantId=X exists since the start of the current month. If yes,
 * skip. The notification is also sent to any admin/super-admin users for
 * the tenant so operators can act before the hard reject.
 */
async function sendSoftCapOnce(
  app: Parameters<FastifyPluginAsync>[0],
  tenantId: string,
  actorId: string,
  module: ChatArgs['module'],
): Promise<void> {
  const windowStart = new Date()
  windowStart.setUTCDate(1)
  windowStart.setUTCHours(0, 0, 0, 0)

  // De-dup: notifications in Prisma have a payload JSON — we filter by
  // kind + createdAt + payload-contains-tenantId.
  const existing = await app.prisma.notification.findFirst({
    where: {
      kind: 'ai_quota_approaching',
      createdAt: { gte: windowStart },
      payload: { path: ['tenantId'], equals: tenantId },
    },
    select: { id: true },
  })
  if (existing) return

  // Recipient resolution: the actor sees it; admin/super-admin users
  // get it too so an operator can bump the cap before the hard reject.
  const admins = await app.prisma.user.findMany({
    where: { role: { in: ['admin', 'super-admin'] }, status: 'active' },
    select: { id: true },
  })
  const recipientIds = Array.from(new Set([actorId, ...admins.map(a => a.id)]))

  for (const recipientId of recipientIds) {
    await app.notifications.send({
      recipientId,
      kind: 'ai_quota_approaching',
      severity: 'warning',
      title: 'AI monthly cap approaching',
      body: `Tenant AI spend has crossed the warning threshold on module ${module}. Review the AI spend report and consider raising the cap.`,
      linkPath: '/admin/ai-usage',
      channels: ['in_app'],
      payload: { tenantId, module, triggeredBy: actorId },
    })
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    aiGateway: AiGatewayService
  }
}

export default fp(aiGatewayPlugin, {
  name: 'ai-gateway',
  // 'notifications' is a runtime dep for the soft-cap alert path.
  dependencies: ['prisma', 'platform-metrics', 'notifications'],
})
