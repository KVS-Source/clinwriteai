import { Outlet, useParams } from 'react-router-dom'
import { SubNav, type SubNavTab } from '../ui/SubNav'

export function ContentLayout() {
  const { projectId, contentId } = useParams()
  const base = `/projects/${projectId}/medical-writing/content/${contentId}`

  const tabs: SubNavTab[] = [
    { to: base,                  label: 'Briefing',     end: true },
    { to: `${base}/editor`,      label: 'Editor' },
    { to: `${base}/pre-mlr`,     label: 'Pre-MLR Check' },
    { to: `${base}/mlr-review`,  label: 'MLR Review' },
    { to: `${base}/formatting`,  label: 'Formatting' },
    { to: `${base}/final`,       label: 'Final Output' },
  ]

  return (
    <div className="flex h-full flex-col">
      <SubNav tabs={tabs} label="Content navigation" />
      <div className="flex-1 overflow-auto">
        <Outlet />
      </div>
    </div>
  )
}
