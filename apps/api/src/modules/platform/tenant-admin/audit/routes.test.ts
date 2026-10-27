// Audit viewer routes — exercised through Fastify inject() against a fake
// Prisma ($queryRawUnsafe) + fake audit repository, so no database is
// touched. Pins the BigInt serialisation fix, filter SQL, paging, the
// export cap, input validation and the super-admin gate.

import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser, Role } from '../../../../auth/rbac.js'
import { auditViewerRoutes, COUNT_CAP, EXPORT_ROW_CAP } from './routes.js'

interface FakeRow {
  id: bigint
  timestamp: Date
  actor_id: string
  actor_name: string | null
  actor_email: string | null
  action: string
  entity_type: string
  entity_id: string
  details: Record<string, unknown>
  ip_address: string | null
  prev_hash: string
  row_hash: string
}

function makeRow(id: number, over: Partial<FakeRow> = {}): FakeRow {
  return {
    id: BigInt(id),
    timestamp: new Date(Date.UTC(2026, 9, 12, 10, 0, id % 60)),
    actor_id: 'user-admin',
    actor_name: 'Dr James Hartley',
    actor_email: 'j.hartley@genbioca.com',
    action: 'http.post',
    entity_type: 'http_request',
    entity_id: '/projects',
    details: { statusCode: 201, method: 'POST' },
    ip_address: '127.0.0.1',
    prev_hash: `prev-${id}`,
    row_hash: `hash-${id}`,
    ...over,
  }
}

interface Setup {
  role?: Role | null          // null → unauthenticated
  tenantId?: string | null    // the signed-in user's tenant (default null)
  rows?: FakeRow[]
  count?: number
  fail?: Error
}

interface Call { sql: string; params: unknown[] }

async function buildApp(setup: Setup = {}): Promise<{ app: FastifyInstance; calls: Call[]; verifyChain: ReturnType<typeof vi.fn>; append: ReturnType<typeof vi.fn> }> {
  const calls: Call[] = []
  const rows = setup.rows ?? []
  const $queryRawUnsafe = vi.fn(async (sql: string, ...params: unknown[]) => {
    calls.push({ sql, params })
    if (setup.fail) throw setup.fail
    if (sql.includes('count(*)')) return [{ n: setup.count ?? rows.length }]
    if (sql.includes('DISTINCT action')) return [{ v: 'auth.login' }, { v: 'http.post' }]
    if (sql.includes('DISTINCT entity_type')) return [{ v: 'session' }]
    return rows
  })
  const verifyChain = vi.fn(async () => ({ intact: true, firstBreakAt: null }))
  const append = vi.fn(async () => ({}))

  const app = Fastify()
  app.decorate('prisma', { $queryRawUnsafe } as never)
  app.decorate('audit', { verifyChain, append } as never)
  app.decorateRequest('user', null)
  const role = setup.role === undefined ? 'admin' : setup.role
  app.addHook('onRequest', async (request) => {
    if (role === null) return
    const user: AuthenticatedUser = { id: 'user-admin', email: 'admin@clinwrite.ai', role, modules: [], tenantId: setup.tenantId ?? null }
    ;(request as unknown as { user: AuthenticatedUser }).user = user
  })
  await app.register(auditViewerRoutes)
  await app.ready()
  return { app, calls, verifyChain, append }
}

const pageSql = (calls: Call[]) => calls.find(c => c.sql.includes('ORDER BY'))!

let current: FastifyInstance | null = null
afterEach(async () => {
  await current?.close()
  current = null
})

async function setupApp(setup: Setup = {}) {
  const built = await buildApp(setup)
  current = built.app
  return built
}

