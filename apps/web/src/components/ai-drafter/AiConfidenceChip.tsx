// AI confidence chip for the document header. Renders inline with the
// title + status pill. Shows nothing when the document was never AI-
// drafted (state is null) so non-AI docs don't carry visual noise.

import { useTranslation } from 'react-i18next'
import type { AiDraftSummary } from '../../hooks/useAiDraftStatus'
import type { AiDraftState } from '../../api/ai-drafter'

interface Props {
  state:    AiDraftState | null
  summary:  AiDraftSummary
  /** Optional click handler — wires the chip to the AI Drafting Report
   *  panel in DocumentEditor. When omitted the chip renders as a static
   *  span (used by non-editor views if any). */
  onClick?: () => void
}

const TONE_STYLE: Record<NonNullable<AiDraftSummary['tone']>, { bg: string; border: string; fg: string; dot: string }> = {
  green: { bg: '#F0FDF4', border: '#BBF7D0', fg: '#15803D', dot: '#15803D' },
  amber: { bg: '#FFFBEB', border: '#FDE68A', fg: '#B45309', dot: '#D97706' },
  rose:  { bg: '#FFF1F2', border: '#FECDD3', fg: '#BE123C', dot: '#E11D48' },
}

const IN_FLIGHT_STYLE = { bg: '#EFF6FF', border: '#DBEAFE', fg: '#1D4ED8', dot: '#2563EB' }

const STATE_KEY: Record<AiDraftState, string> = {
  pending:    'state_pending',
  drafting:   'state_drafting',
  validating: 'state_validating',
  complete:   'state_complete',
  failed:     'state_failed',
  not_configured: 'state_not_configured',
}

export function AiConfidenceChip({ state, summary, onClick }: Props) {
  const { t } = useTranslation()
  // No AI draft ever ran for this doc → no chip at all.
  if (state === null) return null

  // AI isn't set up: nothing was drafted. Amber, not an error.
  if (state === 'not_configured') {
    const sty = { bg: '#FFFBEB', border: '#FDE68A', fg: '#B45309', dot: '#D97706' }
    return <ChipShell style={sty} label={t('component.ai_confidence_chip.state_not_configured')} sub={t('component.ai_confidence_chip.not_configured_sub')} testid="ai-chip-not-configured" onClick={onClick} />
  }

  // Settled 'failed' is its own tone — not green/amber/rose confidence.
  if (state === 'failed') {
    const sty = { bg: '#FFF1F2', border: '#FECDD3', fg: '#BE123C', dot: '#E11D48' }
    return <ChipShell style={sty} label={t('component.ai_confidence_chip.state_failed')} sub={t('component.ai_confidence_chip.failed_sub')} testid="ai-chip-failed" onClick={onClick} />
  }

  // In-flight: show the live pass label.
  if (summary.inFlight) {
    const sty = IN_FLIGHT_STYLE
    const label = t(`component.ai_confidence_chip.${STATE_KEY[state]}`)
    const sub = summary.currentPass > 0
      ? t('component.ai_confidence_chip.in_flight_pass_sub', { number: summary.currentPass })
      : t('component.ai_confidence_chip.in_flight_sections_sub', { count: summary.totalSections || 0 })
    return <ChipShell style={sty} label={label} sub={sub} testid="ai-chip-inflight" spinning onClick={onClick} />
  }

  // Settled complete — show confidence + flagged count.
  if (!summary.hasConfidence || !summary.tone) return null
  const sty = TONE_STYLE[summary.tone]
  const flaggedLabel = summary.flaggedSections === 0
    ? t('component.ai_confidence_chip.all_sections_clean')
    : t('component.ai_confidence_chip.sections_flagged', { count: summary.flaggedSections })
  return (
    <ChipShell
      style={sty}
      label={t('component.ai_confidence_chip.confidence_label', { pct: summary.confidence })}
      sub={flaggedLabel}
      testid="ai-chip-complete"
      onClick={onClick}
    />
  )
}

interface ChipShellProps {
  style:    { bg: string; border: string; fg: string; dot: string }
  label:    string
  sub:      string
  testid:   string
  spinning?: boolean
  onClick?:  () => void
}

function ChipShell({ style, label, sub, testid, spinning, onClick }: ChipShellProps) {
  const { t } = useTranslation()
  const body = (
    <>
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
    </>
  )
  const shared = 'flex flex-none items-center gap-1.5 rounded-full border px-2.5 py-[3px] text-[11px] font-medium'
  const styleObj = { backgroundColor: style.bg, borderColor: style.border, color: style.fg }

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`${shared} transition-colors hover:brightness-95`}
        style={styleObj}
        data-testid={testid}
        title={t('component.ai_confidence_chip.tooltip_with_report', { label, sub })}
      >
        {body}
      </button>
    )
  }
  return (
    <span
      className={shared}
      style={styleObj}
      data-testid={testid}
      title={t('component.ai_confidence_chip.tooltip_plain', { label, sub })}
    >
      {body}
    </span>
  )
}
