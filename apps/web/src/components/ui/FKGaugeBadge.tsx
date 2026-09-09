// Flesch-Kincaid gauge badge — patient-facing content readability score (Module C).
// Green ≤8 (pass), amber 8–10 (caution), steel-blue >10 (fail — no red in Module C).

interface Props {
  score:  number
  passed: boolean
}

export function FKGaugeBadge({ score, passed }: Props) {
  const value = Math.round(score * 10) / 10
  const tier: 'good' | 'warn' | 'fail' =
    value <= 8 ? 'good' : value <= 10 ? 'warn' : 'fail'

  const palette = {
    good: { bg: '#ECFDF5', fg: '#047857', border: '#6EE7B7' },
    warn: { bg: '#FFFBEB', fg: '#B45309', border: '#FCD34D' },
    fail: { bg: '#EFF6FF', fg: '#005F8E', border: '#93C5FD' },
  }[tier]

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 font-mono text-xs font-medium"
      style={{
        backgroundColor: palette.bg,
        color:           palette.fg,
        border:          `1px solid ${palette.border}`,
      }}
      data-fk-gauge
      data-fk-score={value}
      data-fk-tier={tier}
      data-fk-passed={passed}
    >
      FK {value.toFixed(1)}
      <span className="opacity-70">{passed ? '✓' : '·'}</span>
    </span>
  )
}
