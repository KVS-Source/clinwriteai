import { Outlet, useLocation, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { SubNav, type SubNavTab } from '../ui/SubNav'
import { documentsApi } from '../../api/documents'
import { MyRaciRole } from '../../screens/clinical-writing/MyRaciRole'

// Tab-level read-only lockdown per docs/roles-and-permissions.md §11.3
// stage transitions:
//
//   status = 'pending-signature' (A gate reached — "Approved" in UX)
//     Editor, Version Diff, Reviewer View all disabled. E-Signature is
//     the active tab; Final Document remains viewable.
//
//   status = 'signed'
//     Everything above PLUS E-Signature disabled. Only Final Document
//     is reachable — it's a read-only snapshot of the signed record.
//
// A disabled tab renders greyed-out + title tooltip; the user can still
// deep-link to the URL, but the client code should refuse the action.
// SubNav styling matches the aria-disabled contract.
function tabDisablesFor(status: string | undefined): {
  editor: boolean
  diff:   boolean
  review: boolean
  sign:   boolean
} {
  if (status === 'signed') {
    return { editor: true, diff: true, review: true, sign: true }
  }
  if (status === 'pending-signature') {
    return { editor: true, diff: true, review: true, sign: false }
  }
  return { editor: false, diff: false, review: false, sign: false }
}

export function DocumentLayout() {
  const { projectId, documentId } = useParams()
  const { pathname } = useLocation()
  const base = `/projects/${projectId}/clinical-writing/documents/${documentId}`

  // Cheap doc fetch to drive the tab lockdown. Cached under the shared
  // ['document', id] key other panels already use so the status flips in
  // sync when the Approve / Sign flow writes.
  const docQuery = useQuery({
    queryKey: ['document', documentId],
    queryFn:  () => documentsApi.get(documentId!),
    enabled:  !!documentId,
    staleTime: 10_000,
  })
  const status = docQuery.data?.status
  const d = tabDisablesFor(status)

  const lockReason =
    status === 'signed' ? 'The document is signed and read-only.'
    : status === 'pending-signature' ? 'The document is awaiting signature — editing is disabled until the signatory finishes.'
    : undefined

  const tabs: SubNavTab[] = [
    { to: base,             label: 'Editor',         end: true, disabled: d.editor, title: d.editor ? lockReason : undefined },
    { to: `${base}/diff`,   label: 'Version Diff',               disabled: d.diff,   title: d.diff   ? lockReason : undefined },
    { to: `${base}/review`, label: 'Reviewer View',              disabled: d.review, title: d.review ? lockReason : undefined },
    { to: `${base}/crm`,    label: 'CRM' },
    { to: `${base}/sign`,   label: 'E-Signature',                disabled: d.sign,   title: d.sign   ? 'The document is signed; the signature step is complete.' : undefined },
    { to: `${base}/final`,  label: 'Final Document' },
  ]

  // The Editor shows the signed-in user's RACI role in its own title row; every
  // other tab gets it at the right of the tab bar.
  const onEditor = pathname.replace(/\/$/, '') === base

  return (
    <div className="flex h-full flex-col">
      <div className="relative">
        <SubNav tabs={tabs} label="Document navigation" />
        {documentId && !onEditor && (
          <div className="absolute inset-y-0 right-6 flex items-center bg-white pl-3">
            <MyRaciRole documentId={documentId} />
          </div>
        )}
      </div>
      <div className="flex-1 overflow-auto">
        <Outlet />
      </div>
    </div>
  )
}
