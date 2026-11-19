// Reports & Analytics (catalogue-routes.ts) belong to the Project Manager: an IT admin is refused, and every
// figure covers only the projects the PM manages. Fastify inject() against a fake Prisma that records filters.

import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from '../../../auth/rbac.js'
import { reportsCatalogueRoutes } from './catalogue-routes.js'

const PM: AuthenticatedUser = { id: 'u-pm', email: 'pm@x', role: 'pm', modules: ['A'], tenantId: 't1' }
const ADMIN: AuthenticatedUser = { id: 'u-adm', email: 'a@x', role: 'tenant-admin', modules: ['A'], tenantId: 't1' }

async function build(user: AuthenticatedUser) {
  const findMany = () => vi.fn(async (_a?: unknown) => [] as unknown[])
  const prisma = {
    // The PM manages p-1 and p-2 (visibility.ts: ProjectMember rows with projectRole 'Project Manager').
    projectMember: { findMany: vi.fn(async () => [{ projectId: 'p-1' }, { projectId: 'p-2' }]) },
    document: { findMany: findMany(), groupBy: vi.fn(async () => []) },
    publication: { findMany: findMany(), groupBy: vi.fn(async () => []) },
    medContentItem: { findMany: findMany() },
    regulatorySubmission: { findMany: findMany() },
    ideationProject: { findMany: findMany() },
    project: { findMany: findMany() },
    aiCallRecord: {
      findMany: findMany(),
      aggregate: vi.fn(async () => ({ _sum: { inputTokens: 1000, outputTokens: 234, costUsd: '0.456' } })),
    },
    subscription: { findFirst: vi.fn(async () => ({ rolloverDay: 1 })) },
    tenant: { findUnique: vi.fn(async () => ({ name: 'Acme Oncology' })) },
    user: { findMany: vi.fn(async () => [{ id: 'u-w', name: 'Wanda Writer' }]) },
    $queryRaw: vi.fn(async () => []),
  }
  const app = Fastify()
  app.decorate('prisma', prisma as never)
  app.decorate('audit', { append: vi.fn(async () => {}) } as never)
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (r) => { Object.assign(r, { user }) })
  await app.register(reportsCatalogueRoutes)
  await app.ready()
  return { app, prisma }
}

const MANAGED = { projectId: { in: ['p-1', 'p-2'] } }

