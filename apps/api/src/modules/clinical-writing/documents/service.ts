// Document service — the only path for mutations that need the
// version/provenance invariants to hold.
//
// Invariants enforced here:
//   1. A document has exactly one version row with is_current = true. Flipping
//      the flag is wrapped in a transaction with the new row's insert.
//   2. documents.current_version_id always points at that is_current row.
//   3. content_hash on a version is the sha256 of the deterministic join of
//      every section's HTML (sorted by sectionId). This is what the Part 11
//      e-sig chain binds to — never recompute it from a different source.
//   4. ProvenanceRecord is append-only — the service never updates existing
//      rows, only inserts new ones for AI-accepted spans.

import { createHash } from 'node:crypto'
import type { PrismaClient } from '@prisma/client'
import {
  isDbStage,
  isLaterStage,
  nextStage,
  StageAdvanceError,
  STAGE_LABELS,
  type DbStage,
} from '../document-stage.js'
import { ensureChecklistInstance } from '../checklist/service.js'

export interface SectionPayload {
  sectionId: string
  sectionNumber: string
  sectionTitle: string
  contentHtml: string
  ichStatus?: string
}

export function hashSections(sections: ReadonlyArray<Pick<SectionPayload, 'sectionId' | 'contentHtml'>>): string {
  const sorted = [...sections].sort((a, b) => a.sectionId.localeCompare(b.sectionId))
  const h = createHash('sha256')
  for (const s of sorted) {
    h.update(s.sectionId, 'utf8')
    h.update('', 'utf8')
    h.update(s.contentHtml, 'utf8')
    h.update('', 'utf8')
  }
  return h.digest('hex')
}

export interface CreateDocumentArgs {
  projectId: string
  type: string
  title: string
  therapeuticArea: string
  assigneeId: string
  createdBy: string
  templateId?: string
  targetCompletionDate?: Date
  /** Starter sections for v0.1 (e.g. the ICH E3 template). Default: none. */
  sections?: SectionPayload[]
}

export class DocumentService {
  constructor(private readonly prisma: PrismaClient) {}

  async create(args: CreateDocumentArgs) {
    return this.prisma.$transaction(async (tx) => {
      const doc = await tx.document.create({
        data: {
          projectId: args.projectId,
          type: args.type,
          title: args.title,
          therapeuticArea: args.therapeuticArea,
          assigneeId: args.assigneeId,
          createdBy: args.createdBy,
          templateId: args.templateId ?? null,
          targetCompletionDate: args.targetCompletionDate ?? null,
          status: 'not_started',
          stage: 'study_start_up',
        },
      })

      const sections = args.sections ?? []
      const version = await tx.documentVersion.create({
        data: {
          documentId: doc.id,
          versionNumber: 'v0.1',
          label: 'Draft',
          contentHash: hashSections(sections),  // invariant 3 — covers the starter sections
          isCurrent: true,
          createdBy: args.createdBy,
        },
      })

      if (sections.length > 0) {
        await tx.sectionContent.createMany({
          data: sections.map(s => ({
            documentVersionId: version.id,
            sectionId: s.sectionId,
            sectionNumber: s.sectionNumber,
            sectionTitle: s.sectionTitle,
            contentHtml: s.contentHtml,
            ichStatus: s.ichStatus ?? 'not_started',
          })),
        })
      }

      await tx.document.update({
        where: { id: doc.id },
        data: { currentVersionId: version.id },
      })

      // Materialise the ChecklistInstance up front rather than on first GET.
      // Keeps the home-page project summary read-only safe (no visit ever
      // creates records) and makes the per-document GET a pure read.
      await ensureChecklistInstance(tx, {
        documentId: doc.id,
        deliverableType: args.type,
        actorId: args.createdBy,
        projectId: args.projectId,
      })

      return { document: { ...doc, currentVersionId: version.id }, version }
    })
  }

