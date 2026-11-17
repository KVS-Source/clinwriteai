// The project-level CRM (the sidebar's "CRM" link and its page) follows the document tabs' rule
// (useDocumentTabAccess): an Approver-only person (A and not also Author, Reviewer or QC) has no CRM.
// A document where the user holds no letter (a PM, an admin) keeps its CRM, as before.

import { useQuery } from '@tanstack/react-query'
import type { Document } from '@platform/types'
import { documentsApi } from '../api'
import { tabAccessForLetters } from './useDocumentTabAccess'

/** Whether the signed-in user gets the CRM for this document, from its myRaci letters. */
export function documentHasCrmForMe(doc: Pick<Document, 'myRaci'>): boolean {
  const letters = doc.myRaci ?? []
  return letters.length === 0 || tabAccessForLetters(new Set(letters)).crm
}

/** Show the sidebar's CRM link: true until the documents have loaded, then only if any document has a CRM for me. */
export function useShowProjectCrm(projectId: string | undefined, enabled: boolean): boolean {
  const { data: docs, isSuccess } = useQuery({
    queryKey: ['documents', projectId],
    queryFn:  () => documentsApi.list(projectId!),
    enabled:  enabled && !!projectId,
  })
  if (!enabled || !isSuccess) return true
  return (docs ?? []).length === 0 || (docs ?? []).some(documentHasCrmForMe)
}
