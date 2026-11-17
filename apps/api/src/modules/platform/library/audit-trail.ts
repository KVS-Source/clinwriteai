// Master Library details panel "Audit trail" (2026-11-17, reworked the same day).
//
//   GET /library/:id/audit        anyone who can open the Master Library (same visibility as reading the item)
//     - library:    this version's Master Library activity, newest first, paged — pushed or uploaded, new version,
//                   withdrawn, opened in the Master Library (View), shared, invitation opened, locked out. Read
//                   from the library entry's own trail plus the library events on the source document's trail that
//                   name this entry (libraryItemId), so another version's shares don't show here.
//     - milestones: "how it got here" — key Clinical Writing milestones of the source document (created, review,
//                   approval, stage changes, e-signatures, versions) up to the moment this version was pushed.
//                   Empty for an uploaded document. No PHI opens, edits or comments.
//     - fullTrailAvailable: whether the caller may read the source document's whole Clinical Writing trail
//                   (RACI on the document, its PM, an auditor — the same rule as the Clinical Writing audit panel).
//   GET /library/:id/audit/full   the source document's whole Clinical Writing trail, paged — only for those callers
//                                 (403 otherwise; 404 for an uploaded document, which has none).
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
import { actorCanReadDocumentRecord } from '../../clinical-writing/signatures/access.js'

export const AUDIT_PAGE_MAX = 100
export const AUDIT_OFFSET_MAX = 5000
const PER_ACTION_CAP = 500

/** Library events written on the source document's trail (share.ts, auto-push.ts); each names its libraryItemId. */
export const LIBRARY_EVENTS_ON_DOCUMENT = ['library_auto_pushed', 'library_document_shared', 'library_share_opened', 'library_share_code_locked'] as const

/** The Clinical Writing milestones shown under "How it got here". */
export const MILESTONE_ACTIONS = [
  'document_created', 'document_submitted_for_review', 'document_status_changed', 'document_stage_advanced',
  'reviewer_approve', 'signature_initiated', 'signature_recorded', 'signature_chain_cancelled', 'document_signed',
  'document_version_created', 'final_version_created_late',
] as const

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

async function byAction(app: FastifyInstance, documentId: string, actions: readonly string[], to?: string) {
  const pages = await Promise.all(actions.map(action => app.audit.pageForEntity('document', documentId, { action, limit: PER_ACTION_CAP, ...(to && { to }) })))
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
      select: { id: true, tags: true, createdAt: true },
    })
  }

  async function sourceDocument(documentId: string | null) {
    if (!documentId) return null
    return app.prisma.document.findUnique({ where: { id: documentId }, select: { id: true, projectId: true, assigneeId: true } })
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

    // How it got here: the document's milestones up to the moment this version came into the library.
    let milestones: StoredAuditEvent[] = []
    if (documentId) {
      const pushedAt = [...own.rows, ...mine]
        .filter(e => e.action === 'library_pushed' || e.action === 'library_auto_pushed')
        .map(e => e.timestamp).sort()[0]
      const cutoff = pushedAt ?? row.createdAt.toISOString()
      milestones = (await byAction(app, documentId, MILESTONE_ACTIONS, cutoff)).sort(newestFirst)
    }

    const doc = await sourceDocument(documentId)
    const fullTrailAvailable = !!doc && (user.modules ?? []).includes('A') && await actorCanReadDocumentRecord(app.prisma, user, doc)

    return {
      library: { entries: await shape(app, libraryRows), total: own.total + mine.length, limit, offset },
      milestones: await shape(app, milestones),
      fullTrailAvailable,
    }
  })

  app.get('/:id/audit/full', { preHandler: requireAuth({ modules: ['A'] }) }, async (request, reply) => {
    const user = request.user! as AuthenticatedUser
    const parsed = pageQuery.safeParse(request.query)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })
    const { limit, offset } = parsed.data
    const row = await loadItem(user, (request.params as { id: string }).id)
    if (!row) return reply.code(404).send({ error: 'not_found' })
    const doc = await sourceDocument(sourceDocumentId(row.tags))
    if (!doc) return reply.code(404).send({ error: 'no_source_document', message: 'This document was uploaded to the Master Library; it has no Clinical Writing trail.' })
    if (!(await actorCanReadDocumentRecord(app.prisma, user, doc))) {
      return reply.code(403).send({ error: 'audit_access_forbidden', message: "You don't have access to this document's Clinical Writing audit trail." })
    }
    const page = await app.audit.pageForEntity('document', doc.id, { limit, offset })
    return { entries: await shape(app, [...page.rows]), total: page.total, limit, offset }
  })
}
