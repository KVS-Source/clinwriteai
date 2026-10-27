// Audit viewer — Arc 3.6 of docs/pivot-plan.md.
//
// Routes:
//   GET  /admin/audit                      filtered + paginated query
//   GET  /admin/audit/facets               distinct actions + entity types (filter dropdowns)
//   GET  /admin/audit/verify               hash-chain integrity check
//   GET  /admin/audit/export               CSV download of a filter range
//
// Super-admin sees every tenant. Admin is tenant-scoped: audit_events carry no
// tenantId yet (deferred — see project_phase_5_deferrals memory re: Part 11
// artefact format), so an admin sees only entries whose ACTOR belongs to the
// admin's own tenant (users."tenantId"). System/anonymous actors and actors in
// other tenants are excluded; an admin with no tenant sees nothing (fail closed).
// Verify-chain stays whole-chain for both: it returns only intact/firstBreakAt.

import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { requireAuth } from '../../../../auth/rbac.js'

// audit_events.id is a BIGSERIAL — ids/cursors travel as digit strings.
const bigintId = z.string().regex(/^\d{1,19}$/, 'must be a numeric audit id')

export const EXPORT_ROW_CAP = 10_000
// Above this many matches the list endpoint reports "N+" instead of an exact
// count, so a broad filter never turns into a full-table count.
export const COUNT_CAP = 10_000
// The "new entries" check stops counting here and reports "100+".
export const NEWER_CAP = 100

// Sortable columns -> SQL expression. Every sort tie-breaks on id so paging is
// stable. 'id' (the default) pages by keyset cursor; the other columns page by
// offset because their values are not unique.
const SORT_KEYS = ['id', 'timestamp', 'action', 'entity', 'actor', 'ip'] as const
const SORT_EXPR: Record<(typeof SORT_KEYS)[number], string> = {
  id:        'a.id',
  timestamp: 'a."timestamp"',
  action:    'a.action',
  entity:    'a.entity_type',
  actor:     'COALESCE(u.name, u.email, a.actor_id)',
  ip:        'a.ip_address',
}

const queryBaseSchema = z.object({
  actorId:    z.string().optional(),          // exact actor id
  actor:      z.string().optional(),          // partial name / email, or exact id
  entityType: z.string().optional(),          // partial, case-insensitive
  entityId:   z.string().optional(),          // exact
  projectId:  z.string().optional(),          // exact — everything belonging to one project (see buildFilter)
  action:     z.string().optional(),          // partial, case-insensitive
  fromDate:   z.string().datetime({ offset: true }).optional(),
  toDate:     z.string().datetime({ offset: true }).optional(),
  q:          z.string().trim().max(200).optional(),   // free-text search across the visible columns
  sortBy:     z.enum(SORT_KEYS).default('id'),
  order:      z.enum(['desc', 'asc']).default('desc'),
})

const pagedSchema = queryBaseSchema.extend({
  limit:  z.coerce.number().int().min(1).max(500).default(100),
  cursor: bigintId.optional(),
})

// Filters only: new entries always appear at the top of a newest-first list, so the
// sort options don't apply.
const newerSchema = queryBaseSchema.omit({ sortBy: true, order: true }).extend({
  afterId: bigintId,
})

const verifySchema = z.object({
  fromId: bigintId.optional(),
  toId:   bigintId.optional(),
})

interface AuditRow {
  id: bigint  // audit_events.id is BIGSERIAL; $queryRawUnsafe returns a JS BigInt
  timestamp: Date
  actor_id: string
  actor_name: string | null
  actor_email: string | null
  actor_role: string | null
  action: string
  entity_type: string
  entity_id: string
  details: Record<string, unknown>
  ip_address: string | null
  prev_hash: string
  row_hash: string
}

const SELECT_COLUMNS = `
  a.id, a."timestamp", a.actor_id, u.name AS actor_name, u.email AS actor_email, u.role AS actor_role,
  a.action, a.entity_type, a.entity_id, a.details, a.ip_address, a.prev_hash, a.row_hash`

