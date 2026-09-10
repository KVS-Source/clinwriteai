// Source gate block — Module E design rule 1 + DD-E-002.
// Full-width, rose-tinted block. No bypass path — this component is the wall.

interface Props {
  reason:       string
  originModule: string
  detail?:      string
}

export function SourceGateBlock({ reason, originModule, detail }: Props) {
  return (
    <div
      className="w-full rounded-lg border p-4"
      style={{
        backgroundColor: '#FFF1F2',
        borderColor:     '#FDA4AF',
        borderLeftWidth: 4,
        borderLeftColor: '#BE123C',
      }}
      role="alert"
      data-source-gate-block
      data-origin-module={originModule}
    >
      <div className="flex items-start gap-3">
        <span
          className="flex h-6 w-6 flex-none items-center justify-center rounded-full text-xs font-bold text-white"
          style={{ backgroundColor: '#BE123C' }}
          aria-hidden
        >⊘</span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-bold" style={{ color: '#BE123C' }}>Source gate blocked</p>
          <p className="mt-1 text-[13px]" style={{ color: '#881337' }}>{reason}</p>
          {detail && <p className="mt-1 text-[12px]" style={{ color: '#9F1239' }}>{detail}</p>}
          <p className="mt-2 font-mono text-[11px]" style={{ color: '#881337' }}>
            Origin module: <strong>{originModule}</strong> · resolve at source before ideation
          </p>
        </div>
      </div>
    </div>
  )
}
