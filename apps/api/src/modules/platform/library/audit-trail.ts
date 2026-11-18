// Master Library "Audit trail" (its own side panel, opened from the table's Audit trail column).
//
//   GET /library/:id/audit   anyone who can open the Master Library (same visibility as reading the item)
//     This version's Master Library activity only, newest first, paged — pushed or uploaded, auto-pushed, new
//     version, withdrawn, opened in the Master Library (View), shared, invitation opened, locked out. Read from
//     the library entry's own trail plus the library events on the source document's trail that name this entry
//     (libraryItemId), so another version's shares don't show here. No Clinical Writing milestones and no full
//     Clinical Writing trail: those stay with the document in its project.
//
// Only reads the hash-chained audit log. Opening the document in the Master Library (GET /library/:id/pdf) writes
// a 'library_document_viewed' entry on the library entry (routes.ts). No export, download or print. Each row carries
// only what the panel shows — when, who, what happened and the readable detail — never raw details, IP addresses,
// hashes or tokens. The readable text is the Clinical Writing audit trail's own (auditEntryShape); the one place it
// would show a hash (an exported PDF's SHA-256) is dropped here.

import type { FastifyInstance, FastifyPluginAsync } from 'fastify'
import type { Prisma } from '@prisma/client'
import { z } from 'zod'
import { requireAuth, type AuthenticatedUser } from '../../../auth/rbac.js'
import type { StoredAuditEvent } from '../../../audit/repository.js'
import { auditEntryShape } from '../../clinical-writing/comments/routes.js'

export const AUDIT_PAGE_MAX = 100
export const AUDIT_OFFSET_MAX = 5000
const PER_ACTION_CAP = 500

/** Library events written on the source document's trail (share.ts, auto-push.ts); each names its libraryItemId. */
export const LIBRARY_EVENTS_ON_DOCUMENT = ['library_auto_pushed', 'library_document_shared', 'library_share_opened', 'library_share_code_locked'] as const

const visibleTo = (user: { tenantId: string | null }): Prisma.LibrarySectionWhereInput =>
  user.tenantId == null ? {} : { OR: [{ tenantId: null }, { tenantId: user.tenantId }] }

const pageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(AUDIT_PAGE_MAX).default(50),
  offset: z.coerce.number().int().min(0).max(AUDIT_OFFSET_MAX).default(0),
})

/** One row of the panel. Mirrors packages/types MasterLibraryAuditEntry. */
export interface LibraryAuditEntry {
  timestamp: string
  actor: string
  action: string
  eventType: string | null
  detail: string
}

const sourceDocumentId = (tags: string[]) => tags.find(t => t.startsWith('fromdoc:'))?.slice('fromdoc:'.length) ?? null

// Audit ids are the chain's sequence (bigint), so they order entries exactly, even within the same millisecond.
const newestFirst = (a: StoredAuditEvent, b: StoredAuditEvent) => {
  const x = BigInt(a.id), y = BigInt(b.id)
  return x === y ? 0 : x > y ? -1 : 1
}

async function byAction(app: FastifyInstance, documentId: string, actions: readonly string[]) {
  const pages = await Promise.all(actions.map(action => app.audit.pageForEntity('document', documentId, { action, limit: PER_ACTION_CAP })))
  return pages.flatMap(p => p.rows)
}

async function shape(app: FastifyInstance, rows: StoredAuditEvent[]): Promise<LibraryAuditEntry[]> {
  const actorIds = [...new Set(rows.map(r => r.actorId))]
  const users = actorIds.length
    ? await app.prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } })
    : []
  const nameOf = new Map(users.map(u => [u.id, u.name]))
  return rows.map(r => {
    const shaped = auditEntryShape(r, nameOf.get(r.actorId))
    return {
      timestamp: r.timestamp,
      actor: shaped.actor,
      action: r.action,
      eventType: shaped.eventType,
      detail: shaped.detail.split(' · ').filter(p => !p.startsWith('SHA-256 ')).join(' · '),
    }
  })
}

export const libraryAuditRoutes: FastifyPluginAsync = async (app) => {
  async function loadItem(user: AuthenticatedUser, id: string) {
    return app.prisma.librarySection.findFirst({
      where: { id, AND: [visibleTo(user)] },
      select: { id: true, tags: true },
    })
  }

  app.get('/:id/audit', { preHandler: requireAuth() }, async (request, reply) => {
    const user = request.user! as AuthenticatedUser
    const parsed = pageQuery.safeParse(request.query)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })
    const { limit, offset } = parsed.data
    const row = await loadItem(user, (request.params as { id: string }).id)
    if (!row) return reply.code(404).send({ error: 'not_found' })
    const documentId = sourceDocumentId(row.tags)

    // Master Library activity: the entry's own trail + this entry's library events on the document's trail.
    const [own, onDocument] = await Promise.all([
      app.audit.pageForEntity('library_section', row.id, { limit: offset + limit, offset: 0 }),
      documentId ? byAction(app, documentId, LIBRARY_EVENTS_ON_DOCUMENT) : Promise.resolve([]),
    ])
    const mine = onDocument.filter(e => e.details?.libraryItemId === row.id)
    const libraryRows = [...own.rows, ...mine].sort(newestFirst).slice(offset, offset + limit)

    return { entries: await shape(app, libraryRows), total: own.total + mine.length, limit, offset }
  })
}
