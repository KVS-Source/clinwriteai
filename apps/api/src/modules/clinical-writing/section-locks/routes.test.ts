// HTTP contract for the section-lock routes. Fastify inject() with a
// stubbed Prisma — exercises acquire / release / snapshot end-to-end.

import Fastify from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from '../../../auth/rbac.js'
import { sectionLockRoutes } from './routes.js'

const DOC_OK = 'DOC-1'
const SEC    = 'sec-a'

type Role = AuthenticatedUser['role']

async function build(opts: { seed?: Array<{ id: string; documentId: string; sectionId: string; userId: string; acquiredAt: Date; lastHeartbeatAt: Date }>; userId?: string; role?: Role; documentExists?: boolean; documentDeleted?: boolean } = {}) {
  const rows = [...(opts.seed ?? [])]
  const audit = vi.fn(async () => undefined)
  const key = (r: { documentId: string; sectionId: string }) => `${r.documentId}::${r.sectionId}`

  const prisma = {
    document: {
      findUnique: vi.fn(async () => {
        if (opts.documentExists === false) return null
        return { id: DOC_OK, deletedAt: opts.documentDeleted ? new Date() : null }
      }),
    },
    sectionLock: {
      findUnique: vi.fn(async ({ where }: { where: { documentId_sectionId?: { documentId: string; sectionId: string } } }) => {
        if (!where.documentId_sectionId) return null
        return rows.find(r => key(r) === key(where.documentId_sectionId!)) ?? null
      }),
      findMany: vi.fn(async ({ where }: { where: { documentId: string; lastHeartbeatAt?: { gte: Date } } }) => {
        let out = rows.filter(r => r.documentId === where.documentId)
        if (where.lastHeartbeatAt?.gte) out = out.filter(r => r.lastHeartbeatAt >= where.lastHeartbeatAt!.gte!)
        return out
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const r = rows.find(r => r.id === where.id)!
        Object.assign(r, data); return r
      }),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        const i = rows.findIndex(r => r.id === where.id)
        if (i < 0) throw new Error('row not found')
        return rows.splice(i, 1)[0]!
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> & { id?: string } }) => {
        const row = { id: data.id ?? `lock-${rows.length + 1}`, ...data } as (typeof rows)[number]
        rows.push(row); return row
      }),
    },
    $transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn({
      sectionLock: prisma.sectionLock,
    }),
  }

  const app = Fastify()
  app.decorate('prisma', prisma as never)
  app.decorate('audit', { append: audit } as never)
  app.decorate('emitSectionLockChanged', vi.fn())
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (req) => {
    const user: AuthenticatedUser = {
      id: opts.userId ?? 'u1',
      email: 'u@x.io',
      role: opts.role ?? 'clinical-writer',
      modules: ['A'],
      tenantId: null,
    }
    ;(req as unknown as { user: AuthenticatedUser }).user = user
  })
  await app.register(sectionLockRoutes, { prefix: '/documents' })
  await app.ready()
  return { app, rows, audit }
}

beforeEach(() => { process.env.FEATURE_MODULES_ENABLED = 'A' })

