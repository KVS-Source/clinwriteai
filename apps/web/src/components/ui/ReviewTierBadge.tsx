// Review tier badge — Tier 1 green, Tier 2 amber, Tier 3 steel blue (#005F8E — no red in Module C).
// Shows override marker when MLR Lead has overridden the auto-computed tier.
import type { ReviewTier } from '@platform/types'

interface Props {
  tier:       ReviewTier
  overridden: boolean
}

export function ReviewTierBadge({ tier, overridden }: Props) {
  const palette = tier === 1
    ? { bg: '#ECFDF5', fg: '#047857', border: '#6EE7B7', label: 'Tier 1' }
    : tier === 2
      ? { bg: '#FFFBEB', fg: '#B45309', border: '#FCD34D', label: 'Tier 2' }
      : { bg: '#EFF6FF', fg: '#005F8E', border: '#93C5FD', label: 'Tier 3' }

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium"
      style={{
        backgroundColor: palette.bg,
        color:           palette.fg,
        border:          `1px solid ${palette.border}`,
      }}
      data-review-tier={tier}
      data-review-tier-overridden={overridden}
    >
      {palette.label}
      {overridden && (
        <span className="font-mono text-[10px] opacity-80" aria-label="overridden">⇄</span>
      )}
    </span>
  )
}