  /**
   * Advance a document to the next stage in the linear PRD-A-010 sequence.
   * Returns the updated document + the stage transition for audit.
   *
   * Also used internally by auto-advance paths (submit-for-review, status
   * transition to CRM / signed) via `advanceStageTo` so the stepper and the
   * status pill move together.
   */
  async advanceStage(args: {
    documentId: string
    actorId: string
  }): Promise<{ documentId: string; from: DbStage; to: DbStage }> {
    return this.prisma.$transaction(async (tx) => {
      const doc = await tx.document.findUnique({
        where: { id: args.documentId },
        select: { id: true, stage: true, deletedAt: true },
      })
      if (!doc || doc.deletedAt) throw new StageAdvanceError('document_not_found', 'invalid')

      if (!isDbStage(doc.stage)) {
        throw new StageAdvanceError(`document has unknown stage '${doc.stage}'`, 'invalid')
      }

      const to = nextStage(doc.stage)
      if (!to) {
        throw new StageAdvanceError(
          `document is at terminal stage ${doc.stage} (${STAGE_LABELS[doc.stage]})`,
          'terminal',
        )
      }

      await tx.document.update({ where: { id: doc.id }, data: { stage: to } })
      return { documentId: doc.id, from: doc.stage, to }
    })
  }

  /**
   * Move the document's stage to `target` iff `target` is strictly later
   * than the current stage. Used by auto-advance (submit-for-review,
   * transition→crm, transition→signed). Returns the transition when it
   * fires, or null when the document was already at or past the target.
   */
  async advanceStageTo(args: {
    documentId: string
    target: DbStage
  }): Promise<{ from: DbStage; to: DbStage } | null> {
    const doc = await this.prisma.document.findUnique({
      where: { id: args.documentId },
      select: { stage: true },
    })
    if (!doc) return null
    if (!isDbStage(doc.stage)) return null
    if (!isLaterStage(doc.stage, args.target)) return null

    await this.prisma.document.update({
      where: { id: args.documentId },
      data: { stage: args.target },
    })
    return { from: doc.stage, to: args.target }
  }

  async getWithSections(documentId: string) {
    const doc = await this.prisma.document.findUnique({
      where: { id: documentId },
      include: {
        currentVersion: {
          include: { sections: true },
        },
      },
    })
    // Order by section number, not by the text key ('s1','s10','s2' sorted
    // §10 before §2 in the navigator).
    doc?.currentVersion?.sections.sort(compareSections)
    return doc
  }

