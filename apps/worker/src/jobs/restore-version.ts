// Module A version restore worker — picks up a pending
// VersionRestoreJob and does the actual section-level copy.
//
// Flow:
//   1. Load the job + source document + its current version + sections.
//   2. For each (sectionId, fromVersionId) in job.sectionsRestored:
//        - Load the fromVersion's section_contents row for that sectionId
//        - Replace the current version's section with that content
//   3. Compute per-section diffs (via diff-match-patch) for the audit trail.
//   4. Create a new DocumentVersion with the merged section set:
//        - versionNumber bumped (v0.N → v0.N+1)
//        - restoreSource populated with {fromVersionId, sections, diffs}
//        - current flipped: old version isCurrent=false, new one true
//        - content_hash recomputed on the merged set
//   5. Flip VersionRestoreJob to 'complete' with createdVersionId set.
//
// Idempotency: if the job is already 'complete', the handler returns the
// existing createdVersionId without re-doing the work. BullMQ retries use
// the same jobId; this guard means we never create duplicate versions.

import { diff_match_patch } from 'diff-match-patch'
import { createHash } from 'node:crypto'
import type { JobHandler } from './types.js'

interface RestoreJobPayload {
  jobId: string
  documentId: string
  actorId: string
}

export const handleRestoreVersion: JobHandler<RestoreJobPayload> = async (job, { prisma, log }) => {
  const { jobId, documentId, actorId } = job.data

  const restore = await prisma.versionRestoreJob.findUnique({ where: { id: jobId } })
  if (!restore) throw new Error(`VersionRestoreJob ${jobId} not found`)
  if (restore.status === 'complete') {
    log.info({ jobId, createdVersionId: restore.createdVersionId }, 'restore already complete — idempotent return')
    return { createdVersionId: restore.createdVersionId }
  }

  const doc = await prisma.document.findUnique({
    where: { id: documentId },
    include: { currentVersion: { include: { sections: true } } },
  })
  if (!doc || !doc.currentVersion) throw new Error(`Document ${documentId} has no current version`)

  const requested = restore.sectionsRestored as unknown as Array<{ sectionId: string; fromVersionId: string }>
  if (!Array.isArray(requested) || requested.length === 0) {
    throw new Error(`VersionRestoreJob ${jobId} has no sections to restore`)
  }

  // Fetch the source sections one tx so we never see a half-applied source
  // version mid-restore.
  const sourceVersions = await prisma.documentVersion.findMany({
    where: {
      id: { in: Array.from(new Set(requested.map(s => s.fromVersionId))) },
      documentId,                                                       // same-document safeguard
    },
    include: { sections: true },
  })
  const sourceMap = new Map(sourceVersions.map(v => [v.id, v]))
  for (const r of requested) {
    if (!sourceMap.has(r.fromVersionId)) {
      throw new Error(`VersionRestoreJob ${jobId}: fromVersionId ${r.fromVersionId} not found on document ${documentId}`)
    }
  }

  const dmp = new diff_match_patch()
  const perSectionDiffs: Array<{ sectionId: string; fromVersion: string; diffSummary: { adds: number; dels: number; equals: number } }> = []

  // Build the merged section set: current state, with the requested
  // sections replaced from the source version. Record a diff summary.
  const currentById = new Map(doc.currentVersion.sections.map(s => [s.sectionId, s]))
  for (const r of requested) {
    const source = sourceMap.get(r.fromVersionId)!
    const sourceSection = source.sections.find(s => s.sectionId === r.sectionId)
    if (!sourceSection) {
      throw new Error(`Section ${r.sectionId} not present in version ${r.fromVersionId}`)
    }
    const current = currentById.get(r.sectionId)
    const diffs = dmp.diff_main(current?.contentHtml ?? '', sourceSection.contentHtml)
    dmp.diff_cleanupSemantic(diffs)
    const summary = diffs.reduce(
      (acc, [op]) => {
        if (op === 1) acc.adds++
        else if (op === -1) acc.dels++
        else acc.equals++
        return acc
      },
      { adds: 0, dels: 0, equals: 0 },
    )
    perSectionDiffs.push({ sectionId: r.sectionId, fromVersion: source.versionNumber, diffSummary: summary })

    currentById.set(r.sectionId, {
      ...(current ?? {
        id: '',
        documentVersionId: '',
        sectionId: r.sectionId,
        wordCount: 0,
        aiSpanCount: 0,
        humanSpanCount: 0,
        lastEditedBy: null,
        lastEditedAt: null,
      } as typeof sourceSection),
      sectionNumber: sourceSection.sectionNumber,
      sectionTitle: sourceSection.sectionTitle,
      contentHtml: sourceSection.contentHtml,
      ichStatus: sourceSection.ichStatus,
    })
  }

  const mergedSections = Array.from(currentById.values()).sort((a, b) => a.sectionId.localeCompare(b.sectionId))

  // Hash the merged content (same algorithm as DocumentService.hashSections —
  // keep in sync; if they diverge, the e-sig chain breaks).
  const hash = createHash('sha256')
  for (const s of mergedSections) {
    hash.update(s.sectionId, 'utf8'); hash.update('', 'utf8')
    hash.update(s.contentHtml, 'utf8'); hash.update('', 'utf8')
  }
  const contentHash = hash.digest('hex')

  const nextVersionNumber = bumpVersion(doc.currentVersion.versionNumber)

  // Everything under one tx so the "flip current + create new" is atomic.
  const newVersionId = await prisma.$transaction(async (tx) => {
    await tx.documentVersion.update({
      where: { id: doc.currentVersion!.id },
      data: { isCurrent: false },
    })
    const newVersion = await tx.documentVersion.create({
      data: {
        documentId,
        versionNumber: nextVersionNumber,
        label: 'Draft',
        contentHash,
        isCurrent: true,
        createdBy: actorId,
        restoreSource: {
          jobId,
          sections: requested,
          diffs: perSectionDiffs,
        } as unknown as object,
        sections: {
          create: mergedSections.map(s => ({
            sectionId: s.sectionId,
            sectionNumber: s.sectionNumber,
            sectionTitle: s.sectionTitle,
            contentHtml: s.contentHtml,
            ichStatus: s.ichStatus,
            wordCount: countWords(s.contentHtml),
          })),
        },
      },
    })
    await tx.document.update({
      where: { id: documentId },
      data: { currentVersionId: newVersion.id },
    })
    await tx.versionRestoreJob.update({
      where: { id: jobId },
      data: {
        status: 'complete',
        createdVersionId: newVersion.id,
        completedAt: new Date(),
      },
    })
    return newVersion.id
  })

  log.info({ jobId, createdVersionId: newVersionId, sections: requested.length }, 'version restore complete')
  return { createdVersionId: newVersionId, sections: requested.length }
}

function bumpVersion(v: string): string {
  const m = v.match(/^v(\d+)\.(\d+)$/)
  if (!m) return `${v}.1`
  return `v${m[1]}.${Number(m[2]) + 1}`
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

function countWords(html: string): number {
  const text = stripHtml(html)
  return text ? text.split(/\s+/).length : 0
}
