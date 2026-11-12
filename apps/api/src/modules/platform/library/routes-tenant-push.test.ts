// Tenant isolation on the older /library/sections routes (CW-059), the withdrawn
// list (CW-062) and the final-only push into the library (CW-058, FR-A-080 /
// AC-A-054) — against a fake Prisma, no database.

import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser, Role } from '../../../auth/rbac.js'

const access = vi.hoisted(() => ({ canEdit: true }))
const visibility = vi.hoisted(() => ({ projects: 'all' as 'all' | Set<string> }))
vi.mock('../document-raci/access.js', async (orig) => ({
  ...(await orig<typeof import('../document-raci/access.js')>()),
  actorCanEditDocumentContent: vi.fn(async () => access.canEdit),
}))
vi.mock('../../projects/visibility.js', () => ({ visibleProjectIdsForUser: vi.fn(async () => visibility.projects) }))

import { libraryRoutes } from './routes.js'

const row = (id: string, over: Record<string, unknown> = {}) => ({
  id, tenantId: 't1', title: `Item ${id}`, body: 'text', taTag: 'Oncology', framework: 'CSR', category: 'claim',
  version: 1, isCurrent: true, approvedBy: 'u1', approvedAt: new Date('2026-10-01T00:00:00Z'), retiredAt: null,
  tags: [], updatedAt: new Date('2026-10-02T00:00:00Z'), supersededBy: null, usageCount: 0, ...over,
})

const finalDoc = (over: Record<string, unknown> = {}) => ({
  id: 'd1', projectId: 'p1', title: 'CSR Study 1', status: 'signed', stage: 'final_output', therapeuticArea: 'Oncology', deletedAt: null,
  currentVersion: { versionNumber: 'v1.0', sections: [
    { sectionId: 's2', sectionNumber: '2', sectionTitle: 'Synopsis', contentHtml: '<p>Synopsis text</p>' },
    { sectionId: 's1', sectionNumber: '1', sectionTitle: 'Title Page', contentHtml: '<p>Title text</p>' },
  ] },
  ...over,
})

// earlierInTx: what the second look-up (made under the push lock, inside the transaction) finds — a push that
// landed between the quick check and the lock.
interface Setup { role?: Role; tenantId?: string | null; found?: ReturnType<typeof row> | null; doc?: ReturnType<typeof finalDoc> | null; earlier?: ReturnType<typeof row> | null; earlierInTx?: ReturnType<typeof row> | null }

async function setup(s: Setup = {}) {
  const found = s.found === undefined ? row('a') : s.found
  let tagLookups = 0
  const findFirst = vi.fn(async (args: { where: Record<string, unknown> }) => {
    if (!('tags' in args.where)) return found
    tagLookups++
    return tagLookups === 1 ? (s.earlier ?? null) : (s.earlierInTx !== undefined ? s.earlierInTx : (s.earlier ?? null))
  })
  const executeRaw = vi.fn(async () => 0)
  const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => row('new-1', data))
  const update = vi.fn(async ({ data }: { data: Record<string, unknown> }) => row('a', data))
  const findMany = vi.fn(async () => [])
  const append = vi.fn(async () => ({}))
  const librarySection = { findFirst, findMany, create, update, count: vi.fn(async () => 0), findUnique: vi.fn(async () => found) }
  const prisma = {
    librarySection,
    libraryAdoptionRecord: { findMany: vi.fn(async () => []), create: vi.fn(async () => ({})) },
    document: { findFirst: vi.fn(async () => (s.doc === undefined ? finalDoc() : s.doc)), findMany: vi.fn(async () => []) },
    project: { findUnique: vi.fn(async () => ({ tenantId: 't1' })), findMany: vi.fn(async () => []) },
    user: { findMany: vi.fn(async () => [{ id: 'u1', name: 'Dr A' }]) },
    therapeuticArea: { findFirst: vi.fn(async () => ({ label: 'Oncology' })) },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn({ librarySection, libraryAdoptionRecord: { create: vi.fn() }, $executeRaw: executeRaw })),
  }
  const app = Fastify()
  app.decorate('prisma', prisma as never)
  app.decorate('audit', { append } as never)
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (request) => {
    ;(request as unknown as { user: AuthenticatedUser }).user = {
      id: 'u1', email: 'a@b.c', role: s.role ?? 'tenant-admin', modules: ['A'], tenantId: s.tenantId === undefined ? 't1' : s.tenantId,
    }
  })
  await app.register(libraryRoutes, { prefix: '/library' })
  await app.ready()
  current = app
  return { app, findFirst, create, update, findMany, append, executeRaw, prisma }
}

