import { Outlet, useParams } from 'react-router-dom'
import { SubNav, type SubNavTab } from '../ui/SubNav'

export function SubmissionLayout() {
  const { projectId, submissionId } = useParams()
  const base = `/projects/${projectId}/regulatory-writing/submissions/${submissionId}`

  const tabs: SubNavTab[] = [
    { to: base,                       label: 'Setup & Strategy', end: true },
    { to: `${base}/ectd-map`,         label: 'eCTD Map' },
    { to: `${base}/module2-editor`,   label: 'Module 2 Editor' },
    { to: `${base}/finalisation`,     label: 'CMC / Nonclinical' },
    { to: `${base}/super-review`,     label: 'Super Review' },
    { to: `${base}/redaction`,        label: 'PPD / CCI Redaction' },
    { to: `${base}/publishing`,       label: 'eCTD Publishing' },
    { to: `${base}/gateway`,          label: 'Gateway' },
    { to: `${base}/ha-response`,      label: 'HA Response' },
    { to: `${base}/final`,            label: 'Final Output' },
  ]

  return (
    <div className="flex h-full flex-col">
      <SubNav tabs={tabs} label="Submission navigation" />
      <div className="flex-1 overflow-auto">
        <Outlet />
      </div>
    </div>
  )
}
