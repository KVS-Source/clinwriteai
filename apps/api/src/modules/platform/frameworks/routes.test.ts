// Regulatory framework registry — marking a framework superseded is a two-person decision:
//   a Project Manager sends it for approval (POST /:id/supersede-request), every other PM and QC is notified,
//   and another PM or a QC approves (the framework is retired) or rejects it with a reason. The requester can't
//   decide their own request, and there is no direct retire. Adding a framework stays admin-only.

import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from '../../../auth/rbac.js'
import { frameworksRoutes } from './routes.js'

type Req = { id: string; frameworkId: string; requestedBy: string; requestedAt: Date; reason: string | null; status: string; decidedBy: string | null; decidedAt: Date | null; rejectionReason: string | null }

async function build(user: { id: string; role: string; roles?: string[] }, seed: { pending?: Partial<Req>; retired?: boolean } = {}) {
  const fw = { id: 'fw-1', name: 'ICC 45', version: 'r1', retiredAt: seed.retired ? new Date() : null as Date | null }
  const requests: Req[] = seed.pending ? [{
    id: 'req-1', frameworkId: 'fw-1', requestedBy: 'u-pm-a', requestedAt: new Date(), reason: null, status: 'pending',
    decidedBy: null, decidedAt: null, rejectionReason: null, ...seed.pending,
  }] : []
  const sent: Array<{ recipientId: string; kind: string; title: string; body: string; linkPath: string }> = []
  const audit: Array<{ action: string; details: Record<string, unknown> }> = []
  const users = [
    { id: 'u-pm-a', name: 'Pat PM', role: 'pm', additionalRoles: [], status: 'active' },
    { id: 'u-pm-b', name: 'Paula PM', role: 'pm', additionalRoles: [], status: 'active' },
    { id: 'u-qc', name: 'Quinn QC', role: 'qc', additionalRoles: [], status: 'active' },
    { id: 'u-both', name: 'Contrib PM', role: 'contributor', additionalRoles: ['pm'], status: 'active' },
    { id: 'u-con', name: 'Cora', role: 'contributor', additionalRoles: [], status: 'active' },
    { id: 'u-qc-off', name: 'Old QC', role: 'qc', additionalRoles: [], status: 'suspended' },
  ]
  const prisma = {
    regulatoryFramework: {
      findUnique: vi.fn(async () => fw),
      update: vi.fn(async ({ data }: { data: { retiredAt: Date } }) => { fw.retiredAt = data.retiredAt; return fw }),
      create: vi.fn(),
    },
    frameworkStatusRequest: {
      findFirst: vi.fn(async ({ where }: { where: { frameworkId: string; status: string } }) => requests.find(r => r.frameworkId === where.frameworkId && r.status === where.status) ?? null),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => { const r = requests.find(x => x.id === where.id); return r ? { ...r, framework: fw } : null }),
      findMany: vi.fn(async () => requests),
      create: vi.fn(async ({ data }: { data: Partial<Req> }) => { const r = { id: 'req-new', requestedAt: new Date(), reason: null, status: 'pending', decidedBy: null, decidedAt: null, rejectionReason: null, ...data } as Req; requests.push(r); return r }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<Req> }) => { const r = requests.find(x => x.id === where.id)!; Object.assign(r, data); return r }),
    },
    user: {
      findMany: vi.fn(async ({ where }: { where: { id?: { in?: string[]; not?: string }; status?: string; OR?: unknown } }) => {
        if (where.id?.in) return users.filter(u => where.id!.in!.includes(u.id))
        return users.filter(u => u.status === where.status && u.id !== where.id?.not && (['pm', 'qc'].includes(u.role) || u.additionalRoles.some(r => ['pm', 'qc'].includes(r))))
      }),
    },
    $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  }
  const app = Fastify()
  app.decorate('prisma', prisma as never)
  app.decorate('audit', { append: vi.fn(async (e: { action: string; details: Record<string, unknown> }) => { audit.push(e) }) } as never)
  app.decorate('notifications', { send: vi.fn(async (n: (typeof sent)[number]) => { sent.push(n) }) } as never)
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (r) => {
    Object.assign(r, { user: { id: user.id, email: `${user.id}@x.io`, role: user.role, ...(user.roles && { roles: user.roles }), modules: ['A'], tenantId: null } as AuthenticatedUser })
  })
  await app.register(frameworksRoutes)
  await app.ready()
  return { app, fw, requests, sent, audit }
}