// actor_id is either a users.id or a system marker such as 'anonymous';
// the LEFT JOIN leaves name/email null for the latter.
const FROM_CLAUSE = `FROM audit_events a LEFT JOIN users u ON u.id = a.actor_id`

// FR-A-061: identity (name, role, session) + old vs new value. Role and session
// are recorded in `details` for events written from this release on; older
// entries fall back to the user's current role and no session id.
const pickDetail = (d: Record<string, unknown> | null, keys: string[]): unknown => {
  for (const k of keys) if (d && d[k] !== undefined) return d[k]
  return null
}

export function auditRowShape(r: AuditRow) {
  const d = r.details ?? {}
  const recordedRole = pickDetail(d, ['actorRole'])
  return {
    id: String(r.id),
    timestamp: r.timestamp.toISOString(),
    actorId: r.actor_id,
    actorName: r.actor_name,
    actorEmail: r.actor_email,
    actorRole: typeof recordedRole === 'string' ? recordedRole : r.actor_role,
    actorRoleRecorded: typeof recordedRole === 'string',
    sessionId: (pickDetail(d, ['sessionId']) as string | null) ?? null,
    oldValue: pickDetail(d, ['oldValue', 'old', 'before', 'from']),
    newValue: pickDetail(d, ['newValue', 'new', 'after', 'to']),
    action: r.action,
    entityType: r.entity_type,
    entityId: r.entity_id,
    details: r.details,
    ipAddress: r.ip_address,
    prevHash: r.prev_hash,
    rowHash: r.row_hash,
  }
}

// ILIKE pattern for a "contains" match — escapes the LIKE wildcards so a
// user typing '%' or '_' searches for that literal character.
function containsPattern(value: string): string {
  return `%${value.replace(/[\\%_]/g, '\\$&')}%`
}

// Tenant scope for a request: undefined = unscoped (platform admin —
// role='admin' with tenantId=null, post 2026-10-27 role consolidation),
// null = admin without a tenant (matches nothing — defensive), string =
// that tenant's actors only.
export type TenantScope = string | null | undefined

export function tenantScopeFor(user: { role: string; tenantId: string | null }): TenantScope {
  return user.tenantId == null ? undefined : user.tenantId
}

// Builds the WHERE clause + params array from the shared query schema.
// Factored out so the query, count + export routes stay in lockstep.
export function buildFilter(q: Partial<z.infer<typeof queryBaseSchema>>, scope: TenantScope = undefined): { where: string; params: unknown[] } {
  const conditions: string[] = []
  const params: unknown[] = []
  const param = (value: unknown) => {
    params.push(value)
    return `$${params.length}`
  }
  if (scope === null)        conditions.push('FALSE')
  else if (scope !== undefined) conditions.push(`u."tenantId" = ${param(scope)}`)
  if (q.actorId)    conditions.push(`a.actor_id = ${param(q.actorId)}`)
  if (q.actor) {
    const exact = param(q.actor)
    const like = param(containsPattern(q.actor))
    conditions.push(`(a.actor_id = ${exact} OR u.email ILIKE ${like} OR u.name ILIKE ${like})`)
  }
  if (q.q) {
    const like = param(containsPattern(q.q))
    conditions.push(`(a.action ILIKE ${like} OR a.entity_type ILIKE ${like} OR a.entity_id ILIKE ${like}
      OR a.actor_id ILIKE ${like} OR u.name ILIKE ${like} OR u.email ILIKE ${like}
      OR a.ip_address ILIKE ${like} OR a.details::text ILIKE ${like})`)
  }
  if (q.entityType) conditions.push(`a.entity_type ILIKE ${param(containsPattern(q.entityType))}`)
  if (q.entityId)   conditions.push(`a.entity_id = ${param(q.entityId)}`)
  // Project scope: the project record itself, any entry whose details carry the
  // project id, and any entry recorded against one of the project's documents.
  // A read-side filter over the one audit chain — nothing is copied, and each
  // matching row is returned once (EXISTS, not a join).
  if (q.projectId) {
    const p = param(q.projectId)
    conditions.push(`(
      (a.entity_type = 'project' AND a.entity_id = ${p})
      OR a.details->>'projectId' = ${p}
      OR (a.entity_type = 'document' AND EXISTS (
        SELECT 1 FROM documents d WHERE d.id = a.entity_id AND d."projectId" = ${p}
      ))
    )`)
  }
  if (q.action)     conditions.push(`a.action ILIKE ${param(containsPattern(q.action))}`)
  if (q.fromDate)   conditions.push(`a."timestamp" >= ${param(q.fromDate)}::timestamptz`)
  if (q.toDate)     conditions.push(`a."timestamp" <= ${param(q.toDate)}::timestamptz`)
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  return { where, params }
}

