// POST /documents/:id/raci for an assignee without the letter's capability:
// the RACI picker offers every non-admin, so the route grants the capability
// (audited as user.capability_granted) instead of refusing with 422.
// Admin assignees are still refused — admins take letters only via self-grant.

import Fastify from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from '../../../auth/rbac.js'
import { documentRaciRoutes } from './routes.js'

async function build(assignee: { capabilities: string[]; role: string }) {
  const userUpdate = vi.fn(async (args: { data: { capabilities: { push: string } } }) => ({
    capabilities: [...assignee.capabilities, args.data.capabilities.push],
  }))
  const create = vi.fn(async (args: { data: Record<string, unknown> }) => ({ id: 'raci-new', ...args.data }))
  const append = vi.fn(async (_e: { action: string; details: Record<string, unknown> }) => undefined)
  const app = Fastify()
  app.decorate('prisma', {
    document: { findUnique: vi.fn(async () => ({ id: 'DOC-1', assigneeId: 'someone-else' })) },
    user: { findUnique: vi.fn(async () => ({ id: 'user-b', ...assignee })), update: userUpdate },
    documentRaci: { findFirst: vi.fn(async () => null), findMany: vi.fn(async () => []), create },
  } as never)
  app.decorate('audit', { append } as never)
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (req) => {
    const user: AuthenticatedUser = { id: 'admin', email: 'a@x.io', role: 'tenant-admin', modules: ['A'], tenantId: null }
    ;(req as unknown as { user: AuthenticatedUser }).user = user
  })
  await app.register(documentRaciRoutes, { prefix: '/documents' })
  await app.ready()
  return { app, userUpdate, create, append }
}

const assign = (app: Awaited<ReturnType<typeof build>>['app'], letter: string) =>
  app.inject({ method: 'POST', url: '/documents/DOC-1/raci', payload: { userId: 'user-b', letter } })

beforeEach(() => { process.env.FEATURE_MODULES_ENABLED = 'A' })

describe('POST …/raci capability auto-grant', () => {
  it('grants the missing capability, audits it, then assigns', async () => {
    const { app, userUpdate, create, append } = await build({ capabilities: ['can-author'], role: 'contributor' })
    expect((await assign(app, 'A')).statusCode).toBe(201)
    expect(userUpdate.mock.calls[0]![0].data).toEqual({ capabilities: { push: 'can-approve' } })
    expect(create).toHaveBeenCalledOnce()
    const grant = append.mock.calls.map(c => c[0]).find(e => e.action === 'user.capability_granted')
    expect(grant?.details).toMatchObject({ capability: 'can-approve', reason: 'raci_assignment', letter: 'A' })
  })

  it('grants nothing when the assignee already has the capability', async () => {
    const { app, userUpdate } = await build({ capabilities: ['can-review'], role: 'contributor' })
    expect((await assign(app, 'C')).statusCode).toBe(201)
    expect(userUpdate).not.toHaveBeenCalled()
  })

  it('still refuses an admin assignee without the capability', async () => {
    const { app, userUpdate, create } = await build({ capabilities: [], role: 'tenant-admin' })
    const res = await assign(app, 'A')
    expect(res.statusCode).toBe(422)
    expect(res.json().error).toBe('missing_capability')
    expect(userUpdate).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
  })
})
