// Removing an author from a document's RACI: someone must still be able to edit it, and the assignee
// (who can edit with or without an R row) hands the document on rather than keeping access.

import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from '../../../auth/rbac.js'
import { documentRaciRoutes } from './routes.js'

const DOC = 'doc-1'
type Row = { id: string; userId: string; letter: string; removedAt: Date | null; documentId: string; sectionId: null }
const r = (id: string, userId: string, letter = 'R'): Row => ({ id, userId, letter, removedAt: null, documentId: DOC, sectionId: null })

async function build(opts: { rows: Row[]; assignee: string; roles?: Record<string, string>; actor?: string }) {
  const rows = opts.rows
  const roleOf = (id: string) => opts.roles?.[id] ?? 'contributor'
  const docUpdate = vi.fn(async () => ({}))
  const append = vi.fn(async () => ({}))
  const app = Fastify()
  app.decorate('prisma', {
    signatureChain: { findFirst: vi.fn(async () => null) },
    document: { findUnique: vi.fn(async () => ({ id: DOC, assigneeId: opts.assignee })), update: docUpdate },
    user: { findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => where.id.in.map(id => ({ id, role: roleOf(id) }))) },
    documentRaci: {
      findFirst: vi.fn(async ({ where }: { where: { userId: string; letter: string } }) =>
        rows.find(x => x.userId === where.userId && x.letter === where.letter && !x.removedAt) ?? null),
      findMany: vi.fn(async ({ where }: { where: { letter: string; id: { not: string } } }) =>
        rows.filter(x => x.letter === where.letter && !x.removedAt && x.id !== where.id.not)),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => rows.find(x => x.id === where.id) ?? null),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => Object.assign(rows.find(x => x.id === where.id)!, data)),
    },
  } as never)
  app.decorate('audit', { append } as never)
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (request) => {
    const user: AuthenticatedUser = { id: opts.actor ?? 'u-a', email: 'a@x', role: 'contributor', modules: ['A'], tenantId: null }
    ;(request as unknown as { user: AuthenticatedUser }).user = user
  })
  await app.register(documentRaciRoutes, { prefix: '/documents' })
  await app.ready()
  return { app, rows, docUpdate, append, remove: (id: string) => app.inject({ method: 'DELETE', url: `/documents/${DOC}/raci/${id}` }) }
}

describe('removing someone from the RACI', () => {
  it('removes a co-author and leaves the assignee alone', async () => {
    const t = await build({ rows: [r('r1', 'u-a'), r('r2', 'u-b')], assignee: 'u-a' })
    expect((await t.remove('r2')).statusCode).toBe(204)
    expect(t.rows[1]!.removedAt).not.toBeNull()
    expect(t.docUpdate).not.toHaveBeenCalled()
    await t.app.close()
  })

  it('hands the document to the next author when the assignee is removed, and audits it', async () => {
    const t = await build({ rows: [r('r1', 'u-a'), r('r2', 'u-b')], assignee: 'u-b' })
    expect((await t.remove('r2')).statusCode).toBe(204)
    expect(t.docUpdate).toHaveBeenCalledWith({ where: { id: DOC }, data: { assigneeId: 'u-a' } })
    expect(t.append).toHaveBeenCalledWith(expect.objectContaining({
      action: 'document.assignee_changed', entityId: DOC, details: expect.objectContaining({ from: 'u-b', to: 'u-a' }),
    }))
    await t.app.close()
  })

  it('refuses to remove the last author, even their own row, and changes nothing', async () => {
    const t = await build({ rows: [r('r1', 'u-a')], assignee: 'u-a' })
    const res = await t.remove('r1')
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toBe('last_author')
    expect(t.rows[0]!.removedAt).toBeNull()
    await t.app.close()
  })

  it('does not count a PM as a remaining author, and never hands the document to one', async () => {
    const t = await build({ rows: [r('r1', 'u-a'), r('r2', 'u-pm')], assignee: 'u-a', roles: { 'u-pm': 'pm' } })
    expect((await t.remove('r1')).statusCode).toBe(409)
    expect(t.docUpdate).not.toHaveBeenCalled()
    await t.app.close()
  })

  it('lets the last R row go when the assignee, without an R row, can still edit', async () => {
    const t = await build({ rows: [r('r1', 'u-a')], assignee: 'u-a2', actor: 'u-a' })
    expect((await t.remove('r1')).statusCode).toBe(204)
    expect(t.docUpdate).not.toHaveBeenCalled()
    await t.app.close()
  })

  it('can remove a PM holding R, who could not edit anyway', async () => {
    const t = await build({ rows: [r('r1', 'u-a'), r('r2', 'u-pm')], assignee: 'u-a', roles: { 'u-pm': 'pm' } })
    expect((await t.remove('r2')).statusCode).toBe(204)
    await t.app.close()
  })

  it('has no author rule for the other letters', async () => {
    const t = await build({ rows: [r('r1', 'u-a'), r('r2', 'u-c', 'C'), r('r3', 'u-i', 'I')], assignee: 'u-a' })
    expect((await t.remove('r2')).statusCode).toBe(204)
    expect((await t.remove('r3')).statusCode).toBe(204)
    await t.app.close()
  })
})
