// Changing deadlines after creation: the target completion date is the PM's, the review due
// date the authors'. Both are audited with old and new, and stop on a signed document or a
// closed project. Through Fastify inject() with a stubbed Prisma.

import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from '../../../auth/rbac.js'
import { documentsRoutes } from './routes.js'

const DOC = 'doc-1'
const FUTURE = '2099-03-15'
const OLD_DAY = new Date('2099-01-10T00:00:00.000Z')

async function build(opts: {
  role?: AuthenticatedUser['role']
  status?: string
  projectStatus?: string
  rRow?: boolean
  memberOf?: string[]
  target?: Date | null
  reviewDue?: Date | null
} = {}) {
  const doc = {
    id: DOC, projectId: 'p-1', status: opts.status ?? 'in_review', assigneeId: 'someone-else',
    targetCompletionDate: opts.target === undefined ? OLD_DAY : opts.target,
    reviewDueAt: opts.reviewDue === undefined ? OLD_DAY : opts.reviewDue,
  }
  const update = vi.fn(async ({ data }: { data: Record<string, unknown> }) => Object.assign(doc, data))
  const append = vi.fn(async () => ({}))
  const userId = 'u-1'
  const app = Fastify()
  app.decorate('prisma', {
    document: { findUnique: vi.fn(async () => doc), findMany: vi.fn(async () => []), update },
    project: { findUnique: vi.fn(async () => ({ status: opts.projectStatus ?? 'ongoing' })) },
    projectMember: { findMany: vi.fn(async () => (opts.memberOf ?? ['p-1']).map(projectId => ({ projectId }))) },
    projectTeamMember: { findMany: vi.fn(async () => []) },
    documentRaci: { findMany: vi.fn(async () => (opts.rRow ? [{ userId }] : [{ userId: 'another-author' }])) },
  } as never)
  app.decorate('audit', { append } as never)
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (req) => {
    const user: AuthenticatedUser = { id: userId, email: 'u@x', role: opts.role ?? 'contributor', modules: ['A'], tenantId: null }
    ;(req as unknown as { user: AuthenticatedUser }).user = user
  })
  await app.register(documentsRoutes, { prefix: '/documents' })
  await app.ready()
  const target = (date: unknown) => app.inject({ method: 'PATCH', url: `/documents/${DOC}/target-date`, payload: { date } as never })
  const review = (date: unknown) => app.inject({ method: 'PATCH', url: `/documents/${DOC}/review-due-date`, payload: { date } as never })
  const access = async () => (await app.inject({ method: 'GET', url: `/documents/${DOC}/deadlines/access` })).json()
  return { app, doc, update, append, target, review, access }
}

describe('target completion date', () => {
  it('a PM changes it, and it is audited with old and new', async () => {
    const t = await build({ role: 'pm' })
    const res = await t.target(FUTURE)
    expect(res.statusCode).toBe(200)
    expect(t.doc.targetCompletionDate).toEqual(new Date(`${FUTURE}T00:00:00.000Z`))
    expect(t.append).toHaveBeenCalledWith(expect.objectContaining({
      action: 'document_target_date_changed', entityType: 'document', entityId: DOC,
      details: { from: '2099-01-10', to: FUTURE },
    }))
    await t.app.close()
  })

  it('a PM can clear it, since it was optional at creation', async () => {
    const t = await build({ role: 'pm' })
    expect((await t.target(null)).statusCode).toBe(200)
    expect(t.doc.targetCompletionDate).toBeNull()
    expect(t.append).toHaveBeenCalledWith(expect.objectContaining({ details: { from: '2099-01-10', to: null } }))
    await t.app.close()
  })

  it('saving the same date writes nothing', async () => {
    const t = await build({ role: 'pm' })
    expect((await t.target('2099-01-10')).statusCode).toBe(200)
    expect(t.update).not.toHaveBeenCalled()
    expect(t.append).not.toHaveBeenCalled()
    await t.app.close()
  })

  it.each(['contributor', 'tenant-admin', 'auditor'] as const)('refuses a %s, even holding R', async (role) => {
    const t = await build({ role, rRow: true })
    expect((await t.target(FUTURE)).statusCode).toBe(403)
    expect(t.update).not.toHaveBeenCalled()
    await t.app.close()
  })

  it('answers 404 for a PM who cannot see the project', async () => {
    const t = await build({ role: 'pm', memberOf: ['p-other'] })
    expect((await t.target(FUTURE)).statusCode).toBe(404)
    expect(t.update).not.toHaveBeenCalled()
    await t.app.close()
  })

  it('still works before review, and stops once signed or closed', async () => {
    const early = await build({ role: 'pm', status: 'not_started' })
    expect((await early.target(FUTURE)).statusCode).toBe(200)
    await early.app.close()
    for (const opts of [{ status: 'signed' }, { projectStatus: 'closed' }]) {
      const t = await build({ role: 'pm', ...opts })
      const res = await t.target(FUTURE)
      expect(res.statusCode).toBe(409)
      expect(res.json().error).toBe('deadline_locked')
      expect(t.update).not.toHaveBeenCalled()
      await t.app.close()
    }
  })
})