describe('GET /admin/audit', () => {
  it('serialises BigInt ids as strings and returns actor details + totals', async () => {
    const { app } = await setupApp({ rows: [makeRow(3), makeRow(2)], count: 2 })
    const res = await app.inject({ method: 'GET', url: '/admin/audit?limit=5' })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.rows.map((r: { id: string }) => r.id)).toEqual(['3', '2'])
    expect(body.rows[0]).toMatchObject({
      actorId: 'user-admin',
      actorName: 'Dr James Hartley',
      actorEmail: 'j.hartley@genbioca.com',
      timestamp: '2026-10-12T10:00:03.000Z',
    })
    expect(body).toMatchObject({ hasMore: false, nextCursor: null, total: 2, totalCapped: false })
  })

  it('detects another page and returns the last visible id as the cursor', async () => {
    // limit=2 → the route asks for 3; three rows back means "more".
    const { app } = await setupApp({ rows: [makeRow(9), makeRow(8), makeRow(7)], count: 9 })
    const body = (await app.inject({ method: 'GET', url: '/admin/audit?limit=2' })).json()
    expect(body.rows).toHaveLength(2)
    expect(body.hasMore).toBe(true)
    expect(body.nextCursor).toBe('8')
  })

  it('pages newest-first with id < cursor by default', async () => {
    const { app, calls } = await setupApp({ rows: [makeRow(4)] })
    await app.inject({ method: 'GET', url: '/admin/audit?cursor=5&limit=10' })
    const { sql, params } = pageSql(calls)
    expect(sql).toContain('a.id < $1::bigint')
    expect(sql).toContain('ORDER BY a.id DESC')
    expect(params).toEqual(['5', 11])
  })

  it('pages oldest-first with id > cursor when order=asc', async () => {
    const { app, calls } = await setupApp({ rows: [makeRow(6)] })
    await app.inject({ method: 'GET', url: '/admin/audit?order=asc&cursor=5' })
    const { sql } = pageSql(calls)
    expect(sql).toContain('a.id > $1::bigint')
    expect(sql).toContain('ORDER BY a.id ASC')
  })

  it('uses case-insensitive contains for action/entity type and escapes LIKE wildcards', async () => {
    const { app, calls } = await setupApp()
    await app.inject({ method: 'GET', url: '/admin/audit?action=100%25_x&entityType=Doc' })
    const { sql, params } = pageSql(calls)
    expect(sql).toContain('a.entity_type ILIKE $1')
    expect(sql).toContain('a.action ILIKE $2')
    expect(params.slice(0, 2)).toEqual(['%Doc%', '%100\\%\\_x%'])
  })

  it('matches actor by exact id or partial name / email', async () => {
    const { app, calls } = await setupApp()
    await app.inject({ method: 'GET', url: '/admin/audit?actor=hartley' })
    const { sql, params } = pageSql(calls)
    expect(sql).toContain('(a.actor_id = $1 OR u.email ILIKE $2 OR u.name ILIKE $2)')
    expect(params.slice(0, 2)).toEqual(['hartley', '%hartley%'])
  })

  it('keeps entityId an exact match', async () => {
    const { app, calls } = await setupApp()
    await app.inject({ method: 'GET', url: '/admin/audit?entityId=proj-velora-301' })
    expect(pageSql(calls).sql).toContain('a.entity_id = $1')
  })

  it('accepts dates with an offset as well as Z', async () => {
    const { app } = await setupApp()
    const withOffset = await app.inject({ method: 'GET', url: '/admin/audit?fromDate=2026-10-12T00:00:00%2B05:30' })
    const withZ = await app.inject({ method: 'GET', url: '/admin/audit?toDate=2026-10-12T23:59:59Z' })
    expect(withOffset.statusCode).toBe(200)
    expect(withZ.statusCode).toBe(200)
  })

  it('rejects a date-only value with 400', async () => {
    const { app, calls } = await setupApp()
    const res = await app.inject({ method: 'GET', url: '/admin/audit?fromDate=2026-10-01' })
    expect(res.statusCode).toBe(400)
    expect(calls).toHaveLength(0)
  })

  it('rejects a non-numeric cursor with 400 before touching the database', async () => {
    const { app, calls } = await setupApp()
    const res = await app.inject({ method: 'GET', url: '/admin/audit?cursor=abc' })
    expect(res.statusCode).toBe(400)
    expect(res.json().issues[0].path).toEqual(['cursor'])
    expect(calls).toHaveLength(0)
  })

  it('reports a capped total for broad filters', async () => {
    const { app } = await setupApp({ count: COUNT_CAP + 1 })
    const body = (await app.inject({ method: 'GET', url: '/admin/audit' })).json()
    expect(body.total).toBe(COUNT_CAP)
    expect(body.totalCapped).toBe(true)
  })

  it('hides database error text behind a generic 500', async () => {
    const { app } = await setupApp({ fail: new Error('invalid input syntax for type bigint: "abc" SELECT secret FROM x') })
    const res = await app.inject({ method: 'GET', url: '/admin/audit' })
    expect(res.statusCode).toBe(500)
    expect(res.json()).toMatchObject({ error: 'internal', message: 'Audit query failed.' })
    expect(res.body).not.toContain('SELECT')
    expect(res.body).not.toContain('bigint')
  })
})

