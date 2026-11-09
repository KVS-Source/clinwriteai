// AI Drafting Report panel — AI-3, minimum v1.
//
// Rendered in the right-side panel slot when activePanel ===
// 'ai-drafting-report'. Opens via the AiConfidenceChip in the
// document header.
//
// Minimum v1 scope (per 2026-11-02 user direction):
//   • Headline: current overall confidence + state
//   • Iteration log: one row per validation pass (number, started /
//     finished, sections flagged, confidence after, model used)
//   • Per-section table: sectionNumber, confidence, flags (friendly
//     labels), with the current active section highlighted so the writer
//     can see where they are
//
// Deferred to v2 (not in this commit):
//   • Token spend / cost estimate per pass
//   • "Re-run validation" button
//   • Expandable per-pass drill into which sections changed between
//     iterations
//
// All numbers are server-driven (polled via useAiDraftStatus) so this
// panel refreshes alongside the chip + toast with no extra round-trips.

import { useTranslation } from 'react-i18next'
import type { AiDraftStatusResponse, AiDraftState } from '../api/ai-drafter'
import { useDocumentStore } from '../store'

const STATE_LABEL_KEYS: Record<AiDraftState, string> = {
  pending:    'page.ai_drafting_report_panel.state_queued',
  drafting:   'page.ai_drafting_report_panel.state_drafting',
  validating: 'page.ai_drafting_report_panel.state_validating',
  complete:   'page.ai_drafting_report_panel.state_complete',
  failed:     'page.ai_drafting_report_panel.state_failed',
  not_configured: 'page.ai_drafting_report_panel.state_not_configured',
}

const STATE_TONE: Record<AiDraftState, { bg: string; fg: string }> = {
  pending:    { bg: '#F1F5F9', fg: '#334155' },
  drafting:   { bg: '#EFF6FF', fg: '#1D4ED8' },
  validating: { bg: '#EFF6FF', fg: '#1D4ED8' },
  complete:   { bg: '#F0FDF4', fg: '#15803D' },
  failed:     { bg: '#FFF1F2', fg: '#BE123C' },
  not_configured: { bg: '#FFFBEB', fg: '#B45309' },
}

const FLAG_LABEL_KEYS: Record<string, string> = {
  'completeness:too_short': 'page.ai_drafting_report_panel.flag_too_short',
  'ai:self_critique':       'page.ai_drafting_report_panel.flag_needs_revision',
  'ai:template_mismatch':   'page.ai_drafting_report_panel.flag_off_template',
  'ai:coherence_issue':     'page.ai_drafting_report_panel.flag_coherence',
  'ai:unsupported_claim':   'page.ai_drafting_report_panel.flag_unsupported_claim',
}

interface Props {
  status:   AiDraftStatusResponse | undefined
  loading:  boolean
}

