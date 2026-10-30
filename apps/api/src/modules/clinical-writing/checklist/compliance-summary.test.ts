// GET /documents/:id/compliance-summary — the output document's Compliance
// Summary appendix (FR-A-030, FR-A-001d; AC-A-029, AC-A-013): frameworks with
// their registry details, the rules applied under each, and every waived
// Framework Mandatory item with actor, time and reason.

import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from '../../../auth/rbac.js'
import { checklistRoutes } from './routes.js'

const DOC = 'DOC-1'

const item = (over: Record<string, unknown>) => ({
  id: 'i', instanceId: 'inst', templateItemId: null, text: 'Item', framework: 'ICH E3', frameworkMandatory: true,
  status: 'complete', isUserAdded: false, completedBy: null, completedAt: null, waivedBy: null, waivedAt: null,
  waiverReason: null, sortOrder: 0, ...over,
})

async function build(items: Array<Record<string, unknown>> | null) {
  const findInstance = vi.fn(async () => (items ? { templateVersion: 3, items } : null))
  const app = Fastify()
  app.decorate('prisma', {
    document: { findUnique: vi.fn(async ({ where }: { where: { id: string } }) => (where.id === DOC ? { id: DOC } : null)) },
    checklistInstance: { findUnique: findInstance, create: vi.fn() },
    user: { findMany: vi.fn(async () => [{ id: 'u-waiver', name: 'Dr Priya Nair' }]) },
    regulatoryFramework: { findMany: vi.fn(async () => [
      { name: 'ICH E3', version: '1995', jurisdiction: 'ICH', description: null, sourceUrl: 'https://ich.org/e3' },
    ]) },
  } as never)
  app.decorate('audit', { append: vi.fn() } as never)
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (req) => {
    const user: AuthenticatedUser = { id: 'u1', email: 'u@x.io', role: 'clinical-writer', modules: ['A'], tenantId: null }
    ;(req as unknown as { user: AuthenticatedUser }).user = user
  })
  await app.register(checklistRoutes, { prefix: '/documents' })
  await app.ready()
  return { app, findInstance }
}

describe('GET /documents/:id/compliance-summary', () => {
  it('lists frameworks with registry details and the rules applied under each', async () => {
    const { app } = await build([
      item({ text: 'Synopsis present', framework: 'ICH E3', status: 'complete' }),
      item({ text: 'Signatures captured', framework: '21 CFR Part 11', status: 'pending' }),
    ])
    const body = (await app.inject({ method: 'GET', url: `/documents/${DOC}/compliance-summary` })).json()
    expect(body.checklistTemplateVersion).toBe(3)
    expect(body.frameworks.map((f: { name: string }) => f.name)).toEqual(['ICH E3', '21 CFR Part 11'])
    expect(body.frameworks[0]).toMatchObject({ version: '1995', jurisdiction: 'ICH', sourceUrl: 'https://ich.org/e3', inRegistry: true })
    expect(body.frameworks[1]).toMatchObject({ inRegistry: false, rules: [{ text: 'Signatures captured', mandatory: true, status: 'pending' }] })
  })

  it('discloses every waived Framework Mandatory item with actor, time and reason (AC-A-013)', async () => {
    const { app } = await build([
      item({ text: '§16.4 patient listings', status: 'waived', waivedBy: 'u-waiver', waivedAt: new Date('2026-10-20T10:00:00Z'), waiverReason: 'Not a US submission' }),
      item({ text: 'Optional plain-language summary', frameworkMandatory: false, status: 'waived', waivedBy: 'u-waiver', waiverReason: 'n/a' }),
    ])
    const body = (await app.inject({ method: 'GET', url: `/documents/${DOC}/compliance-summary` })).json()
    expect(body.waivedMandatory).toEqual([{
      text: '§16.4 patient listings', framework: 'ICH E3', waivedBy: 'Dr Priya Nair',
      waivedAt: '2026-10-20T10:00:00.000Z', reason: 'Not a US submission',
    }])
  })

  it('returns an empty summary, without creating a checklist, when the document has none', async () => {
    const { app } = await build(null)
    const res = await app.inject({ method: 'GET', url: `/documents/${DOC}/compliance-summary` })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ frameworks: [], waivedMandatory: [], checklistTemplateVersion: null })
  })

  it('404s for an unknown document', async () => {
    const { app } = await build([])
    expect((await app.inject({ method: 'GET', url: '/documents/NOPE/compliance-summary' })).statusCode).toBe(404)
  })
})
