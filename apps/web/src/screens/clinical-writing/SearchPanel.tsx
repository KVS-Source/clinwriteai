// Search tab — fourth tab in SectionNavigator.
//
// Full-text find across the current document's sections, with optional
// Replace-all powered by the existing POST /documents/:id/tbd-replace route
// (despite the name, the route takes arbitrary strings).
//
// Scope toggle: whole document (default) or active section. Case-sensitive
// is off by default (writers search for a word, not a camelCase token).
// Clicking a hit sets the active section and focuses the first occurrence
// via the same pendingTbdFocus hook the TBDs tab uses — one jump mechanism
// for every "take me to this text" surface.

import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { Section } from '@platform/types'
import { documentsApi } from '../../api/documents'
import { useDocumentStore } from '../../store'

interface Props {
  documentId: string
  sections:   Section[]
}

interface Hit {
  sectionId:     string
  sectionNumber: string
  sectionTitle:  string
  /** Plain-text snippet around the first match in this section. */
  snippet:       string
  /** Number of matches in this section. */
  count:         number
}

const CONTEXT_CHARS = 32

export function SearchPanel({ documentId, sections }: Props) {
  const [query,         setQuery]         = useState('')
  const [scope,         setScope]         = useState<'document' | 'section'>('document')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [replacement,   setReplacement]   = useState('')
  const [errorMessage,  setErrorMessage]  = useState<string | null>(null)

  const activeSectionId  = useDocumentStore(s => s.activeSection)
  const setActiveSection = useDocumentStore(s => s.setActiveSection)
  const focusTbd         = useDocumentStore(s => s.focusTbd)
  const qc = useQueryClient()

  const targetSections = useMemo(
    () => scope === 'section' && activeSectionId
      ? sections.filter(s => s.id === activeSectionId)
      : sections,
    [scope, activeSectionId, sections],
  )

  const hits = useMemo(
    () => scanSections(targetSections, query, caseSensitive),
    [targetSections, query, caseSensitive],
  )
  const totalMatches = hits.reduce((n, h) => n + h.count, 0)

  const replace = useMutation({
    mutationFn: (args: { find: string; replace: string }) =>
      documentsApi.replaceTbd(documentId, args),
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

  function handleHitClick(h: Hit) {
    setActiveSection(h.sectionId)
    // Re-use the TBD focus hand-off: the editor's pendingTbdFocus effect
    // walks text nodes for an exact match and flashes it. Works for any
    // string, not only [TBD: ...] markers.
    focusTbd(h.sectionId, query)
  }

  function handleReplaceAll() {
    const trimmedFind = query.trim()
    if (!trimmedFind) { setErrorMessage('Enter a search term first.'); return }
    if (!replacement) { setErrorMessage('Enter a replacement value (or leave blank — but confirm first).'); return }
    setErrorMessage(null)
    replace.mutate({ find: trimmedFind, replace: replacement })
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Search input */}
      <div className="flex-none border-b border-slate-200 bg-white p-3">
        <input
          type="search"
          value={query}
          onChange={e => { setQuery(e.target.value); setErrorMessage(null) }}
          placeholder="Find text in document…"
          className="h-8 w-full rounded-md border border-slate-300 bg-white px-2 text-[12px] outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-100"
          data-search-query
        />

        {/* Scope + options */}
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-600">
          <span className="font-mono text-[10px] uppercase tracking-wider text-slate-500">Scope</span>
          <button
            type="button"
            onClick={() => setScope('document')}
            className="rounded border px-2 py-0.5"
            style={{
              borderColor:     scope === 'document' ? '#2563EB' : '#CBD5E1',
              backgroundColor: scope === 'document' ? '#EFF6FF' : 'white',
              color:           scope === 'document' ? '#1D4ED8' : '#475569',
            }}
          >Document</button>
          <button
            type="button"
            onClick={() => setScope('section')}
            disabled={!activeSectionId}
            title={!activeSectionId ? 'Open a section first' : undefined}
            className="rounded border px-2 py-0.5 disabled:cursor-not-allowed disabled:opacity-50"
            style={{
              borderColor:     scope === 'section' ? '#2563EB' : '#CBD5E1',
              backgroundColor: scope === 'section' ? '#EFF6FF' : 'white',
              color:           scope === 'section' ? '#1D4ED8' : '#475569',
            }}
          >Active section</button>
          <label className="ml-auto flex items-center gap-1">
            <input
              type="checkbox"
              checked={caseSensitive}
              onChange={e => setCaseSensitive(e.target.checked)}
              className="h-3 w-3"
            />
            Case
          </label>
        </div>

        {query && (
          <p className="mt-2 font-mono text-[10px] text-slate-500">
            {totalMatches} match{totalMatches === 1 ? '' : 'es'} in {hits.length} section{hits.length === 1 ? '' : 's'}
          </p>
        )}
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto">
        {query.trim().length === 0 ? (
          <p className="px-5 py-6 text-center text-[12px] italic text-slate-400">
            Type to search. Results update as you type.
          </p>
        ) : hits.length === 0 ? (
          <p className="px-5 py-6 text-center text-[12px] italic text-slate-400">
            No matches.
          </p>
        ) : (
          hits.map(h => (
            <button
              key={h.sectionId}
              type="button"
              onClick={() => handleHitClick(h)}
              className="flex w-full flex-col gap-0.5 border-b border-slate-100 px-3 py-2 text-left text-[12px] hover:bg-slate-100"
              data-search-hit={h.sectionId}
            >
              <span className="flex items-center gap-2">
                <span className="font-semibold text-slate-800">{h.sectionNumber}</span>
                <span className="flex-1 truncate text-slate-600">{h.sectionTitle}</span>
                {h.count > 1 && (
                  <span className="rounded-full bg-amber-50 px-1.5 text-[10px] font-bold text-amber-800">
                    ×{h.count}
                  </span>
                )}
              </span>
              <span className="truncate font-mono text-[11px] text-slate-500">
                …{h.snippet}…
              </span>
            </button>
          ))
        )}
      </div>

      {/* Replace block */}
      <div className="flex-none border-t border-slate-200 bg-slate-50 p-3">
        <div className="text-[10px] font-mono uppercase tracking-wider text-slate-500">Replace with</div>
        <input
          type="text"
          value={replacement}
          onChange={e => { setReplacement(e.target.value); setErrorMessage(null) }}
          placeholder={query ? `Replace every "${query}"…` : 'Enter search text above'}
          disabled={!query || replace.isPending}
          className="mt-1 h-8 w-full rounded-md border border-slate-300 bg-white px-2 text-[12px] outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-100 disabled:opacity-50"
        />
        <button
          type="button"
          onClick={handleReplaceAll}
          disabled={!query || !replacement || replace.isPending || totalMatches === 0}
          className="mt-2 h-8 w-full rounded-md bg-blue-600 px-3 text-[11px] font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {replace.isPending
            ? 'Replacing…'
            : scope === 'document'
              ? `Replace all ${totalMatches} occurrence${totalMatches === 1 ? '' : 's'}`
              : 'Replace in section'}
        </button>
        {errorMessage && (
          <p className="mt-1 text-[11px] text-red-600">{errorMessage}</p>
        )}
        {replace.isSuccess && !errorMessage && (
          <p className="mt-1 text-[11px] text-green-700">
            Replaced {replace.data?.totalOccurrences} across {replace.data?.sectionsAffected} section
            {(replace.data?.sectionsAffected ?? 0) === 1 ? '' : 's'}.
          </p>
        )}
      </div>
    </div>
  )
}

function scanSections(sections: Section[], query: string, caseSensitive: boolean): Hit[] {
  const q = query.trim()
  if (!q) return []
  const flags = caseSensitive ? 'g' : 'gi'
  // Escape regex metacharacters in the search string — writers type text,
  // not patterns, so a '.' should match a literal dot not any character.
  const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags)

  const hits: Hit[] = []
  for (const section of sections) {
    const plain = stripHtml(section.contentHtml || '')
    if (!plain) continue
    re.lastIndex = 0
    const matches = Array.from(plain.matchAll(re))
    if (matches.length === 0) continue
    const first = matches[0]!
    const start = Math.max(0, (first.index ?? 0) - CONTEXT_CHARS)
    const end   = Math.min(plain.length, (first.index ?? 0) + first[0].length + CONTEXT_CHARS)
    hits.push({
      sectionId:     section.id,
      sectionNumber: section.number,
      sectionTitle:  section.title,
      snippet:       plain.slice(start, end).replace(/\s+/g, ' ').trim(),
      count:         matches.length,
    })
  }
  return hits
}

function stripHtml(html: string): string {
  return html
    .replace(/<\/?(p|br|div|li|ul|ol|h[1-6]|blockquote|table|thead|tbody|tr|th|td)\b[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
}