describe('review due date', () => {
  it.each(['in_review', 'crm_in_progress'])('an author changes it during %s, and it is audited', async (status) => {
    const t = await build({ rRow: true, status })
    expect((await t.review(FUTURE)).statusCode).toBe(200)
    expect(t.doc.reviewDueAt).toEqual(new Date(`${FUTURE}T00:00:00.000Z`))
    expect(t.append).toHaveBeenCalledWith(expect.objectContaining({
      action: 'document_review_due_changed', entityId: DOC, details: { from: '2099-01-10', to: FUTURE },
    }))
    await t.app.close()
  })

  it('refuses someone who is not an author, including a PM without R', async () => {
    for (const opts of [{ rRow: false }, { role: 'pm' as const, rRow: false }, { role: 'tenant-admin' as const, rRow: true }]) {
      const t = await build(opts)
      const res = await t.review(FUTURE)
      expect(res.statusCode).toBe(403)
      expect(t.update).not.toHaveBeenCalled()
      await t.app.close()
    }
  })

  it('refuses an auditor through the read-only guard', async () => {
    const t = await build({ role: 'auditor', rRow: true })
    const res = await t.review(FUTURE)
    expect(res.statusCode).toBe(403)
    expect(res.json().error).toBe('auditor_read_only')
    await t.app.close()
  })

  it.each(['not_started', 'in_authoring', 'pending_signature'])('is refused while the document is %s', async (status) => {
    const t = await build({ rRow: true, status })
    const res = await t.review(FUTURE)
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toBe('not_in_review')
    expect(t.update).not.toHaveBeenCalled()
    await t.app.close()
  })

  it('stops once signed or the project is closed', async () => {
    for (const opts of [{ status: 'signed' }, { projectStatus: 'closed' }]) {
      const t = await build({ rRow: true, ...opts })
      expect((await t.review(FUTURE)).json().error).toBe('deadline_locked')
      await t.app.close()
    }
  })

  it('cannot be cleared', async () => {
    const t = await build({ rRow: true })
    expect((await t.review(null)).statusCode).toBe(400)
    await t.app.close()
  })
})

describe('date validation', () => {
  it.each(['2099-02-31', '15-03-2099', 'soon', '', 42])('refuses %s', async (bad) => {
    const t = await build({ role: 'pm' })
    expect((await t.target(bad)).statusCode).toBe(400)
    await t.app.close()
  })

  it('refuses a day already past, on both dates, but not an unchanged old one', async () => {
    const pm = await build({ role: 'pm', target: new Date('2020-01-01T00:00:00.000Z') })
    const past = await pm.target('2020-06-01')
    expect(past.statusCode).toBe(422)
    expect(past.json().error).toBe('deadline_in_past')
    expect((await pm.target('2020-01-01')).statusCode).toBe(200)
    expect(pm.update).not.toHaveBeenCalled()
    await pm.app.close()
    const author = await build({ rRow: true })
    expect((await author.review('2020-06-01')).statusCode).toBe(422)
    await author.app.close()
  })
})

describe('GET deadlines/access', () => {
  it.each([
    ['a PM in review', { role: 'pm' as const }, { canEditTarget: true, canEditReviewDue: false }],
    ['a PM holding R in review', { role: 'pm' as const, rRow: true }, { canEditTarget: true, canEditReviewDue: true }],
    ['an author in review', { rRow: true }, { canEditTarget: false, canEditReviewDue: true }],
    ['an author before review', { rRow: true, status: 'in_authoring' }, { canEditTarget: false, canEditReviewDue: false }],
    ['someone else', {}, { canEditTarget: false, canEditReviewDue: false }],
    ['a PM on a signed document', { role: 'pm' as const, status: 'signed' }, { canEditTarget: false, canEditReviewDue: false }],
    ['a PM on a closed project', { role: 'pm' as const, projectStatus: 'closed' }, { canEditTarget: false, canEditReviewDue: false }],
  ])('%s', async (_label, opts, expected) => {
    const t = await build(opts)
    expect(await t.access()).toEqual(expected)
    await t.app.close()
  })
})
