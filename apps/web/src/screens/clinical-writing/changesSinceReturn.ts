// What changed since the document was last sent back to authoring: the next round's Reviewers and
// Approvers read the whole document with those changes highlighted (Reviewer View / Approver View).

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { Document } from '@platform/types'
import { documentsApi, type ReturnBaseline } from '../../api/documents'

const IN_ROUND = new Set(['in-review', 'crm-in-progress', 'pending-signature'])

export interface ChangesSinceReturn {
  baseline: ReturnBaseline
  /** The returned version's text per section; undefined for a section added since. */
  before: Map<string, string>
  changedIds: string[]
  removedTitles: string[]
}

export function compareToBaseline(
  baseline: ReturnBaseline,
  sections: ReadonlyArray<{ id: string; contentHtml?: string | null }>,
): ChangesSinceReturn {
  const before = new Map(baseline.sections.map(s => [s.sectionId, s.contentHtml ?? '']))
  const now = new Set(sections.map(s => s.id))
  return {
    baseline,
    before,
    changedIds:    sections.filter(s => (before.get(s.id) ?? '') !== (s.contentHtml ?? '')).map(s => s.id),
    removedTitles: baseline.sections.filter(s => !now.has(s.sectionId)).map(s => `${s.sectionNumber} ${s.sectionTitle}`.trim()),
  }
}

/** null on a first round, outside review / signing, or while loading. */
export function useChangesSinceReturn(document: Document | undefined): ChangesSinceReturn | null {
  const { data } = useQuery({
    queryKey: ['changes-since-return', document?.id, document?.version],
    queryFn:  () => documentsApi.getChangesSinceReturn(document!.id),
    enabled:  !!document && IN_ROUND.has(document.status),
    retry:    false,
  })
  const baseline = data?.baseline ?? null
  const inRound = !!document && IN_ROUND.has(document.status)
  const sections = document?.sections
  return useMemo(
    () => (inRound && baseline && sections ? compareToBaseline(baseline, sections) : null),
    [inRound, baseline, sections],
  )
}
