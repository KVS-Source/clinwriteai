import { STATUS_META, type DocumentStatus, type ProjectStatus } from '@platform/types'

interface Props {
  status: DocumentStatus
  size?: 'sm' | 'md'
}

export function StatusPill({ status, size = 'md' }: Props) {
  const meta = STATUS_META[status]
  const padding = size === 'sm' ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-xs'
  return (
    <span
      className={`${padding} inline-flex items-center rounded-full font-mono font-semibold`}
      style={{ backgroundColor: meta.bg, color: meta.fg }}
    >
      {meta.label}
    </span>
  )
}

const PROJECT_STATUS_META: Record<ProjectStatus, { bg: string; fg: string; label: string }> = {
  'ongoing':   { bg: '#F0FDF4', fg: '#15803D', label: 'Ongoing' },
  'initiated': { bg: '#EFF6FF', fg: '#2563EB', label: 'Initiated' },
  'on-hold':   { bg: '#FFFBEB', fg: '#B45309', label: 'On Hold' },
  're-open':   { bg: '#F5F3FF', fg: '#7C3AED', label: 'Re-Open' },
  'closed':    { bg: '#F8FAFC', fg: '#64748B', label: 'Closed' },
}

interface ProjectPillProps {
  status: ProjectStatus
  size?: 'sm' | 'md'
}

export function ProjectStatusPill({ status, size = 'md' }: ProjectPillProps) {
  const meta = PROJECT_STATUS_META[status]
  const padding = size === 'sm' ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-xs'
  return (
    <span
      className={`${padding} inline-flex items-center rounded-full font-mono font-semibold`}
      style={{ backgroundColor: meta.bg, color: meta.fg }}
    >
      {meta.label}
    </span>
  )
}
