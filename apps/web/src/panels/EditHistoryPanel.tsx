// Generic edit history panel — the UI shell shared by every module that
// consumes the polymorphic EditHistory table (Module A sections, Module E
// atomised content; Modules B/D/PPT come later).
//
// Specialised panels (SectionHistoryPanel, AtomisedHistoryPanel) stay as
// thin wrappers that pass in:
//   - loader(filters)              → fetches history
//   - revert(editId)               → fires the revert mutation
//   - queryKey                     → React Query key prefix (used for cache invalidation)
//   - invalidationKeys             → additional query keys to refetch after revert
//                                    (e.g. ['document', docId] so the editor re-renders)
//   - header                       → scope label (e.g. "§3.2 Primary Efficacy")
//   - subject                      → "section" / "channel adaptation" — used in copy
//
// Behavior preserved across modules:
//   - Scope toggle (My ↔ All)
//   - Origin filter chips (All / AI / Manual / Undos)
//   - Per-row Revert button when canRevert
//   - Confirmation modal counts intervening edits by actor

import { useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '../store'
import { ApiError } from '../api/client'

export type EditOrigin = 'manual' | 'ai' | 'undo' | 'restore'
export type OriginFilter = 'all' | EditOrigin

export interface HistoryEntry {
  id:              string
  actorId:         string
  actorName:       string
  origin:          EditOrigin | string
  createdAt:       string
  promptText?:     string | null
  aiModel?:        string | null
  interveningCount: number
  interveningByActor: Array<{ actorId: string; actorName: string; count: number }>
  canRevert:       boolean
  /** Set on rolled-up session rows (sPM-autosave). 1 for a singleton that didn't collapse. */
  sessionEntryCount?: number
  /** ISO ts of the oldest raw row in the session; `createdAt` is the newest. */
  sessionStartedAt?: string
  /** Plain-text preview of pre-edit content for the Section History row. */
  beforeExcerpt?: string
  /** Plain-text preview of post-edit content for the Section History row. */
  afterExcerpt?:  string
}

export interface HistoryResponse {
  entries: HistoryEntry[]
  /** Collapsed-into-sessions view (sPM-autosave). Panels default to this when present. */
  sessions?: HistoryEntry[]
}

export interface HistoryDiff {
  beforeHtml: string | null
  afterHtml:  string
}

export interface Props<R extends HistoryResponse = HistoryResponse> {
  /** Fetches the history list given the current filters. */
  loader: (filters: { mine: boolean; origin: EditOrigin | undefined }) => Promise<R>
  /** Fires the revert mutation for a given history row id. */
  revert: (editHistoryId: string) => Promise<unknown>
  /** Fetches the full beforeHtml + afterHtml for a row (optional — enables "Show change" expansion). */
  fetchDiff?: (editHistoryId: string) => Promise<HistoryDiff>
  /** React Query key for the history list (used for cache invalidation on revert). */
  queryKey: readonly unknown[]
  /** Additional query keys to invalidate when a revert succeeds. */
  invalidationKeys?: Array<readonly unknown[]>
  /** Small eyebrow label above the panel copy (section header, channel name, etc.). */
  header?: ReactNode
  /** Noun used in copy — "section" or "channel adaptation". */
  subject?: string
  /** Shown when a required pre-condition isn't met (e.g. "Select a section first"). */
  emptyPrecondition?: string
}

export function EditHistoryPanel<R extends HistoryResponse = HistoryResponse>(props: Props<R>) {
  const qc = useQueryClient()
  const currentUserId = useAuthStore(s => s.user?.id ?? null)
  const subject = props.subject ?? 'item'

  const [scope, setScope]   = useState<'mine' | 'all'>('mine')
  const [origin, setOrigin] = useState<OriginFilter>('all')
  // sPM-autosave diff — one row's full before/after HTML in flight. Keyed by
  // editHistoryId so clicking Show-change on one row doesn't blow up others.
  const [expandedId,  setExpandedId]  = useState<string | null>(null)
  const [expandedData, setExpandedData] = useState<HistoryDiff | null>(null)
  const [expandError, setExpandError] = useState<string | null>(null)
  const [expandLoading, setExpandLoading] = useState(false)

  const toggleExpand = async (entryId: string) => {
    if (!props.fetchDiff) return
    if (expandedId === entryId) {
      setExpandedId(null); setExpandedData(null); setExpandError(null)
      return
    }
    setExpandedId(entryId); setExpandedData(null); setExpandError(null); setExpandLoading(true)
    try {
      const data = await props.fetchDiff(entryId)
      setExpandedData(data)
    } catch (err) {
      setExpandError(err instanceof ApiError ? `Could not load diff (HTTP ${err.status})` : 'Could not load diff.')
    } finally {
      setExpandLoading(false)
    }
  }
  // sPM-autosave — when the loader returns `sessions`, prefer that view so a
  // 20-save autosave burst doesn't drown the panel. Writers who want to see
  // every individual save flip to 'rows'. Non-session loaders (Module E and
  // the SectionHistoryPanel-no-section guard) fall back to 'rows' silently
  // because `sessions` is undefined.
  const [view, setView] = useState<'sessions' | 'rows'>('sessions')
  const [pending, setPending] = useState<null | {
    editHistoryId: string
    actorName:     string
    createdAt:     string
    origin:        string
    interveningCount: number
    interveningByActor: Array<{ actorId: string; actorName: string; count: number }>
  }>(null)

  const historyQ = useQuery({
    queryKey: [...props.queryKey, scope, origin],
    queryFn:  () => props.loader({ mine: scope === 'mine', origin: origin === 'all' ? undefined : origin }),
  })

  const revert = useMutation({
    mutationFn: (editHistoryId: string) => props.revert(editHistoryId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: props.queryKey })
      for (const k of props.invalidationKeys ?? []) qc.invalidateQueries({ queryKey: k })
      setPending(null)
    },
  })

  if (props.emptyPrecondition) {
    return (
      <div className="flex-1 overflow-y-auto p-4">
        <p className="text-[13px] text-slate-500">{props.emptyPrecondition}</p>
      </div>
    )
  }

  if (historyQ.isLoading) {
    return (
      <div className="flex-1 overflow-y-auto p-4">
        <p className="text-[13px] text-slate-500">Loading history…</p>
      </div>
    )
  }
  if (historyQ.isError) {
    return (
      <div className="flex-1 overflow-y-auto p-4">
        <p className="text-[13px] text-rose-600">Failed to load history.</p>
      </div>
    )
  }

  const rawEntries     = (historyQ.data?.entries  ?? []) as HistoryEntry[]
  const sessionEntries = (historyQ.data?.sessions ?? null) as HistoryEntry[] | null
  const hasSessions    = sessionEntries !== null
  const entries        = (hasSessions && view === 'sessions') ? sessionEntries! : rawEntries

  return (
    <div className="flex-1 overflow-y-auto p-4" data-panel="history">
      {props.header && (
        <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">
          {props.header}
        </p>
      )}
      <p className="mt-1 text-[13px] text-slate-700">
        Every change on this {subject} — manual edits, AI accepts, reverts, restores — newest first.
        Revert restores the {subject} to the state captured before that edit.
      </p>

      {/* Scope toggle: My ↔ All */}
      <div className="mt-4 flex rounded-md border border-slate-200 bg-slate-100 p-0.5" data-section-history-scope>
        <button
          type="button"
          onClick={() => setScope('mine')}
          disabled={!currentUserId}
          className={`flex-1 rounded px-3 py-1 text-[12px] font-semibold transition-colors ${scope === 'mine' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
        >My changes</button>
        <button
          type="button"
          onClick={() => setScope('all')}
          className={`flex-1 rounded px-3 py-1 text-[12px] font-semibold transition-colors ${scope === 'all' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
        >All on this {subject}</button>
      </div>

      {/* Session vs raw-row toggle (sPM-autosave). Only shown when the
          loader returns sessions — Module E atomised history and the
          no-section guard both return raw-only, so the toggle hides
          itself. Rolls up consecutive same-actor same-origin saves within
          10 minutes into one row; raw mode shows every autosave fire. */}
      {hasSessions && (
        <div className="mt-3 flex rounded-md border border-slate-200 bg-slate-100 p-0.5" data-section-history-view>
          <button
            type="button"
            onClick={() => setView('sessions')}
            className={`flex-1 rounded px-3 py-1 text-[11px] font-semibold transition-colors ${view === 'sessions' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            title="One row per writing session (autosaves within 10 minutes collapse)"
          >Grouped by session</button>
          <button
            type="button"
            onClick={() => setView('rows')}
            className={`flex-1 rounded px-3 py-1 text-[11px] font-semibold transition-colors ${view === 'rows' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            title="Every individual save (noisy, use for audit drilldown)"
          >Every save</button>
        </div>
      )}

      {/* Origin filter chips */}
      <div className="mt-3 flex flex-wrap gap-1" data-section-history-origin>
        {(['all', 'ai', 'manual', 'undo'] as OriginFilter[]).map(k => (
          <button
            key={k}
            type="button"
            onClick={() => setOrigin(k)}
            className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors ${origin === k ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
          >{ORIGIN_CHIP_LABEL[k]}</button>
        ))}
      </div>

      {entries.length === 0 && (
        <p className="mt-6 rounded-md border border-dashed border-slate-300 bg-slate-50 p-4 text-center text-[12px] text-slate-500">
          {scope === 'mine' ? `No changes by you yet on this ${subject}.` : `No history on this ${subject} yet.`}
        </p>
      )}

      <ul className="mt-4 flex flex-col gap-3">
        {entries.map(e => (
          <li key={e.id} className={`rounded-md border p-3 ${e.origin === 'undo' ? 'border-slate-200 bg-slate-50' : 'border-slate-300 bg-white'}`}>
            <div className="flex items-center justify-between">
              <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${originBadgeClass(e.origin)}`}>
                {originLabel(e.origin)}
                {(e.sessionEntryCount ?? 1) > 1 && (
                  <> · {e.sessionEntryCount} saves</>
                )}
              </span>
              <time
                className="text-[11px] text-slate-500"
                title={e.sessionStartedAt && e.sessionStartedAt !== e.createdAt
                  ? `${new Date(e.sessionStartedAt).toLocaleTimeString()} → ${new Date(e.createdAt).toLocaleTimeString()}`
                  : e.createdAt}
              >
                {(e.sessionEntryCount ?? 1) > 1 && e.sessionStartedAt
                  ? `${new Date(e.sessionStartedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })} → ${new Date(e.createdAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`
                  : formatRelative(e.createdAt)}
              </time>
            </div>

            {e.origin === 'ai' && e.promptText && (
              <p className="mt-2 text-[12px] text-slate-700">
                <span className="font-mono text-[10px] uppercase tracking-wider text-slate-500">Prompt · </span>
                {e.promptText}
              </p>
            )}
            {e.origin === 'undo' && (
              <p className="mt-2 text-[12px] italic text-slate-500">Reverted an earlier change on this {subject}.</p>
            )}

            {/* sPM-autosave inline preview — before/after excerpts so the
                writer can tell what changed without expanding. Hidden when
                both are empty (e.g. first-ever save or Module E loaders
                that don't carry excerpts). */}
            {(e.beforeExcerpt || e.afterExcerpt) && (
              <div className="mt-2 flex flex-col gap-1 text-[12px] leading-snug" data-history-excerpt>
                {e.beforeExcerpt && (
                  <div className="flex items-start gap-1.5">
                    <span className="mt-[1px] shrink-0 font-mono text-[9px] uppercase tracking-wider text-rose-600">Was</span>
                    <span className="text-slate-500 line-through decoration-rose-400/60">{e.beforeExcerpt}</span>
                  </div>
                )}
                {e.afterExcerpt && (
                  <div className="flex items-start gap-1.5">
                    <span className="mt-[1px] shrink-0 font-mono text-[9px] uppercase tracking-wider text-emerald-700">Now</span>
                    <span className="text-slate-800">{e.afterExcerpt}</span>
                  </div>
                )}
              </div>
            )}

            {/* Expanded full-diff view — fetched lazily when the user
                clicks "Show change". beforeHtml is null for the very
                first save on a section (nothing to compare to). */}
            {expandedId === e.id && (
              <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3" data-history-diff>
                {expandLoading && <p className="text-[11px] text-slate-500">Loading change…</p>}
                {expandError && <p className="text-[11px] text-rose-600">{expandError}</p>}
                {expandedData && (
                  <div className="flex flex-col gap-3">
                    <div>
                      <p className="font-mono text-[9px] uppercase tracking-wider text-rose-600">Was</p>
                      {expandedData.beforeHtml
                        ? <div className="mt-1 rounded border border-rose-200 bg-rose-50/50 p-2 text-[12px] text-slate-700 [&_*]:text-slate-700" dangerouslySetInnerHTML={{ __html: expandedData.beforeHtml }} />
                        : <p className="mt-1 text-[11px] italic text-slate-500">(First save on this {subject} — no prior content.)</p>}
                    </div>
                    <div>
                      <p className="font-mono text-[9px] uppercase tracking-wider text-emerald-700">Now</p>
                      <div className="mt-1 rounded border border-emerald-200 bg-emerald-50/40 p-2 text-[12px] text-slate-800 [&_*]:text-slate-800" dangerouslySetInnerHTML={{ __html: expandedData.afterHtml }} />
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500">
              <span>By {e.actorName}{e.aiModel ? <> · {e.aiModel}</> : null}</span>
              <div className="flex items-center gap-2">
                {props.fetchDiff && (e.beforeExcerpt || e.afterExcerpt) && (
                  <button
                    type="button"
                    onClick={() => void toggleExpand(e.id)}
                    className="rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                    data-action="toggle-diff"
                  >
                    {expandedId === e.id ? 'Hide change' : 'Show change'}
                  </button>
                )}
                {e.canRevert && (
                  <button
                    type="button"
                    onClick={() => setPending({
                      editHistoryId:      e.id,
                      actorName:          e.actorName,
                      createdAt:          e.createdAt,
                      origin:             e.origin,
                      interveningCount:   e.interveningCount,
                      interveningByActor: e.interveningByActor,
                    })}
                    className="rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                  >Revert to this point</button>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>

      {revert.isError && (
        <p className="mt-3 text-[12px] text-rose-600">
          {revert.error instanceof ApiError && revert.error.status === 409
            ? `This entry can no longer be reverted — the ${subject} has moved on.`
            : revert.error instanceof ApiError && revert.error.status === 422
            ? 'No snapshot stored for this entry — revert unavailable.'
            : 'Revert failed. See console.'}
        </p>
      )}

      {pending && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          onClick={() => setPending(null)}
        >
          <div className="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl" onClick={e => e.stopPropagation()}>
            <p className="text-[14px] font-semibold text-slate-900">Revert this change?</p>
            <p className="mt-2 text-[12px] text-slate-600">
              The {subject} will be restored to the state before{' '}
              <strong>{pending.actorName}</strong>'s {originLabel(pending.origin).toLowerCase()}{' '}
              on {new Date(pending.createdAt).toLocaleString()}.
            </p>
            {pending.interveningCount > 0 && (
              <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-2.5 text-[12px] text-amber-800">
                <p className="font-semibold">
                  This will discard {pending.interveningCount} later edit{pending.interveningCount === 1 ? '' : 's'}:
                </p>
                <ul className="mt-1 list-disc pl-5">
                  {pending.interveningByActor.map(a => (
                    <li key={a.actorId}>{a.actorName}: {a.count}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setPending(null)}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-[12px] font-semibold text-slate-700 hover:bg-slate-50"
              >Cancel</button>
              <button
                type="button"
                onClick={() => revert.mutate(pending.editHistoryId)}
                disabled={revert.isPending}
                className="rounded-md bg-rose-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-rose-700 disabled:bg-slate-300"
              >{revert.isPending ? 'Reverting…' : 'Revert'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// --- helpers ----------------------------------------------------------------

const ORIGIN_CHIP_LABEL: Record<OriginFilter, string> = {
  all:    'All',
  ai:     'AI only',
  manual: 'Manual',
  undo:   'Undos',
  restore: 'Restore',
}

function originLabel(o: string): string {
  switch (o) {
    case 'ai':      return 'AI'
    case 'manual':  return 'Manual'
    case 'undo':    return 'Revert'
    case 'restore': return 'Restore'
    default:        return o
  }
}

function originBadgeClass(o: string): string {
  switch (o) {
    case 'ai':      return 'bg-blue-50 text-blue-700'
    case 'manual':  return 'bg-slate-100 text-slate-700'
    case 'undo':    return 'bg-amber-50 text-amber-700'
    case 'restore': return 'bg-emerald-50 text-emerald-700'
    default:        return 'bg-slate-100 text-slate-700'
  }
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime()
  const now = Date.now()
  const diffSec = Math.round((now - then) / 1000)
  if (diffSec < 60) return 'just now'
  if (diffSec < 3600) return `${Math.round(diffSec / 60)}m ago`
  if (diffSec < 86400) return `${Math.round(diffSec / 3600)}h ago`
  if (diffSec < 7 * 86400) return `${Math.round(diffSec / 86400)}d ago`
  return new Date(iso).toLocaleDateString()
}