  /**
   * Update a single section on the current version.
   *
   * **New versioning policy (Oct 2026)** — new DocumentVersion rows are only
   * created in three cases, none of which are "someone edited a section":
   *   1. User clicks "Create new version"           → createVersionSnapshot()
   *   2. Document comes back from review            → transition endpoint
   *   3. User restores sections from an older version → VersionRestoreJob
   *
   * Everything else — including normal section saves — mutates the current
   * version's SectionContent IN PLACE. The DocumentVersion row's contentHash
   * is recomputed so Part 11 e-sig re-verification still sees a hash of
   * exactly what's stored. Signatures are only taken in pending_signature
   * (edits blocked by the state machine), so a signed hash never drifts.
   *
   * Safety net: if the current version is already sealed (has signatures
   * recorded) and somehow updateSection is called anyway, a brand-new
   * version is force-created rather than clobbering signed content.
   *
   * Returns `{ document, version, created, mutated }` — `created` is true
   * only on the safety-net path.
   */
  async updateSection(args: {
    documentId: string
    sectionId: string
    sectionNumber?: string
    sectionTitle?: string
    contentHtml: string
    editorUserId: string
    aiDrafted?: boolean
    aiModel?: string
    sourceRef?: string
    // When the save originates from Accept on an AI Suggest response, the
    // route passes the AiCallRecord id so the SectionEditHistory row can
    // back-link into the AI metadata (prompt text, cost, model).
    aiCallRecordId?: string
  }) {
    return this.prisma.$transaction(async (tx) => {
      // One writer per document at a time. Prevents a double-save from
      // racing (two in-place updates recomputing contentHash on top of each
      // other). Advisory lock is released when the tx ends.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${args.documentId}))`

      const doc = await tx.document.findUnique({
        where: { id: args.documentId },
        include: {
          currentVersion: { include: { sections: true } },
        },
      })
      if (!doc?.currentVersion) throw new Error(`Document ${args.documentId} not found or has no current version`)

      const current = doc.currentVersion
      // Match the stable section key. A row uuid (sent by clients that loaded
      // the document before the API exposed the key) is resolved to its key
      // so the edit updates that section instead of appending a new one.
      const existing = current.sections.find(s => s.sectionId === args.sectionId)
        ?? current.sections.find(s => s.id === args.sectionId)
      if (existing) args = { ...args, sectionId: existing.sectionId }

      // No-op if content didn't actually change.
      if (existing && existing.contentHtml === args.contentHtml) {
        return { document: doc, version: current, created: false, mutated: false }
      }

      // --- Safety net: if the current version is sealed (any signed record on
      // its chain), fall back to the legacy "new version per edit" behavior
      // so signed content is never clobbered. Normal state-machine use blocks
      // edits in pending_signature/signed, so this path is defensive only.
      const sealed = await isVersionSealed(tx, doc.id, current.versionNumber)
      if (sealed) {
        return createNewVersionFromEdit(tx, { doc, current, args })
      }

      // --- Default path: in-place mutation on the current version.
      // Update the SectionContent row (or create it if the section is new),
      // recompute the version's contentHash from the resulting set, bump
      // last-edited metadata, and append provenance if AI-drafted.
      const nextSections: SectionPayload[] = current.sections.map(s =>
        s.sectionId === args.sectionId
          ? {
              sectionId:    s.sectionId,
              sectionNumber: args.sectionNumber ?? s.sectionNumber,
              sectionTitle:  args.sectionTitle  ?? s.sectionTitle,
              contentHtml:   args.contentHtml,
              ichStatus:     'in_progress',
            }
          : {
              sectionId:    s.sectionId,
              sectionNumber: s.sectionNumber,
              sectionTitle:  s.sectionTitle,
              contentHtml:   s.contentHtml,
              ichStatus:     s.ichStatus,
            },
      )
      if (!existing) {
        nextSections.push({
          sectionId:    args.sectionId,
          sectionNumber: args.sectionNumber ?? args.sectionId,
          sectionTitle:  args.sectionTitle  ?? args.sectionId,
          contentHtml:   args.contentHtml,
          ichStatus:     'in_progress',
        })
      }

      if (existing) {
        await tx.sectionContent.update({
          where: { documentVersionId_sectionId: { documentVersionId: current.id, sectionId: args.sectionId } },
          data: {
            sectionNumber: args.sectionNumber ?? existing.sectionNumber,
            sectionTitle:  args.sectionTitle  ?? existing.sectionTitle,
            contentHtml:   args.contentHtml,
            ichStatus:     'in_progress',
            wordCount:     countWords(args.contentHtml),
            lastEditedBy:  args.editorUserId,
            lastEditedAt:  new Date(),
            aiSpanCount:   args.aiDrafted ? { increment: 1 } : undefined,
            humanSpanCount: !args.aiDrafted ? { increment: 1 } : undefined,
          },
        })
      } else {
        await tx.sectionContent.create({
          data: {
            documentVersionId: current.id,
            sectionId:    args.sectionId,
            sectionNumber: args.sectionNumber ?? args.sectionId,
            sectionTitle:  args.sectionTitle  ?? args.sectionId,
            contentHtml:   args.contentHtml,
            ichStatus:     'in_progress',
            wordCount:     countWords(args.contentHtml),
            lastEditedBy:  args.editorUserId,
            lastEditedAt:  new Date(),
            aiSpanCount:   args.aiDrafted ? 1 : 0,
            humanSpanCount: args.aiDrafted ? 0 : 1,
          },
        })
      }

      // Recompute + store the version's content hash so Part 11 re-verifies.
      const nextHash = hashSections(nextSections)
      const nextVersion = await tx.documentVersion.update({
        where: { id: current.id },
        data:  { contentHash: nextHash },
      })

      // Document moves out of not_started on first edit; otherwise status
      // is untouched (edits don't trigger status transitions on their own).
      if (doc.status === 'not_started') {
        await tx.document.update({
          where: { id: doc.id },
          data:  { status: 'in_authoring' },
        })
      }

      if (args.aiDrafted) {
        await tx.provenanceRecord.create({
          data: {
            documentVersionId: current.id,
            sectionId:    args.sectionId,
            spanId:       `${args.sectionId}#${Date.now()}`,
            spanText:     stripHtml(args.contentHtml),
            sourceType:   'ai_draft',
            sourceRef:    args.sourceRef ?? null,
            aiModel:      args.aiModel  ?? null,
            aiGeneratedAt: new Date(),
            acceptedBy:   args.editorUserId,
            acceptedAt:   new Date(),
          },
        })
      }

      // EditHistory — one row per non-noop save, powers the unified
      // SectionHistoryPanel. Uses the polymorphic EditHistory table +
      // populates the clinical-section convenience columns so Module A
      // queries don't need to change.
      await tx.editHistory.create({
        data: {
          entityType:        'clinical_section',
          entityId:          doc.id,
          subUnitId:         args.sectionId,
          documentId:        doc.id,
          sectionId:         args.sectionId,
          documentVersionId: current.id,
          actorId:           args.editorUserId,
          origin:            args.aiDrafted ? 'ai' : 'manual',
          beforeHtml:        existing?.contentHtml ?? null,
          afterHtml:         args.contentHtml,
          aiCallRecordId:    args.aiDrafted ? args.aiCallRecordId ?? null : null,
        },
      })

      return { document: doc, version: nextVersion, created: false, mutated: true }
    })
  }

