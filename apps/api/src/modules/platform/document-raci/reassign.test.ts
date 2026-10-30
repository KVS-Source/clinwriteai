// POST /documents/:id/raci for someone previously removed from the same letter:
// the soft-removed row keeps the unique key, so the route revives it instead of
// creating a duplicate (which used to 500 on the unique constraint).

import Fastify from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from '../../../auth/rbac.js'
import { documentRaciRoutes } from './routes.js'

type Row = Record<string, unknown>

async function build(removedRows: Row[]) {
  const create = vi.fn(async (args: { data: Row }) => ({ id: 'raci-new', ...args.data }))
  const update = vi.fn(async (args: { where: { id: string }; data: Row }) => ({ id: args.where.id, ...args.data }))
  const app = Fastify()
  app.decorate('prisma', {
    document: { findUnique: vi.fn(async () => ({ id: 'DOC-1', assigneeId: 'someone-else' })) },
    user:     { findUnique: vi.fn(async () => ({ id: 'user-b', capabilities: ['can-review'], role: 'contributor' })) },
    documentRaci: {
      findFirst: vi.fn(async () => null),
      // Active rows (validation) → none; removed rows (revival lookup) → removedRows.
      findMany:  vi.fn(async (args: { where: { removedAt?: unknown } }) => (args.where.removedAt === null ? [] : removedRows)),
      create,
      update,
    },
  } as never)
  app.decorate('audit', { append: vi.fn(async () => undefined) } as never)
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (req) => {
    const user: AuthenticatedUser = { id: 'admin', email: 'a@x.io', role: 'tenant-admin', modules: ['A'], tenantId: null }
    ;(req as unknown as { user: AuthenticatedUser }).user = user
  })
  await app.register(documentRaciRoutes, { prefix: '/documents' })
  await app.ready()
  return { app, create, update }
}

const assign = (app: Awaited<ReturnType<typeof build>>['app']) =>
  app.inject({ method: 'POST', url: '/documents/DOC-1/raci', payload: { userId: 'user-b', letter: 'C' } })

beforeEach(() => { process.env.FEATURE_MODULES_ENABLED = 'A' })

describe('POST …/raci re-assign', () => {
  it('creates a new row when the user was never on this letter', async () => {
    const { app, create, update } = await build([])
    expect((await assign(app)).statusCode).toBe(201)
    expect(create).toHaveBeenCalledOnce()
    expect(update).not.toHaveBeenCalled()
  })

  it('revives the removed row, clearing removal and completion state', async () => {
    const { app, create, update } = await build([{ id: 'raci-old' }])
    const res = await assign(app)
    expect(res.statusCode).toBe(201)
    expect(create).not.toHaveBeenCalled()
    const call = update.mock.calls[0]![0]
    expect(call.where.id).toBe('raci-old')
    expect(call.data).toMatchObject({ removedAt: null, reviewedAt: null, submittedAt: null, approvedAt: null, assignedBy: 'admin' })
  })
})
