// Master Library "Audit trail" (audit-trail.ts): GET /library/:id/audit — Master Library activity only.
// Fastify inject() over a fake Prisma and a real in-memory hash-chained audit trail; nothing is stored.

import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser, Role } from '../../../auth/rbac.js'
import { InMemoryAuditRepository } from '../../../audit/repository.js'
import type { AuditEventShape } from '../../../audit/hash.js'

const { libraryAuditRoutes } = await import('./audit-trail.js')

type Row = { id: string; tenantId: string | null; tags: string[]; createdAt: Date }
const PUSH_TIME = new Date(Date.UTC(2026, 10, 10, 9, 30))
const V1: Row = { id: 'lib-1', tenantId: 't1', tags: ['type:document', 'fromdoc:doc-9'], createdAt: new Date(Date.UTC(2026, 10, 10, 9, 10)) }
const V2: Row = { id: 'lib-2', tenantId: 't1', tags: ['type:document', 'fromdoc:doc-9'], createdAt: PUSH_TIME }
const UPLOAD: Row = { id: 'up-1', tenantId: 't1', tags: ['type:document', 'origin:upload'], createdAt: PUSH_TIME }
const OTHER_TENANT: Row = { id: 'lib-x', tenantId: 't2', tags: ['fromdoc:doc-x'], createdAt: PUSH_TIME }
const PLATFORM: Row = { id: 'lib-p', tenantId: null, tags: [], createdAt: PUSH_TIME }
const ROWS = [V1, V2, UPLOAD, OTHER_TENANT, PLATFORM]
const USERS = [{ id: 'u1', name: 'Alex PM' }, { id: 'u2', name: 'Raj' }]

let current: FastifyInstance | null = null
afterEach(async () => { await current?.close(); current = null })

async function setup(role: Role = 'pm', modules = ['A']) {
  const audit = new InMemoryAuditRepository('x'.repeat(32))
  const add = (minute: number, e: Partial<AuditEventShape> & Pick<AuditEventShape, 'action' | 'entityType' | 'entityId'>) =>
    audit.append({ timestamp: new Date(Date.UTC(2026, 10, 10, 9, minute)).toISOString(), actorId: 'u1', details: {}, ipAddress: '10.1.2.3', ...e })
  const append = vi.spyOn(audit, 'append')
  const app = Fastify()
  app.decorate('prisma', {
    librarySection: {
      findFirst: vi.fn(async ({ where }: { where: { id: string; AND: Array<{ OR?: Array<{ tenantId: string | null }> }> } }) => {
        const r = ROWS.find(x => x.id === where.id)
        const or = where.AND[0]?.OR
        return r && (!or || or.some(c => c.tenantId === r.tenantId)) ? r : null
      }),
    },
    user: { findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => USERS.filter(u => where.id.in.includes(u.id))) },
  } as never)
  app.decorate('audit', audit as never)
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (req) => {
    (req as unknown as { user: AuthenticatedUser }).user = { id: 'u1', email: 'pm@x.io', role, modules, tenantId: 't1' } as AuthenticatedUser
  })
  await app.register(libraryAuditRoutes, { prefix: '/library' })
  await app.ready()
  current = app
  return { app, add, append }
}

type Entry = { timestamp: string; actor: string; action: string; eventType: string | null; detail: string }
type Panel = { entries: Entry[]; total: number; limit: number; offset: number }
const panel = async (app: FastifyInstance, id: string, qs = '') => (await app.inject({ method: 'GET', url: `/library/${id}/audit${qs}` })).json() as Panel
const actions = (es: Entry[]) => es.map(e => e.action)

/** A pushed document's life: Clinical Writing work, v1 pushed and shared, more work, v2 pushed, shared and viewed. */
async function seedPushedDocument(t: Awaited<ReturnType<typeof setup>>) {
  const doc = { entityType: 'document', entityId: 'doc-9' }
  await t.add(0, { ...doc, action: 'document_created' })
  await t.add(1, { ...doc, action: 'section_edited', actorId: 'u2', details: { sectionId: '2.1' } })
  await t.add(2, { ...doc, action: 'phi_document_accessed', actorId: 'u2' })
  await t.add(3, { ...doc, action: 'comment_added', actorId: 'u2' })
  await t.add(4, { ...doc, action: 'document_submitted_for_review', details: { from: 'in_authoring', to: 'in_review' } })
  await t.add(5, { ...doc, action: 'signature_recorded', actorId: 'u2', details: { meaning: 'Approved', step: 1 } })
  await t.add(10, { ...doc, action: 'library_auto_pushed', actorId: 'system:library-auto-push', details: { trigger: 'signing', libraryItemId: 'lib-1' } })
  await t.add(11, { ...doc, action: 'library_document_shared', details: { libraryItemId: 'lib-1', recipients: [{ kind: 'invite', email: 'v1@acme.com' }] } })
  await t.add(20, { ...doc, action: 'document_version_created', details: { versionNumber: 'v2.0' } })
  await t.add(21, { ...doc, action: 'phi_document_accessed' })
  await t.add(25, { ...doc, action: 'document_signed', actorId: 'u2' })
  await t.add(30, { entityType: 'library_section', entityId: 'lib-2', action: 'library_pushed' })
  await t.add(31, { ...doc, action: 'library_document_shared', details: { libraryItemId: 'lib-2', recipients: [{ kind: 'invite', email: 'ceo@acme.com' }] } })
  await t.add(32, { ...doc, action: 'library_share_opened', actorId: 'system:library-share', details: { libraryItemId: 'lib-2', shareId: 'sh-1', email: 'ceo@acme.com' } })
  await t.add(33, { entityType: 'library_section', entityId: 'lib-2', action: 'library_document_viewed', actorId: 'u2' })
  await t.add(40, { ...doc, action: 'document_status_changed', details: { from: 'signed', to: 'in_authoring' } })   // after v2 was pushed
  await t.add(41, { entityType: 'document', entityId: 'doc-other', action: 'document_created' })                       // another document
}

