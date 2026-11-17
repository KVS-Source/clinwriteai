// CW-028 (newer template: notify + adopt, FR-A-001c / AC-A-014) and CW-029
// (template approval cycle: the approver is not the author, action table row 22).

import Fastify from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from '../../../auth/rbac.js'
import { checklistRoutes, checklistTemplateAdminRoutes } from './routes.js'
import {
  diffChecklistTemplate, isNewerTemplate, itemKey, notifyChecklistTemplateUpdate, templateDraftAuthors,
  type InstanceItemLike, type TemplateItemLike, type TemplateVersionLike,
} from './template-update.js'

const day = (d: number) => new Date(Date.UTC(2026, 9, d))
const version = (over: Partial<TemplateVersionLike>): TemplateVersionLike => ({
  id: 'tpl-1', deliverableType: 'csr_full', projectId: null, version: 1, templateStatus: 'locked', effectiveDate: day(1), approvedAt: day(1), ...over,
})

describe('isNewerTemplate — what counts as a newer version', () => {
  it('on the same template line, only a higher version number', () => {
    expect(isNewerTemplate(version({}), version({ id: 'tpl-2', version: 2, approvedAt: day(20) }), day(10))).toBe(true)
    expect(isNewerTemplate(version({ version: 3 }), version({ id: 'tpl-2', version: 2, approvedAt: day(20) }), day(10))).toBe(false)
  })
  it('two rows of the same version under the two spellings are not an update (CW-089 duplicates)', () => {
    const hyphen = version({ id: 'dup', deliverableType: 'csr-full', approvedAt: null, effectiveDate: day(12) })
    expect(isNewerTemplate(hyphen, version({ id: 'canon', approvedAt: day(27) }), day(12))).toBe(false)
  })
  it('a project override that took effect after the checklist was made is an update; one from before is not', () => {
    const baseline = version({ version: 3 })
    expect(isNewerTemplate(baseline, version({ id: 'ovr', projectId: 'P1', version: 1, approvedAt: day(20) }), day(10))).toBe(true)
    expect(isNewerTemplate(baseline, version({ id: 'ovr', projectId: 'P1', version: 1, approvedAt: day(5) }), day(10))).toBe(false)
  })
  it('never a draft, never the same row', () => {
    expect(isNewerTemplate(version({}), version({ id: 'tpl-2', version: 2, templateStatus: 'draft' }), day(10))).toBe(false)
    expect(isNewerTemplate(version({}), version({}), day(10))).toBe(false)
  })
})

const tItem = (id: string, text: string, over: Partial<TemplateItemLike> = {}): TemplateItemLike => ({
  id, text, framework: 'ICH E3', frameworkMandatory: true, ownerRaci: 'R', stage: 'reporting', autoCompleteOn: null, sortOrder: 10, ...over,
})
const iItem = (id: string, text: string, over: Partial<InstanceItemLike> = {}): InstanceItemLike => ({
  ...tItem(`ti-${id}`, text), id, templateItemId: `old-${id}`, isUserAdded: false, status: 'pending', ...over,
})

