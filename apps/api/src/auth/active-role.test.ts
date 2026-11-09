// Active role (role switcher): a user holding two roles works as the one sent on X-Active-Role, and
// every check sees only that role. A role the user doesn't hold is ignored (never a way to gain one).
// GET /auth/me reports the role in use plus every role held (allRoles) for the switcher.

import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import { ACTIVE_ROLE_HEADER, withActiveRole } from './active-role.js'
import { hasAnyRole, hasRole, requireAuth, type AuthenticatedUser } from './rbac.js'
import { authRoutes } from './routes.js'

const user = (role: string, extra: string[] = []): AuthenticatedUser =>
  ({ id: 'u-1', email: 'u@x.io', role, roles: [role, ...extra], capabilities: [], modules: ['A'], tenantId: 't' }) as AuthenticatedUser

describe('withActiveRole', () => {
  const both = user('pm', ['contributor'])

  it('narrows to the chosen role when the user holds it', () => {
    const asContributor = withActiveRole(both, 'contributor')
    expect(asContributor.role).toBe('contributor')
    expect(asContributor.roles).toEqual(['contributor'])
    expect(hasRole(asContributor, ['pm'])).toBe(false)
    expect(hasAnyRole(asContributor, 'contributor')).toBe(true)
  })

  it('choosing the primary role also narrows (the PM no longer gets the Contributor rights)', () => {
    const asPm = withActiveRole(both, 'pm')
    expect(asPm.roles).toEqual(['pm'])
    expect(hasAnyRole(asPm, 'contributor')).toBe(false)
  })

  it.each([
    ['a role not held', 'tenant-admin'],
    ['another role not held', 'auditor'],
    ['an empty value', '  '],
    ['no header', undefined],
  ])('ignores %s: every held role stays', (_label, header) => {
    expect(withActiveRole(both, header)).toBe(both)
  })

  it('takes the first value of a repeated header', () => {
    expect(withActiveRole(both, ['contributor', 'pm']).roles).toEqual(['contributor'])
  })

  it('leaves a single-role user alone', () => {
    const solo = user('contributor')
    expect(withActiveRole(solo, 'contributor')).toBe(solo)
    expect(withActiveRole({ ...solo, roles: undefined }, 'pm')).toEqual({ ...solo, roles: undefined })
  })
})

describe('over HTTP', () => {
  async function build(signedIn: AuthenticatedUser, row = { role: 'pm', additionalRoles: ['auditor'] }) {
    const app = Fastify()
    app.decorate('prisma', { user: { findUnique: vi.fn(async () => ({ name: 'Sourabh', initials: 'SO', ...row })) } } as never)
    app.decorateRequest('user', null)
    // The same two steps as the auth plugin: resolve the identity, then apply the active role.
    app.addHook('onRequest', async (r) => { Object.assign(r, { user: signedIn }) })
    app.addHook('onRequest', async (r) => { r.user = withActiveRole(r.user!, r.headers[ACTIVE_ROLE_HEADER]) })
    await app.register(authRoutes)
    app.get('/pm-only', { preHandler: requireAuth({ roles: ['pm'] }) }, async () => ({ ok: true }))
    await app.ready()
    return app
  }

  it('a PM + Auditor working as Auditor is refused a PM route; as PM, or with no choice, allowed', async () => {
    const app = await build(user('pm', ['auditor']))
    expect((await app.inject({ method: 'GET', url: '/pm-only', headers: { 'X-Active-Role': 'auditor' } })).statusCode).toBe(403)
    expect((await app.inject({ method: 'GET', url: '/pm-only', headers: { 'X-Active-Role': 'pm' } })).statusCode).toBe(200)
    expect((await app.inject({ method: 'GET', url: '/pm-only' })).statusCode).toBe(200)
    await app.close()
  })

  it('a role the user does not hold gains nothing', async () => {
    const app = await build(user('contributor', ['pm']), { role: 'contributor', additionalRoles: ['pm'] })
    const res = await app.inject({ method: 'GET', url: '/auth/me', headers: { 'X-Active-Role': 'tenant-admin' } })
    expect(res.json()).toMatchObject({ role: 'contributor', roles: ['contributor', 'pm'] })
    await app.close()
  })

  it('GET /auth/me reports the role in use and every role held', async () => {
    const app = await build(user('pm', ['auditor']))
    const res = await app.inject({ method: 'GET', url: '/auth/me', headers: { 'X-Active-Role': 'auditor' } })
    expect(res.json()).toMatchObject({ role: 'auditor', roles: ['auditor'], allRoles: ['pm', 'auditor'] })
    await app.close()
  })
})
