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

  it('shows a CRM resolution as a resolved comment', async () => {
    const app = await buildApp({ events: 0 })
    await (app as unknown as { audit: InMemoryAuditRepository }).audit.append({
      timestamp: new Date().toISOString(), actorId: 'user-a', action: 'crm_resolution_logged',
      entityType: 'document', entityId: DOC, details: { commentId: 'CMT-001' }, ipAddress: null,
    })
    const [entry] = (await app.inject({ method: 'GET', url: `/documents/${DOC}/audit` })).json().entries
    expect(entry.action).toBe('crm_resolution_logged')
    expect(entry.eventType).toBe('comment-resolved')
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

describe('GET /documents/:id/audit — date range', () => {
  // event N happened at 2026-10-01 00:00:N UTC
  const at = (sec: number) => encodeURIComponent(new Date(Date.UTC(2026, 9, 1, 0, 0, sec)).toISOString())

  it('returns only entries inside from..to, newest first, with a total for that range', async () => {
    const app = await buildApp({ events: 60 })
    const body = (await app.inject({ method: 'GET', url: `/documents/${DOC}/audit?from=${at(10)}&to=${at(19)}` })).json()
    expect(body.total).toBe(10)
    expect(seqOf(body.entries)).toEqual([19, 18, 17, 16, 15, 14, 13, 12, 11, 10])   // both ends inclusive
  })

  it('pages within the range', async () => {
    const app = await buildApp({ events: 60 })
    const base = `/documents/${DOC}/audit?from=${at(10)}&to=${at(39)}&limit=10`
    const p1 = (await app.inject({ method: 'GET', url: `${base}&offset=0` })).json()
    const p3 = (await app.inject({ method: 'GET', url: `${base}&offset=20` })).json()
    expect(p1.total).toBe(30)
    expect(seqOf(p1.entries)[0]).toBe(39)
    expect(seqOf(p3.entries)).toEqual([19, 18, 17, 16, 15, 14, 13, 12, 11, 10])
  })

  it('accepts a range with only one end', async () => {
    const app = await buildApp({ events: 60 })
    expect((await app.inject({ method: 'GET', url: `/documents/${DOC}/audit?from=${at(51)}` })).json().total).toBe(10)
    expect((await app.inject({ method: 'GET', url: `/documents/${DOC}/audit?to=${at(5)}` })).json().total).toBe(5)
  })

  it('returns an empty list, not an error, when nothing falls in the range', async () => {
    const app = await buildApp({ events: 20 })
    const res = await app.inject({ method: 'GET', url: `/documents/${DOC}/audit?from=2030-01-01T00:00:00.000Z` })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ entries: [], total: 0 })
  })

  it('accepts a timezone offset in the instant', async () => {
    const app = await buildApp({ events: 20 })
    // 05:30 in +05:30 is 00:00 UTC, i.e. before event 1 at 00:00:01 UTC
    const res = await app.inject({ method: 'GET', url: `/documents/${DOC}/audit?from=${encodeURIComponent('2026-10-01T05:30:00+05:30')}` })
    expect(res.json().total).toBe(20)
  })

  it('rejects a bad date and a range whose from is after its to', async () => {
    const app = await buildApp({ events: 5 })
    for (const q of ['from=yesterday', 'to=2026-13-45', `from=${at(30)}&to=${at(10)}`]) {
      expect((await app.inject({ method: 'GET', url: `/documents/${DOC}/audit?${q}` })).statusCode).toBe(400)
    }
  })

  it('does not narrow the export (a compliance export always covers the whole trail)', async () => {
    const app = await buildApp({ events: 30 })
    const res = await app.inject({ method: 'GET', url: `/documents/${DOC}/audit/export?from=${at(10)}&to=${at(12)}` })
    expect(res.body.trim().split('\r\n')).toHaveLength(1 + 30)
  })
})

describe('GET /documents/:id/audit — "AI suggestion requested" entries', () => {
  async function withAiEntry(details: Record<string, unknown>) {
    const audit = new InMemoryAuditRepository('test-audit-secret-32-bytes-long-for-vitest')
    await audit.append({
      timestamp: new Date().toISOString(), actorId: 'user-a', action: 'ai_suggestion_requested',
      entityType: 'document', entityId: DOC, details, ipAddress: null,
    })
    const app = Fastify()
    app.decorate('prisma', {
      document: { findUnique: vi.fn(async () => ({ id: DOC, title: 'ICF', createdAt: new Date() })) },
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
    return (await app.inject({ method: 'GET', url: `/documents/${DOC}/audit` })).json().entries[0]
  }

  it('shows as its own event type with the model, section and intent in the detail', async () => {
    const e = await withAiEntry({ sectionId: 's10', aiModel: 'claude-opus', intent: 'edit', outcome: 'completed' })
    expect(e.eventType).toBe('ai-requested')
    expect(e.detail).toBe('Section s10 · Model claude-opus · Intent edit')
  })

  it('says so when the request hit the quota or failed', async () => {
    expect((await withAiEntry({ sectionId: 's2', aiModel: 'm', intent: 'tighten', outcome: 'quota_reached' })).detail).toContain('Quota reached')
    expect((await withAiEntry({ sectionId: 's2', aiModel: 'm', intent: 'tighten', outcome: 'failed' })).detail).toContain('Request failed')
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
