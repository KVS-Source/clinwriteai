import { Outlet, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { SubNav, type SubNavTab } from '../ui/SubNav'

export function SubmissionLayout() {
  const { t } = useTranslation()
  const { projectId, submissionId } = useParams()
  const base = `/projects/${projectId}/regulatory-writing/submissions/${submissionId}`

  const tabs: SubNavTab[] = [
    { to: base,                       label: t('component.submission_layout.tab_setup_strategy'), end: true },
    { to: `${base}/ectd-map`,         label: t('component.submission_layout.tab_ectd_map') },
    { to: `${base}/module2-editor`,   label: t('component.submission_layout.tab_module2_editor') },
    { to: `${base}/finalisation`,     label: t('component.submission_layout.tab_cmc_nonclinical') },
    { to: `${base}/super-review`,     label: t('component.submission_layout.tab_super_review') },
    { to: `${base}/redaction`,        label: t('component.submission_layout.tab_redaction') },
    { to: `${base}/publishing`,       label: t('component.submission_layout.tab_ectd_publishing') },
    { to: `${base}/gateway`,          label: t('component.submission_layout.tab_gateway') },
    { to: `${base}/ha-response`,      label: t('component.submission_layout.tab_ha_response') },
    { to: `${base}/final`,            label: t('component.submission_layout.tab_final_output') },
  ]

  return (
    <div className="flex h-full flex-col">
      <SubNav tabs={tabs} label={t('component.submission_layout.nav_label')} />
      <div className="flex-1 overflow-auto">
        <Outlet />
      </div>
    </div>
  )
}
