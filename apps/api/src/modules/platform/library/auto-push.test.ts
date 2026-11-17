// Signed documents go into the Master Library by themselves (auto-push.ts). In-memory fake Prisma + audit;
// nothing is stored.

import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from '../../../auth/rbac.js'
import { autoPushSignedDocument, libraryAutoPushRoutes, libraryDocType, AUTO_PUSH_ACTOR } from './auto-push.js'

type Row = Record<string, unknown> & { id: string; tags: string[] }
type AuditRow = { id: string; timestamp: string; actorId: string; action: string; entityType: string; entityId: string; details: Record<string, unknown> }

function fake(over: { doc?: Record<string, unknown> | null; activeTas?: string[]; failCreate?: boolean; chainComplete?: boolean; hasV1?: boolean } = {}) {
  const doc = over.doc === null ? null : {
    id: 'doc-1', title: 'CSR Study 1', projectId: 'p1', status: 'signed', type: 'csr-full', therapeuticArea: 'Oncology', deletedAt: null,
    currentVersion: { versionNumber: 'v1.0', sections: [
      { sectionId: 's2', sectionNumber: '2', sectionTitle: 'Synopsis', contentHtml: '<p>Synopsis text</p>' },
      { sectionId: 's1', sectionNumber: '1', sectionTitle: 'Title Page', contentHtml: '<p>Title text</p>' },
    ] },
    ...over.doc,
  }
  const entries: Row[] = []
  const audit: AuditRow[] = []
  const activeTas = over.activeTas ?? ['Oncology']
  const matches = (r: Row, where: Record<string, unknown>) => {
    if (where.isCurrent !== undefined && r.isCurrent !== where.isCurrent) return false
    if (where.retiredAt === null && r.retiredAt) return false
    const has = (where.tags as { has?: string } | undefined)?.has
    if (has && !r.tags.includes(has)) return false
    for (const and of (where.AND as Array<{ tags: { has: string } }> | undefined) ?? []) if (!r.tags.includes(and.tags.has)) return false
    return true
  }
  const librarySection = {
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => entries.find(r => matches(r, where)) ?? null),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      if (over.failCreate) throw new Error('db down')
      const r = { id: `lib-${entries.length + 1}`, isCurrent: true, retiredAt: null, approvedAt: new Date('2026-11-13T10:00:00Z'), tags: [], ...data } as Row
      entries.push(r); return r
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => Object.assign(entries.find(r => r.id === where.id)!, data)),
  }
  const prisma = {
    document: { findFirst: vi.fn(async () => doc) },
    project: { findUnique: vi.fn(async () => ({ tenantId: 't1' })) },
    therapeuticArea: { findFirst: vi.fn(async ({ where }: { where: { label: { equals: string } } }) => (activeTas.includes(where.label.equals) ? { label: where.label.equals } : null)) },
    signatureRecord: { findFirst: vi.fn(async () => ({ signerId: 'u-last' })) },
    signatureChain: { findFirst: vi.fn(async () => (over.chainComplete === false ? null : { id: 'chain-1' })) },
    documentVersion: { findFirst: vi.fn(async () => (over.hasV1 ? { id: 'v1' } : null)) },
    librarySection,
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn({ librarySection, $executeRaw: vi.fn(async () => 0) })),
  }
  const auditApi = {
    append: vi.fn(async (e: Omit<AuditRow, 'id'>) => { const r = { id: String(audit.length + 1), ...e }; audit.push(r); return { id: r.id, rowHash: 'h' } }),
    pageForEntity: vi.fn(async (_t: string, id: string, opts: { action?: string; limit?: number } = {}) => {
      const rows = audit.filter(a => a.entityId === id && (!opts.action || a.action === opts.action)).reverse()
      return { rows: rows.slice(0, opts.limit ?? 50), total: rows.length }
    }),
  }
  const app = { prisma: prisma as never, audit: auditApi as never, log: { warn: vi.fn(), error: vi.fn() } }
  return { app, entries, audit, prisma, doc }
}

describe('libraryDocType', () => {
  it('maps every Clinical Writing type, in either spelling, and nothing else', () => {
    expect(libraryDocType('csr-full')).toBe('CSR')
    expect(libraryDocType('csr_synopsis')).toBe('CSR')
    expect(libraryDocType('protocol-amendment')).toBe('Protocol')
    expect(libraryDocType('patient_narrative')).toBe('Patient Narrative')
    expect(libraryDocType('mystery')).toBeNull()
    expect(libraryDocType(null)).toBeNull()
  })
})

