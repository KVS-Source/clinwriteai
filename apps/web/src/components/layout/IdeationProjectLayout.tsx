import { Outlet, useParams } from 'react-router-dom'
import { SubNav, type SubNavTab } from '../ui/SubNav'

export function IdeationProjectLayout() {
  const { projectId, ideationProjectId } = useParams()
  const base = `/projects/${projectId}/ideation-publishing/projects/${ideationProjectId}`

  const tabs: SubNavTab[] = [
    { to: base,                    label: 'Upload & Source', end: true },
    { to: `${base}/tagging`,       label: 'Content Cards' },
    { to: `${base}/compliance`,    label: 'Pre-Review Compliance' },
    { to: `${base}/ma-approval`,   label: 'MA Approval' },
    { to: `${base}/standards`,     label: 'Standards & DOI' },
    { to: `${base}/final`,         label: 'Final Output' },
  ]

  return (
    <div className="flex h-full flex-col">
      <SubNav tabs={tabs} label="Ideation project navigation" />
      <div className="flex-1 overflow-auto">
        <Outlet />
      </div>
    </div>
  )
}
