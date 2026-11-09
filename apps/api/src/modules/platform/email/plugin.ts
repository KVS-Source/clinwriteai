// Fastify plugin — decorates app.email with the adapter picked by
// `EMAIL_PROVIDER` env. Routes call app.email.send(...) without
// knowing which provider is live.
//
// Registration order: must run after the logger is wired (every
// Fastify app has one by default; no explicit dep).

import type { FastifyInstance } from 'fastify'
import fp from 'fastify-plugin'
import { createEmailAdapter, type EmailAdapter } from './adapter.js'

declare module 'fastify' {
  interface FastifyInstance {
    email: EmailAdapter
  }
}

export default fp(async (app: FastifyInstance) => {
  const adapter = createEmailAdapter({
    provider: process.env.EMAIL_PROVIDER,
    log:      { info: (obj, msg) => app.log.info(obj, msg) },
  })
  app.decorate('email', adapter)
  app.log.info({ provider: process.env.EMAIL_PROVIDER ?? 'noop' }, 'email adapter registered')
}, { name: 'email' })
