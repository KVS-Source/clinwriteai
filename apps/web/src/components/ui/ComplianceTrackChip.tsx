// Compliance track chip — MLR (blue) or ACCME (green), with optional lock icon (Module C).
import type { ComplianceTrack } from '@platform/types'

interface Props {
  track:  ComplianceTrack
  locked: boolean
}

export function ComplianceTrackChip({ track, locked }: Props) {
  const palette = track === 'mlr'
    ? { bg: '#EFF6FF', fg: '#1D4ED8', border: '#93C5FD', label: 'MLR' }
    : { bg: '#ECFDF5', fg: '#047857', border: '#6EE7B7', label: 'ACCME' }

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium"
      style={{
        backgroundColor: palette.bg,
        color:           palette.fg,
        border:          `1px solid ${palette.border}`,
      }}
      data-compliance-track={track}
      data-compliance-locked={locked}
    >
      {palette.label}
      {locked && (
        <svg width="10" height="10" viewBox="0 0 14 14" fill="none" className="flex-none" aria-label="locked">
          <path d="M4 6V4.5a3 3 0 116 0V6" stroke={palette.fg} strokeWidth="1.4" fill="none" strokeLinecap="round" />
          <rect x="3" y="6" width="8" height="6" rx="1" stroke={palette.fg} strokeWidth="1.4" fill="none" />
        </svg>
      )}
    </span>
  )
}