describe('diffChecklistTemplate — what adopting a newer template changes', () => {
  const doc = [
    iItem('a', 'Synopsis present', { status: 'complete' }),
    iItem('b', 'Tables cross-referenced', { status: 'waived' }),
    iItem('c', 'Old requirement'),
    iItem('d', 'Author note', { isUserAdded: true, templateItemId: null }),
    iItem('e', 'Dropped earlier by the author', { status: 'removed' }),
  ]
  const next = [
    tItem('n1', '  synopsis   PRESENT '),                           // same requirement, other spacing / case
    tItem('n2', 'Tables cross-referenced', { ownerRaci: 'Q' }),       // owner changed
    tItem('n3', 'New: estimand described'),
    tItem('n4', 'Dropped earlier by the author'),
  ]
  const diff = diffChecklistTemplate(doc, next)

  it('adds what is new, as pending items', () => {
    expect(diff.added.map(i => i.id)).toEqual(['n3'])
  })
  it('keeps progress on items that stay, and reports what changed on them', () => {
    expect(diff.unchanged.map(u => [u.item.id, u.next.id])).toEqual([['a', 'n1'], ['e', 'n4']])
    expect(diff.changed).toEqual([{ item: doc[1], next: next[1], fields: ['ownerRaci'] }])
  })
  it('removes template items the new version dropped, never hand-added ones or ones already removed', () => {
    expect(diff.removed.map(i => i.id)).toEqual(['c'])
  })
  it('matches on wording and framework, not on ids', () => {
    expect(itemKey({ text: 'A  b', framework: 'ICH E3' })).toBe(itemKey({ text: 'a b ', framework: 'ich e3' }))
    expect(itemKey({ text: 'A b', framework: 'ICH E3' })).not.toBe(itemKey({ text: 'A b', framework: 'Part 11' }))
  })
})

describe('templateDraftAuthors — who may not approve a draft', () => {
  it('is the creator plus everyone who changed its items, from the audit chain', async () => {
    const audit = { pageForEntity: vi.fn(async () => ({ rows: [
      { actorId: 'pm-b', action: 'checklist_template_item_updated' },
      { actorId: 'pm-c', action: 'checklist_template_item_reordered' },
      { actorId: 'pm-d', action: 'checklist_template_viewed' },          // looking is not authoring
    ], total: 3 })) }
    const authors = await templateDraftAuthors(audit as never, { id: 'tpl-2', createdBy: 'pm-a' })
    expect([...authors].sort()).toEqual(['pm-a', 'pm-b', 'pm-c'])
    expect(audit.pageForEntity).toHaveBeenCalledWith('checklist_template', 'tpl-2', expect.objectContaining({ offset: 0 }))
  })
})

describe('notifyChecklistTemplateUpdate — in-flight documents are told, not changed', () => {
  const v2 = { ...version({ id: 'tpl-2', version: 2, approvedAt: day(20) }), changeReason: 'ICH E3 Q&A update' }
  function prisma(opts: { overrideInP2?: boolean } = {}) {
    const on = { createdAt: day(10), template: version({}) }
    return {
      checklistInstance: {
        findMany: vi.fn(async () => [
          { id: 'ci-1', templateVersion: 1, ...on, document: { id: 'D1', title: 'CSR A', type: 'csr-full', projectId: 'P1', assigneeId: 'writer' } },
          { id: 'ci-2', templateVersion: 1, ...on, document: { id: 'D2', title: 'CSR B', type: 'csr_full', projectId: 'P2', assigneeId: 'w2' } },
          { id: 'ci-3', templateVersion: 1, ...on, document: { id: 'D3', title: 'CSR C', type: 'csr_full', projectId: 'P3', assigneeId: 'w3' } },
          // Already on v3 of the line: v2 is not newer for it.
          { id: 'ci-4', templateVersion: 3, createdAt: day(10), template: version({ id: 'tpl-3', version: 3 }), document: { id: 'D4', title: 'CSR D', type: 'csr_full', projectId: 'P1', assigneeId: 'w4' } },
        ]),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      project: { findMany: vi.fn(async () => [{ id: 'P1', status: 'ongoing' }, { id: 'P2', status: 'ongoing' }, { id: 'P3', status: 'closed' }]) },
      checklistTemplate: {
        findFirst: vi.fn(async ({ where }: { where: { projectId?: string | null } }) =>
          (where.projectId === 'P2' && opts.overrideInP2 ? { id: 'tpl-p2' } : where.projectId === undefined || where.projectId === null ? { id: 'tpl-2' } : null)),
      },
      documentRaci: { findMany: vi.fn(async () => [{ documentId: 'D1', userId: 'co-author' }]) },
      projectMember: { findMany: vi.fn(async () => [{ projectId: 'P1', userId: 'pm-1' }, { projectId: 'P1', userId: 'writer' }]) },
    }
  }

  it('notifies the Authors (R and assignee) and the PMs of each affected open-project document, once each', async () => {
    const p = prisma({ overrideInP2: true })
    const send = vi.fn(async (_args: { recipientId: string; kind: string; linkPath?: string; payload?: Record<string, unknown> }) => ({}))
    const docs = await notifyChecklistTemplateUpdate(p as never, { send }, v2)
    // D2's project has its own override (keeps it); D3's project is closed.
    expect(docs).toEqual(['D1'])
    const sent = send.mock.calls.map(([a]) => [a.recipientId, a.kind])
    expect(sent).toEqual([
      ['co-author', 'checklist_template_update'], ['writer', 'checklist_template_update'],
      ['pm-1', 'checklist_template_update_project'],          // the writer who is also a PM gets one, as Author
    ])
    expect(send.mock.calls[0]![0]).toMatchObject({ linkPath: '/projects/P1/clinical-writing/documents/D1', payload: { fromVersion: 1, toVersion: 2 } })
    expect(p.checklistInstance.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['ci-1'] } }, data: { notificationSentAt: expect.any(Date) } })
  })

  it('only looks at documents still in flight (not at or past signature, not deleted) of either type spelling', async () => {
    const p = prisma()
    await notifyChecklistTemplateUpdate(p as never, { send: vi.fn(async () => ({})) }, v2)
    expect(p.checklistInstance.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        templateId: { not: 'tpl-2' },
        document: expect.objectContaining({ deletedAt: null, status: { notIn: ['pending_signature', 'signed'] }, type: { in: ['csr_full', 'csr-full'] } }),
      }),
    }))
  })
})

