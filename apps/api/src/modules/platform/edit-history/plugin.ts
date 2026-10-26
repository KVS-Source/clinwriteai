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
