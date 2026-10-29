// Guest invitation routes — focused on the write-gate decisions.
//   doc-scoped POST  → R-on-doc or admin
//   proj-scoped POST → admin only

import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from '../../../auth/rbac.js'
import { guestInvitationRoutes } from './routes.js'

const DOC_ID  = 'd-1'
const PROJ_ID = 'p-1'

const ADMIN:    AuthenticatedUser = { id: 'u-admin',    email: 'a@x.ai',  role: 'tenant-admin', capabilities: [],              modules: [],    tenantId: null }
const LEAD_R:   AuthenticatedUser = { id: 'u-r',        email: 'r@x.ai',  role: 'contributor',  capabilities: ['can-author'],  modules: ['A'], tenantId: 't' }
const OUTSIDER: AuthenticatedUser = { id: 'u-out',      email: 'o@x.ai',  role: 'contributor',  capabilities: ['can-review'],  modules: ['A'], tenantId: 't' }

async function buildApp(opts: {
  actor: AuthenticatedUser
  assigneeIsActor?: boolean
  rRowForActor?: boolean
  docExists?: boolean
  projExists?: boolean
}) {
  const captured: { token?: string } = {}
  const inviteCreate = vi.fn(async (args: { data: Record<string, unknown> }) => ({
    id: 'inv-1',
    scope: args.data.scope,
    documentId: args.data.documentId ?? null,
    projectId: args.data.projectId ?? null,
    email: args.data.email,
    purpose: args.data.purpose,
    invitedBy: args.data.invitedBy,
    invitedAt: new Date(),
    expiresAt: args.data.expiresAt,
    revokedAt: null,
    jwtText: '',
  }))
  const inviteUpdate = vi.fn(async ({ data }: { data: { jwtText: string } }) => {
    captured.token = data.jwtText
    return {
      id: 'inv-1',
      scope: 'document',
      documentId: DOC_ID,
      projectId: null,
      email: 'kol@example.com',
      purpose: 'kol-review',
      invitedBy: opts.actor.id,
      invitedAt: new Date(),
      expiresAt: new Date(Date.now() + 14 * 86400_000),
      revokedAt: null,
      jwtText: data.jwtText,
    }
  })

  const app = Fastify()
  app.decorate('prisma', {
    document: {
      findUnique: vi.fn(async () => (opts.docExists === false
        ? null
        : { id: DOC_ID, assigneeId: opts.assigneeIsActor ? opts.actor.id : 'other-user' })),
    },
    project: {
      findUnique: vi.fn(async () => (opts.projExists === false ? null : { id: PROJ_ID })),
    },
    documentRaci: {
      findFirst: vi.fn(async () => (opts.rRowForActor ? { id: 'raci-1' } : null)),
    },
    guestInvitation: {
      create: inviteCreate,
      update: inviteUpdate,
    },
  } as never)
  app.decorate('audit', { append: vi.fn(async () => undefined) } as never)
  app.decorate('jwt', { sign: vi.fn(async () => 'FAKE.JWT.TOKEN') } as never)
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (request) => {
    (request as unknown as { user: AuthenticatedUser }).user = opts.actor
  })
  await app.register(guestInvitationRoutes)
  await app.ready()
  return { app, inviteCreate, captured }
}

let current: FastifyInstance | null = null
afterEach(async () => {
  await current?.close()
  current = null
})

describe('POST /documents/:id/guest-invitations — doc-scoped invite', () => {
  const payload = { email: 'kol@example.com', purpose: 'kol-review' }

  it('tenant-admin can invite (no R on doc needed)', async () => {
    const { app, inviteCreate } = await buildApp({ actor: ADMIN })
    current = app
    const res = await app.inject({ method: 'POST', url: `/documents/${DOC_ID}/guest-invitations`, payload: payload as never })
    expect(res.statusCode).toBe(201)
    expect(JSON.parse(res.body).token).toBe('FAKE.JWT.TOKEN')
    expect(inviteCreate).toHaveBeenCalledOnce()
  })

  it('a lead R on the doc can invite', async () => {
    const { app, inviteCreate } = await buildApp({ actor: LEAD_R, rRowForActor: true })
    current = app
    const res = await app.inject({ method: 'POST', url: `/documents/${DOC_ID}/guest-invitations`, payload: payload as never })
    expect(res.statusCode).toBe(201)
    expect(inviteCreate).toHaveBeenCalledOnce()
  })

  it('the Document.assigneeId user can invite (bootstrap path)', async () => {
    const { app, inviteCreate } = await buildApp({ actor: LEAD_R, assigneeIsActor: true })
    current = app
    const res = await app.inject({ method: 'POST', url: `/documents/${DOC_ID}/guest-invitations`, payload: payload as never })
    expect(res.statusCode).toBe(201)
    expect(inviteCreate).toHaveBeenCalledOnce()
  })

  it('an outsider contributor is 403', async () => {
    const { app, inviteCreate } = await buildApp({ actor: OUTSIDER })
    current = app
    const res = await app.inject({ method: 'POST', url: `/documents/${DOC_ID}/guest-invitations`, payload: payload as never })
    expect(res.statusCode).toBe(403)
    expect(JSON.parse(res.body).error).toBe('guest_invite_forbidden')
    expect(inviteCreate).not.toHaveBeenCalled()
  })

  it('returns the full token in the response body (POST only)', async () => {
    const { app } = await buildApp({ actor: ADMIN })
    current = app
    const res = await app.inject({ method: 'POST', url: `/documents/${DOC_ID}/guest-invitations`, payload: payload as never })
    const body = JSON.parse(res.body)
    expect(body.token).toBe('FAKE.JWT.TOKEN')
    expect(body.tokenPreview).toBe('FAKE.JWT.TOK…')
  })
})

describe('POST /projects/:id/guest-invitations — project-scoped invite', () => {
  const payload = { email: 'auditor@soc2.firm', purpose: 'external-audit' }

  it('admin can invite', async () => {
    const { app, inviteCreate } = await buildApp({ actor: ADMIN })
    current = app
    const res = await app.inject({ method: 'POST', url: `/projects/${PROJ_ID}/guest-invitations`, payload: payload as never })
    expect(res.statusCode).toBe(201)
    expect(inviteCreate).toHaveBeenCalledOnce()
  })

  it('a non-admin contributor is 403 (requireAuth({roles:["admin"]}))', async () => {
    const { app, inviteCreate } = await buildApp({ actor: LEAD_R })
    current = app
    const res = await app.inject({ method: 'POST', url: `/projects/${PROJ_ID}/guest-invitations`, payload: payload as never })
    expect(res.statusCode).toBe(403)
    expect(inviteCreate).not.toHaveBeenCalled()
  })
})
