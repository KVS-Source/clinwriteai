// AI Footprint chip — displays AI/human authoring ratio for a document/publication.
// Used in the editor toolbar (Module A + Module B).
// Colour tokens are shared across modules per design-system §B-DS-3.

interface Props {
  /** Percentage of content AI-drafted (0–100). */
  aiPercent: number
  /** Optional short label override. Defaults to "{n}% AI". */
  label?: string
  /** Compact form for tight toolbars (11px vs 12px). */
  size?: 'sm' | 'md'
}

export function AIFootprintChip({ aiPercent, label, size = 'md' }: Props) {
  const pct = Math.max(0, Math.min(100, Math.round(aiPercent)))
  const displayLabel = label ?? `${pct}% AI`
  const textSize     = size === 'sm' ? 'text-[11px]' : 'text-xs'

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 font-mono font-medium ${textSize}`}
      style={{
        backgroundColor: '#F0F7FF',
        color:           '#1D4ED8',
        border:          '1px solid #93C5FD',
      }}
      data-ai-footprint
      data-ai-percent={pct}
    >
      <svg width="10" height="10" viewBox="0 0 14 14" fill="none" className="flex-none">
        <polygon points="7,1.2 8.6,5.4 12.8,7 8.6,8.6 7,12.8 5.4,8.6 1.2,7 5.4,5.4" fill="#2563EB" />
      </svg>
      {displayLabel}
    </span>
  )
}
