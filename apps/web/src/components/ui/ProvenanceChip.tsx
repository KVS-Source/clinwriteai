// Provenance chip — always visible without interaction (Module E rule 3, FR-E-009).
// Renders the full provenance chain inline; never collapsible.

interface Props {
  chain: string[]
  compact?: boolean
}

export function ProvenanceChip({ chain, compact }: Props) {
  if (!chain || chain.length === 0) return null
  return (
    <div
      className="inline-flex flex-wrap items-center gap-1"
      data-provenance-chip
      data-provenance-chain={chain.join(' > ')}
    >
      {chain.map((step, i) => (
        <span key={i} className="inline-flex items-center gap-1">
          <span
            className="inline-flex items-center rounded-md font-mono font-semibold"
            style={{
              backgroundColor: '#F0FDFA',
              color:           '#0F766E',
              border:          '1px solid #99F6E4',
              fontSize:        compact ? 9 : 10,
              padding:         compact ? '2px 5px' : '3px 6px',
              letterSpacing:   '0.04em',
            }}
          >{step}</span>
          {i < chain.length - 1 && <span className="text-[10px] font-mono text-slate-400">→</span>}
        </span>
      ))}
    </div>
  )
}