describe('access control', () => {
  it('returns 401 when unauthenticated', async () => {
    const { app } = await setupApp({ role: null })
    expect((await app.inject({ method: 'GET', url: '/admin/audit' })).statusCode).toBe(401)
  })

  it.each(['clinical-writer', 'reviewer', 'read-only'] as const)('returns 403 for role %s', async (role) => {
    const { app, calls } = await setupApp({ role })
    for (const url of ['/admin/audit', '/admin/audit/export', '/admin/audit/verify', '/admin/audit/facets']) {
      expect((await app.inject({ method: 'GET', url })).statusCode).toBe(403)
    }
    expect(calls).toHaveLength(0)
  })

  it('lets admin in on every audit route', async () => {
    const { app } = await setupApp({ role: 'admin', tenantId: 'TENANT-ACME' })
    for (const url of ['/admin/audit', '/admin/audit/export', '/admin/audit/verify', '/admin/audit/facets']) {
      expect((await app.inject({ method: 'GET', url })).statusCode).toBe(200)
    }
  })
})

describe('tenant scoping', () => {
  it("restricts an admin's list, count, facets and export to actors in their own tenant", async () => {
    const { app, calls } = await setupApp({ role: 'admin', tenantId: 'TENANT-ACME' })
    for (const url of ['/admin/audit', '/admin/audit/facets', '/admin/audit/export']) {
      await app.inject({ method: 'GET', url })
    }
    expect(calls).toHaveLength(5) // count + page, 2 facets, export
    for (const c of calls) {
      expect(c.sql).toContain('u."tenantId" = $1')
      expect(c.params[0]).toBe('TENANT-ACME')
    }
  })

  // Pre-2026-10-27: 'admin + tenantId=null' was a defensive dead-end that
  // matched nothing. Post role-consolidation, 'admin + tenantId=null' IS the
  // platform admin and is intentionally unscoped — see tenantScopeFor().
  // The old fails-closed assertion is retired with the super-admin role.

  it('keeps super-admin unscoped', async () => {
    const { app, calls } = await setupApp({ role: 'admin', tenantId: null })
    await app.inject({ method: 'GET', url: '/admin/audit' })
    await app.inject({ method: 'GET', url: '/admin/audit/facets' })
    for (const c of calls) expect(c.sql).not.toMatch(/tenantId|WHERE FALSE/)
  })

  it('combines the tenant scope with user filters, scope first', async () => {
    const { app, calls } = await setupApp({ role: 'admin', tenantId: 'TENANT-ACME' })
    await app.inject({ method: 'GET', url: '/admin/audit?action=login' })
    const page = pageSql(calls)
    expect(page.sql).toMatch(/u\."tenantId" = \$1 AND a\.action ILIKE \$2/)
    expect(page.params.slice(0, 2)).toEqual(['TENANT-ACME', '%login%'])
  })
})

describe('GET /admin/audit/facets', () => {
  it('returns distinct actions and entity types', async () => {
    const { app } = await setupApp()
    const body = (await app.inject({ method: 'GET', url: '/admin/audit/facets' })).json()
    expect(body).toEqual({ actions: ['auth.login', 'http.post'], entityTypes: ['session'] })
  })
})

