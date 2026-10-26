// Section edit history panel (sPM-section-history).
//
// Right-rail panel opened by the clock icon next to a section header.
// Lists every save on the *active* section — manual edits, AI accepts,
// previous reverts, section restores — in reverse chronological order.
// Replaces the AI-only history that shipped as AIHistoryPanel; the
// AI-only view is now a filter chip on the same panel.
//
// Scope decisions (confirmed with product, this iteration):
//   - Section-scoped (one panel per active section)
//   - Default view: "My changes" (actor = current user); toggle to All
//   - Filter chips: All / AI / Manual / Undo
//   - Revert: restores section to the beforeHtml of the chosen row IN
//     PLACE on the current DocumentVersion. If any later edits exist,
//     the confirmation lists how many will be dropped and by whom.

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '../store'
import { documentsApi } from '../api'
import { ApiError } from '../api/client'

interface Props {
  documentId: string
  sectionId: string | null
  sectionLabel?: string
}

type OriginFilter = 'all' | 'ai' | 'manual' | 'undo'

export function SectionHistoryPanel({ documentId, sectionId, sectionLabel }: Props) {
  const qc = useQueryClient()
  const currentUserId = useAuthStore(s => s.user?.id ?? null)

  const [scope, setScope]   = useState<'mine' | 'all'>('mine')
  const [origin, setOrigin] = useState<OriginFilter>('all')
  const [pending, setPending] = useState<null | {
    editHistoryId: string
    actorName:     string
    createdAt:     string
    origin:        string
    interveningCount: number
    interveningByActor: Array<{ actorId: string; actorName: string; count: number }>
  }>(null)

  const historyQ = useQuery({
    queryKey: ['section-history', documentId, sectionId, scope, origin],
    queryFn:  () => documentsApi.getSectionHistory(documentId, sectionId!, {
      mine:   scope === 'mine',
      origin: origin === 'all' ? undefined : origin,
    }),
    enabled:  !!sectionId,
  })

  const revert = useMutation({
    mutationFn: (editHistoryId: string) => documentsApi.revertSectionEdit(editHistoryId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['document', documentId] })
      qc.invalidateQueries({ queryKey: ['section-history', documentId, sectionId] })
      setPending(null)
    },
  })

  if (!sectionId) {
    return (
      <div className="flex-1 overflow-y-auto p-4">
        <p className="text-[13px] text-slate-500">Select a section first — history is per-section.</p>
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
        <p className="text-[13px] text-rose-600">Failed to load section history.</p>
      </div>
    )
  }

  const data = historyQ.data
  const entries = data?.entries ?? []

  return (
    <div className="flex-1 overflow-y-auto p-4" data-panel="history">
      <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">
        {sectionLabel ?? 'Current section'}
      </p>
      <p className="mt-1 text-[13px] text-slate-700">
        Every change on this section — manual edits, AI accepts, reverts,
        restores — newest first. Revert restores the section to the state
        captured before that edit; the current version is not bumped.
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
        >All on this section</button>
      </div>

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
          {scope === 'mine'
            ? 'No changes by you yet on this section.'
            : 'No history on this section yet.'}
        </p>
      )}

      <ul className="mt-4 flex flex-col gap-3">
        {entries.map(e => (
          <li
            key={e.id}
            className={`rounded-md border p-3 ${e.origin === 'undo' ? 'border-slate-200 bg-slate-50' : 'border-slate-300 bg-white'}`}
          >
            <div className="flex items-center justify-between">
              <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${originBadgeClass(e.origin)}`}>
                {originLabel(e.origin)}
              </span>
              <time className="text-[11px] text-slate-500" title={e.createdAt}>
                {formatRelative(e.createdAt)}
              </time>
            </div>

            {e.origin === 'ai' && e.promptText && (
              <p className="mt-2 text-[12px] text-slate-700">
                <span className="font-mono text-[10px] uppercase tracking-wider text-slate-500">Prompt · </span>
                {e.promptText}
              </p>
            )}
            {e.origin === 'undo' && (
              <p className="mt-2 text-[12px] italic text-slate-500">
                Reverted an earlier change on this section.
              </p>
            )}

            <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500">
              <span>
                By {e.actorName}
                {e.aiModel ? <> · {e.aiModel}</> : null}
              </span>
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
                >
                  Revert to this point
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>

      {revert.isError && (
        <p className="mt-3 text-[12px] text-rose-600">
          {revert.error instanceof ApiError && revert.error.status === 409
            ? 'This entry can no longer be reverted — the section has moved on.'
            : revert.error instanceof ApiError && revert.error.status === 422
            ? 'No snapshot stored for this entry — revert unavailable.'
            : 'Revert failed. See console.'}
        </p>
      )}

      {/* Confirmation modal — minimal inline overlay (no library). */}
      {pending && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          onClick={() => setPending(null)}
        >
          <div
            className="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl"
            onClick={e => e.stopPropagation()}
          >
            <p className="text-[14px] font-semibold text-slate-900">Revert this change?</p>
            <p className="mt-2 text-[12px] text-slate-600">
              The section will be restored to the state before{' '}
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
