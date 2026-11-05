// An auditor is read-only across Clinical Writing. Rather than sample a few routes, this registers
// every Clinical Writing plugin, collects each write route they declare, and calls them all as an
// auditor: the guard must answer before any handler runs, so the database stub has no methods at all.

import Fastify, { type FastifyInstance } from 'fastify'
import { describe, expect, it } from 'vitest'
import { AUDITOR_READ_ONLY, requireAuth, type AuthenticatedUser, type Role } from './rbac.js'
import { documentsProjectScopedRoutes, documentsRoutes } from '../modules/clinical-writing/documents/routes.js'
import { documentsUploadRoutes } from '../modules/clinical-writing/documents/upload-routes.js'
import { documentsSourceRoutes } from '../modules/clinical-writing/documents/source-routes.js'
import { documentsReferencesRoutes } from '../modules/clinical-writing/documents/references-routes.js'
import { documentTemplatesRoutes } from '../modules/clinical-writing/document-templates/routes.js'
import { voiceNotesRoutes } from '../modules/clinical-writing/voice-notes/routes.js'
import { presenceRoutes } from '../modules/clinical-writing/presence/routes.js'
import { sectionLockRoutes } from '../modules/clinical-writing/section-locks/routes.js'
import { checklistRoutes, checklistTemplateAdminRoutes, projectChecklistRoutes } from '../modules/clinical-writing/checklist/routes.js'
import { checklistRActionRoutes } from '../modules/clinical-writing/checklist/r-actions.js'
import { commentsRoutes, projectCommentsRoutes } from '../modules/clinical-writing/comments/routes.js'
import { crmRoutes } from '../modules/clinical-writing/crm/routes.js'
import { tlfRoutes } from '../modules/clinical-writing/tlf/routes.js'
import { ichE3Routes } from '../modules/clinical-writing/ich-e3/routes.js'
import { signatureRoutes } from '../modules/clinical-writing/signatures/routes.js'
import { documentRaciRoutes } from '../modules/platform/document-raci/routes.js'
import { guestInvitationRoutes } from '../modules/platform/guest-invitations/routes.js'

type Route = { method: string; url: string }

async function buildAll(role: Role) {
  const routes: Route[] = []
  const app = Fastify()
  app.addHook('onRoute', (r) => {
    for (const method of [r.method].flat()) routes.push({ method: String(method), url: r.url })
  })
  // No methods: reaching a handler fails loudly instead of quietly writing.
  app.decorate('prisma', {} as never)
  app.decorate('audit', {} as never)
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (req) => {
    const user: AuthenticatedUser = { id: 'u-aud', email: 'a@x', role, modules: ['A'], tenantId: null }
    ;(req as unknown as { user: AuthenticatedUser }).user = user
  })
  await app.register(documentsProjectScopedRoutes, { prefix: '/projects' })
  await app.register(documentsRoutes, { prefix: '/documents' })
  await app.register(documentTemplatesRoutes, { prefix: '/document-templates' })
  await app.register(documentsUploadRoutes, { prefix: '/projects' })
  await app.register(documentsSourceRoutes, { prefix: '/projects' })
  await app.register(documentsReferencesRoutes, { prefix: '/documents' })
  await app.register(voiceNotesRoutes, { prefix: '/documents' })
  await app.register(presenceRoutes, { prefix: '/documents' })
  await app.register(sectionLockRoutes, { prefix: '/documents' })
  await app.register(checklistRoutes, { prefix: '/documents' })
  await app.register(checklistRActionRoutes, { prefix: '/documents' })
  await app.register(projectChecklistRoutes, { prefix: '/projects' })
  await app.register(checklistTemplateAdminRoutes, { prefix: '/checklist-templates' })
  await app.register(commentsRoutes, { prefix: '/documents' })
  await app.register(projectCommentsRoutes, { prefix: '/projects' })
  await app.register(crmRoutes)
  await app.register(tlfRoutes)
  await app.register(ichE3Routes, { prefix: '/documents' })
  await app.register(signatureRoutes)
  await app.register(documentRaciRoutes, { prefix: '/documents' })
  await app.register(guestInvitationRoutes)
  await app.ready()
  return { app, routes }
}

const fill = (url: string) => url.replace(/:[A-Za-z]+/g, 'x').replace(/\/$/, '') || '/'
const writes = (routes: Route[]) => routes.filter(r => !['GET', 'HEAD', 'OPTIONS'].includes(r.method))
const call = (app: FastifyInstance, r: Route) =>
  app.inject({ method: r.method as 'POST', url: fill(r.url), payload: {} })

describe('auditor is read-only across Clinical Writing', () => {
  it.each(['auditor', 'read-only'] as const)('every write route refuses a %s', async (role) => {
    const { app, routes } = await buildAll(role)
    const all = writes(routes)
    // A guard against this test passing because it found nothing to call.
    expect(all.length).toBeGreaterThan(60)
    const notRefused: string[] = []
    for (const r of all) {
      const res = await call(app, r)
      if (res.statusCode !== 403 || res.json().error !== AUDITOR_READ_ONLY.error) notRefused.push(`${r.method} ${r.url} -> ${res.statusCode}`)
    }
    expect(notRefused).toEqual([])
    await app.close()
  })

  it('does not get in the way of anyone else: a contributor reaches the handler', async () => {
    const { app, routes } = await buildAll('contributor')
    const refused: string[] = []
    for (const r of writes(routes)) {
      const res = await call(app, r)
      if (res.statusCode === 403 && res.json().error === AUDITOR_READ_ONLY.error) refused.push(`${r.method} ${r.url}`)
    }
    expect(refused).toEqual([])
    await app.close()
  })
})

describe('requireAuth read-only guard', () => {
  async function single(opts: Parameters<typeof requireAuth>[0], method: 'GET' | 'POST' | 'HEAD', role: Role = 'auditor') {
    const app = Fastify()
    app.decorateRequest('user', null)
    app.addHook('onRequest', async (req) => {
      const user: AuthenticatedUser = { id: 'u', email: 'a@x', role, modules: ['A', 'B'], tenantId: null }
      ;(req as unknown as { user: AuthenticatedUser }).user = user
    })
    app.route({ method, url: '/x', preHandler: requireAuth(opts), handler: async () => ({ ok: true }) })
    await app.ready()
    const res = await app.inject({ method, url: '/x', ...(method === 'POST' ? { payload: {} } : {}) })
    await app.close()
    return res
  }

  it('lets an auditor read', async () => {
    expect((await single({ modules: ['A'] }, 'GET')).statusCode).toBe(200)
    expect((await single({ clinicalWriting: true }, 'GET')).statusCode).toBe(200)
    expect((await single({ modules: ['A'] }, 'HEAD')).statusCode).toBe(200)
  })

  it('refuses a write on a route marked as Clinical Writing without declaring the module', async () => {
    const res = await single({ clinicalWriting: true }, 'POST')
    expect(res.statusCode).toBe(403)
    expect(res.json().error).toBe('auditor_read_only')
  })

  it('leaves routes outside Clinical Writing to their own rules', async () => {
    expect((await single({ modules: ['B'] }, 'POST')).statusCode).toBe(200)
    expect((await single({}, 'POST')).statusCode).toBe(200)
  })

  it('answers with the read-only reason before the role check', async () => {
    const res = await single({ roles: ['pm'], modules: ['A'] }, 'POST')
    expect(res.json().error).toBe('auditor_read_only')
  })

  it('does not apply to other roles', async () => {
    expect((await single({ modules: ['A'] }, 'POST', 'contributor')).statusCode).toBe(200)
  })
})
