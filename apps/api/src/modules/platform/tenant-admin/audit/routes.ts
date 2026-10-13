// Audit viewer — Arc 3.6 of docs/pivot-plan.md.
//
// Routes:
//   GET  /admin/audit                      filtered + paginated query
//   GET  /admin/audit/facets               distinct actions + entity types (filter dropdowns)
//   GET  /admin/audit/verify               hash-chain integrity check
//   GET  /admin/audit/export               CSV download of a filter range
//
// Super-admin only. Tenant-scoped audit filtering lands when the actor
// records carry tenantId directly (deferred — see
// project_phase_5_deferrals memory re: Part 11 artefact format).
// Today super-admin crosses tenants anyway so the filter list is
// sufficient for the handover walkthroughs.

import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { requireAuth } from '../../../../auth/rbac.js'

// audit_events.id is a BIGSERIAL — ids/cursors travel as digit strings.
const bigintId = z.string().regex(/^\d{1,19}$/, 'must be a numeric audit id')

export const EXPORT_ROW_CAP = 10_000
// Above this many matches the list endpoint reports "N+" instead of an exact
// count, so a broad filter never turns into a full-table count.
export const COUNT_CAP = 10_000

const queryBaseSchema = z.object({
  actorId:    z.string().optional(),          // exact actor id
  actor:      z.string().optional(),          // partial name / email, or exact id
  entityType: z.string().optional(),          // partial, case-insensitive
  entityId:   z.string().optional(),          // exact
  action:     z.string().optional(),          // partial, case-insensitive
  fromDate:   z.string().datetime({ offset: true }).optional(),
  toDate:     z.string().datetime({ offset: true }).optional(),
  order:      z.enum(['desc', 'asc']).default('desc'),
})