describe('GET /admin/audit/newer', () => {
  const newerSql = (calls: Call[]) => calls.find(c => c.sql.includes('a.id >'))!

  it('reports how many matching entries are newer than the given id', async () => {
    const { app } = await setupApp({ count: 7 })
    const res = await app.inject({ method: 'GET', url: '/admin/audit/newer?afterId=3672' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ count: 7, capped: false })
  })

  it('stops counting at the cap and says so', async () => {
    const { app, calls } = await setupApp({ count: 101 })
    const body = (await app.inject({ method: 'GET', url: '/admin/audit/newer?afterId=1' })).json()
    expect(body).toEqual({ count: 100, capped: true })
    expect(newerSql(calls).sql).toContain('LIMIT 101')
  })

  it('is a single cheap query: no page fetch, no ordering, only ids after afterId', async () => {
    const { app, calls } = await setupApp({ count: 0 })
    await app.inject({ method: 'GET', url: '/admin/audit/newer?afterId=3672' })
    expect(calls).toHaveLength(1)
    expect(calls[0]!.sql).toContain('a.id > $1::bigint')
    expect(calls[0]!.sql).not.toContain('ORDER BY')
    expect(calls[0]!.params).toEqual(['3672'])
  })

  it('applies the same filters as the list, before the id condition', async () => {
    const { app, calls } = await setupApp({ count: 2 })
    await app.inject({ method: 'GET', url: '/admin/audit/newer?afterId=50&action=login&entityId=DOC-1&q=alex' })
    const { sql, params } = newerSql(calls)
    expect(sql).toMatch(/a\.entity_id = \$\d/)
    expect(sql).toMatch(/a\.action ILIKE \$\d/)
    expect(sql).toMatch(/AND a\.id > \$\d+::bigint/)
    expect(params[params.length - 1]).toBe('50')
    expect(params).toContain('DOC-1')
    expect(params).toContain('%login%')
  })

  it('keeps an admin inside their own tenant', async () => {
    const { app, calls } = await setupApp({ role: 'admin', tenantId: 'TENANT-ACME', count: 1 })
    await app.inject({ method: 'GET', url: '/admin/audit/newer?afterId=10' })
    expect(newerSql(calls).sql).toMatch(/u\."tenantId" = \$1 AND a\.id > \$2::bigint/)
    expect(newerSql(calls).params).toEqual(['TENANT-ACME', '10'])
  })

  // Pre-2026-10-27 fails-closed assertion retired with super-admin (see note
  // above the GET /admin/audit block).

  it('requires a numeric afterId', async () => {
    const { app, calls } = await setupApp()
    for (const url of ['/admin/audit/newer', '/admin/audit/newer?afterId=abc', '/admin/audit/newer?afterId=1;DROP']) {
      expect((await app.inject({ method: 'GET', url })).statusCode).toBe(400)
    }
    expect(calls).toHaveLength(0)
  })

  it('is closed to non-admin roles and unauthenticated callers', async () => {
    const anon = await setupApp({ role: null })
    expect((await anon.app.inject({ method: 'GET', url: '/admin/audit/newer?afterId=1' })).statusCode).toBe(401)
    await current?.close()
    const writer = await setupApp({ role: 'clinical-writer' })
    expect((await writer.app.inject({ method: 'GET', url: '/admin/audit/newer?afterId=1' })).statusCode).toBe(403)
    expect(writer.calls).toHaveLength(0)
  })

  it('does not write an audit entry (polling must not grow the log)', async () => {
    const { app, append } = await setupApp({ count: 0 })
    for (let i = 0; i < 3; i++) await app.inject({ method: 'GET', url: '/admin/audit/newer?afterId=1' })
    expect(append).not.toHaveBeenCalled()
  })
})

describe('GET /admin/audit/verify', () => {
  it('passes the id range to the repository and echoes it back', async () => {
    const { app, verifyChain } = await setupApp()
    const res = await app.inject({ method: 'GET', url: '/admin/audit/verify?fromId=5&toId=20' })
    expect(res.statusCode).toBe(200)
    expect(verifyChain).toHaveBeenCalledWith('5', '20')
    expect(res.json()).toMatchObject({ intact: true, firstBreakAt: null, checkedRange: { from: '5', to: '20' } })
  })

  it('rejects non-numeric ids with 400', async () => {
    const { app, verifyChain } = await setupApp()
    const res = await app.inject({ method: 'GET', url: '/admin/audit/verify?fromId=abc' })
    expect(res.statusCode).toBe(400)
    expect(verifyChain).not.toHaveBeenCalled()
  })
})

