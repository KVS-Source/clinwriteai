import type { FastifyPluginAsync } from 'fastify'
import fp from 'fastify-plugin'
import { AiGatewayService } from './service.js'

const aiGatewayPlugin: FastifyPluginAsync = async (app) => {
  const service = new AiGatewayService(app.prisma)
  app.decorate('aiGateway', service)
}

declare module 'fastify' {
  interface FastifyInstance {
    aiGateway: AiGatewayService
  }
}

export default fp(aiGatewayPlugin, {
  name: 'ai-gateway',
  dependencies: ['prisma'],
})
