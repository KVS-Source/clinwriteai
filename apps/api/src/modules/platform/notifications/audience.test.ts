// Role switcher: for a user holding two roles, each notification says which of them it is for
// (forRole), so the Notification Centre can ask them to switch before opening it.

import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from '../../../auth/rbac.js'
import { notificationRole } from './audience.js'
import { notificationsRoutes } from './routes.js'

describe('notificationRole', () => {
  const both = ['pm', 'contributor']
  it.each([
    ['project_manager_added', 'pm'],
    ['calendar_entry_overdue', 'pm'],
    ['signature_requested', 'contributor'],
    ['comment.mention', 'contributor'],
    ['document.returned_to_authoring', 'contributor'],
    ['document_nudge', 'contributor'],
    ['user.invitation', null],
    ['ai_quota_approaching', null],
  ])('%s is for %s', (kind, role) => {
    expect(notificationRole(kind, both)).toBe(role)
  })

  it('a single-role user gets no split', () => {
    expect(notificationRole('project_manager_added', ['pm'])).toBeNull()
    expect(notificationRole('signature_requested', ['contributor'])).toBeNull()
  })

  it('only a role the user holds (PM + Auditor: document work is not marked Contributor)', () => {
    expect(notificationRole('signature_requested', ['pm', 'auditor'])).toBeNull()
    expect(notificationRole('project_manager_added', ['pm', 'auditor'])).toBe('pm')
  })
})

describe('GET /me — forRole', () => {
  async function build(row: { role: string; additionalRoles: string[] } | null) {
    const base = { recipientId: 'me', severity: 'info', body: '', linkPath: null, channels: ['in_app'], readAt: null, dismissedAt: null, createdAt: new Date(), payload: {} }
    const app = Fastify()
    app.decorate('prisma', {
      notification: { findMany: vi.fn(async () => [
        { ...base, id: 'n-pm', kind: 'project_manager_added', title: 'You are now a project manager on "Final Project"' },
        { ...base, id: 'n-sign', kind: 'signature_requested', title: 'Your signature is needed' },
        { ...base, id: 'n-inv', kind: 'user.invitation', title: 'You have been invited' },
      ]) },
      user: { findUnique: vi.fn(async () => row), findMany: vi.fn(async () => []) },
      comment: { findMany: vi.fn(async () => []) },
      document: { findMany: vi.fn(async () => []) },
      project: { findMany: vi.fn(async () => []) },
      documentRaci: { findMany: vi.fn(async () => []) },
    } as never)
    app.decorateRequest('user', null)
    app.addHook('onRequest', async (r) => {
      // Working as Contributor (narrowed by X-Active-Role); the user row still holds both roles.
      Object.assign(r, { user: { id: 'me', email: 'm@x', role: 'contributor', roles: ['contributor'], modules: ['A'], tenantId: null } as AuthenticatedUser })
    })
    await app.register(notificationsRoutes)
    await app.ready()
    return app
  }

  it('marks each notification with the role it is for, from every role held (not just the one in use)', async () => {
    const app = await build({ role: 'pm', additionalRoles: ['contributor'] })
    const list = (await app.inject({ method: 'GET', url: '/me' })).json() as Array<{ id: string; forRole: string | null }>
    expect(Object.fromEntries(list.map(n => [n.id, n.forRole]))).toEqual({ 'n-pm': 'pm', 'n-sign': 'contributor', 'n-inv': null })
    await app.close()
  })

  it('a single-role user, or one with no row, gets null everywhere', async () => {
    for (const row of [{ role: 'contributor', additionalRoles: [] }, null]) {
      const app = await build(row)
      const list = (await app.inject({ method: 'GET', url: '/me' })).json() as Array<{ forRole: string | null }>
      expect(list.every(n => n.forRole === null)).toBe(true)
      await app.close()
    }
  })
})
