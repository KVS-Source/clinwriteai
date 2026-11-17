// CW-089: a checklist template filed under the hyphenated spelling ("csr-full") is never used by a document
// (documents look it up as "csr_full"). The screen shows it under its type with an "old spelling" mark, and
// every change to it is refused with a pointer to the real template.

import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from '../../../auth/rbac.js'
import { checklistTemplateAdminRoutes } from './routes.js'

const PM: AuthenticatedUser = { id: 'u-pm', email: 'pm@x.io', role: 'pm', capabilities: [], modules: ['A'], tenantId: null }
const row = (id: string, type: string, over: Record<string, unknown> = {}) => ({
  id, deliverableType: type, projectId: null, version: 1, effectiveDate: new Date('2026-10-01'), changeReason: null, isCurrent: true,
  templateStatus: 'draft', approvedBy: null, approvedAt: null, createdBy: 'u-pm', createdAt: new Date('2026-10-01'),
  _count: { items: 0, instances: 0 }, items: [], ...over,
})
const ROWS = [row('T-legacy', 'csr-full'), row('T-real', 'csr_full')]

async function build() {
  const writes: string[] = []
  const w = (name: string) => vi.fn(async () => { writes.push(name); return { id: 'x' } })
  const app = Fastify()
  app.decorate('prisma', {
    checklistTemplate: {
      findMany: vi.fn(async () => ROWS),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => ROWS.find(r => r.id === where.id) ?? null),
      findFirst: vi.fn(async () => null), create: w('template.create'), update: w('template.update'), updateMany: w('template.updateMany'),
    },
    checklistTemplateItem: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => ({ id: where.id, templateId: where.id === 'I-legacy' ? 'T-legacy' : 'T-real', frameworkMandatory: false, stage: 'reporting', sortOrder: 10,
        template: ROWS.find(r => r.id === (where.id === 'I-legacy' ? 'T-legacy' : 'T-real'))! })),
      aggregate: vi.fn(async () => ({ _max: { sortOrder: 0 } })), create: w('item.create'), update: w('item.update'), delete: w('item.delete'),
      findFirst: vi.fn(async () => null), findMany: vi.fn(async () => []),
    },
    user: { findMany: vi.fn(async () => []) },
    project: { findUnique: vi.fn(async () => ({ id: 'P-1', tenantId: null, name: 'P', shortTitle: 'P' })) },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn({})),
  } as never)
  app.decorate('audit', { append: vi.fn(async () => undefined), query: vi.fn(async () => []), list: vi.fn(async () => []) } as never)
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (req) => { (req as unknown as { user: AuthenticatedUser }).user = PM })
  await app.register(checklistTemplateAdminRoutes, { prefix: '/checklist-templates' })
  await app.ready()
  return { app, writes }
}

describe('checklist templates filed under the old spelling', () => {
  it('the list gives one spelling per type and marks the old-spelling rows', async () => {
    const { app } = await build()
    const res = await app.inject({ method: 'GET', url: '/checklist-templates' })
    expect(res.statusCode).toBe(200)
    const rows = res.json() as Array<{ id: string; deliverableType: string; legacySpelling: boolean; storedType: string }>
    expect(rows.map(r => r.deliverableType)).toEqual(['csr_full', 'csr_full'])
    expect(rows.find(r => r.id === 'T-legacy')).toMatchObject({ legacySpelling: true, storedType: 'csr-full' })
    expect(rows.find(r => r.id === 'T-real')).toMatchObject({ legacySpelling: false, storedType: 'csr_full' })
    await app.close()
  })

  it('every change to an old-spelling template is refused, pointing at the real one, and writes nothing', async () => {
    const { app, writes } = await build()
    const calls = [
      app.inject({ method: 'POST', url: '/checklist-templates/T-legacy/items', payload: { text: 'x', framework: 'f', stage: 'reporting' } }),
      app.inject({ method: 'PATCH', url: '/checklist-templates/items/I-legacy', payload: { text: 'y' } }),
      app.inject({ method: 'DELETE', url: '/checklist-templates/items/I-legacy' }),
      app.inject({ method: 'POST', url: '/checklist-templates/items/I-legacy/move', payload: { direction: 'up' } }),
      app.inject({ method: 'POST', url: '/checklist-templates/T-legacy/approve' }),
      app.inject({ method: 'POST', url: '/checklist-templates/T-legacy/bump-draft' }),
      app.inject({ method: 'POST', url: '/checklist-templates/T-legacy/clone-to-project', payload: { projectId: 'P-1' } }),
    ]
    for (const res of await Promise.all(calls)) {
      expect(res.statusCode).toBe(409)
      expect(res.json()).toMatchObject({ error: 'template_type_legacy', canonicalType: 'csr_full' })
      expect(res.json().message).toContain('"csr-full"')
    }
    expect(writes).toEqual([])
    await app.close()
  })

  it('the real template is still editable', async () => {
    const { app, writes } = await build()
    const res = await app.inject({ method: 'POST', url: '/checklist-templates/T-real/items', payload: { text: 'x', framework: 'f', stage: 'reporting' } })
    expect(res.statusCode).toBe(201)
    expect(writes).toEqual(['item.create'])
    await app.close()
  })
})
