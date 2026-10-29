import { describe, expect, it } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import type { AuthenticatedUser } from '../../auth/rbac.js'
import { visibleProjectIdsForUser } from './visibility.js'

interface FakeRows {
  members?:    Array<{ userId: string; projectId: string; removedAt: Date | null }>
  legacyTeam?: Array<{ userId: string; projectId: string }>
  raciDocs?:   Array<{ userId: string; projectId: string; removedAt: Date | null }>
}

// Tiny fake Prisma — only the three findMany calls the helper makes.
// Each filter method honours userId + the removedAt null filter where
// relevant so we can test the "removed member doesn't appear" case.
function fakePrisma(rows: FakeRows): PrismaClient {
  const impl = {
    projectMember: {
      findMany: async ({ where }: { where: { userId: string; removedAt: null } }) =>
        (rows.members ?? [])
          .filter(r => r.userId === where.userId && r.removedAt === null)
          .map(r => ({ projectId: r.projectId })),
    },
    projectTeamMember: {
      findMany: async ({ where }: { where: { userId: string } }) =>
        (rows.legacyTeam ?? [])
          .filter(r => r.userId === where.userId)
          .map(r => ({ projectId: r.projectId })),
    },
    document: {
      findMany: async ({ where }: { where: { raciRows: { some: { userId: string; removedAt: null } } } }) => {
        const userId = where.raciRows.some.userId
        const seen = new Set<string>()
        const out: Array<{ projectId: string }> = []
        for (const r of rows.raciDocs ?? []) {
          if (r.userId !== userId) continue
          if (r.removedAt !== null) continue
          if (seen.has(r.projectId)) continue
          seen.add(r.projectId)
          out.push({ projectId: r.projectId })
        }
        return out
      },
    },
  }
  return impl as unknown as PrismaClient
}

function user(role: AuthenticatedUser['role'], id = 'u-1'): AuthenticatedUser {
  return { id, email: `${id}@x`, role, modules: ['A'], tenantId: 't-1' }
}

describe('visibleProjectIdsForUser', () => {
  it("returns 'all' for tenant-admin", async () => {
    const r = await visibleProjectIdsForUser(fakePrisma({}), user('tenant-admin'))
    expect(r).toBe('all')
  })

  it("returns 'all' for legacy admin alias", async () => {
    const r = await visibleProjectIdsForUser(fakePrisma({}), user('admin'))
    expect(r).toBe('all')
  })

  it("returns 'all' for auditor (read-only compliance)", async () => {
    const r = await visibleProjectIdsForUser(fakePrisma({}), user('auditor'))
    expect(r).toBe('all')
  })

  it("returns 'all' for legacy read-only alias", async () => {
    const r = await visibleProjectIdsForUser(fakePrisma({}), user('read-only'))
    expect(r).toBe('all')
  })

  it('scopes contributors to ProjectMember rows', async () => {
    const r = await visibleProjectIdsForUser(
      fakePrisma({ members: [{ userId: 'u-1', projectId: 'p-a', removedAt: null }] }),
      user('contributor'),
    )
    expect(r).toEqual(new Set(['p-a']))
  })

  it('still honours legacy ProjectTeamMember during the cutover', async () => {
    const r = await visibleProjectIdsForUser(
      fakePrisma({ legacyTeam: [{ userId: 'u-1', projectId: 'p-legacy' }] }),
      user('contributor'),
    )
    expect(r).toEqual(new Set(['p-legacy']))
  })

  it('counts DocumentRaci assignments as project visibility', async () => {
    const r = await visibleProjectIdsForUser(
      fakePrisma({ raciDocs: [{ userId: 'u-1', projectId: 'p-raci', removedAt: null }] }),
      user('contributor'),
    )
    expect(r).toEqual(new Set(['p-raci']))
  })

  it('de-dupes projects visible via multiple sources', async () => {
    const r = await visibleProjectIdsForUser(
      fakePrisma({
        members:    [{ userId: 'u-1', projectId: 'p-shared', removedAt: null }],
        legacyTeam: [{ userId: 'u-1', projectId: 'p-shared' }],
        raciDocs:   [{ userId: 'u-1', projectId: 'p-shared', removedAt: null }],
      }),
      user('contributor'),
    )
    expect(r).toEqual(new Set(['p-shared']))
  })

  it("ignores removed memberships and removed RACI rows", async () => {
    const r = await visibleProjectIdsForUser(
      fakePrisma({
        members: [
          { userId: 'u-1', projectId: 'p-active',  removedAt: null },
          { userId: 'u-1', projectId: 'p-removed', removedAt: new Date() },
        ],
        raciDocs: [
          { userId: 'u-1', projectId: 'p-raci-active',  removedAt: null },
          { userId: 'u-1', projectId: 'p-raci-removed', removedAt: new Date() },
        ],
      }),
      user('contributor'),
    )
    expect(r).toEqual(new Set(['p-active', 'p-raci-active']))
  })

  it('returns empty Set when a contributor has no assignments', async () => {
    const r = await visibleProjectIdsForUser(fakePrisma({}), user('contributor'))
    expect(r).toEqual(new Set())
  })

  it('ignores assignments belonging to a different user', async () => {
    const r = await visibleProjectIdsForUser(
      fakePrisma({
        members:  [{ userId: 'u-OTHER', projectId: 'p-other', removedAt: null }],
        raciDocs: [{ userId: 'u-OTHER', projectId: 'p-other', removedAt: null }],
      }),
      user('contributor', 'u-1'),
    )
    expect(r).toEqual(new Set())
  })
})
