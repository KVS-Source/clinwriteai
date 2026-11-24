// Floating progress toast for an in-flight AI draft/validation chain.
//
// Rendered inside DocumentEditor (not AppShell) because the only time
// a writer needs this is when they're looking at the doc the worker is
// drafting. Position: fixed, bottom-right, above the keyboard-shortcut
// footer. Dismissable but not persistent (next poll resurrects it if
// the chain is still active).
//
// Shows nothing when the chain isn't in flight.

import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import type { TFunction } from 'i18next'
import type { AiDraftSummary } from '../../hooks/useAiDraftStatus'
import { aiDrafterApi, type AiDraftState } from '../../api/ai-drafter'
import { ApiError } from '../../api/client'

interface Props {
  state:      AiDraftState | null
  summary:    AiDraftSummary
  documentId: string
}

const STATE_HEADLINE_KEY: Record<AiDraftState, string> = {
  pending:    'headline_pending',
  drafting:   'headline_drafting',
  validating: 'headline_validating',
  complete:   'headline_complete',
  failed:     'headline_failed',
  cancelled:  'headline_cancelled',
  not_configured: 'headline_not_configured',
  blocked:    'headline_blocked',
}

export function AiDraftingProgressToast({ state, summary, documentId }: Props) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [dismissed, setDismissed] = useState(false)
  const [stopError, setStopError] = useState<string | null>(null)

  const stopMut = useMutation({
    mutationFn: () => aiDrafterApi.stopDraft(documentId),
    onSuccess: () => {
      setStopError(null)
      // Invalidate the status query so the SPA picks up the new
      // 'cancelled' state and the toast hides on its own.
      qc.invalidateQueries({ queryKey: ['ai-draft-status', documentId] })
    },
    onError: (err: unknown) => {
      if (err instanceof ApiError) {
        const body = err.body as { message?: string; error?: string } | null
        setStopError(body?.message ?? body?.error ?? `${err.status}`)
      } else {
        setStopError(err instanceof Error ? err.message : 'Stop failed')
      }
    },
  })

  // Reset the dismiss flag the moment the chain re-enters an in-flight
  // state (so a fresh regenerate shows the toast even if the user
  // dismissed the last one).
  useEffect(() => {
    if (summary.inFlight) setDismissed(false)
  }, [summary.inFlight])

  // The toast is purely for in-flight drafts + the one-off "AI not
  // configured" explainer so writers don't stare at a hanging progress
  // bar when the admin hasn't pasted a key. Everything else (complete,
  // failed, cancelled) is told via the confidence chip in the header.
  if (!state) return null
  if (!summary.inFlight && state !== 'not_configured') return null
  if (dismissed) return null

  // "Not configured" renders without a spinner and offers a link to the
  // Admin → AI engine tab where the writer can either paste a key (if they
  // are also IT admin) or ask whoever is.
  if (state === 'not_configured') return <NotConfiguredToast onDismiss={() => setDismissed(true)} t={t} />

  const headline = t(`component.ai_drafting_progress_toast.${STATE_HEADLINE_KEY[state]}`)
  const line = buildStatusLine(state, summary, t)
  const canStop = state === 'pending' || state === 'drafting' || state === 'validating'

  return (
    <div
      className="fixed bottom-6 right-6 z-40 flex max-w-[360px] items-start gap-3 rounded-lg border bg-white px-4 py-3 shadow-lg"
      style={{ borderColor: '#DBEAFE' }}
      role="status"
      aria-live="polite"
      data-testid="ai-drafting-toast"
    >
      {/* Spinner */}
      <span
        className="mt-0.5 h-3.5 w-3.5 flex-none animate-spin rounded-full border-[1.5px]"
        style={{ borderColor: '#DBEAFE', borderTopColor: '#2563EB' }}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="text-[13px] font-semibold text-slate-900">{headline}</div>
        <div className="text-[12px] text-slate-500">{line}</div>
        {summary.hasConfidence && (
          <div className="mt-1 flex items-center gap-2">
            <span className="h-1 flex-1 overflow-hidden rounded-full bg-slate-200">
              <span
                className="block h-full"
                style={{
                  width: `${summary.confidence}%`,
                  backgroundColor:
                    summary.tone === 'green' ? '#15803D' :
                    summary.tone === 'amber' ? '#D97706' : '#E11D48',
                  transition: 'width 300ms ease-out',
                }}
              />
            </span>
            <span className="font-mono text-[10px] text-slate-500">{summary.confidence}%</span>
          </div>
        )}
        {canStop && (
          <div className="mt-1 flex items-center gap-2">
            <button
              type="button"
              onClick={() => { if (confirm('Stop the AI draft? Already-written sections stay intact; the chain exits at the next section boundary.')) stopMut.mutate() }}
              disabled={stopMut.isPending || stopMut.isSuccess}
              className="rounded-md border border-rose-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
              data-action="stop-ai-draft"
            >
              {stopMut.isSuccess ? 'Stopping…' : stopMut.isPending ? 'Stopping…' : 'Stop'}
            </button>
            {stopError && <span className="text-[10px] text-rose-700">{stopError}</span>}
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label={t('component.ai_drafting_progress_toast.dismiss')}
        className="flex h-5 w-5 flex-none items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700"
      >
        <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
          <line x1="3" y1="3" x2="9" y2="9" />
          <line x1="9" y1="3" x2="3" y2="9" />
        </svg>
      </button>
    </div>
  )
}

function NotConfiguredToast({ onDismiss, t }: { onDismiss: () => void; t: TFunction }) {
  return (
    <div
      className="fixed bottom-6 right-6 z-40 flex max-w-[380px] items-start gap-3 rounded-lg border bg-white px-4 py-3 shadow-lg"
      style={{ borderColor: '#FDE68A' }}
      role="alert"
      aria-live="polite"
      data-testid="ai-drafting-toast"
      data-state="not_configured"
    >
      <span
        className="mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full"
        style={{ backgroundColor: '#FEF3C7', color: '#92400E' }}
        aria-hidden="true"
      >!</span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="text-[13px] font-semibold text-slate-900">AI isn&rsquo;t configured for this install</div>
        <div className="text-[12px] text-slate-600">
          The drafter couldn&rsquo;t start because no Anthropic key is set. Paste one in
          {' '}<Link to="/admin" className="font-semibold text-blue-700 hover:underline">Settings &rsaquo; AI engine</Link>{' '}
          and create the document again.
        </div>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label={t('component.ai_drafting_progress_toast.dismiss')}
        className="flex h-5 w-5 flex-none items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700"
      >
        <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
          <line x1="3" y1="3" x2="9" y2="9" />
          <line x1="9" y1="3" x2="3" y2="9" />
        </svg>
      </button>
    </div>
  )
}

function buildStatusLine(state: AiDraftState, summary: AiDraftSummary, t: TFunction): string {
  if (state === 'pending') return t('component.ai_drafting_progress_toast.line_pending')
  if (state === 'drafting') {
    return summary.totalSections > 0
      ? t('component.ai_drafting_progress_toast.line_drafting_count', { count: summary.totalSections })
      : t('component.ai_drafting_progress_toast.line_drafting_no_count')
  }
  if (state === 'validating') {
    const pass = summary.currentPass > 0
      ? t('component.ai_drafting_progress_toast.line_validating_pass', { current: summary.currentPass })
      : t('component.ai_drafting_progress_toast.line_validating_pass_running')
    const flagged = summary.flaggedSections === 0
      ? t('component.ai_drafting_progress_toast.line_validating_all_clean')
      : t('component.ai_drafting_progress_toast.line_validating_flagged', { count: summary.flaggedSections })
    return t('component.ai_drafting_progress_toast.line_validating_combined', { pass, flagged })
  }
  return ''
}
