import { Outlet, useParams } from 'react-router-dom'
import { SubNav, type SubNavTab } from '../ui/SubNav'

export function DocumentLayout() {
  const { projectId, documentId } = useParams()
  const base = `/projects/${projectId}/clinical-writing/documents/${documentId}`

  const tabs: SubNavTab[] = [
    { to: base,             label: 'Editor',      end: true },
    { to: `${base}/diff`,   label: 'Version Diff' },
    { to: `${base}/review`, label: 'Reviewer View' },
    { to: `${base}/sign`,   label: 'E-Signature' },
    { to: `${base}/final`,  label: 'Final Document' },
  ]

  return (
    <div className="flex h-full flex-col">
      <SubNav tabs={tabs} label="Document navigation" />
      <div className="flex-1 overflow-auto">
        <Outlet />
      </div>
    </div>
  )
}