describe('Reports belong to the PM', () => {
  it.each([
    ['GET', '/reports/available'], ['GET', '/reports/health-scores'], ['GET', '/reports/cost-summary'],
    ['POST', '/reports/project-summary/generate'], ['GET', '/reports/project-summary/download'],
  ] as const)('an IT admin is refused %s %s', async (method, url) => {
    const { app } = await build(ADMIN)
    expect((await app.inject({ method, url, payload: method === 'POST' ? {} : undefined })).statusCode).toBe(403)
    await app.close()
  })

  it('the catalogue leaves out the organisation-wide User Activity and Compliance reports', async () => {
    const { app } = await build(PM)
    const res = await app.inject({ method: 'GET', url: '/reports/available' })
    expect(res.statusCode).toBe(200)
    const types = (res.json() as Array<{ type: string }>).map(r => r.type)
    expect(types).toEqual(['project-summary', 'module-activity', 'ai-usage'])
    expect((await app.inject({ method: 'GET', url: '/reports/compliance/download' })).statusCode).toBe(404)
    expect((await app.inject({ method: 'GET', url: '/reports/user-activity/download' })).statusCode).toBe(404)
    // Publishing Performance is Scientific Writing (Module B): Reports show Clinical Writing only.
    expect((await app.inject({ method: 'GET', url: '/reports/publishing-performance/download' })).statusCode).toBe(404)
    await app.close()
  })

  it('health covers Clinical Writing only, on the PM’s projects', async () => {
    const { app, prisma } = await build(PM)
    prisma.document.findMany.mockResolvedValueOnce([
      { status: 'signed', targetCompletionDate: null },
      { status: 'in_review', targetCompletionDate: new Date('2020-01-01') },
    ])
    const res = await app.inject({ method: 'GET', url: '/reports/health-scores' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual([expect.objectContaining({ module: 'A', label: 'Clinical Writing', completionRate: 50, overdueDocuments: 1, activeDocuments: 1, healthScore: 50 })])
    expect(prisma.document.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining(MANAGED) }))
    for (const m of [prisma.publication, prisma.medContentItem, prisma.regulatorySubmission, prisma.ideationProject]) expect(m.findMany).not.toHaveBeenCalled()
    await app.close()
  })

  it('reports and the cost panel cover only the PM’s projects', async () => {
    const { app, prisma } = await build(PM)
    await app.inject({ method: 'GET', url: '/reports/project-summary/download?format=csv' })
    expect(prisma.project.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ['p-1', 'p-2'] } } }))
    expect((await app.inject({ method: 'GET', url: '/reports/ai-usage/download?format=csv' })).statusCode).toBe(200)
    expect(prisma.aiCallRecord.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ ...MANAGED, module: 'A' }) }))

    const cost = await app.inject({ method: 'GET', url: '/reports/cost-summary' })
    expect(cost.json()).toMatchObject({ projects: 2, tokensConsumed: 1234, estimatedSpend: 0.46, tenantName: 'Acme Oncology' })
    expect(prisma.aiCallRecord.aggregate).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ ...MANAGED, module: 'A' }) }))
    await app.close()
  })

  it('a PM + Contributor is scoped as PM even when the request carries both roles (a download link)', async () => {
    const { app, prisma } = await build({ ...PM, role: 'contributor', roles: ['contributor', 'pm'] })
    expect((await app.inject({ method: 'GET', url: '/reports/module-activity/download?format=csv' })).statusCode).toBe(200)
    // Only the PM membership lookup ran: no Contributor sources (RACI, team rows) widened the set.
    expect(prisma.projectMember.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ projectRole: 'Project Manager' }) }))
    expect(prisma.document.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining(MANAGED) }))
    await app.close()
  })

  it('each report has its own on-screen view: headline figures and the same rows as the download', async () => {
    const { app, prisma } = await build(PM)
    prisma.project.findMany.mockResolvedValue([{ id: 'p-1', name: 'Alpha', status: 'ongoing', therapeuticArea: 'Oncology', phase: 'Phase 2' }])
    prisma.document.findMany.mockResolvedValueOnce([
      { projectId: 'p-1', status: 'signed', targetCompletionDate: null },
      { projectId: 'p-1', status: 'in_review', targetCompletionDate: new Date('2020-01-01') },
    ])
    const ps = await app.inject({ method: 'GET', url: '/reports/project-summary/preview' })
    expect(ps.statusCode).toBe(200)
    expect(ps.json()).toMatchObject({
      header: ['Project', 'Status', 'Therapeutic area', 'Phase', 'Documents', 'Signed', 'In progress', 'Overdue'],
      rows: [['Alpha', 'ongoing', 'Oncology', 'Phase 2', 2, 1, 1, 1]],
      totalRows: 1,
      summary: [{ label: 'Projects', value: 1 }, { label: 'Documents', value: 2 }, { label: 'Signed', value: 1 }, { label: 'Overdue', value: 1 }],
    })

    prisma.aiCallRecord.findMany.mockResolvedValueOnce([
      { createdAt: new Date('2026-11-02T10:00:00Z'), model: 'claude-x', intent: 'draft', inputTokens: 100, outputTokens: 50, costUsd: '0.0100', actorId: 'u-w' },
    ])
    const ai = await app.inject({ method: 'GET', url: '/reports/ai-usage/preview?dateFrom=2026-11-01&dateTo=2026-11-19' })
    expect(ai.json()).toMatchObject({
      rows: [['2026-11-02T10:00:00.000Z', 'claude-x', 'draft', 'Wanda Writer', 100, 50, '0.0100']],
      summary: [{ label: 'AI calls', value: 1 }, { label: 'Tokens', value: '150' }, { label: 'Cost', value: '$0.01' }, { label: 'Models', value: 'claude-x (1)' }],
    })
    expect((await app.inject({ method: 'GET', url: '/reports/compliance/preview' })).statusCode).toBe(404)
    await app.close()
  })
})
