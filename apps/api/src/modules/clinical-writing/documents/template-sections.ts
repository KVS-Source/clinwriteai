// A document's starter sections: the empty headings of its type's template. Given to every new document,
// and to an older one that was created without them, through POST /documents/:id/apply-template or
// scripts/backfill-template-sections.ts. Only empty headings are added, to the current version, and only
// when it has no sections at all, so no content can be overwritten.

import type { PrismaClient } from '@prisma/client'
import { hashSections } from './service.js'
import { templateSections, templateSectionsFromRow } from './templates.js'
import type { SectionPayload } from './service.js'

// The DB-backed template when there is a usable one (platform-managed, admin-editable), else the built-in
// skeleton. A failed lookup (a DB without the table) falls back too, rather than failing the whole action.
export async function resolveTemplateSections(
  prisma: PrismaClient,
  type: string,
  submissionCountries: readonly string[],
  onLookupError?: (err: unknown) => void,
): Promise<SectionPayload[]> {
  let row: { sections: unknown } | null = null
  try {
    row = await prisma.documentTemplate.findFirst({
      where: { type, isCurrent: true, retiredAt: null },
      select: { sections: true },
    })
  } catch (err) {
    onLookupError?.(err)
  }
  const fromRow = row ? templateSectionsFromRow(row.sections, submissionCountries) : []
  return fromRow.length > 0 ? fromRow : templateSections(type, submissionCountries)
}

// The two statuses whose content is bound to signatures. Their hash must never move.
export const SIGNATURE_BOUND_STATUSES: ReadonlySet<string> = new Set(['pending_signature', 'signed'])

/**
 * Adds the sections to a version that has none. Returns how many were added and the version's new hash,
 * or null if it already has sections by the time the transaction runs (someone got there first).
 */
export async function addTemplateSections(
  prisma: PrismaClient,
  versionId: string,
  sections: SectionPayload[],
): Promise<{ sectionCount: number; contentHash: string } | null> {
  return prisma.$transaction(async (tx) => {
    if ((await tx.sectionContent.count({ where: { documentVersionId: versionId } })) > 0) return null
    await tx.sectionContent.createMany({
      data: sections.map(s => ({
        documentVersionId: versionId,
        sectionId: s.sectionId,
        sectionNumber: s.sectionNumber,
        sectionTitle: s.sectionTitle,
        contentHtml: s.contentHtml,
        ichStatus: s.ichStatus ?? 'not_started',
      })),
    })
    const contentHash = hashSections(sections)
    await tx.documentVersion.update({ where: { id: versionId }, data: { contentHash } })
    return { sectionCount: sections.length, contentHash }
  })
}
