// Documents routes — Module A core.
//
// Endpoints landed in this batch (API contract §3):
//   GET    /projects/:projectId/documents          — list
//   GET    /documents/:documentId                  — get with sections
//   POST   /projects/:projectId/documents          — create
//   PATCH  /documents/:documentId/sections/:sectionId
//   GET    /documents/:documentId/versions
//   POST   /documents/:documentId/restore
//   POST   /documents/:documentId/submit-for-review
//   POST   /documents/:documentId/transition       — explicit status change
//
// Mounted twice from server.ts: once under /projects and once under /documents
// so a single plugin file owns both URL shapes without rewriting the handlers.
// Not landed yet (future Module A sessions): upload + classify (needs S3),
// ai-suggest / ai-accept (needs Anthropic connector + prompt-cache service),
// signature chain (Part 11 — compliance review).

import { createHash } from 'node:crypto'
import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { requireAuth } from '../../../auth/rbac.js'
import { visibleProjectIdsForUser } from '../../projects/visibility.js'
import { findActiveTaLabel, invalidTaBody, sameTa } from '../../platform/taxonomy/validate.js'
import { templateSections } from './templates.js'
import { DocumentService } from './service.js'
import { chooseModel } from '../../platform/config/ai-engine-settings.js'
import {
  authoringLockReason,
  canTransitionDocument,
  DOCUMENT_STATUSES,
  InvalidDocumentTransitionError,
  type DocumentStatus,
} from '../document-status.js'
import {
  dbStageToUi,
  isDbStage,
  nextStage,
  StageAdvanceError,
  STAGE_LABELS,
  type DbStage,
} from '../document-stage.js'
import {
  requireLockHeldBy,
  SECTION_LOCK_STALE_SECONDS,
} from '../section-locks/service.js'
import { sessionizeHistory } from './edit-history-sessions.js'
import { htmlExcerpt } from './html-excerpt.js'
import {
  blockedBody,
  checkStageAdvanceGate,
  checkSubmitForReviewGate,
} from '../checklist/gates.js'
import { fireAutoComplete } from '../checklist/auto-complete.js'
import { runAutocheckForDocument } from '../checklist/autocheck/runner.js'
import { extractTextFromBlob } from './extract-text.js'
import { shrinkImage } from './shrink-image.js'
import { chunkPdfToFit } from './chunk-pdf.js'

const createSchema = z.object({
  type: z.string().min(1),
  title: z.string().min(1),
  therapeuticArea: z.string().min(1).optional(),
  assigneeId: z.string().min(1),
  templateId: z.string().optional(),
  targetCompletionDate: z.string().datetime().optional(),
  // Source documents (uploads in this project) the document is written from.
  sourceUploadIds: z.array(z.string().min(1)).max(100).optional(),
})

// "```html\n…\n```" → "…"
export function stripCodeFence(text: string): string {
  const m = /^\s*```[a-zA-Z]*\s*\n([\s\S]*?)\n?```\s*$/.exec(text)
  return (m ? m[1]! : text).trim()
}

const sectionUpdateSchema = z.object({
  contentHtml: z.string(),
  sectionNumber: z.string().optional(),
  sectionTitle: z.string().optional(),
  aiDrafted: z.boolean().optional(),
  aiModel: z.string().optional(),
  sourceRef: z.string().optional(),
  // When the edit originates from Accept-AI-response, the UI passes the
  // AiCallRecord id. The route stamps that record with
  // postCallDocumentVersionId so AI History can later tie prompt → version +
  // show Undo on the last non-undone one on the current version.
  aiCallRecordId: z.string().optional(),
}).refine(
  v => !v.aiDrafted || !!v.aiModel,
  { message: 'aiModel is required when aiDrafted is true (Part 11 provenance)' },
)

// Shape doc rows for the UI's packages/types `Document` interface.
// Prisma stores version + sections on currentVersion; UI flattens them
// onto the document itself with aliased section field names:
//   Prisma sectionNumber → UI Section.number
//   Prisma sectionTitle  → UI Section.title
//   Prisma ichStatus     → UI Section.status
// List-shape excludes sections (UI's list view only wants metadata); detail
// shape includes them.

// DB persists enum-ish strings in snake_case (seed converts fixture
// hyphens → underscores so the Postgres rows match the ADR 0001 enum
// convention). The TS types in @platform/types + the UI colour maps
// use hyphen-case, so unmap here before the JSON leaves the API.
// Section text recorded in a section-edit audit entry (before / after). Plain
// text, capped so one autosave can't bloat the hash-chained audit row; the
// full HTML lives in the section edit history.
const AUDIT_TEXT_MAX_CHARS = 4000
const auditText = (html: string | null | undefined) => htmlExcerpt(html, AUDIT_TEXT_MAX_CHARS)

function hyphenate(v: string | null | undefined): string {
  return (v ?? '').replace(/_/g, '-')
}

// Stage needs an extra reverse step because the seed maps post-study →
// reporting (and nothing else). Hyphenate alone would leave 'reporting'
// which isn't in the UI's DocumentStage enum → STAGE_LABELS lookup
// returns undefined → render crash.
const DB_STAGE_TO_UI: Record<string, string> = {
  reporting: 'post-study',
}
function uiStage(v: string | null | undefined): string {
  const raw = v ?? ''
  return DB_STAGE_TO_UI[raw] ?? hyphenate(raw)
}

// editors: user id → name, for the section's last editor.
function sectionShape(
  s: { id: string; sectionId: string; sectionNumber: string; sectionTitle: string; ichStatus: string; contentHtml?: string | null; lastEditedBy?: string | null; lastEditedAt?: Date | null; aiSpanCount?: number | null; humanSpanCount?: number | null },
  editors?: Map<string, string>,
) {
  return {
    // The stable section key ('s11_4', 'sae4'), NOT the row uuid: rows are
    // re-created on every version, and PATCH /sections/:sectionId matches
    // on this key. Sending the uuid made every save append a new section.
    id: s.sectionId,
    number: s.sectionNumber,
    title: s.sectionTitle,
    status: hyphenate(s.ichStatus),
    // contentHtml is lazy — detail route includes it, list route omits
    // it. UI editor pane reads this directly instead of fetching per-
    // section separately.
    contentHtml: s.contentHtml ?? '',
    // Who last saved this section, and when (set on every section save). Null for a section nobody has edited.
    lastEditedAt: s.lastEditedAt ?? null,
    lastEditedByName: s.lastEditedBy ? (editors?.get(s.lastEditedBy) ?? null) : null,
    // Provenance counts (FR-A-021): saves of this section that were AI-drafted vs. human-authored.
    aiSpanCount: s.aiSpanCount ?? 0,
    humanSpanCount: s.humanSpanCount ?? 0,
  }
}

function documentShapeMeta(d: { version?: string; type?: string; status?: string; stage?: string } & Record<string, unknown>) {
  // Metadata-only shape for list views. version is already a column on
  // Document? No — version lives on DocumentVersion. For list view, we
  // return 'v0.0' when no current version is set. Detail route overrides.
  return {
    ...d,
    type:    hyphenate(d.type),
    status:  hyphenate(d.status),
    stage:   uiStage(d.stage),
    version: d.version ?? 'v0.0',
    sections: [] as Array<ReturnType<typeof sectionShape>>,
  }
}

function documentShapeFull(d: { type?: string; status?: string; stage?: string; currentVersion?: { versionNumber: string; sections: Array<Parameters<typeof sectionShape>[0]> } | null } & Record<string, unknown>, editors?: Map<string, string>) {
  const { currentVersion, ...rest } = d
  return {
    ...rest,
    type:    hyphenate(d.type),
    status:  hyphenate(d.status),
    stage:   uiStage(d.stage),
    version: currentVersion?.versionNumber ?? 'v0.0',
    sections: (currentVersion?.sections ?? []).map(sec => sectionShape(sec, editors)),
  }
}

// Submit-for-review body — only the due date is read here; the rest of the
// panel's payload (reviewers, review type) isn't stored by this route.
const submitBodySchema = z.object({ dueDate: z.string().trim().min(1).optional() }).passthrough()

// documents.reviewDueAt unavailable: the column is missing (P2022, migration
// 52 not applied) or the Prisma client predates it ("Unknown argument").
const isMissingReviewDueColumn = (err: unknown) => {
  const e = err as { code?: string; message?: string } | null
  const msg = e?.message ?? ''
  return e?.code === 'P2022' || (msg.includes('reviewDueAt') && (msg.includes('Unknown argument') || msg.includes('does not exist')))
}

const restoreSchema = z.object({
  sections: z.array(z.object({
    sectionId: z.string(),
    fromVersionId: z.string(),
  })).min(1),
  reason: z.string().min(1),
})

const transitionSchema = z.object({
  to: z.enum(DOCUMENT_STATUSES),
  reason: z.string().max(500).optional(),
})

