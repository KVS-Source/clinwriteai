// Content expiry chip — Green >6 months, amber ≤60 days, red ≤30 days (Module C).
// Note: expiry is the only place red-tinted styling is permitted in Module C per design rule §13.1.

interface Props {
  expiryDate: string
}

export function ContentExpiryChip({ expiryDate }: Props) {
  const now         = Date.now()
  const expiryMs    = new Date(expiryDate).getTime()
  const daysToGo    = Math.round((expiryMs - now) / (1000 * 60 * 60 * 24))
  const tier: 'ok' | 'warn' | 'expiring' =
    daysToGo <= 30 ? 'expiring' : daysToGo <= 60 ? 'warn' : 'ok'

  const palette = {
    ok:       { bg: '#ECFDF5', fg: '#047857', border: '#6EE7B7', label: `Expires ${expiryDate}` },
    warn:     { bg: '#FFFBEB', fg: '#B45309', border: '#FCD34D', label: `Expires in ${daysToGo}d` },
    expiring: { bg: '#FFF1F2', fg: '#BE123C', border: '#FDA4AF', label: `Expiring — ${daysToGo}d` },
  }[tier]

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium"
      style={{
        backgroundColor: palette.bg,
        color:           palette.fg,
        border:          `1px solid ${palette.border}`,
      }}
      data-content-expiry
      data-expiry-tier={tier}
      data-expiry-days={daysToGo}
    >
      {palette.label}
    </span>
  )
}