// --- Routes -------------------------------------------------------------------

const USERS: Record<string, AuthenticatedUser> = {
  'pm-a':   { id: 'pm-a', email: 'a@x', role: 'pm', modules: ['A'], tenantId: null },
  'pm-b':   { id: 'pm-b', email: 'b@x', role: 'pm', modules: ['A'], tenantId: null },
  author:   { id: 'author', email: 'r@x', role: 'contributor', modules: ['A'], tenantId: null },
  reviewer: { id: 'reviewer', email: 'c@x', role: 'contributor', modules: ['A'], tenantId: null },
}

function routesApp(opts: { docStatus?: string } = {}) {
  const draft = { id: 'tpl-2', deliverableType: 'csr_full', projectId: null, version: 2, changeReason: 'Branched', templateStatus: 'draft', createdBy: 'pm-a', isCurrent: false, effectiveDate: day(20), approvedBy: null, approvedAt: null, createdAt: day(20) }
  const v2Items = [tItem('n1', 'Synopsis present'), tItem('n3', 'Estimand described')]
  const instance = {
    id: 'ci-1', documentId: 'D1', templateId: 'tpl-1', templateVersion: 1, createdAt: day(10), template: version({}),
    items: [iItem('a', 'Synopsis present', { status: 'complete' }), iItem('c', 'Old requirement')],
    document: { type: 'csr_full', projectId: 'P1', status: opts.docStatus ?? 'in_authoring' },
  }
  const writes: Array<[string, unknown]> = []
  const tx = {
    checklistTemplate: { updateMany: vi.fn(async () => ({})), update: vi.fn(async ({ data }: { data: object }) => ({ ...draft, ...data })) },
    checklistInstanceItem: {
      create: vi.fn(async (a: unknown) => { writes.push(['create', a]); return {} }),
      update: vi.fn(async (a: unknown) => { writes.push(['update', a]); return {} }),
    },
    checklistInstance: { update: vi.fn(async (a: unknown) => { writes.push(['instance', a]); return {} }) },
  }
  const prisma = {
    ...tx,
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    checklistTemplate: {
      ...tx.checklistTemplate,
      findUnique: vi.fn(async () => ({ ...draft, items: [], _count: { instances: 0 } })),
      findFirst: vi.fn(async () => ({ ...draft, id: 'tpl-2', templateStatus: 'locked', isCurrent: true, items: v2Items })),
    },
    checklistInstance: { ...tx.checklistInstance, findUnique: vi.fn(async () => instance), findMany: vi.fn(async () => []) },
    user: { findMany: vi.fn(async () => [{ id: 'pm-a', name: 'Alex Thornton' }]) },
    document: { findUnique: vi.fn(async () => ({ id: 'D1', projectId: 'P1', assigneeId: 'author' })) },
    // The Author holds R; the Reviewer holds C.
    documentRaci: {
      findFirst: vi.fn(async ({ where }: { where: { userId: string; letter?: string | { in: string[] } } }) => {
        const letter = where.userId === 'author' ? 'R' : where.userId === 'reviewer' ? 'C' : null
        if (!letter) return null
        const wanted = typeof where.letter === 'string' ? [where.letter] : where.letter?.in
        return !wanted || wanted.includes(letter) ? { id: `raci-${letter}`, letter } : null
      }),
      findMany: vi.fn(async ({ where }: { where: { userId?: string } }) =>
        (where.userId === 'author' ? [{ letter: 'R' }] : where.userId === 'reviewer' ? [{ letter: 'C' }] : [])),
    },
    project: { findUnique: vi.fn(async () => ({ id: 'P1', status: 'ongoing' })) },
    signatureChain: { findFirst: vi.fn(async () => null) },
    projectMember: { findMany: vi.fn(async () => [{ projectId: 'P1' }]) },
    projectTeamMember: { findMany: vi.fn(async () => []) },
    raciAssignment: { findMany: vi.fn(async () => []) },
  }
  const append = vi.fn(async () => undefined)
  const audit = { append, pageForEntity: vi.fn(async () => ({ rows: [{ actorId: 'pm-c', action: 'checklist_template_item_added' }], total: 1 })) }
  return { prisma, audit, append, writes }
}