const pagedSchema = queryBaseSchema.extend({
  limit:  z.coerce.number().int().min(1).max(500).default(100),
  cursor: bigintId.optional(),
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
  action: string
  entity_type: string
  entity_id: string
  details: Record<string, unknown>
  ip_address: string | null
  prev_hash: string
  row_hash: string
}

const SELECT_COLUMNS = `
  a.id, a."timestamp", a.actor_id, u.name AS actor_name, u.email AS actor_email,
  a.action, a.entity_type, a.entity_id, a.details, a.ip_address, a.prev_hash, a.row_hash`

// actor_id is either a users.id or a system marker such as 'anonymous';
// the LEFT JOIN leaves name/email null for the latter.
const FROM_CLAUSE = `FROM audit_events a LEFT JOIN users u ON u.id = a.actor_id`

function auditRowShape(r: AuditRow) {
  return {
    id: String(r.id),
    timestamp: r.timestamp.toISOString(),
    actorId: r.actor_id,
    actorName: r.actor_name,
    actorEmail: r.actor_email,
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

// Builds the WHERE clause + params array from the shared query schema.
// Factored out so the query, count + export routes stay in lockstep.
export function buildFilter(q: z.infer<typeof queryBaseSchema>): { where: string; params: unknown[] } {
  const conditions: string[] = []
  const params: unknown[] = []
  const param = (value: unknown) => {
    params.push(value)
    return `$${params.length}`
  }
  if (q.actorId)    conditions.push(`a.actor_id = ${param(q.actorId)}`)
  if (q.actor) {
    const exact = param(q.actor)
    const like = param(containsPattern(q.actor))
    conditions.push(`(a.actor_id = ${exact} OR u.email ILIKE ${like} OR u.name ILIKE ${like})`)
  }
  if (q.entityType) conditions.push(`a.entity_type ILIKE ${param(containsPattern(q.entityType))}`)
  if (q.entityId)   conditions.push(`a.entity_id = ${param(q.entityId)}`)
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
  const superAdminGate = requireAuth({ roles: ['super-admin'] })

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

  app.get('/admin/audit', { preHandler: superAdminGate }, async (request, reply) => {
    const parsed = pagedSchema.safeParse(request.query)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })
    const q = parsed.data

    const { where, params } = buildFilter(q)

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
    const cmp = q.order === 'asc' ? '>' : '<'
    const cursorClause = q.cursor
      ? ` ${where ? 'AND' : 'WHERE'} a.id ${cmp} $${pageParams.push(q.cursor)}::bigint`
      : ''
    pageParams.push(q.limit + 1)  // fetch one extra to detect "more"

    const sql = `
      SELECT ${SELECT_COLUMNS}
      ${FROM_CLAUSE}
      ${where}${cursorClause}
      ORDER BY a.id ${q.order === 'asc' ? 'ASC' : 'DESC'}
      LIMIT $${pageParams.length}
    `
    const rows = await app.prisma.$queryRawUnsafe<AuditRow[]>(sql, ...pageParams)
    const hasMore = rows.length > q.limit
    const page = hasMore ? rows.slice(0, q.limit) : rows
    const nextCursor = hasMore ? String(page[page.length - 1]!.id) : null

    return {
      rows: page.map(auditRowShape),
      nextCursor,
      hasMore,
      total: Math.min(matched, COUNT_CAP),
      totalCapped: matched > COUNT_CAP,
    }
  })

  // Distinct values for the filter dropdowns. Small, indexed columns; the
  // LIMIT keeps the payload bounded if action naming ever explodes.
  app.get('/admin/audit/facets', { preHandler: superAdminGate }, async () => {
    const actions = await app.prisma.$queryRawUnsafe<Array<{ v: string }>>(
      'SELECT DISTINCT action AS v FROM audit_events ORDER BY v LIMIT 500',
    )
    const entityTypes = await app.prisma.$queryRawUnsafe<Array<{ v: string }>>(
      'SELECT DISTINCT entity_type AS v FROM audit_events ORDER BY v LIMIT 500',
    )
    return {
      actions: actions.map(r => r.v),
      entityTypes: entityTypes.map(r => r.v),
    }
  })

  app.get('/admin/audit/verify', { preHandler: superAdminGate }, async (request, reply) => {
    const parsed = verifySchema.safeParse(request.query)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const result = await app.audit.verifyChain(parsed.data.fromId, parsed.data.toId)
    return {
      intact: result.intact,
      firstBreakAt: result.firstBreakAt,
      checkedRange: { from: parsed.data.fromId ?? null, to: parsed.data.toId ?? null },
      verifiedAt: new Date().toISOString(),
    }
  })

  // Streaming would be nicer for very large exports, but for the handover
  // walkthroughs a single-shot response is fine. Capped at EXPORT_ROW_CAP;
  // when the filter matches more, the response says so (header + trailing
  // line) instead of silently dropping rows. Ordered like the screen
  // (newest first unless order=asc).
  app.get('/admin/audit/export', { preHandler: superAdminGate }, async (request, reply) => {
    const parsed = queryBaseSchema.safeParse(request.query)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const { where, params } = buildFilter(parsed.data)
    const sql = `
      SELECT ${SELECT_COLUMNS}
      ${FROM_CLAUSE}
      ${where}
      ORDER BY a.id ${parsed.data.order === 'asc' ? 'ASC' : 'DESC'}
      LIMIT ${EXPORT_ROW_CAP + 1}
    `
    const fetched = await app.prisma.$queryRawUnsafe<AuditRow[]>(sql, ...params)
    const truncated = fetched.length > EXPORT_ROW_CAP
    const rows = truncated ? fetched.slice(0, EXPORT_ROW_CAP) : fetched

    const header = ['id', 'timestamp', 'actorId', 'actorName', 'actorEmail', 'action', 'entityType', 'entityId', 'details', 'ipAddress', 'prevHash', 'rowHash']
    const lines = [header.join(',')]
    for (const r of rows) {
      lines.push([
        csvCell(r.id),
        csvCell(r.timestamp.toISOString()),
        csvCell(r.actor_id),
        csvCell(r.actor_name),
        csvCell(r.actor_email),
        csvCell(r.action),
        csvCell(r.entity_type),
        csvCell(r.entity_id),
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
