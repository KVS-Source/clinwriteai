// Master Library details panel "Audit trail" (audit-trail.ts): GET /library/:id/audit.
// Fastify inject() over a fake Prisma and a real in-memory hash-chained audit trail; nothing is stored.

import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser, Role } from '../../../auth/rbac.js'
import { InMemoryAuditRepository } from '../../../audit/repository.js'
import type { AuditEventShape } from '../../../audit/hash.js'
import { libraryAuditRoutes } from './audit-trail.js'

type Row = { id: string; tenantId: string | null; tags: string[]; supersededBy: string | null }
const PUSHED: Row = { id: 'lib-2', tenantId: 't1', tags: ['module:A', 'type:document', 'fromdoc:doc-9'], supersededBy: null }
const UPLOAD_V1: Row = { id: 'up-1', tenantId: 't1', tags: ['module:A', 'type:document', 'origin:upload'], supersededBy: 'up-2' }
const UPLOAD_V2: Row = { id: 'up-2', tenantId: 't1', tags: ['module:A', 'type:document', 'origin:upload'], supersededBy: null }
const OTHER_TENANT: Row = { id: 'lib-x', tenantId: 't2', tags: ['fromdoc:doc-x'], supersededBy: null }
const PLATFORM: Row = { id: 'lib-p', tenantId: null, tags: [], supersededBy: null }
const ROWS = [PUSHED, UPLOAD_V1, UPLOAD_V2, OTHER_TENANT, PLATFORM]
const USERS = [{ id: 'u1', name: 'Alex PM' }, { id: 'u2', name: 'Raj' }]

let current: FastifyInstance | null = null
afterEach(async () => { await current?.close(); current = null })

async function setup(role: Role = 'pm') {
  const audit = new InMemoryAuditRepository('x'.repeat(32))
  let n = 0
  const at = () => new Date(Date.UTC(2026, 10, 10, 9, n++)).toISOString()   // one minute apart, in append order
  const add = (e: Partial<AuditEventShape> & Pick<AuditEventShape, 'action' | 'entityType' | 'entityId'>) =>
    audit.append({ timestamp: at(), actorId: 'u1', details: {}, ipAddress: '10.1.2.3', ...e })
  const append = vi.spyOn(audit, 'append')
  const app = Fastify()
  app.decorate('prisma', {
    librarySection: {
      findFirst: vi.fn(async ({ where }: { where: { id: string; AND: Array<{ OR?: Array<{ tenantId: string | null }> }> } }) => {
        const r = ROWS.find(x => x.id === where.id)
        const or = where.AND[0]?.OR
        return r && (!or || or.some(c => c.tenantId === r.tenantId)) ? r : null
      }),
      findMany: vi.fn(async ({ where }: { where: { supersededBy: { in: string[] } } }) => ROWS.filter(r => r.supersededBy && where.supersededBy.in.includes(r.supersededBy))),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => ROWS.find(r => r.id === where.id) ?? null),
    },
    user: { findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => USERS.filter(u => where.id.in.includes(u.id))) },
  } as never)
  app.decorate('audit', audit as never)
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (req) => {
    (req as unknown as { user: AuthenticatedUser }).user = { id: 'u1', email: 'pm@x.io', role, modules: ['A'], tenantId: 't1' }
  })
  await app.register(libraryAuditRoutes, { prefix: '/library' })
  await app.ready()
  current = app
  return { app, add, append }
}

const get = (app: FastifyInstance, id: string, qs = '') => app.inject({ method: 'GET', url: `/library/${id}/audit${qs}` })
type Entry = { timestamp: string; actor: string; action: string; eventType: string | null; detail: string }