  /**
   * Revert a section to the state captured by a specific
   * SectionEditHistory row. Mutates SectionContent in place on the current
   * version (same mechanism as the normal in-place save path), writes a
   * matching origin='undo' history row so the revert itself is undoable,
   * and audits the change with before/after hashes.
   *
   * `interveningCount` + `interveningActors` are precomputed and returned
   * so the UI's confirmation dialog can tell the user how many later edits
   * are about to be dropped — but the service does NOT block on them; the
   * decision stays with the UI (confirmation gate).
   */
  async revertSection(args: {
    editHistoryId: string
    editorUserId: string
  }) {
    return this.prisma.$transaction(async (tx) => {
      const target = await tx.editHistory.findUnique({ where: { id: args.editHistoryId } })
      if (!target) throw new Error(`Edit history ${args.editHistoryId} not found`)
      if (target.entityType !== 'clinical_section') {
        // revertSection only handles Module A's clinical_section rows; other
        // entity types revert through app.editHistory.revert() with their own
        // handlers registered in the EditHistory plugin.
        throw new Error(`wrong_entity_type:${target.entityType}`)
      }
      if (target.beforeHtml === null) {
        throw new Error('cannot_revert_no_snapshot')
      }
      if (!target.documentId || !target.sectionId) {
        throw new Error('cannot_revert_no_section_scope')
      }

      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${target.documentId}))`

      const doc = await tx.document.findUnique({
        where: { id: target.documentId },
        include: { currentVersion: { include: { sections: true } } },
      })
      if (!doc?.currentVersion) throw new Error('document_not_found')

      // Only sanction a revert when the section is still on the version the
      // edit was made on — crossing versions would require merging the
      // reverted content into a new section snapshot, out of scope here.
      if (target.documentVersionId !== doc.currentVersionId) {
        throw new Error('cannot_revert_cross_version')
      }
      // Safety net: never clobber signed content.
      const sealed = await isVersionSealed(tx, doc.id, doc.currentVersion.versionNumber)
      if (sealed) {
        throw new Error('cannot_revert_sealed_version')
      }

      const sectionRow = doc.currentVersion.sections.find(s => s.sectionId === target.sectionId)
      if (!sectionRow) throw new Error('section_not_found')

      const previousHtml = sectionRow.contentHtml ?? ''
      await tx.sectionContent.update({
        where: { documentVersionId_sectionId: { documentVersionId: doc.currentVersionId!, sectionId: target.sectionId } },
        data: {
          contentHtml:  target.beforeHtml,
          lastEditedBy: args.editorUserId,
          lastEditedAt: new Date(),
        },
      })

      // Recompute hash so Part 11 re-verification sees the real content.
      const nextSections: SectionPayload[] = doc.currentVersion.sections.map(s =>
        s.sectionId === target.sectionId
          ? { sectionId: s.sectionId, sectionNumber: s.sectionNumber, sectionTitle: s.sectionTitle, contentHtml: target.beforeHtml!, ichStatus: s.ichStatus }
          : { sectionId: s.sectionId, sectionNumber: s.sectionNumber, sectionTitle: s.sectionTitle, contentHtml: s.contentHtml, ichStatus: s.ichStatus },
      )
      await tx.documentVersion.update({
        where: { id: doc.currentVersionId! },
        data:  { contentHash: hashSections(nextSections) },
      })

      await tx.editHistory.create({
        data: {
          entityType:        'clinical_section',
          entityId:          target.documentId,
          subUnitId:         target.sectionId,
          documentId:        target.documentId,
          sectionId:         target.sectionId,
          documentVersionId: doc.currentVersionId!,
          actorId:           args.editorUserId,
          origin:            'undo',
          beforeHtml:        previousHtml,
          afterHtml:         target.beforeHtml,
          revertedFromId:    target.id,
        },
      })

      return {
        documentId:  target.documentId,
        sectionId:   target.sectionId,
        contentHtml: target.beforeHtml,
      }
    })
  }

  /**
   * Explicit "Create new version" — snapshot the current version's full
   * section set into a brand-new DocumentVersion row. Used by the Save
   * Checkpoint button and by the transition endpoint when a document
   * returns to in_authoring from any review state.
   *
   * `restoreSource` captures *why* the version was created so the audit
   * trail + version-history UI can distinguish user-initiated snapshots
   * from review-bounce auto-snapshots.
   */
  async createVersionSnapshot(args: {
    documentId: string
    createdBy: string
    label?: 'Draft' | 'For Review' | 'Final'
    reason: 'explicit' | 'review_bounce' | 'crm_bounce' | 'signature_bounce'
    note?: string
  }) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${args.documentId}))`

      const doc = await tx.document.findUnique({
        where: { id: args.documentId },
        include: { currentVersion: { include: { sections: true } } },
      })
      if (!doc?.currentVersion) throw new Error(`Document ${args.documentId} not found or has no current version`)

      const current = doc.currentVersion
      const allVersions = await tx.documentVersion.findMany({
        where: { documentId: doc.id },
        select: { versionNumber: true },
      })
      const nextVersionNumber = bumpVersion(highestVersion(allVersions.map(v => v.versionNumber), current.versionNumber))

      await tx.documentVersion.updateMany({
        where: { documentId: doc.id, isCurrent: true },
        data: { isCurrent: false },
      })

      const nextVersion = await tx.documentVersion.create({
        data: {
          documentId:   doc.id,
          versionNumber: nextVersionNumber,
          label:        args.label ?? 'Draft',
          contentHash:  current.contentHash,
          isCurrent:    true,
          createdBy:    args.createdBy,
          restoreSource: {
            reason: args.reason,
            note:   args.note ?? null,
            fromVersionId: current.id,
            fromVersionNumber: current.versionNumber,
          } as object,
          sections: {
            create: current.sections.map(s => ({
              sectionId:     s.sectionId,
              sectionNumber: s.sectionNumber,
              sectionTitle:  s.sectionTitle,
              contentHtml:   s.contentHtml,
              ichStatus:     s.ichStatus,
              wordCount:     s.wordCount,
              lastEditedBy:  s.lastEditedBy,
              lastEditedAt:  s.lastEditedAt,
              aiSpanCount:   s.aiSpanCount,
              humanSpanCount: s.humanSpanCount,
            })),
          },
        },
      })

      await tx.document.update({
        where: { id: doc.id },
        data:  { currentVersionId: nextVersion.id },
      })

      return { document: doc, version: nextVersion, created: true, mutated: false }
    })
  }
}

