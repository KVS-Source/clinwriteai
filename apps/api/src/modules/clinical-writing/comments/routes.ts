// Comments routes — Module A (API contract §5) + audit-trail scope (§6).
//
// Comments are reviewer feedback bound to a document + section. They use a
// human-readable application-generated id ("CMT-###") so reviewers can
// reference them in meeting notes and CRM discussions. Comment.id is the
// table's primary key, so the sequence is global (CMT-001, CMT-002, ... across
// all documents), not per-document: a per-document sequence would hand the
// second document's first comment an id that already exists.
//
// Comments are NEVER deleted; resolve-then-keep-the-record is the only
// mutation path. This is why resolve 409s on an already-resolved comment.

import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import PDFDocument from 'pdfkit'
import { requireAuth } from '../../../auth/rbac.js'
import type { StoredAuditEvent } from '../../../audit/repository.js'

// Document audit panel paging. The default limit keeps older callers that send
// no parameters (the Audit Review screen) getting the same size as before.
const AUDIT_PAGE_MAX = 500
const auditPageQuery = z.object({
  limit:  z.coerce.number().int().min(1).max(AUDIT_PAGE_MAX).default(AUDIT_PAGE_MAX),
  offset: z.coerce.number().int().min(0).default(0),
  // Optional date-time range (ISO 8601 with Z or an offset); omitted = whole history.
  from:   z.string().datetime({ offset: true }).optional(),
  to:     z.string().datetime({ offset: true }).optional(),
  // Optional section scope: the section key (edits, AI, references) and its number
  // (comments record "§n"). Entries without a section are document-level and left out.
  sectionId:     z.string().min(1).optional(),
  sectionNumber: z.string().min(1).optional(),
})

// '§1' / '1' / '§ 1' → '1', so comment sectionRefs match the section number either way.
const normSectionRef = (v: string) => v.replace(/^§\s*/, '').trim().toLowerCase()

// Does this audit row belong to the section? Same rule as the panel's section scope.
function rowInSection(details: unknown, sectionId: string | undefined, sectionNumber: string | undefined): boolean {
  const d = (details ?? {}) as Record<string, unknown>
  if (typeof d.sectionId === 'string') return d.sectionId === sectionId
  if (typeof d.sectionRef === 'string' && sectionNumber) {
    const ref = normSectionRef(d.sectionRef)
    const num = normSectionRef(sectionNumber)
    return ref === num || ref.startsWith(`${num} `)
  }
  return false
}
// CSV / PDF export: newest events up to this many, fetched in pages.
const EXPORT_ENTRY_CAP = 10_000
const EXPORT_PAGE_SIZE = 1_000

// --- Document audit-trail shape (UI `AuditEntry`) ---------------------------
// The panel renders eventType/actor/initials/detail; the audit chain stores
// action/actorId/details. Raw fields are kept so other consumers still work.
const ACTION_TO_EVENT: Record<string, string> = {
  section_edited:            'content-edited',
  ai_draft_accepted:         'ai-draft',
  ai_suggestion_requested:   'ai-requested',
  comment_added:             'comment-added',
  comment_resolved:          'comment-resolved',
  // A resolution logged in a CRM meeting resolves the comment too.
  crm_resolution_logged:     'comment-resolved',
  checklist_item_waived:     'checklist-waived',
  checklist_item_completed:  'checklist-completed',
  signature_initiated:       'document-signed',
  version_restore_initiated: 'version-restore',
  voice_note_added:          'voice-note-added',
  qa_review_logged:          'qa-review-completed',
}

type AuditRow = { id: string; timestamp: string; actorId: string; action: string; details: unknown }

const humanise = (action: string) => action.replace(/[._]/g, ' ').replace(/\s+/g, ' ').trim()

const initialsOf = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]!.toUpperCase()).join('') || '?'

function auditDetail(row: AuditRow): string {
  const d = (row.details ?? {}) as Record<string, unknown>
  const parts: string[] = []
  if (typeof d.sectionId === 'string') parts.push(`Section ${d.sectionId}`)
  if (typeof d.versionNumber === 'string') parts.push(d.versionNumber)
  if (typeof d.aiModel === 'string' && d.aiModel) parts.push(`Model ${d.aiModel}`)
  // "AI suggestion requested": what was asked, and how the request ended.
  if (row.action === 'ai_suggestion_requested') {
    if (typeof d.intent === 'string') parts.push(`Intent ${d.intent}`)
    if (d.outcome === 'quota_reached') parts.push('Quota reached')
    else if (d.outcome === 'failed') parts.push('Request failed')
  }
  if (d.from !== undefined && d.to !== undefined) parts.push(`${String(d.from)} → ${String(d.to)}`)
  if (typeof d.reason === 'string' && d.reason) parts.push(`Reason: ${d.reason}`)
  return parts.length ? parts.join(' · ') : humanise(row.action)
}