describe('GET /library/:id/audit', () => {
  it('a pushed document: the source document’s whole trail and the library entry’s, newest first, system entries included', async () => {
    const t = await setup()
    await t.add({ action: 'document_created', entityType: 'document', entityId: 'doc-9' })
    await t.add({ action: 'section_edited', entityType: 'document', entityId: 'doc-9', actorId: 'u2', details: { sectionId: '2.1' } })
    await t.add({ action: 'signature_recorded', entityType: 'document', entityId: 'doc-9', details: { meaning: 'Approved', step: 1 } })
    await t.add({ action: 'library_auto_pushed', entityType: 'document', entityId: 'doc-9', actorId: 'system:library-auto-push', details: { trigger: 'signing', libraryItemId: 'lib-2' } })
    await t.add({ action: 'library_pushed', entityType: 'library_section', entityId: 'lib-2' })
    await t.add({ action: 'library_document_shared', entityType: 'document', entityId: 'doc-9', details: { libraryItemId: 'lib-2', recipients: [{ kind: 'invite', email: 'ceo@acme.com' }] } })
    await t.add({ action: 'library_share_opened', entityType: 'document', entityId: 'doc-9', actorId: 'system:library-share' })
    await t.add({ action: 'document_created', entityType: 'document', entityId: 'doc-other' })        // another document
    await t.add({ action: 'library_pushed', entityType: 'library_section', entityId: 'lib-other' })  // another entry

    const res = await get(t.app, 'lib-2')
    expect(res.statusCode).toBe(200)
    const { entries, total } = res.json() as { entries: Entry[]; total: number }
    expect(total).toBe(7)
    expect(entries.map(e => e.action)).toEqual([
      'library_share_opened', 'library_document_shared', 'library_pushed', 'library_auto_pushed', 'signature_recorded', 'section_edited', 'document_created',
    ])
    const ts = entries.map(e => Date.parse(e.timestamp))
    expect(ts).toEqual([...ts].sort((a, b) => b - a))
    // Readable text is the Clinical Writing audit trail's own.
    expect(entries[0]!.actor).toBe('System')
    expect(entries[1]!.detail).toBe('Master Library copy shared with ceo@acme.com')
    expect(entries[3]).toMatchObject({ actor: 'System', detail: expect.stringContaining('Pushed to Master Library automatically on signing') })
    expect(entries[4]).toMatchObject({ actor: 'Alex PM', eventType: 'document-signed', detail: 'Meaning: Approved · Step 1' })
    expect(entries[5]).toMatchObject({ actor: 'Raj', detail: 'Section 2.1' })
  })

  it('an uploaded document: only the library entry’s trail, across its earlier and later versions', async () => {
    const t = await setup()
    await t.add({ action: 'library_uploaded', entityType: 'library_section', entityId: 'up-1' })
    await t.add({ action: 'library_document_shared', entityType: 'library_section', entityId: 'up-1', details: { libraryItemId: 'up-1', recipients: [{ kind: 'user', id: 'u2', email: 'raj@x.io', name: 'Raj' }] } })
    await t.add({ action: 'library_uploaded', entityType: 'library_section', entityId: 'up-2', details: { supersedes: 'up-1' } })
    await t.add({ action: 'document_created', entityType: 'document', entityId: 'doc-9' })   // not this document's
    for (const id of ['up-1', 'up-2']) {
      const { entries, total } = (await get(t.app, id)).json() as { entries: Entry[]; total: number }
      expect(total, id).toBe(3)
      expect(entries.map(e => e.action), id).toEqual(['library_uploaded', 'library_document_shared', 'library_uploaded'])
    }
  })

  it('empty trail', async () => {
    const t = await setup()
    expect((await get(t.app, 'lib-p')).json()).toEqual({ entries: [], total: 0, limit: 50, offset: 0 })
  })

  it('pages newest first across both trails', async () => {
    const t = await setup()
    for (let i = 0; i < 5; i++) {
      await t.add({ action: `doc_step_${i}`, entityType: 'document', entityId: 'doc-9' })
      await t.add({ action: `lib_step_${i}`, entityType: 'library_section', entityId: 'lib-2' })
    }
    const p1 = (await get(t.app, 'lib-2', '?limit=3&offset=0')).json() as { entries: Entry[]; total: number }
    const p2 = (await get(t.app, 'lib-2', '?limit=3&offset=3')).json() as { entries: Entry[]; total: number }
    expect(p1.total).toBe(10)
    expect([...p1.entries, ...p2.entries].map(e => e.action)).toEqual(['lib_step_4', 'doc_step_4', 'lib_step_3', 'doc_step_3', 'lib_step_2', 'doc_step_2'])
    expect((await get(t.app, 'lib-2', '?limit=500')).statusCode).toBe(400)
    expect((await get(t.app, 'lib-2', '?offset=-1')).statusCode).toBe(400)
  })

  it('returns only the panel fields — no raw details, IP addresses, hashes, tokens or codes', async () => {
    const t = await setup()
    await t.add({ action: 'final_document_exported', entityType: 'document', entityId: 'doc-9', details: { mode: 'signed', pages: 3, pdfSha256: 'a'.repeat(64) } })
    await t.add({ action: 'library_share_code_locked', entityType: 'document', entityId: 'doc-9', actorId: 'system:library-share', details: { shareId: 'sh-1', tokenHash: 'b'.repeat(64), code: '123456' } })
    const res = await get(t.app, 'lib-2')
    const { entries } = res.json() as { entries: Entry[] }
    for (const e of entries) expect(Object.keys(e).sort()).toEqual(['action', 'actor', 'detail', 'eventType', 'timestamp'])
    expect(entries[1]!.detail).toBe('Signed copy · 3 pages')
    expect(res.payload).not.toMatch(/[0-9a-f]{64}/)
    expect(res.payload).not.toMatch(/10\.1\.2\.3|123456|sh-1|tokenHash|rowHash|prevHash|ipAddress|"details"/)
  })

  it('is read-only: reading writes nothing to the audit trail', async () => {
    const t = await setup()
    await t.add({ action: 'library_pushed', entityType: 'library_section', entityId: 'lib-2' })
    t.append.mockClear()
    await get(t.app, 'lib-2')
    expect(t.append).not.toHaveBeenCalled()
  })

  it('same visibility as the Master Library: anyone who can open it; another organisation’s or a missing entry is 404', async () => {
    for (const role of ['pm', 'contributor', 'auditor', 'qc'] as Role[]) {
      const t = await setup(role)
      expect((await get(t.app, 'lib-2')).statusCode, role).toBe(200)
      await t.app.close(); current = null
    }
    const t = await setup()
    expect((await get(t.app, 'lib-p')).statusCode).toBe(200)
    expect((await get(t.app, 'lib-x')).statusCode).toBe(404)
    expect((await get(t.app, 'nope')).statusCode).toBe(404)
  })
})
