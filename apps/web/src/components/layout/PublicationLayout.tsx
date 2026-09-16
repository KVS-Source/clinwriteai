import { Outlet, useParams } from 'react-router-dom'
import { SubNav, type SubNavTab } from '../ui/SubNav'

export function PublicationLayout() {
  const { projectId, publicationId } = useParams()
  const base = `/projects/${projectId}/scientific-writing/publications/${publicationId}`

  const tabs: SubNavTab[] = [
    { to: base,                        label: 'Manuscript',          end: true },
    { to: `${base}/authors`,           label: 'Authors' },
    { to: `${base}/submission`,        label: 'Submission Readiness' },
    { to: `${base}/peer-review`,       label: 'Peer Review' },
    { to: `${base}/congress-export`,   label: 'Congress Export' },
    { to: `${base}/slides`,            label: 'Slide Deck' },
    { to: `${base}/final`,             label: 'Final Output' },
  ]

  return (
    <div className="flex h-full flex-col">
      <SubNav tabs={tabs} label="Publication navigation" />
      <div className="flex-1 overflow-auto">
        <Outlet />
      </div>
    </div>
  )
}
