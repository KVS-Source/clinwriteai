// Document checklist — names + canEdit on the list, and the remove route
// (PRD FR-A-001b / FR-A-001d): reason required, R-only, audited, disclosed
// in the Compliance Summary, and ignored by the submit gate and rollups.

import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from '../../../auth/rbac.js'
import { checklistRoutes } from './routes.js'

const DOC = 'DOC-1'

const row = (over: Record<string, unknown>) => ({
  id: 'i1', instanceId: 'inst', templateItemId: null, text: 'Protocol uploaded', framework: 'ICH E3', frameworkMandatory: true,
  ownerRaci: 'R', stage: 'study_start_up', autoCompleteOn: null, status: 'pending', isUserAdded: false,
  completedBy: null, completedAt: null, waivedBy: null, waivedAt: null, waiverReason: null, sortOrder: 0, ...over,
})

async function build(items: Array<Record<string, unknown>>, user: Partial<AuthenticatedUser> = {}, letters: string[] = []) {
  const update = vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => ({ ...items.find(i => i.id === where.id), ...data }))
  const append = vi.fn()
  const instanceFindUnique = vi.fn(async () => ({ id: 'inst', documentId: DOC, templateVersion: 1, items }))
  const app = Fastify()
  app.decorate('prisma', {
    document: { findUnique: vi.fn(async () => ({ id: DOC, type: 'dsur', assigneeId: 'u-owner', projectId: 'p-1' })) },
    documentRaci: {
      findFirst: vi.fn(async () => null),
      findMany: vi.fn(async ({ where }: { where: { letter: { in: string[] } } }) =>
        letters.filter(l => where.letter.in.includes(l)).map(() => ({ documentId: DOC }))),
    },
    checklistInstance: {
      findUnique: instanceFindUnique,
    },
    checklistInstanceItem: {
      findFirst: vi.fn(async ({ where }: { where: { id: string } }) => items.find(i => i.id === where.id) ?? null),
      update,
    },
    user: { findMany: vi.fn(async () => [{ id: 'u-owner', name: 'Dr Priya Nair' }]) },
    regulatoryFramework: { findMany: vi.fn(async () => []) },
    ichSectionWaiver: { findMany: vi.fn(async () => []) },
  } as never)
  app.decorate('audit', { append } as never)
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (req) => {
    ;(req as unknown as { user: AuthenticatedUser }).user = {
      id: 'u-owner', email: 'u@x.io', role: 'contributor', capabilities: [], modules: ['A'], tenantId: null, ...user,
    } as AuthenticatedUser
  })
  await app.register(checklistRoutes, { prefix: '/documents' })
  await app.ready()
  return { app, update, append, instanceFindUnique }
}

const remove = (app: Awaited<ReturnType<typeof build>>['app'], payload: unknown) =>
  app.inject({ method: 'POST', url: `/documents/${DOC}/checklist/i1/remove`, payload: payload as never })

