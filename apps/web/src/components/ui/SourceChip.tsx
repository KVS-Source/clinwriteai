// SourceChip — cross-module provenance chip (OQ-B-001).
// Design: 5×5 coloured dot + "Source: {label}" text, teal chip background.
// Variants: 'dot' (default — colored dot before label) or 'icon' (source-doc SVG).

interface Props {
  /** Human-readable label. If it doesn't start with "Source:", one will be prefixed. */
  label: string
  /** Coloured dot fill (module colour of the source doc). Defaults to Clinical Writing #2563EB. */
  dotColor?: string
  /** Compact form (11px vs 12px). */
  size?: 'sm' | 'md'
  /** Optional click handler — usually navigates to the source doc. */
  onClick?: () => void
}

export function SourceChip({ label, dotColor = '#2563EB', size = 'sm', onClick }: Props) {
  const textSize = size === 'sm' ? 'text-[11px]' : 'text-xs'
  const displayLabel = /^\s*source:/i.test(label) ? label : `Source: ${label}`
  const Element = onClick ? 'button' : 'span'

  return (
    <Element
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 self-start rounded px-2 py-1 font-semibold transition-colors ${textSize} ${onClick ? 'cursor-pointer hover:opacity-80' : ''}`}
      style={{
        backgroundColor: '#F0FDFA',
        color:           '#0F766E',
        border:          '1px solid #99F6E4',
        padding:         '3px 9px',
        borderRadius:    5,
      }}
      data-source-chip
    >
      <span
        className="flex-none rounded-full"
        style={{ width: 5, height: 5, backgroundColor: dotColor, display: 'inline-block' }}
        data-source-dot
      />
      {displayLabel}
    </Element>
  )
}