export const documentsProjectScopedRoutes: FastifyPluginAsync = async (app) => {
  const svc = new DocumentService(app.prisma)

  // List all documents under a project.
  // Returns metadata-only shape — section bodies are too heavy for a list.
  // UI's Document interface expects `sections: []` + `version: string`;
  // documentShapeMeta fills both with defaults the UI can live with.
  app.get('/:projectId/documents', { preHandler: requireAuth({ modules: ['A'] }) }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string }
    const project = await app.prisma.project.findUnique({ where: { id: projectId }, select: { id: true } })
    if (!project) return reply.code(404).send({ error: 'project_not_found' })

    // Project visibility — users who can't see the project can't list its
    // documents. Return 404 (not 403) so non-visible project ids don't leak.
    const visible = await visibleProjectIdsForUser(app.prisma, request.user!)
    if (visible !== 'all' && !visible.has(projectId)) {
      return reply.code(404).send({ error: 'project_not_found' })
    }

    const rows = await app.prisma.document.findMany({
      where: { projectId, deletedAt: null },
      orderBy: { updatedAt: 'desc' },
      include: { currentVersion: { select: { versionNumber: true } } },
    })

    // Batch-fetch assignee display info so the UI's "Assigned To" column
    // resolves for every caller — not just admins who can hit /admin/users.
    // Without this a contributor viewing the project list sees "— —" in
    // every row because the user-id → name map is empty.
    const assigneeIds = Array.from(new Set(rows.map(r => r.assigneeId).filter((v): v is string => !!v)))
    const assignees = assigneeIds.length
      ? await app.prisma.user.findMany({
          where: { id: { in: assigneeIds } },
          select: { id: true, name: true, initials: true },
        })
      : []
    const assigneeById = new Map(assignees.map(u => [u.id, u]))

    return rows.map(r => {
      const a = r.assigneeId ? assigneeById.get(r.assigneeId) : null
      return documentShapeMeta({
        ...r,
        version: r.currentVersion?.versionNumber,
        assigneeName: a?.name ?? null,
        assigneeInitials: a?.initials ?? null,
      })
    })
  })

  // Create a new document for a project.
  app.post('/:projectId/documents', { preHandler: requireAuth({ modules: ['A'] }) }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string }
    const parsed = createSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const project = await app.prisma.project.findUnique({ where: { id: projectId } })
    if (!project) return reply.code(404).send({ error: 'project_not_found' })

    // The project's therapeuticArea is copied in and immutable per FR-A-002.
    // Inheriting it is always allowed; anything else must be an active TA.
    const requestedTa = parsed.data.therapeuticArea
    let therapeuticArea = project.therapeuticArea
    if (requestedTa && !sameTa(requestedTa, project.therapeuticArea)) {
      const canonical = await findActiveTaLabel(app.prisma, requestedTa)
      if (!canonical) return reply.code(400).send(invalidTaBody(requestedTa))
      therapeuticArea = canonical
    }

    // Sources must be this project's own, saved to the library and usable.
    const sourceUploadIds = [...new Set(parsed.data.sourceUploadIds ?? [])]
    if (sourceUploadIds.length) {
      const found = await app.prisma.documentUpload.findMany({ where: { id: { in: sourceUploadIds }, projectId } })
      const byId = new Map(found.map(u => [u.id, u]))
      const bad = sourceUploadIds.find(id => {
        const u = byId.get(id)
        return !u || u.status !== 'confirmed' || u.virusScanStatus === 'failed'
      })
      if (bad) {
        return reply.code(422).send({ error: 'source_unusable', uploadId: bad, message: 'A selected source document is not in this project, not saved to the library, or failed the virus scan.' })
      }
    }

    const { document, version } = await svc.create({
      projectId,
      type: parsed.data.type,
      title: parsed.data.title,
      therapeuticArea,
      // ICH E3 starter sections so the navigator isn't empty; §16.4 only
      // when the project submits to the US (FR-A-003).
      sections: templateSections(parsed.data.type, project.submissionCountries),
      assigneeId: parsed.data.assigneeId,
      createdBy: request.user!.id,
      templateId: parsed.data.templateId,
      targetCompletionDate: parsed.data.targetCompletionDate ? new Date(parsed.data.targetCompletionDate) : undefined,
    })

    if (sourceUploadIds.length) {
      await app.prisma.documentSource.createMany({
        data: sourceUploadIds.map(uploadId => ({ documentId: document.id, uploadId, linkedBy: request.user!.id })),
        skipDuplicates: true,
      })
    }

    // Auto-seed the assignee as the Responsible (R) RACI row. Without
    // this the newly-created doc has no owner in the unified RBAC table,
    // so the RACI editor opens blank and the stage transition engine
    // treats the doc as "no R" — blocking submit. The explicit RACI
    // picker still works to add co-Rs or replace this one.
    //
    // Idempotent: ProjectMember-style uniqueness isn't enforced on
    // DocumentRaci but duplicates would show as two R chips. If a
    // caller already pre-created the R (rare — only the creation flow
    // hits this route today), skip the insert.
    if (parsed.data.assigneeId) {
      const existing = await app.prisma.documentRaci.findFirst({
        where: { documentId: document.id, userId: parsed.data.assigneeId, letter: 'R', removedAt: null },
        select: { id: true },
      })
      if (!existing) {
        await app.prisma.documentRaci.create({
          data: {
            documentId:        document.id,
            userId:            parsed.data.assigneeId,
            letter:            'R',
            signatureRequired: false,
            assignedBy:        request.user!.id,
          },
        })
      }
    }

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'document_created',
      entityType: 'document',
      entityId: document.id,
      details: { projectId, type: document.type, title: document.title, initialVersion: version.versionNumber, sourceUploadIds },
      ipAddress: request.ip ?? null,
    })

    return reply.code(201).send(documentShapeMeta({ ...document, version: version.versionNumber }))
  })
}

