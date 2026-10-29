// Document RACI write-gate: §5a says only an R on the document (or an
// admin) can assign / remove RACI. Exercised through Fastify inject()
// with a fake Prisma + audit.
//
// Four branches covered:
//   - tenant-admin → allowed
//   - R-on-doc (has an active document_raci row with letter='R') → allowed
//   - Document.assigneeId (bootstrap, no R row yet) → allowed
//   - plain contributor with no R, not assignee → 403

import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from '../../../auth/rbac.js'
import { documentRaciRoutes } from './routes.js'

const DOC_ID = 'doc-1'
const USER_ADMIN:        AuthenticatedUser = { id: 'u-admin',       email: 'a@x.ai',     role: 'tenant-admin',  capabilities: [],                      modules: [], tenantId: null }
const USER_LEAD_R:       AuthenticatedUser = { id: 'u-lead-r',      email: 'r@x.ai',     role: 'contributor',   capabilities: ['can-author'],          modules: ['A'], tenantId: 't' }
const USER_ASSIGNEE:     AuthenticatedUser = { id: 'u-assignee',    email: 'as@x.ai',    role: 'contributor',   capabilities: ['can-author'],          modules: ['A'], tenantId: 't' }
const USER_OUTSIDER:     AuthenticatedUser = { id: 'u-outsider',    email: 'o@x.ai',     role: 'contributor',   capabilities: ['can-author','can-review'], modules: ['A'], tenantId: 't' }
const USER_SUBJECT:      AuthenticatedUser = { id: 'u-subject',     email: 'sub@x.ai',   role: 'contributor',   capabilities: ['can-review'],          modules: ['A'], tenantId: 't' }

interface AppOpts {
  actor: AuthenticatedUser
  /** Pre-existing active R row on the doc (whose userId it belongs to). */
  existingR?: { id: string; userId: string }
  /** Who Document.assigneeId points to. */
  assigneeId?: string
}

async function buildApp(opts: AppOpts) {
  const createdRow = { id: 'raci-new', documentId: DOC_ID }
  const documentFindUnique = vi.fn(async () => ({ id: DOC_ID, assigneeId: opts.assigneeId ?? 'u-nobody', status: 'in_authoring' }))
  const userFindUnique = vi.fn(async ({ where }: { where: { id: string } }) => ({
    id: where.id, capabilities: ['can-review'], role: 'contributor',
  }))
  const raciFindFirst = vi.fn(async ({ where }: { where: { documentId: string; userId: string; letter: string; removedAt: null | undefined } }) => {
    if (opts.existingR && opts.existingR.userId === where.userId && where.letter === 'R') {
      return { id: opts.existingR.id }
    }
    return null
  })
  const raciFindMany = vi.fn(async () => [] as unknown[])
  const raciCreate = vi.fn(async () => createdRow)

  const app = Fastify()
  app.decorate('prisma', {
    document: { findUnique: documentFindUnique },
    user: { findUnique: userFindUnique },
    documentRaci: {
      findFirst: raciFindFirst,
      findMany: raciFindMany,
      create: raciCreate,
      findUnique: vi.fn(async () => null),
      update: vi.fn(async () => null),
    },
  } as never)
  app.decorate('audit', { append: vi.fn(async () => undefined) } as never)
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (request) => {
    (request as unknown as { user: AuthenticatedUser }).user = opts.actor
  })
  await app.register(documentRaciRoutes, { prefix: '/documents' })
  await app.ready()
  return { app, raciCreate }
}

let current: FastifyInstance | null = null
afterEach(async () => {
  await current?.close()
  current = null
})

const validBody = {
  userId: USER_SUBJECT.id,
  letter: 'C' as const,
  signatureRequired: false,
}

describe('POST /documents/:id/raci — write gate (§5a)', () => {
  it('tenant-admin is allowed', async () => {
    const { app, raciCreate } = await buildApp({ actor: USER_ADMIN })
    current = app
    const res = await app.inject({ method: 'POST', url: `/documents/${DOC_ID}/raci`, payload: validBody as never })
    expect(res.statusCode).toBe(201)
    expect(raciCreate).toHaveBeenCalledOnce()
  })

  it('an existing R on the doc is allowed', async () => {
    const { app, raciCreate } = await buildApp({
      actor: USER_LEAD_R,
      existingR: { id: 'raci-lead', userId: USER_LEAD_R.id },
    })
    current = app
    const res = await app.inject({ method: 'POST', url: `/documents/${DOC_ID}/raci`, payload: validBody as never })
    expect(res.statusCode).toBe(201)
    expect(raciCreate).toHaveBeenCalledOnce()
  })

  it('the Document.assigneeId user is allowed (bootstrap path)', async () => {
    const { app, raciCreate } = await buildApp({
      actor: USER_ASSIGNEE,
      assigneeId: USER_ASSIGNEE.id,
    })
    current = app
    const res = await app.inject({ method: 'POST', url: `/documents/${DOC_ID}/raci`, payload: validBody as never })
    expect(res.statusCode).toBe(201)
    expect(raciCreate).toHaveBeenCalledOnce()
  })

  it('a plain contributor with no R + not assignee is forbidden', async () => {
    const { app, raciCreate } = await buildApp({
      actor: USER_OUTSIDER,
      assigneeId: 'someone-else',
    })
    current = app
    const res = await app.inject({ method: 'POST', url: `/documents/${DOC_ID}/raci`, payload: validBody as never })
    expect(res.statusCode).toBe(403)
    expect(JSON.parse(res.body).error).toBe('raci_edit_forbidden')
    expect(raciCreate).not.toHaveBeenCalled()
  })
})