// RFC 4180 cell: quote when it contains a delimiter, quote or newline.
function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

const exportFileName = (title: string, documentId: string) =>
  `audit-trail-${(title || documentId).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || documentId}`

type ShapedAuditEntry = ReturnType<typeof auditEntryShape> & { rowHash: string | null }

// Plain tabular audit report (newest first) rendered to a Buffer.
function renderAuditPdf(title: string, documentId: string, entries: ShapedAuditEntry[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40, info: { Title: `Audit trail — ${title}` } })
    const chunks: Buffer[] = []
    doc.on('data', (c: Buffer) => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    doc.font('Helvetica-Bold').fontSize(14).text('Audit trail')
    doc.font('Helvetica').fontSize(10).fillColor('#475569')
      .text(`${title} (${documentId})`)
      .text(`Generated ${new Date().toISOString()} · ${entries.length} entries · hash-chained (21 CFR Part 11)`)
    doc.moveDown(0.8).fillColor('#0F172A')

    const newestFirst = [...entries].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    for (const e of newestFirst) {
      if (doc.y > doc.page.height - 90) doc.addPage()
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#0F172A')
        .text(`${new Date(e.timestamp).toISOString().replace('T', ' ').slice(0, 16)} UTC   ${humanise(e.action).toUpperCase()}`)
      doc.font('Helvetica').fontSize(9).fillColor('#334155').text(`${e.actor} — ${e.detail}`)
      if (e.rowHash) doc.fontSize(7).fillColor('#94A3B8').text(`row hash ${e.rowHash}`)
      doc.moveDown(0.5)
    }
    if (entries.length === 0) doc.font('Helvetica').fontSize(10).text('No audit events recorded for this document.')
    doc.end()
  })
}

function auditEntryShape(row: AuditRow, actorName: string | undefined) {
  const actor = actorName ?? (row.actorId.startsWith('system') ? 'System' : row.actorId)
  const isAi = row.action === 'ai_draft_accepted'
  return {
    ...row,
    actor,
    actorInitials: initialsOf(actor),
    actorColourKey: isAi ? 'AI' : initialsOf(actor),
    // null for actions the panel has no badge for — it falls back to a
    // neutral badge labelled from `action` instead of crashing.
    eventType: ACTION_TO_EVENT[row.action] ?? null,
    detail: auditDetail(row),
  }
}

const addSchema = z.object({
  sectionRef: z.string().min(1),
  // Text may be empty when posting a bare "approve" verdict; otherwise required.
  text: z.string().default(''),
  severity: z.enum(['major', 'minor', 'query']),
  // Phase 2.2 — reviewer verdict. Null for plain comments. See
  // docs/decisions/module-a-defaults.md §3.
  verdict: z.enum(['approve', 'request_changes', 'block_approval']).optional(),
}).refine(
  v => v.verdict !== undefined || v.text.length > 0,
  { message: 'text is required unless a verdict is set' },
)

const resolveSchema = z.object({
  resolutionType: z.enum(['accept', 'accept_with_modification', 'reject']),
  // Trimmed: a whitespace-only note is no note (AC-A-055). 500 matches the UI's limit.
  note: z.string().trim().min(1).max(500),
})

const listQuerySchema = z.object({
  status: z.enum(['open', 'resolved']).optional(),
  sectionRef: z.string().optional(),
  severity: z.enum(['major', 'minor', 'query']).optional(),
})

