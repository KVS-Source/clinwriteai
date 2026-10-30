// POST /projects — the Client field is no longer collected; creating without it succeeds
// and stores an empty client.

import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from '../../auth/rbac.js'
import { projectRoutes } from './routes.js'

const body = { id: 'PROJ-NOCLIENT', name: 'No client', shortTitle: 'No client', therapeuticArea: 'Oncology', phase: 'Phase 1', startDate: '2026-10-30T00:00:00.000Z', activeModules: ['A'] }

async function build() {
  const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...data }))
  const app = Fastify()
  app.decorate('prisma', {
    project: { findUnique: vi.fn(async () => null), create },
    therapeuticArea: { findFirst: vi.fn(async () => ({ label: 'Oncology' })) },
  } as never)
  app.decorate('audit', { append: vi.fn(async () => ({})) } as never)
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (r) => {
    const user: AuthenticatedUser = { id: 'u', email: 'e@v', role: 'pm', modules: ['A'], tenantId: null }
    Object.assign(r, { user })
  })
  await app.register(projectRoutes, { prefix: '/projects' })
  await app.ready()
  return { app, create }
}

describe('POST /projects without a client', () => {
  it('creates the project with an empty client', async () => {
    const { app, create } = await build()
    const res = await app.inject({ method: 'POST', url: '/projects', payload: body })
    expect(res.statusCode).toBe(201)
    expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({ id: 'PROJ-NOCLIENT', client: '' }) })
    await app.close()
  })

  it('still stores a client when one is sent (existing callers)', async () => {
    const { app, create } = await build()
    const res = await app.inject({ method: 'POST', url: '/projects', payload: { ...body, client: 'Acme' } })
    expect(res.statusCode).toBe(201)
    expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({ client: 'Acme' }) })
    await app.close()
  })
})
