// Fastify plugin — decorates app.socialPublish with the chosen adapter.
// Mirror of the email + sms plugins.

import type { FastifyInstance } from 'fastify'
import fp from 'fastify-plugin'
import { createSocialPublishAdapter, type SocialPublishAdapter } from './adapter.js'

declare module 'fastify' {
  interface FastifyInstance {
    socialPublish: SocialPublishAdapter
  }
}

export default fp(async (app: FastifyInstance) => {
  const adapter = createSocialPublishAdapter({
    provider: process.env.SOCIAL_PUBLISH_PROVIDER,
    log: {
      info: (obj, msg) => app.log.info(obj, msg),
      warn: (obj, msg) => app.log.warn(obj, msg),
    },
  })
  app.decorate('socialPublish', adapter)
  app.log.info({ provider: process.env.SOCIAL_PUBLISH_PROVIDER ?? 'noop' }, 'social-publish adapter registered')
}, { name: 'social-publish' })
