// Comments routes via Fastify inject() against a fake Prisma: resolve rules
// (3 resolution types, mandatory note, 409/404), validation, audit entry and the
// reviewer name/initials shaping. (CMT id allocation is covered in routes.test.ts.)

import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from '../../../auth/rbac.js'
import { commentsRoutes } from './routes.js'

const body = { sectionRef: '§11.4.1', text: 'Please add the 95% CI.', severity: 'major' }

async function build(opts: { maxSeq?: number | null; docExists?: boolean; failCreates?: number; existing?: Record<string, unknown> | null } = {}) {
  let failures = opts.failCreates ?? 0
  const findMany = vi.fn(async () => (opts.maxSeq ? [{ id: `CMT-${String(opts.maxSeq).padStart(3, '0')}` }] : []))
  const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
    if (failures-- > 0) { opts.maxSeq = (opts.maxSeq ?? 0) + 1; throw Object.assign(new Error('Unique constraint'), { code: 'P2002' }) }
    return { ...data, status: 'open', createdAt: new Date() }
  })
  const append = vi.fn(async () => ({}))
  const app = Fastify()
  app.decorate('prisma', {
    document: { findUnique: vi.fn(async () => (opts.docExists === false ? null : { id: 'doc-b' })) },
    comment: {
      create,
      findMany,
      findFirst: vi.fn(async () => (opts.existing === undefined ? { id: 'CMT-001', documentId: 'doc-b', sectionRef: '§11.4.1', status: 'open', reviewerId: 'user-jo' } : opts.existing)),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'CMT-001', documentId: 'doc-b', reviewerId: 'user-jo', createdAt: new Date(), ...data })),
    },
    user: { findUnique: vi.fn(async () => ({ name: 'Dr. Elena Vasquez', initials: 'EV' })) },
  } as never)
  app.decorate('audit', { append } as never)
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (r) => {
    const user: AuthenticatedUser = { id: 'user-ev', email: 'e@v', role: 'admin', modules: ['A'], tenantId: null }
    Object.assign(r, { user })
  })
  await app.register(commentsRoutes, { prefix: '/documents' })
  await app.ready()
  return { app, create, append }
}

let current: FastifyInstance | null = null
afterEach(async () => { await current?.close(); current = null })
const setup = async (o: Parameters<typeof build>[0] = {}) => { const b = await build(o); current = b.app; return b }
const post = (app: FastifyInstance, payload: object = body, doc = 'doc-b') =>
  app.inject({ method: 'POST', url: `/documents/${doc}/comments`, payload })

describe('POST /documents/:id/comments', () => {
  it('writes an audit entry and shapes the reviewer name/initials', async () => {
    const { app, append } = await setup({ maxSeq: 0 })
    const res = (await post(app)).json()
    expect(res).toMatchObject({ reviewerName: 'Dr. Elena Vasquez', reviewerInitials: 'EV', age: 'just now' })
    expect(append).toHaveBeenCalledWith(expect.objectContaining({ action: 'comment_added', entityType: 'document', entityId: 'doc-b' }))
  })

  it('404s for an unknown document and 400s for an empty comment', async () => {
    expect((await post((await setup({ docExists: false })).app)).statusCode).toBe(404)
    await current?.close()
    const { app } = await setup()
    expect((await post(app, { ...body, text: '' })).statusCode).toBe(400)
  })

  it('allows an empty text for a bare verdict', async () => {
    const { app, append } = await setup()
    const res = await post(app, { sectionRef: '§11.4.1', text: '', severity: 'query', verdict: 'approve' })
    expect(res.statusCode).toBe(201)
    expect(append).toHaveBeenCalledWith(expect.objectContaining({ action: 'reviewer_approve' }))
  })
})


describe('PATCH /documents/:id/comments/:commentId/resolve', () => {
  const resolve = (app: FastifyInstance, payload: object) =>
    app.inject({ method: 'PATCH', url: '/documents/doc-b/comments/CMT-001/resolve', payload })

  it.each(['accept', 'accept_with_modification', 'reject'])('resolves with %s, records who/when/why and audits it', async (resolutionType) => {
    const { app, append } = await setup()
    const res = await resolve(app, { resolutionType, note: 'Table added to §9.1.' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ status: 'resolved', resolvedBy: 'user-ev', resolutionNote: `[${resolutionType}] Table added to §9.1.` })
    expect(append).toHaveBeenCalledWith(expect.objectContaining({
      action: 'comment_resolved', entityType: 'document', entityId: 'doc-b',
      details: expect.objectContaining({ commentId: 'CMT-001', resolutionType }),
    }))
  })

  it('reports who last edited the comment (the resolver) and when; untouched comments report null', async () => {
    const { app } = await setup()
    const resolved = (await resolve(app, { resolutionType: 'accept', note: 'Done.' })).json()
    expect(resolved).toMatchObject({ lastEditedByName: 'Dr. Elena Vasquez', lastEditedAge: 'just now' })
    expect(resolved.lastEditedAt).toBeTruthy()
    await current?.close()
    const fresh = await setup({ maxSeq: 0 })
    expect((await post(fresh.app)).json()).toMatchObject({ lastEditedAt: null, lastEditedByName: null, lastEditedAge: null })
  })

  it('refuses a resolution without a note, or with the hyphenated type the API does not accept', async () => {
    const { app } = await setup()
    expect((await resolve(app, { resolutionType: 'accept', note: '' })).statusCode).toBe(400)
    expect((await resolve(app, { resolutionType: 'accept-with-modification', note: 'x' })).statusCode).toBe(400)
  })

  it('409s on an already-resolved comment and 404s on an unknown one', async () => {
    const resolved = await setup({ existing: { id: 'CMT-001', documentId: 'doc-b', status: 'resolved', reviewerId: 'u' } })
    expect((await resolve(resolved.app, { resolutionType: 'accept', note: 'x' })).statusCode).toBe(409)
    await current?.close()
    const missing = await setup({ existing: null })
    expect((await resolve(missing.app, { resolutionType: 'accept', note: 'x' })).statusCode).toBe(404)
  })
})
