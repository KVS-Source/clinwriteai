// GET /journals — target-journal catalogue.
//
// Mocks prisma.journal.findMany so the handler + Zod query-schema +
// shape mapper are exercised in isolation.

import Fastify from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from '../../../auth/rbac.js'
import { journalsRoutes } from './routes.js'

const FIXTURE = [
  { id: 'jnl-nejm', name: 'New England Journal of Medicine', abbreviation: 'NEJM',
    impactFactor: 96.2, acceptanceRate: 0.05, timeToDecision: 28,
    isICMJE: true, isEQUATOR: true, scope: 'general-medicine',
    submissionGuidelinesUrl: 'https://www.nejm.org/author-center' },
  { id: 'jnl-jco', name: 'Journal of Clinical Oncology', abbreviation: 'JCO',
    impactFactor: 45.3, acceptanceRate: 0.18, timeToDecision: 35,
    isICMJE: true, isEQUATOR: true, scope: 'oncology',
    submissionGuidelinesUrl: 'https://ascopubs.org/jco/authors' },
]

async function build() {
  const findMany = vi.fn(async ({ where }: { where: Record<string, unknown> } = { where: {} }) => {
    let rows = FIXTURE.slice()
    if (where.scope && typeof where.scope === 'object') {
      const { equals } = where.scope as { equals: string }
      rows = rows.filter(r => r.scope === equals)
    }
    if (where.isICMJE === true)  rows = rows.filter(r => r.isICMJE)
    if (where.isICMJE === false) rows = rows.filter(r => !r.isICMJE)
    return rows
  })
  const app = Fastify()
  app.decorate('prisma', { journal: { findMany } } as never)
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (req) => {
    const user: AuthenticatedUser = { id: 'writer-b', email: 'w@x.io', role: 'medical-writer', modules: ['B'], tenantId: null }
    ;(req as unknown as { user: AuthenticatedUser }).user = user
  })
  await app.register(journalsRoutes)
  await app.ready()
  return { app, findMany }
}

beforeEach(() => { process.env.FEATURE_MODULES_ENABLED = 'B' })

describe('GET /journals', () => {
  it('returns the full catalogue in shape', async () => {
    const { app } = await build()
    const res = await app.inject({ method: 'GET', url: '/journals' })
    expect(res.statusCode).toBe(200)
    const body = res.json() as Array<{ id: string; name: string; isICMJE: boolean }>
    expect(body).toHaveLength(2)
    expect(body[0].id).toMatch(/^jnl-/)
    expect(body[0].isICMJE).toBe(true)
  })

  it('filters by scope', async () => {
    const { app, findMany } = await build()
    const res = await app.inject({ method: 'GET', url: '/journals?scope=oncology' })
    expect(res.statusCode).toBe(200)
    const body = res.json() as Array<{ id: string }>
    expect(body.map(j => j.id)).toEqual(['jnl-jco'])
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ scope: { equals: 'oncology', mode: 'insensitive' } }),
    }))
  })

  it('filters by icmje=true', async () => {
    const { app } = await build()
    const res = await app.inject({ method: 'GET', url: '/journals?icmje=true' })
    expect(res.statusCode).toBe(200)
    const body = res.json() as Array<{ id: string; isICMJE: boolean }>
    expect(body.every(j => j.isICMJE)).toBe(true)
  })

  it('rejects an unknown icmje value with 400', async () => {
    const { app } = await build()
    const res = await app.inject({ method: 'GET', url: '/journals?icmje=maybe' })
    expect(res.statusCode).toBe(400)
  })
})
