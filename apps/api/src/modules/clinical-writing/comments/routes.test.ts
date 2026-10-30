// Comment id allocation. Comment.id is the table's PRIMARY KEY, so CMT-###
// has to be unique across ALL documents. A per-document sequence handed the
// second document's first comment an id that already existed, so every retry
// collided and the reviewer saw "Too many simultaneous comments; retry".

import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from '../../../auth/rbac.js'
import { commentsRoutes } from './routes.js'

type Row = { id: string; documentId: string; [k: string]: unknown }

async function buildApp(seed: Row[]) {
  const rows: Row[] = [...seed]
  const comment = {
    // Mirrors the real table: ids are unique table-wide.
    create: vi.fn(async ({ data }: { data: Row }) => {
      if (rows.some(r => r.id === data.id)) throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' })
      const row = { ...data, status: 'open', createdAt: new Date(), resolvedBy: null, resolvedAt: null, resolutionNote: null }
      rows.push(row)
      return row
    }),
    findMany: vi.fn(async ({ where }: { where: { documentId?: string; id?: { startsWith: string } } }) =>
      rows
        .filter(r => !where.documentId || r.documentId === where.documentId)
        .filter(r => !where.id?.startsWith || r.id.startsWith(where.id.startsWith))
        .map(r => ({ id: r.id }))),
  }
  const app = Fastify()
  app.decorate('prisma', {
    document: { findUnique: vi.fn(async ({ where }: { where: { id: string } }) => ({ id: where.id })) },
    comment,
    user: { findUnique: vi.fn(async () => ({ name: 'Reviewer', initials: 'RV' })) },
  } as never)
  app.decorate('audit', { append: vi.fn(async () => undefined) } as never)
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (request) => {
    const user: AuthenticatedUser = { id: 'user-rev', email: 'r@clinwrite.ai', role: 'reviewer', modules: ['A'], tenantId: null }
    ;(request as unknown as { user: AuthenticatedUser }).user = user
  })
  await app.register(commentsRoutes, { prefix: '/documents' })
  await app.ready()
  return { app, rows }
}

const post = (app: Awaited<ReturnType<typeof buildApp>>['app'], documentId: string) =>
  app.inject({
    method: 'POST', url: `/documents/${documentId}/comments`,
    payload: { sectionRef: '§1', text: 'please revise', severity: 'major', verdict: 'request_changes' },
  })

describe('POST /documents/:id/comments — id allocation', () => {
  it('first comment on a second document does not collide with another document\'s CMT-001', async () => {
    const { app } = await buildApp([{ id: 'CMT-001', documentId: 'doc-a' }])
    const res = await post(app, 'doc-b')
    expect(res.statusCode).toBe(201)
    expect(res.json().id).toBe('CMT-002')
  })

  it('ids keep increasing across documents and never repeat', async () => {
    const { app } = await buildApp([])
    const ids: string[] = []
    for (const doc of ['doc-a', 'doc-b', 'doc-a', 'doc-c', 'doc-b']) {
      const res = await post(app, doc)
      expect(res.statusCode).toBe(201)
      ids.push(res.json().id)
    }
    expect(ids).toEqual(['CMT-001', 'CMT-002', 'CMT-003', 'CMT-004', 'CMT-005'])
  })

  it('recovers when a concurrent insert takes the id between read and write', async () => {
    const { app, rows } = await buildApp([])
    // Another request wins CMT-001 right after our id lookup.
    const prisma = (app as unknown as { prisma: { comment: { findMany: (a: unknown) => Promise<unknown> } } }).prisma
    const realFindMany = prisma.comment.findMany.bind(prisma.comment)
    let raced = false
    prisma.comment.findMany = async (args: unknown) => {
      const result = await realFindMany(args)
      if (!raced) { raced = true; rows.push({ id: 'CMT-001', documentId: 'doc-other' }) }
      return result
    }
    const res = await post(app, 'doc-a')
    expect(res.statusCode).toBe(201)
    expect(res.json().id).toBe('CMT-002')
  })
})

describe('POST /documents/:id/comments — approving a returned section', () => {
  // A returned section can be approved only after the writer has saved it again.
  async function buildVerdictApp(opts: { returnedAt: Date | null; editedAt: Date | null }) {
    const created: Array<Record<string, unknown>> = []
    const app = Fastify()
    app.decorate('prisma', {
      document: {
        findUnique: vi.fn(async () => ({ id: 'doc-a', currentVersion: { sections: [{ lastEditedAt: opts.editedAt }] } })),
      },
      comment: {
        findFirst: vi.fn(async () => (opts.returnedAt ? { createdAt: opts.returnedAt } : null)),
        findMany:  vi.fn(async () => []),
        create:    vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          const row = { ...data, status: 'open', createdAt: new Date(), resolvedBy: null, resolvedAt: null, resolutionNote: null }
          created.push(row)
          return row
        }),
      },
      user: { findUnique: vi.fn(async () => ({ name: 'Reviewer', initials: 'RV' })) },
    } as never)
    app.decorate('audit', { append: vi.fn(async () => undefined) } as never)
    app.decorateRequest('user', null)
    app.addHook('onRequest', async (request) => {
      const user: AuthenticatedUser = { id: 'user-rev', email: 'r@clinwrite.ai', role: 'reviewer', modules: ['A'], tenantId: null }
      ;(request as unknown as { user: AuthenticatedUser }).user = user
    })
    await app.register(commentsRoutes, { prefix: '/documents' })
    await app.ready()
    return { app, created }
  }
  const approve = (app: Awaited<ReturnType<typeof buildVerdictApp>>['app']) =>
    app.inject({ method: 'POST', url: '/documents/doc-a/comments', payload: { sectionRef: '§5', text: '', severity: 'query', verdict: 'approve' } })

  it('409 section_returned while the section has not been revised since it was returned', async () => {
    const { app, created } = await buildVerdictApp({ returnedAt: new Date('2026-10-30T10:00:00Z'), editedAt: new Date('2026-10-30T09:00:00Z') })
    const res = await approve(app)
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toBe('section_returned')
    expect(created).toHaveLength(0)
  })

  it('approves once the writer has saved the section after the return', async () => {
    const { app } = await buildVerdictApp({ returnedAt: new Date('2026-10-30T10:00:00Z'), editedAt: new Date('2026-10-30T11:00:00Z') })
    expect((await approve(app)).statusCode).toBe(201)
  })

  it('approves a section that was never returned', async () => {
    const { app } = await buildVerdictApp({ returnedAt: null, editedAt: null })
    expect((await approve(app)).statusCode).toBe(201)
  })
})