describe('send for approval', () => {
  it('a PM sends it; every other active PM and QC is notified with a link to the framework', async () => {
    const { app, requests, sent, audit, fw } = await build({ id: 'u-pm-a', role: 'pm' })
    const res = await app.inject({ method: 'POST', url: '/fw-1/supersede-request', payload: { reason: 'Replaced by ICC 46' } })
    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({ status: 'pending', requestedBy: 'u-pm-a', reason: 'Replaced by ICC 46' })
    expect(fw.retiredAt).toBeNull()                                   // nothing is superseded yet
    expect(requests).toHaveLength(1)
    expect(sent.map(n => n.recipientId).sort()).toEqual(['u-both', 'u-pm-b', 'u-qc'])   // not the requester, not suspended, not a plain contributor
    expect(sent[0]).toMatchObject({ kind: 'framework_supersede_requested', linkPath: '/master-library/ich-frameworks?open=fw-1' })
    expect(sent[0]!.title).toContain('ICC 45')
    expect(audit.map(a => a.action)).toEqual(['framework_supersede_requested'])
    await app.close()
  })

  it.each([['tenant-admin'], ['qc'], ['contributor']])('%s cannot send for approval (403)', async (role) => {
    const { app } = await build({ id: 'u-x', role })
    expect((await app.inject({ method: 'POST', url: '/fw-1/supersede-request', payload: {} })).statusCode).toBe(403)
    await app.close()
  })

  it('refuses a second request while one is pending, and one for a framework already superseded', async () => {
    const pending = await build({ id: 'u-pm-b', role: 'pm' }, { pending: {} })
    expect((await pending.app.inject({ method: 'POST', url: '/fw-1/supersede-request', payload: {} })).json()).toMatchObject({ error: 'request_pending' })
    await pending.app.close()
    const retired = await build({ id: 'u-pm-b', role: 'pm' }, { retired: true })
    expect((await retired.app.inject({ method: 'POST', url: '/fw-1/supersede-request', payload: {} })).json()).toMatchObject({ error: 'already_retired' })
    await retired.app.close()
  })

  it('there is no direct retire any more', async () => {
    const { app } = await build({ id: 'u-pm-a', role: 'pm' })
    expect((await app.inject({ method: 'POST', url: '/fw-1/retire' })).statusCode).toBe(404)
    await app.close()
  })
})

describe('approve', () => {
  it.each([['another PM', 'u-pm-b', 'pm'], ['a QC', 'u-qc', 'qc']])('%s approves: the framework is superseded, audited, and the requester told', async (_l, id, role) => {
    const { app, fw, requests, sent, audit } = await build({ id, role }, { pending: {} })
    const res = await app.inject({ method: 'POST', url: '/supersede-requests/req-1/approve' })
    expect(res.statusCode).toBe(200)
    expect(fw.retiredAt).toBeInstanceOf(Date)
    expect(requests[0]).toMatchObject({ status: 'approved', decidedBy: id })
    expect(audit[0]).toMatchObject({ action: 'framework_retired', details: expect.objectContaining({ requestedBy: 'u-pm-a', approvedBy: id }) })
    expect(sent).toEqual([expect.objectContaining({ recipientId: 'u-pm-a', kind: 'framework_supersede_approved' })])
    await app.close()
  })

  it('the requester cannot approve their own request', async () => {
    const { app, fw } = await build({ id: 'u-pm-a', role: 'pm' }, { pending: {} })
    const res = await app.inject({ method: 'POST', url: '/supersede-requests/req-1/approve' })
    expect(res.statusCode).toBe(403)
    expect(res.json()).toMatchObject({ error: 'own_request' })
    expect(fw.retiredAt).toBeNull()
    await app.close()
  })

  it.each([['tenant-admin'], ['contributor'], ['auditor']])('%s cannot approve (403)', async (role) => {
    const { app } = await build({ id: 'u-x', role }, { pending: {} })
    expect((await app.inject({ method: 'POST', url: '/supersede-requests/req-1/approve' })).statusCode).toBe(403)
    await app.close()
  })

  it('a decided request cannot be decided again', async () => {
    const { app } = await build({ id: 'u-qc', role: 'qc' }, { pending: { status: 'rejected' } })
    expect((await app.inject({ method: 'POST', url: '/supersede-requests/req-1/approve' })).json()).toMatchObject({ error: 'already_decided' })
    await app.close()
  })
})

describe('reject', () => {
  it('another PM or a QC rejects with a reason; the framework stays current and the requester is told why', async () => {
    const { app, fw, requests, sent, audit } = await build({ id: 'u-qc', role: 'qc' }, { pending: {} })
    const res = await app.inject({ method: 'POST', url: '/supersede-requests/req-1/reject', payload: { reason: 'ICC 46 is not effective yet' } })
    expect(res.statusCode).toBe(200)
    expect(fw.retiredAt).toBeNull()
    expect(requests[0]).toMatchObject({ status: 'rejected', decidedBy: 'u-qc', rejectionReason: 'ICC 46 is not effective yet' })
    expect(audit[0]).toMatchObject({ action: 'framework_supersede_rejected' })
    expect(sent).toEqual([expect.objectContaining({ recipientId: 'u-pm-a', kind: 'framework_supersede_rejected' })])
    expect(sent[0]!.body).toContain('ICC 46 is not effective yet')
    await app.close()
  })

  it('needs a reason', async () => {
    const { app, requests } = await build({ id: 'u-pm-b', role: 'pm' }, { pending: {} })
    const res = await app.inject({ method: 'POST', url: '/supersede-requests/req-1/reject', payload: { reason: ' ' } })
    expect(res.statusCode).toBe(400)
    expect(requests[0]!.status).toBe('pending')
    await app.close()
  })

  it('the requester cannot reject their own request', async () => {
    const { app } = await build({ id: 'u-pm-a', role: 'pm' }, { pending: {} })
    expect((await app.inject({ method: 'POST', url: '/supersede-requests/req-1/reject', payload: { reason: 'changed my mind' } })).statusCode).toBe(403)
    await app.close()
  })
})

describe('add framework', () => {
  it('stays admin-only: a PM cannot add one', async () => {
    const { app } = await build({ id: 'u-pm-a', role: 'pm' })
    const res = await app.inject({ method: 'POST', url: '/', payload: { name: 'X', version: '1', jurisdiction: 'ICH', category: 'GCP', effectiveDate: '2026-01-01T00:00:00.000Z' } })
    expect(res.statusCode).toBe(403)
    await app.close()
  })
})
