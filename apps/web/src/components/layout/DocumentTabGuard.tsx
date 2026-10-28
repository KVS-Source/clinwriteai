// DocumentTabGuard — redirects deep-links to disabled tabs back to the
// Final Document view. Pairs with the subnav lockdown in
// DocumentLayout.tsx: once a doc is pending-signature ("Approved") the
// Editor / Version Diff / Reviewer View tabs are UI-greyed, but a
// bookmark or shared URL still renders the page in a half-locked state.
// This component short-circuits that path with a Navigate so the user
// lands on the one tab that's definitely safe for every status.
//
// Usage: wrap a tab's element in the router:
//
//   { path: 'review', element: <DocumentTabGuard tab="review"><ReviewerView /></DocumentTabGuard> }
//
// Lockdown rules mirror DocumentLayout's tabDisablesFor:
//   status = 'pending-signature' → editor / diff / review are 404'd
//   status = 'signed'            → above + sign is 404'd
//
// We render nothing while the document fetch is pending (short — the
// shared ['document', id] cache usually has it already). On fetch
// error we fall through to the child; the child will handle its own
// error-state.

import { Navigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { documentsApi } from '../../api/documents'

export type GuardedTab = 'editor' | 'diff' | 'review' | 'sign'

interface Props {
  tab: GuardedTab
  children: React.ReactNode
}

function isDisabled(tab: GuardedTab, status: string | undefined): boolean {
  if (status === 'signed') return tab !== 'sign' ? true : true
  if (status === 'pending-signature') return tab === 'editor' || tab === 'diff' || tab === 'review'
  return false
}

export function DocumentTabGuard({ tab, children }: Props) {
  const { projectId, documentId } = useParams<{ projectId: string; documentId: string }>()
  const docQuery = useQuery({
    queryKey: ['document', documentId],
    queryFn:  () => documentsApi.get(documentId!),
    enabled:  !!documentId,
    staleTime: 10_000,
  })

  // While loading we render nothing to avoid a flash of the editor
  // followed by a redirect. If the fetch errors (e.g. 404 on the doc
  // itself) we fall through — the child's own error UI handles it.
  if (docQuery.isLoading) return null
  if (!docQuery.data)     return <>{children}</>

  if (isDisabled(tab, docQuery.data.status)) {
    const final = `/projects/${projectId}/clinical-writing/documents/${documentId}/final`
    return <Navigate to={final} replace />
  }
  return <>{children}</>
}