// Escape CSV cell — doubles embedded quotes and wraps in quotes when the
// value contains comma/quote/newline. Keeps the output Excel-safe.
function csvCell(v: unknown): string {
  if (v === null || v === undefined) return ''
  const s = typeof v === 'string' ? v
          : typeof v === 'bigint' ? v.toString()
          : JSON.stringify(v)
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

export const auditViewerRoutes: FastifyPluginAsync = async (app) => {
  // Viewing evidence is itself an auditable act: exports and chain verifications
  // append their own entry (who, when, which filters, what came back). Awaited,
  // so a request that can't be recorded fails instead of leaving no trace.
  const recordAuditAccess = (
    request: import('fastify').FastifyRequest,
    action: 'audit.export' | 'audit.verify',
    details: Record<string, unknown>,
  ) => app.audit.append({
    timestamp: new Date().toISOString(),
    actorId: request.user?.id ?? 'anonymous',
    action,
    entityType: 'audit_log',
    entityId: action === 'audit.export' ? 'export' : 'verify',
    details: { ...details, actorRole: request.user?.role ?? null, sessionId: request.authClaims?.jti ?? null },
    ipAddress: request.ip ?? null,
  })

  const auditGate = requireAuth({ roles: ['admin'] })
  const scopeOf = (request: import('fastify').FastifyRequest) => tenantScopeFor(request.user!)

  // Scoped to this plugin: unexpected failures are logged in full but the
  // client only gets a generic message + request id, never raw SQL /
  // Prisma error text.
  app.setErrorHandler((err, request, reply) => {
    const status = err.statusCode && err.statusCode < 500 ? err.statusCode : 500
    if (status < 500) return reply.code(status).send({ error: 'bad_request', message: err.message })
    request.log.error({ err }, 'audit viewer request failed')
    return reply.code(500).send({
      error: 'internal',
      message: 'Audit query failed.',
      requestId: request.id,
    })
  })

  app.get('/admin/audit', { preHandler: auditGate }, async (request, reply) => {
    const parsed = pagedSchema.safeParse(request.query)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })
    const q = parsed.data

    const { where, params } = buildFilter(q, scopeOf(request))

    // Count first, on the filter alone (no cursor), capped so a broad filter
    // stays cheap. Reported as total + totalCapped ("10000+").
    const countSql = `
      SELECT count(*)::int AS n FROM (
        SELECT 1 ${FROM_CLAUSE} ${where} LIMIT ${COUNT_CAP + 1}
      ) capped
    `
    const countRows = await app.prisma.$queryRawUnsafe<Array<{ n: number }>>(countSql, ...params)
    const matched = Number(countRows[0]?.n ?? 0)

    const pageParams = [...params]
    const dir = q.order === 'asc' ? 'ASC' : 'DESC'
    let cursorClause = ''
    let offsetClause = ''
    if (q.sortBy === 'id') {
      const cmp = q.order === 'asc' ? '>' : '<'
      if (q.cursor) cursorClause = ` ${where ? 'AND' : 'WHERE'} a.id ${cmp} $${pageParams.push(q.cursor)}::bigint`
    } else if (q.cursor) {
      // Non-unique sort keys can't use an id keyset cursor — the cursor is a row offset.
      offsetClause = ` OFFSET ${Math.min(Number(q.cursor), 1_000_000)}`
    }
    pageParams.push(q.limit + 1)  // fetch one extra to detect "more"

    const orderBy = q.sortBy === 'id'
      ? `a.id ${dir}`
      : `${SORT_EXPR[q.sortBy]} ${dir} NULLS LAST, a.id ${dir}`
    const sql = `
      SELECT ${SELECT_COLUMNS}
      ${FROM_CLAUSE}
      ${where}${cursorClause}
      ORDER BY ${orderBy}
      LIMIT $${pageParams.length}${offsetClause}
    `
    const rows = await app.prisma.$queryRawUnsafe<AuditRow[]>(sql, ...pageParams)
    const hasMore = rows.length > q.limit
    const page = hasMore ? rows.slice(0, q.limit) : rows
    const nextCursor = !hasMore ? null
      : q.sortBy === 'id' ? String(page[page.length - 1]!.id)
      : String(Number(q.cursor ?? 0) + q.limit)

    return {
      rows: page.map(auditRowShape),
      nextCursor,
      hasMore,
      total: Math.min(matched, COUNT_CAP),
      totalCapped: matched > COUNT_CAP,
    }
  })

  // "Is there anything newer than entry #afterId that matches these filters?" The open
  // Audit Trail page asks this every few seconds instead of re-running the full list
  // query. It only looks at rows after afterId (an index range on the primary key) and
  // stops counting at NEWER_CAP, so it stays cheap however large the log grows and
  // however broad the search. Nothing is read from the list itself and nothing is audited.
  app.get('/admin/audit/newer', { preHandler: auditGate }, async (request, reply) => {
    const parsed = newerSchema.safeParse(request.query)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })
    const { afterId, ...filters } = parsed.data

    const { where, params } = buildFilter(filters, scopeOf(request))
    params.push(afterId)
    const sql = `
      SELECT count(*)::int AS n FROM (
        SELECT 1 ${FROM_CLAUSE} ${where ? `${where} AND` : 'WHERE'} a.id > $${params.length}::bigint LIMIT ${NEWER_CAP + 1}
      ) capped
    `
    const rows = await app.prisma.$queryRawUnsafe<Array<{ n: number }>>(sql, ...params)
    const n = Number(rows[0]?.n ?? 0)
    return { count: Math.min(n, NEWER_CAP), capped: n > NEWER_CAP }
  })

  // Distinct values for the filter dropdowns. Small, indexed columns; the
  // LIMIT keeps the payload bounded if action naming ever explodes.
  app.get('/admin/audit/facets', { preHandler: auditGate }, async (request) => {
    // Admins only get facet values from their own tenant's entries.
    const { where, params } = buildFilter({}, scopeOf(request))
    const actions = await app.prisma.$queryRawUnsafe<Array<{ v: string }>>(
      `SELECT DISTINCT action AS v ${FROM_CLAUSE} ${where} ORDER BY v LIMIT 500`, ...params,
    )
    const entityTypes = await app.prisma.$queryRawUnsafe<Array<{ v: string }>>(
      `SELECT DISTINCT entity_type AS v ${FROM_CLAUSE} ${where} ORDER BY v LIMIT 500`, ...params,
    )
    return {
      actions: actions.map(r => r.v),
      entityTypes: entityTypes.map(r => r.v),
    }
  })

  app.get('/admin/audit/verify', { preHandler: auditGate }, async (request, reply) => {
    const parsed = verifySchema.safeParse(request.query)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const result = await app.audit.verifyChain(parsed.data.fromId, parsed.data.toId)
    await recordAuditAccess(request, 'audit.verify', {
      fromId: parsed.data.fromId ?? null,
      toId: parsed.data.toId ?? null,
      intact: result.intact,
      firstBreakAt: result.firstBreakAt,
    })
    return {
      intact: result.intact,
      firstBreakAt: result.firstBreakAt,
      // Known-bad entries whitelisted by the verifier (see
      // audit/known-exceptions.ts). Surfaced so the Compliance UI shows
      // them as a visible chip rather than silently masking the break.
      exceptions: result.exceptions,
      unexpectedBreaks: result.unexpectedBreaks,
      checkedRange: { from: parsed.data.fromId ?? null, to: parsed.data.toId ?? null },
      verifiedAt: new Date().toISOString(),
    }
  })

  // Streaming would be nicer for very large exports, but for the handover
  // walkthroughs a single-shot response is fine. Capped at EXPORT_ROW_CAP;
  // when the filter matches more, the response says so (header + trailing
  // line) instead of silently dropping rows. Ordered like the screen
  // (newest first unless order=asc).
  app.get('/admin/audit/export', { preHandler: auditGate }, async (request, reply) => {
    const parsed = queryBaseSchema.safeParse(request.query)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const { where, params } = buildFilter(parsed.data, scopeOf(request))
    const exportDir = parsed.data.order === 'asc' ? 'ASC' : 'DESC'
    const exportOrderBy = parsed.data.sortBy === 'id'
      ? `a.id ${exportDir}`
      : `${SORT_EXPR[parsed.data.sortBy]} ${exportDir} NULLS LAST, a.id ${exportDir}`
    const sql = `
      SELECT ${SELECT_COLUMNS}
      ${FROM_CLAUSE}
      ${where}
      ORDER BY ${exportOrderBy}
      LIMIT ${EXPORT_ROW_CAP + 1}
    `
    const fetched = await app.prisma.$queryRawUnsafe<AuditRow[]>(sql, ...params)
    const truncated = fetched.length > EXPORT_ROW_CAP
    const rows = truncated ? fetched.slice(0, EXPORT_ROW_CAP) : fetched

    const { limit: _l, cursor: _c, ...appliedFilters } = parsed.data as typeof parsed.data & { limit?: unknown; cursor?: unknown }
    await recordAuditAccess(request, 'audit.export', { filters: appliedFilters, rowCount: rows.length, truncated })

    const header = ['id', 'timestamp', 'actorId', 'actorName', 'actorEmail', 'actorRole', 'sessionId', 'action', 'entityType', 'entityId', 'oldValue', 'newValue', 'details', 'ipAddress', 'prevHash', 'rowHash']
    const lines = [header.join(',')]
    for (const r of rows) {
      const shaped = auditRowShape(r)
      lines.push([
        csvCell(r.id),
        csvCell(r.timestamp.toISOString()),
        csvCell(r.actor_id),
        csvCell(r.actor_name),
        csvCell(r.actor_email),
        csvCell(shaped.actorRole),
        csvCell(shaped.sessionId),
        csvCell(r.action),
        csvCell(r.entity_type),
        csvCell(r.entity_id),
        csvCell(shaped.oldValue),
        csvCell(shaped.newValue),
        csvCell(r.details),
        csvCell(r.ip_address),
        csvCell(r.prev_hash),
        csvCell(r.row_hash),
      ].join(','))
    }
    if (truncated) {
      lines.push(csvCell(`TRUNCATED: export capped at ${EXPORT_ROW_CAP} rows; narrow the filters to export the rest`))
    }

    const filename = `audit-${new Date().toISOString().slice(0, 10)}.csv`
    reply.header('Content-Type', 'text/csv; charset=utf-8')
    reply.header('Content-Disposition', `attachment; filename="${filename}"`)
    reply.header('X-Audit-Export-Truncated', truncated ? 'true' : 'false')
    return lines.join('\n')
  })
}
