// POST /documents/:id/nudge is for authors (R) only — an active R row, or the
// assignee on a document with no R rows yet. C, Q, A, I, auditors, admins and
// PMs without R are refused (403). The 24-hour limit per (document, actor,
// target) still applies to authors. Fastify inject() with an in-memory stub;
// the real nudgePendingCohort runs behind the gate.

import Fastify from 'fastify'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from '../../../auth/rbac.js'
import { documentRaciRoutes } from './routes.js'
import { _resetNudgeThrottle } from './nudge.js'

afterEach(() => _resetNudgeThrottle())

type Row = Record<string, unknown>
const row = (userId: string, letter: string, extra: Row = {}): Row => ({
  userId, letter, sectionId: null, signatureRequired: false, submittedAt: null, reviewedAt: null,
  approvedAt: null, signatureId: null, rejectedAt: null, removedAt: null, ...extra,
})

// Ann (R, submitted) and Ben (R, still to submit); Cara C, Quinn Q, Ava A, Ian I.
const ROWS: Row[] = [
  row('u-ann', 'R', { submittedAt: new Date('2026-11-01T00:00:00Z') }),
  row('u-ben', 'R'),
  row('u-cara', 'C'), row('u-quinn', 'Q'), row('u-ava', 'A'), row('u-ian', 'I'),
]

async function build(actor: Partial<AuthenticatedUser>, opts: { rows?: Row[]; assignee?: string } = {}) {
  const rows = opts.rows ?? ROWS
  const createMany = vi.fn(async ({ data }: { data: unknown[] }) => ({ count: data.length }))
  const audit = vi.fn(async () => ({}))
  const app = Fastify()
  app.decorate('prisma', {
    project: { findUnique: async () => ({ status: 'ongoing' }) },

    document: { count: async () => 1,  findUnique: vi.fn(async () => ({ id: 'd-1', status: 'in_authoring', title: 'CSR', projectId: 'p-1', assigneeId: opts.assignee ?? 'u-ann' })) },
    documentRaci: {
      findMany: vi.fn(async ({ where }: { where: Row }) => rows.filter(r =>
        (where.letter === undefined || r.letter === where.letter) &&
        (where.removedAt === undefined || r.removedAt === where.removedAt))),
    },
    notification: { createMany },
  } as never)
  app.decorate('audit', { append: audit } as never)
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (req) => {
    const user: AuthenticatedUser = { id: 'u-ann', email: 'x@x', role: 'contributor', modules: ['A'], tenantId: null, ...actor }
    ;(req as unknown as { user: AuthenticatedUser }).user = user
  })
  await app.register(documentRaciRoutes, { prefix: '/documents' })
  await app.ready()
  const nudge = () => app.inject({ method: 'POST', url: '/documents/d-1/nudge', payload: { targetUserIds: ['u-ben'] } })
  return { app, nudge, createMany, audit }
}

process.env.FEATURE_MODULES_ENABLED = 'A,B,C,D,E'

describe('nudge — authors (R) only', () => {
  it.each([
    ['a reviewer (C)', { id: 'u-cara' }],
    ['a QC reviewer (Q)', { id: 'u-quinn' }],
    ['an approver (A)', { id: 'u-ava' }],
    ['someone informed (I)', { id: 'u-ian' }],
    ['a PM without R', { id: 'u-pm', role: 'pm' as const }],
    ['a tenant admin', { id: 'u-admin', role: 'tenant-admin' as const }],
    ['an auditor, even holding R', { id: 'u-ben', role: 'auditor' as const }],
  ])('%s is refused (403) and nobody is notified', async (_l, actor) => {
    const t = await build(actor)
    const res = await t.nudge()
    expect(res.statusCode).toBe(403)
    expect(res.json().error).toBe((actor as { role?: string }).role === 'auditor' ? 'auditor_read_only' : 'nudge_forbidden')
    expect(t.createMany).not.toHaveBeenCalled()
    expect(t.audit).not.toHaveBeenCalled()
  })

  it('an author nudges a pending co-author; the 24-hour limit per person still applies', async () => {
    const t = await build({ id: 'u-ann' })
    const first = await t.nudge()
    expect(first.statusCode).toBe(200)
    expect(first.json().decisions).toEqual([expect.objectContaining({ targetUserId: 'u-ben', status: 'nudged' })])
    expect(t.createMany).toHaveBeenCalledTimes(1)

    const again = await t.nudge()                                   // same author, same person, within 24h
    expect(again.statusCode).toBe(200)
    expect(again.json().decisions[0].status).toBe('throttled')
    expect(t.createMany).toHaveBeenCalledTimes(1)                   // no second notification
    expect(t.audit).toHaveBeenCalledTimes(1)                        // only the real nudge is audited
  })

  it('a PM holding R (to sign as author) may nudge', async () => {
    const t = await build({ id: 'u-pm', role: 'pm' }, { rows: [...ROWS, row('u-pm', 'R', { submittedAt: new Date() })] })
    expect((await t.nudge()).statusCode).toBe(200)
  })

  it("the assignee may nudge on a document with no R rows yet, but not once R rows exist without them", async () => {
    const noR = await build({ id: 'u-zed' }, { rows: [row('u-cara', 'C')], assignee: 'u-zed' })
    expect((await noR.nudge()).statusCode).toBe(200)

    const withR = await build({ id: 'u-zed' }, { assignee: 'u-zed' })   // R rows exist; u-zed holds none
    expect((await withR.nudge()).statusCode).toBe(403)
  })
})
