// POST /documents/:id/transition must not mark a document Signed unless its
// e-signature chain is complete (AC-A-045 / AC-A-046) — the last signature
// sets Signed; a bare status change cannot.

import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from '../../../auth/rbac.js'
import { documentsRoutes } from './routes.js'

const DOC = 'DOC-1'

async function build(opts: { completeChain: boolean; role?: string; letters?: string[] }) {
  const update = vi.fn(async () => ({ id: DOC, status: 'signed' }))
  const app = Fastify()
  app.decorate('prisma', {
    project: { findUnique: async () => ({ status: 'ongoing' }) },
    document: {
      count: async () => 1,
      findUnique: vi.fn(async () => ({ id: DOC, projectId: 'p1', status: 'pending_signature', stage: 'final_output' })),
      update,
    },
    // The caller holds whichever letters the test gives them (an Approver by default: only A may mark signed).
    documentRaci: {
      findMany: vi.fn(async () => (opts.letters ?? ['A']).map(letter => ({ letter }))),
      findFirst: vi.fn(async ({ where }: { where: { letter: { in: string[] } } }) => ((opts.letters ?? ['A']).some(l => where.letter.in.includes(l)) ? { id: 'raci' } : null)),
    },
    signatureChain: { findFirst: vi.fn(async () => (opts.completeChain ? { id: 'chain-1' } : null)) },
  } as never)
  app.decorate('audit', { append: vi.fn() } as never)
  app.decorate('aiGateway', { chat: vi.fn() } as never)
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (req) => {
    const user: AuthenticatedUser = { id: 'u1', email: 'u@x.io', role: opts.role ?? 'contributor', modules: ['A'], tenantId: null }
    ;(req as unknown as { user: AuthenticatedUser }).user = user
  })
  await app.register(documentsRoutes, { prefix: '/documents' })
  await app.ready()
  return { app, update }
}

describe('POST /documents/:id/transition — who may (CW-006)', () => {
  const go = (app: Awaited<ReturnType<typeof build>>['app'], to: string) =>
    app.inject({ method: 'POST', url: `/documents/${DOC}/transition`, payload: { to } })

  it('refuses admins, PMs, auditors and people with no matching letter, and changes nothing', async () => {
    for (const [opts, error] of [
      [{ role: 'admin' }, 'transition_forbidden'], [{ role: 'pm' }, 'transition_forbidden'], [{ role: 'auditor' }, 'auditor_read_only'],
      [{ role: 'contributor', letters: ['R'] }, 'transition_forbidden'], [{ role: 'contributor', letters: ['I'] }, 'informed_read_only'],
    ] as const) {
      const { app, update } = await build({ completeChain: true, ...opts })
      const res = await go(app, 'signed')
      expect(res.statusCode).toBe(403)
      expect(res.json().error).toBe(error)
      if (error === 'transition_forbidden') expect(res.json().message).toMatch(/Approver \(A\)/)
      expect(update).not.toHaveBeenCalled()
      await app.close()
    }
  })

  it('returning to authoring is for A, C or Q; an Author cannot bounce their own document', async () => {
    for (const letters of [['A'], ['C'], ['Q']]) {
      const { app } = await build({ completeChain: false, letters })
      // Past the role gate (the bounce itself needs more of the database than this stub has).
      expect((await go(app, 'in_authoring')).statusCode).not.toBe(403)
      await app.close()
    }
    const { app, update } = await build({ completeChain: false, letters: ['R'] })
    expect((await go(app, 'in_authoring')).statusCode).toBe(403)
    expect(update).not.toHaveBeenCalled()
  })
})

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
