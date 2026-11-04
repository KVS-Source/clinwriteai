// Who may resolve a document's comments, and who may schedule its CRM meeting.

import { describe, expect, it } from 'vitest'
import type { AuthenticatedUser } from '../../../auth/rbac.js'
import { actorCanResolveComments, actorCanScheduleCrm, documentsActorCanResolve } from './access.js'

const DOC = 'd-1'
type Row = { documentId: string; userId: string; letter: string }

function prisma(opts: { rows?: Row[]; assignee?: string; memberOf?: string[] } = {}) {
  const rows = opts.rows ?? []
  return {
    document: {
      findUnique: async () => ({ assigneeId: opts.assignee ?? 'someone-else', projectId: 'p-1' }),
      findMany: async ({ where }: { where: { id?: { in: string[] }; assigneeId?: unknown } }) =>
        where.id ? (opts.assignee === where.assigneeId ? where.id.in.map(id => ({ id })) : []) : [],
    },
    documentRaci: {
      findMany: async ({ where }: { where: { documentId: string | { in: string[] }; userId: string; letter?: { in: string[] } } }) =>
        rows.filter(r =>
          r.userId === where.userId
          && (typeof where.documentId === 'string' ? r.documentId === where.documentId : where.documentId.in.includes(r.documentId))
          && (!where.letter || where.letter.in.includes(r.letter))),
    },
    projectMember:     { findMany: async () => (opts.memberOf ?? []).map(projectId => ({ projectId })) },
    projectTeamMember: { findMany: async () => [] },
  } as never
}

const user = (role: AuthenticatedUser['role'] = 'contributor'): AuthenticatedUser =>
  ({ id: 'u-1', email: 'u@x', role, modules: ['A'], tenantId: null })
const holds = (...letters: string[]): Row[] => letters.map(letter => ({ documentId: DOC, userId: 'u-1', letter }))

describe('resolving comments', () => {
  it.each(['R', 'C', 'A'])('is open to a holder of %s', async (letter) => {
    expect(await actorCanResolveComments(prisma({ rows: holds(letter) }), user(), DOC)).toBe(true)
  })

  it('is open to the assignee, who is the first author', async () => {
    expect(await actorCanResolveComments(prisma({ assignee: 'u-1' }), user(), DOC)).toBe(true)
  })

  it.each(['Q', 'I'])('is closed to a holder of %s alone', async (letter) => {
    expect(await actorCanResolveComments(prisma({ rows: holds(letter) }), user(), DOC)).toBe(false)
  })

  it('is closed to someone with no part on the document, and to a PM unless they hold a letter', async () => {
    expect(await actorCanResolveComments(prisma(), user(), DOC)).toBe(false)
    expect(await actorCanResolveComments(prisma({ memberOf: ['p-1'] }), user('pm'), DOC)).toBe(false)
    expect(await actorCanResolveComments(prisma({ rows: holds('A') }), user('pm'), DOC)).toBe(true)
  })

  it.each(['tenant-admin', 'admin'] as const)('is closed to a %s, even holding a letter', async (role) => {
    expect(await actorCanResolveComments(prisma({ rows: holds('R'), assignee: 'u-1' }), user(role), DOC)).toBe(false)
  })

  it('answers per document in the batched form', async () => {
    const rows = [{ documentId: 'd-1', userId: 'u-1', letter: 'C' }, { documentId: 'd-2', userId: 'u-1', letter: 'Q' }]
    expect([...await documentsActorCanResolve(prisma({ rows }), user(), ['d-1', 'd-2', 'd-3'])]).toEqual(['d-1'])
  })
})

describe('scheduling a CRM meeting', () => {
  it.each(['R', 'A', 'C', 'I'])('is open to a holder of %s', async (letter) => {
    expect(await actorCanScheduleCrm(prisma({ rows: holds(letter) }), user(), DOC)).toBe(true)
  })

  it('is open to the assignee', async () => {
    expect(await actorCanScheduleCrm(prisma({ assignee: 'u-1' }), user(), DOC)).toBe(true)
  })

  it('is closed to QC, unless they also hold another letter', async () => {
    expect(await actorCanScheduleCrm(prisma({ rows: holds('Q') }), user(), DOC)).toBe(false)
    expect(await actorCanScheduleCrm(prisma({ rows: holds('Q', 'C') }), user(), DOC)).toBe(true)
    expect(await actorCanScheduleCrm(prisma({ rows: holds('Q') }), user('pm'), DOC)).toBe(false)
  })

  it('is closed to someone with no part on the document', async () => {
    expect(await actorCanScheduleCrm(prisma(), user(), DOC)).toBe(false)
    expect(await actorCanScheduleCrm(prisma(), user('auditor'), DOC)).toBe(false)
  })

  it('is open to a PM who can see the project, without a letter', async () => {
    expect(await actorCanScheduleCrm(prisma({ memberOf: ['p-1'] }), user('pm'), DOC)).toBe(true)
    expect(await actorCanScheduleCrm(prisma({ memberOf: ['p-other'] }), user('pm'), DOC)).toBe(false)
  })

  it.each(['tenant-admin', 'admin', 'super-admin'] as const)('is closed to a %s, even holding a letter', async (role) => {
    expect(await actorCanScheduleCrm(prisma({ rows: holds('R'), assignee: 'u-1' }), user(role), DOC)).toBe(false)
  })
})
