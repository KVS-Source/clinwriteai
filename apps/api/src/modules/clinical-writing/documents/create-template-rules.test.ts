// POST /projects/:id/documents: a new document records its template and copies each section's plain-language
// rules (`formatRules`) from it, even for a document type that has no policy (the protocol has none). The front
// pages the template marks `seedContent` start filled in; every other section starts empty.

import Fastify from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from '../../../auth/rbac.js'
import { documentsProjectScopedRoutes } from './routes.js'

const TEMPLATE = {
  id: 'tpl-protocol-2',
  sections: [
    { id: 'm11-fm-1', number: 'i', title: 'Title page', seedContent: true, defaultContentHtml: '<p>CLINICAL STUDY PROTOCOL</p>', formatRules: 'Title in the Title style.\nKeep the status line.' },
    { id: 'm11-1', number: '1', title: 'Protocol Summary', defaultContentHtml: '<p>AUTHORING INSTRUCTIONS | x</p>', formatRules: 'Heading 1, Aptos Display 13 pt.\nBody text Aptos 9 pt.' },
    { id: 'm11-2', number: '2', title: 'Introduction' },   // an older-style section with no rules
  ],
}

async function build(opts: { policy?: boolean } = {}) {
  const created: Array<Record<string, unknown>> = []
  const docCreateData: Array<Record<string, unknown>> = []
  const tx = {
    document: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { docCreateData.push(data); return { id: 'DOC-NEW', status: 'not_started', ...data } }),
      update: vi.fn(async () => ({})),
    },
    documentVersion: { create: vi.fn(async () => ({ id: 'ver-1', versionNumber: 'v0.1' })) },
    sectionContent: { createMany: vi.fn(async ({ data }: { data: Array<Record<string, unknown>> }) => { created.push(...data); return { count: data.length } }) },
    documentTemplate: { findUnique: vi.fn(async () => ({ sections: TEMPLATE.sections })) },
    checklistInstance: { findUnique: vi.fn(async () => null), create: vi.fn(async () => ({ id: 'inst-1', items: [] })) },
    checklistTemplate: { findFirst: vi.fn(async () => null), create: vi.fn(async () => ({ id: 'tmpl-new', version: 1 })) },
  }
  const app = Fastify()
  app.decorate('prisma', {
    project: { findUnique: vi.fn(async () => ({ id: 'proj-1', therapeuticArea: 'Oncology', submissionCountries: [] })) },
    user: { findUnique: vi.fn(async () => ({ role: 'contributor' })) },
    projectMember: { findMany: vi.fn(async () => [{ projectId: 'proj-1' }]) },
    raciAssignment: { findMany: async () => [] },
    projectTeamMember: { findMany: vi.fn(async () => []) },
    crmAttendee: { findMany: async () => [] },
    document: { findMany: vi.fn(async () => []) },
    documentUpload: { findMany: vi.fn(async () => []) },
    documentSource: { createMany: vi.fn(async () => ({ count: 0 })) },
    documentRaci: { findFirst: vi.fn(async () => null), create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'raci-1', ...data })) },
    // The current template of the type: used for the starter sections AND (no policy) as the document's template.
    documentTemplate: { findFirst: vi.fn(async () => ({ id: TEMPLATE.id, sections: TEMPLATE.sections })) },
    documentTypePolicy: { findFirst: vi.fn(async () => (opts.policy ? null : null)) },
    aiPromptRecord: { findFirst: vi.fn(async () => null) },
    bestPracticeRecord: { findFirst: vi.fn(async () => null) },
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
    created, docCreateData,
    post: () => app.inject({ method: 'POST', url: '/projects/proj-1/documents', payload: { type: 'protocol', title: 'Protocol A', assigneeId: 'pm-1' } }),
  }
}

beforeEach(() => { process.env.FEATURE_MODULES_ENABLED = 'A' })

describe('a new protocol takes its rules from the template', () => {
  it('records the template it came from, with no policy for the type', async () => {
    const t = await build()
    const res = await t.post()
    expect(res.statusCode, res.body).toBe(201)
    expect(t.docCreateData[0]).toMatchObject({ templateId: 'tpl-protocol-2' })
  })

  it('copies each section\'s plain-language rules into the document', async () => {
    const t = await build()
    await t.post()
    const byId = Object.fromEntries(t.created.map(s => [s.sectionId as string, s]))
    expect(byId['m11-1']!.templateFormatRules).toBe('Heading 1, Aptos Display 13 pt.\nBody text Aptos 9 pt.')
    expect(byId['m11-fm-1']!.templateFormatRules).toContain('Title style')
    expect(byId['m11-2']!.templateFormatRules).toBeNull()
  })

  it('fills in the front pages the template marks, and leaves every other section empty', async () => {
    const t = await build()
    await t.post()
    const byId = Object.fromEntries(t.created.map(s => [s.sectionId as string, s]))
    expect(byId['m11-fm-1']!.contentHtml).toBe('<p>CLINICAL STUDY PROTOCOL</p>')
    expect(byId['m11-1']!.contentHtml).toBe('')
    expect(byId['m11-2']!.contentHtml).toBe('')
  })
})
