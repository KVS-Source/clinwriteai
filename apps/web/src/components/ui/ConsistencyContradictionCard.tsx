// Consistency contradiction card — source vs target values as a diff (Module D).
// Major severity uses steel blue (blocking), never red (design rule 1).
import type { ConsistencyContradiction } from '@platform/types'

interface Props {
  contradiction: ConsistencyContradiction
}

export function ConsistencyContradictionCard({ contradiction: c }: Props) {
  const isMajor  = c.severity === 'major'
  const severityMeta = isMajor
    ? { bg: '#EFF6FF', fg: '#005F8E', border: '#93C5FD', label: 'Major' }
    : { bg: '#FFFBEB', fg: '#B45309', border: '#FDE68A', label: 'Minor' }

  return (
    <article
      className="rounded-lg border bg-white p-3"
      style={{ borderColor: c.resolved ? '#E2E8F0' : severityMeta.border, opacity: c.resolved ? 0.75 : 1 }}
      data-contradiction-card={c.id}
      data-severity={c.severity}
      data-resolved={c.resolved}
    >
      <header className="mb-2 flex items-center gap-2 text-[11px]">
        <span className="font-mono font-semibold text-slate-700">{c.id.toUpperCase()}</span>
        <span
          className="inline-flex items-center rounded px-1.5 py-0.5 font-semibold"
          style={{ backgroundColor: severityMeta.bg, color: severityMeta.fg, border: `1px solid ${severityMeta.border}` }}
          data-contradiction-severity={c.severity}
        >{severityMeta.label}</span>
        {c.resolved && (
          <span className="inline-flex items-center rounded px-1.5 py-0.5 font-semibold"
                style={{ backgroundColor: '#F0FDF4', color: '#166534' }}>
            RESOLVED ✓
          </span>
        )}
      </header>

      <div className="grid gap-2 text-[13px] md:grid-cols-2" data-contradiction-diff>
        <div className="rounded-md bg-slate-50 p-2">
          <p className="font-mono text-[10px] uppercase text-slate-500">Source</p>
          <p className="text-[12px] text-slate-500">{c.sourceSection}</p>
          <p className="mt-1 font-semibold text-slate-800">{c.sourceValue}</p>
        </div>
        <div className="rounded-md bg-slate-50 p-2">
          <p className="font-mono text-[10px] uppercase text-slate-500">Target</p>
          <p className="text-[12px] text-slate-500">{c.targetSection}</p>
          <p className="mt-1 font-semibold text-slate-800">{c.targetValue}</p>
        </div>
      </div>

      {c.resolved && c.resolutionNote && (
        <div className="mt-2 rounded-md p-2 text-[12px]" style={{ backgroundColor: '#F0FDF4', color: '#166534' }}>
          <p className="text-[10px] font-mono uppercase" style={{ letterSpacing: '0.06em' }}>Resolution note · {c.resolvedBy}</p>
          <p className="mt-1">{c.resolutionNote}</p>
        </div>
      )}
    </article>
  )
}