describe('GET /admin/audit/export', () => {
  it('returns CSV with BigInt ids, actor columns and newest-first order', async () => {
    const { app, calls } = await setupApp({ rows: [makeRow(2), makeRow(1, { actor_id: 'anonymous', actor_name: null, actor_email: null })] })
    const res = await app.inject({ method: 'GET', url: '/admin/audit/export' })

    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('text/csv')
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="audit-\d{4}-\d{2}-\d{2}\.csv"/)
    expect(res.headers['x-audit-export-truncated']).toBe('false')
    expect(pageSql(calls).sql).toContain('ORDER BY a.id DESC')

    const lines = res.body.split('\n')
    expect(lines[0]).toBe('id,timestamp,actorId,actorName,actorEmail,actorRole,sessionId,action,entityType,entityId,oldValue,newValue,details,ipAddress,prevHash,rowHash')
    expect(lines[1]!.startsWith('2,2026-10-12T10:00:02.000Z,user-admin,Dr James Hartley,j.hartley@genbioca.com,,,http.post')).toBe(true)
    expect(lines[1]).toContain('"{""statusCode"":201,""method"":""POST""}"')
    expect(lines[2]!.startsWith('1,2026-10-12T10:00:01.000Z,anonymous,,,,,')).toBe(true)
    expect(lines).toHaveLength(3)
  })

  it('exports oldest-first when order=asc', async () => {
    const { app, calls } = await setupApp()
    await app.inject({ method: 'GET', url: '/admin/audit/export?order=asc' })
    expect(pageSql(calls).sql).toContain('ORDER BY a.id ASC')
  })

  it('flags truncation instead of silently dropping rows past the cap', async () => {
    const rows = Array.from({ length: EXPORT_ROW_CAP + 1 }, (_, i) => makeRow(EXPORT_ROW_CAP + 1 - i))
    const { app } = await setupApp({ rows })
    const res = await app.inject({ method: 'GET', url: '/admin/audit/export' })

    expect(res.headers['x-audit-export-truncated']).toBe('true')
    const lines = res.body.split('\n')
    expect(lines).toHaveLength(1 + EXPORT_ROW_CAP + 1)  // header + capped rows + notice
    expect(lines[lines.length - 1]).toContain(`TRUNCATED: export capped at ${EXPORT_ROW_CAP} rows`)
  })

  it('applies the same filters as the list', async () => {
    const { app, calls } = await setupApp()
    await app.inject({ method: 'GET', url: '/admin/audit/export?action=login&entityId=s-1' })
    const { sql, params } = pageSql(calls)
    expect(sql).toContain('a.entity_id = $1')
    expect(sql).toContain('a.action ILIKE $2')
    expect(params).toEqual(['s-1', '%login%'])
  })
})


