// While a signature chain is in progress the RACI can't be changed under it: assigning, removing
// someone else and changing signature settings are refused with 409 signature_chain_active. A person
// can still remove their own assignment, and nothing is blocked once the chain is cancelled or complete.

import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from '../../../auth/rbac.js'
import { documentRaciRoutes } from './routes.js'

const DOC_ID = 'doc-1'
const AUTHOR:  AuthenticatedUser = { id: 'u-author',  email: 'a@x.ai', role: 'contributor', capabilities: ['can-author'], modules: ['A'], tenantId: 't' }
const REVIEWER = { id: 'u-reviewer', userId: 'u-reviewer' }

async function buildApp(opts: { chainStatus?: 'in_progress' | 'initiated' | 'complete' | 'cancelled' | null; actor?: AuthenticatedUser }) {
  const actor = opts.actor ?? AUTHOR
  // The active-chain lookup only returns a chain when its status is one of the active ones in the query.
  const chainFindFirst = vi.fn(async ({ where }: { where: { status: { in: string[] } } }) =>
    opts.chainStatus && where.status.in.includes(opts.chainStatus) ? { id: 'chain-1' } : null)
  const raciCreate = vi.fn(async () => ({ id: 'raci-new', documentId: DOC_ID }))
  const raciUpdate = vi.fn(async (a: { where: { id: string }; data: Record<string, unknown> }) => ({ id: a.where.id, documentId: DOC_ID, userId: REVIEWER.userId, ...a.data }))
  const row = { id: 'raci-rev', documentId: DOC_ID, userId: REVIEWER.userId, letter: 'C', removedAt: null,
    submittedAt: null, reviewedAt: null, approvedAt: null, rejectedAt: null, signatureId: null, signatureRequired: false, signatureMeaning: null }
  const app = Fastify()
  app.decorate('prisma', {
    signatureChain: { findFirst: chainFindFirst },
    document: { findUnique: vi.fn(async () => ({ id: DOC_ID, assigneeId: 'u-nobody', status: 'pending_signature' })) },
    user: { findUnique: vi.fn(async ({ where }: { where: { id: string } }) => ({ id: where.id, capabilities: ['can-review'], role: 'contributor' })) },
    documentRaci: {
      // The author is an R on the document; everything else is unassigned.
      findFirst: vi.fn(async ({ where }: { where: { userId: string; letter: string } }) => (where.userId === AUTHOR.id && where.letter === 'R' ? { id: 'raci-author' } : null)),
      findMany: vi.fn(async () => []),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => (where.id === 'raci-rev' ? row : null)),
      create: raciCreate,
      update: raciUpdate,
    },
  } as never)
  app.decorate('audit', { append: vi.fn(async () => undefined) } as never)
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (request) => { (request as unknown as { user: AuthenticatedUser }).user = actor })
  await app.register(documentRaciRoutes, { prefix: '/documents' })
  await app.ready()
  return { app, raciCreate, raciUpdate }
}

let current: FastifyInstance | null = null
afterEach(async () => { await current?.close(); current = null })

const assign = (app: FastifyInstance) => app.inject({ method: 'POST', url: `/documents/${DOC_ID}/raci`, payload: { userId: 'u-new', letter: 'C', signatureRequired: false } as never })
const remove = (app: FastifyInstance) => app.inject({ method: 'DELETE', url: `/documents/${DOC_ID}/raci/raci-rev` })
const sigSetting = (app: FastifyInstance) => app.inject({ method: 'PATCH', url: `/documents/${DOC_ID}/raci/raci-rev/signature`, payload: { signatureRequired: true, signatureMeaning: 'QC release' } as never })

describe('RACI changes while a signature chain is in progress', () => {
  it.each(['in_progress', 'initiated'] as const)('refuses assigning, removing someone else and changing signature settings (chain %s)', async (chainStatus) => {
    const { app, raciCreate, raciUpdate } = await buildApp({ chainStatus })
    current = app
    for (const call of [assign, remove, sigSetting]) {
      const res = await call(app)
      expect(res.statusCode).toBe(409)
      expect(res.json().error).toBe('signature_chain_active')
    }
    expect(raciCreate).not.toHaveBeenCalled()
    expect(raciUpdate).not.toHaveBeenCalled()
  })

  it('allows the same changes when there is no chain, or it is cancelled or complete', async () => {
    for (const chainStatus of [null, 'cancelled', 'complete'] as const) {
      const { app } = await buildApp({ chainStatus })
      expect((await assign(app)).statusCode, String(chainStatus)).toBe(201)
      expect((await sigSetting(app)).statusCode, String(chainStatus)).toBe(200)
      expect((await remove(app)).statusCode, String(chainStatus)).toBe(204)
      await app.close()
    }
  })

  it('still lets a person remove their own assignment during a chain', async () => {
    const reviewer: AuthenticatedUser = { id: REVIEWER.userId, email: 'r@x.ai', role: 'contributor', capabilities: ['can-review'], modules: ['A'], tenantId: 't' }
    const { app, raciUpdate } = await buildApp({ chainStatus: 'in_progress', actor: reviewer })
    current = app
    const res = await remove(app)
    expect(res.statusCode).toBe(204)
    expect(raciUpdate).toHaveBeenCalledOnce()
  })

  it('the can-edit probe reports the chain, so the editor can say why changes are refused', async () => {
    for (const [chainStatus, chainActive] of [['in_progress', true], ['initiated', true], ['complete', false], [null, false]] as const) {
      const { app } = await buildApp({ chainStatus })
      const res = await app.inject({ method: 'GET', url: `/documents/${DOC_ID}/raci/can-edit` })
      expect(res.json(), String(chainStatus)).toEqual({ canEdit: true, chainActive })
      await app.close()
    }
  })
})
