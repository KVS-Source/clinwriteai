// One checklist template, many projects: a project checklist is used by every project linked to it (the first
// project owns its rows), a project uses at most one checklist per document type, and projects without a link keep
// the platform baseline.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from '../../../auth/rbac.js'
import { checklistTemplateAdminRoutes } from './routes.js'
import { applicableChecklistTemplate } from './template-update.js'

const PM: AuthenticatedUser = { id: 'u-pm', email: 'pm@x.io', role: 'pm', capabilities: [], modules: ['A'], tenantId: null }
const PROJECTS = [
  { id: 'P-A', tenantId: null, name: 'Alpha study', shortTitle: 'Alpha' },
  { id: 'P-B', tenantId: null, name: 'Beta study', shortTitle: 'Beta' },
  { id: 'P-C', tenantId: null, name: 'Gamma study', shortTitle: 'Gamma' },
]
type Link = { deliverableType: string; projectId: string; ownerProjectId: string }

async function build(opts: { links?: Link[]; template?: { id: string; deliverableType: string; projectId: string | null } } = {}) {
  const links = [...(opts.links ?? [])]
  const tx = {
    checklistTemplate: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'T-new', ...data })), updateMany: vi.fn(async () => ({ count: 2 })) },
    checklistTemplateItem: { createMany: vi.fn(async () => ({ count: 1 })) },
    checklistTemplateProjectLink: {
      createMany: vi.fn(async ({ data }: { data: Link[] }) => { links.push(...data); return { count: data.length } }),
      deleteMany: vi.fn(async ({ where }: { where: { ownerProjectId: string } }) => { for (let i = links.length - 1; i >= 0; i--) if (links[i]!.ownerProjectId === where.ownerProjectId) links.splice(i, 1); return { count: 1 } }),
    },
  }
  const audit = vi.fn(async () => undefined)
  const app = Fastify()
  app.decorate('prisma', {
    project: { findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => PROJECTS.filter(p => where.id.in.includes(p.id))) },
    checklistTemplate: {
      findMany: vi.fn(async ({ where }: { where: { projectId?: unknown } }) =>
        // Templates owned by a project: only P-A owns rows (the existing "Alpha" checklist) when links say so.
        typeof where.projectId === 'object' && where.projectId !== null
          ? links.filter(l => l.ownerProjectId === l.projectId && (where.projectId as { in: string[] }).in.includes(l.projectId)).map(l => ({ projectId: l.projectId }))
          : []),
      findUnique: vi.fn(async () => opts.template ?? null),
    },
    checklistTemplateProjectLink: {
      findMany: vi.fn(async ({ where }: { where: { projectId?: { in: string[] }; ownerProjectId?: string } }) =>
        links.filter(l => (!where.projectId || where.projectId.in.includes(l.projectId)) && (!where.ownerProjectId || l.ownerProjectId === where.ownerProjectId))),
    },
    $transaction: vi.fn(async (fn: (t: unknown) => unknown) => fn(tx)),
  } as never)
  app.decorate('audit', { append: audit } as never)
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (req) => { (req as unknown as { user: AuthenticatedUser }).user = PM })
  await app.register(checklistTemplateAdminRoutes, { prefix: '/checklist-templates' })
  await app.ready()
  return { app, tx, audit, links }
}

describe('a new checklist template for several projects', () => {
  it('is owned by the first project and linked to every chosen project', async () => {
    const { app, tx, audit } = await build()
    const res = await app.inject({ method: 'POST', url: '/checklist-templates', payload: { deliverableType: 'protocol', projectIds: ['P-B', 'P-C', 'P-B'] } })
    expect(res.statusCode).toBe(201)
    expect(tx.checklistTemplate.create.mock.calls[0]![0].data).toMatchObject({ deliverableType: 'protocol', projectId: 'P-B', version: 1, templateStatus: 'draft' })
    expect(tx.checklistTemplateProjectLink.createMany.mock.calls[0]![0].data).toEqual([
      expect.objectContaining({ deliverableType: 'protocol', projectId: 'P-B', ownerProjectId: 'P-B' }),
      expect.objectContaining({ deliverableType: 'protocol', projectId: 'P-C', ownerProjectId: 'P-B' }),
    ])
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'checklist_template_created', details: expect.objectContaining({ projectIds: ['P-B', 'P-C'] }) }))
    await app.close()
  })

  it('is refused, naming the project, when a chosen project already uses a checklist for the type', async () => {
    const { app, tx } = await build({ links: [{ deliverableType: 'protocol', projectId: 'P-A', ownerProjectId: 'P-A' }] })
    const res = await app.inject({ method: 'POST', url: '/checklist-templates', payload: { deliverableType: 'protocol', projectIds: ['P-B', 'P-A'] } })
    expect(res.statusCode).toBe(409)
    expect(res.json()).toMatchObject({ error: 'project_has_checklist', projectIds: ['P-A'] })
    expect(res.json().message).toContain('Alpha')
    expect(tx.checklistTemplate.create).not.toHaveBeenCalled()
    await app.close()
  })

  it('an unknown project is refused', async () => {
    const { app } = await build()
    const res = await app.inject({ method: 'POST', url: '/checklist-templates', payload: { deliverableType: 'protocol', projectIds: ['P-ZZ'] } })
    expect(res.statusCode).toBe(404)
    expect(res.json()).toMatchObject({ error: 'project_not_found', projectIds: ['P-ZZ'] })
    await app.close()
  })
})

