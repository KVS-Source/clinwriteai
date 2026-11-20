// Project override (POST /checklist-templates/:id/clone-to-project): a draft v1 scoped to the project, copied from
// the baseline; the baseline's own v1 must not block it (migration 0097 drops the stale (deliverableType, version)
// index); and a unique-index clash is answered as "override exists", never with the database's message.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from '../../../auth/rbac.js'
import { checklistTemplateAdminRoutes } from './routes.js'

const PM: AuthenticatedUser = { id: 'u-pm', email: 'pm@x.io', role: 'pm', capabilities: [], modules: ['A'], tenantId: null }
const BASELINE = {
  id: 'T-base', deliverableType: 'dsur', projectId: null, version: 2, templateStatus: 'locked', isCurrent: true,
  items: [{ text: 'Safety summary', framework: 'ICH E2F', frameworkMandatory: true, ownerRaci: 'R', stage: 'reporting', autoCompleteOn: null, sortOrder: 10 }],
}

async function build(createImpl: (a: { data: Record<string, unknown> }) => Promise<unknown>) {
  const create = vi.fn(createImpl)
  const createMany = vi.fn(async () => ({ count: 1 }))
  const audit = vi.fn(async () => undefined)
  const app = Fastify()
  app.decorate('prisma', {
    checklistTemplate: { findUnique: vi.fn(async () => BASELINE), findFirst: vi.fn(async () => null) },
    project: { findUnique: vi.fn(async () => ({ id: 'P-1', tenantId: null, name: 'Test Project', shortTitle: 'Test Project' })) },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn({ checklistTemplate: { create }, checklistTemplateItem: { createMany } })),
  } as never)
  app.decorate('audit', { append: audit } as never)
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (req) => { (req as unknown as { user: AuthenticatedUser }).user = PM })
  await app.register(checklistTemplateAdminRoutes, { prefix: '/checklist-templates' })
  await app.ready()
  return { app, create, createMany, audit }
}

describe('creating a project-scoped override', () => {
  it('creates a draft v1 for the project with the baseline items, and audits it', async () => {
    const { app, create, createMany, audit } = await build(async ({ data }) => ({ id: 'T-new', ...data }))
    const res = await app.inject({ method: 'POST', url: '/checklist-templates/T-base/clone-to-project', payload: { projectId: 'P-1' } })
    expect(res.statusCode).toBe(201)
    expect(create.mock.calls[0]![0].data).toMatchObject({ deliverableType: 'dsur', projectId: 'P-1', version: 1, templateStatus: 'draft' })
    expect(createMany).toHaveBeenCalledOnce()
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'checklist_template_project_override_created' }))
    await app.close()
  })

  it('a unique-index clash says the override exists instead of showing the database error', async () => {
    const { app, audit } = await build(async () => {
      throw Object.assign(new Error('Unique constraint failed on the fields: (`deliverableType`,`version`)'), { code: 'P2002' })
    })
    const res = await app.inject({ method: 'POST', url: '/checklist-templates/T-base/clone-to-project', payload: { projectId: 'P-1' } })
    expect(res.statusCode).toBe(409)
    expect(res.json()).toMatchObject({ error: 'override_exists' })
    expect(res.body).not.toContain('prisma')
    expect(audit).not.toHaveBeenCalled()
    await app.close()
  })

  it('migration 0097 drops the stale (deliverableType, version) unique index that blocked overrides', () => {
    const sql = readFileSync(fileURLToPath(new URL('../../../../prisma/migrations/00000000000097_drop_stale_checklist_template_unique/migration.sql', import.meta.url)), 'utf8')
    expect(sql).toMatch(/DROP INDEX IF EXISTS "checklist_templates_deliverableType_version_key";/)
  })
})
