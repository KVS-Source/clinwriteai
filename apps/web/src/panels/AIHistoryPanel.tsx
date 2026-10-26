// AI prompt history panel (sPM-history).
//
// Right-rail panel opened by the clock icon next to a section's AI Suggest
// button. Shows every AI prompt fired against the *active* section across
// all versions of the document, newest first.
//
// Scope decisions (confirmed with product):
//   - Section-scoped (not document-wide). The entry point is a per-section
//     icon, not a global toolbar button.
//   - Team-wide visibility (every project member sees every member's prompts
//     for this section).
//   - Prompts live for the life of the document version they belong to;
//     v0.1 prompts stay visible once the doc is on v0.2, just read-only.
//   - Undo is available only for the single most-recent non-undone prompt
//     whose post-call version matches the document's current version.
//     Undo mutates the section HTML in place — NO new DocumentVersion row.
//     Audit trail is kept via an ai_prompt_undone event (hash-sealed chain).

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { documentsApi } from '../api'
import { ApiError } from '../api/client'

interface Props {
  documentId: string
  sectionId: string | null
  sectionLabel?: string
}

export function AIHistoryPanel({ documentId, sectionId, sectionLabel }: Props) {
  const qc = useQueryClient()

  const historyQ = useQuery({
    queryKey: ['ai-history', documentId, sectionId],
    queryFn:  () => documentsApi.getAiHistory(documentId, sectionId!),
    enabled:  !!sectionId,
  })

  const undo = useMutation({
    mutationFn: (aiCallRecordId: string) => documentsApi.undoAiCall(aiCallRecordId),
    onSuccess: () => {
      // Refresh both the document (section content changed in place) + the
      // history list (so canUndo/undoneAt reflect the new state).
      qc.invalidateQueries({ queryKey: ['document', documentId] })
      qc.invalidateQueries({ queryKey: ['ai-history', documentId, sectionId] })
    },
  })

  if (!sectionId) {
    return (
      <div className="flex-1 overflow-y-auto p-4">
        <p className="text-[13px] text-slate-500">Select a section first — AI history is per-section.</p>
      </div>
    )
  }

  if (historyQ.isLoading) {
    return (
      <div className="flex-1 overflow-y-auto p-4">
        <p className="text-[13px] text-slate-500">Loading AI history…</p>
      </div>
    )
  }

  if (historyQ.isError) {
    return (
      <div className="flex-1 overflow-y-auto p-4">
        <p className="text-[13px] text-rose-600">Failed to load AI history.</p>
      </div>
    )
  }

  const data = historyQ.data
  const entries = data?.entries ?? []

  return (
    <div className="flex-1 overflow-y-auto p-4" data-panel="ai-history">
      <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">
        {sectionLabel ?? 'Current section'}
      </p>
      <p className="mt-1 text-[13px] text-slate-700">
        Every AI prompt fired on this section, across all versions. Undo is
        available only for the most recent change on the current version —
        it reverts the section in place without creating a new document
        version.
      </p>

      {entries.length === 0 && (
        <p className="mt-6 rounded-md border border-dashed border-slate-300 bg-slate-50 p-4 text-center text-[12px] text-slate-500">
          No AI prompts yet. Fire one from AI Suggest and it'll appear here.
        </p>
      )}

      <ul className="mt-4 flex flex-col gap-3">
        {entries.map(e => {
          const isUndone = !!e.undoneAt
          const isCurrentVersion = e.postCallDocumentVersionId === data?.currentVersionId
          return (
            <li
              key={e.id}
              className={`rounded-md border p-3 ${isUndone ? 'border-slate-200 bg-slate-50 opacity-70' : 'border-slate-300 bg-white'}`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${intentBadgeClass(e.intent)}`}
                  >
                    {humanIntent(e.intent)}
                  </span>
                  {!isCurrentVersion && (
                    <span className="rounded-md bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-700">
                      Previous version
                    </span>
                  )}
                  {isUndone && (
                    <span className="rounded-md bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
                      Undone
                    </span>
                  )}
                </div>
                <time className="text-[11px] text-slate-500" title={e.createdAt}>
                  {formatRelative(e.createdAt)}
                </time>
              </div>

              <p className={`mt-2 text-[12px] ${isUndone ? 'text-slate-400 line-through' : 'text-slate-700'}`}>
                {e.promptText && e.promptText.trim() !== '' ? e.promptText : '(no prompt text captured)'}
              </p>

              <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500">
                <span>
                  By {e.actorName} · {e.model}
                </span>
                {e.canUndo && (
                  <button
                    type="button"
                    onClick={() => {
                      // Soft confirmation — the undo swaps section HTML; if the
                      // user has manually edited since, their edits are lost.
                      if (window.confirm('Undo this AI change? Any manual edits made to the section since this AI call will be replaced.')) {
                        undo.mutate(e.id)
                      }
                    }}
                    disabled={undo.isPending}
                    className="rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-50"
                  >
                    {undo.isPending ? 'Undoing…' : 'Undo'}
                  </button>
                )}
              </div>

              {isUndone && e.undoneAt && (
                <p className="mt-1 text-[10px] italic text-slate-500">
                  Undone {formatRelative(e.undoneAt)} by {e.undoneBy ?? 'unknown user'}
                </p>
              )}
            </li>
          )
        })}
      </ul>

      {undo.isError && (
        <p className="mt-3 text-[12px] text-rose-600">
          {undo.error instanceof ApiError && undo.error.status === 409
            ? 'This entry can no longer be undone — the section has moved on.'
            : 'Undo failed. See console.'}
        </p>
      )}
    </div>
  )
}

// --- helpers ----------------------------------------------------------------

const INTENT_LABEL: Record<string, string> = {
  draft_from_source: 'Draft',
  tighten:           'Tighten',
  explain:           'Explain',
  custom:            'Custom',
}

const INTENT_BADGE: Record<string, string> = {
  draft_from_source: 'bg-indigo-50 text-indigo-700',
  tighten:           'bg-blue-50 text-blue-700',
  explain:           'bg-emerald-50 text-emerald-700',
  custom:            'bg-slate-100 text-slate-700',
}

function humanIntent(intent: string): string {
  return INTENT_LABEL[intent] ?? intent
}

function intentBadgeClass(intent: string): string {
  return INTENT_BADGE[intent] ?? 'bg-slate-100 text-slate-700'
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