let current: FastifyInstance | null = null
afterEach(async () => { await current?.close(); current = null; access.canEdit = true; visibility.projects = 'all' })

describe('tenant isolation on /library/sections (CW-059)', () => {
  it('scopes the older list to platform-wide + own tenant, even with ?tenantId=other', async () => {
    const { app, findMany } = await setup()
    await app.inject({ method: 'GET', url: '/library/sections?tenantId=t2' })
    const where = (findMany.mock.calls[0] as unknown as [{ where: { AND: unknown[] } }])[0].where
    expect(JSON.stringify(where.AND[0])).toBe('{"OR":[{"tenantId":null},{"tenantId":"t1"}]}')
  })

  it('returns 404 for another tenant\'s section on GET /sections/:id and /adoptions', async () => {
    const { app } = await setup({ found: null })
    expect((await app.inject({ method: 'GET', url: '/library/sections/x' })).statusCode).toBe(404)
    expect((await app.inject({ method: 'GET', url: '/library/sections/x/adoptions' })).statusCode).toBe(404)
  })

  it('looks the row up through the tenant filter for GET /sections/:id', async () => {
    const { app, findFirst } = await setup()
    await app.inject({ method: 'GET', url: '/library/sections/a' })
    expect(JSON.stringify(findFirst.mock.calls[0])).toContain('"tenantId":"t1"')
  })

  it('ignores a body tenantId from a tenant admin and uses their own tenant', async () => {
    const { app, create } = await setup()
    const res = await app.inject({ method: 'POST', url: '/library/sections', payload: { title: 'T', body: 'B', taTag: 'Oncology', framework: 'CSR', category: 'claim', tenantId: 't2' } })
    expect(res.statusCode).toBe(201)
    expect(create.mock.calls[0]![0].data.tenantId).toBe('t1')
  })

  it('lets a platform admin pick the tenant, or leave it platform-wide', async () => {
    const { app, create } = await setup({ tenantId: null })
    const post = (p: object) => app.inject({ method: 'POST', url: '/library/sections', payload: { title: 'T', body: 'B', taTag: 'Oncology', framework: 'CSR', category: 'claim', ...p } })
    await post({ tenantId: 't2' })
    await post({})
    expect(create.mock.calls[0]![0].data.tenantId).toBe('t2')
    expect(create.mock.calls[1]![0].data.tenantId).toBeNull()
  })

  it('refuses a tenant admin versioning or withdrawing a platform-wide row', async () => {
    const { app, update } = await setup({ found: row('a', { tenantId: null }) })
    expect((await app.inject({ method: 'POST', url: '/library/sections/a/versions', payload: { body: 'new' } })).statusCode).toBe(403)
    expect((await app.inject({ method: 'POST', url: '/library/sections/a/retire', payload: {} })).statusCode).toBe(403)
    expect(update).not.toHaveBeenCalled()
  })

  it('404s versioning, withdrawing and adopting another tenant\'s section', async () => {
    const { app } = await setup({ found: null })
    expect((await app.inject({ method: 'POST', url: '/library/sections/a/versions', payload: { body: 'new' } })).statusCode).toBe(404)
    expect((await app.inject({ method: 'POST', url: '/library/sections/a/retire', payload: {} })).statusCode).toBe(404)
    expect((await app.inject({ method: 'POST', url: '/library/sections/a/adopt', payload: { adoptingModule: 'A', adoptingEntity: 'd1' } })).statusCode).toBe(404)
  })

  it('withdraws an own-tenant section with a reason in the audit entry', async () => {
    const { app, append, update } = await setup()
    const res = await app.inject({ method: 'POST', url: '/library/sections/a/retire', payload: { reason: 'Superseded by new SOP' } })
    expect(res.statusCode).toBe(200)
    expect(update.mock.calls[0]![0].data).toMatchObject({ isCurrent: false })
    expect(append).toHaveBeenCalledWith(expect.objectContaining({ action: 'library_section_retired', details: expect.objectContaining({ reason: 'Superseded by new SOP' }) }))
  })

  it('only withdraws the current version', async () => {
    const { app } = await setup({ found: row('a', { isCurrent: false }) })
    expect((await app.inject({ method: 'POST', url: '/library/sections/a/retire', payload: {} })).statusCode).toBe(409)
  })
})