export function AiDraftingReportPanel({ status, loading }: Props) {
  const { t } = useTranslation()
  const activeSection = useDocumentStore(s => s.activeSection)

  if (loading && !status) {
    return (
      <div className="flex-1 overflow-y-auto px-5 py-4 text-[12px] text-slate-500">
        {t('page.ai_drafting_report_panel.loading')}
      </div>
    )
  }

  if (!status || status.state === null) {
    return (
      <div className="flex-1 overflow-y-auto px-5 py-6">
        <h3 className="text-[13px] font-semibold text-slate-900">{t('page.ai_drafting_report_panel.no_activity_title')}</h3>
        <p className="mt-2 text-[12px] leading-relaxed text-slate-500">
          {t('page.ai_drafting_report_panel.no_activity_body')}
        </p>
      </div>
    )
  }

  const tone = STATE_TONE[status.state]
  const confidenceLabel = status.confidenceOverall === null
    ? '—'
    : `${status.confidenceOverall}%`
  const confidenceTone =
    status.confidenceOverall === null ? { bg: '#F1F5F9', fg: '#64748B' } :
    status.confidenceOverall >= 85    ? { bg: '#F0FDF4', fg: '#15803D' } :
    status.confidenceOverall >= 60    ? { bg: '#FFFBEB', fg: '#B45309' } :
                                        { bg: '#FFF1F2', fg: '#BE123C' }

  const flaggedCount = status.sections.filter(s => (s.flags?.length ?? 0) > 0).length

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Headline block */}
      <div className="border-b border-slate-200 px-5 py-4">
        <div className="flex items-center gap-2">
          <span
            className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
            style={{ backgroundColor: tone.bg, color: tone.fg }}
            data-testid="ai-report-state"
          >
            {t(STATE_LABEL_KEYS[status.state])}
          </span>
          <span
            className="rounded px-2 py-0.5 text-[11px] font-semibold"
            style={{ backgroundColor: confidenceTone.bg, color: confidenceTone.fg }}
            data-testid="ai-report-confidence"
          >
            {t('page.ai_drafting_report_panel.confidence_overall', { label: confidenceLabel })}
          </span>
        </div>
        <div className="mt-2 flex items-baseline justify-between text-[11px] text-slate-500">
          <span>
            {t('page.ai_drafting_report_panel.sections_evaluated', { count: status.sections.length })}
            {flaggedCount > 0 && (
              <> · <span style={{ color: '#BE123C' }}>{t('page.ai_drafting_report_panel.flagged_count', { count: flaggedCount })}</span></>
            )}
          </span>
          {status.lastPassAt && (
            <span className="font-mono">
              {t('page.ai_drafting_report_panel.last_pass', { time: new Date(status.lastPassAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) })}
            </span>
          )}
        </div>
      </div>

      {/* Iteration log */}
      <section className="border-b border-slate-200 px-5 py-4" data-testid="ai-report-passes">
        <h3 className="text-[12px] font-semibold uppercase tracking-wider text-slate-500">
          {t('page.ai_drafting_report_panel.validation_passes_header')}
        </h3>
        {status.passes.length === 0 ? (
          <p className="mt-2 text-[12px] italic text-slate-400">
            {t('page.ai_drafting_report_panel.no_passes_yet')}
          </p>
        ) : (
          <div className="mt-2 overflow-hidden rounded-md border border-slate-200">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-slate-500">
                  <th className="px-2.5 py-2 font-medium">{t('page.ai_drafting_report_panel.col_pass')}</th>
                  <th className="px-2.5 py-2 font-medium">{t('page.ai_drafting_report_panel.col_started')}</th>
                  <th className="px-2.5 py-2 font-medium">{t('page.ai_drafting_report_panel.col_duration')}</th>
                  <th className="px-2.5 py-2 font-medium">{t('page.ai_drafting_report_panel.col_flagged')}</th>
                  <th className="px-2.5 py-2 font-medium">{t('page.ai_drafting_report_panel.col_confidence')}</th>
                </tr>
              </thead>
              <tbody>
                {status.passes.map(p => {
                  const started = new Date(p.startedAt)
                  const finished = p.finishedAt ? new Date(p.finishedAt) : null
                  const durationS = finished ? Math.max(0, Math.round((finished.getTime() - started.getTime()) / 1000)) : null
                  return (
                    <tr key={p.passNumber} className="border-b border-slate-100 last:border-0" data-testid={`ai-report-pass-${p.passNumber}`}>
                      <td className="px-2.5 py-2 font-mono text-slate-700">#{p.passNumber}</td>
                      <td className="px-2.5 py-2 font-mono text-slate-500">
                        {started.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </td>
                      <td className="px-2.5 py-2 font-mono text-slate-500">
                        {durationS === null ? t('page.ai_drafting_report_panel.duration_running') : t('page.ai_drafting_report_panel.duration_seconds', { seconds: durationS })}
                      </td>
                      <td className="px-2.5 py-2 text-slate-700">
                        {p.sectionsFlagged === 0
                          ? <span className="text-emerald-700">{t('page.ai_drafting_report_panel.flagged_none')}</span>
                          : <span style={{ color: '#BE123C' }}>{p.sectionsFlagged}</span>}
                      </td>
                      <td className="px-2.5 py-2">
                        {p.confidenceAfter === null ? '—' : <ConfPill n={p.confidenceAfter} />}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {status.passes[0]?.modelUsed && (
              <div className="border-t border-slate-100 bg-slate-50 px-2.5 py-1.5 font-mono text-[10px] text-slate-500">
                {t('page.ai_drafting_report_panel.model_label', { model: status.passes.find(p => p.modelUsed)?.modelUsed ?? t('page.ai_drafting_report_panel.model_unknown') })}
              </div>
            )}
          </div>
        )}
      </section>

      {/* Per-section drill */}
      <section className="px-5 py-4" data-testid="ai-report-sections">
        <h3 className="text-[12px] font-semibold uppercase tracking-wider text-slate-500">
          {t('page.ai_drafting_report_panel.per_section_header')}
        </h3>
        <div className="mt-2 flex flex-col gap-1.5">
          {status.sections.map(s => {
            const isActive = s.sectionId === activeSection
            const conf = s.confidence
            const confTone =
              conf === null ? { bg: '#F1F5F9', fg: '#64748B' } :
              conf >= 85    ? { bg: '#F0FDF4', fg: '#15803D' } :
              conf >= 60    ? { bg: '#FFFBEB', fg: '#B45309' } :
                              { bg: '#FFF1F2', fg: '#BE123C' }
            return (
              <div
                key={s.sectionId}
                className={`flex items-start gap-2 rounded-md border px-2.5 py-2 ${isActive ? 'border-blue-200 bg-blue-50/40' : 'border-slate-200 bg-white'}`}
                data-testid={`ai-report-section-${s.sectionId}`}
              >
                <span
                  className="flex h-5 min-w-[36px] flex-none items-center justify-center rounded font-mono text-[10px] font-bold"
                  style={{ backgroundColor: confTone.bg, color: confTone.fg }}
                >
                  {conf === null ? '—' : conf}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12px] font-medium text-slate-900">
                    <span className="font-mono text-slate-500">{s.sectionNumber}</span>{' '}
                    {s.sectionTitle}
                  </div>
                  {s.flags.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {s.flags.map((f, i) => {
                        const key = FLAG_LABEL_KEYS[f]
                        return (
                          <span
                            key={`${f}-${i}`}
                            className="rounded-full border border-rose-200 bg-rose-50 px-1.5 py-0.5 text-[10px] font-medium text-rose-700"
                            title={f}
                          >
                            {key ? t(key) : f}
                          </span>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
          {status.sections.length === 0 && (
            <p className="text-[12px] italic text-slate-400">
              {t('page.ai_drafting_report_panel.no_section_data')}
            </p>
          )}
        </div>
      </section>
    </div>
  )
}

function ConfPill({ n }: { n: number }) {
  const tone =
    n >= 85 ? { bg: '#F0FDF4', fg: '#15803D' } :
    n >= 60 ? { bg: '#FFFBEB', fg: '#B45309' } :
              { bg: '#FFF1F2', fg: '#BE123C' }
  return (
    <span
      className="inline-flex h-5 min-w-[36px] items-center justify-center rounded font-mono text-[10px] font-bold"
      style={{ backgroundColor: tone.bg, color: tone.fg }}
    >
      {n}
    </span>
  )
}
