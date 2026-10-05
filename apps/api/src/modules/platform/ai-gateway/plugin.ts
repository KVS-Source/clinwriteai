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
        }
        throw err
      }
    },
  }

  app.decorate('aiGateway', instrumented as unknown as AiGatewayService)
}

declare module 'fastify' {
  interface FastifyInstance {
    aiGateway: AiGatewayService
  }
}

export default fp(aiGatewayPlugin, {
  name: 'ai-gateway',
  dependencies: ['prisma', 'platform-metrics'],
})