export const documentsRoutes: FastifyPluginAsync = async (app) => {
  const svc = new DocumentService(app.prisma)

  // 409 body when the document is locked for authoring (in review, awaiting
  // signature, signed, or its project is closed) — null when content may change
  // or the document doesn't exist (the route's own lookup 404s). Guards every
  // route that writes section content.
  async function authoringLock(documentId: string) {
    const doc = await app.prisma.document.findUnique({ where: { id: documentId }, select: { status: true, projectId: true } })
    if (!doc) return null
    const project = await app.prisma.project.findUnique({ where: { id: doc.projectId }, select: { status: true } })
    return authoringLockReason(doc.status, project?.status)
  }

  app.get('/:documentId', { preHandler: requireAuth({ modules: ['A'] }) }, async (request, reply) => {
    const { documentId } = request.params as { documentId: string }
    const doc = await svc.getWithSections(documentId)
    if (!doc || doc.deletedAt) return reply.code(404).send({ error: 'not_found' })

    // HIPAA minimum-necessary logging: tag every full-body document read
    // as PHI access. The list route (/projects/:id/documents) is NOT tagged
    // because it returns metadata only — no section content. Audit volume
    // trade-off: a user opening 50 docs/day generates 50 phi_document_accessed
    // events; retention policy (indefinite for audit_events) catches these.
    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'phi_document_accessed',
      entityType: 'document',
      entityId: documentId,
      details: {
        module: 'A',
        documentType: doc.type,
        sectionCount: doc.currentVersion?.sections.length ?? 0,
      },
      ipAddress: request.ip ?? null,
    })

    // Names of the people who last edited each section, in one query.
    const editorIds = Array.from(new Set((doc.currentVersion?.sections ?? []).map(sec => sec.lastEditedBy).filter((v): v is string => !!v)))
    const editorUsers = editorIds.length ? await app.prisma.user.findMany({ where: { id: { in: editorIds } }, select: { id: true, name: true } }) : []
    return documentShapeFull(doc, new Map(editorUsers.map(u => [u.id, u.name])))
  })

  app.patch('/:documentId/sections/:sectionId', { preHandler: requireAuth({ modules: ['A'] }) }, async (request, reply) => {
    const { documentId, sectionId } = request.params as { documentId: string; sectionId: string }
    const parsed = sectionUpdateSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const locked = await authoringLock(documentId)
    if (locked) return reply.code(409).send(locked)

    // Autosave precondition (sPM-autosave): block the write when another user
    // holds a live lock on this section. A missing or stale lock passes — the
    // write still succeeds (legacy clients + first-save-after-reconnect paths),
    // and the client is responsible for re-acquiring if it means to keep
    // writing. See section-locks/service.ts.
    const foreignHolder = await requireLockHeldBy(app.prisma, {
      documentId, sectionId, userId: request.user!.id,
    })
    if (foreignHolder) {
      return reply.code(423).send({
        error:        'locked',
        holder:       foreignHolder,
        staleSeconds: SECTION_LOCK_STALE_SECONDS,
      })
    }

    // The section's content before this edit, for the audit entry's before/after.
    const previous = await app.prisma.document.findUnique({
      where:  { id: documentId },
      select: { currentVersion: { select: { sections: {
        where:  { OR: [{ sectionId }, { id: sectionId }] },
        select: { contentHtml: true },
        take:   1,
      } } } },
    })
    const beforeHtml = previous?.currentVersion?.sections?.[0]?.contentHtml ?? ''

    const result = await svc.updateSection({
      documentId,
      sectionId,
      sectionNumber: parsed.data.sectionNumber,
      sectionTitle: parsed.data.sectionTitle,
      contentHtml: parsed.data.contentHtml,
      editorUserId: request.user!.id,
      aiDrafted: parsed.data.aiDrafted,
      aiModel: parsed.data.aiModel,
      sourceRef: parsed.data.sourceRef,
      aiCallRecordId: parsed.data.aiCallRecordId,
    }).catch((err: Error) => {
      if (err.message.includes('not found')) return 'notfound' as const
      throw err
    })

    if (result === 'notfound') return reply.code(404).send({ error: 'not_found' })

    // AI-origin acceptance: stamp the AiCallRecord with the version that was
    // just created so the AI History panel can tie prompt → version and show
    // Undo on the latest non-undone row.
    if (parsed.data.aiCallRecordId) {
      await app.prisma.aiCallRecord.updateMany({
        where: { id: parsed.data.aiCallRecordId },
        data:  { postCallDocumentVersionId: result.version.id },
      })
    }

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: parsed.data.aiDrafted ? 'ai_draft_accepted' : 'section_edited',
      entityType: 'document',
      entityId: documentId,
      details: {
        sectionId,
        versionCreated: result.created,
        versionNumber: result.version.versionNumber,
        aiCallRecordId: parsed.data.aiCallRecordId ?? null,
        // FR-A-021: an AI-drafted save names the model that generated it (the
        // AiCallRecord above links to the prompt, cost and generation time).
        aiModel: parsed.data.aiDrafted ? (parsed.data.aiModel ?? null) : null,
        // Previous and new content (plain text, capped) so the trail shows what changed.
        before: auditText(beforeHtml),
        after:  auditText(parsed.data.contentHtml),
      },
      ipAddress: request.ip ?? null,
    })

    // Fire-and-forget autocheck — content-presence and references-complete
    // strategies may flip now that this section's text/word-count changed.
    // Skip when content didn't change (e.g. title-only tweak via the same
    // endpoint). Errors are logged but don't fail the user's save.
    if (parsed.data.contentHtml !== beforeHtml) {
      void runAutocheckForDocument(app.prisma, {
        documentId,
        triggeredBy: `system:autocheck-section-save:${request.user!.id}`,
        audit: app.audit,
      }).catch((err: unknown) => {
        app.log.warn({ err, documentId, sectionId }, 'autocheck after section save failed')
      })
    }

    return svc.getWithSections(documentId)
  })

  app.get('/:documentId/versions', { preHandler: requireAuth({ modules: ['A'] }) }, async (request, reply) => {
    const { documentId } = request.params as { documentId: string }
    const doc = await app.prisma.document.findUnique({ where: { id: documentId } })
    if (!doc) return reply.code(404).send({ error: 'not_found' })

    return app.prisma.documentVersion.findMany({
      where: { documentId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, versionNumber: true, label: true, contentHash: true,
        isCurrent: true, createdBy: true, createdAt: true, restoreSource: true,
      },
    })
  })

  app.post('/:documentId/restore', { preHandler: requireAuth({ modules: ['A'] }) }, async (request, reply) => {
    const { documentId } = request.params as { documentId: string }
    const parsed = restoreSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const locked = await authoringLock(documentId)
    if (locked) return reply.code(409).send(locked)

    const job = await app.prisma.versionRestoreJob.create({
      data: {
        sourceDocumentId: documentId,
        sectionsRestored: parsed.data.sections as unknown as object,
        reason: parsed.data.reason,
        status: 'pending',
        createdBy: request.user!.id,
      },
    })

    // Enqueue to the worker. Keeps the HTTP response fast + lets the
    // worker reason about chain-of-section-copies without racing other
    // writers (one worker concurrency on this queue).
    await app.queue.enqueue('clinical.restore_version', {
      jobId: job.id,
      documentId,
      actorId: request.user!.id,
    }).catch(err => {
      // Queue unavailable (dev — no Redis). Job stays 'pending'; a manual
      // retry via the admin API can poke it later.
      app.log.warn({ err, jobId: job.id }, 'restore_version enqueue failed — job stays pending')
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'version_restore_initiated',
      entityType: 'document',
      entityId: documentId,
      details: {
        jobId: job.id,
        sections: parsed.data.sections,
        reason: parsed.data.reason,
      },
      ipAddress: request.ip ?? null,
    })

    return reply.code(202).send({ jobId: job.id, status: 'pending' })
  })

  app.post('/:documentId/submit-for-review', { preHandler: requireAuth({ modules: ['A'] }) }, async (request, reply) => {
    const { documentId } = request.params as { documentId: string }
    const doc = await app.prisma.document.findUnique({ where: { id: documentId } })
    if (!doc) return reply.code(404).send({ error: 'not_found' })

    const from = doc.status as DocumentStatus
    // Idempotent re-submit: already in review → return the document unchanged.
    if (from === 'in_review') {
      return doc
    }

    // Gate C — all mandatory items for the current stage must be complete
    // or waived before submission. See checklist/gates.ts. Returns a 409
    // with the structured blocking list so the UI can show "N mandatory
    // items blocking → ICF signed, …" with click-through.
    if (isDbStage(doc.stage)) {
      const gate = await checkSubmitForReviewGate(app.prisma, documentId, doc.stage)
      if (!gate.ok) {
        return reply.code(409).send(blockedBody('submit_for_review', gate))
      }
    }
    // UX gate: not_started is the day-one state for a brand-new document.
    // The strict state machine requires not_started → in_authoring → in_review,
    // but the UI's "Submit for review" button is the only path a writer takes
    // on a demo document, so collapse both hops here. Audit captures the
    // implicit in_authoring step so Part 11 reviewers still see the trail.
    if (from === 'not_started') {
      await app.prisma.document.update({
        where: { id: documentId },
        data: { status: 'in_authoring' },
      })
      await app.audit.append({
        timestamp: new Date().toISOString(),
        actorId: request.user!.id,
        action: 'document_status_changed',
        entityType: 'document',
        entityId: documentId,
        details: { from: 'not_started', to: 'in_authoring', implicit: true },
        ipAddress: request.ip ?? null,
      })
    } else if (!canTransitionDocument(from, 'in_review')) {
      const err = new InvalidDocumentTransitionError(from, 'in_review')
      return reply.code(409).send({ error: 'invalid_transition', message: err.message })
    }

    // Review due date from the Submit-for-review panel ('YYYY-MM-DD' or ISO).
    // Kept only when it parses; stored as UTC midnight of that day.
    const dueRaw = submitBodySchema.safeParse(request.body ?? {}).data?.dueDate
    const dueDate = dueRaw ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(dueRaw) ? `${dueRaw}T00:00:00.000Z` : dueRaw) : null
    const reviewDueAt = dueDate && !Number.isNaN(dueDate.getTime()) ? dueDate : null

    const submitData = { status: 'in_review', submittedForReviewAt: new Date() }
    const updated = await app.prisma.document.update({
      where: { id: documentId },
      data: { ...submitData, reviewDueAt },
    }).catch(err => {
      // Migration 52 (documents.reviewDueAt) not applied yet, or a Prisma
      // client older than the column: submit without the due date.
      if (!isMissingReviewDueColumn(err)) throw err
      app.log.warn('documents.reviewDueAt missing — submitting without a review due date until migration 52 is applied')
      return app.prisma.document.update({ where: { id: documentId }, data: submitData })
    })

    // Auto-advance stage: submitting for review implies the document has
    // left authoring and is now in the Cross-Functional Review stage.
    // Only moves forward (never backward), so a resubmit on a CRM-stage
    // document is a no-op on stage. PRD-A-010 § linear stage-gating.
    const stageMove = await svc.advanceStageTo({
      documentId,
      target: 'cross_functional_review',
    })

    // Auto-complete any ChecklistInstanceItem tagged autoCompleteOn=
    // 'submit_for_review' — typically "Author draft completed and
    // submitted for review" on CSR / CSR Synopsis / Patient Narrative /
    // Safety Narrative. Non-fatal if it fails (status transition already
    // committed); we audit the attempt.
    const autoReport = await fireAutoComplete(app.prisma, app.audit, {
      trigger: 'submit_for_review',
      documentId,
      actorId: request.user!.id,
      ipAddress: request.ip ?? null,
    }).catch(err => {
      app.log.warn({ err, documentId }, 'auto_complete submit_for_review failed — items left pending')
      return null
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'document_submitted_for_review',
      entityType: 'document',
      entityId: documentId,
      details: {
        from,
        to: 'in_review',
        stageFrom: stageMove?.from ?? null,
        stageTo: stageMove?.to ?? null,
        reviewDueAt: reviewDueAt?.toISOString() ?? null,
        autoCompletedCount: autoReport?.completedCount ?? 0,
      },
      ipAddress: request.ip ?? null,
    })

    return updated
  })

  // Generic status transition — the submit-for-review above is a convenience
  // shortcut for the most common path, but reviewers / signers need the
  // full state machine (bounces, approvals, etc.).
  app.post('/:documentId/transition', { preHandler: requireAuth({ modules: ['A'] }) }, async (request, reply) => {
    const { documentId } = request.params as { documentId: string }
    const parsed = transitionSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const doc = await app.prisma.document.findUnique({ where: { id: documentId } })
    if (!doc) return reply.code(404).send({ error: 'not_found' })

    const from = doc.status as DocumentStatus
    const to = parsed.data.to
    if (!canTransitionDocument(from, to)) {
      const err = new InvalidDocumentTransitionError(from, to)
      return reply.code(409).send({ error: 'invalid_transition', message: err.message })
    }

    const updated = await app.prisma.document.update({
      where: { id: documentId },
      data: { status: to },
    })

    // Review-bounce auto-snapshot: any transition from a non-authoring state
    // *into* in_authoring means the document is "coming back for edits" —
    // from a reviewer bounce, a CRM bounce, or a signer refusal. Per the
    // new versioning policy (Oct 2026), each of these creates a new
    // DocumentVersion so the previous reviewed/signed state is preserved
    // as its own row and the author edits a fresh in-place-mutable version.
    let snapshotVersion: Awaited<ReturnType<DocumentService['createVersionSnapshot']>>['version'] | null = null
    if (to === 'in_authoring' && from !== 'in_authoring' && from !== 'not_started') {
      const reason =
        from === 'in_review'          ? 'review_bounce' :
        from === 'crm_in_progress'    ? 'crm_bounce' :
        from === 'pending_signature'  ? 'signature_bounce' :
        'explicit'                                           // defensive
      const snap = await svc.createVersionSnapshot({
        documentId,
        createdBy: request.user!.id,
        reason,
        note: parsed.data.reason,
      })
      snapshotVersion = snap.version
    }

    // Auto-advance stage on status transitions that imply a stage move.
    // Stage only moves forward: a status bounce never rewinds the stepper.
    //   in_review → crm_in_progress   ⇒ stage → crm
    //   pending_signature → signed    ⇒ stage → final_output
    // The in_review entry itself is handled by /submit-for-review (above).
    let stageMove: { from: string; to: string } | null = null
    if (to === 'crm_in_progress') {
      stageMove = await svc.advanceStageTo({ documentId, target: 'crm' })
    } else if (to === 'signed') {
      stageMove = await svc.advanceStageTo({ documentId, target: 'final_output' })
    }

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'document_status_changed',
      entityType: 'document',
      entityId: documentId,
      details: {
        from,
        to,
        reason: parsed.data.reason ?? null,
        snapshotVersionId:     snapshotVersion?.id ?? null,
        snapshotVersionNumber: snapshotVersion?.versionNumber ?? null,
        stageFrom:             stageMove?.from ?? null,
        stageTo:               stageMove?.to ?? null,
      },
      ipAddress: request.ip ?? null,
    })

    return updated
  })

  // Explicit stage advance — PRD-A-010 linear stage-gated progression.
  // The /submit-for-review and /transition endpoints auto-advance when
  // real status events fire; this endpoint is the manual escape hatch
  // for stage moves that don't line up with a status change (e.g.
  // Study Start-Up → During Study → Post-Study are authoring-time
  // milestones that don't flip the document's status).
  app.post('/:documentId/advance-stage', { preHandler: requireAuth({ modules: ['A'] }) }, async (request, reply) => {
    const { documentId } = request.params as { documentId: string }

    // Gate B — all mandatory items for stages ≤ current must be complete
    // or waived before the stepper moves forward. 409 with the blocking
    // list if not. The underlying advanceStage() does its own stage-order
    // + terminal checks after this.
    const doc = await app.prisma.document.findUnique({
      where: { id: documentId },
      select: { stage: true, deletedAt: true },
    })
    if (!doc || doc.deletedAt) return reply.code(404).send({ error: 'not_found' })
    if (isDbStage(doc.stage)) {
      const gate = await checkStageAdvanceGate(app.prisma, documentId, doc.stage)
      if (!gate.ok) {
        return reply.code(409).send(blockedBody('stage_advance', gate))
      }
    }

    try {
      const result = await svc.advanceStage({
        documentId,
        actorId: request.user!.id,
      })

      await app.audit.append({
        timestamp: new Date().toISOString(),
        actorId: request.user!.id,
        action: 'document_stage_advanced',
        entityType: 'document',
        entityId: documentId,
        details: {
          from: result.from,
          to: result.to,
          fromLabel: STAGE_LABELS[result.from],
          toLabel: STAGE_LABELS[result.to],
        },
        ipAddress: request.ip ?? null,
      })

      const doc = await app.prisma.document.findUnique({
        where: { id: documentId },
        include: { currentVersion: { select: { versionNumber: true } } },
      })
      if (!doc) return reply.code(404).send({ error: 'not_found' })
      return documentShapeMeta({ ...doc, version: doc.currentVersion?.versionNumber })
    } catch (err: unknown) {
      if (err instanceof StageAdvanceError) {
        if (err.reason === 'terminal') return reply.code(422).send({ error: 'terminal', message: err.message })
        if (err.message === 'document_not_found') return reply.code(404).send({ error: 'not_found' })
        return reply.code(422).send({ error: 'invalid_stage', message: err.message })
      }
      throw err
    }
  })

  // Read-only: what the next stage would be, labels, and whether the
  // document is already terminal. Lets the UI render the Advance button
  // with the right label without hard-coding the stage order on the client.
  app.get('/:documentId/stage', { preHandler: requireAuth({ modules: ['A'] }) }, async (request, reply) => {
    const { documentId } = request.params as { documentId: string }
    const doc = await app.prisma.document.findUnique({
      where: { id: documentId },
      select: { id: true, stage: true, deletedAt: true },
    })
    if (!doc || doc.deletedAt) return reply.code(404).send({ error: 'not_found' })

    const current: DbStage | null = isDbStage(doc.stage) ? doc.stage : null
    const next = current ? nextStage(current) : null
    return {
      documentId: doc.id,
      current:      current ? dbStageToUi(current)  : null,
      currentLabel: current ? STAGE_LABELS[current] : null,
      next:         next    ? dbStageToUi(next)     : null,
      nextLabel:    next    ? STAGE_LABELS[next]    : null,
      terminal:     next === null,
    }
  })

  // Explicit "Create new version" — snapshots the current section set into
  // a brand-new DocumentVersion row. Normal section saves mutate in place;
  // this endpoint is how a user asks for a checkpoint.
  app.post('/:documentId/versions', { preHandler: requireAuth({ modules: ['A'] }) }, async (request, reply) => {
    const { documentId } = request.params as { documentId: string }
    const bodySchema = z.object({
      label: z.enum(['Draft', 'For Review', 'Final']).optional(),
      note:  z.string().max(500).optional(),
    })
    const parsed = bodySchema.safeParse(request.body ?? {})
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const doc = await app.prisma.document.findUnique({ where: { id: documentId } })
    if (!doc) return reply.code(404).send({ error: 'not_found' })

    const snap = await svc.createVersionSnapshot({
      documentId,
      createdBy: request.user!.id,
      label: parsed.data.label,
      reason: 'explicit',
      note:   parsed.data.note,
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'document_version_created',
      entityType: 'document',
      entityId: documentId,
      details: {
        reason: 'explicit',
        versionId:     snap.version.id,
        versionNumber: snap.version.versionNumber,
        label:         snap.version.label,
        note:          parsed.data.note ?? null,
      },
      ipAddress: request.ip ?? null,
    })

    return reply.code(201).send(snap.version)
  })

  // Admin override of a document's TA (FR-A-002: set at creation, changeable
  // only by Admin). The new TA must be an active master-list tag; the change
  // is audited with before/after values.
  const taChangeSchema = z.object({
    therapeuticArea: z.string().min(1),
    reason: z.string().max(500).optional(),
  })

  app.patch('/:documentId/therapeutic-area', { preHandler: requireAuth({ roles: ['admin'], modules: ['A'] }) }, async (request, reply) => {
    const { documentId } = request.params as { documentId: string }
    const parsed = taChangeSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const doc = await app.prisma.document.findUnique({ where: { id: documentId } })
    if (!doc || doc.deletedAt) return reply.code(404).send({ error: 'not_found' })
    if (sameTa(parsed.data.therapeuticArea, doc.therapeuticArea)) return documentShapeMeta({ ...doc })

    const therapeuticArea = await findActiveTaLabel(app.prisma, parsed.data.therapeuticArea)
    if (!therapeuticArea) return reply.code(400).send(invalidTaBody(parsed.data.therapeuticArea))

    const updated = await app.prisma.document.update({
      where: { id: documentId },
      data: { therapeuticArea },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'document_therapeutic_area_changed',
      entityType: 'document',
      entityId: documentId,
      details: { from: doc.therapeuticArea, to: therapeuticArea, reason: parsed.data.reason ?? null },
      ipAddress: request.ip ?? null,
    })

    return documentShapeMeta({ ...updated })
  })

  // AI Suggest — thin wrapper over AI Gateway. Resolves (projectId,
  // sectionNumber+title) → a prompt and dispatches to the gateway.
  // Returns the raw gateway ChatResult; the UI shows accept/reject.
  // When ANTHROPIC_API_KEY is set, this calls real Anthropic; otherwise
  // deterministic stub (Arc 8.1).
  const aiSuggestSchema = z.object({
    intent: z.enum(['draft_from_source', 'tighten', 'explain', 'custom', 'edit']),
    customPrompt: z.string().min(1).max(2000).optional(),
    // 'edit' (editor prompt box): the section as it stands in the editor, unsaved changes included
    currentContent: z.string().max(200_000).optional(),
    // Selection scope — when the editor has text selected, UI passes the
    // highlighted passage here. If present, the AI returns only the
    // revised passage (not the whole section) and the UI swaps it in
    // place. Keeps edits surgical and avoids collateral changes.
    selectionText: z.string().max(50_000).optional(),
    // Context scope — user-chosen via the scope selector chip. Controls
    // which content the LLM sees for this prompt (one-shot, per prompt).
    // 'section' (default) — just this section's HTML
    // 'document'          — all sections' HTML concatenated with headers
    // 'source'            — list of linked source document titles (full
    //                       text attachment not yet wired; placeholder note)
    scope: z.enum(['section', 'document', 'source']).optional(),
    // When the user attaches specific source files via the composer's
    // paperclip (web/src/panels/AIChatPanel.tsx), their upload ids land
    // here. If present AND non-empty, scope is force-set to 'source' and
    // the context attachment narrows to only these uploads (not every
    // linked SourceDocument on the doc). An empty array behaves like
    // scope='source' with no filter — same as the chip did.
    attachedSourceIds: z.array(z.string().min(1)).max(20).optional(),
    model: z.string().optional(),            // omitted -> the engine saved in Admin Panel -> AI Engine
  }).refine(b => b.intent !== 'edit' || !!b.customPrompt?.trim(), { message: 'Tell the AI what to change', path: ['customPrompt'] })

  app.post('/:documentId/sections/:sectionId/ai-suggest', { preHandler: requireAuth({ modules: ['A'] }) }, async (request, reply) => {
    const { documentId, sectionId } = request.params as { documentId: string; sectionId: string }
    const parsed = aiSuggestSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    // Load the section so the prompt can carry its current content +
    // the section header. Project id is pulled from the document.
    const doc = await app.prisma.document.findUnique({
      where: { id: documentId },
      // Match the stable section key; the row uuid is still accepted for
      // clients that loaded the document before sectionShape sent the key.
      include: { currentVersion: { include: { sections: { where: { OR: [{ sectionId }, { id: sectionId }] } } } } },
    })
    if (!doc) return reply.code(404).send({ error: 'not_found' })
    const section = doc.currentVersion?.sections[0]
    if (!section) return reply.code(404).send({ error: 'section_not_found' })

    const sectionHeader = `${section.sectionNumber.startsWith('§') ? '' : '§'}${section.sectionNumber} ${section.sectionTitle}`
    const currentContent = (parsed.data.intent === 'edit' ? parsed.data.currentContent : undefined) ?? section.contentHtml ?? ''

    // --- Scope-aware context attachment (sPM-ai-chat) ---------------------
    // Default is 'section' (today's behaviour — only this section's HTML
    // was already passed via currentContent). For 'document' and 'source'
    // we expand what the LLM sees without changing the prompt wording;
    // the base prompts (tighten/explain/edit/draft) already reference
    // currentContent, so attaching extra context goes in a separate
    // "Additional context" block the AI treats as reference-only.
    // attachedSourceIds forces scope='source' + narrows to the picked
    // uploads. Explicit attach beats the chip-era scope default.
    const hasAttachments = (parsed.data.attachedSourceIds?.length ?? 0) > 0
    const scope = hasAttachments ? 'source' : (parsed.data.scope ?? 'section')
    let additionalContext = ''
    // Images attached as source documents travel out-of-band as vision
    // inputs to the gateway rather than extracted-text in the prompt —
    // multimodal models can see charts/diagrams/signatures directly.
    const imageAttachments: Array<{ mediaType: string; data: Buffer; label?: string }> = []
    // PDFs where pdf-parse found no text layer (scanned / image-only
    // documents) fall back to Anthropic's native PDF-document support
    // — the model reads both the text layer AND the images inside.
    // Expensive (~1500-3000 tokens / page) so the limit is tighter
    // than text extraction.
    const documentAttachments: Array<{ mediaType: string; data: Buffer; label?: string }> = []
    if (scope === 'document') {
      const allSections = doc.currentVersion?.sections ?? []
      additionalContext = allSections
        .filter(s => s.sectionId !== section.sectionId)                 // exclude the current section (already in currentContent)
        .map(s => `§${s.sectionNumber} ${s.sectionTitle}:\n${s.contentHtml ?? '(empty)'}`)
        .join('\n\n')
    } else if (scope === 'source') {
      // Fetch + extract text from the attached source documents so the
      // LLM gets the real content, not just a title list.
      //
      // Pipeline per upload:
      //   1. Load DocumentUpload row (blobKey + fileName + contentType)
      //   2. app.blob.get → Buffer
      //   3. extractTextFromBlob (text/md decode direct; pdf-parse for
      //      PDF; mammoth for DOCX; everything else degrades to title)
      //   4. Trim per-file to a share of the total budget so one big
      //      file doesn't drown the others
      //
      // Hard cap: 60KB of text across every attachment combined. Beyond
      // that the LLM context cost outweighs the signal. Per-file max is
      // (60000 / sources.length) chars so attachments share the budget
      // evenly. Users attaching 20 docs get ~3KB each — enough to pass
      // a stub to the AI; attaching 1-2 docs gives richer context.
      try {
        const sourceIdFilter = hasAttachments
          ? { uploadId: { in: parsed.data.attachedSourceIds! } }
          : {}
        const sources = await app.prisma.documentSource.findMany({
          where:  { documentId, ...sourceIdFilter },
          select: { uploadId: true },
        })
        if (sources.length === 0) {
          additionalContext = hasAttachments
            ? 'The attached source documents could not be loaded (they may have been unlinked from this document).'
            : 'No source documents are linked to this document.'
        } else {
          const uploads = await app.prisma.documentUpload.findMany({
            where:  { id: { in: sources.map(s => s.uploadId) } },
            select: { id: true, fileName: true, title: true, blobKey: true, contentType: true },
          })

          // Split: images go as vision attachments (max 5 per prompt);
          // the rest go through text extraction with a budget split
          // across them. Image count cap mirrors Anthropic's practical
          // limit — more than 5 blows out the context and the cost.
          const MAX_IMAGES = 5
          const isImageType = (ct: string | null) =>
            !!ct && ct.toLowerCase().startsWith('image/')

          const imageUploads = uploads.filter(u => isImageType(u.contentType)).slice(0, MAX_IMAGES)
          const droppedImages = uploads.filter(u => isImageType(u.contentType)).length - imageUploads.length
          const textUploads  = uploads.filter(u => !isImageType(u.contentType))

          // Fetch image blobs → image attachments (vision input).
          // Each image is run through shrinkImage so phone-camera
          // uploads (10-20MB) are resized / re-encoded to fit the 5MB
          // vision cap instead of silently dropped. See shrink-image.ts.
          const IMAGE_CAP_BYTES = 5 * 1024 * 1024
          const imageShrinkNotes: string[] = []
          await Promise.all(imageUploads.map(async u => {
            try {
              const blob = await app.blob.get('documents', u.blobKey)
              const label = u.title ?? u.fileName
              const original = { mediaType: u.contentType ?? 'image/png', data: blob.body as Buffer }
              const shrunk = await shrinkImage(original, { maxBytes: IMAGE_CAP_BYTES })
              if (!shrunk) {
                // Could not get the image under the cap even at min
                // quality — surface the drop in-context so the LLM
                // knows an attachment was intended but is missing.
                imageShrinkNotes.push(`${label}: dropped (${Math.round(original.data.length / 1024)}KB — could not shrink below the 5MB vision cap)`)
                return
              }
              if (shrunk.shrunk.note !== 'no resize needed') {
                imageShrinkNotes.push(`${label}: ${shrunk.shrunk.note} (${Math.round(shrunk.original.bytes / 1024)}KB → ${Math.round(shrunk.shrunk.bytes / 1024)}KB)`)
              }
              imageAttachments.push({
                mediaType: shrunk.mediaType,
                data:      shrunk.data,
                label,
              })
            } catch { /* non-fatal: just skip */ }
          }))

          // Fetch non-image blobs → text extraction (budgeted share).
          const TOTAL_BUDGET = 60_000
          const perFileMax = textUploads.length > 0
            ? Math.max(500, Math.floor(TOTAL_BUDGET / textUploads.length))
            : 500

          // Also need the blob bytes alongside the extract result so we
          // can fall back to document attachment when text extraction
          // returns zero text on a PDF (image-only / scanned).
          const extracts = await Promise.all(textUploads.map(async u => {
            try {
              const blob = await app.blob.get('documents', u.blobKey)
              const extract = await extractTextFromBlob(blob.body, u.contentType, { maxChars: perFileMax })
              return { upload: u, extract, body: blob.body as Buffer }
            } catch (err) {
              return {
                upload: u,
                body: null,
                extract: {
                  ok: false,
                  text: '',
                  reason: `could not fetch blob: ${err instanceof Error ? err.message : String(err)}`,
                  bytes: 0,
                  returned: 0,
                },
              }
            }
          }))

          // Scanned-PDF fallback: for every PDF whose extract failed
          // because the file has no text layer, attach the raw PDF
          // bytes as a document block (Anthropic reads it natively).
          // Oversized PDFs are chunked to the first-N pages that fit
          // under the byte + page cap, so a 200-page scanned Protocol
          // becomes a readable first-50-pages PDF instead of being
          // silently dropped.
          const MAX_PDF_DOCS = 3
          const MAX_PDF_BYTES = 25 * 1024 * 1024
          const MAX_PDF_PAGES = 100
          let scannedPdfPromoted = 0
          for (const e of extracts) {
            if (documentAttachments.length >= MAX_PDF_DOCS) break
            if (e.extract.ok) continue
            if (!e.body) continue
            const isPdf = (e.upload.contentType ?? '').toLowerCase() === 'application/pdf'
            if (!isPdf) continue
            const reasonLower = e.extract.reason.toLowerCase()
            // Promote when pdf-parse returned "no extractable text"
            // (scanned / image-only) — not for genuine parse failures.
            if (!reasonLower.includes('no extractable text')) continue

            // Chunk if oversize; the fast-path returns as-is when the
            // PDF already fits both caps.
            const chunked = await chunkPdfToFit(e.body, {
              maxBytes: MAX_PDF_BYTES,
              maxPages: MAX_PDF_PAGES,
            })
            if (!chunked) {
              // Can't even fit the first page under the cap — leave the
              // extract as "text unavailable" so the mention renders
              // that way.
              continue
            }

            documentAttachments.push({
              mediaType: 'application/pdf',
              data:      chunked.data,
              label:     e.upload.title ?? e.upload.fileName,
            })
            scannedPdfPromoted++
            // Update the extract so the text-block mention flips to a
            // "sent as PDF document" marker instead of the pdf-parse error.
            e.extract.reason = chunked.pagesOmitted === 0
              ? 'scanned / image-only PDF — sent as document attachment for vision reading'
              : `scanned PDF — sent first ${chunked.pagesIncluded} of ${chunked.originalPages} pages as document attachment for vision reading`
          }

          const header = hasAttachments
            ? 'User-attached source documents — content follows. Treat as reference material only; the primary edit target is the Section content above.'
            : 'Linked source documents — content follows. Treat as reference material only.'

          const textBlocks = extracts.map(({ upload, extract }) => {
            const title = upload.title ?? upload.fileName
            if (extract.ok) {
              const note = extract.reason ? ` [${extract.reason}]` : ''
              return `--- ${title}${note} ---\n${extract.text}`
            }
            // Scanned PDFs promoted to document attachments get a
            // specific marker so the LLM knows to look at the vision
            // input rather than expect text here.
            const promotedToDoc = extract.reason.includes('document attachment')
            return promotedToDoc
              ? `--- ${title} (sent as PDF document attachment — read the attached PDF directly) ---`
              : `--- ${title} (text unavailable: ${extract.reason}) ---`
          })
          void scannedPdfPromoted  // kept for future audit emission

          // Reference the image attachments by label so the LLM can
          // address them specifically ("per the Study Flow Diagram image
          // attached, …"). The actual pixels are in the vision blocks.
          const imageMentions = imageAttachments.map(img =>
            `--- ${img.label ?? 'image'} (sent as image attachment) ---`,
          )
          if (droppedImages > 0) {
            imageMentions.push(`--- (${droppedImages} additional image(s) dropped: only the first ${MAX_IMAGES} images per prompt are attached as vision input) ---`)
          }
          // Shrink/drop notes — surface in-context so the model knows an
          // attachment was resized or couldn't be shrunk below the cap.
          if (imageShrinkNotes.length > 0) {
            imageMentions.push(`--- Image attachment notes:\n${imageShrinkNotes.map(n => `  • ${n}`).join('\n')} ---`)
          }

          const sections = [...textBlocks, ...imageMentions]
          additionalContext = sections.length > 0
            ? `${header}\n\n${sections.join('\n\n')}`
            : header
        }
      } catch { additionalContext = '' }                                 // non-fatal if source-docs table shape differs
    }

    let prompt: string
    switch (parsed.data.intent) {
      case 'draft_from_source':
        prompt = `You are drafting the "${sectionHeader}" section of a Clinical Study Report. Draft the section body in ICH E3 style using the project's linked source documents (CSR, Protocol, IB). Keep it concise; cite the source document where applicable.`
        break
      case 'tighten':
        prompt = `Rewrite the following section for clarity. Preserve every data point and reference. Section: ${sectionHeader}\n\nCurrent content:\n${currentContent}`
        break
      case 'explain':
        prompt = `Summarise the following CSR section in plain English for a non-statistician reviewer. Section: ${sectionHeader}\n\nContent:\n${currentContent}`
        break
      case 'custom':
        prompt = `Section: ${sectionHeader}\n\nCurrent content:\n${currentContent}\n\nUser request:\n${parsed.data.customPrompt ?? ''}`
        break
      case 'edit':
        if (parsed.data.selectionText && parsed.data.selectionText.trim().length > 0) {
          // Selection-scoped edit: return ONLY the revised passage. UI will
          // swap it into the selected range; the rest of the section stays
          // untouched (no risk of collateral AI changes outside the selection).
          prompt = [
            `You are editing a highlighted passage inside the "${sectionHeader}" section of a regulated clinical document (${hyphenate(doc.type)}).`,
            'Apply the instruction below to the passage and return ONLY the revised passage (not the whole section).',
            'Return only HTML using these tags: p, h3, h4, strong, em, u, ul, ol, li, blockquote, table, thead, tbody, tr, th, td. No attributes, no explanations, no code fences.',
            'If the instruction only requires inline text (no block tags), return just the revised text with no surrounding tags.',
            'Do not invent data, numbers, dates, names or references that are not in the passage or the surrounding section. If the instruction needs information you do not have, insert a placeholder such as [TBD: what is needed].',
            '',
            `Instruction:\n${parsed.data.customPrompt!.trim()}`,
            '',
            `Highlighted passage:\n${parsed.data.selectionText}`,
            '',
            `Full section (for context only — do not include in the response):\n${currentContent || '(empty)'}`,
          ].join('\n')
        } else {
          prompt = [
            `You are editing the "${sectionHeader}" section of a regulated clinical document (${hyphenate(doc.type)}).`,
            'Apply the instruction below to the current section content and return the COMPLETE revised section.',
            'Return only HTML using these tags: p, h3, h4, strong, em, u, ul, ol, li, blockquote, table, thead, tbody, tr, th, td. No attributes, no explanations, no code fences.',
            'Do not invent data, numbers, dates, names or references that are not in the current content. If the instruction needs information you do not have, insert a placeholder such as [TBD: what is needed].',
            '',
            `Instruction:\n${parsed.data.customPrompt!.trim()}`,
            '',
            `Current section content (HTML):\n${currentContent || '(empty)'}`,
          ].join('\n')
        }
        break
    }

    // Append the scope context (if any) to whatever prompt the intent built.
    const promptWithScope = additionalContext
      ? `${prompt}\n\n----\nAdditional context (scope=${scope}):\n${additionalContext}`
      : prompt

    const model = await chooseModel(app.prisma, parsed.data.model)
    const promptTextForHistory = (parsed.data.intent === 'custom' || parsed.data.intent === 'edit')
      ? (parsed.data.customPrompt ?? '')
      : parsed.data.intent

    // Every AI request is recorded in the audit chain ("AI suggestion requested"), whether or
    // not the user later accepts the result — so a rejected or ignored suggestion is still
    // traceable. The prompt is kept as a SHA-256 fingerprint, not as text: the permanent,
    // immutable log must not hold document content or PHI the prompt may quote. The fingerprint
    // identifies exactly what was sent, and aiCallRecordId links to the AI call record that
    // holds the full exchange under its own retention rules.
    const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')
    const auditAiRequest = async (outcome: 'completed' | 'quota_reached' | 'failed', extra: Record<string, unknown> = {}) => {
      try {
        await app.audit.append({
          timestamp: new Date().toISOString(),
          actorId: request.user!.id,
          action: 'ai_suggestion_requested',
          entityType: 'document',
          entityId: documentId,
          details: {
            sectionId:         section.sectionId,
            sectionLabel:      sectionHeader,
            aiModel:           model,
            intent:            parsed.data.intent,
            scope,
            selectionScoped:   !!parsed.data.selectionText?.trim(),
            promptSha256:      sha256(promptWithScope),
            promptChars:       promptWithScope.length,
            instructionSha256: sha256(promptTextForHistory),
            instructionChars:  promptTextForHistory.length,
            outcome,
            ...extra,
          },
          ipAddress: request.ip ?? null,
        })
      } catch (err) {
        // The audit log must never break the AI response the user is waiting for.
        request.log.error({ err, documentId, sectionId: section.sectionId }, 'ai_suggestion_requested audit failed')
      }
    }

    try {
      const result = await app.aiGateway.chat({
        tenantId: request.user!.tenantId,
        projectId: doc.projectId,
        actorId: request.user!.id,
        module: 'A',
        intent: parsed.data.intent,
        model,
        prompt: promptWithScope,
        maxOutputTokens: parsed.data.intent === 'edit' ? 4096 : 2048,
        // Image attachments (source files whose contentType is image/*).
        // Empty for text-only prompts — zero overhead when unused.
        images: imageAttachments.length > 0 ? imageAttachments : undefined,
        // PDF document attachments — scanned / image-only PDFs that
        // couldn't be text-extracted get promoted here so the model
        // reads them natively.
        documents: documentAttachments.length > 0 ? documentAttachments : undefined,
        // Prompt-history + Undo context (sPM-history). Scopes the AiCallRecord
        // to the section and snapshots pre-call HTML so the UI can later Undo
        // the last AI change on this section in place.
        documentId,
        sectionId:         section.sectionId,
        documentVersionId: doc.currentVersionId ?? undefined,
        preCallSectionHtml: currentContent,
        promptText:        promptTextForHistory,
      })

      // --- Write the exchange to the user's conversation thread -----------
      // Two rows: the user's turn + the assistant's turn. The dock + the
      // chat panel both read from here so every AI interaction is visible
      // regardless of where it was initiated.
      const kind = parsed.data.intent === 'explain' ? 'explain' : 'suggest'
      const responseText = parsed.data.intent === 'edit' ? stripCodeFence(result.responseText) : result.responseText
      try {
        await app.prisma.aiConversationMessage.create({
          data: {
            actorId:    request.user!.id,
            documentId,
            sectionId:  section.sectionId,
            role:       'user',
            content:    promptTextForHistory,
            scope:      scope,
            intent:     parsed.data.intent,
          },
        })
        await app.prisma.aiConversationMessage.create({
          data: {
            actorId:        request.user!.id,
            documentId,
            sectionId:      section.sectionId,
            role:           'assistant',
            content:        responseText,
            kind,
            intent:         parsed.data.intent,
            aiCallRecordId: result.recordId,
            aiModel:        result.model,
          },
        })
      } catch { /* non-fatal — chat log shouldn't block the AI response */ }

      await auditAiRequest('completed', { aiModel: result.model, aiCallRecordId: result.recordId })

      // Models sometimes wrap HTML in a code fence despite being asked not to.
      if (parsed.data.intent === 'edit') {
        return {
          ...result,
          responseText,
          scope: parsed.data.selectionText ? 'selection' : 'section',
        }
      }
      return result
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'RateLimitedError') {
        await auditAiRequest('quota_reached')
        return reply.code(429).send({ error: 'quota_reached', message: err.message })
      }
      await auditAiRequest('failed')
      throw err
    }
  })

  // ------------------------------------------------------------------------
  // AI chat thread — per-user, per-section (sPM-ai-chat).
  //
  // GET /documents/:docId/sections/:secId/ai-chat
  //   Returns the current user's conversation thread for this section,
  //   oldest-first (so the UI can append new messages at the bottom
  //   naturally). Private — scoped to request.user!.id.
  //
  // POST /ai-chat-messages/:messageId/accept
  //   Marks an assistant message as applied (user clicked Accept + the
  //   section save flow fired). Lets the panel render the "✓ Applied"
  //   badge on the message without second-guessing.
  // ------------------------------------------------------------------------

  app.get('/:documentId/sections/:sectionId/ai-chat', { preHandler: requireAuth({ modules: ['A'] }) }, async (request, reply) => {
    const { documentId, sectionId } = request.params as { documentId: string; sectionId: string }
    const doc = await app.prisma.document.findUnique({
      where: { id: documentId },
      include: { currentVersion: { include: { sections: { where: { OR: [{ sectionId }, { id: sectionId }] } } } } },
    })
    if (!doc) return reply.code(404).send({ error: 'not_found' })
    const section = doc.currentVersion?.sections[0]
    if (!section) return reply.code(404).send({ error: 'section_not_found' })

    const rows = await app.prisma.aiConversationMessage.findMany({
      where:   { actorId: request.user!.id, documentId, sectionId: section.sectionId },
      orderBy: { createdAt: 'asc' },
    })
    return {
      documentId,
      sectionId:  section.sectionId,
      actorId:    request.user!.id,
      messages: rows.map(r => ({
        id:               r.id,
        role:             r.role,
        content:          r.content,
        scope:            r.scope,
        kind:             r.kind,
        intent:           r.intent,
        aiModel:          r.aiModel,
        aiCallRecordId:   r.aiCallRecordId,
        appliedToSection: r.appliedToSection,
        appliedAt:        r.appliedAt ? r.appliedAt.toISOString() : null,
        createdAt:        r.createdAt.toISOString(),
      })),
    }
  })

  app.post('/ai-chat-messages/:messageId/accept', { preHandler: requireAuth({ modules: ['A'] }) }, async (request, reply) => {
    const { messageId } = request.params as { messageId: string }
    const msg = await app.prisma.aiConversationMessage.findUnique({ where: { id: messageId } })
    if (!msg) return reply.code(404).send({ error: 'not_found' })
    if (msg.actorId !== request.user!.id) return reply.code(403).send({ error: 'not_your_message' })
    if (msg.role !== 'assistant') return reply.code(422).send({ error: 'not_an_assistant_message' })

    const updated = await app.prisma.aiConversationMessage.update({
      where: { id: messageId },
      data:  { appliedToSection: true, appliedAt: new Date() },
    })
    return {
      id:               updated.id,
      appliedToSection: updated.appliedToSection,
      appliedAt:        updated.appliedAt?.toISOString() ?? null,
      // The AI call that produced this message — the editor sends it with the save so
      // the audit entry and AI History link back to the prompt / model / cost.
      aiCallRecordId:   updated.aiCallRecordId ?? null,
    }
  })

  // ------------------------------------------------------------------------
  // Unified per-section edit history (sPM-section-history).
  //
  // Lists every save on this section — manual, AI accept, undo, restore —
  // in reverse chronological order. UI's SectionHistoryPanel filters at
  // query time via ?mine=true and ?origin=ai|manual|undo|restore. "Mine"
  // means the current authed user; "all" is any team member.
  //
  // interveningCount on each row = how many history rows are newer; the UI
  // uses this to show "Reverting will discard N later edits" in the
  // confirmation modal before firing /revert.
  // ------------------------------------------------------------------------
  app.get('/:documentId/sections/:sectionId/history', { preHandler: requireAuth({ modules: ['A'] }) }, async (request, reply) => {
    const { documentId, sectionId } = request.params as { documentId: string; sectionId: string }
    const q = request.query as { mine?: string; origin?: string }

    const doc = await app.prisma.document.findUnique({
      where: { id: documentId },
      include: { currentVersion: { include: { sections: { where: { OR: [{ sectionId }, { id: sectionId }] } } } } },
    })
    if (!doc) return reply.code(404).send({ error: 'not_found' })
    const section = doc.currentVersion?.sections[0]
    if (!section) return reply.code(404).send({ error: 'section_not_found' })
    // Revert is offered only while the document is open for authoring.
    const contentLocked = !!(await authoringLock(documentId))

    const rows = await app.prisma.editHistory.findMany({
      where: {
        entityType: 'clinical_section',
        documentId,
        sectionId: section.sectionId,
        ...(q.mine === 'true' && { actorId: request.user!.id }),
        ...(q.origin && ['manual', 'ai', 'undo', 'restore'].includes(q.origin) && { origin: q.origin }),
      },
      orderBy: { createdAt: 'desc' },
    })

    // Side query for AI metadata (prompt + model) — only for origin='ai' rows.
    const aiCallIds = rows
      .map(r => r.aiCallRecordId)
      .filter((x): x is string => !!x)
    const aiMap = aiCallIds.length === 0
      ? new Map<string, { promptText: string | null; model: string; intent: string }>()
      : new Map(
          (await app.prisma.aiCallRecord.findMany({
            where: { id: { in: aiCallIds } },
            select: { id: true, promptText: true, model: true, intent: true },
          })).map(r => [r.id, { promptText: r.promptText, model: r.model, intent: r.intent }]),
        )

    const actorIds = Array.from(new Set(rows.map(r => r.actorId)))
    const actors = actorIds.length === 0
      ? []
      : await app.prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } })
    const actorMap = new Map(actors.map(a => [a.id, a.name]))

    // Precompute intervening-edit counts: for row i (0 = newest), how many
    // ROWS ACROSS ALL USERS are newer than it on the same section. We walk
    // the full set (not just the filtered view) so the modal's warning is
    // accurate even when a user filtered to just their own edits.
    const allRows = (q.mine === 'true' || q.origin)
      ? await app.prisma.editHistory.findMany({
          where:   { entityType: 'clinical_section', documentId, sectionId: section.sectionId },
          orderBy: { createdAt: 'desc' },
          select:  { id: true, actorId: true, origin: true, createdAt: true },
        })
      : rows.map(r => ({ id: r.id, actorId: r.actorId, origin: r.origin, createdAt: r.createdAt }))
    const positionOf = new Map(allRows.map((r, i) => [r.id, i]))

    const entries = rows.map(r => {
      const idx = positionOf.get(r.id) ?? 0
      const intervening = allRows.slice(0, idx)
      const interveningByActor = Array.from(
        intervening.reduce((m, row) => m.set(row.actorId, (m.get(row.actorId) ?? 0) + 1), new Map<string, number>()),
      ).map((entry) => {
        const [actorId, count] = entry as [string, number]
        return { actorId, actorName: actorMap.get(actorId) ?? actorId, count }
      })

      const ai = r.aiCallRecordId ? aiMap.get(r.aiCallRecordId) ?? null : null
      return {
        id:                 r.id,
        actorId:            r.actorId,
        actorName:          actorMap.get(r.actorId) ?? r.actorId,
        origin:             r.origin,
        createdAt:          r.createdAt.toISOString(),
        documentVersionId:  r.documentVersionId,
        aiCallRecordId:     r.aiCallRecordId,
        revertedFromId:     r.revertedFromId,
        promptText:         ai?.promptText ?? null,
        aiIntent:           ai?.intent ?? null,
        aiModel:            ai?.model ?? null,
        interveningCount:   intervening.length,
        interveningByActor,
        // Row-level previews so the UI can show "Was: … → Now: …" without a
        // round-trip for every row. Full HTML is lazy-fetched via
        // GET /section-edits/:id/diff on expand.
        beforeExcerpt:      htmlExcerpt(r.beforeHtml),
        afterExcerpt:       htmlExcerpt(r.afterHtml),
        // Can revert if the document is open for authoring, the snapshot
        // exists and the section is still on the version this edit was made
        // on. Sealed-version check happens in the service.
        canRevert:          !contentLocked
                              && !!r.beforeHtml
                              && r.documentVersionId === doc.currentVersionId,
      }
    })

    // sPM-autosave rollup — additive, non-breaking field. UI can prefer
    // `sessions` for a less-noisy default view (one row per writing burst)
    // while keeping `entries` for raw-row drill-down and compatibility.
    const sessions = sessionizeHistory(entries)

    return {
      documentId,
      sectionId:        section.sectionId,
      currentVersionId: doc.currentVersionId,
      entries,
      sessions,
    }
  })

  // Diff — returns the full beforeHtml / afterHtml for one EditHistory row.
  // Used by the Section History panel's "Show change" expansion so the full
  // snapshots never ship on the list GET (would bloat the chat-length autosave
  // sessions). Shape mirrors the two columns on EditHistory.
  app.get('/section-edits/:editHistoryId/diff', { preHandler: requireAuth({ modules: ['A'] }) }, async (request, reply) => {
    const { editHistoryId } = request.params as { editHistoryId: string }
    const row = await app.prisma.editHistory.findUnique({
      where:  { id: editHistoryId },
      select: {
        id: true,
        entityType: true,
        documentId: true,
        sectionId: true,
        origin: true,
        createdAt: true,
        beforeHtml: true,
        afterHtml: true,
      },
    })
    if (!row) return reply.code(404).send({ error: 'not_found' })
    if (row.entityType !== 'clinical_section') {
      return reply.code(404).send({ error: 'wrong_entity_type' })
    }
    return {
      editHistoryId: row.id,
      documentId:    row.documentId,
      sectionId:     row.sectionId,
      origin:        row.origin,
      createdAt:     row.createdAt.toISOString(),
      beforeHtml:    row.beforeHtml,
      afterHtml:     row.afterHtml,
    }
  })

  // Revert — restores the section to the beforeHtml of the chosen history
  // row. In-place mutation + hash recompute (same mechanism as save). The
  // revert itself writes a SectionEditHistory row with origin='undo' so
  // the chain stays complete.
  app.post('/section-edits/:editHistoryId/revert', { preHandler: requireAuth({ modules: ['A'] }) }, async (request, reply) => {
    const { editHistoryId } = request.params as { editHistoryId: string }
    const target = await app.prisma.editHistory.findUnique({ where: { id: editHistoryId }, select: { documentId: true } })
    if (target?.documentId) {
      const locked = await authoringLock(target.documentId)
      if (locked) return reply.code(409).send(locked)
    }
    try {
      const result = await svc.revertSection({
        editHistoryId,
        editorUserId: request.user!.id,
      })

      const { createHash } = await import('node:crypto')
      const hashOf = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 32)
      const beforeHashes = { afterHash: hashOf(result.contentHtml) }
      await app.audit.append({
        timestamp: new Date().toISOString(),
        actorId: request.user!.id,
        action: 'section_reverted',
        entityType: 'document',
        entityId: result.documentId,
        details: {
          sectionId:     result.sectionId,
          editHistoryId,
          afterHash:     beforeHashes.afterHash,
          inPlace:       true,
        },
        ipAddress: request.ip ?? null,
      })
      return { ok: true, ...result, revertedAt: new Date().toISOString() }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'revert_failed'
      if (msg === 'cannot_revert_cross_version')
        return reply.code(409).send({ error: 'stale', message: 'Section has moved to a newer version; revert no longer applies.' })
      if (msg === 'cannot_revert_sealed_version')
        return reply.code(409).send({ error: 'sealed', message: 'This version is signed; create a new version to continue editing.' })
      if (msg === 'cannot_revert_no_snapshot')
        return reply.code(422).send({ error: 'no_snapshot' })
      if (msg.includes('not_found') || msg.includes('not found'))
        return reply.code(404).send({ error: 'not_found' })
      throw err
    }
  })

  // ------------------------------------------------------------------------
  // Legacy /ai-history + /ai-calls/:id/undo — thin shims kept for mid-
  // session clients already fetching from them. New callers should use
  // /sections/:id/history?origin=ai and /section-edits/:id/revert.
  // ------------------------------------------------------------------------
  app.get('/:documentId/sections/:sectionId/ai-history', { preHandler: requireAuth({ modules: ['A'] }) }, async (request, reply) => {
    const { documentId, sectionId } = request.params as { documentId: string; sectionId: string }
    const doc = await app.prisma.document.findUnique({
      where: { id: documentId },
      // Normalise sectionId — same alias handling as /ai-suggest.
      include: { currentVersion: { include: { sections: { where: { OR: [{ sectionId }, { id: sectionId }] } } } } },
    })
    if (!doc) return reply.code(404).send({ error: 'not_found' })
    const section = doc.currentVersion?.sections[0]
    if (!section) return reply.code(404).send({ error: 'section_not_found' })

    const rows = await app.prisma.aiCallRecord.findMany({
      where: { documentId, sectionId: section.sectionId },
      orderBy: { createdAt: 'desc' },
    })
    const actorIds = Array.from(new Set(rows.map(r => r.actorId)))
    const actors = actorIds.length === 0
      ? []
      : await app.prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } })
    const actorMap = new Map(actors.map(a => [a.id, a.name]))

    return {
      documentId,
      sectionId:        section.sectionId,
      currentVersionId: doc.currentVersionId,
      entries: rows.map(r => ({
        id:                        r.id,
        actorId:                   r.actorId,
        actorName:                 actorMap.get(r.actorId) ?? r.actorId,
        intent:                    r.intent,
        model:                     r.model,
        promptText:                r.promptText,
        documentVersionId:         r.documentVersionId,
        postCallDocumentVersionId: r.postCallDocumentVersionId,
        createdAt:                 r.createdAt.toISOString(),
        undoneAt:                  r.undoneAt ? r.undoneAt.toISOString() : null,
        undoneBy:                  r.undoneBy,
        // Can only undo if: (a) not already undone, (b) a pre-call snapshot
        // exists, (c) this prompt's post-call version is the document's
        // current version (otherwise someone else has since edited past it).
        canUndo:                   !r.undoneAt
                                     && !!r.preCallSectionHtml
                                     && r.postCallDocumentVersionId === doc.currentVersionId,
      })),
    }
  })

  // ------------------------------------------------------------------------
  // Undo the last AI change on this section — IN PLACE on the current
  // DocumentVersion (no new version row). Rationale: AI Suggest + Undo
  // behave like Ctrl+Z; they don't clutter the version timeline. Part 11
  // traceability is kept via an audit_events row with before/after hashes
  // (hash chain already seals the trail).
  //
  // Preconditions enforced:
  //   - AiCallRecord exists, has a preCallSectionHtml snapshot, is not
  //     already undone, has postCallDocumentVersionId == doc.currentVersionId
  //   - The section still exists on the current version
  //
  // Mutation: SectionContent.update() under @@unique(documentVersionId,
  // sectionId). No DocumentVersion row created; Document.currentVersionId
  // untouched.
  // ------------------------------------------------------------------------
  app.post('/ai-calls/:aiCallRecordId/undo', { preHandler: requireAuth({ modules: ['A'] }) }, async (request, reply) => {
    const { aiCallRecordId } = request.params as { aiCallRecordId: string }
    const rec = await app.prisma.aiCallRecord.findUnique({ where: { id: aiCallRecordId } })
    if (!rec) return reply.code(404).send({ error: 'not_found' })
    if (rec.undoneAt) return reply.code(409).send({ error: 'already_undone' })
    if (!rec.preCallSectionHtml) return reply.code(422).send({ error: 'no_snapshot' })
    if (!rec.documentId || !rec.sectionId) return reply.code(422).send({ error: 'not_section_scoped' })

    const locked = await authoringLock(rec.documentId)
    if (locked) return reply.code(409).send(locked)

    const doc = await app.prisma.document.findUnique({
      where: { id: rec.documentId },
      include: { currentVersion: { include: { sections: { where: { sectionId: rec.sectionId } } } } },
    })
    if (!doc || !doc.currentVersion) return reply.code(404).send({ error: 'not_found' })
    if (rec.postCallDocumentVersionId !== doc.currentVersionId) {
      return reply.code(409).send({ error: 'stale', message: 'Section has been edited since this AI call; Undo no longer applies.' })
    }
    const sectionRow = doc.currentVersion.sections[0]
    if (!sectionRow) return reply.code(404).send({ error: 'section_not_found' })

    const previousHtml = sectionRow.contentHtml ?? ''
    // In-place swap. The unique key (documentVersionId, sectionId) means
    // the row is addressable without touching Document.currentVersionId or
    // creating a new DocumentVersion.
    await app.prisma.sectionContent.update({
      where: { documentVersionId_sectionId: { documentVersionId: doc.currentVersionId!, sectionId: rec.sectionId } },
      data:  { contentHtml: rec.preCallSectionHtml },
    })
    const undoneAt = new Date()
    await app.prisma.aiCallRecord.update({
      where: { id: rec.id },
      data:  { undoneAt, undoneBy: request.user!.id },
    })

    // Audit trail — carries before/after hashes so Part 11 reviewers can
    // reconstruct the change without a DocumentVersion row.
    const { createHash } = await import('node:crypto')
    const hashOf = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 32)
    await app.audit.append({
      timestamp: undoneAt.toISOString(),
      actorId: request.user!.id,
      action: 'ai_prompt_undone',
      entityType: 'document',
      entityId: rec.documentId,
      details: {
        sectionId:         rec.sectionId,
        documentVersionId: doc.currentVersionId,
        aiCallRecordId:    rec.id,
        intent:            rec.intent,
        model:             rec.model,
        beforeHash:        hashOf(previousHtml),
        afterHash:         hashOf(rec.preCallSectionHtml),
        inPlace:           true,
      },
      ipAddress: request.ip ?? null,
    })

    return {
      ok: true,
      undoneAt: undoneAt.toISOString(),
      documentId: rec.documentId,
      sectionId:  rec.sectionId,
      contentHtml: rec.preCallSectionHtml,
    }
  })
}
