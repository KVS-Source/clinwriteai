import { Outlet, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { SubNav, type SubNavTab } from '../ui/SubNav'

export function ContentLayout() {
  const { t } = useTranslation()
  const { projectId, contentId } = useParams()
  const base = `/projects/${projectId}/medical-writing/content/${contentId}`

  const tabs: SubNavTab[] = [
    { to: base,                  label: t('component.content_layout.tab_briefing'),     end: true },
    { to: `${base}/editor`,      label: t('component.content_layout.tab_editor') },
    { to: `${base}/pre-mlr`,     label: t('component.content_layout.tab_pre_mlr') },
    { to: `${base}/mlr-review`,  label: t('component.content_layout.tab_mlr_review') },
    { to: `${base}/formatting`,  label: t('component.content_layout.tab_formatting') },
    { to: `${base}/final`,       label: t('component.content_layout.tab_final_output') },
  ]

  return (
    <div className="flex h-full flex-col">
      <SubNav tabs={tabs} label={t('component.content_layout.nav_label')} />
      <div className="flex-1 overflow-auto">
        <Outlet />
      </div>
    </div>
  )
}
