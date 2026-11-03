// Target-journal catalogue — read-only reference data for the
// JournalSubmissionReadiness screen. Backed by GET /journals.
//
// Replaces the inline JOURNALS object that used to live in
// JournalSubmissionReadiness.tsx. Prefer this module over sibling api/
// files for forward growth (icmje filters, scope filters, etc).

import { api } from './client'
import type { Journal } from '@platform/types'

export interface ListJournalsFilters {
  scope?: string
  icmje?: boolean
}

export const journalsApi = {
  list: (filters: ListJournalsFilters = {}) => {
    const qs = new URLSearchParams()
    if (filters.scope) qs.set('scope', filters.scope)
    if (filters.icmje !== undefined) qs.set('icmje', filters.icmje ? 'true' : 'false')
    const suffix = qs.toString() ? `?${qs}` : ''
    return api.get<Journal[]>(`/journals${suffix}`)
  },
}