describe('GET /documents/:id/checklist', () => {
  it('returns names instead of user ids, plus canEdit', async () => {
    const { app } = await build([row({ status: 'complete', completedBy: 'u-owner', completedAt: new Date() })])
    const body = (await app.inject({ method: 'GET', url: `/documents/${DOC}/checklist` })).json()
    expect(body[0]).toMatchObject({ completedBy: 'Dr Priya Nair', canEdit: true })
  })

  it('canEdit is false for a reviewer, who can view but is not R, assignee or admin', async () => {
    const { app } = await build([row({})], { id: 'u-other' }, ['C'])
    const body = (await app.inject({ method: 'GET', url: `/documents/${DOC}/checklist` })).json()
    expect(body[0].canEdit).toBe(false)
  })

  it.each([
    ['Informed', { id: 'u-other' }, ['I']],
    ['someone not on the document', { id: 'u-other' }, []],
    ['a tenant admin', { id: 'u-other', role: 'tenant-admin' }, []],
    ['a guest account', { id: 'u-other', role: 'guest' }, ['C']],
  ] as const)('refuses %s, without reading or creating a checklist', async (_label, user, letters) => {
    const { app, instanceFindUnique } = await build([row({})], user as Partial<AuthenticatedUser>, [...letters])
    const res = await app.inject({ method: 'GET', url: `/documents/${DOC}/checklist` })
    expect(res.statusCode).toBe(403)
    expect(res.json().error).toBe('checklist_view_forbidden')
    expect(instanceFindUnique).not.toHaveBeenCalled()
    expect((await app.inject({ method: 'GET', url: `/documents/${DOC}/checklist/access` })).json()).toEqual({ canView: false })
  })

  it('stays open to an auditor', async () => {
    const { app } = await build([row({})], { id: 'u-other', role: 'auditor' })
    expect((await app.inject({ method: 'GET', url: `/documents/${DOC}/checklist` })).statusCode).toBe(200)
    expect((await app.inject({ method: 'GET', url: `/documents/${DOC}/checklist/access` })).json()).toEqual({ canView: true })
  })

  it('shapes a removed item with a removal block and no waiver fields', async () => {
    const { app } = await build([row({ status: 'removed', waivedBy: 'u-owner', waivedAt: new Date('2026-10-30T10:00:00Z'), waiverReason: 'Not applicable to DSUR' })])
    const [item] = (await app.inject({ method: 'GET', url: `/documents/${DOC}/checklist` })).json()
    expect(item).toMatchObject({ status: 'removed', waivedBy: null, waiverReason: null, removal: { by: 'Dr Priya Nair', reason: 'Not applicable to DSUR' } })
  })
})

describe('POST /documents/:id/checklist/:itemId/remove', () => {
  it('removes a mandatory item with a reason and writes an audit entry', async () => {
    const { app, update, append } = await build([row({})])
    const res = await remove(app, { reason: 'Not applicable to this document' })
    expect(res.statusCode).toBe(200)
    expect(update.mock.calls[0]![0].data).toMatchObject({ status: 'removed', waivedBy: 'u-owner', waiverReason: 'Not applicable to this document' })
    expect(append.mock.calls[0]![0]).toMatchObject({
      action: 'checklist_item_removed',
      details: { itemId: 'i1', frameworkMandatory: true, previousStatus: 'pending', reason: 'Not applicable to this document' },
    })
  })

  it('requires a reason', async () => {
    const { app, update } = await build([row({})])
    expect((await remove(app, {})).statusCode).toBe(400)
    expect((await remove(app, { reason: 'x' })).statusCode).toBe(400)
    expect(update).not.toHaveBeenCalled()
  })

  it('is forbidden for a user who is not R, assignee or admin', async () => {
    const { app, update } = await build([row({})], { id: 'u-other' })
    const res = await remove(app, { reason: 'Because I can' })
    expect(res.statusCode).toBe(403)
    expect(update).not.toHaveBeenCalled()
  })

  it('409s when the item is already removed, and 404s for an unknown item', async () => {
    const { app } = await build([row({ status: 'removed' })])
    expect((await remove(app, { reason: 'again please' })).statusCode).toBe(409)
    expect((await app.inject({ method: 'POST', url: `/documents/${DOC}/checklist/nope/remove`, payload: { reason: 'whatever' } })).statusCode).toBe(404)
  })

  it('a removed item can no longer be completed or waived', async () => {
    const { app } = await build([row({ status: 'removed' })])
    expect((await app.inject({ method: 'PATCH', url: `/documents/${DOC}/checklist/i1/complete`, payload: {} })).statusCode).toBe(409)
    expect((await app.inject({ method: 'PATCH', url: `/documents/${DOC}/checklist/i1/waive`, payload: { reason: 'later' } })).statusCode).toBe(409)
  })
})

const reopen = (app: Awaited<ReturnType<typeof build>>['app'], payload: unknown = {}) =>
  app.inject({ method: 'POST', url: `/documents/${DOC}/checklist/i1/reopen`, payload: payload as never })

