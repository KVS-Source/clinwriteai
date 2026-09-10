// Claim currency badge — Module E (FR-E-004).
// Current = green · Potentially-superseded = amber · Conflicting = steel blue #005F8E (blocking, not red).
import type { ClaimCurrencyStatus } from '@platform/types'

interface Props {
  status: ClaimCurrencyStatus
  compact?: boolean
}

function meta(status: ClaimCurrencyStatus) {
  switch (status) {
    case 'current':                 return { label: 'Current',                bg: '#F0FDF4', fg: '#15803D', border: '#BBF7D0', symbol: '✓' }
    case 'potentially-superseded':  return { label: 'Potentially Superseded', bg: '#FFFBEB', fg: '#B45309', border: '#FDE68A', symbol: '⚠' }
    case 'conflicting':             return { label: 'Conflicting',            bg: '#EFF6FF', fg: '#005F8E', border: '#93C5FD', symbol: '⚑' }
  }
}

export function ClaimCurrencyBadge({ status, compact }: Props) {
  const m = meta(status)
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md font-semibold"
      style={{
        backgroundColor: m.bg,
        color:           m.fg,
        border:          `1px solid ${m.border}`,
        fontSize:        compact ? 10 : 11,
        padding:         compact ? '2px 5px' : '3px 7px',
      }}
      data-claim-currency-badge={status}
    >
      <span className="font-mono">{m.symbol}</span>
      {m.label}
    </span>
  )
}
