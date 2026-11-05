// Multiple platform roles: a user holds one or two (Project manager + Contributor, or Project
// manager + Auditor) and their rights are the union — a grant applies if any role grants it, a role
// restriction only if every role is restricted. An admin role is never combined (separation of duties).

import { describe, expect, it, vi } from 'vitest'
import { hasAnyRole, hasRole, onlyRolesIn, rolesOf, type AuthenticatedUser } from './rbac.js'
import { roleSetProblem } from './role-combos.js'
import { actorCanAddComment, actorCanEditDocumentContent, actorCanUseAiChat } from '../modules/platform/document-raci/access.js'
import { actorCanStartChain } from '../modules/clinical-writing/signatures/access.js'

const user = (role: string, extra: string[] = []): AuthenticatedUser =>
  ({ id: 'u-1', email: 'u@x.io', role, roles: [role, ...extra], capabilities: ['can-author'], modules: ['A'], tenantId: 't' }) as AuthenticatedUser

describe('which roles may be held together', () => {
  it.each([[['pm', 'contributor']], [['contributor', 'pm']], [['pm', 'auditor']], [['contributor']], [['tenant-admin']]])('%j is allowed', (roles) => {
    expect(roleSetProblem(roles)).toBeNull()
  })
  it.each([
    [['tenant-admin', 'pm'], 'role_combination_not_allowed'],
    [['contributor', 'tenant-admin'], 'role_combination_not_allowed'],
    [['admin', 'contributor'], 'role_combination_not_allowed'],          // legacy admin counts as an admin
    [['auditor', 'contributor'], 'role_combination_not_allowed'],
    [['read-only', 'clinical-writer'], 'role_combination_not_allowed'],  // legacy names map to auditor / contributor
    [['pm', 'pm'], 'duplicate_role'],
    [['pm', 'contributor', 'auditor'], 'too_many_roles'],
  ])('%j is refused (%s)', (roles, error) => {
    expect(roleSetProblem(roles)?.error).toBe(error)
  })
})

describe('union helpers', () => {
  it('rolesOf falls back to the single role', () => {
    expect(rolesOf({ role: 'pm' })).toEqual(['pm'])
    expect(rolesOf(user('pm', ['contributor']))).toEqual(['pm', 'contributor'])
  })
  it('a grant from either role counts; a restriction needs every role restricted', () => {
    const both = user('pm', ['contributor'])
    expect(hasAnyRole(both, 'contributor')).toBe(true)
    expect(onlyRolesIn(both, ['pm', 'tenant-admin'])).toBe(false)
    expect(onlyRolesIn(user('pm'), ['pm', 'tenant-admin'])).toBe(true)
  })
  it('a route guard passes if any role satisfies it', () => {
    expect(hasRole(user('contributor', ['pm']), ['pm'])).toBe(true)
    expect(hasRole(user('contributor'), ['pm'])).toBe(false)
  })
})

describe('permission checks use the union', () => {
  // The user is an R on the document (and Approver for the chain check).
  const prisma = {
    document: { findUnique: vi.fn(async () => ({ assigneeId: 'someone-else', projectId: 'p' })) },
    documentRaci: {
      findFirst: vi.fn(async ({ where }: { where: { letter: unknown } }) => (where.letter === 'R' || where.letter === 'A' || typeof where.letter === 'object' ? { id: 'r' } : null)),
    },
    signatureChain: { findFirst: vi.fn(async () => null) },
  } as never

  it('PM + Contributor holding R may edit content, comment and start a chain; a PM alone may not', async () => {
    const both = user('pm', ['contributor'])
    expect(await actorCanEditDocumentContent(prisma, both, 'd')).toBe(true)
    expect(await actorCanAddComment(prisma, both, 'd')).toBe(true)
    expect(await actorCanStartChain(prisma, both, 'd')).toBe(true)

    const pmOnly = user('pm')
    expect(await actorCanEditDocumentContent(prisma, pmOnly, 'd')).toBe(false)
    expect(await actorCanAddComment(prisma, pmOnly, 'd')).toBe(false)
    expect(await actorCanStartChain(prisma, pmOnly, 'd')).toBe(false)
  })

  it('PM + Auditor still cannot author (neither role authors)', async () => {
    const pmAuditor = user('pm', ['auditor'])
    expect(await actorCanEditDocumentContent(prisma, pmAuditor, 'd')).toBe(false)
    expect(await actorCanStartChain(prisma, pmAuditor, 'd')).toBe(false)
  })

  it('AI chat: off for a PM alone, on for PM + Contributor', () => {
    expect(actorCanUseAiChat(user('pm'))).toBe(false)
    expect(actorCanUseAiChat(user('pm', ['contributor']))).toBe(true)
  })
})