// --- helpers --------------------------------------------------------------

/**
 * A version is "sealed" when any signature record is marked signed against
 * the version's versionNumber (e-sig binds to DocumentVersion.contentHash
 * via SignatureRecord.versionAtSigning). Edits can't mutate a sealed
 * version in place without invalidating that hash. Normal state-machine
 * flow blocks edits in pending_signature/signed, so this guard is
 * defensive only.
 */
async function isVersionSealed(
  tx: PrismaTxLike,
  documentId: string,
  versionNumber: string,
): Promise<boolean> {
  const signed = await tx.signatureRecord.findFirst({
    where: {
      status:          'signed',
      versionAtSigning: versionNumber,
      chain:           { documentId },
    },
    select: { id: true },
  })
  return !!signed
}

/**
 * Safety-net branch of updateSection — when the current version is sealed,
 * fall back to the legacy "new version per edit" behavior. Keeps signed
 * content immutable. Not reached under normal state-machine flow.
 */
async function createNewVersionFromEdit(
  tx: PrismaTxLike,
  ctx: {
    doc: { id: string; status: string } & Record<string, unknown>
    current: {
      id: string
      versionNumber: string
      sections: Array<{ sectionId: string; sectionNumber: string; sectionTitle: string; contentHtml: string; ichStatus: string }>
    }
    args: {
      documentId: string
      sectionId: string
      sectionNumber?: string
      sectionTitle?: string
      contentHtml: string
      editorUserId: string
      aiDrafted?: boolean
      aiModel?: string
      sourceRef?: string
    }
  },
) {
  const { doc, current, args } = ctx
  const nextSections: SectionPayload[] = current.sections.map(s =>
    s.sectionId === args.sectionId
      ? { sectionId: s.sectionId, sectionNumber: args.sectionNumber ?? s.sectionNumber, sectionTitle: args.sectionTitle ?? s.sectionTitle, contentHtml: args.contentHtml, ichStatus: 'in_progress' }
      : { sectionId: s.sectionId, sectionNumber: s.sectionNumber, sectionTitle: s.sectionTitle, contentHtml: s.contentHtml, ichStatus: s.ichStatus },
  )
  if (!current.sections.find(s => s.sectionId === args.sectionId)) {
    nextSections.push({ sectionId: args.sectionId, sectionNumber: args.sectionNumber ?? args.sectionId, sectionTitle: args.sectionTitle ?? args.sectionId, contentHtml: args.contentHtml, ichStatus: 'in_progress' })
  }
  const allVersions = await tx.documentVersion.findMany({
    where: { documentId: doc.id },
    select: { versionNumber: true },
  })
  const nextVersionNumber = bumpVersion(highestVersion(allVersions.map(v => v.versionNumber), current.versionNumber))
  const nextHash = hashSections(nextSections)

  await tx.documentVersion.updateMany({
    where: { documentId: doc.id, isCurrent: true },
    data:  { isCurrent: false },
  })

  const nextVersion = await tx.documentVersion.create({
    data: {
      documentId:   doc.id,
      versionNumber: nextVersionNumber,
      label:        'Draft',
      contentHash:  nextHash,
      isCurrent:    true,
      createdBy:    args.editorUserId,
      sections: {
        create: nextSections.map(s => ({
          sectionId:    s.sectionId,
          sectionNumber: s.sectionNumber,
          sectionTitle:  s.sectionTitle,
          contentHtml:   s.contentHtml,
          ichStatus:     s.ichStatus ?? 'in_progress',
          wordCount:     countWords(s.contentHtml),
          lastEditedBy:  s.sectionId === args.sectionId ? args.editorUserId : null,
          lastEditedAt:  s.sectionId === args.sectionId ? new Date() : null,
          aiSpanCount:   s.sectionId === args.sectionId && args.aiDrafted ? 1 : 0,
          humanSpanCount: s.sectionId === args.sectionId && !args.aiDrafted ? 1 : 0,
        })),
      },
    },
  })

  await tx.document.update({
    where: { id: doc.id },
    data: {
      currentVersionId: nextVersion.id,
      status: doc.status === 'not_started' ? 'in_authoring' : doc.status,
    },
  })

  if (args.aiDrafted) {
    await tx.provenanceRecord.create({
      data: {
        documentVersionId: nextVersion.id,
        sectionId:    args.sectionId,
        spanId:       `${args.sectionId}#${Date.now()}`,
        spanText:     stripHtml(args.contentHtml),
        sourceType:   'ai_draft',
        sourceRef:    args.sourceRef ?? null,
        aiModel:      args.aiModel  ?? null,
        aiGeneratedAt: new Date(),
        acceptedBy:   args.editorUserId,
        acceptedAt:   new Date(),
      },
    })
  }

  return { document: doc, version: nextVersion, created: true, mutated: false }
}

