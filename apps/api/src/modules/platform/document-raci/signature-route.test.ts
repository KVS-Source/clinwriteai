// PATCH /documents/:id/raci/:raciId/signature — changes a row's e-signature
// requirement in place. It used to be remove + re-assign from the client,
// which deleted the assignment whenever the re-assign was refused.

import Fastify from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from '../../../auth/rbac.js'
import { documentRaciRoutes } from './routes.js'

type Row = Record<string, unknown>

async function build(row: Row | null, actorRole: AuthenticatedUser['role'] = 'tenant-admin') {
  const updates: Row[] = []
  const app = Fastify()
  app.decorate('prisma', {
    document:     { findUnique: vi.fn(async () => ({ id: 'DOC-1', assigneeId: 'someone-else' })) },
    documentRaci: {
      findUnique: vi.fn(async () => row),
      findFirst:  vi.fn(async () => null),
      update:     vi.fn(async (args: { data: Row }) => { updates.push(args.data); return { ...row, ...args.data } }),
    },
  } as never)
  const append = vi.fn(async (_e: { action: string; details: Row }) => undefined)
  app.decorate('audit', { append } as never)
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (req) => {
    const user: AuthenticatedUser = { id: 'actor', email: 'a@x.io', role: actorRole, modules: ['A'], tenantId: null }
    ;(req as unknown as { user: AuthenticatedUser }).user = user
  })
  await app.register(documentRaciRoutes, { prefix: '/documents' })
  await app.ready()
  return { app, updates, append }
}

const ACTIVE: Row = {
  id: 'raci-1', documentId: 'DOC-1', userId: 'user-cl', letter: 'R', sectionId: null,
  signatureRequired: false, signatureMeaning: null,
  removedAt: null, submittedAt: null, reviewedAt: null, approvedAt: null, rejectedAt: null, signatureId: null,
}

const patch = (app: Awaited<ReturnType<typeof build>>['app'], body: unknown) =>
  app.inject({ method: 'PATCH', url: '/documents/DOC-1/raci/raci-1/signature', payload: body as never })

beforeEach(() => { process.env.FEATURE_MODULES_ENABLED = 'A' })

describe('PATCH …/raci/:raciId/signature', () => {
  it('turns the requirement on in place and audits before/after', async () => {
    const { app, updates, append } = await build(ACTIVE)
    const res = await patch(app, { signatureRequired: true, signatureMeaning: 'Author attestation' })
    expect(res.statusCode).toBe(200)
    expect(updates[0]).toEqual({ signatureRequired: true, signatureMeaning: 'Author attestation' })
    const event = append.mock.calls[0]![0]
    expect(event.action).toBe('document_raci.signature_changed')
    expect(event.details).toMatchObject({ before: { signatureRequired: false }, after: { signatureRequired: true, signatureMeaning: 'Author attestation' } })
  })

  it('turning it off clears the meaning', async () => {
    const { app, updates } = await build({ ...ACTIVE, signatureRequired: true, signatureMeaning: 'Author attestation' })
    expect((await patch(app, { signatureRequired: false, signatureMeaning: 'Author attestation' })).statusCode).toBe(200)
    expect(updates[0]).toEqual({ signatureRequired: false, signatureMeaning: null })
  })

  it('needs a meaning when turning it on', async () => {
    const { app, updates } = await build(ACTIVE)
    expect((await patch(app, { signatureRequired: true })).statusCode).toBe(400)
    expect(updates).toHaveLength(0)
  })

  it('refuses removed or already-completed rows', async () => {
    expect((await patch((await build({ ...ACTIVE, removedAt: new Date() })).app, { signatureRequired: false })).json().error).toBe('row_removed')
    expect((await patch((await build({ ...ACTIVE, submittedAt: new Date() })).app, { signatureRequired: false })).json().error).toBe('row_completed')
  })

  it('403 for someone who is not R on the document or an admin', async () => {
    const { app, updates } = await build(ACTIVE, 'contributor')
    expect((await patch(app, { signatureRequired: true, signatureMeaning: 'Author attestation' })).statusCode).toBe(403)
    expect(updates).toHaveLength(0)
  })
})