describe('autoPushSignedDocument', () => {
  it('pushes the whole signed document with the tags from the document, audited on the document as System', async () => {
    const f = fake()
    const res = await autoPushSignedDocument(f.app, 'doc-1', { trigger: 'signing', signedBy: 'u-signer' })
    expect(res).toEqual({ state: 'pushed', libraryItemId: 'lib-1', created: true })
    expect(f.entries).toHaveLength(1)
    expect(f.entries[0]).toMatchObject({
      tenantId: 't1', taTag: 'Oncology', framework: 'CSR', title: 'CSR Study 1', approvedBy: 'u-signer',
      body: '1 Title Page\nTitle text\n\n2 Synopsis\nSynopsis text',
    })
    expect(f.entries[0]!.tags).toEqual(expect.arrayContaining(['module:A', 'doctype:CSR', 'project:p1', 'source:doc-1', 'fromdoc:doc-1', 'docversion:v1.0', 'type:document']))
    expect(f.audit).toHaveLength(1)
    expect(f.audit[0]).toMatchObject({
      actorId: AUTO_PUSH_ACTOR, action: 'library_auto_pushed', entityType: 'document', entityId: 'doc-1',
      details: { trigger: 'signing', signedBy: 'u-signer', documentVersion: 'v1.0', libraryItemId: 'lib-1', libraryVersion: 1,
        tags: { therapeuticArea: 'Oncology', module: 'A', documentType: 'CSR', version: 'v1.0' } },
    })
  })

  it('is idempotent: a second run (a retry, a page reload) adds nothing and logs nothing', async () => {
    const f = fake()
    await autoPushSignedDocument(f.app, 'doc-1', { trigger: 'signing', signedBy: 'u-signer' })
    const again = await autoPushSignedDocument(f.app, 'doc-1', { trigger: 'backfill' })
    expect(again).toEqual({ state: 'pushed', libraryItemId: 'lib-1', created: false })
    expect(f.entries).toHaveLength(1)
    expect(f.audit).toHaveLength(1)
  })

  it('a missing tag skips the push with the reason logged — never throws', async () => {
    const f = fake({ activeTas: [], doc: { type: 'mystery' } })
    const res = await autoPushSignedDocument(f.app, 'doc-1', { trigger: 'signing', signedBy: 'u-signer' })
    expect(res).toEqual({ state: 'skipped', reason: 'missing_tags', missing: ['therapeutic_area', 'document_type'] })
    expect(f.entries).toHaveLength(0)
    expect(f.audit[0]).toMatchObject({ actorId: AUTO_PUSH_ACTOR, action: 'library_auto_push_skipped', entityId: 'doc-1', details: { reason: 'missing_tags', missing: ['therapeutic_area', 'document_type'], documentVersion: 'v1.0' } })
    // Later page views report the skip without trying (and logging) again.
    expect(await autoPushSignedDocument(f.app, 'doc-1', { trigger: 'backfill' })).toMatchObject({ state: 'skipped', reason: 'missing_tags' })
    expect(f.audit).toHaveLength(1)
  })

  it('a document with no content is skipped, logged', async () => {
    const f = fake({ doc: { currentVersion: { versionNumber: 'v1.0', sections: [{ sectionId: 's1', sectionNumber: '1', sectionTitle: 'T', contentHtml: '<p> </p>' }] } } })
    expect(await autoPushSignedDocument(f.app, 'doc-1', { trigger: 'signing' })).toEqual({ state: 'skipped', reason: 'no_content' })
    expect(f.audit[0]).toMatchObject({ action: 'library_auto_push_skipped', details: { reason: 'no_content' } })
  })

  it('waits for the final v1.0 snapshot (logged once at signing), then pushes when it exists', async () => {
    const f = fake({ doc: { currentVersion: { versionNumber: 'v0.3', sections: [] } } })
    expect(await autoPushSignedDocument(f.app, 'doc-1', { trigger: 'signing' })).toEqual({ state: 'waiting' })
    expect(await autoPushSignedDocument(f.app, 'doc-1', { trigger: 'backfill' })).toEqual({ state: 'waiting' })
    expect(f.audit.map(a => a.details.reason)).toEqual(['final_version_missing'])
    expect(f.entries).toHaveLength(0)
  })

  it('a document signed without a chain (e.g. seeded, ending on v1.4) goes in at its own version', async () => {
    const f = fake({ chainComplete: false, doc: { currentVersion: { versionNumber: 'v1.4', sections: [{ sectionId: 's1', sectionNumber: '1', sectionTitle: 'T', contentHtml: '<p>Text</p>' }] } } })
    expect(await autoPushSignedDocument(f.app, 'doc-1', { trigger: 'backfill' })).toMatchObject({ state: 'pushed' })
    expect(f.entries[0]!.tags).toContain('docversion:v1.4')
    expect(f.audit[0]).toMatchObject({ action: 'library_auto_pushed', details: { tags: { version: 'v1.4' } } })
  })

  it('an unexpected error is logged as a failure and does not throw; retries stop after three', async () => {
    const f = fake({ failCreate: true })
    expect(await autoPushSignedDocument(f.app, 'doc-1', { trigger: 'signing' })).toEqual({ state: 'failed', reason: 'db down' })
    await autoPushSignedDocument(f.app, 'doc-1', { trigger: 'backfill' })
    await autoPushSignedDocument(f.app, 'doc-1', { trigger: 'backfill' })
    expect(f.audit.filter(a => a.action === 'library_auto_push_failed')).toHaveLength(3)
    expect(await autoPushSignedDocument(f.app, 'doc-1', { trigger: 'backfill' })).toMatchObject({ state: 'failed' })
    expect(f.audit).toHaveLength(3)
  })

  it('does nothing for a document that is not signed', async () => {
    const f = fake({ doc: { status: 'pending_signature' } })
    expect(await autoPushSignedDocument(f.app, 'doc-1', { trigger: 'signing' })).toEqual({ state: 'not_signed' })
    expect(f.audit).toHaveLength(0)
  })

  it('a backfill credits the last signer on record', async () => {
    const f = fake()
    await autoPushSignedDocument(f.app, 'doc-1', { trigger: 'backfill' })
    expect(f.entries[0]).toMatchObject({ approvedBy: 'u-last' })
  })
})