type PrismaTxLike = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0]

/**
 * Natural order for sections: "§2" < "§10" < "§11" < "§11.4" < "§16.1".
 * Labels with no number (DSUR "ES" / "TOC") sort first, matching how those
 * documents open; ties fall back to the stable section key.
 */
export function compareSections(
  a: { sectionNumber: string; sectionId: string },
  b: { sectionNumber: string; sectionId: string },
): number {
  const parts = (n: string) => (n.match(/\d+(?:\.\d+)*/)?.[0] ?? '').split('.').filter(Boolean).map(Number)
  const pa = parts(a.sectionNumber)
  const pb = parts(b.sectionNumber)
  if (pa.length === 0 || pb.length === 0) {
    if (pa.length !== pb.length) return pa.length === 0 ? -1 : 1
  }
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? -1
    const y = pb[i] ?? -1
    if (x !== y) return x - y
  }
  return a.sectionId.localeCompare(b.sectionId)
}

/** Highest "vMAJOR.MINOR" label in `labels`, or `fallback` if none parse. */
export function highestVersion(labels: string[], fallback: string): string {
  let best: [number, number] | null = null
  let bestLabel = fallback
  for (const l of labels) {
    const m = l.match(/^v(\d+)\.(\d+)$/)
    if (!m) continue
    const cand: [number, number] = [Number(m[1]), Number(m[2])]
    if (!best || cand[0] > best[0] || (cand[0] === best[0] && cand[1] > best[1])) {
      best = cand
      bestLabel = l
    }
  }
  return bestLabel
}

function bumpVersion(v: string): string {
  // Simple "v0.N" ladder for Phase 3A. Cross-major jumps (v1.0 → v1.1) land
  // when the signature chain lifecycle takes over version numbering.
  const match = v.match(/^v(\d+)\.(\d+)$/)
  if (!match) return `${v}.1`
  const [, major, minor] = match
  return `v${major}.${Number(minor) + 1}`
}

function countWords(html: string): number {
  const text = stripHtml(html)
  if (!text.trim()) return 0
  return text.trim().split(/\s+/).length
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}
