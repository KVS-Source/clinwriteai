// Fastify plugin that wires the EditHistoryService into the app + registers
// each module's per-entity-type revert handler at boot.
//
// Modules call `app.editHistory.recordEdit(...)` when they save content and
// `app.editHistory.revert(editId, userId)` from their revert endpoints.

import fp from 'fastify-plugin'
import type { FastifyPluginAsync } from 'fastify'
import { EditHistoryService } from './service.js'
import { hashSections } from '../../clinical-writing/documents/service.js'

declare module 'fastify' {
  interface FastifyInstance {
    editHistory: EditHistoryService
  }
}

const editHistoryPlugin: FastifyPluginAsync = async (app) => {
  const svc = new EditHistoryService(app.prisma)

  // --- Module A: clinical_section revert handler ----------------------------
  // Reverts SectionContent.contentHtml to the pre-edit snapshot and
  // recomputes DocumentVersion.contentHash so Part 11 re-verification sees
  // the real content. Mirrors apps/api/src/modules/clinical-writing/
  // documents/service.ts revertSection() but lives here so the service
  // stays Module-A-agnostic.
  svc.registerRevertHandler('clinical_section', async (prisma, { editHistoryRow }) => {
    if (!editHistoryRow.subUnitId) throw new Error('cannot_revert_no_sub_unit')
    if (!editHistoryRow.documentVersionId) throw new Error('cannot_revert_no_version')
    if (editHistoryRow.beforeHtml === null) throw new Error('cannot_revert_no_snapshot')

    await prisma.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${editHistoryRow.entityId}))`

    const doc = await prisma.document.findUnique({
      where: { id: editHistoryRow.entityId },
      include: { currentVersion: { include: { sections: true } } },
    })
    if (!doc?.currentVersion) throw new Error('document_not_found')
    if (editHistoryRow.documentVersionId !== doc.currentVersionId) {
      throw new Error('cannot_revert_cross_version')
    }
    // Sealed check — reuse the signature-record query that was baked into
    // the Module A service. Any signed record matching the current version
    // number blocks in-place mutation.
    const sealed = await prisma.signatureRecord.findFirst({
      where: {
        status:           'signed',
        versionAtSigning: doc.currentVersion.versionNumber,
        chain:            { documentId: editHistoryRow.entityId },
      },
      select: { id: true },
    })
    if (sealed) throw new Error('cannot_revert_sealed_version')

    const sectionRow = doc.currentVersion.sections.find(s => s.sectionId === editHistoryRow.subUnitId)
    if (!sectionRow) throw new Error('section_not_found')

    const previousHtml = sectionRow.contentHtml ?? ''
    await prisma.sectionContent.update({
      where: {
        documentVersionId_sectionId: {
          documentVersionId: doc.currentVersionId!,
          sectionId:         editHistoryRow.subUnitId,
        },
      },
      data: {
        contentHtml:  editHistoryRow.beforeHtml,
        lastEditedAt: new Date(),
      },
    })

    // Recompute content hash
    const nextSections = doc.currentVersion.sections.map(s =>
      s.sectionId === editHistoryRow.subUnitId
        ? { sectionId: s.sectionId, contentHtml: editHistoryRow.beforeHtml! }
        : { sectionId: s.sectionId, contentHtml: s.contentHtml },
    )
    await prisma.documentVersion.update({
      where: { id: doc.currentVersionId! },
      data:  { contentHash: hashSections(nextSections) },
    })

    return { previousHtml, contentAfter: editHistoryRow.beforeHtml }
  })

  // --- Module B: peer_review_response revert handler ------------------------
  // ReviewerComment.responseText is the editable surface. Revert = swap it
  // back to beforeHtml. entityId is the comment id; subUnitId carries the
  // roundId for scoping. The letter-version snapshot happens on the NEXT
  // regular PATCH save (via the route handler) — we don't duplicate the
  // snapshot here to avoid a cross-module import cycle.
  svc.registerRevertHandler('peer_review_response', async (prisma, { editHistoryRow }) => {
    if (editHistoryRow.beforeHtml === null) throw new Error('cannot_revert_no_snapshot')
    const comment = await prisma.reviewerComment.findUnique({ where: { id: editHistoryRow.entityId } })
    if (!comment) throw new Error('reviewer_comment_not_found')
    const previousHtml = comment.responseText ?? ''
    await prisma.reviewerComment.update({
      where: { id: comment.id },
      data:  { responseText: editHistoryRow.beforeHtml },
    })
    return { previousHtml, contentAfter: editHistoryRow.beforeHtml }
  })

  // --- Module D: ha_response_draft revert handler ---------------------------
  // HA drafts use an append-only version chain per question — unlike A/B/E
  // which mutate in place. Revert here creates a NEW draft version with
  // the restored text so the chain integrity (monotonic versionNumber per
  // question, UNIQUE(questionId, versionNumber)) is preserved. The caller
  // gets back the restored text; the UI invalidates its draft list and
  // refetches to see the new version at the top.
  svc.registerRevertHandler('ha_response_draft', async (prisma, { editHistoryRow, currentUserId }) => {
    if (editHistoryRow.beforeHtml === null) throw new Error('cannot_revert_no_snapshot')
    const questionId = editHistoryRow.entityId
    const question = await prisma.haLoqQuestion.findUnique({ where: { id: questionId } })
    if (!question) throw new Error('ha_question_not_found')
    if (question.status === 'closed') throw new Error('cannot_revert_closed_question')

    const latest = await prisma.haResponseDraft.findFirst({
      where: { questionId },
      orderBy: { versionNumber: 'desc' },
      select: { versionNumber: true, draftText: true },
    })
    const previousHtml = latest?.draftText ?? ''
    const nextVersion = (latest?.versionNumber ?? 0) + 1

    await prisma.haResponseDraft.create({
      data: {
        questionId,
        versionNumber: nextVersion,
        draftText:     editHistoryRow.beforeHtml,
        sourceRefs:    [],
        aiFootprintPct: 0,                                       // revert output is human-attributed
        createdBy:     currentUserId,
      },
    })
    return { previousHtml, contentAfter: editHistoryRow.beforeHtml }
  })

  // --- Module B (slides): slide revert handler ------------------------------
  // Slide content is serialised as JSON {title, bodyText, speakerNotes}
  // in beforeHtml/afterHtml. Revert parses the JSON + swaps all three
  // fields in place on the current Slide row. In-place mutation (same
  // mental model as Module A sections — no new row per edit).
  svc.registerRevertHandler('slide', async (prisma, { editHistoryRow }) => {
    if (editHistoryRow.beforeHtml === null) throw new Error('cannot_revert_no_snapshot')
    const slide = await prisma.slide.findUnique({ where: { id: editHistoryRow.entityId } })
    if (!slide) throw new Error('slide_not_found')
    let parsed: { title: string; bodyText: string; speakerNotes: string }
    try {
      const obj = JSON.parse(editHistoryRow.beforeHtml)
      parsed = {
        title:        typeof obj.title === 'string'        ? obj.title        : slide.title,
        bodyText:     typeof obj.bodyText === 'string'     ? obj.bodyText     : slide.bodyText,
        speakerNotes: typeof obj.speakerNotes === 'string' ? obj.speakerNotes : slide.speakerNotes,
      }
    } catch {
      throw new Error('cannot_revert_malformed_snapshot')
    }
    const previousHtml = JSON.stringify({
      title: slide.title, bodyText: slide.bodyText, speakerNotes: slide.speakerNotes,
    })
    await prisma.slide.update({
      where: { id: slide.id },
      data:  { title: parsed.title, bodyText: parsed.bodyText, speakerNotes: parsed.speakerNotes },
    })
    return { previousHtml, contentAfter: editHistoryRow.beforeHtml }
  })

  // --- Module E: atomised_content revert handler ----------------------------
  // AtomisedContent is one row per (card, channel). Revert = restore the
  // contentText to beforeHtml. No version/hash machinery here; the AI
  // footprint hash is recomputed from the restored text.
  svc.registerRevertHandler('atomised_content', async (prisma, { editHistoryRow }) => {
    if (!editHistoryRow.subUnitId) throw new Error('cannot_revert_no_sub_unit')
    if (editHistoryRow.beforeHtml === null) throw new Error('cannot_revert_no_snapshot')
    const row = await prisma.atomisedContent.findUnique({
      where: {
        ideationContentCardId_channel: {
          ideationContentCardId: editHistoryRow.entityId,
          channel:               editHistoryRow.subUnitId,
        },
      },
    })
    if (!row) throw new Error('atomised_content_not_found')

    const previousHtml = row.contentText ?? ''
    const nextText = editHistoryRow.beforeHtml
    // Recompute AI footprint hash with the restored text so downstream
    // consumers see a stable hash of what's actually stored. Model stays
    // the one on record (we don't know the original model from history).
    const { createHash } = await import('node:crypto')
    const aiFootprintHash = createHash('sha256')
      .update(editHistoryRow.entityId).update('|')
      .update(editHistoryRow.subUnitId).update('|')
      .update(row.aiFootprintHash.slice(0, 32)).update('|')
      .update(nextText)
      .digest('hex')
    await prisma.atomisedContent.update({
      where: { id: row.id },
      data:  { contentText: nextText, aiFootprintHash },
    })
    return { previousHtml, contentAfter: nextText }
  })

  app.decorate('editHistory', svc)
}

export default fp(editHistoryPlugin, { name: 'edit-history' })
