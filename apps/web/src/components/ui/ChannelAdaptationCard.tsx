// Channel adaptation card (Module E).
// Source doc is always read-only (DD-E-001) — this card's text IS editable via onEdit.
import type { AtomisedContent } from '@platform/types'

interface Props {
  adaptation: AtomisedContent
  onEdit?: () => void
}

export function ChannelAdaptationCard({ adaptation, onEdit }: Props) {
  const hasFix = adaptation.complianceFixes.length > 0
  return (
    <article
      className="rounded-lg border bg-white"
      style={{ borderColor: '#99F6E4', padding: 12 }}
      data-channel-adaptation-card={adaptation.id}
      data-channel={adaptation.channel}
    >
      <header className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className="inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase"
            style={{ backgroundColor: '#F0FDFA', color: '#0F766E', border: '1px solid #99F6E4', letterSpacing: '0.06em' }}
          >{adaptation.channelLabel}</span>
          {adaptation.aiGenerated && (
            <span
              className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold"
              style={{ backgroundColor: '#F5F3FF', color: '#5B21B6', border: '1px solid #DDD6FE' }}
              data-ai-generated
            >✦ AI</span>
          )}
        </div>
        <div className="flex items-center gap-2 text-[10px] font-mono text-slate-500">
          <span>{adaptation.characterCount} chars</span>
          <span>·</span>
          <span>{adaptation.wordCount} words</span>
          {onEdit && (
            <button
              type="button"
              onClick={onEdit}
              data-edit-adaptation={adaptation.id}
              className="rounded border border-slate-300 bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-700 hover:bg-slate-50"
            >Edit</button>
          )}
        </div>
      </header>
      <p className="whitespace-pre-line text-[12px] leading-relaxed text-slate-800" data-adaptation-body>
        {adaptation.contentText}
      </p>
      <footer className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px]">
        {adaptation.brandScreenPassed && (
          <span className="rounded-md px-1.5 py-0.5 font-semibold" style={{ backgroundColor: '#F0FDF4', color: '#166534' }}>Brand ✓</span>
        )}
        {adaptation.complianceScreenPassed && (
          <span className="rounded-md px-1.5 py-0.5 font-semibold" style={{ backgroundColor: '#F0FDF4', color: '#166534' }}>Compliance ✓</span>
        )}
        {hasFix && (
          <span
            className="rounded-md px-1.5 py-0.5 font-semibold"
            style={{ backgroundColor: '#FFFBEB', color: '#B45309', border: '1px solid #FDE68A' }}
            data-compliance-fix-applied
          >Fix applied</span>
        )}
      </footer>
      {hasFix && (
        <div className="mt-2 rounded-md p-2 text-[11px]" style={{ backgroundColor: '#FFFBEB', color: '#78350F', border: '1px solid #FDE68A' }}>
          {adaptation.complianceFixes.map((f, i) => (
            <p key={i}>{f.issue}</p>
          ))}
        </div>
      )}
    </article>
  )
}