describe('changing the projects that use a checklist', () => {
  const TPL = { id: 'T-a', deliverableType: 'protocol', projectId: 'P-A' }
  const ALPHA = [{ deliverableType: 'protocol', projectId: 'P-A', ownerProjectId: 'P-A' }]

  it('adds projects, keeps the owner, and audits what changed', async () => {
    const { app, tx, audit, links } = await build({ template: TPL, links: ALPHA })
    const res = await app.inject({ method: 'PUT', url: '/checklist-templates/T-a/projects', payload: { projectIds: ['P-A', 'P-B'] } })
    expect(res.statusCode).toBe(200)
    expect(res.json().projects).toEqual([{ id: 'P-A', name: 'Alpha' }, { id: 'P-B', name: 'Beta' }])
    expect(tx.checklistTemplate.updateMany).not.toHaveBeenCalled()
    expect(links.map(l => [l.projectId, l.ownerProjectId])).toEqual([['P-A', 'P-A'], ['P-B', 'P-A']])
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'checklist_template_projects_changed', details: expect.objectContaining({ added: ['P-B'], removed: [] }) }))
    await app.close()
  })

  it('removing the owning project hands the checklist (all versions) to the next project', async () => {
    const { app, tx, audit, links } = await build({ template: TPL, links: [...ALPHA, { deliverableType: 'protocol', projectId: 'P-B', ownerProjectId: 'P-A' }] })
    const res = await app.inject({ method: 'PUT', url: '/checklist-templates/T-a/projects', payload: { projectIds: ['P-B'] } })
    expect(res.statusCode).toBe(200)
    expect(tx.checklistTemplate.updateMany).toHaveBeenCalledWith({ where: { deliverableType: { in: expect.arrayContaining(['protocol']) }, projectId: 'P-A' }, data: { projectId: 'P-B' } })
    expect(links.map(l => [l.projectId, l.ownerProjectId])).toEqual([['P-B', 'P-B']])
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ details: expect.objectContaining({ removed: ['P-A'], ownerFrom: 'P-A', ownerTo: 'P-B' }) }))
    await app.close()
  })

  it('needs at least one project, and the platform baseline has no project list', async () => {
    const empty = await build({ template: TPL, links: ALPHA })
    expect((await empty.app.inject({ method: 'PUT', url: '/checklist-templates/T-a/projects', payload: { projectIds: [] } })).statusCode).toBe(400)
    await empty.app.close()
    const base = await build({ template: { id: 'T-base', deliverableType: 'protocol', projectId: null } })
    const res = await base.app.inject({ method: 'PUT', url: '/checklist-templates/T-base/projects', payload: { projectIds: ['P-A'] } })
    expect(res.statusCode).toBe(409)
    expect(res.json()).toMatchObject({ error: 'baseline_has_no_projects' })
    await base.app.close()
  })
})

describe('which checklist a project uses', () => {
  const rows = [
    { id: 'T-base', deliverableType: 'protocol', projectId: null, isCurrent: true, templateStatus: 'locked' },
    { id: 'T-alpha', deliverableType: 'protocol', projectId: 'P-A', isCurrent: true, templateStatus: 'locked' },
  ]
  const tx = {
    checklistTemplateProjectLink: { findUnique: vi.fn(async ({ where }: { where: { deliverableType_projectId: { projectId: string } } }) =>
      ['P-A', 'P-B'].includes(where.deliverableType_projectId.projectId) ? { ownerProjectId: 'P-A' } : null) },
    checklistTemplate: { findFirst: vi.fn(async ({ where }: { where: { projectId: string | null } }) => rows.find(r => r.projectId === where.projectId) ?? null) },
  }

  it('a linked project uses the shared project checklist; an unlinked one the baseline', async () => {
    expect((await applicableChecklistTemplate(tx as never, 'protocol', 'P-B'))?.id).toBe('T-alpha')
    expect((await applicableChecklistTemplate(tx as never, 'protocol', 'P-A'))?.id).toBe('T-alpha')
    expect((await applicableChecklistTemplate(tx as never, 'protocol', 'P-C'))?.id).toBe('T-base')
  })
})

it('migration 0098 creates the link table and links every existing project override to its project', () => {
  const sql = readFileSync(fileURLToPath(new URL('../../../../prisma/migrations/00000000000098_checklist_template_project_links/migration.sql', import.meta.url)), 'utf8')
  expect(sql).toMatch(/CREATE TABLE "checklist_template_project_links"/)
  expect(sql).toMatch(/PRIMARY KEY \("deliverableType", "projectId"\)/)
  expect(sql).toMatch(/INSERT INTO "checklist_template_project_links"[\s\S]+WHERE "projectId" IS NOT NULL/)
})