describe('POST /documents/:id/checklist/:itemId/reopen', () => {
  it('un-ticks a completed item without a reason and clears the completion', async () => {
    const { app, update, append } = await build([row({ status: 'complete', completedBy: 'u-owner', completedAt: new Date() })])
    const res = await reopen(app)
    expect(res.statusCode).toBe(200)
    expect(update.mock.calls[0]![0].data).toMatchObject({ status: 'pending', completedBy: null, completedAt: null })
    expect(append.mock.calls[0]![0]).toMatchObject({ action: 'checklist_item_reopened', details: { previousStatus: 'complete', reason: null } })
  })

  it('un-waiving needs a reason, records it, and clears the waiver', async () => {
    const { app, update, append } = await build([row({ status: 'waived', waivedBy: 'u-owner', waivedAt: new Date(), waiverReason: 'N/A for DSUR' })])
    expect((await reopen(app)).statusCode).toBe(400)
    expect(update).not.toHaveBeenCalled()
    const res = await reopen(app, { reason: 'It does apply after all' })
    expect(res.statusCode).toBe(200)
    expect(update.mock.calls[0]![0].data).toMatchObject({ status: 'pending', waivedBy: null, waivedAt: null, waiverReason: null })
    expect(append.mock.calls[0]![0].details).toMatchObject({ previousStatus: 'waived', previousWaiverReason: 'N/A for DSUR', reason: 'It does apply after all' })
  })

  it('is R-only and only applies to complete or waived items', async () => {
    expect((await reopen((await build([row({ status: 'complete' })], { id: 'u-other' })).app)).statusCode).toBe(403)
    expect((await reopen((await build([row({ status: 'pending' })])).app)).statusCode).toBe(409)
    expect((await reopen((await build([row({ status: 'removed' })])).app)).statusCode).toBe(409)
  })
})

describe('POST /documents/:id/checklist — add item', () => {
  it('stores the mandatory flag and stage', async () => {
    const { app } = await build([row({})])
    ;(app as unknown as { prisma: { checklistInstanceItem: Record<string, unknown> } }).prisma.checklistInstanceItem.aggregate = vi.fn(async () => ({ _max: { sortOrder: 10 } }))
    const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'new', ...data }))
    ;(app as unknown as { prisma: { checklistInstanceItem: Record<string, unknown> } }).prisma.checklistInstanceItem.create = create
    const res = await app.inject({ method: 'POST', url: `/documents/${DOC}/checklist`, payload: { text: 'QC sign-off', framework: 'ICH E3', frameworkMandatory: true, stage: 'during_study' } })
    expect(res.statusCode).toBe(201)
    expect(create.mock.calls[0]![0].data).toMatchObject({ text: 'QC sign-off', framework: 'ICH E3', frameworkMandatory: true, stage: 'during_study', isUserAdded: true, sortOrder: 20 })
  })

  it('rejects an unknown stage', async () => {
    const { app } = await build([row({})])
    expect((await app.inject({ method: 'POST', url: `/documents/${DOC}/checklist`, payload: { text: 'x', stage: 'whenever' } })).statusCode).toBe(400)
  })
})

describe('GET /documents/:id/compliance-summary — removals', () => {
  it('discloses removed Framework Mandatory items and leaves them out of the rules', async () => {
    const { app } = await build([
      row({ id: 'i1', status: 'removed', waivedBy: 'u-owner', waivedAt: new Date('2026-10-30T10:00:00Z'), waiverReason: 'Not applicable to DSUR' }),
      row({ id: 'i2', text: 'Optional extra', frameworkMandatory: false, status: 'removed', waivedBy: 'u-owner', waiverReason: 'unneeded' }),
      row({ id: 'i3', text: 'Kept item' }),
    ])
    const body = (await app.inject({ method: 'GET', url: `/documents/${DOC}/compliance-summary` })).json()
    expect(body.removedMandatory).toEqual([{
      text: 'Protocol uploaded', framework: 'ICH E3', removedBy: 'Dr Priya Nair',
      removedAt: '2026-10-30T10:00:00.000Z', reason: 'Not applicable to DSUR',
    }])
    expect(body.frameworks[0].rules.map((r: { text: string }) => r.text)).toEqual(['Kept item'])
  })
})
