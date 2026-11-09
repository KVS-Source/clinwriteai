// A project's start and cut-off dates can't be set in the past, on create or edit. A project whose
// dates have already passed can still be edited. Fastify inject() with a stubbed Prisma.

import Fastify from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from '../../auth/rbac.js'
import { projectRoutes } from './routes.js'

const DAY = 86_400_000
const dayFrom = (offset: number) => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10) + 'T00:00:00.000Z'
const body = { id: 'PROJ-CUT', name: 'Cut', shortTitle: 'Cut', therapeuticArea: 'Oncology', phase: 'Phase 1', startDate: dayFrom(0) }

async function build(existing: Record<string, unknown> | null = null) {
  const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...data }))
  const update = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...existing, ...data }))
  const app = Fastify()
  app.decorate('prisma', {
    project: { findUnique: vi.fn(async () => existing), create, update },
    therapeuticArea: { findFirst: vi.fn(async () => ({ label: 'Oncology' })) },
    projectMember: { findMany: vi.fn(async () => [{ projectId: 'PROJ-CUT' }]) },
    raciAssignment: { findMany: async () => [] },
    projectTeamMember: { findMany: vi.fn(async () => []) },
    document: { findMany: vi.fn(async () => []) },
  } as never)
  app.decorate('audit', { append: vi.fn(async () => ({})) } as never)
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (r) => {
    const user: AuthenticatedUser = { id: 'u', email: 'e@v', role: 'pm', modules: ['A'], tenantId: null }
    Object.assign(r, { user })
  })
  await app.register(projectRoutes, { prefix: '/projects' })
  await app.ready()
  return { app, create, update }
}

beforeEach(() => { process.env.FEATURE_MODULES_ENABLED = 'A,B,C,D,E' })

describe('creating a project', () => {
  it('refuses a data cut-off date in the past, and creates nothing', async () => {
    const { app, create } = await build()
    const res = await app.inject({ method: 'POST', url: '/projects', payload: { ...body, dataCutoff: '2025-01-01T00:00:00.000Z' } })
    expect(res.statusCode).toBe(422)
    expect(res.json().error).toBe('date_in_past')
    expect(create).not.toHaveBeenCalled()
  })

  it.each([['today', 0], ['a later date', 30]])('accepts %s', async (_label, offset) => {
    const { app } = await build()
    const res = await app.inject({ method: 'POST', url: '/projects', payload: { ...body, dataCutoff: dayFrom(offset as number) } })
    expect(res.statusCode).toBe(201)
  })

  it('accepts yesterday in UTC, which can still be today where the user is', async () => {
    const { app } = await build()
    const res = await app.inject({ method: 'POST', url: '/projects', payload: { ...body, dataCutoff: dayFrom(-1) } })
    expect(res.statusCode).toBe(201)
  })

  it('refuses a start date in the past', async () => {
    const { app, create } = await build()
    const res = await app.inject({ method: 'POST', url: '/projects', payload: { ...body, startDate: '2025-01-01T00:00:00.000Z' } })
    expect(res.statusCode).toBe(422)
    expect(res.json().error).toBe('date_in_past')
    expect(create).not.toHaveBeenCalled()
  })

  it('accepts no data cut-off date at all', async () => {
    const { app } = await build()
    expect((await app.inject({ method: 'POST', url: '/projects', payload: body })).statusCode).toBe(201)
  })
})

describe('editing a project', () => {
  const passed = new Date('2025-01-01T00:00:00.000Z')

  it('refuses changing the date to one in the past', async () => {
    const { app, update } = await build({ id: 'PROJ-CUT', therapeuticArea: 'Oncology', dataCutoff: null })
    const res = await app.inject({ method: 'PATCH', url: '/projects/PROJ-CUT', payload: { dataCutoff: '2025-06-01T00:00:00.000Z' } })
    expect(res.statusCode).toBe(422)
    expect(update).not.toHaveBeenCalled()
  })

  it('still lets a project whose cut-off has passed be edited', async () => {
    const { app } = await build({ id: 'PROJ-CUT', therapeuticArea: 'Oncology', dataCutoff: passed })
    const res = await app.inject({ method: 'PATCH', url: '/projects/PROJ-CUT', payload: { name: 'Renamed' } })
    expect(res.statusCode).toBe(200)
  })

  it('accepts the same passed date sent back unchanged', async () => {
    const { app } = await build({ id: 'PROJ-CUT', therapeuticArea: 'Oncology', dataCutoff: passed })
    const res = await app.inject({ method: 'PATCH', url: '/projects/PROJ-CUT', payload: { name: 'Renamed', dataCutoff: passed.toISOString() } })
    expect(res.statusCode).toBe(200)
  })
})