describe('GET /library/auto-push/:documentId', () => {
  let app: FastifyInstance | null = null
  afterEach(async () => { await app?.close(); app = null })
  async function serve(f: ReturnType<typeof fake>) {
    app = Fastify()
    app.decorate('prisma', f.app.prisma)
    app.decorate('audit', f.app.audit)
    app.decorateRequest('user', null)
    app.addHook('onRequest', async (req) => { (req as unknown as { user: AuthenticatedUser }).user = { id: 'u1', email: 'a@b.c', role: 'contributor', modules: ['A'], tenantId: 't1' } })
    await app.register(libraryAutoPushRoutes, { prefix: '/library' })
    await app.ready()
    return app
  }

  it('reports the entry; a signed document not yet in the library is pushed on the first look (once)', async () => {
    const f = fake()
    const a = await serve(f)
    const first = (await a.inject({ method: 'GET', url: '/library/auto-push/doc-1' })).json()
    expect(first).toMatchObject({ state: 'pushed', entry: { id: 'lib-1', libraryVersion: 'v1.0', documentVersion: 'v1.0', addedAt: '2026-11-13T10:00:00.000Z' } })
    await a.inject({ method: 'GET', url: '/library/auto-push/doc-1' })
    expect(f.entries).toHaveLength(1)
    expect(f.audit.map(x => x.details.trigger)).toEqual(['backfill'])
  })

  it('reports a skip with its reason and when', async () => {
    const f = fake({ activeTas: [] })
    const a = await serve(f)
    const res = (await a.inject({ method: 'GET', url: '/library/auto-push/doc-1' })).json()
    expect(res).toMatchObject({ state: 'skipped', reason: 'missing_tags', missing: ['therapeutic_area'], documentVersion: 'v1.0' })
    expect(res.at).toBeTruthy()
  })

  it('says not_signed for a document that is not signed, and 404 for none', async () => {
    const a = await serve(fake({ doc: { status: 'in_review' } }))
    expect((await a.inject({ method: 'GET', url: '/library/auto-push/doc-1' })).json()).toEqual({ state: 'not_signed' })
    await a.close(); app = null
    const b = await serve(fake({ doc: null }))
    expect((await b.inject({ method: 'GET', url: '/library/auto-push/doc-1' })).statusCode).toBe(404)
  })
})
