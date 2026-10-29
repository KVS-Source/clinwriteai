// POST /projects/:id/documents must materialise the ChecklistInstance up
// front (used to be lazy on first GET). This keeps the home-page project
// summary a pure read and prevents the dup-template bug that fired when
// the deliverableType string arrived in hyphen-case.

import Fastify from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from '../../../auth/rbac.js'
import { documentsProjectScopedRoutes } from './routes.js'

type ChecklistCreateArg = { data: { documentId: string; templateId: string; templateVersion: number } }
type TemplateFindArg = { where: { deliverableType: string; isCurrent: boolean } }
type TemplateCreateArg = { data: { deliverableType: string } }

async function build(opts: { existingTemplate?: boolean } = {}) {
  const checklistCreated: ChecklistCreateArg['data'][] = []
  const templateLookups: TemplateFindArg['where'][] = []
  const templateCreated: TemplateCreateArg['data'][] = []

  const tx = {
    document: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'DOC-NEW', ...data })),
      update: vi.fn(async () => ({})),
    },
    documentVersion: { create: vi.fn(async () => ({ id: 'ver-1', versionNumber: 'v0.1' })) },
    sectionContent: { createMany: vi.fn(async () => ({ count: 0 })) },
    checklistInstance: {
      findUnique: vi.fn(async () => null),
      create: vi.fn(async (arg: ChecklistCreateArg) => { checklistCreated.push(arg.data); return { id: 'inst-1', items: [] } }),
    },
    checklistTemplate: {
      findFirst: vi.fn(async (arg: TemplateFindArg) => {
        templateLookups.push(arg.where)
        return opts.existingTemplate
          ? { id: 'tmpl-existing', version: 2, items: [] }
          : null
      }),
      create: vi.fn(async (arg: TemplateCreateArg) => { templateCreated.push(arg.data); return { id: 'tmpl-new', version: 1 } }),
    },
  }

  const app = Fastify()
  app.decorate('prisma', {
    project: { findUnique: vi.fn(async () => ({ id: 'proj-1', therapeuticArea: 'Oncology', submissionCountries: [] })) },
    documentUpload: { findMany: vi.fn(async () => []) },
    documentSource: { createMany: vi.fn(async () => ({ count: 0 })) },
    documentRaci: {
      findFirst: vi.fn(async () => null),
      create:    vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'raci-1', ...data })),
    },
    documentTemplate: {
      findFirst: vi.fn(async () => null),
    },
    $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
  } as never)
  app.decorate('audit', { append: vi.fn(async () => undefined) } as never)
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (req) => {
    const user: AuthenticatedUser = { id: 'writer-1', email: 'w@x.io', role: 'clinical-writer', modules: ['A'], tenantId: null }
    ;(req as unknown as { user: AuthenticatedUser }).user = user
  })
  await app.register(documentsProjectScopedRoutes, { prefix: '/projects' })
  await app.ready()

  return {
    post: (body: Record<string, unknown>) =>
      app.inject({ method: 'POST', url: '/projects/proj-1/documents', payload: { type: 'csr_full', title: 'CSR', assigneeId: 'u1', ...body } }),
    checklistCreated,
    templateLookups,
    templateCreated,
  }
}

beforeEach(() => { process.env.FEATURE_MODULES_ENABLED = 'A' })

describe('POST /projects/:id/documents — eager ChecklistInstance', () => {
  it('creates the instance in the same transaction as the document', async () => {
    const { post, checklistCreated } = await build()
    expect((await post({})).statusCode).toBe(201)
    expect(checklistCreated).toHaveLength(1)
    expect(checklistCreated[0]).toMatchObject({ documentId: 'DOC-NEW' })
  })

  it('reuses an existing current master template when one is found', async () => {
    const { post, checklistCreated, templateCreated } = await build({ existingTemplate: true })
    expect((await post({})).statusCode).toBe(201)
    expect(templateCreated).toEqual([])
    expect(checklistCreated[0]!.templateId).toBe('tmpl-existing')
    expect(checklistCreated[0]!.templateVersion).toBe(2)
  })

  it('creates an empty fallback template when none exists yet', async () => {
    const { post, checklistCreated, templateCreated } = await build({ existingTemplate: false })
    expect((await post({})).statusCode).toBe(201)
    expect(templateCreated).toHaveLength(1)
    expect(templateCreated[0]).toMatchObject({ deliverableType: 'csr_full' })
    expect(checklistCreated[0]!.templateId).toBe('tmpl-new')
    expect(checklistCreated[0]!.templateVersion).toBe(1)
  })

  it('normalises hyphenated deliverable types to the underscore canonical form', async () => {
    const { post, templateLookups, templateCreated } = await build()
    expect((await post({ type: 'csr-full' })).statusCode).toBe(201)
    expect(templateLookups).toContainEqual({ deliverableType: 'csr_full', isCurrent: true })
    expect(templateCreated[0]!.deliverableType).toBe('csr_full')
  })
})
