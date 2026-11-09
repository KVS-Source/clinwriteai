// The content hash of a version and the order its sections are stored in — kept in one small file so the
// restore worker and its test can share it.
//
// hashSections MUST give the same answer as hashSections in
// apps/api/src/modules/clinical-writing/documents/service.ts (same sort, same separators): a signature binds to
// that hash, so if the two ever differ, a restored version's stored hash disagrees with the one the app computes.
// apps/api/src/modules/clinical-writing/documents/section-hash-parity.test.ts checks they match.

import { createHash } from 'node:crypto'

export interface HashableSection { sectionId: string; contentHtml: string }

export function hashSections(sections: ReadonlyArray<HashableSection>): string {
  const sorted = [...sections].sort((a, b) => a.sectionId.localeCompare(b.sectionId))
  const h = createHash('sha256')
  for (const s of sorted) {
    h.update(s.sectionId, 'utf8')
    h.update('\u0001', 'utf8')
    h.update(s.contentHtml, 'utf8')
    h.update('\u0002', 'utf8')
  }
  return h.digest('hex')
}

/** The order sections are stored and shown in: numeric-aware, so s2 comes before s10 (a text sort gives s1, s10, s11, …, s2). */
export function inDocumentOrder<T extends { sectionId: string }>(sections: ReadonlyArray<T>): T[] {
  return [...sections].sort((a, b) => a.sectionId.localeCompare(b.sectionId, undefined, { numeric: true }))
}
