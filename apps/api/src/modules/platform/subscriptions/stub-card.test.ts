// The subscription screens get no invented payment card: no gateway is connected, so there is none.

import Fastify from 'fastify'
import { beforeEach, describe, expect, it } from 'vitest'
import type { AuthenticatedUser } from '../../../auth/rbac.js'
import { subscriptionRoutes } from './routes.js'

async function build() {
  const app = Fastify({ logger: false })
  app.decorate('prisma', { subscription: { findFirst: async () => null } } as never)
  app.decorate('audit', { append: async () => ({ id: '1', rowHash: 'h' }) } as never)
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (req) => {
    const user: AuthenticatedUser = { id: 'u', email: 'a@x', role: 'tenant-admin', modules: ['A'], tenantId: 'T-1' } as AuthenticatedUser
    ;(req as unknown as { user: AuthenticatedUser }).user = user
  })
  await app.register(subscriptionRoutes)
  await app.ready()
  return app
}

beforeEach(() => { process.env.FEATURE_MODULES_ENABLED = 'A,B,C,D,E' })

describe('the subscription payment method', () => {
  it.each(['/services/dashboard', '/admin/subscription'])('%s returns none, and no card number anywhere', async (url) => {
    const res = await (await build()).inject({ method: 'GET', url })
    expect(res.statusCode).toBe(200)
    expect(res.json().paymentMethod).toBeNull()
    expect(res.body).not.toContain('4242')
    expect(res.body).not.toContain('Visa')
  })
})
