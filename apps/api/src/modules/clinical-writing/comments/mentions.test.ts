// @mentions in comments: the mentionable list, and notifying the people mentioned.

import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from '../../../auth/rbac.js'
import { commentsRoutes } from './routes.js'

async function build(opts: { sendFails?: boolean } = {}) {
  const send = vi.fn(async () => { if (opts.sendFails) throw new Error('queue down'); return {} })
  const append = vi.fn(async () => undefined)
  const app = Fastify()
  app.decorate('prisma', {
    document: { findUnique: vi.fn(async ({ where }: { where: { id: string } }) => ({ id: where.id, projectId: 'p1', title: 'DSUR Year 2' })) },
    // An open project: comments are refused on a closed one (projects/closed.ts).
    project: { findUnique: vi.fn(async () => ({ status: 'ongoing' })) },
    comment: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...data, status: 'open', createdAt: new Date(), resolvedBy: null, resolvedAt: null, resolutionNote: null })),
      findMany: vi.fn(async () => []),
    },
    // The caller is the document's Reviewer (C), so the comment gate lets them in.
    documentRaci: { findFirst: vi.fn(async () => ({ id: 'raci-c' })), findMany: vi.fn(async () => [{ userId: 'u-raci' }]) },
    projectMember: { findMany: vi.fn(async () => [{ userId: 'u-sheetal', projectRole: 'Medical Reviewer' }, { userId: 'user-rev', projectRole: null }]) },
    user: {
      findUnique: vi.fn(async () => ({ name: 'Alex Thornton', initials: 'AT' })),
      // Only active users reach the list: the query filters on status.
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] }; status: string } }) =>
        [{ id: 'u-raci', name: 'Raj', initials: 'RJ' }, { id: 'u-sheetal', name: 'Sheetal', initials: 'SH' }]
          .filter(u => where.id.in.includes(u.id) && where.status === 'active')),
    },
  } as never)
  app.decorate('audit', { append } as never)
  app.decorate('notifications', { send } as never)
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (request) => {
    const user: AuthenticatedUser = { id: 'user-rev', email: 'r@clinwrite.ai', role: 'reviewer', modules: ['A'], tenantId: null }
    ;(request as unknown as { user: AuthenticatedUser }).user = user
  })
  await app.register(commentsRoutes, { prefix: '/documents' })
  await app.ready()
  return { app, send, append }
}

const body = (over: Record<string, unknown> = {}) => ({ sectionRef: '§11.4', text: '@Sheetal please check the PFS wording', severity: 'major', ...over })

describe('GET /documents/:id/comments/mentionable', () => {
  it('lists the project\'s people without the person writing, by name', async () => {
    const { app } = await build()
    const res = await app.inject({ method: 'GET', url: '/documents/d1/comments/mentionable' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual([
      { id: 'u-raci', name: 'Raj', initials: 'RJ', projectRole: null },
      { id: 'u-sheetal', name: 'Sheetal', initials: 'SH', projectRole: 'Medical Reviewer' },
    ])
  })
})

describe('POST /documents/:id/comments — mentions', () => {
  it('notifies each mentioned person in-app with a link to the document', async () => {
    const { app, send, append } = await build()
    const res = await app.inject({ method: 'POST', url: '/documents/d1/comments', payload: body({ mentionedUserIds: ['u-sheetal'] }) })
    expect(res.statusCode).toBe(201)
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      recipientId: 'u-sheetal', kind: 'comment.mention', title: 'Alex Thornton mentioned you in a comment',
      linkPath: '/projects/p1/clinical-writing/documents/d1',
      payload: expect.objectContaining({ documentId: 'd1', commentId: res.json().id, sectionRef: '§11.4' }),
    }))
    expect((send.mock.calls[0] as unknown[])[0]).toMatchObject({ body: expect.stringContaining('DSUR Year 2 · §11.4: @Sheetal please check') })
    expect(append).toHaveBeenCalledWith(expect.objectContaining({ details: expect.objectContaining({ mentionedUserIds: ['u-sheetal'] }) }))
  })

  it('ignores yourself, repeats and people who are not in the project', async () => {
    const { app, send } = await build()
    const res = await app.inject({ method: 'POST', url: '/documents/d1/comments', payload: body({ mentionedUserIds: ['user-rev', 'u-sheetal', 'u-sheetal', 'stranger'] }) })
    expect(res.statusCode).toBe(201)
    expect(send).toHaveBeenCalledTimes(1)
    expect((send.mock.calls[0] as unknown[])[0]).toMatchObject({ recipientId: 'u-sheetal' })
  })

  it('sends nothing when nobody is mentioned', async () => {
    const { app, send } = await build()
    expect((await app.inject({ method: 'POST', url: '/documents/d1/comments', payload: body() })).statusCode).toBe(201)
    expect(send).not.toHaveBeenCalled()
  })

  it('still saves the comment when a notification cannot be sent', async () => {
    const { app } = await build({ sendFails: true })
    const res = await app.inject({ method: 'POST', url: '/documents/d1/comments', payload: body({ mentionedUserIds: ['u-sheetal'] }) })
    expect(res.statusCode).toBe(201)
    expect(res.json().text).toContain('@Sheetal')
  })
})
