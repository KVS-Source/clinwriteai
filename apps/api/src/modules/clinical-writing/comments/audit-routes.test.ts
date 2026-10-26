// Document audit trail: GET /documents/:id/audit pages newest-first with the
// true total, the CSV export covers the whole trail (not the oldest 500), and
// the QA-review lookup returns the LATEST review.

import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from '../../../auth/rbac.js'
import { InMemoryAuditRepository } from '../../../audit/repository.js'
import { commentsRoutes } from './routes.js'

const DOC = 'DOC-1'

async function buildApp(opts: { events: number; reviewsAt?: number[] }) {
  const audit = new InMemoryAuditRepository('test-audit-secret-32-bytes-long-for-vitest')
  for (let i = 1; i <= opts.events; i++) {
    await audit.append({
      timestamp: new Date(Date.UTC(2026, 9, 1, 0, 0, i)).toISOString(),
      actorId: 'user-a',
      action: opts.reviewsAt?.includes(i) ? 'qa_review_logged' : 'phi_document_accessed',
      entityType: 'document',
      entityId: DOC,
      details: { seq: i },
      ipAddress: null,
    })
  }
  // Noise on other entities must never show up.
  await audit.append({ timestamp: new Date().toISOString(), actorId: 'user-a', action: 'x', entityType: 'document', entityId: 'DOC-2', details: {}, ipAddress: null })

  const app = Fastify()
  app.decorate('prisma', {
    document: { findUnique: vi.fn(async ({ where }: { where: { id: string } }) => ({ id: where.id, title: 'ICF', createdAt: new Date('2026-09-01T00:00:00Z') })) },
    user: { findMany: vi.fn(async () => [{ id: 'user-a', name: 'Alex' }]), findUnique: vi.fn(async () => null) },
  } as never)
  app.decorate('audit', audit as never)
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (request) => {
    const user: AuthenticatedUser = { id: 'user-rev', email: 'r@clinwrite.ai', role: 'reviewer', modules: ['A'], tenantId: null }
    ;(request as unknown as { user: AuthenticatedUser }).user = user
  })
  await app.register(commentsRoutes, { prefix: '/documents' })
  await app.ready()
  return app
}

const seqOf = (entries: Array<{ details?: Record<string, unknown> }>) => entries.map(e => e.details?.seq)

describe('GET /documents/:id/audit', () => {
  it('returns newest first with the true total', async () => {
    const app = await buildApp({ events: 250 })
    const body = (await app.inject({ method: 'GET', url: `/documents/${DOC}/audit?limit=100&offset=0` })).json()
    expect(body.total).toBe(250)
    expect(body.entries).toHaveLength(100)
    expect(seqOf(body.entries).slice(0, 3)).toEqual([250, 249, 248])
    expect(body.limit).toBe(100)
    expect(body.offset).toBe(0)
  })

  it('pages through the whole trail with no gaps or repeats', async () => {
    const app = await buildApp({ events: 250 })
    const seen: unknown[] = []
    for (let offset = 0; offset < 250; offset += 100) {
      const body = (await app.inject({ method: 'GET', url: `/documents/${DOC}/audit?limit=100&offset=${offset}` })).json()
      seen.push(...seqOf(body.entries))
    }
    expect(seen).toHaveLength(250)
    expect(new Set(seen).size).toBe(250)
    expect(seen[249]).toBe(1)
  })

  it('last page is short and past-the-end is empty', async () => {
    const app = await buildApp({ events: 250 })
    const last = (await app.inject({ method: 'GET', url: `/documents/${DOC}/audit?limit=100&offset=200` })).json()
    expect(last.entries).toHaveLength(50)
    const past = (await app.inject({ method: 'GET', url: `/documents/${DOC}/audit?limit=100&offset=500` })).json()
    expect(past.entries).toEqual([])
    expect(past.total).toBe(250)
  })

  it('with no parameters keeps the old default size (500) and reports the true total beyond it', async () => {
    const app = await buildApp({ events: 620 })
    const body = (await app.inject({ method: 'GET', url: `/documents/${DOC}/audit` })).json()
    expect(body.entries).toHaveLength(500)
    expect(body.total).toBe(620)
    expect(seqOf(body.entries)[0]).toBe(620)   // newest, not the oldest 500
  })

  it('rejects an out-of-range limit or a negative offset', async () => {
    const app = await buildApp({ events: 5 })
    for (const q of ['limit=0', 'limit=501', 'offset=-1', 'limit=abc']) {
      expect((await app.inject({ method: 'GET', url: `/documents/${DOC}/audit?${q}` })).statusCode).toBe(400)
    }
  })

  it('carries the resolved actor name and the entry hashes', async () => {
    const app = await buildApp({ events: 3 })
    const e = (await app.inject({ method: 'GET', url: `/documents/${DOC}/audit` })).json().entries[0]
    expect(e.actor).toBe('Alex')
    expect(e.rowHash).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('GET /documents/:id/audit/export', () => {
  it('includes every entry, oldest first, including ones past the first 500', async () => {
    const app = await buildApp({ events: 620 })
    const res = await app.inject({ method: 'GET', url: `/documents/${DOC}/audit/export` })
    expect(res.statusCode).toBe(200)
    const lines = res.body.trim().split('\r\n')
    expect(lines).toHaveLength(1 + 620)                 // header + every entry
    expect(lines[1]!.startsWith('1,')).toBe(true)       // oldest first (id column)
    expect(lines[620]!.startsWith('620,')).toBe(true)   // newest present
  })
})

describe('GET /documents/:id/qa-review', () => {
  it('uses the most recent review, not the first one', async () => {
    const app = await buildApp({ events: 40, reviewsAt: [5, 30] })
    const body = (await app.inject({ method: 'GET', url: `/documents/${DOC}/qa-review` })).json()
    // review #30 happened at 00:00:30 on 1 Oct 2026
    expect(body.lastReviewedAt).toBe(new Date(Date.UTC(2026, 9, 1, 0, 0, 30)).toISOString())
  })

  it('finds a review that is older than the newest 500 entries', async () => {
    const app = await buildApp({ events: 700, reviewsAt: [10] })
    const body = (await app.inject({ method: 'GET', url: `/documents/${DOC}/qa-review` })).json()
    expect(body.lastReviewedAt).toBe(new Date(Date.UTC(2026, 9, 1, 0, 0, 10)).toISOString())
  })

  it('reports no review when there is none', async () => {
    const app = await buildApp({ events: 10 })
    const body = (await app.inject({ method: 'GET', url: `/documents/${DOC}/qa-review` })).json()
    expect(body.lastReviewedAt).toBeNull()
  })
})
