// StatusStrip — compact per-document cohort indicator.
//
// Renders "N of M completed" for the current gating letter, with a
// colour cue mapped to decision state:
//
//   emerald (success)  cohort complete, stage transition eligible / fired
//   amber   (warn)     cohort has pending rows OR 0 total assigned
//   rose    (error)    at least one row in the cohort has rejected
//   slate   (neutral)  terminal state (no gating letter) or no evaluation yet
//
// Pure presentational — the caller supplies the evaluation payload
// returned by the API (/documents/:id/raci/:raciId/complete response,
// or the pm-dashboard raciProgress column).

import { useTranslation } from 'react-i18next'
import type { RaciTransitionEvaluation } from '../../api/raci'

export interface StatusStripProps {
  evaluation: RaciTransitionEvaluation | null | undefined
  /** When true, show the next-status hint on the right. Defaults to false (compact). */
  showNextStatus?: boolean
  className?: string
}

const LETTER_LABEL_KEY: Record<string, string> = {
  R: 'letter_r_label',
  A: 'letter_a_label',
  C: 'letter_c_label',
  I: 'letter_i_label',
  Q: 'letter_q_label',
}

function colourFor(ev: RaciTransitionEvaluation): 'emerald' | 'amber' | 'rose' | 'slate' {
  if (!ev.gatingLetter) return 'slate'
  if (ev.rejectedRows > 0) return 'rose'
  if (ev.cohortComplete) return 'emerald'
  return 'amber'
}

const COLOUR_CLASSES: Record<'emerald' | 'amber' | 'rose' | 'slate', string> = {
  emerald: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  amber:   'bg-amber-50 text-amber-800 border-amber-200',
  rose:    'bg-rose-50 text-rose-800 border-rose-200',
  slate:   'bg-slate-50 text-slate-700 border-slate-200',
}

export function StatusStrip({ evaluation, showNextStatus = false, className }: StatusStripProps) {
  const { t } = useTranslation()
  if (!evaluation) {
    return (
      <span className={`inline-flex items-center gap-2 px-3 py-1 rounded-md border text-xs font-medium ${COLOUR_CLASSES.slate} ${className ?? ''}`}>
        {t('component.status_strip.no_evaluation')}
      </span>
    )
  }

  const colour = colourFor(evaluation)
  const letter = evaluation.gatingLetter
  const labelKey = letter ? LETTER_LABEL_KEY[letter] : null
  const label = labelKey ? t(`component.status_strip.${labelKey}`) : letter ?? ''

  // Terminal case: no gating letter means the doc is 'signed' (or similar).
  if (!letter) {
    return (
      <span className={`inline-flex items-center gap-2 px-3 py-1 rounded-md border text-xs font-medium ${COLOUR_CLASSES.slate} ${className ?? ''}`}>
        {t('component.status_strip.terminal')}
      </span>
    )
  }

  const bodyLeft = t('component.status_strip.cohort_body', { done: evaluation.cohortDone, total: evaluation.cohortTotal, label })
  const rejectedSuffix = evaluation.rejectedRows > 0
    ? t('component.status_strip.rejected_suffix', { count: evaluation.rejectedRows })
    : ''

  return (
    <span
      className={`inline-flex items-center gap-2 px-3 py-1 rounded-md border text-xs font-medium ${COLOUR_CLASSES[colour]} ${className ?? ''}`}
      aria-label={t('component.status_strip.aria_progress', { body: bodyLeft, suffix: rejectedSuffix })}
    >
      <span className="font-semibold uppercase tracking-wider">{letter}</span>
      <span>{bodyLeft}{rejectedSuffix}</span>
      {showNextStatus && evaluation.nextStatus && (
        <span className="text-[11px] opacity-75 border-l pl-2 ml-1 border-current">
          {t('component.status_strip.next_label', { status: humanStatus(evaluation.nextStatus) })}
        </span>
      )}
    </span>
  )
}

function humanStatus(status: string): string {
  return status
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
}
