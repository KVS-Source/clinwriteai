import { Outlet, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { SubNav, type SubNavTab } from '../ui/SubNav'

export function IdeationProjectLayout() {
  const { t } = useTranslation()
  const { projectId, ideationProjectId } = useParams()
  const base = `/projects/${projectId}/ideation-publishing/projects/${ideationProjectId}`

  const tabs: SubNavTab[] = [
    { to: base,                    label: t('component.ideation_project_layout.tab_upload_source'), end: true },
    { to: `${base}/tagging`,       label: t('component.ideation_project_layout.tab_content_cards') },
    { to: `${base}/compliance`,    label: t('component.ideation_project_layout.tab_pre_review_compliance') },
    { to: `${base}/ma-approval`,   label: t('component.ideation_project_layout.tab_ma_approval') },
    { to: `${base}/standards`,     label: t('component.ideation_project_layout.tab_standards_doi') },
    { to: `${base}/final`,         label: t('component.ideation_project_layout.tab_final_output') },
  ]

  return (
    <div className="flex h-full flex-col">
      <SubNav tabs={tabs} label={t('component.ideation_project_layout.nav_label')} />
      <div className="flex-1 overflow-auto">
        <Outlet />
      </div>
    </div>
  )
}
