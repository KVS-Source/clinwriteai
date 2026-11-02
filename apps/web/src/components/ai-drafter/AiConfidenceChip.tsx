// AI confidence chip for the document header. Renders inline with the
// title + status pill. Shows nothing when the document was never AI-
// drafted (state is null) so non-AI docs don't carry visual noise.

import type { AiDraftSummary } from '../../hooks/useAiDraftStatus'
import type { AiDraftState } from '../../api/ai-drafter'

interface Props {
  state:    AiDraftState | null
  summary:  AiDraftSummary
}

const TONE_STYLE: Record<NonNullable<AiDraftSummary['tone']>, { bg: string; border: string; fg: string; dot: string }> = {
  green: { bg: '#F0FDF4', border: '#BBF7D0', fg: '#15803D', dot: '#15803D' },
  amber: { bg: '#FFFBEB', border: '#FDE68A', fg: '#B45309', dot: '#D97706' },
  rose:  { bg: '#FFF1F2', border: '#FECDD3', fg: '#BE123C', dot: '#E11D48' },
}

const IN_FLIGHT_STYLE = { bg: '#EFF6FF', border: '#DBEAFE', fg: '#1D4ED8', dot: '#2563EB' }

const STATE_LABEL: Record<AiDraftState, string> = {
  pending:    'AI draft queued',
  drafting:   'AI drafting…',
  validating: 'AI validating…',
  complete:   'AI confidence',
  failed:     'AI draft failed',
}

export function AiConfidenceChip({ state, summary }: Props) {
  // No AI draft ever ran for this doc → no chip at all.
  if (state === null) return null

  // Settled 'failed' is its own tone — not green/amber/rose confidence.
  if (state === 'failed') {
    const sty = { bg: '#FFF1F2', border: '#FECDD3', fg: '#BE123C', dot: '#E11D48' }
    return <ChipShell style={sty} label="AI draft failed" sub="click to regenerate" testid="ai-chip-failed" />
  }

  // In-flight: show the live pass label.
  if (summary.inFlight) {
    const sty = IN_FLIGHT_STYLE
    const label = STATE_LABEL[state]
    const sub = summary.currentPass > 0 ? `pass ${summary.currentPass}` : `${summary.totalSections || 0} sections`
    return <ChipShell style={sty} label={label} sub={sub} testid="ai-chip-inflight" spinning />
  }

  // Settled complete — show confidence + flagged count.
  if (!summary.hasConfidence || !summary.tone) return null
  const sty = TONE_STYLE[summary.tone]
  const flaggedLabel = summary.flaggedSections === 0
    ? 'all sections clean'
    : `${summary.flaggedSections} section${summary.flaggedSections === 1 ? '' : 's'} flagged`
  return (
    <ChipShell
      style={sty}
      label={`${summary.confidence}% AI confidence`}
      sub={flaggedLabel}
      testid="ai-chip-complete"
    />
  )
}

interface ChipShellProps {
  style:    { bg: string; border: string; fg: string; dot: string }
  label:    string
  sub:      string
  testid:   string
  spinning?: boolean
}

function ChipShell({ style, label, sub, testid, spinning }: ChipShellProps) {
  return (
    <span
      className="flex flex-none items-center gap-1.5 rounded-full border px-2.5 py-[3px] text-[11px] font-medium"
      style={{ backgroundColor: style.bg, borderColor: style.border, color: style.fg }}
      data-testid={testid}
      title={`${label} · ${sub}`}
    >
      {spinning ? (
        <span
          className="h-2 w-2 flex-none animate-spin rounded-full border-[1.5px]"
          style={{ borderColor: `${style.dot}66`, borderTopColor: style.dot }}
        />
      ) : (
        <span className="h-1.5 w-1.5 flex-none rounded-full" style={{ backgroundColor: style.dot }} />
      )}
      <span>{label}</span>
      <span className="opacity-70">· {sub}</span>
    </span>
  )
}
