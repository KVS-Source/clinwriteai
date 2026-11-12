import { describe, expect, it } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import type { AuthenticatedUser } from '../../auth/rbac.js'
import { canSeeDocument, documentVisibilityWhere, visibleDocumentIds, visibleProjectIdsForUser } from './visibility.js'

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

  it('canSeeDocument lets a PM open a document only inside a project they can see (CW-020)', async () => {
    const counted: unknown[] = []
    const prisma = {
      ...fakePrisma({ members: [{ userId: 'pm-1', projectId: 'p-mine', removedAt: null, projectRole: 'Project Manager' }] }),
      document: {
        findMany: async () => [],
        count: async (args: { where: { projectId?: { in: string[] } } }) => { counted.push(args); return args.where.projectId?.in.includes('p-mine') ? 1 : 0 },
      },
    } as unknown as PrismaClient
    expect(await canSeeDocument(prisma, user('pm', 'pm-1'), 'DOC-1')).toBe(true)
    expect(counted[0]).toMatchObject({ where: { id: 'DOC-1', projectId: { in: ['p-mine'] } } })
    // A PM on no project sees no document, without asking the database.
    const none = { ...fakePrisma({}), document: { findMany: async () => [], count: async () => { throw new Error('not expected') } } } as unknown as PrismaClient
    expect(await canSeeDocument(none, user('pm', 'pm-2'), 'DOC-1')).toBe(false)
  })
})

// The Master Library asks "which of these source documents may this reader see the team of?" for a page
// of documents at once (bug 15). Same rules as canSeeDocument, one query.
describe('visibleDocumentIds', () => {
  const unexpected = () => { throw new Error('not expected') }
  it('admin / auditor: every id, no lookup', async () => {
    const prisma = { document: { findMany: unexpected } } as unknown as PrismaClient
    expect([...await visibleDocumentIds(prisma, user('tenant-admin', 'a'), ['d1', 'd2'])]).toEqual(['d1', 'd2'])
    expect([...await visibleDocumentIds(prisma, user('auditor', 'b'), ['d1'])]).toEqual(['d1'])
  })
  it('nothing to look up → empty, no lookup', async () => {
    const prisma = { document: { findMany: unexpected } } as unknown as PrismaClient
    expect((await visibleDocumentIds(prisma, user('pm', 'pm-1'), [])).size).toBe(0)
  })
  it('a PM sees only documents of projects they are on; a PM on no project sees none, without a lookup', async () => {
    const queries: unknown[] = []
    const docs = [{ id: 'in', projectId: 'p-mine' }, { id: 'out', projectId: 'p-other' }]
    const base = fakePrisma({ members: [{ userId: 'pm-1', projectId: 'p-mine', removedAt: null, projectRole: 'Project Manager' }] })
    const prisma = {
      ...base,
      document: { findMany: async (args: { where: { id?: { in: string[] }; projectId?: { in: string[] } } }) => {
        if (!args.where.id) return (base as unknown as { document: { findMany: (a: unknown) => Promise<unknown[]> } }).document.findMany(args)
        queries.push(args)
        return docs.filter(d => args.where.id!.in.includes(d.id) && (!args.where.projectId || args.where.projectId.in.includes(d.projectId))).map(d => ({ id: d.id }))
      } },
    } as unknown as PrismaClient
    expect([...await visibleDocumentIds(prisma, user('pm', 'pm-1'), ['in', 'out'])]).toEqual(['in'])
    const noneBase = fakePrisma({})
    const none = { ...noneBase, document: { findMany: async (args: { where: { id?: unknown } }) => {
      if (args.where.id) throw new Error('not expected')
      return (noneBase as unknown as { document: { findMany: (a: unknown) => Promise<unknown[]> } }).document.findMany(args)
    } } } as unknown as PrismaClient
    expect((await visibleDocumentIds(none, user('pm', 'pm-2'), ['in'])).size).toBe(0)
  })
  it('a contributor sees only documents they work on (assignee, creator or a role), not a whole project', async () => {
    let sent: { where: Record<string, unknown> } | undefined
    const prisma = { document: { findMany: async (args: { where: Record<string, unknown> }) => { sent = args; return [{ id: 'mine' }] } } } as unknown as PrismaClient
    expect([...await visibleDocumentIds(prisma, user('author', 'c-1'), ['mine', 'theirs'])]).toEqual(['mine'])
    expect(sent!.where).toMatchObject({ id: { in: ['mine', 'theirs'] }, OR: expect.any(Array) })
    expect(sent!.where).not.toHaveProperty('projectId')
  })
})
