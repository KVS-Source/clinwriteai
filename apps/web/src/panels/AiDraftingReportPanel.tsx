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

import type { AiDraftStatusResponse, AiDraftState } from '../api/ai-drafter'
import { useDocumentStore } from '../store'

const STATE_LABEL: Record<AiDraftState, string> = {
  pending:    'Queued',
  drafting:   'Drafting',
  validating: 'Validating',
  complete:   'Complete',
  failed:     'Failed',
}

const STATE_TONE: Record<AiDraftState, { bg: string; fg: string }> = {
  pending:    { bg: '#F1F5F9', fg: '#334155' },
  drafting:   { bg: '#EFF6FF', fg: '#1D4ED8' },
  validating: { bg: '#EFF6FF', fg: '#1D4ED8' },
  complete:   { bg: '#F0FDF4', fg: '#15803D' },
  failed:     { bg: '#FFF1F2', fg: '#BE123C' },
}

const FLAG_LABEL: Record<string, string> = {
  'completeness:too_short': 'Too short',
  'ai:self_critique':       'Needs revision',
  'ai:template_mismatch':   'Off-template',
  'ai:coherence_issue':     'Coherence',
  'ai:unsupported_claim':   'Unsupported claim',
}

interface Props {
  status:   AiDraftStatusResponse | undefined
  loading:  boolean
}

export function AiDraftingReportPanel({ status, loading }: Props) {
  const activeSection = useDocumentStore(s => s.activeSection)

  if (loading && !status) {
    return (
      <div className="flex-1 overflow-y-auto px-5 py-4 text-[12px] text-slate-500">
        Loading AI drafting report…
      </div>
    )
  }

  if (!status || status.state === null) {
    return (
      <div className="flex-1 overflow-y-auto px-5 py-6">
        <h3 className="text-[13px] font-semibold text-slate-900">No AI drafting activity</h3>
        <p className="mt-2 text-[12px] leading-relaxed text-slate-500">
          This document wasn't drafted with AI. Create a new document from the
          "Draft with AI" opt-in in the New Document wizard to see the drafter
          + validator pipeline run.
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
            {STATE_LABEL[status.state]}
          </span>
          <span
            className="rounded px-2 py-0.5 text-[11px] font-semibold"
            style={{ backgroundColor: confidenceTone.bg, color: confidenceTone.fg }}
            data-testid="ai-report-confidence"
          >
            {confidenceLabel} overall
          </span>
        </div>
        <div className="mt-2 flex items-baseline justify-between text-[11px] text-slate-500">
          <span>
            {status.sections.length} section{status.sections.length === 1 ? '' : 's'} evaluated
            {flaggedCount > 0 && (
              <> · <span style={{ color: '#BE123C' }}>{flaggedCount} flagged</span></>
            )}
          </span>
          {status.lastPassAt && (
            <span className="font-mono">
              Last pass {new Date(status.lastPassAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
        </div>
      </div>

      {/* Iteration log */}
      <section className="border-b border-slate-200 px-5 py-4" data-testid="ai-report-passes">
        <h3 className="text-[12px] font-semibold uppercase tracking-wider text-slate-500">
          Validation passes
        </h3>
        {status.passes.length === 0 ? (
          <p className="mt-2 text-[12px] italic text-slate-400">
            No validation passes recorded yet.
          </p>
        ) : (
          <div className="mt-2 overflow-hidden rounded-md border border-slate-200">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-slate-500">
                  <th className="px-2.5 py-2 font-medium">Pass</th>
                  <th className="px-2.5 py-2 font-medium">Started</th>
                  <th className="px-2.5 py-2 font-medium">Duration</th>
                  <th className="px-2.5 py-2 font-medium">Flagged</th>
                  <th className="px-2.5 py-2 font-medium">Confidence</th>
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
                        {durationS === null ? '— running —' : `${durationS}s`}
                      </td>
                      <td className="px-2.5 py-2 text-slate-700">
                        {p.sectionsFlagged === 0
                          ? <span className="text-emerald-700">none</span>
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
                model · {status.passes.find(p => p.modelUsed)?.modelUsed ?? 'unknown'}
              </div>
            )}
          </div>
        )}
      </section>

      {/* Per-section drill */}
      <section className="px-5 py-4" data-testid="ai-report-sections">
        <h3 className="text-[12px] font-semibold uppercase tracking-wider text-slate-500">
          Per-section confidence
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
                      {s.flags.map((f, i) => (
                        <span
                          key={`${f}-${i}`}
                          className="rounded-full border border-rose-200 bg-rose-50 px-1.5 py-0.5 text-[10px] font-medium text-rose-700"
                          title={f}
                        >
                          {FLAG_LABEL[f] ?? f}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
          {status.sections.length === 0 && (
            <p className="text-[12px] italic text-slate-400">
              No section data yet. The first validation pass populates this list.
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
