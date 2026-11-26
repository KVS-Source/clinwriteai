// Module E AI debug panel (Package E-8, migration 105).
//
// Standalone panel that renders the ai_draft_steps timeline for an
// ideation artefact. Reads via ideationPublishingApi.aiDebugSteps
// (Package E-7 endpoint). Parity sibling to MedContentAiDebugPanel /
// PublicationAiDebugPanel / RegulatoryAiDebugPanel — same timeline
// shape, different data source.
//
// Scope: read-only step log timeline. Module E has its own
// ideation-ai-validation-pass worker (not surfaced as pause/resume
// here).

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ideationPublishingApi } from '../../modules/ideation-publishing/api/ideationPublishing'

interface Props {
  ideationArtefactId: string
  open:               boolean
  onClose:            () => void
}

interface DebugStep {
  id:         string
  kind:       string
  message:    string
  sectionId:  string | null
  details:    Record<string, unknown>
  elapsedMs:  number | null
  timestamp:  string
}

function toneForKind(kind: string): { bg: string; dot: string; fg: string } {
  switch (kind) {
    case 'manifest_extracted':
    case 'validator_check_result': return { bg: 'bg-violet-50',  dot: 'bg-violet-500',  fg: 'text-violet-900' }
    case 'validator_retry':        return { bg: 'bg-amber-50',   dot: 'bg-amber-600',   fg: 'text-amber-900' }
    case 'section_ai_call':
    case 'section_response':
    case 'validation_pass_start':  return { bg: 'bg-indigo-50',  dot: 'bg-indigo-500',  fg: 'text-indigo-900' }
    case 'section_committed':
    case 'validation_pass_end':
    case 'job_complete':           return { bg: 'bg-emerald-50', dot: 'bg-emerald-500', fg: 'text-emerald-900' }
    case 'section_skipped':
    case 'source_skipped':
    case 'warning':
    case 'job_paused':             return { bg: 'bg-amber-50',   dot: 'bg-amber-600',   fg: 'text-amber-900' }
    case 'section_errored':
    case 'job_cancelled':          return { bg: 'bg-rose-50',    dot: 'bg-rose-600',    fg: 'text-rose-900' }
    default:                       return { bg: 'bg-white',      dot: 'bg-slate-400',   fg: 'text-slate-700' }
  }
}

function formatElapsed(ms: number | null): string {
  if (ms === null || ms === undefined) return '—'
  return ms < 1_000 ? `${ms}ms` : `${(ms / 1_000).toFixed(1)}s`
}

export function IdeationAiDebugPanel({ ideationArtefactId, open, onClose }: Props) {
  const { data, isLoading, error, refetch, isFetching } = useQuery<{ ideationArtefactId: string; draftSteps: DebugStep[] }>({
    queryKey: ['ideation-ai-debug-steps', ideationArtefactId],
    queryFn:  () => ideationPublishingApi.aiDebugSteps(ideationArtefactId),
    enabled:  open,
    staleTime: 5_000,
  })

  const [expandedId, setExpandedId] = useState<string | null>(null)

  const grouped = useMemo(() => {
    const steps = data?.draftSteps ?? []
    const bySection = new Map<string, DebugStep[]>()
    for (const s of steps) {
      const key = s.sectionId ?? '__global__'
      if (!bySection.has(key)) bySection.set(key, [])
      bySection.get(key)!.push(s)
    }
    return bySection
  }, [data])

  if (!open) return null

  return (
    <aside
      className="fixed right-0 top-16 z-40 flex h-[calc(100vh-4rem)] w-[420px] flex-col border-l border-slate-200 bg-white shadow-xl"
      data-panel="ideation-ai-debug"
    >
      <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">AI debug · Ideation</h2>
          <p className="text-[11px] text-slate-500">Step log for this artefact · {data?.draftSteps.length ?? 0} event{(data?.draftSteps.length ?? 0) === 1 ? '' : 's'}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void refetch()}
            disabled={isFetching}
            className="rounded border border-slate-200 px-2 py-0.5 text-[11px] font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            {isFetching ? 'Refreshing…' : 'Refresh'}
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close debug panel"
            className="rounded px-2 py-0.5 text-slate-500 hover:bg-slate-100"
          >
            ✕
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {isLoading && <p className="text-[12px] text-slate-500">Loading step log…</p>}
        {error && <p className="text-[12px] text-rose-700">Could not load steps: {(error as Error).message}</p>}
        {!isLoading && !error && data && data.draftSteps.length === 0 && (
          <p className="text-[12px] text-slate-500">
            No AI debug events for this artefact yet. Steps appear here as soon as the initial-draft worker
            runs or the author triggers an AI rewrite.
          </p>
        )}
        {!isLoading && !error && data && data.draftSteps.length > 0 && (
          <div className="flex flex-col gap-3">
            {[...grouped.entries()].map(([sectionKey, steps]) => (
              <section key={sectionKey} data-section={sectionKey}>
                <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  {sectionKey === '__global__' ? 'Artefact-level events' : `Section · ${sectionKey}`}
                </h3>
                <ol className="flex flex-col divide-y divide-slate-100 rounded border border-slate-200 bg-white">
                  {steps.map(s => {
                    const tone = toneForKind(s.kind)
                    const hasDetails = s.details && Object.keys(s.details).length > 0
                    const isOpen = expandedId === s.id
                    return (
                      <li key={s.id} className={`flex flex-col ${tone.bg}`} data-step-kind={s.kind}>
                        <button
                          type="button"
                          onClick={() => hasDetails && setExpandedId(isOpen ? null : s.id)}
                          disabled={!hasDetails}
                          className={`flex w-full items-start gap-2 px-2.5 py-1.5 text-left text-[12px] ${hasDetails ? 'cursor-pointer' : 'cursor-default'}`}
                        >
                          <span className={`mt-1 inline-block h-1.5 w-1.5 flex-none rounded-full ${tone.dot}`} />
                          <span className="flex-1">
                            <span className={`font-mono text-[10px] ${tone.fg}`}>{s.kind}</span>
                            <span className="ml-2 text-slate-700">{s.message}</span>
                          </span>
                          <span className="font-mono text-[10px] text-slate-400">{formatElapsed(s.elapsedMs)}</span>
                        </button>
                        {hasDetails && isOpen && (
                          <pre className="overflow-x-auto bg-white/60 px-2.5 py-1.5 font-mono text-[10px] text-slate-700">
                            {JSON.stringify(s.details, null, 2)}
                          </pre>
                        )}
                      </li>
                    )
                  })}
                </ol>
              </section>
            ))}
          </div>
        )}
      </div>
    </aside>
  )
}

/** Drop-in floating toggle for ideation screens. */
export function IdeationAiDebugButton({ ideationArtefactId }: { ideationArtefactId: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50"
        data-action="toggle-ideation-ai-debug"
      >
        {open ? 'Hide AI debug' : 'AI debug'}
      </button>
      <IdeationAiDebugPanel ideationArtefactId={ideationArtefactId} open={open} onClose={() => setOpen(false)} />
    </>
  )
}
