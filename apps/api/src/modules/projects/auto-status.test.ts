// A project goes from Initiated to Ongoing by itself when authoring starts: once, audited, and only from
// Initiated. The status history then says so, and a failure here never costs the author their save.

import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from '../../auth/rbac.js'
import { noteAuthoringStarted } from './auto-status.js'
import { projectRoutes } from './routes.js'

function stub(status: string, doc: unknown = { projectId: 'p-1', title: 'CSR draft', type: 'csr' }) {
  const project = { id: 'p-1', status }
  const updateMany = vi.fn(async ({ where, data }: { where: { status: string }; data: { status: string } }) => {
    if (project.status !== where.status) return { count: 0 }
    project.status = data.status
    return { count: 1 }
  })
  const append = vi.fn(async () => ({}))
  const error = vi.fn()
  const app = {
    prisma: { document: { findUnique: vi.fn(async () => doc) }, project: { updateMany } },
    audit: { append },
    log: { error },
  } as never
  return { app, project, updateMany, append, error }
}
const note = (app: never) => noteAuthoringStarted(app, { documentId: 'd-1', actorId: 'u-author', ipAddress: '1.2.3.4' })

describe('noteAuthoringStarted', () => {
  it('moves an Initiated project to Ongoing and records who, why and which document', async () => {
    const t = stub('initiated')
    await note(t.app)
    expect(t.project.status).toBe('ongoing')
    expect(t.append).toHaveBeenCalledTimes(1)
    expect(t.append).toHaveBeenCalledWith(expect.objectContaining({
      actorId: 'u-author',
      action: 'project.state_changed',
      entityType: 'project',
      entityId: 'p-1',
      ipAddress: '1.2.3.4',
      details: {
        from: 'initiated',
        to: 'ongoing',
        reason: 'Automatically moved to Ongoing: authoring started on CSR draft',
        automatic: 'authoring_started',
        document: 'CSR draft',
        documentId: 'd-1',
      },
    }))
  })

  it.each(['on-hold', 'closed', 're-open', 'ongoing'])('leaves a project that is %s alone, with no audit entry', async (status) => {
    const t = stub(status)
    await note(t.app)
    expect(t.project.status).toBe(status)
    expect(t.append).not.toHaveBeenCalled()
  })

  it('only happens once, however many edits follow', async () => {
    const t = stub('initiated')
    await note(t.app)
    await note(t.app)
    await note(t.app)
    expect(t.append).toHaveBeenCalledTimes(1)
  })

  it('names the document by its type when it has no title', async () => {
    const t = stub('initiated', { projectId: 'p-1', title: '  ', type: 'csr' })
    await note(t.app)
    expect(t.append).toHaveBeenCalledWith(expect.objectContaining({
      details: expect.objectContaining({ document: 'csr', reason: 'Automatically moved to Ongoing: authoring started on csr' }),
    }))
  })

  it('does nothing for a document it cannot find', async () => {
    const t = stub('initiated', null)
    await note(t.app)
    expect(t.updateMany).not.toHaveBeenCalled()
    expect(t.append).not.toHaveBeenCalled()
  })

  it('logs a failure instead of throwing, so the save still succeeds', async () => {
    const t = stub('initiated')
    t.updateMany.mockRejectedValueOnce(new Error('db down'))
    await expect(note(t.app)).resolves.toBeUndefined()
    expect(t.error).toHaveBeenCalled()
  })
})

describe('GET /projects/:id/status', () => {
  it('tells the screen which moves were automatic, and leaves manual ones as they were', async () => {
    const app = Fastify()
    app.decorate('prisma', {
      project: { findUnique: vi.fn(async () => ({ id: 'p-1', status: 'ongoing' })) },
      projectMember: { findMany: vi.fn(async () => [{ projectId: 'p-1' }]) },
      raciAssignment: { findMany: async () => [] },
      projectTeamMember: { findMany: vi.fn(async () => []) },
      document: { findMany: vi.fn(async () => []) },
      user: { findMany: vi.fn(async () => [{ id: 'u-author', name: 'Sam Author' }]) },
    } as never)
    app.decorate('audit', { pageForEntity: vi.fn(async () => ({ total: 2, rows: [
      { id: 'a-2', timestamp: '2026-11-06T10:00:00Z', actorId: 'u-author', details: { from: 'on-hold', to: 'ongoing', reason: 'Sponsor is back' } },
      { id: 'a-1', timestamp: '2026-11-05T10:00:00Z', actorId: 'u-author', details: { from: 'initiated', to: 'ongoing', reason: 'Automatically moved', automatic: 'authoring_started', document: 'CSR draft' } },
    ] })) } as never)
    app.decorateRequest('user', null)
    app.addHook('onRequest', async (req) => {
      const user = { id: 'u-pm', email: 'p@x', role: 'pm', modules: ['A'], tenantId: null } as unknown as AuthenticatedUser
      ;(req as unknown as { user: AuthenticatedUser }).user = user
    })
    await app.register(projectRoutes, { prefix: '/projects' })
    await app.ready()

    const res = await app.inject({ method: 'GET', url: '/projects/p-1/status' })
    expect(res.statusCode).toBe(200)
    const { history } = res.json() as { history: Array<Record<string, unknown>> }
    expect(history[0]).toMatchObject({ reason: 'Sponsor is back', automatic: null, document: null })
    expect(history[1]).toMatchObject({ by: 'Sam Author', automatic: 'authoring_started', document: 'CSR draft' })
    await app.close()
  })
})