// Shape comments for the UI's packages/types `Comment` interface. UI
// expects reviewerName + reviewerInitials (looked up from User) + age
// ("3 days ago"-style display string). Prisma stores only reviewerId
// + createdAt.
function formatAge(createdAt: Date): string {
  const diffMs = Date.now() - createdAt.getTime()
  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`
  return `${Math.floor(months / 12)} year${Math.floor(months / 12) === 1 ? '' : 's'} ago`
}

// "Last edited" is the latest change made to a comment. Comments can't be edited after posting; the
// only change they ever get is being resolved (here or in a CRM meeting), and both paths record who
// and when. So last-edited = the resolver + resolvedAt, and null while the comment is untouched.
type CommentPerson = { name: string; initials: string | null }

function commentShape(
  c: { reviewerId: string; createdAt: Date; resolvedBy?: string | null; resolvedAt?: Date | null } & Record<string, unknown>,
  reviewer: CommentPerson | null,
  resolver: CommentPerson | null = null,
) {
  const edited = c.resolvedAt ?? null
  return {
    ...c,
    reviewerName: reviewer?.name ?? c.reviewerId,
    reviewerInitials: reviewer?.initials ?? '',
    age: formatAge(c.createdAt),
    lastEditedAt: edited,
    lastEditedByName: edited ? (resolver?.name ?? c.resolvedBy ?? null) : null,
    lastEditedAge: edited ? formatAge(edited) : null,
  }
}

// Creators and resolvers, keyed by user id.
async function fetchCommentReviewers(prisma: import('@prisma/client').PrismaClient, rows: Array<{ reviewerId: string; resolvedBy?: string | null }>) {
  if (rows.length === 0) return new Map<string, CommentPerson>()
  const ids = Array.from(new Set(rows.flatMap(r => [r.reviewerId, r.resolvedBy ?? null]).filter((v): v is string => !!v)))
  const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, initials: true } })
  return new Map(users.map(u => [u.id, { name: u.name, initials: u.initials }]))
}

// A section returned for revision (request_changes / block_approval verdict)
// can't be approved until the writer has revised it: returns the newest such
// verdict when the section hasn't been saved since, else null.
export async function pendingRevision(
  prisma: import('@prisma/client').PrismaClient,
  documentId: string,
  sectionRef: string,
): Promise<{ returnedAt: Date } | null> {
  const ret = await prisma.comment.findFirst({
    where:   { documentId, sectionRef, verdict: { in: ['request_changes', 'block_approval'] } },
    orderBy: { createdAt: 'desc' },
    select:  { createdAt: true },
  })
  if (!ret) return null
  const bare = sectionRef.replace(/^§/, '')
  const doc = await prisma.document.findUnique({
    where:  { id: documentId },
    select: { currentVersion: { select: { sections: {
      where:  { OR: [{ sectionNumber: sectionRef }, { sectionNumber: bare }] },
      select: { lastEditedAt: true },
      take:   1,
    } } } },
  })
  const editedAt = doc?.currentVersion?.sections[0]?.lastEditedAt
  return editedAt && editedAt > ret.createdAt ? null : { returnedAt: ret.createdAt }
}

export const commentsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/:documentId/comments', { preHandler: requireAuth({ modules: ['A'] }) }, async (request, reply) => {
    const { documentId } = request.params as { documentId: string }
    const parsed = listQuerySchema.safeParse(request.query)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const doc = await app.prisma.document.findUnique({ where: { id: documentId } })
    if (!doc) return reply.code(404).send({ error: 'not_found' })

    const rows = await app.prisma.comment.findMany({
      where: {
        documentId,
        ...(parsed.data.status && { status: parsed.data.status }),
        ...(parsed.data.sectionRef && { sectionRef: parsed.data.sectionRef }),
        ...(parsed.data.severity && { severity: parsed.data.severity }),
      },
      orderBy: { createdAt: 'desc' },
    })
    const reviewers = await fetchCommentReviewers(app.prisma, rows)
    return rows.map(r => commentShape(r, reviewers.get(r.reviewerId) ?? null, r.resolvedBy ? reviewers.get(r.resolvedBy) ?? null : null))
  })

  app.post('/:documentId/comments', { preHandler: requireAuth({ modules: ['A'] }) }, async (request, reply) => {
    const { documentId } = request.params as { documentId: string }
    const parsed = addSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const doc = await app.prisma.document.findUnique({ where: { id: documentId } })
    if (!doc) return reply.code(404).send({ error: 'not_found' })

    if (parsed.data.verdict === 'approve' && await pendingRevision(app.prisma, documentId, parsed.data.sectionRef)) {
      return reply.code(409).send({
        error:   'section_returned',
        message: `${parsed.data.sectionRef} was returned for revision — it can be approved once the writer has revised it.`,
      })
    }

    // Retry loop handles the P2002 race where two concurrent inserts both
    // read the same max CMT-### sequence (each retry re-reads the max, so it
    // picks up the winner's row and moves on). Same pattern as the Module C
    // MLR comments route. 5 attempts covers realistic reviewer bursts.
    let created: Awaited<ReturnType<typeof app.prisma.comment.create>> | null = null
    let id = ''
    for (let attempt = 0; attempt < 5 && !created; attempt++) {
      id = await nextCommentId(app.prisma)
      try {
        created = await app.prisma.comment.create({
          data: {
            id,
            documentId,
            sectionRef: parsed.data.sectionRef,
            text: parsed.data.text,
            severity: parsed.data.severity,
            verdict: parsed.data.verdict ?? null,
            reviewerId: request.user!.id,
          },
        })
      } catch (e: unknown) {
        if ((e as { code?: string }).code === 'P2002') continue           // id collision — recompute + retry
        throw e
      }
    }
    if (!created) {
      return reply.code(503).send({ error: 'id_contention', message: 'Too many simultaneous comments; retry' })
    }

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      // Reviewer verdicts carry a distinct audit action so compliance
      // reports can filter them from plain comments.
      action: parsed.data.verdict ? `reviewer_${parsed.data.verdict}` : 'comment_added',
      entityType: 'document',
      entityId: documentId,
      details: {
        commentId: id,
        sectionRef: parsed.data.sectionRef,
        severity: parsed.data.severity,
        verdict: parsed.data.verdict ?? null,
      },
      ipAddress: request.ip ?? null,
    })

    const [reviewer] = await Promise.all([
      app.prisma.user.findUnique({ where: { id: created.reviewerId }, select: { name: true, initials: true } }),
    ])
    return reply.code(201).send(commentShape(created, reviewer))
  })

  app.patch('/:documentId/comments/:commentId/resolve', { preHandler: requireAuth({ modules: ['A'] }) }, async (request, reply) => {
    const { documentId, commentId } = request.params as { documentId: string; commentId: string }
    const parsed = resolveSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const comment = await app.prisma.comment.findFirst({ where: { id: commentId, documentId } })
    if (!comment) return reply.code(404).send({ error: 'not_found' })
    if (comment.status === 'resolved') {
      return reply.code(409).send({ error: 'conflict', message: 'Comment already resolved' })
    }

    const updated = await app.prisma.comment.update({
      where: { id: commentId },
      data: {
        status: 'resolved',
        resolvedBy: request.user!.id,
        resolvedAt: new Date(),
        resolutionNote: `[${parsed.data.resolutionType}] ${parsed.data.note}`,
      },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'comment_resolved',
      entityType: 'document',
      entityId: documentId,
      details: {
        commentId,
        resolutionType: parsed.data.resolutionType,
        sectionRef: comment.sectionRef,
      },
      ipAddress: request.ip ?? null,
    })

    const [reviewer, resolver] = await Promise.all([
      app.prisma.user.findUnique({ where: { id: updated.reviewerId }, select: { name: true, initials: true } }),
      app.prisma.user.findUnique({ where: { id: request.user!.id }, select: { name: true, initials: true } }),
    ])
    return commentShape(updated, reviewer, resolver)
  })

  // Document audit trail — reads from the hash-chained audit_events table
  // (ADR 0002). Scoped to the single document.
  app.get('/:documentId/audit', { preHandler: requireAuth({ modules: ['A'] }) }, async (request, reply) => {
    const { documentId } = request.params as { documentId: string }
    const doc = await app.prisma.document.findUnique({ where: { id: documentId } })
    if (!doc) return reply.code(404).send({ error: 'not_found' })

    const parsedPage = auditPageQuery.safeParse(request.query)
    if (!parsedPage.success) return reply.code(400).send({ error: 'validation', issues: parsedPage.error.issues })
    const { limit, offset, from, to, sectionId, sectionNumber } = parsedPage.data
    if (from && to && Date.parse(from) > Date.parse(to)) {
      return reply.code(400).send({ error: 'validation', message: '"from" is after "to"' })
    }

    // Section scope: the section is recorded inside each entry's details, so read the
    // document's entries in the range (newest first, up to the export cap) and keep the
    // section's own. Total and paging then count only that section.
    if (sectionId || sectionNumber) {
      const matched: StoredAuditEvent[] = []
      let scanned = 0
      while (scanned < EXPORT_ENTRY_CAP) {
        const batch = await app.audit.pageForEntity('document', documentId, {
          limit: Math.min(EXPORT_PAGE_SIZE, EXPORT_ENTRY_CAP - scanned), offset: scanned, from, to,
        })
        scanned += batch.rows.length
        matched.push(...batch.rows.filter(r => rowInSection(r.details, sectionId, sectionNumber)))
        if (batch.rows.length === 0 || scanned >= batch.total) break
      }
      return { entries: await shapeAuditRows(matched.slice(offset, offset + limit)), total: matched.length, limit, offset }
    }

    // Newest first, with the TRUE total so the panel can page through the rest.
    // UI (documentsApi.getAuditTrail) expects a paginated envelope rather
    // than a bare array — a bare array causes `(auditData?.entries ?? []).map`
    // in AuditReviewAlert.tsx to throw "d.map is not a function".
    const page = await app.audit.pageForEntity('document', documentId, { limit, offset, from, to })
    return { entries: await shapeAuditRows(page.rows), total: page.total, limit, offset }
  })

  // Export the document's audit trail (panel "Export audit trail" / "Download
  // as PDF"). Each export is itself appended to the audit chain.
  app.get('/:documentId/audit/export', { preHandler: requireAuth({ modules: ['A'] }) }, async (request, reply) => {
    const { documentId } = request.params as { documentId: string }
    const doc = await app.prisma.document.findUnique({ where: { id: documentId }, select: { id: true, title: true } })
    if (!doc) return reply.code(404).send({ error: 'not_found' })

    const entries = await loadAuditEntries(documentId)
    const header = ['id', 'timestamp', 'actor', 'actorId', 'action', 'eventType', 'detail', 'details', 'ipAddress', 'prevHash', 'rowHash']
    const lines = [header.join(',')]
    for (const e of entries) {
      lines.push([
        e.id, e.timestamp, e.actor, e.actorId, e.action, e.eventType ?? '', e.detail,
        JSON.stringify(e.details ?? {}), e.ipAddress ?? '', e.prevHash ?? '', e.rowHash ?? '',
      ].map(csvCell).join(','))
    }

    await recordExport(request, documentId, 'csv', entries.length)
    reply.header('Content-Type', 'text/csv; charset=utf-8')
    reply.header('Content-Disposition', `attachment; filename="${exportFileName(doc.title, documentId)}.csv"`)
    return lines.join('\r\n') + '\r\n'
  })

  app.get('/:documentId/audit/pdf', { preHandler: requireAuth({ modules: ['A'] }) }, async (request, reply) => {
    const { documentId } = request.params as { documentId: string }
    const doc = await app.prisma.document.findUnique({ where: { id: documentId }, select: { id: true, title: true } })
    if (!doc) return reply.code(404).send({ error: 'not_found' })

    const entries = await loadAuditEntries(documentId)
    const pdf = await renderAuditPdf(doc.title, documentId, entries)

    await recordExport(request, documentId, 'pdf', entries.length)
    reply.header('Content-Type', 'application/pdf')
    reply.header('Content-Disposition', `attachment; filename="${exportFileName(doc.title, documentId)}.pdf"`)
    return reply.send(pdf)
  })

  // Entries for the CSV / PDF export, oldest first. Takes the newest
  // EXPORT_ENTRY_CAP events (the first 500 used to be returned, which dropped
  // everything recent on a busy document), then puts them in chronological order.
  async function loadAuditEntries(documentId: string) {
    const rows: StoredAuditEvent[] = []
    while (rows.length < EXPORT_ENTRY_CAP) {
      const page = await app.audit.pageForEntity('document', documentId, {
        limit: Math.min(EXPORT_PAGE_SIZE, EXPORT_ENTRY_CAP - rows.length),
        offset: rows.length,
      })
      rows.push(...page.rows)
      if (page.rows.length === 0 || rows.length >= page.total) break
    }
    return shapeAuditRows(rows.reverse())
  }

  // Shape audit rows for the UI, with actor names resolved in one batched query.
  async function shapeAuditRows(rows: ReadonlyArray<StoredAuditEvent>) {
    const actorIds = [...new Set(rows.map(r => r.actorId))]
    const users = await app.prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } })
    const nameById = new Map(users.map(u => [u.id, u.name]))
    return rows.map(r => ({
      ...auditEntryShape(r as unknown as AuditRow, nameById.get(r.actorId)),
      ipAddress: (r as { ipAddress?: string | null }).ipAddress ?? null,
      prevHash: (r as { prevHash?: string }).prevHash ?? null,
      rowHash: (r as { rowHash?: string }).rowHash ?? null,
    }))
  }

  async function recordExport(request: import('fastify').FastifyRequest, documentId: string, format: 'csv' | 'pdf', count: number) {
    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'audit_trail_exported',
      entityType: 'document',
      entityId: documentId,
      details: { format, entryCount: count },
      ipAddress: request.ip ?? null,
    })
  }

  // QA review cadence + last-review tracking for the Audit Review screen.
  // Derived from the audit log itself (looks for the most recent
  // 'qa_review_logged' event); no separate table is needed yet. Cadence
  // default is 30 days; configurable per tenant in the future.
  app.get('/:documentId/qa-review', { preHandler: requireAuth({ modules: ['A'] }) }, async (request, reply) => {
    const { documentId } = request.params as { documentId: string }
    const doc = await app.prisma.document.findUnique({ where: { id: documentId } })
    if (!doc) return reply.code(404).send({ error: 'not_found' })

    const cadenceDays = 30
    // Newest review only (the old oldest-500 scan returned the FIRST review).
    const { rows } = await app.audit.pageForEntity('document', documentId, { limit: 1, action: 'qa_review_logged' })
    const lastReview = rows[0] ?? null
    const lastReviewedAt = lastReview?.timestamp ?? null
    const nextDue = new Date((lastReviewedAt ? new Date(lastReviewedAt) : new Date(doc.createdAt)).getTime() + cadenceDays * 86_400_000)
    const now = Date.now()
    const daysOverdue = Math.max(0, Math.floor((now - nextDue.getTime()) / 86_400_000))
    return {
      cadenceDays,
      lastReviewedAt,
      nextDueAt: nextDue.toISOString(),
      isOverdue: now > nextDue.getTime(),
      daysOverdue,
    }
  })

  app.post('/:documentId/qa-review', { preHandler: requireAuth({ modules: ['A'] }) }, async (request, reply) => {
    const { documentId } = request.params as { documentId: string }
    const body = (request.body ?? {}) as { reviewedBy?: string; notes?: string }
    const doc = await app.prisma.document.findUnique({ where: { id: documentId } })
    if (!doc) return reply.code(404).send({ error: 'not_found' })

    const cadenceDays = 30
    const nextDue = new Date(Date.now() + cadenceDays * 86_400_000)
    const entry = await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'qa_review_logged',
      entityType: 'document',
      entityId: documentId,
      details: { reviewedBy: body.reviewedBy ?? request.user!.id, notes: body.notes ?? null },
      ipAddress: request.ip ?? null,
    })
    return { auditEntryId: entry.id, nextDueAt: nextDue.toISOString() }
  })
}

async function nextCommentId(prisma: import('@prisma/client').PrismaClient): Promise<string> {
  // CMT-### is application-generated and must be unique table-wide (it is the
  // primary key). We query the current max then +1 — a race is possible but the
  // UNIQUE constraint rejects the loser and the handler's retry loop recomputes.
  const latest = await prisma.comment.findMany({
    where: { id: { startsWith: 'CMT-' } },
    select: { id: true },
  })
  const maxSeq = latest.reduce((max, row) => {
    const m = row.id.match(/^CMT-(\d+)$/)
    const n = m ? Number(m[1]) : 0
    return n > max ? n : max
  }, 0)
  return `CMT-${String(maxSeq + 1).padStart(3, '0')}`
}

// GET /projects/:projectId/comments — every comment on the project's live documents in one call, so
// project screens (Clinical Writing home, Comments page) don't fetch per document. Same shape and
// newest-first order as GET /documents/:documentId/comments; each row carries its documentId.
export const projectCommentsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/:projectId/comments', { preHandler: requireAuth({ modules: ['A'] }) }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string }
    const project = await app.prisma.project.findUnique({ where: { id: projectId }, select: { id: true } })
    if (!project) return reply.code(404).send({ error: 'not_found' })

    const docs = await app.prisma.document.findMany({ where: { projectId, deletedAt: null }, select: { id: true } })
    if (docs.length === 0) return []
    const rows = await app.prisma.comment.findMany({
      where: { documentId: { in: docs.map(d => d.id) } },
      orderBy: { createdAt: 'desc' },
    })
    const reviewers = await fetchCommentReviewers(app.prisma, rows)
    return rows.map(r => commentShape(r, reviewers.get(r.reviewerId) ?? null, r.resolvedBy ? reviewers.get(r.resolvedBy) ?? null : null))
  })
}
