// Fastify plugin — decorates app.sms with the adapter chosen by
// SMS_PROVIDER env. Routes call app.sms.send(...) without caring
// which provider is live. Mirror of the email plugin shape.

import type { FastifyInstance } from 'fastify'
import fp from 'fastify-plugin'
import { createSmsAdapter, type SmsAdapter } from './adapter.js'

declare module 'fastify' {
  interface FastifyInstance {
    sms: SmsAdapter
  }
}

export default fp(async (app: FastifyInstance) => {
  const adapter = createSmsAdapter({
    provider: process.env.SMS_PROVIDER,
    log: {
      info: (obj, msg) => app.log.info(obj, msg),
      warn: (obj, msg) => app.log.warn(obj, msg),
    },
  })
  app.decorate('sms', adapter)
  app.log.info({ provider: process.env.SMS_PROVIDER ?? 'noop' }, 'sms adapter registered')
}, { name: 'sms' })
