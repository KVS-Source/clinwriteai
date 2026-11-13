// QC platform role: reads all content (like an Auditor) — sees every project and every document, writes
// nothing in Clinical Writing, never authors or signs, and has no admin access. It can be held with Project
// manager (or Auditor) but not with Contributor. It also approves framework supersede requests
// (frameworks/routes.test.ts).

import Fastify from 'fastify'
import { describe, expect, it } from 'vitest'
import { AUDITOR_READ_ONLY, hasRole, requireAuth, type AuthenticatedUser, type Role } from './rbac.js'
import { ADDABLE_ROLES, roleSetProblem } from './role-combos.js'
import { documentVisibilityWhere, visibleProjectIdsForUser } from '../modules/projects/visibility.js'
import { NEVER_ASSIGNEE_ROLES, RACI_LOCKED_ROLES } from '../modules/platform/document-raci/access.js'

const qc = (extra: Role[] = []): AuthenticatedUser =>
  ({ id: 'u-qc', email: 'qc@x.io', role: 'qc', roles: ['qc', ...extra], capabilities: [], modules: ['A', 'B', 'C', 'D', 'E'], tenantId: 't' }) as AuthenticatedUser

describe('QC reads everything', () => {
  it('sees every project and every document', async () => {
    expect(await visibleProjectIdsForUser({} as never, qc())).toBe('all')
    expect(documentVisibilityWhere(qc())).toBeNull()
  })

  it('cannot be put on a RACI, assigned a document, or open admin routes', () => {
    expect(RACI_LOCKED_ROLES.has('qc')).toBe(true)
    expect(NEVER_ASSIGNEE_ROLES.has('qc')).toBe(true)
    expect(hasRole(qc(), ['admin'])).toBe(false)
  })
})

describe('QC writes nothing in Clinical Writing', () => {
  async function app() {
    const a = Fastify()
    a.decorateRequest('user', null)
    a.addHook('onRequest', async (r) => { Object.assign(r, { user: qc() }) })
    a.get('/doc', { preHandler: requireAuth({ modules: ['A'] }) }, async () => ({ ok: true }))
    a.post('/doc', { preHandler: requireAuth({ modules: ['A'] }) }, async () => ({ ok: true }))
    await a.ready()
    return a
  }
  it('reads (GET 200) but every write is refused (403 read-only)', async () => {
    const a = await app()
    expect((await a.inject({ method: 'GET', url: '/doc' })).statusCode).toBe(200)
    const post = await a.inject({ method: 'POST', url: '/doc' })
    expect(post.statusCode).toBe(403)
    expect(post.json().error).toBe(AUDITOR_READ_ONLY.error)
    await a.close()
  })
})

describe('which roles QC can be held with', () => {
  it('can be added as a role', () => {
    expect(ADDABLE_ROLES).toContain('qc')
  })
  it.each([[['pm', 'qc']], [['qc', 'pm']], [['qc', 'auditor']], [['qc']]])('%j is allowed', (roles) => {
    expect(roleSetProblem(roles)).toBeNull()
  })
  it.each([[['qc', 'contributor']], [['contributor', 'qc']], [['qc', 'tenant-admin']]])('%j is refused', (roles) => {
    expect(roleSetProblem(roles)?.error).toBe('role_combination_not_allowed')
  })
})
