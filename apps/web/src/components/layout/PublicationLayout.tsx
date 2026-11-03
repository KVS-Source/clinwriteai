import { Outlet, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { SubNav, type SubNavTab } from '../ui/SubNav'

export function PublicationLayout() {
  const { t } = useTranslation()
  const { projectId, publicationId } = useParams()
  const base = `/projects/${projectId}/scientific-writing/publications/${publicationId}`

  const tabs: SubNavTab[] = [
    { to: base,                        label: t('component.publication_layout.tab_manuscript'),          end: true },
    { to: `${base}/authors`,           label: t('component.publication_layout.tab_authors') },
    { to: `${base}/submission`,        label: t('component.publication_layout.tab_submission_readiness') },
    { to: `${base}/peer-review`,       label: t('component.publication_layout.tab_peer_review') },
    { to: `${base}/congress-export`,   label: t('component.publication_layout.tab_congress_export') },
    { to: `${base}/slides`,            label: t('component.publication_layout.tab_slide_deck') },
    { to: `${base}/final`,             label: t('component.publication_layout.tab_final_output') },
  ]

  return (
    <div className="flex h-full flex-col">
      <SubNav tabs={tabs} label={t('component.publication_layout.nav_label')} />
      <div className="flex-1 overflow-auto">
        <Outlet />
      </div>
    </div>
  )
}
