// New checklist template (POST /checklist-templates): a PM starts a platform template as a draft, optionally with
// items imported from a file. It is the next version of the type (v1 for a new type), never current until approved,
// refused while the type already has a draft, and closed to everyone but PMs.

import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from '../../../auth/rbac.js'
import { checklistTemplateAdminRoutes } from './routes.js'

const PM: AuthenticatedUser = { id: 'u-pm', email: 'pm@x.io', role: 'pm', capabilities: [], modules: ['A'], tenantId: null }
const WRITER: AuthenticatedUser = { ...PM, id: 'u-w', role: 'medical_writer' as AuthenticatedUser['role'] }

async function build(existing: Array<{ id: string; version: number; templateStatus: string }>, user: AuthenticatedUser = PM) {
  const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'T-new', ...data }))
  const createMany = vi.fn(async () => ({ count: 1 }))
  const audit = vi.fn(async () => undefined)
  const findMany = vi.fn(async () => existing)
  const app = Fastify()
  app.decorate('prisma', {
    checklistTemplate: { findMany },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn({ checklistTemplate: { create }, checklistTemplateItem: { createMany } })),
  } as never)
  app.decorate('audit', { append: audit } as never)
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (req) => { (req as unknown as { user: AuthenticatedUser }).user = user })
  await app.register(checklistTemplateAdminRoutes, { prefix: '/checklist-templates' })
  await app.ready()
  return { app, create, createMany, audit, findMany }
}

const ITEMS = [
  { text: 'Synopsis matches protocol objectives', framework: 'ICH E3', frameworkMandatory: true, ownerRaci: 'R', stage: 'reporting' },
  { text: 'QC of tables', framework: 'SOP-QC-01', ownerRaci: 'Q', stage: 'cross_functional_review' },
]

describe('creating a new checklist template', () => {
  it('a new type starts as draft v1 with the imported items in file order, and is audited', async () => {
    const { app, create, createMany, audit } = await build([])
    const res = await app.inject({ method: 'POST', url: '/checklist-templates', payload: { deliverableType: 'clinical-overview', items: ITEMS } })
    expect(res.statusCode).toBe(201)
    expect(create.mock.calls[0]![0].data).toMatchObject({ deliverableType: 'clinical_overview', projectId: null, version: 1, templateStatus: 'draft', isCurrent: false, createdBy: 'u-pm' })
    const rows = (createMany.mock.calls[0] as unknown as [{ data: Array<Record<string, unknown>> }])[0].data
    expect(rows.map(r => [r.text, r.sortOrder, r.frameworkMandatory, r.ownerRaci])).toEqual([
      ['Synopsis matches protocol objectives', 10, true, 'R'],
      ['QC of tables', 20, false, 'Q'],
    ])
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'checklist_template_created', details: expect.objectContaining({ itemCount: 2, version: 1 }) }))
    await app.close()
  })

  it('an existing type gets the next version, and an empty template is allowed', async () => {
    const { app, create, createMany } = await build([{ id: 'T1', version: 1, templateStatus: 'locked' }, { id: 'T2', version: 3, templateStatus: 'locked' }])
    const res = await app.inject({ method: 'POST', url: '/checklist-templates', payload: { deliverableType: 'dsur' } })
    expect(res.statusCode).toBe(201)
    expect(create.mock.calls[0]![0].data).toMatchObject({ version: 4, templateStatus: 'draft' })
    expect(createMany).not.toHaveBeenCalled()
    await app.close()
  })

  it('is refused while the type already has a draft, pointing at it, and writes nothing', async () => {
    const { app, create, audit } = await build([{ id: 'T-d', version: 2, templateStatus: 'draft' }])
    const res = await app.inject({ method: 'POST', url: '/checklist-templates', payload: { deliverableType: 'dsur', items: ITEMS } })
    expect(res.statusCode).toBe(409)
    expect(res.json()).toMatchObject({ error: 'draft_exists', draftId: 'T-d' })
    expect(create).not.toHaveBeenCalled()
    expect(audit).not.toHaveBeenCalled()
    await app.close()
  })

  it('rejects a bad row (unknown stage) and a bad type name', async () => {
    const { app, create } = await build([])
    const badStage = await app.inject({ method: 'POST', url: '/checklist-templates', payload: { deliverableType: 'dsur', items: [{ text: 'x', framework: 'f', stage: 'somewhere' }] } })
    const badType = await app.inject({ method: 'POST', url: '/checklist-templates', payload: { deliverableType: 'CSR Full!' } })
    expect(badStage.statusCode).toBe(400)
    expect(badType.statusCode).toBe(400)
    expect(create).not.toHaveBeenCalled()
    await app.close()
  })

  it('only a PM can create one', async () => {
    const { app, create } = await build([], WRITER)
    const res = await app.inject({ method: 'POST', url: '/checklist-templates', payload: { deliverableType: 'dsur' } })
    expect(res.statusCode).toBe(403)
    expect(create).not.toHaveBeenCalled()
    await app.close()
  })
})
