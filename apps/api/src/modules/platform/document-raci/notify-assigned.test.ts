// "You've been assigned" notifications: to someone given a RACI letter on a document, and to the Author a PM
// creates a document for. Never to yourself, never fatal, nothing when the notification service is absent.

import Fastify from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from '../../../auth/rbac.js'
import { documentRaciRoutes } from './routes.js'
import { notifyRaciAssigned } from './notify-assigned.js'

type Sent = { recipientId: string; kind: string; title: string; body: string; linkPath?: string; payload: Record<string, unknown> }

function makeApp(opts: { withNotifications?: boolean; sendFails?: boolean; doc?: Record<string, unknown> } = {}) {
  const sent: Sent[] = []
  const app = Fastify()
  app.decorate('prisma', {
    document: { findUnique: vi.fn(async () => opts.doc ?? { id: 'DOC-1', title: 'CSR Full', projectId: 'P-1', status: 'in_authoring', assigneeId: 'lead' }) },
    user: { findUnique: vi.fn(async ({ where }: { where: { id: string } }) => ({ id: where.id, name: where.id === 'lead' ? 'Lena Lead' : 'Someone', capabilities: ['can-author', 'can-review', 'can-approve', 'can-qc'], role: 'contributor' })), update: vi.fn() },
    project: { findUnique: vi.fn(async () => ({ status: 'ongoing' })) },
    signatureChain: { findFirst: vi.fn(async () => null) },
    documentRaci: { findFirst: vi.fn(async () => null), findMany: vi.fn(async () => []), create: vi.fn(async (a: { data: Record<string, unknown> }) => ({ id: 'raci-new', ...a.data })) },
  } as never)
  app.decorate('audit', { append: vi.fn(async () => undefined) } as never)
  if (opts.withNotifications !== false) {
    app.decorate('notifications', { send: async (n: Sent) => { if (opts.sendFails) throw new Error('down'); sent.push(n); return n } } as never)
  }
  return { app, sent }
}

describe('notifyRaciAssigned', () => {
  it.each([
    ['R', 'Author',       '/projects/P-1/clinical-writing/documents/DOC-1'],
    ['C', 'Reviewer',     '/projects/P-1/clinical-writing/documents/DOC-1/review'],
    ['Q', 'QC reviewer',  '/projects/P-1/clinical-writing/documents/DOC-1/review'],
    ['I', 'Informed',     '/projects/P-1/clinical-writing/documents/DOC-1'],
  ])('tells a %s they were assigned, with a link to where they work', async (letter, role, link) => {
    const { app, sent } = makeApp()
    await notifyRaciAssigned(app, { recipientId: 'u-x', actorId: 'lead', documentId: 'DOC-1', letter })
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ recipientId: 'u-x', kind: 'document.raci_assigned', linkPath: link })
    expect(sent[0]!.title).toBe(`You've been assigned as ${role} on "CSR Full"`)
    expect(sent[0]!.body).toContain('Assigned by Lena Lead.')
    expect(sent[0]!.payload).toMatchObject({ documentId: 'DOC-1', letter, assignedBy: 'lead', newDocument: false })
  })

  it('gives an Approver no link until the document awaits signature (they cannot open it before)', async () => {
    const early = makeApp()
    await notifyRaciAssigned(early.app, { recipientId: 'u-a', actorId: 'lead', documentId: 'DOC-1', letter: 'A' })
    expect(early.sent[0]!.linkPath).toBeUndefined()
    expect(early.sent[0]!.body).toContain('awaiting signature')

    const late = makeApp({ doc: { id: 'DOC-1', title: 'CSR Full', projectId: 'P-1', status: 'pending_signature' } })
    await notifyRaciAssigned(late.app, { recipientId: 'u-a', actorId: 'lead', documentId: 'DOC-1', letter: 'A' })
    expect(late.sent[0]!.linkPath).toBe('/projects/P-1/clinical-writing/documents/DOC-1/review')
  })

  it('says a new document was assigned when a PM created it for the Author', async () => {
    const { app, sent } = makeApp()
    await notifyRaciAssigned(app, { recipientId: 'u-author', actorId: 'pm', documentId: 'DOC-1', letter: 'R', newDocument: true, doc: { title: 'Protocol', projectId: 'P-1', status: 'not_started' } })
    expect(sent[0]!.title).toBe('New document assigned to you: "Protocol"')
    expect(sent[0]!.body).toContain('You are the Author.')
    expect(sent[0]!.payload).toMatchObject({ newDocument: true })
  })

  it('does not notify the person who made the assignment', async () => {
    const { app, sent } = makeApp()
    await notifyRaciAssigned(app, { recipientId: 'lead', actorId: 'lead', documentId: 'DOC-1', letter: 'C' })
    expect(sent).toHaveLength(0)
  })

  it('does nothing without the notification service, and a failing send never throws', async () => {
    await expect(notifyRaciAssigned(makeApp({ withNotifications: false }).app, { recipientId: 'u-x', actorId: 'lead', documentId: 'DOC-1', letter: 'C' })).resolves.toBeUndefined()
    await expect(notifyRaciAssigned(makeApp({ sendFails: true }).app, { recipientId: 'u-x', actorId: 'lead', documentId: 'DOC-1', letter: 'C' })).resolves.toBeUndefined()
  })
})

describe('POST /documents/:id/raci sends the assignment notification', () => {
  beforeEach(() => { process.env.FEATURE_MODULES_ENABLED = 'A' })

  async function build() {
    const t = makeApp()
    t.app.decorateRequest('user', null)
    t.app.addHook('onRequest', async (req) => {
      const user: AuthenticatedUser = { id: 'lead', email: 'l@x.io', role: 'contributor', modules: ['A'], tenantId: null }
      ;(req as unknown as { user: AuthenticatedUser }).user = user
    })
    await t.app.register(documentRaciRoutes, { prefix: '/documents' })
    await t.app.ready()
    return t
  }

  it('notifies the person assigned', async () => {
    const { app, sent } = await build()
    const res = await app.inject({ method: 'POST', url: '/documents/DOC-1/raci', payload: { userId: 'user-b', letter: 'C' } })
    expect(res.statusCode).toBe(201)
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ recipientId: 'user-b', kind: 'document.raci_assigned' })
  })

  it('does not notify when the author assigns themselves', async () => {
    const { app, sent } = await build()
    const res = await app.inject({ method: 'POST', url: '/documents/DOC-1/raci', payload: { userId: 'lead', letter: 'C' } })
    expect(res.statusCode).toBe(201)
    expect(sent).toHaveLength(0)
  })
})