describe('POST /documents/:docId/sections/:secId/lock', () => {
  it("fresh acquire returns 201 outcome='acquired' and audits", async () => {
    const { app, rows, audit } = await build()
    const res = await app.inject({ method: 'POST', url: `/documents/${DOC_OK}/sections/${SEC}/lock` })
    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({ outcome: 'acquired', holder: { userId: 'u1' } })
    expect(rows).toHaveLength(1)
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'section_lock_acquired' }))
  })

  it("same-user re-acquire returns 200 outcome='extended' and does NOT audit", async () => {
    const { app, audit } = await build({
      seed: [{ id: 'L1', documentId: DOC_OK, sectionId: SEC, userId: 'u1', acquiredAt: new Date(Date.now() - 20_000), lastHeartbeatAt: new Date(Date.now() - 20_000) }],
    })
    const res = await app.inject({ method: 'POST', url: `/documents/${DOC_OK}/sections/${SEC}/lock` })
    expect(res.statusCode).toBe(200)
    expect(res.json().outcome).toBe('extended')
    expect(audit).not.toHaveBeenCalled()
  })

  it('different user with a live lock → 423 Locked with holder info', async () => {
    const { app, audit } = await build({
      userId: 'u2',
      seed: [{ id: 'L1', documentId: DOC_OK, sectionId: SEC, userId: 'u1', acquiredAt: new Date(), lastHeartbeatAt: new Date() }],
    })
    const res = await app.inject({ method: 'POST', url: `/documents/${DOC_OK}/sections/${SEC}/lock` })
    expect(res.statusCode).toBe(423)
    expect(res.json()).toMatchObject({ error: 'locked', holder: { userId: 'u1' }, staleSeconds: 90 })
    expect(audit).not.toHaveBeenCalled()
  })

  it("stealing a stale lock returns 201 outcome='stolen' and audits", async () => {
    const { app, audit } = await build({
      userId: 'u2',
      seed: [{ id: 'L1', documentId: DOC_OK, sectionId: SEC, userId: 'u1', acquiredAt: new Date(Date.now() - 10 * 60_000), lastHeartbeatAt: new Date(Date.now() - 10 * 60_000) }],
    })
    const res = await app.inject({ method: 'POST', url: `/documents/${DOC_OK}/sections/${SEC}/lock` })
    expect(res.statusCode).toBe(201)
    expect(res.json().outcome).toBe('stolen')
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'section_lock_stolen' }))
  })

  it('404 when the document is missing or soft-deleted', async () => {
    const { app: a1 } = await build({ documentExists: false })
    expect((await a1.inject({ method: 'POST', url: `/documents/${DOC_OK}/sections/${SEC}/lock` })).statusCode).toBe(404)
    const { app: a2 } = await build({ documentDeleted: true })
    expect((await a2.inject({ method: 'POST', url: `/documents/${DOC_OK}/sections/${SEC}/lock` })).statusCode).toBe(404)
  })
})

describe('DELETE /documents/:docId/sections/:secId/lock', () => {
  it('releases the holder\'s own lock', async () => {
    const { app, rows } = await build({
      seed: [{ id: 'L1', documentId: DOC_OK, sectionId: SEC, userId: 'u1', acquiredAt: new Date(), lastHeartbeatAt: new Date() }],
    })
    const res = await app.inject({ method: 'DELETE', url: `/documents/${DOC_OK}/sections/${SEC}/lock` })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ released: true })
    expect(rows).toHaveLength(0)
  })

  it('non-holder with no admin role → released:false; row untouched', async () => {
    const { app, rows } = await build({
      userId: 'u2',
      role: 'clinical-writer',
      seed: [{ id: 'L1', documentId: DOC_OK, sectionId: SEC, userId: 'u1', acquiredAt: new Date(), lastHeartbeatAt: new Date() }],
    })
    const res = await app.inject({ method: 'DELETE', url: `/documents/${DOC_OK}/sections/${SEC}/lock` })
    expect(res.json()).toEqual({ released: false })
    expect(rows).toHaveLength(1)
  })

  it('admin force-release deletes a foreign lock and audits', async () => {
    const { app, rows, audit } = await build({
      userId: 'admin-1',
      role: 'admin',
      seed: [{ id: 'L1', documentId: DOC_OK, sectionId: SEC, userId: 'u1', acquiredAt: new Date(), lastHeartbeatAt: new Date() }],
    })
    const res = await app.inject({ method: 'DELETE', url: `/documents/${DOC_OK}/sections/${SEC}/lock` })
    expect(res.json()).toEqual({ released: true })
    expect(rows).toHaveLength(0)
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'section_lock_force_released' }))
  })
})

describe('GET /documents/:docId/locks', () => {
  it('returns only live locks on this document', async () => {
    const { app } = await build({
      seed: [
        { id: 'L1', documentId: DOC_OK, sectionId: 'a', userId: 'u1', acquiredAt: new Date(), lastHeartbeatAt: new Date() },
        { id: 'L2', documentId: DOC_OK, sectionId: 'b', userId: 'u2', acquiredAt: new Date(), lastHeartbeatAt: new Date() },
        { id: 'L3', documentId: DOC_OK, sectionId: 'c', userId: 'u3', acquiredAt: new Date(Date.now() - 10 * 60_000), lastHeartbeatAt: new Date(Date.now() - 10 * 60_000) },
      ],
    })
    const res = await app.inject({ method: 'GET', url: `/documents/${DOC_OK}/locks` })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.staleSeconds).toBe(90)
    expect(body.locks.map((l: { sectionId: string }) => l.sectionId).sort()).toEqual(['a', 'b'])
  })

  it('404 when the document is missing', async () => {
    const { app } = await build({ documentExists: false })
    expect((await app.inject({ method: 'GET', url: `/documents/${DOC_OK}/locks` })).statusCode).toBe(404)
  })
})
