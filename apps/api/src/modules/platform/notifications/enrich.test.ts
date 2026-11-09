// GET /notifications/me — each notification says which project and document it is about, and who it came from
// with their role. Worked out from the ids in its payload, so notifications created before this show it too.

import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from '../../../auth/rbac.js'
import { notificationsRoutes } from './routes.js'

const base = { recipientId: 'me', severity: 'info', body: '', linkPath: null, channels: ['in_app'], readAt: null, dismissedAt: null, createdAt: new Date('2026-11-06T07:32:00Z') }

async function build() {
  const rows = [
    { ...base, id: 'n1', kind: 'signature_requested', title: 'Your signature is needed on "CSR Full"', payload: { documentId: 'D1', step: 2 } },
    { ...base, id: 'n2', kind: 'comment.mention', title: 'Raj mentioned you in a comment', payload: { documentId: 'D1', projectId: 'P1', commentId: 'CMT-1' } },
    { ...base, id: 'n3', kind: 'document_nudge', title: 'Nudge: "Protocol" needs your approval', payload: { documentId: 'D2', letter: 'A', nudgedBy: 'u-pm' } },
    { ...base, id: 'n4', kind: 'user.invitation', title: 'You have been invited to ClinWrite', payload: {} },
    { ...base, id: 'n5', kind: 'comment.mention', title: 'Guest mentioned you', payload: { documentId: 'D1', commentId: 'CMT-GUEST' } },
  ]
  const app = Fastify()
  app.decorate('prisma', {
    notification: { findMany: vi.fn(async () => rows) },
    comment: { findMany: vi.fn(async () => [{ id: 'CMT-1', reviewerId: 'u-raj' }, { id: 'CMT-GUEST', reviewerId: 'system:guest' }]) },
    document: { findMany: vi.fn(async () => [
      { id: 'D1', title: 'CSR Full (pm and author)', projectId: 'P1' },
      { id: 'D2', title: 'Protocol', projectId: 'P2' },
    ]) },
    user: { findMany: vi.fn(async () => [
      { id: 'u-raj', name: 'Raj', role: 'contributor' },
      { id: 'u-pm', name: 'Alex Thornton', role: 'pm' },
    ]) },
    project: { findMany: vi.fn(async () => [{ id: 'P1', name: 'Test tuesday' }, { id: 'P2', name: 'Final Project' }]) },
    documentRaci: { findMany: vi.fn(async () => [{ documentId: 'D1', userId: 'u-raj', letter: 'C' }, { documentId: 'D1', userId: 'u-raj', letter: 'I' }]) },
  } as never)
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (r) => {
    const user: AuthenticatedUser = { id: 'me', email: 'm@x', role: 'contributor', modules: ['A'], tenantId: null }
    Object.assign(r, { user })
  })
  await app.register(notificationsRoutes)
  await app.ready()
  return app
}

describe('GET /me — context and sender', () => {
  it('adds the project and document a notification is about, from its payload', async () => {
    const app = await build()
    const list = (await app.inject({ method: 'GET', url: '/me' })).json()
    const byId = Object.fromEntries(list.map((n: { id: string }) => [n.id, n]))
    expect(byId.n1.context).toEqual({ projectId: 'P1', projectName: 'Test tuesday', documentId: 'D1', documentTitle: 'CSR Full (pm and author)' })
    expect(byId.n3.context).toMatchObject({ projectName: 'Final Project', documentTitle: 'Protocol' })
  })

  it('names who a notification came from, with their role on that document', async () => {
    const app = await build()
    const byId = Object.fromEntries((await app.inject({ method: 'GET', url: '/me' })).json().map((n: { id: string }) => [n.id, n]))
    expect(byId.n2.actor).toEqual({ name: 'Raj', role: 'Reviewer / Informed' })          // a mention: the comment's author, by their letters on the document
    expect(byId.n3.actor).toEqual({ name: 'Alex Thornton', role: 'Project Manager' })    // a nudge: no letter on that document, so the app role
  })

  it('leaves context and sender empty when the notification has none, and never fails', async () => {
    const app = await build()
    const byId = Object.fromEntries((await app.inject({ method: 'GET', url: '/me' })).json().map((n: { id: string }) => [n.id, n]))
    expect(byId.n1.actor).toBeNull()                         // no sender recorded on this one
    expect(byId.n4.context).toBeNull()                       // an invitation is not about a document
    expect(byId.n4.actor).toBeNull()
    expect(byId.n5.actor).toBeNull()                         // a guest comment has no account
  })
})
