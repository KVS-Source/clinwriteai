// POST /documents/:id/transition must not mark a document Signed unless its
// e-signature chain is complete (AC-A-045 / AC-A-046) — the last signature
// sets Signed; a bare status change cannot.

import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from '../../../auth/rbac.js'
import { documentsRoutes } from './routes.js'

const DOC = 'DOC-1'

async function build(opts: { completeChain: boolean }) {
  const update = vi.fn(async () => ({ id: DOC, status: 'signed' }))
  const app = Fastify()
  app.decorate('prisma', {
    document: {
      findUnique: vi.fn(async () => ({ id: DOC, projectId: 'p1', status: 'pending_signature', stage: 'final_output' })),
      update,
    },
    signatureChain: { findFirst: vi.fn(async () => (opts.completeChain ? { id: 'chain-1' } : null)) },
  } as never)
  app.decorate('audit', { append: vi.fn() } as never)
  app.decorate('aiGateway', { chat: vi.fn() } as never)
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (req) => {
    const user: AuthenticatedUser = { id: 'u1', email: 'u@x.io', role: 'admin', modules: ['A'], tenantId: null }
    ;(req as unknown as { user: AuthenticatedUser }).user = user
  })
  await app.register(documentsRoutes, { prefix: '/documents' })
  await app.ready()
  return { app, update }
}

describe('POST /documents/:id/transition → signed', () => {
  it('409 signature_chain_incomplete, and the status is not changed, without a completed chain', async () => {
    const { app, update } = await build({ completeChain: false })
    const res = await app.inject({ method: 'POST', url: `/documents/${DOC}/transition`, payload: { to: 'signed' } })
    expect(res.statusCode).toBe(409)
    expect(res.json()).toMatchObject({ error: 'signature_chain_incomplete' })
    expect(update).not.toHaveBeenCalled()
  })

  it('lets the status through when the chain is complete', async () => {
    const { app, update } = await build({ completeChain: true })
    await app.inject({ method: 'POST', url: `/documents/${DOC}/transition`, payload: { to: 'signed' } })
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'signed' } }))
  })
})
