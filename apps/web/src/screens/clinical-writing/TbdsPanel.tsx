// TBD panel — the second tab in SectionNavigator's left sidebar.
//
// Lists every "[TBD: ...]" placeholder across the current document, grouped
// by placeholder text, with per-group:
//   - total occurrence badge
//   - expandable list of sections it appears in (click a chip → jump + focus)
//   - "Replace in all N" inline input + button that fires one batched
//     server-side search-and-replace via POST /documents/:id/tbd-replace
//
// Shows only the message text ("protocol number") not the full
// "[TBD: ...]" syntax — the writer's goal is to fill the placeholder, not
// re-type the brackets.

import { useMemo, useState } from 'react'
import { useMutation, useQueryClient, useIsFetching } from '@tanstack/react-query'
import type { Section } from '@platform/types'
import { documentsApi } from '../../api/documents'
import { useDocumentStore } from '../../store'
import { scanDocumentForTbds, type TbdGroup } from './tbd-scanner'

interface Props {
  documentId: string
  sections:   Section[]
}

export function TbdsPanel({ documentId, sections }: Props) {
  const groups = useMemo(() => scanDocumentForTbds(sections), [sections])
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  const [autofillResult, setAutofillResult] = useState<Awaited<ReturnType<typeof documentsApi.tbdAutofill>> | null>(null)
  const [autofillError, setAutofillError]   = useState<string | null>(null)
  const qc = useQueryClient()

  // "Document is being refetched" — covers initial drafter streaming, manual
  // refresh, and post-replace invalidation. Shown as a spinner on the
  // Refresh button so the writer knows new data is on the way.
  const isFetchingDoc = useIsFetching({ queryKey: ['document', documentId] }) > 0

  const handleRefresh = () => {
    void qc.invalidateQueries({ queryKey: ['document', documentId] })
    void qc.invalidateQueries({ queryKey: ['ai-draft-status', documentId] })
  }

  const autofillMut = useMutation({
    mutationFn: () => documentsApi.tbdAutofill(documentId),
    onSuccess:  (res) => {
      setAutofillError(null)
      setAutofillResult(res)
      // Refetch document so the applied replacements show up in the
      // section bodies + the groups list re-scans.
      void qc.invalidateQueries({ queryKey: ['document', documentId] })
    },
    onError: (err: unknown) => {
      setAutofillResult(null)
      setAutofillError(err instanceof Error ? err.message : 'Auto-fill failed')
    },
  })

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex flex-none items-center justify-between border-b border-slate-200 bg-white px-3 py-2">
        <span className="font-mono text-[10px] font-medium uppercase tracking-widest text-slate-500">
          {groups.length === 0 ? 'No TBDs' : `${groups.length} TBD group${groups.length === 1 ? '' : 's'}`}
        </span>
        <div className="flex items-center gap-1.5">
          {groups.length > 0 && (
            <button
              type="button"
              onClick={() => autofillMut.mutate()}
              disabled={autofillMut.isPending}
              title="Ask the AI to resolve every TBD from the attached sources"
              data-tbd-autofill
              className="flex items-center gap-1 rounded border border-blue-600 bg-blue-600 px-2 py-0.5 text-[10px] font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {autofillMut.isPending ? 'Auto-filling…' : 'Auto-fill from sources'}
            </button>
          )}
          <button
            type="button"
            onClick={handleRefresh}
            disabled={isFetchingDoc}
            title="Re-scan the document for new TBD placeholders"
            data-tbd-refresh
            className="flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
                 className={isFetchingDoc ? 'animate-spin' : undefined}>
              <path d="M10.5 6a4.5 4.5 0 1 1-1.3-3.2" />
              <polyline points="10.5,1.5 10.5,3.5 8.5,3.5" />
            </svg>
            {isFetchingDoc ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {autofillError && (
        <div className="flex-none border-b border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-800">
          Auto-fill failed: {autofillError}
        </div>
      )}
      {autofillResult && (
        <AutofillResultBanner
          result={autofillResult}
          onDismiss={() => setAutofillResult(null)}
        />
      )}

      {groups.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-5 py-6">
          <p className="text-center text-[12px] italic text-slate-400">
            No TBD placeholders found.<br/>
            The AI drafter inserts <code className="rounded bg-slate-100 px-1 font-mono text-[11px]">[TBD: …]</code> wherever source documents don&rsquo;t contain the fact a section needs.
          </p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          {groups.map(group => {
            const key = group.placeholder
            const isExpanded = expandedKey === key
            return (
              <TbdRow
                key={key}
                group={group}
                documentId={documentId}
                isExpanded={isExpanded}
                onToggle={() => setExpandedKey(isExpanded ? null : key)}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}

interface RowProps {
  group:       TbdGroup
  documentId:  string
  isExpanded:  boolean
  onToggle:    () => void
}

function TbdRow({ group, documentId, isExpanded, onToggle }: RowProps) {
  const focusTbd         = useDocumentStore(s => s.focusTbd)
  const setActiveSection = useDocumentStore(s => s.setActiveSection)
  const qc = useQueryClient()

  const [replacement,  setReplacement]  = useState('')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const replace = useMutation({
    mutationFn: async (next: string) =>
      documentsApi.replaceTbd(documentId, { find: group.placeholder, replace: next }),
    onSuccess: () => {
      setReplacement('')
      setErrorMessage(null)
      void qc.invalidateQueries({ queryKey: ['document', documentId] })
      void qc.invalidateQueries({ queryKey: ['versions', documentId] })
      void qc.invalidateQueries({ queryKey: ['document-audit', documentId] })
    },
    onError: (err: unknown) => {
      setErrorMessage(err instanceof Error ? err.message : 'Replace failed')
    },
  })

  function handleSectionClick(sectionId: string) {
    setActiveSection(sectionId)
    focusTbd(sectionId, group.placeholder)
  }

  function handleReplace() {
    const trimmed = replacement.trim()
    if (!trimmed) {
      setErrorMessage('Enter a replacement value first.')
      return
    }
    setErrorMessage(null)
    replace.mutate(trimmed)
  }

  return (
    <div className="border-b border-slate-200">
      {/* Summary row — click to expand */}
      <button
        type="button"
        onClick={onToggle}
        data-tbd-group={group.placeholder}
        className="flex w-full items-start gap-2 px-3 py-2 text-left text-[12px] hover:bg-slate-100"
      >
        <span
          className="mt-0.5 flex h-4 min-w-[18px] flex-none items-center justify-center rounded-full px-1 font-mono text-[10px] font-bold"
          style={{ backgroundColor: '#FEF3C7', color: '#92400E' }}
          title={`${group.totalCount} occurrence${group.totalCount === 1 ? '' : 's'}`}
        >
          {group.totalCount}
        </span>
        <span className="flex-1 break-words text-slate-700" style={{ fontWeight: isExpanded ? 600 : 500 }}>
          {group.message}
        </span>
        <span
          aria-hidden="true"
          className="mt-0.5 flex-none text-slate-400 transition-transform"
          style={{ transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}
        >
          ▸
        </span>
      </button>

      {/* Expanded — section chips + replace input */}
      {isExpanded && (
        <div className="flex flex-col gap-2 bg-slate-50 px-3 pb-3 pt-1">
          <div className="text-[10px] font-mono uppercase tracking-wider text-slate-500">
            Appears in {group.occurrences.length} section{group.occurrences.length === 1 ? '' : 's'}
          </div>
          <div className="flex flex-wrap gap-1">
            {group.occurrences.map(occ => (
              <button
                key={occ.sectionId}
                type="button"
                onClick={() => handleSectionClick(occ.sectionId)}
                title={occ.sectionTitle}
                className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] text-slate-700 hover:border-blue-400 hover:text-blue-700"
              >
                {occ.sectionNumber}
                {occ.count > 1 && (
                  <span className="ml-1 text-[10px] text-slate-400">×{occ.count}</span>
                )}
              </button>
            ))}
          </div>

          <div className="mt-1 flex flex-col gap-1">
            <label className="text-[10px] font-mono uppercase tracking-wider text-slate-500">
              Replace with
            </label>
            <input
              type="text"
              value={replacement}
              onChange={e => { setReplacement(e.target.value); setErrorMessage(null) }}
              placeholder="e.g. ONC-2024-NOV-001"
              disabled={replace.isPending}
              onKeyDown={e => { if (e.key === 'Enter') handleReplace() }}
              className="h-7 w-full rounded border border-slate-200 bg-white px-2 text-[12px] outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-100 disabled:opacity-50"
            />
            <button
              type="button"
              onClick={handleReplace}
              disabled={replace.isPending || !replacement.trim()}
              className="h-7 rounded bg-blue-600 px-2 text-[11px] font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {replace.isPending
                ? 'Replacing…'
                : `Replace in ${group.occurrences.length} section${group.occurrences.length === 1 ? '' : 's'}`}
            </button>
            {errorMessage && (
              <p className="text-[11px] text-red-600">{errorMessage}</p>
            )}
            {replace.isSuccess && !errorMessage && (
              <p className="text-[11px] text-green-700">
                Replaced {replace.data?.totalOccurrences} across {replace.data?.sectionsAffected} section
                {(replace.data?.sectionsAffected ?? 0) === 1 ? '' : 's'}.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// Result banner shown after /tbd-autofill runs. Three groups —
// filled (applied), unresolvable (model knew why), missed (model
// didn't answer). Writers can dismiss to clear and re-run later.
function AutofillResultBanner({
  result, onDismiss,
}: {
  result: {
    scanned:          number
    filled:           Array<{ tbd: string; value?: string; occurrences: number }>
    unresolvable:     Array<{ tbd: string; reason?: string }>
    missed:           Array<{ tbd: string; reason?: string }>
    sectionsAffected: number
  }
  onDismiss: () => void
}) {
  return (
    <div className="flex-none border-b border-slate-200 bg-sky-50/60 px-3 py-2 text-[11px]" data-tbd-autofill-result>
      <div className="mb-1 flex items-center justify-between">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-sky-900">
          Auto-fill scan — {result.scanned} TBD{result.scanned === 1 ? '' : 's'}
        </span>
        <button
          type="button"
          onClick={onDismiss}
          className="rounded px-1 text-slate-500 hover:bg-slate-200 hover:text-slate-700"
          aria-label="Dismiss"
        >✕</button>
      </div>
      {result.filled.length > 0 && (
        <div className="mb-1.5">
          <p className="font-semibold text-emerald-800">
            Filled from sources ({result.filled.length}) · {result.sectionsAffected} section{result.sectionsAffected === 1 ? '' : 's'} updated
          </p>
          <ul className="mt-0.5 ml-3 list-disc text-emerald-900">
            {result.filled.map(f => (
              <li key={f.tbd} className="break-words">
                <span className="font-semibold">{f.tbd}</span> → <span className="font-mono">{f.value}</span>
                {f.occurrences > 1 && <span className="ml-1 text-slate-500">×{f.occurrences}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {(result.unresolvable.length > 0 || result.missed.length > 0) && (
        <div>
          <p className="font-semibold text-amber-800">
            Not resolvable from sources ({result.unresolvable.length + result.missed.length})
          </p>
          <ul className="mt-0.5 ml-3 list-disc text-amber-900">
            {result.unresolvable.map(u => (
              <li key={u.tbd} className="break-words">
                <span className="font-semibold">{u.tbd}</span> — {u.reason}
              </li>
            ))}
            {result.missed.map(m => (
              <li key={`missed-${m.tbd}`} className="break-words text-slate-600">
                <span className="font-semibold">{m.tbd}</span> — {m.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
      {result.filled.length === 0 && result.unresolvable.length === 0 && result.missed.length === 0 && (
        <p className="text-slate-600">The AI returned nothing to apply. Try again or Replace individual TBDs manually.</p>
      )}
    </div>
  )
}
