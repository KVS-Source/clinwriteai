// GET /reports/projects/:id/ai-usage — measured AI usage for one project, via Fastify inject()
// against a fake Prisma that records the filters it was given.

import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from '../../../auth/rbac.js'
import { reportsRoutes } from './routes.js'

async function build(projectExists = true) {
  const count = vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
    where.errorCode && typeof where.errorCode === 'object' ? 2          // failed calls
    : where.postCallDocumentVersionId ? 6                               // accepted drafts
    : 10)                                                               // draft calls
  const aggregate = vi.fn(async (args: { where: Record<string, unknown>; _avg?: unknown }) =>
    args._avg
      ? { _count: { _all: 14 }, _avg: { latencyMs: 2345.6 } }
      : { _sum: { costUsd: '1.234567', inputTokens: 50_000, outputTokens: 12_000 } })
  const groupBy = vi.fn(async () => [
    { model: 'claude-opus-4-7', _count: { _all: 9 }, _sum: { costUsd: '1.1' } },
    { model: 'claude-sonnet-4-6', _count: { _all: 5 }, _sum: { costUsd: '0.134567' } },
  ])
  const app = Fastify()
  app.decorate('prisma', {
    project: { findUnique: vi.fn(async () => (projectExists ? { id: 'p1' } : null)) },
    aiCallRecord: { aggregate, count, groupBy },
  } as never)
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (r) => {
    const user: AuthenticatedUser = { id: 'u', email: 'e@v', role: 'admin', modules: ['A'], tenantId: null }
    Object.assign(r, { user })
  })
  await app.register(reportsRoutes)
  await app.ready()
  return { app, count }
}

describe('GET /reports/projects/:projectId/ai-usage', () => {
  it('summarises the project’s AI call log: spend, tokens, speed and drafts accepted', async () => {
    const { app, count } = await build()
    const res = await app.inject({ method: 'GET', url: '/reports/projects/p1/ai-usage' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({
      projectId: 'p1', calls: 14, failedCalls: 2, costUsd: 1.234567, inputTokens: 50000, outputTokens: 12000,
      avgLatencyMs: 2346, draftsGenerated: 10, draftsAccepted: 6, acceptanceRate: 0.6,
      byModel: [{ model: 'claude-opus-4-7', calls: 9, costUsd: 1.1 }, { model: 'claude-sonnet-4-6', calls: 5, costUsd: 0.134567 }],
    })
    // accepted = accepted into a section and not undone; explain-style calls aren't drafts
    expect(count).toHaveBeenCalledWith({ where: expect.objectContaining({ projectId: 'p1', postCallDocumentVersionId: { not: null }, undoneAt: null, intent: { in: expect.not.arrayContaining(['explain']) } }) })
    await app.close()
  })

  it('404s for an unknown project', async () => {
    const { app } = await build(false)
    expect((await app.inject({ method: 'GET', url: '/reports/projects/nope/ai-usage' })).statusCode).toBe(404)
    await app.close()
  })
})