describe('GET /library with includeRetired (CW-062)', () => {
  it('also returns withdrawn rows, which are no longer "current"', async () => {
    const { app, findMany } = await setup()
    await app.inject({ method: 'GET', url: '/library?includeRetired=true' })
    const where = (findMany.mock.calls[0] as unknown as [{ where: Record<string, unknown> }])[0].where
    expect(where.OR).toEqual([{ isCurrent: true }, { retiredAt: { not: null } }])
    expect(where.isCurrent).toBeUndefined()
  })
})

describe('POST /library/push (CW-058, FR-A-080)', () => {
  const body = { documentId: 'd1', taTag: 'Oncology', module: 'A', docType: 'CSR', version: 'v1.0' }
  const push = (app: FastifyInstance, p: object = body) => app.inject({ method: 'POST', url: '/library/push', payload: p })

  it('accepts a signed document whatever its stage (signing does not advance the stepper)', async () => {
    const { app } = await setup({ doc: finalDoc({ stage: 'cross_functional_review' }) })
    expect((await push(app)).statusCode).toBe(201)
  })

  it('pushes a signed final document with the four tags and writes an audit entry', async () => {
    const { app, create, append } = await setup({ role: 'contributor' })
    const res = await push(app)
    expect(res.statusCode).toBe(201)
    const data = create.mock.calls[0]![0].data
    expect(data).toMatchObject({ tenantId: 't1', taTag: 'Oncology', framework: 'CSR', version: 1, title: 'CSR Study 1' })
    expect(data.tags).toEqual(expect.arrayContaining(['module:A', 'doctype:CSR', 'project:p1', 'source:d1', 'fromdoc:d1', 'docversion:v1.0', 'type:document']))
    expect(data.body).toBe('1 Title Page\nTitle text\n\n2 Synopsis\nSynopsis text')   // natural section order
    expect(append).toHaveBeenCalledWith(expect.objectContaining({ action: 'library_pushed', details: expect.objectContaining({ documentId: 'd1', documentVersion: 'v1.0' }) }))
    expect(res.json()).toMatchObject({ itemType: 'document', version: 'v1.0' })
  })

  it('refuses a document that is not signed and final (AC-A-054)', async () => {
    for (const over of [{ status: 'in_review' }, { status: 'pending_signature' }]) {
      const { app, create } = await setup({ doc: finalDoc(over) })
      const res = await push(app)
      expect(res.statusCode).toBe(409)
      expect(res.json().error).toBe('not_final')
      expect(create).not.toHaveBeenCalled()
      await current?.close()
    }
  })

  it('is for the document\'s Author (R) only', async () => {
    access.canEdit = false
    const { app, create } = await setup({ role: 'pm' })
    const res = await push(app)
    expect(res.statusCode).toBe(403)
    expect(res.json().error).toBe('push_forbidden')
    expect(create).not.toHaveBeenCalled()
  })

  it('hides a document in a project the caller cannot see', async () => {
    visibility.projects = new Set(['other'])
    const { app } = await setup({ role: 'contributor' })
    expect((await push(app)).statusCode).toBe(404)
  })

  it.each(['taTag', 'module', 'docType', 'version'])('refuses a push with no %s', async (key) => {
    const { app, create } = await setup()
    const { [key]: _omit, ...rest } = body as Record<string, string>
    void _omit
    expect((await push(app, rest)).statusCode).toBe(400)
    expect(create).not.toHaveBeenCalled()
  })

  it('refuses a therapeutic area that differs from the document\'s', async () => {
    const { app } = await setup({ doc: finalDoc({ therapeuticArea: 'Cardiology' }) })
    const res = await push(app)
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('ta_mismatch')
  })

  it('refuses to push a single section, however the request names it, and writes nothing', async () => {
    for (const extra of [{ sectionId: 's2' }, { sectionId: '' }, { scope: 'section' }, { scope: 'section', sectionId: 's2' }]) {
      const { app, create, update, append } = await setup()
      const res = await push(app, { ...body, ...extra })
      expect(res.statusCode).toBe(400)
      expect(res.json().error).toBe('section_push_not_supported')
      expect(res.json().message).toMatch(/whole document/i)
      expect(create).not.toHaveBeenCalled()
      expect(update).not.toHaveBeenCalled()
      expect(append).not.toHaveBeenCalled()
      await current?.close()
    }
  })

  it('still pushes the whole document when the request says scope: document, and logs it as a whole-document push', async () => {
    const { app, create, append } = await setup()
    const res = await push(app, { ...body, scope: 'document' })
    expect(res.statusCode).toBe(201)
    expect(create.mock.calls[0]![0].data.tags).toEqual(expect.arrayContaining(['source:d1', 'type:document']))
    expect(create.mock.calls[0]![0].data.tags.some((t: string) => t.includes('#'))).toBe(false)
    expect(append).toHaveBeenCalledWith(expect.objectContaining({ action: 'library_pushed', details: expect.objectContaining({ scope: 'document', documentId: 'd1' }) }))
  })

  it('refuses a document with no content', async () => {
    const empty = finalDoc()
    for (const sec of empty.currentVersion.sections) sec.contentHtml = '<p> </p>'
    const { app } = await setup({ doc: empty })
    expect((await push(app)).statusCode).toBe(422)
  })

  it('refuses the same document version twice, but supersedes the entry for a newer version', async () => {
    const again = await setup({ earlier: row('old', { tags: ['source:d1', 'docversion:v1.0'] }) })
    expect((await push(again.app)).statusCode).toBe(409)
    await current?.close()

    const newer = await setup({ earlier: row('old', { version: 2, tags: ['source:d1', 'docversion:v0.9'] }) })
    const res = await push(newer.app)
    expect(res.statusCode).toBe(201)
    expect(newer.create.mock.calls[0]![0].data.version).toBe(3)
    expect(newer.update.mock.calls[0]![0]).toMatchObject({ where: { id: 'old' }, data: { isCurrent: false, supersededBy: 'new-1' } })
  })

  it('takes a per-document lock before creating the entry, so two pushes cannot interleave', async () => {
    const { app, executeRaw, create } = await setup()
    expect((await push(app)).statusCode).toBe(201)
    expect(executeRaw).toHaveBeenCalledTimes(1)
    // the lock is on this document (tagged template call: first argument is the SQL text parts)
    const call = executeRaw.mock.calls[0] as unknown as [TemplateStringsArray, string]
    expect(call[0].join('?')).toContain('pg_advisory_xact_lock')
    expect(call[1]).toContain('source:d1')
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('a push that landed between the quick check and the lock is refused with 409 and nothing is created', async () => {
    // The quick check sees nothing; by the time this request has the lock, the other push has finished.
    const { app, create, update } = await setup({ earlier: null, earlierInTx: row('other', { tags: ['source:d1', 'docversion:v1.0'] }) })
    const res = await push(app)
    expect(res.statusCode).toBe(409)
    expect(res.json()).toMatchObject({ error: 'already_pushed' })
    expect(create).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
  })

  it('a push that landed meanwhile for an OLDER version is superseded by the new one under the lock', async () => {
    const { app, create, update } = await setup({ earlier: null, earlierInTx: row('other', { version: 1, tags: ['source:d1', 'docversion:v0.9'] }) })
    expect((await push(app)).statusCode).toBe(201)
    expect(create.mock.calls[0]![0].data.version).toBe(2)
    expect(update.mock.calls[0]![0]).toMatchObject({ where: { id: 'other' }, data: { isCurrent: false } })
  })
})

describe('GET /library/by-document/:documentId', () => {
  it('lists what of the document is already in the library, whole document and sections', async () => {
    const { app, findMany } = await setup()
    findMany.mockResolvedValueOnce([
      row('x1', { title: 'CSR Study 1', tags: ['source:d1', 'fromdoc:d1', 'docversion:v1.0', 'type:document'] }),
      row('x2', { title: 'CSR Study 1 — 2 Synopsis', version: 2, tags: ['source:d1#s2', 'fromdoc:d1', 'docversion:v1.0'] }),
    ] as never)
    const res = await app.inject({ method: 'GET', url: '/library/by-document/d1' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual([
      { id: 'x1', name: 'CSR Study 1', sectionId: null, documentVersion: 'v1.0', libraryVersion: 'v1.0' },
      { id: 'x2', name: 'CSR Study 1 — 2 Synopsis', sectionId: 's2', documentVersion: 'v1.0', libraryVersion: 'v2.0' },
    ])
    const where = (findMany.mock.calls[0] as unknown as [{ where: Record<string, unknown> }])[0].where
    expect(where).toMatchObject({ isCurrent: true, retiredAt: null, tags: { has: 'fromdoc:d1' } })
  })

  it('404s a document the caller cannot see', async () => {
    visibility.projects = new Set(['other'])
    const { app } = await setup({ role: 'contributor' })
    expect((await app.inject({ method: 'GET', url: '/library/by-document/d1' })).statusCode).toBe(404)
  })
})

describe('GET /library/:id/pdf', () => {
  it('returns the item as a PDF file with only its title and text', async () => {
    const { app } = await setup({ found: row('a', { title: 'CSR Full — §5 Ethics', body: 'Ethics text ≥ 18 years' }) })
    const res = await app.inject({ method: 'GET', url: '/library/a/pdf' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('application/pdf')
    expect(res.headers['content-disposition']).toContain('attachment; filename="CSR_Full_5_Ethics.pdf"')
    expect(res.rawPayload.subarray(0, 5).toString()).toBe('%PDF-')
  })

  it('404s an item the caller cannot see, and 422s one with no text', async () => {
    const hidden = await setup({ found: null })
    expect((await hidden.app.inject({ method: 'GET', url: '/library/a/pdf' })).statusCode).toBe(404)
    await current?.close()
    const empty = await setup({ found: row('a', { body: '  ' }) })
    expect((await empty.app.inject({ method: 'GET', url: '/library/a/pdf' })).statusCode).toBe(422)
  })

  it('looks the item up through the tenant filter', async () => {
    const { app, findFirst } = await setup()
    await app.inject({ method: 'GET', url: '/library/a/pdf' })
    expect(JSON.stringify(findFirst.mock.calls[0])).toContain('"tenantId":"t1"')
  })
})

describe('pdfSafeText', () => {
  it('spells out common symbols and replaces what the PDF font cannot print', async () => {
    const { pdfSafeText } = await import('./pdf-renderer.js')
    expect(pdfSafeText('age ≥ 18 → yes — “ok” é')).toBe('age >= 18 -> yes — “ok” é')
    expect(pdfSafeText('日本')).toBe('??')
  })
})

describe('POST /library/sections/:id/adopt — recording text adopted into a document', () => {
  const adopt = (app: FastifyInstance, entity = 'd1') =>
    app.inject({ method: 'POST', url: '/library/sections/a/adopt', payload: { adoptingModule: 'A', adoptingEntity: entity } })

  it('refuses someone who may not edit that document, and records nothing', async () => {
    access.canEdit = false
    const { app, prisma } = await setup()
    const res = await adopt(app)
    expect(res.statusCode).toBe(403)
    expect(res.json()).toMatchObject({ error: 'adopt_forbidden' })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('records the adoption for someone who may edit that document', async () => {
    access.canEdit = true
    const { app, prisma } = await setup()
    expect((await adopt(app)).statusCode).toBe(201)
    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
  })

  it('still 404s a section the caller cannot see, before any edit-rights question', async () => {
    access.canEdit = false
    const { app } = await setup({ found: null })
    expect((await adopt(app)).statusCode).toBe(404)
  })
})

describe('GET /library/:id/pdf — size cap', () => {
  it('refuses an item too long to render with 413 instead of building the PDF', async () => {
    const { app } = await setup({ found: row('a', { body: 'x'.repeat(2_000_001) }) })
    const res = await app.inject({ method: 'GET', url: '/library/a/pdf' })
    expect(res.statusCode).toBe(413)
    expect(res.json()).toMatchObject({ error: 'too_large' })
  })
})