async function build(as: keyof typeof USERS, opts: { docStatus?: string } = {}) {
  const t = routesApp(opts)
  const app = Fastify()
  app.decorate('prisma', t.prisma as never)
  app.decorate('audit', t.audit as never)
  app.decorate('notifications', { send: vi.fn(async () => ({})) } as never)
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (req) => { (req as unknown as { user: AuthenticatedUser }).user = USERS[as]! })
  await app.register(checklistTemplateAdminRoutes, { prefix: '/checklist-templates' })
  await app.register(checklistRoutes, { prefix: '/documents' })
  await app.ready()
  return { app, ...t }
}

beforeEach(() => { process.env.FEATURE_MODULES_ENABLED = 'A' })

describe('POST /checklist-templates/:id/approve — approval cycle (CW-029)', () => {
  it.each([['its creator', 'pm-a']])('refuses %s', async (_l, who) => {
    const { app, prisma } = await build(who as keyof typeof USERS)
    const res = await app.inject({ method: 'POST', url: '/checklist-templates/tpl-2/approve', payload: {} })
    expect(res.statusCode).toBe(403)
    expect(res.json().error).toBe('template_self_approval')
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('lets another PM approve; the version becomes effective then, and in-flight documents are looked up for notice', async () => {
    const { app, prisma, append } = await build('pm-b')
    const res = await app.inject({ method: 'POST', url: '/checklist-templates/tpl-2/approve', payload: {} })
    expect(res.statusCode).toBe(200)
    const data = (prisma.checklistTemplate.update.mock.calls[0]![0] as { data: { approvedBy: string; approvedAt: Date; effectiveDate: Date } }).data
    expect(data.approvedBy).toBe('pm-b')
    expect(data.effectiveDate).toEqual(data.approvedAt)
    expect(prisma.checklistInstance.findMany).toHaveBeenCalled()
    expect(append).toHaveBeenCalledWith(expect.objectContaining({ action: 'checklist_template_approved', details: expect.objectContaining({ authoredBy: 'pm-a', inFlightDocumentsNotified: 0 }) }))
  })

  it('tells the screen who authored a draft and whether the caller may approve it', async () => {
    const author = await build('pm-a')
    expect((await author.app.inject({ method: 'GET', url: '/checklist-templates/tpl-2' })).json()).toMatchObject({ canApprove: false, createdByName: 'Alex Thornton', draftAuthors: ['Alex Thornton', 'pm-c'] })
    const other = await build('pm-b')
    expect((await other.app.inject({ method: 'GET', url: '/checklist-templates/tpl-2' })).json()).toMatchObject({ canApprove: true })
  })
})

describe('newer template on a document (CW-028)', () => {
  it('previews exactly what adopting would change, without changing anything', async () => {
    const { app, writes } = await build('author')
    const res = await app.inject({ method: 'GET', url: '/documents/D1/checklist/template-update' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({
      currentVersion: 1, available: { templateId: 'tpl-2', version: 2, scope: 'platform' }, canAdopt: true,
      added: [{ text: 'Estimand described' }], removed: [{ text: 'Old requirement' }], unchangedCount: 1,
    })
    expect(writes).toEqual([])
  })

  it('a Reviewer sees the notice but cannot adopt', async () => {
    const { app } = await build('reviewer')
    expect((await app.inject({ method: 'GET', url: '/documents/D1/checklist/template-update' })).json()).toMatchObject({ canAdopt: false })
    const res = await app.inject({ method: 'POST', url: '/documents/D1/checklist/adopt-template', payload: { templateId: 'tpl-2' } })
    expect(res.statusCode).toBe(403)
    expect(res.json().error).toBe('template_adopt_forbidden')
  })

  it('the Author adopts: new items pending, progress kept, dropped items removed with the reason, audited', async () => {
    const { app, writes, append } = await build('author')
    const res = await app.inject({ method: 'POST', url: '/documents/D1/checklist/adopt-template', payload: { templateId: 'tpl-2' } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ templateVersion: 2, added: 1, changed: 0, removed: 1, unchanged: 1 })
    expect(writes).toContainEqual(['create', { data: expect.objectContaining({ instanceId: 'ci-1', templateItemId: 'n3', text: 'Estimand described' }) }])
    // The completed item keeps its status (no status in the update).
    expect(writes).toContainEqual(['update', { where: { id: 'a' }, data: expect.not.objectContaining({ status: expect.anything() }) }])
    expect(writes).toContainEqual(['update', { where: { id: 'c' }, data: expect.objectContaining({ status: 'removed', waivedBy: 'author', waiverReason: 'Not in checklist template v2 (adopted from v1)' }) }])
    expect(writes).toContainEqual(['instance', { where: { id: 'ci-1' }, data: { templateId: 'tpl-2', templateVersion: 2, notificationSentAt: null } }])
    expect(append).toHaveBeenCalledWith(expect.objectContaining({ action: 'checklist_template_adopted', entityId: 'D1', details: expect.objectContaining({ fromVersion: 1, toVersion: 2 }) }))
  })

  it('refuses when the version reviewed is no longer the current one', async () => {
    const { app, writes } = await build('author')
    const res = await app.inject({ method: 'POST', url: '/documents/D1/checklist/adopt-template', payload: { templateId: 'tpl-OLD' } })
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toBe('template_update_changed')
    expect(writes).toEqual([])
  })

  it('refuses once the document is at signature: its checklist is fixed', async () => {
    const { app, writes } = await build('author', { docStatus: 'pending_signature' })
    const res = await app.inject({ method: 'POST', url: '/documents/D1/checklist/adopt-template', payload: { templateId: 'tpl-2' } })
    expect(res.statusCode).toBe(409)
    expect(writes).toEqual([])
  })
})
