// The project-level CRM (the sidebar's "CRM" link and its page) follows the document tabs' rule
// (useDocumentTabAccess): an Approver-only person (A and not also Author, Reviewer or QC) has no CRM.
// A document where the user holds no letter (a PM, an admin) keeps its CRM, as before. An Approver
// invited to a scheduled or running meeting on the document has its CRM while that meeting is open.
// Someone working as Project Manager keeps the CRM even where they are the Approver (e.g. a second PM).

import { useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { Document } from '@platform/types'
import { documentsApi } from '../api'
import { holdsRole } from '../config/roles'
import { tabAccessForLetters } from './useDocumentTabAccess'
import { useCurrentUser } from './useCurrentUser'

/** Whether the signed-in user gets the CRM for this document, from its myRaci letters (and whether they work as PM). */
export function documentHasCrmForMe(doc: Pick<Document, 'myRaci' | 'myCrmInvite'>, isPm = false): boolean {
  const letters = doc.myRaci ?? []
  return letters.length === 0 || doc.myCrmInvite === true || tabAccessForLetters(new Set(letters), { pm: isPm }).crm
}

/** documentHasCrmForMe for the signed-in user, ready to pass to Array.filter. */
export function useDocumentHasCrmForMe(): (doc: Pick<Document, 'myRaci' | 'myCrmInvite'>) => boolean {
  const { data: me } = useCurrentUser()
  const isPm = !!me && holdsRole(me, 'pm')
  return useCallback((doc: Pick<Document, 'myRaci' | 'myCrmInvite'>) => documentHasCrmForMe(doc, isPm), [isPm])
}

/** Show the sidebar's CRM link: true until the documents have loaded, then only if any document has a CRM for me. */
export function useShowProjectCrm(projectId: string | undefined, enabled: boolean): boolean {
  const hasCrm = useDocumentHasCrmForMe()
  const { data: docs, isSuccess } = useQuery({
    queryKey: ['documents', projectId],
    queryFn:  () => documentsApi.list(projectId!),
    enabled:  enabled && !!projectId,
  })
  if (!enabled || !isSuccess) return true
  return (docs ?? []).length === 0 || (docs ?? []).some(hasCrm)
}
