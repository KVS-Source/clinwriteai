// Audit viewer — Arc 3.6 of docs/pivot-plan.md.
//
// Routes:
//   GET  /admin/audit                      filtered + paginated query
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

const queryBaseSchema = z.object({
  actorId:    z.string().optional(),
  entityType: z.string().optional(),
  entityId:   z.string().optional(),
  action:     z.string().optional(),
  fromDate:   z.string().datetime().optional(),
  toDate:     z.string().datetime().optional(),
})

const pagedSchema = queryBaseSchema.extend({
  limit:  z.coerce.number().int().min(1).max(500).default(100),
  cursor: z.string().optional(),  // audit_events.id as string (bigint)
})

interface AuditRow {
  id: string
  timestamp: Date
  actor_id: string
  action: string
  entity_type: string
  entity_id: string
  details: Record<string, unknown>
  ip_address: string | null
  prev_hash: string
  row_hash: string
}

function auditRowShape(r: AuditRow) {
  return {
    id: r.id,
    timestamp: r.timestamp.toISOString(),
    actorId: r.actor_id,
    action: r.action,
    entityType: r.entity_type,
    entityId: r.entity_id,
    details: r.details,
    ipAddress: r.ip_address,
    prevHash: r.prev_hash,
    rowHash: r.row_hash,
  }
}

// Builds the WHERE clause + params array from the shared query schema.
// Factored out so the query + export routes stay in lockstep.
function buildFilter(q: z.infer<typeof queryBaseSchema>): { where: string; params: unknown[] } {
  const conditions: string[] = []
  const params: unknown[] = []
  const push = (clause: string, value: unknown) => {
    params.push(value)
    conditions.push(clause.replace('$?', `$${params.length}`))
  }
  if (q.actorId)    push('actor_id = $?',    q.actorId)
  if (q.entityType) push('entity_type = $?', q.entityType)
  if (q.entityId)   push('entity_id = $?',   q.entityId)
  if (q.action)     push('action = $?',      q.action)
  if (q.fromDate)   push('"timestamp" >= $?::timestamptz', q.fromDate)
  if (q.toDate)     push('"timestamp" <= $?::timestamptz', q.toDate)
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  return { where, params }
}

// Escape CSV cell — doubles embedded quotes and wraps in quotes when the
// value contains comma/quote/newline. Keeps the output Excel-safe.
function csvCell(v: unknown): string {
  if (v === null || v === undefined) return ''
  const s = typeof v === 'string' ? v : JSON.stringify(v)
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

export const auditViewerRoutes: FastifyPluginAsync = async (app) => {
  const superAdminGate = requireAuth({ roles: ['super-admin'] })

  app.get('/admin/audit', { preHandler: superAdminGate }, async (request, reply) => {
    const parsed = pagedSchema.safeParse(request.query)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const { where, params } = buildFilter(parsed.data)
    const cursorClause = parsed.data.cursor
      ? ` ${where ? 'AND' : 'WHERE'} id < $${params.length + 1}::bigint`
      : ''
    if (parsed.data.cursor) params.push(parsed.data.cursor)
    params.push(parsed.data.limit + 1)  // fetch one extra to detect "more"

    const sql = `
      SELECT id, "timestamp", actor_id, action, entity_type, entity_id, details, ip_address, prev_hash, row_hash
      FROM audit_events
      ${where}${cursorClause}
      ORDER BY id DESC
      LIMIT $${params.length}
    `
    const rows = await app.prisma.$queryRawUnsafe<AuditRow[]>(sql, ...params)
    const hasMore = rows.length > parsed.data.limit
    const page = hasMore ? rows.slice(0, parsed.data.limit) : rows
    const nextCursor = hasMore ? String(page[page.length - 1]!.id) : null

    return {
      rows: page.map(auditRowShape),
      nextCursor,
      hasMore,
    }
  })

  app.get('/admin/audit/verify', { preHandler: superAdminGate }, async (request, reply) => {
    const schema = z.object({
      fromId: z.string().optional(),
      toId:   z.string().optional(),
    })
    const parsed = schema.safeParse(request.query)
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
  // walkthroughs a single-shot response is fine — cap at 10k rows and let
  // the caller re-page via the cursor on the query endpoint.
  app.get('/admin/audit/export', { preHandler: superAdminGate }, async (request, reply) => {
    const parsed = queryBaseSchema.safeParse(request.query)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const { where, params } = buildFilter(parsed.data)
    const sql = `
      SELECT id, "timestamp", actor_id, action, entity_type, entity_id, details, ip_address, prev_hash, row_hash
      FROM audit_events
      ${where}
      ORDER BY id ASC
      LIMIT 10000
    `
    const rows = await app.prisma.$queryRawUnsafe<AuditRow[]>(sql, ...params)

    const header = ['id', 'timestamp', 'actorId', 'action', 'entityType', 'entityId', 'details', 'ipAddress', 'prevHash', 'rowHash']
    const lines = [header.join(',')]
    for (const r of rows) {
      lines.push([
        csvCell(r.id),
        csvCell(r.timestamp.toISOString()),
        csvCell(r.actor_id),
        csvCell(r.action),
        csvCell(r.entity_type),
        csvCell(r.entity_id),
        csvCell(r.details),
        csvCell(r.ip_address),
        csvCell(r.prev_hash),
        csvCell(r.row_hash),
      ].join(','))
    }

    const filename = `audit-${new Date().toISOString().slice(0, 10)}.csv`
    reply.header('Content-Type', 'text/csv; charset=utf-8')
    reply.header('Content-Disposition', `attachment; filename="${filename}"`)
    return lines.join('\n')
  })
}
