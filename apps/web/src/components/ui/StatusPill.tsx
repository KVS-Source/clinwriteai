import { useTranslation } from 'react-i18next'
import { STATUS_META, type DocumentStatus, type ProjectStatus } from '@platform/types'
import { DOCUMENT_STATUS_KEY } from '../../utils/documentLabels'

interface Props {
  status: DocumentStatus
  size?: 'sm' | 'md'
}

export function StatusPill({ status, size = 'md' }: Props) {
  const { t } = useTranslation()
  const meta = STATUS_META[status]
  const padding = size === 'sm' ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-xs'
  return (
    <span
      className={`${padding} inline-flex items-center rounded-full font-mono font-semibold`}
      style={{ backgroundColor: meta.bg, color: meta.fg }}
    >
      {t(DOCUMENT_STATUS_KEY[status])}
    </span>
  )
}

const PROJECT_STATUS_META: Record<ProjectStatus, { bg: string; fg: string; labelKey: string }> = {
  'ongoing':   { bg: '#F0FDF4', fg: '#15803D', labelKey: 'component.project_status.status_ongoing' },
  'initiated': { bg: '#EFF6FF', fg: '#2563EB', labelKey: 'component.project_status.status_initiated' },
  'on-hold':   { bg: '#FFFBEB', fg: '#B45309', labelKey: 'component.project_status.status_on_hold' },
  're-open':   { bg: '#F5F3FF', fg: '#7C3AED', labelKey: 'component.project_status.status_re_open' },
  'closed':    { bg: '#F8FAFC', fg: '#64748B', labelKey: 'component.project_status.status_closed' },
}

interface ProjectPillProps {
  status: ProjectStatus
  size?: 'sm' | 'md'
}

export function ProjectStatusPill({ status, size = 'md' }: ProjectPillProps) {
  const { t } = useTranslation()
  const meta = PROJECT_STATUS_META[status]
  const padding = size === 'sm' ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-xs'
  return (
    <span
      className={`${padding} inline-flex items-center rounded-full font-mono font-semibold`}
      style={{ backgroundColor: meta.bg, color: meta.fg }}
    >
      {t(meta.labelKey)}
    </span>
  )
}
