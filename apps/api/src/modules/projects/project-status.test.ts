// The project status control's API: POST /projects/:id/transition needs a reason and a project the
// PM can see; GET /projects/:id/status gives the valid next moves and the history from the audit trail.

import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from '../../auth/rbac.js'
import { projectRoutes } from './routes.js'

async function build(opts: { status?: string; role?: AuthenticatedUser['role']; memberOf?: string[]; history?: unknown[] } = {}) {
  const project = { id: 'p-1', status: opts.status ?? 'ongoing' }
  const update = vi.fn(async ({ data }: { data: { status: string } }) => Object.assign(project, data))
  const append = vi.fn(async () => ({}))
  const pageForEntity = vi.fn(async () => ({ rows: opts.history ?? [], total: (opts.history ?? []).length }))
  const app = Fastify()
  app.decorate('prisma', {
    project: { findUnique: vi.fn(async () => project), update },
    projectMember: { findMany: vi.fn(async () => (opts.memberOf ?? ['p-1']).map(projectId => ({ projectId }))) },
    projectTeamMember: { findMany: vi.fn(async () => []) },
    document: { findMany: vi.fn(async () => []) },
    user: { findMany: vi.fn(async () => [{ id: 'u-pm', name: 'Alex Thornton' }]) },
  } as never)
  app.decorate('audit', { append, pageForEntity } as never)
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (req) => {
    const user: AuthenticatedUser = { id: 'u-pm', email: 'p@x', role: opts.role ?? 'pm', modules: ['A'], tenantId: null }
    ;(req as unknown as { user: AuthenticatedUser }).user = user
  })
  await app.register(projectRoutes, { prefix: '/projects' })
  await app.ready()
  const transition = (payload: Record<string, unknown>) => app.inject({ method: 'POST', url: '/projects/p-1/transition', payload })
  const status = () => app.inject({ method: 'GET', url: '/projects/p-1/status' })
  return { app, project, update, append, pageForEntity, transition, status }
}

describe('POST /projects/:id/transition', () => {
  it('changes the status and records the reason in the audit trail', async () => {
    const t = await build()
    const res = await t.transition({ to: 'on-hold', reason: '  Sponsor paused the study  ' })
    expect(res.statusCode).toBe(200)
    expect(t.project.status).toBe('on-hold')
    expect(t.append).toHaveBeenCalledWith(expect.objectContaining({
      action: 'project.state_changed', entityType: 'project', entityId: 'p-1',
      details: { from: 'ongoing', to: 'on-hold', reason: 'Sponsor paused the study' },
    }))
    await t.app.close()
  })

  it.each([
    ['no reason', { to: 'on-hold' }],
    ['an empty reason', { to: 'on-hold', reason: '' }],
    ['only spaces', { to: 'on-hold', reason: '     ' }],
    ['a reason too short to mean anything', { to: 'on-hold', reason: 'ab' }],
    ['a reason over the limit', { to: 'on-hold', reason: 'x'.repeat(501) }],
  ])('refuses %s, and changes nothing', async (_label, body) => {
    const t = await build()
    expect((await t.transition(body)).statusCode).toBe(400)
    expect(t.update).not.toHaveBeenCalled()
    expect(t.append).not.toHaveBeenCalled()
    await t.app.close()
  })

  it('refuses a move the state machine does not allow', async () => {
    const t = await build({ status: 'closed' })
    const res = await t.transition({ to: 'ongoing', reason: 'Straight back to work' })
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toBe('invalid_transition')
    expect(t.project.status).toBe('closed')
    await t.app.close()
  })

  it('answers 404 for a project this PM cannot see, and changes nothing', async () => {
    const t = await build({ memberOf: ['p-other'] })
    expect((await t.transition({ to: 'on-hold', reason: 'Not my project' })).statusCode).toBe(404)
    expect(t.update).not.toHaveBeenCalled()
    await t.app.close()
  })

  it.each(['contributor', 'tenant-admin', 'auditor'] as const)('refuses a %s', async (role) => {
    const t = await build({ role })
    expect((await t.transition({ to: 'on-hold', reason: 'Not a PM' })).statusCode).toBe(403)
    expect(t.update).not.toHaveBeenCalled()
    await t.app.close()
  })
})

describe('GET /projects/:id/status', () => {
  it.each([
    ['initiated', ['ongoing', 'on-hold', 'closed']],
    ['ongoing', ['on-hold', 'closed']],
    ['on-hold', ['ongoing', 'closed']],
    ['closed', ['re-open']],
    ['re-open', ['ongoing', 'on-hold', 'closed']],
  ])('from %s offers only the valid next moves', async (status, next) => {
    const t = await build({ status })
    expect((await t.status()).json()).toMatchObject({ status, next })
    await t.app.close()
  })

  it('builds the history from the audit trail, with names, and copes with older rows that have no reason', async () => {
    const t = await build({
      history: [
        { id: '9', timestamp: '2026-11-04T10:00:00.000Z', actorId: 'u-pm', details: { from: 'ongoing', to: 'on-hold', reason: 'Paused' } },
        { id: '8', timestamp: '2026-11-03T10:00:00.000Z', actorId: 'u-gone', details: { from: 'initiated', to: 'ongoing', reason: null } },
      ],
    })
    const body = (await t.status()).json()
    expect(t.pageForEntity).toHaveBeenCalledWith('project', 'p-1', expect.objectContaining({ action: 'project.state_changed' }))
    expect(body.history).toEqual([
      { id: '9', at: '2026-11-04T10:00:00.000Z', by: 'Alex Thornton', from: 'ongoing', to: 'on-hold', reason: 'Paused' },
      { id: '8', at: '2026-11-03T10:00:00.000Z', by: 'u-gone', from: 'initiated', to: 'ongoing', reason: null },
    ])
    await t.app.close()
  })

  it('is for a PM who can see the project', async () => {
    const hidden = await build({ memberOf: ['p-other'] })
    expect((await hidden.status()).statusCode).toBe(404)
    await hidden.app.close()
    const contributor = await build({ role: 'contributor' })
    expect((await contributor.status()).statusCode).toBe(403)
    await contributor.app.close()
  })
})