describe('GET /library/:id/audit', () => {
  it('Master Library activity only: this version’s pushed, shared, invitation opened and opened — newest first, no Clinical Writing milestones', async () => {
    const t = await setup()
    await seedPushedDocument(t)
    const p = await panel(t.app, 'lib-2')
    expect(actions(p.entries)).toEqual(['library_document_viewed', 'library_share_opened', 'library_document_shared', 'library_pushed'])
    expect(p.total).toBe(4)
    expect(p.entries[0]!.actor).toBe('Raj')
    expect(p.entries[1]!.actor).toBe('System')
    expect(p.entries[2]!.detail).toBe('Master Library copy shared with ceo@acme.com')   // the Clinical Writing trail's own wording
    // v1's own push and share stay with v1.
    expect(actions((await panel(t.app, 'lib-1')).entries)).toEqual(['library_document_shared', 'library_auto_pushed'])
  })

  it('an uploaded document: its library activity only', async () => {
    const t = await setup()
    await t.add(0, { entityType: 'library_section', entityId: 'up-1', action: 'library_uploaded' })
    await t.add(1, { entityType: 'library_section', entityId: 'up-1', action: 'library_document_shared', details: { libraryItemId: 'up-1', recipients: [{ kind: 'user', id: 'u2', email: 'raj@x.io', name: 'Raj' }] } })
    await t.add(2, { entityType: 'document', entityId: 'doc-9', action: 'document_created' })
    const p = await panel(t.app, 'up-1')
    expect(actions(p.entries)).toEqual(['library_document_shared', 'library_uploaded'])   // the document's own Clinical Writing entry is not shown
  })

  it('pages the library activity', async () => {
    const t = await setup()
    for (let i = 0; i < 5; i++) await t.add(i, { entityType: 'library_section', entityId: 'lib-2', action: 'library_document_viewed', details: { n: i } })
    await t.add(9, { entityType: 'document', entityId: 'doc-9', action: 'library_document_shared', details: { libraryItemId: 'lib-2', recipients: [] } })
    const p1 = await panel(t.app, 'lib-2', '?limit=2')
    const p2 = await panel(t.app, 'lib-2', '?limit=2&offset=2')
    expect(p1.total).toBe(6)
    expect(actions([...p1.entries, ...p2.entries])).toEqual(['library_document_shared', 'library_document_viewed', 'library_document_viewed', 'library_document_viewed'])
    expect((await t.app.inject({ method: 'GET', url: '/library/lib-2/audit?limit=500' })).statusCode).toBe(400)
  })

  it('returns only the panel fields — no raw details, IP addresses, hashes, tokens or codes', async () => {
    const t = await setup()
    await seedPushedDocument(t)
    await t.add(34, { entityType: 'document', entityId: 'doc-9', action: 'library_share_code_locked', actorId: 'system:library-share', details: { libraryItemId: 'lib-2', shareId: 'sh-1', tokenHash: 'b'.repeat(64), code: '123456' } })
    await t.add(35, { entityType: 'document', entityId: 'doc-9', action: 'final_document_exported', details: { mode: 'signed', pages: 3, pdfSha256: 'a'.repeat(64) } })
    const res = await t.app.inject({ method: 'GET', url: '/library/lib-2/audit' })
    for (const e of (res.json() as Panel).entries) expect(Object.keys(e).sort()).toEqual(['action', 'actor', 'detail', 'eventType', 'timestamp'])
    expect(res.payload).not.toMatch(/[0-9a-f]{64}/)
    expect(res.payload).not.toMatch(/10\.1\.2\.3|123456|sh-1|tokenHash|rowHash|prevHash|ipAddress|"details"/)
  })

  it('reading writes nothing to the audit trail', async () => {
    const t = await setup()
    await seedPushedDocument(t)
    t.append.mockClear()
    await panel(t.app, 'lib-2')
    expect(t.append).not.toHaveBeenCalled()
  })

  it('same visibility as the Master Library: anyone who can open it; another organisation’s or a missing entry is 404', async () => {
    for (const role of ['pm', 'contributor', 'auditor', 'qc'] as Role[]) {
      const t = await setup(role)
      expect((await t.app.inject({ method: 'GET', url: '/library/lib-2/audit' })).statusCode, role).toBe(200)
      await t.app.close(); current = null
    }
    const t = await setup()
    expect((await t.app.inject({ method: 'GET', url: '/library/lib-p/audit' })).statusCode).toBe(200)
    expect((await t.app.inject({ method: 'GET', url: '/library/lib-x/audit' })).statusCode).toBe(404)
    expect((await t.app.inject({ method: 'GET', url: '/library/nope/audit' })).statusCode).toBe(404)
  })
})