describe('sorting, search and audit-of-audit', () => {
  it('sorts by a non-id column with an id tie-break and pages by offset', async () => {
    const { app, calls } = await setupApp({ rows: [makeRow(1), makeRow(2), makeRow(3)], count: 9 })
    const body = (await app.inject({ method: 'GET', url: '/admin/audit?sortBy=action&order=asc&limit=2&cursor=4' })).json()
    const { sql } = pageSql(calls)
    expect(sql).toContain('ORDER BY a.action ASC NULLS LAST, a.id ASC')
    expect(sql).toContain('OFFSET 4')
    expect(sql).not.toContain('a.id >')
    expect(body.nextCursor).toBe('6')   // offset 4 + limit 2
  })

  it('rejects an unknown sort column', async () => {
    const { app } = await setupApp()
    expect((await app.inject({ method: 'GET', url: '/admin/audit?sortBy=row_hash' })).statusCode).toBe(400)
  })

  it('free-text search matches across columns with an escaped pattern', async () => {
    const { app, calls } = await setupApp()
    await app.inject({ method: 'GET', url: '/admin/audit?q=50%25' })
    const { sql, params } = pageSql(calls)
    expect(sql).toContain('a.details::text ILIKE')
    expect(sql).toContain('u.email ILIKE')
    expect(params[0]).toBe('%50\\%%')
  })

  it('exposes role, session id and old/new values on each row', async () => {
    const { app } = await setupApp({
      rows: [makeRow(7, { details: { actorRole: 'qa', sessionId: 'sess-1', from: 'draft', to: 'review' } })],
    })
    const row = (await app.inject({ method: 'GET', url: '/admin/audit' })).json().rows[0]
    expect(row).toMatchObject({ actorRole: 'qa', actorRoleRecorded: true, sessionId: 'sess-1', oldValue: 'draft', newValue: 'review' })
  })

  it('appends an audit.verify entry recording the range and result', async () => {
    const { app, append } = await setupApp()
    await app.inject({ method: 'GET', url: '/admin/audit/verify?fromId=200&toId=240' })
    expect(append).toHaveBeenCalledWith(expect.objectContaining({
      action: 'audit.verify',
      entityType: 'audit_log',
      details: expect.objectContaining({ fromId: '200', toId: '240', intact: true }),
    }))
  })

  it('appends an audit.export entry with the filters and row count', async () => {
    const { app, append } = await setupApp({ rows: [makeRow(2), makeRow(1)] })
    await app.inject({ method: 'GET', url: '/admin/audit/export?action=auth' })
    expect(append).toHaveBeenCalledWith(expect.objectContaining({
      action: 'audit.export',
      details: expect.objectContaining({ rowCount: 2, truncated: false, filters: expect.objectContaining({ action: 'auth' }) }),
    }))
  })

  it('fails the export when the access cannot be recorded', async () => {
    const { app, append } = await setupApp({ rows: [makeRow(1)] })
    append.mockRejectedValueOnce(new Error('db down'))
    expect((await app.inject({ method: 'GET', url: '/admin/audit/export' })).statusCode).toBe(500)
  })
})

describe('project scope (?projectId=)', () => {
  it('matches the project record, entries carrying its projectId, and its documents — one bound parameter', async () => {
    const { app, calls } = await setupApp({ rows: [makeRow(2), makeRow(1)] })
    const res = await app.inject({ method: 'GET', url: '/admin/audit?projectId=PROJ-1' })
    expect(res.statusCode).toBe(200)
    const page = pageSql(calls)
    expect(page.sql).toContain(`a.entity_type = 'project' AND a.entity_id = $1`)
    expect(page.sql).toContain(`a.details->>'projectId' = $1`)
    expect(page.sql).toMatch(/EXISTS \(\s*SELECT 1 FROM documents d WHERE d\.id = a\.entity_id AND d\."projectId" = \$1/)
    expect(page.sql).not.toMatch(/JOIN documents/)   // EXISTS, not a join — no row can be returned twice
    expect(page.params[0]).toBe('PROJ-1')
  })

  it('applies to export and the "newer entries" check too', async () => {
    const { app, calls } = await setupApp({ rows: [makeRow(1)] })
    await app.inject({ method: 'GET', url: '/admin/audit/export?projectId=PROJ-1' })
    await app.inject({ method: 'GET', url: '/admin/audit/newer?projectId=PROJ-1&afterId=1' })
    const scoped = calls.filter(c => c.sql.includes(`a.details->>'projectId'`))
    expect(scoped.length).toBeGreaterThanOrEqual(2)
    for (const c of scoped) expect(c.params).toContain('PROJ-1')
  })

  it('combines with the tenant scope for admins, tenant first', async () => {
    const { app, calls } = await setupApp({ role: 'admin', tenantId: 'TENANT-ACME' })
    await app.inject({ method: 'GET', url: '/admin/audit?projectId=PROJ-1' })
    const page = pageSql(calls)
    expect(page.sql).toMatch(/u\."tenantId" = \$1 AND \(/)
    expect(page.params.slice(0, 2)).toEqual(['TENANT-ACME', 'PROJ-1'])
  })
})
