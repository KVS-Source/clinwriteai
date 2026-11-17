// Master Library details panel "Audit trail" (2026-11-17): GET /library/:id/audit.
//
// Every audit entry about the document over its whole life, newest first:
//   - the source document's own trail in Clinical Writing (entity 'document' — creation, edits, review, approval,
//     e-signatures, the automatic push into the library, shares of its library copy, opened invitations…), for an
//     entry pushed from a document (tag fromdoc:<id>);
//   - the library entry's own trail (entity 'library_section' — push or upload, new version, withdrawal, and the
//     shares of an uploaded document), for this entry and every earlier and later version of it (supersededBy chain).
// An uploaded document has no source document, so only the second part applies. Nothing is filtered out —
// system entries included.
//
// Read-only: it only reads the hash-chained audit log, never writes to it (not even a "viewed" entry). No export.
// Visibility: the same as reading the item (anyone who can open the Master Library). Each row carries only what
// the panel shows — when, who, what happened and the readable detail — never raw details, IP addresses, hashes or
// tokens. The readable text is the Clinical Writing audit trail's own (auditEntryShape); the one place it would
// show a hash (an exported PDF's SHA-256) is dropped here.

import type { FastifyInstance, FastifyPluginAsync } from 'fastify'
import type { Prisma } from '@prisma/client'
import { z } from 'zod'
import { requireAuth, type AuthenticatedUser } from '../../../auth/rbac.js'
import type { StoredAuditEvent } from '../../../audit/repository.js'
import { auditEntryShape } from '../../clinical-writing/comments/routes.js'

export const AUDIT_PAGE_MAX = 100
export const AUDIT_OFFSET_MAX = 5000
const VERSION_CHAIN_MAX = 50   // library versions followed either way

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

type ChainRow = { id: string; tags: string[]; supersededBy: string | null }

/** This library entry and every earlier and later version of it. */
async function versionChain(app: FastifyInstance, row: ChainRow): Promise<ChainRow[]> {
  const select = { id: true, tags: true, supersededBy: true } as const
  const seen = new Map<string, ChainRow>([[row.id, row]])
  // Earlier: the entries whose supersededBy points at one we have.
  let frontier = [row.id]
  for (let i = 0; i < VERSION_CHAIN_MAX && frontier.length; i++) {
    const earlier = await app.prisma.librarySection.findMany({ where: { supersededBy: { in: frontier } }, select })
    frontier = earlier.filter(e => !seen.has(e.id)).map(e => e.id)
    earlier.forEach(e => seen.set(e.id, e))
  }
  // Later: follow supersededBy forward.
  let next = row.supersededBy
  for (let i = 0; i < VERSION_CHAIN_MAX && next && !seen.has(next); i++) {
    const later = await app.prisma.librarySection.findUnique({ where: { id: next }, select })
    if (!later) break
    seen.set(later.id, later)
    next = later.supersededBy
  }
  return [...seen.values()]
}

/** The trails that make up the document's life: its source documents' and its library entries'. */
export function auditSources(chain: ChainRow[]): Array<{ entityType: string; entityId: string }> {
  const documentIds = new Set(chain.flatMap(r => r.tags.filter(t => t.startsWith('fromdoc:')).map(t => t.slice('fromdoc:'.length))))
  return [
    ...[...documentIds].map(id => ({ entityType: 'document', entityId: id })),
    ...chain.map(r => ({ entityType: 'library_section', entityId: r.id })),
  ]
}

// Audit ids are the chain's sequence (bigint), so they order entries exactly, even within the same millisecond.
const newestFirst = (a: StoredAuditEvent, b: StoredAuditEvent) => {
  const x = BigInt(a.id), y = BigInt(b.id)
  return x === y ? 0 : x > y ? -1 : 1
}

export const libraryAuditRoutes: FastifyPluginAsync = async (app) => {
  app.get('/:id/audit', { preHandler: requireAuth() }, async (request, reply) => {
    const user = request.user! as AuthenticatedUser
    const { id } = request.params as { id: string }
    const parsed = pageQuery.safeParse(request.query)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })
    const { limit, offset } = parsed.data

    const row = await app.prisma.librarySection.findFirst({
      where: { id, AND: [visibleTo(user)] },
      select: { id: true, tags: true, supersededBy: true },
    })
    if (!row) return reply.code(404).send({ error: 'not_found' })

    // Newest (offset + limit) of each trail, merged: enough to cut this page exactly.
    const pages = await Promise.all(auditSources(await versionChain(app, row)).map(s =>
      app.audit.pageForEntity(s.entityType, s.entityId, { limit: offset + limit, offset: 0 })))
    const total = pages.reduce((n, p) => n + p.total, 0)
    const rows = pages.flatMap(p => p.rows).sort(newestFirst).slice(offset, offset + limit)

    const actorIds = [...new Set(rows.map(r => r.actorId))]
    const users = actorIds.length
      ? await app.prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } })
      : []
    const nameOf = new Map(users.map(u => [u.id, u.name]))

    const entries: LibraryAuditEntry[] = rows.map(r => {
      const shaped = auditEntryShape(r, nameOf.get(r.actorId))
      return {
        timestamp: r.timestamp,
        actor: shaped.actor,
        action: r.action,
        eventType: shaped.eventType,
        detail: shaped.detail.split(' · ').filter(p => !p.startsWith('SHA-256 ')).join(' · '),
      }
    })
    return { entries, total, limit, offset }
  })
}
