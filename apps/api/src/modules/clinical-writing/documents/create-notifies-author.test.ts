// POST /projects/:id/documents: when a PM creates a document for someone else, that person is told they are
// its Author. No notification when you create a document for yourself.

import Fastify from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from '../../../auth/rbac.js'
import { documentsProjectScopedRoutes } from './routes.js'

type Sent = { recipientId: string; kind: string; title: string; body: string; linkPath?: string; payload: Record<string, unknown> }

async function build(opts: { notifications?: boolean } = {}) {
  const sent: Sent[] = []
  const tx = {
    document: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'DOC-NEW', status: 'not_started', ...data })),
      update: vi.fn(async () => ({})),
    },
    documentVersion: { create: vi.fn(async () => ({ id: 'ver-1', versionNumber: 'v0.1' })) },
    sectionContent: { createMany: vi.fn(async () => ({ count: 0 })) },
    checklistInstance: { findUnique: vi.fn(async () => null), create: vi.fn(async () => ({ id: 'inst-1', items: [] })) },
    checklistTemplate: { findFirst: vi.fn(async () => null), create: vi.fn(async () => ({ id: 'tmpl-new', version: 1 })) },
  }
  const app = Fastify()
  app.decorate('prisma', {
    project: { findUnique: vi.fn(async () => ({ id: 'proj-1', therapeuticArea: 'Oncology', submissionCountries: [] })) },
    user: { findUnique: vi.fn(async () => ({ role: 'contributor', name: 'Priya PM' })) },
    projectMember: { findMany: vi.fn(async () => [{ projectId: 'proj-1' }]) },
    raciAssignment: { findMany: async () => [] },
    projectTeamMember: { findMany: vi.fn(async () => []) },
    crmAttendee: { findMany: async () => [] },
    document: { findMany: vi.fn(async () => []) },
    documentUpload: { findMany: vi.fn(async () => []) },
    documentSource: { createMany: vi.fn(async () => ({ count: 0 })) },
    documentRaci: { findFirst: vi.fn(async () => null), create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'raci-1', ...data })) },
    documentTemplate: { findFirst: vi.fn(async () => null) },
    documentTypePolicy: { findFirst: vi.fn(async () => null) },
    aiPromptRecord: { findFirst: vi.fn(async () => null) },
    bestPracticeRecord: { findFirst: vi.fn(async () => null) },
    $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
  } as never)
  app.decorate('audit', { append: vi.fn(async () => undefined) } as never)
  if (opts.notifications !== false) {
    app.decorate('notifications', { send: async (n: Sent) => { sent.push(n); return n } } as never)
  }
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (req) => {
    const user: AuthenticatedUser = { id: 'pm-1', email: 'pm@x.io', role: 'pm', modules: ['A'], tenantId: null }
    ;(req as unknown as { user: AuthenticatedUser }).user = user
  })
  await app.register(documentsProjectScopedRoutes, { prefix: '/projects' })
  await app.ready()
  return {
    sent,
    post: (assigneeId: string) =>
      app.inject({ method: 'POST', url: '/projects/proj-1/documents', payload: { type: 'csr_full', title: 'CSR Full', assigneeId } }),
  }
}

beforeEach(() => { process.env.FEATURE_MODULES_ENABLED = 'A' })

describe('creating a document tells its Author', () => {
  it('notifies the assigned Author that a new document is theirs, with a link to it', async () => {
    const { post, sent } = await build()
    const res = await post('u1')
    expect(res.statusCode, res.body).toBe(201)
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({
      recipientId: 'u1',
      kind:        'document.raci_assigned',
      title:       'New document assigned to you: "CSR Full"',
      linkPath:    '/projects/proj-1/clinical-writing/documents/DOC-NEW',
    })
    expect(sent[0]!.body).toContain('You are the Author.')
    expect(sent[0]!.payload).toMatchObject({ documentId: 'DOC-NEW', letter: 'R', newDocument: true, assignedBy: 'pm-1' })
  })

  it('does not notify someone who creates the document for themselves', async () => {
    const { post, sent } = await build()
    expect((await post('pm-1')).statusCode).toBe(201)
    expect(sent).toHaveLength(0)
  })

  it('still creates the document when the notification service is not running', async () => {
    const { post, sent } = await build({ notifications: false })
    expect((await post('u1')).statusCode).toBe(201)
    expect(sent).toHaveLength(0)
  })
})
