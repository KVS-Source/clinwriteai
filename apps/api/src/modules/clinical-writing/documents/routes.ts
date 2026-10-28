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
  s: { id: string; sectionId: string; sectionNumber: string; sectionTitle: string; ichStatus: string; contentHtml?: string | null; lastEditedBy?: string | null; lastEditedAt?: Date | null },
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

    const rows = await app.prisma.document.findMany({
      where: { projectId, deletedAt: null },
      orderBy: { updatedAt: 'desc' },
      include: { currentVersion: { select: { versionNumber: true } } },
    })
    return rows.map(r => documentShapeMeta({ ...r, version: r.currentVersion?.versionNumber }))
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

    const updated = await app.prisma.document.update({
      where: { id: documentId },
      data: { status: 'in_review', submittedForReviewAt: new Date() },
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
    if (scope === 'document') {
      const allSections = doc.currentVersion?.sections ?? []
      additionalContext = allSections
        .filter(s => s.sectionId !== section.sectionId)                 // exclude the current section (already in currentContent)
        .map(s => `§${s.sectionNumber} ${s.sectionTitle}:\n${s.contentHtml ?? '(empty)'}`)
        .join('\n\n')
    } else if (scope === 'source') {
      // Full source-document text attachment is not yet wired (needs blob
      // text extraction). For now list the referenced source document
      // titles so the AI knows what's attached. When the composer sends
      // attachedSourceIds we narrow to those; otherwise fall back to
      // every linked SourceDocument on the doc (the old chip behaviour).
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
          const uploads = await app.prisma.contentUpload.findMany({
            where:  { id: { in: sources.map(s => s.uploadId) } },
            select: { fileName: true },
          })
          const header = hasAttachments
            ? `User-attached source documents (titles only; full text not yet attached in this context):`
            : `Linked source documents (titles only; full text not yet attached in this context):`
          additionalContext = `${header}\n${uploads.map(u => `• ${u.fileName}`).join('\n')}`
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
