// CW-020, second half: routes addressed through a CRM meeting, a TLF package / item or a project must
// answer "not found" to someone who may not see the document or project behind them — the same as a
// route addressed by :documentId. The real CRM and TLF routes run over a stand-in database.

import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from './rbac.js'
import { crmRoutes } from '../modules/clinical-writing/crm/routes.js'
import { tlfRoutes } from '../modules/clinical-writing/tlf/routes.js'

const DOCS = [{ id: 'DOC-IN', projectId: 'P-IN' }, { id: 'DOC-OUT', projectId: 'P-OUT' }]
const MEETINGS = [{ id: 'M-IN', documentId: 'DOC-IN' }, { id: 'M-OUT', documentId: 'DOC-OUT' }]
const PACKAGES = [{ id: 'PKG-IN', projectId: 'P-IN' }, { id: 'PKG-OUT', projectId: 'P-OUT' }]
const ITEMS = [{ id: 'ITEM-IN', packageId: 'PKG-IN', package: { projectId: 'P-IN' } }, { id: 'ITEM-OUT', packageId: 'PKG-OUT', package: { projectId: 'P-OUT' } }]

const USERS: Record<string, AuthenticatedUser> = {
  pm:      { id: 'pm', email: 'pm@x', role: 'pm', modules: ['A'], tenantId: null },       // a member of P-IN only
  admin:   { id: 'admin', email: 'a@x', role: 'tenant-admin', modules: ['A'], tenantId: null },
  auditor: { id: 'auditor', email: 'au@x', role: 'auditor', modules: ['A'], tenantId: null },
}

async function build(user: string) {
  const writes: string[] = []
  const lookups = vi.fn()
  const record = (name: string) => async () => { writes.push(name); return {} }
  const app = Fastify()
  app.decorate('prisma', {
    projectMember:     { findMany: async ({ where }: { where: { userId: string } }) => (where.userId === 'pm' ? [{ projectId: 'P-IN' }] : []) },
    projectTeamMember: { findMany: async () => [] },
    raciAssignment:    { findMany: async () => [] },
    project:           { findUnique: async () => ({ status: 'ongoing' }) },
    document: {
      findMany: async () => [],
      count: async ({ where }: { where: { id?: string; projectId?: { in: string[] } } }) =>
        DOCS.filter(d => (!where.id || d.id === where.id) && (!where.projectId || where.projectId.in.includes(d.projectId))).length,
      findUnique: async ({ where }: { where: { id: string } }) => DOCS.find(d => d.id === where.id) ?? null,
    },
    crmMeeting: {
      findUnique: async (args: { where: { id: string } }) => { lookups(); return MEETINGS.find(m => m.id === args.where.id) ?? null },
      update: record('crmMeeting.update'),
    },
    crmAttendee: { upsert: record('crmAttendee.upsert') },
    tlfPackage: {
      findUnique: async ({ where }: { where: { id: string } }) => PACKAGES.find(p => p.id === where.id) ?? null,
      findMany: async () => [], create: record('tlfPackage.create'),
    },
    tlfItem: {
      findUnique: async ({ where }: { where: { id?: string } }) => ITEMS.find(i => i.id === where.id) ?? null,
      create: record('tlfItem.create'),
    },
    tlfSectionLink: { upsert: record('tlfSectionLink.upsert') },
  } as never)
  app.decorate('audit', { append: async () => ({}) } as never)
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (req) => { (req as unknown as { user: AuthenticatedUser }).user = USERS[user]! })
  await app.register(crmRoutes)
  await app.register(tlfRoutes)
  await app.ready()
  return { app, writes, lookups }
}

const MEETING_ROUTES = [
  ['POST', 'attendees', { userId: 'u', roleInCrm: 'Reviewer' }], ['POST', 'start', {}], ['POST', 'complete', {}], ['POST', 'cancel', {}],
  ['POST', 'resolve', { commentId: 'c', resolutionType: 'accept', resolutionNote: 'ok' }], ['GET', 'resolutions', undefined],
  ['POST', 'transcript', { rawText: 'one two three four five six', source: 'manual_paste' }], ['GET', 'ai-drafts', undefined], ['POST', 'minutes', {}],
] as const

describe('CRM meeting routes follow the visibility of the meeting\'s document', () => {
  it.each(MEETING_ROUTES)('%s /crm/:meetingId/%s: "not found" for a PM outside the project, nothing written', async (method, tail, payload) => {
    const { app, writes } = await build('pm')
    const res = await app.inject({ method, url: `/crm/M-OUT/${tail}`, payload: payload as never })
    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ error: 'not_found' })
    expect(writes).toEqual([])
  })

  it.each(MEETING_ROUTES)('%s /crm/:meetingId/%s: not stopped by the visibility rule for a PM on the project', async (method, tail, payload) => {
    const { app } = await build('pm')
    const res = await app.inject({ method, url: `/crm/M-IN/${tail}`, payload: payload as never })
    expect(res.json()).not.toEqual({ error: 'not_found' })   // later checks may still refuse or fail; this one did not
  })

  it('an admin or auditor is not looked up at all (they see everything)', async () => {
    for (const who of ['admin', 'auditor']) {
      const { app, lookups } = await build(who)
      await app.inject({ method: 'GET', url: '/crm/M-OUT/resolutions' })
      // the route itself reads the meeting once; the hook adds no extra lookup
      expect(lookups.mock.calls.length).toBeLessThanOrEqual(1)
    }
  })
})

describe('TLF routes follow the visibility of the project', () => {
  it.each([
    ['GET', '/projects/P-OUT/tlf-packages', undefined],
    ['POST', '/projects/P-OUT/tlf-packages', { version: 'v1', validatedBy: 'x', validatedAt: '2026-11-01T00:00:00.000Z', items: [] }],
    ['GET', '/tlf-packages/PKG-OUT', undefined],
    ['POST', '/tlf-packages/PKG-OUT/items', { itemType: 'T', referenceId: 'T-1', title: 'x' }],
    ['POST', '/tlf-items/ITEM-OUT/section-links', { documentId: 'DOC-IN', sectionRef: '1' }],
  ] as const)('%s %s: "not found" for a PM outside the project, nothing written', async (method, url, payload) => {
    const { app, writes } = await build('pm')
    const res = await app.inject({ method, url, payload: payload as never })
    expect(res.statusCode).toBe(404)
    expect(writes).toEqual([])
  })

  it('a PM on the project reads its packages', async () => {
    const { app } = await build('pm')
    expect((await app.inject({ method: 'GET', url: '/projects/P-IN/tlf-packages' })).statusCode).toBe(200)
    expect((await app.inject({ method: 'GET', url: '/tlf-packages/PKG-IN' })).statusCode).toBe(200)
  })

  it('linking a section also needs the document named in the body to be one the caller may see', async () => {
    const { app, writes } = await build('pm')
    const res = await app.inject({ method: 'POST', url: '/tlf-items/ITEM-IN/section-links', payload: { documentId: 'DOC-OUT', sectionRef: '1' } })
    expect(res.statusCode).toBe(404)
    expect(writes).toEqual([])
    const ok = await app.inject({ method: 'POST', url: '/tlf-items/ITEM-IN/section-links', payload: { documentId: 'DOC-IN', sectionRef: '1' } })
    expect(ok.statusCode).toBe(201)
  })

  it('admins and auditors reach every package', async () => {
    for (const who of ['admin', 'auditor']) {
      const { app } = await build(who)
      expect((await app.inject({ method: 'GET', url: '/tlf-packages/PKG-OUT' })).statusCode).toBe(200)
    }
  })
})
