import { describe, expect, it } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import type { AuthenticatedUser } from '../../auth/rbac.js'
import { canSeeDocument, documentVisibilityWhere, visibleProjectIdsForUser } from './visibility.js'

interface FakeRows {
  members?:     Array<{ userId: string; projectId: string; removedAt: Date | null; projectRole?: string | null }>
  legacyTeam?:  Array<{ userId: string; projectId: string }>
  raciDocs?:    Array<{ userId: string; projectId: string; removedAt: Date | null }>
  createdDocs?: Array<{ userId: string; projectId: string }>
  projectRaci?: Array<{ projectId: string; responsibleId?: string; accountableId?: string; consultedIds?: string[]; informedIds?: string[] }>
}

type MemberWhere = { userId: string; removedAt: null; OR?: Array<{ projectRole: null | { not: string } }> }
type DocWhere = { OR: Array<{ assigneeId?: string; createdBy?: string; raciRows?: { some: { userId: string } } }> }

// Tiny fake Prisma — only the findMany calls the helper makes. Each honours the filters the helper
// sends (userId, removedAt, the PM-membership exclusion, the creator branch) so the rules are tested.
function fakePrisma(rows: FakeRows): PrismaClient {
  const impl = {
    projectMember: {
      findMany: async ({ where }: { where: MemberWhere }) => {
        const excluded = where.OR?.map(c => c.projectRole).find(c => c && typeof c === 'object') as { not: string } | undefined
        return (rows.members ?? [])
          .filter(r => r.userId === where.userId && r.removedAt === null)
          .filter(r => !excluded || (r.projectRole ?? null) !== excluded.not)
          .map(r => ({ projectId: r.projectId }))
      },
    },
    projectTeamMember: {
      findMany: async ({ where }: { where: { userId: string } }) =>
        (rows.legacyTeam ?? [])
          .filter(r => r.userId === where.userId)
          .map(r => ({ projectId: r.projectId })),
    },
    document: {
      findMany: async ({ where }: { where: DocWhere }) => {
        const userId = where.OR.find(c => c.raciRows)!.raciRows!.some.userId
        const creatorCounts = where.OR.some(c => c.createdBy === userId)
        const ids = new Set<string>()
        for (const r of rows.raciDocs ?? []) if (r.userId === userId && r.removedAt === null) ids.add(r.projectId)
        if (creatorCounts) for (const r of rows.createdDocs ?? []) if (r.userId === userId) ids.add(r.projectId)
        return [...ids].map(projectId => ({ projectId }))
      },
    },
    raciAssignment: {
      findMany: async ({ where }: { where: { OR: Array<Record<string, unknown>> } }) => {
        const userId = where.OR.find(c => 'responsibleId' in c)!.responsibleId as string
        return (rows.projectRaci ?? [])
          .filter(r => r.responsibleId === userId || r.accountableId === userId || r.consultedIds?.includes(userId) || r.informedIds?.includes(userId))
          .map(r => ({ projectId: r.projectId }))
      },
    },
  }
  return impl as unknown as PrismaClient
}

function user(role: AuthenticatedUser['role'], id = 'u-1', roles?: AuthenticatedUser['role'][]): AuthenticatedUser {
  return { id, email: `${id}@x`, role, ...(roles && { roles }), modules: ['A'], tenantId: 't-1' }
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

describe('PM + Contributor: projects depend on the role in use', () => {
  // Sourabh created p-mine (so he is its "Project Manager" member), holds an R on a document in p-raci,
  // a project-level C on p-proj-raci, and nothing on p-other.
  const rows: FakeRows = {
    members: [
      { userId: 'u-1', projectId: 'p-mine', removedAt: null, projectRole: 'Project Manager' },
      { userId: 'u-1', projectId: 'p-mine-with-raci', removedAt: null, projectRole: 'Project Manager' },
    ],
    raciDocs: [
      { userId: 'u-1', projectId: 'p-raci', removedAt: null },
      { userId: 'u-1', projectId: 'p-mine-with-raci', removedAt: null },
    ],
    createdDocs: [{ userId: 'u-1', projectId: 'p-doc-i-created' }],
    projectRaci: [{ projectId: 'p-proj-raci', consultedIds: ['u-1'] }, { projectId: 'p-other', responsibleId: 'someone-else' }],
  }

  it('working as PM: every project he created or manages, plus those where he has a RACI role', async () => {
    expect(await visibleProjectIdsForUser(fakePrisma(rows), user('pm'))).toEqual(
      new Set(['p-mine', 'p-mine-with-raci', 'p-raci', 'p-doc-i-created', 'p-proj-raci']),
    )
  })

  it('working as Contributor: only projects where he has a RACI role — not the ones he manages', async () => {
    expect(await visibleProjectIdsForUser(fakePrisma(rows), user('contributor'))).toEqual(
      new Set(['p-mine-with-raci', 'p-raci', 'p-proj-raci']),
    )
  })

  it('holding both with no role chosen (union) sees the PM set', async () => {
    expect(await visibleProjectIdsForUser(fakePrisma(rows), user('pm', 'u-1', ['pm', 'contributor']))).toEqual(
      new Set(['p-mine', 'p-mine-with-raci', 'p-raci', 'p-doc-i-created', 'p-proj-raci']),
    )
  })

  it('a Contributor keeps a non-PM membership (e.g. Lead Writer) and one with no label', async () => {
    const r = await visibleProjectIdsForUser(fakePrisma({
      members: [
        { userId: 'u-1', projectId: 'p-writer', removedAt: null, projectRole: 'Lead Writer' },
        { userId: 'u-1', projectId: 'p-unlabelled', removedAt: null, projectRole: null },
      ],
    }), user('contributor'))
    expect(r).toEqual(new Set(['p-writer', 'p-unlabelled']))
  })

  it.each([
    ['responsible', { responsibleId: 'u-1' }],
    ['accountable', { accountableId: 'u-1' }],
    ['consulted', { consultedIds: ['u-1'] }],
    ['informed', { informedIds: ['u-1'] }],
  ])('a project-level RACI letter (%s) shows the project', async (_l, letter) => {
    const r = await visibleProjectIdsForUser(fakePrisma({ projectRaci: [{ projectId: 'p-x', ...letter }] }), user('contributor'))
    expect(r).toEqual(new Set(['p-x']))
  })
})

describe('documentVisibilityWhere / canSeeDocument', () => {
  it('admins, auditors and PMs see every document', () => {
    for (const role of ['tenant-admin', 'admin', 'auditor', 'pm'] as const) {
      expect(documentVisibilityWhere(user(role))).toBeNull()
    }
  })

  it('contributors see only documents they are assignee, creator or on the RACI of', () => {
    expect(documentVisibilityWhere(user('contributor', 'ravi'))).toEqual({
      OR: [
        { assigneeId: 'ravi' },
        { createdBy: 'ravi' },
        { raciRows: { some: { userId: 'ravi', removedAt: null } } },
      ],
    })
  })

  it('canSeeDocument counts the document under the contributor scope', async () => {
    const seen: unknown[] = []
    const prisma = { document: { count: async (args: unknown) => { seen.push(args); return 0 } } } as unknown as PrismaClient
    expect(await canSeeDocument(prisma, user('contributor', 'ravi'), 'DOC-1')).toBe(false)
    expect(seen[0]).toMatchObject({ where: { id: 'DOC-1', OR: expect.any(Array) } })
    expect(await canSeeDocument(prisma, user('tenant-admin'), 'DOC-1')).toBe(true)
    expect(seen).toHaveLength(1)
  })
})
