import { Outlet, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { SubNav, type SubNavTab } from '../ui/SubNav'
import { documentsApi } from '../../api/documents'

// Tab-level read-only lockdown per docs/roles-and-permissions.md §11.3
// stage transitions:
//
//   status = 'pending-signature' (A gate reached — "Approved" in UX)
//     Editor, Version Diff, Reviewer View all disabled. E-Signature is
//     the active tab; Final Document remains viewable.
//
//   status = 'signed'
//     Editor, Version Diff, Reviewer View stay disabled. E-Signature stays
//     open as the read-only record of who signed (inspected later, e.g. by an
//     auditor); Final Document is the read-only snapshot of the document.
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
    return { editor: true, diff: true, review: true, sign: false }
  }
  if (status === 'pending-signature') {
    return { editor: true, diff: true, review: true, sign: false }
  }
  return { editor: false, diff: false, review: false, sign: false }
}

export function DocumentLayout() {
  const { projectId, documentId } = useParams()
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
    { to: `${base}/sign`,   label: 'E-Signature',                disabled: d.sign },
    { to: `${base}/final`,  label: 'Final Document' },
  ]

  // The signed-in user's RACI role chip lives in each tab's own title row
  // (MyRaciRole), next to the document's status.
  return (
    <div className="flex h-full flex-col">
      <SubNav tabs={tabs} label="Document navigation" />
      <div className="flex-1 overflow-auto">
        <Outlet />
      </div>
    </div>
  )
}
