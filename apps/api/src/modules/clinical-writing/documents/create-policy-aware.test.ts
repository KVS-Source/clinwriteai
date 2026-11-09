// POST /projects/:id/documents reads the current DocumentTypePolicy for
// the doc type and (a) pre-fills templateId when the caller didn't pass
// one, (b) stamps policyVersionAtCreate on the Document so later policy
// bumps don't rewrite which rules this document was authored under.
//
// Guards here:
//   - Policy lookup normalises hyphen → underscore (ADR 0001).
//   - Caller-supplied templateId wins over policy.templateId.
//   - Absent policy: policyVersionAtCreate = null, templateId defaults
//     to whatever the caller passed (undefined is fine).

import Fastify from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from '../../../auth/rbac.js'
import { documentsProjectScopedRoutes } from './routes.js'

interface PolicyRow {
  id: string
  docType: string
  version: number
  isCurrent: boolean
  retiredAt: Date | null
  templateId: string | null
}

async function build(opts: { policy?: PolicyRow | null } = {}) {
  const policyLookups: Array<Record<string, unknown>> = []
  const documentCreates: Array<Record<string, unknown>> = []

  const tx = {
    document: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        documentCreates.push(data)
        return { id: 'DOC-NEW', ...data }
      }),
      update: vi.fn(async () => ({})),
    },
    documentVersion: { create: vi.fn(async () => ({ id: 'ver-1', versionNumber: 'v0.1' })) },
    sectionContent: { createMany: vi.fn(async () => ({ count: 0 })) },
    checklistInstance: {
      findUnique: vi.fn(async () => null),
      create: vi.fn(async () => ({ id: 'inst-1', items: [] })),
    },
    checklistTemplate: {
      findFirst: vi.fn(async () => null),
      create:    vi.fn(async () => ({ id: 'tmpl-1', version: 1 })),
    },
  }

  const app = Fastify()
  app.decorate('prisma', {
    project:        { findUnique: vi.fn(async () => ({ id: 'proj-1', therapeuticArea: 'Oncology', submissionCountries: [] })) },
    user:           { findUnique: vi.fn(async () => ({ role: 'contributor' })) },
    projectMember:  { findMany: vi.fn(async () => [{ projectId: 'proj-1' }]) },
    raciAssignment: { findMany: async () => [] },
    projectTeamMember: { findMany: vi.fn(async () => []) },
    document:       { findMany: vi.fn(async () => []) },
    documentUpload: { findMany: vi.fn(async () => []) },
    documentSource: { createMany: vi.fn(async () => ({ count: 0 })) },
    documentRaci: {
      findFirst: vi.fn(async () => null),
      create:    vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'raci-1', ...data })),
    },
    documentTemplate: { findFirst: vi.fn(async () => null) },
    documentTypePolicy: {
      findFirst: vi.fn(async (arg: { where: Record<string, unknown> }) => {
        policyLookups.push(arg.where)
        return opts.policy ?? null
      }),
    },
    $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
  } as never)
  app.decorate('audit', { append: vi.fn(async () => undefined) } as never)
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (req) => {
    const user: AuthenticatedUser = { id: 'pm-1', email: 'pm@x.io', role: 'pm', modules: ['A'], tenantId: null }
    ;(req as unknown as { user: AuthenticatedUser }).user = user
  })
  await app.register(documentsProjectScopedRoutes, { prefix: '/projects' })
  await app.ready()

  return {
    post: (body: Record<string, unknown>) =>
      app.inject({ method: 'POST', url: '/projects/proj-1/documents', payload: { type: 'csr_full', title: 'CSR', assigneeId: 'u1', ...body } }),
    policyLookups,
    documentCreates,
  }
}

beforeEach(() => { process.env.FEATURE_MODULES_ENABLED = 'A' })

describe('POST /projects/:id/documents — DocumentTypePolicy wiring', () => {
  it('queries the current policy with the normalised (underscored) docType', async () => {
    const { post, policyLookups } = await build()
    expect((await post({ type: 'csr-full' })).statusCode).toBe(201)
    expect(policyLookups).toContainEqual({ docType: 'csr_full', isCurrent: true, retiredAt: null })
  })

  it('applies policy.templateId when the caller omitted templateId', async () => {
    const policy: PolicyRow = {
      id: 'pol-1', docType: 'csr_full', version: 3, isCurrent: true, retiredAt: null, templateId: 'tmpl-policy',
    }
    const { post, documentCreates } = await build({ policy })
    expect((await post({})).statusCode).toBe(201)
    expect(documentCreates[0]).toMatchObject({ templateId: 'tmpl-policy', policyVersionAtCreate: 3 })
  })

  it('caller-supplied templateId wins over policy.templateId', async () => {
    const policy: PolicyRow = {
      id: 'pol-1', docType: 'csr_full', version: 2, isCurrent: true, retiredAt: null, templateId: 'tmpl-policy',
    }
    const { post, documentCreates } = await build({ policy })
    expect((await post({ templateId: 'tmpl-caller' })).statusCode).toBe(201)
    expect(documentCreates[0]).toMatchObject({ templateId: 'tmpl-caller', policyVersionAtCreate: 2 })
  })

  it('leaves policyVersionAtCreate null when no policy exists for the doc type', async () => {
    const { post, documentCreates } = await build({ policy: null })
    expect((await post({})).statusCode).toBe(201)
    expect(documentCreates[0]).toMatchObject({ policyVersionAtCreate: null, templateId: null })
  })
})
