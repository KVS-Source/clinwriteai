import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Citation } from '@platform/types'
import { publicationsApi } from '../api'
import type { PubMedRecord } from '../api/publications'
import type { ResizablePanelApi } from '../components/ui/ResizablePanel'
import { SourceChip } from '../components/ui'
import { usePublicationStore } from '../modules/scientific-writing/store'

// --- Static config ---

const MIN_QUERY_LENGTH  = 3
const DEFAULT_QUERY     = 'pembrolizumab NSCLC progression-free survival'
const CITATION_LOCI: Record<string, string> = {
  gandhi:    '§Results ¶2',
  socinski:  '§Methods ¶4',
  garassino: '§Discussion ¶1',
  hellmann:  '§Results ¶3',
}

// --- Helpers ---

function formatClock(iso: string | null | undefined): string {
  const d = iso ? new Date(iso) : new Date()
  const hh = String(d.getUTCHours()).padStart(2, '0')
  const mm = String(d.getUTCMinutes()).padStart(2, '0')
  const ss = String(d.getUTCSeconds()).padStart(2, '0')
  return `${hh}:${mm}:${ss}`
}

// --- Component ---

interface Props {
  publicationId: string
  api:           ResizablePanelApi
}

export function LiteratureCitationPanel({ publicationId, api }: Props) {
  const setActivePanel = usePublicationStore(s => s.setActivePanel)
  const qc             = useQueryClient()

  const [query,          setQuery]          = useState(DEFAULT_QUERY)
  const [abstractOpenId, setAbstractOpenId] = useState<string | null>(null)
  const [justInsertedId, setJustInsertedId] = useState<string | null>(null)
  const [listOpen,       setListOpen]       = useState(true)
  const [toast,          setToast]          = useState<string | null>(null)

  const trimmed   = query.trim()
  const canSearch = trimmed.length >= MIN_QUERY_LENGTH
  const tooShort  = trimmed.length > 0 && trimmed.length < MIN_QUERY_LENGTH

  // Fetch citations (already inserted into publication)
  const { data: citations = [] } = useQuery({
    queryKey: ['citations', publicationId],
    queryFn:  () => publicationsApi.getCitations(publicationId),
    enabled:  !!publicationId,
  })

  // PubMed search
  const { data: pubmedResp } = useQuery({
    queryKey: ['pubmed-search', trimmed],
    queryFn:  () => publicationsApi.pubmedSearch(trimmed),
    enabled:  canSearch,
  })

  const results = useMemo(() => pubmedResp?.results ?? [], [pubmedResp])

  const insertMut = useMutation({
    mutationFn: (record: PubMedRecord) => publicationsApi.insertCitation(publicationId, {
      pmid:       record.pmid,
      title:      record.title,
      shortRef:   record.shortRef,
      fullRef:    record.fullRef,
      locus:      CITATION_LOCI[record.id] ?? '§Results',
      insertedBy: 'Marcus Webb',
    }),
    onSuccess: (_data, variables) => {
      setJustInsertedId(variables.id)
      qc.invalidateQueries({ queryKey: ['citations', publicationId] })
      setToast(`Citation inserted as ${variables.shortRef} in Vancouver style. Reference list updated.`)
      window.setTimeout(() => setJustInsertedId(null), 2400)
    },
  })

  const removeMut = useMutation({
    mutationFn: (citationId: string) => publicationsApi.removeCitation(publicationId, citationId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['citations', publicationId] })
      setToast('Citation removed. Vancouver labels renumbered.')
    },
  })

  // Auto-clear toast
  useEffect(() => {
    if (!toast) return
    const t = window.setTimeout(() => setToast(null), 3000)
    return () => window.clearTimeout(t)
  }, [toast])

  // Match PubMed record → existing citation (by PMID)
  const citationByPmid = useMemo(() => {
    const map = new Map<string, Citation>()
    for (const c of citations) if (c.pmid) map.set(c.pmid, c)
    return map
  }, [citations])

  // Ordered "in this manuscript" list — computes Vancouver labels
  const orderedCitations = useMemo(() => {
    return [...citations].sort((a, b) => new Date(a.insertedAt).getTime() - new Date(b.insertedAt).getTime())
  }, [citations])

  const insertedCount = orderedCitations.length
  const insertedLabels = useMemo(() => {
    const map = new Map<string, string>()
    orderedCitations.forEach((c, i) => map.set(c.id, `[${i + 1}]`))
    return map
  }, [orderedCitations])

  const noResults = canSearch && results.length === 0 && !tooShort

  // Find the top match (first non-inserted result)
  const topMatchId = useMemo(() => {
    return results.find(r => !citationByPmid.has(r.pmid))?.id ?? null
  }, [results, citationByPmid])

  const handleInsert = (record: PubMedRecord) => {
    if (citationByPmid.has(record.pmid)) return
    insertMut.mutate(record)
  }

  const handleRemoveByPmid = (record: PubMedRecord) => {
    const citation = citationByPmid.get(record.pmid)
    if (!citation) return
    removeMut.mutate(citation.id)
  }

  const handleRemoveCitation = (citation: Citation) => {
    if (citation.isSourceDocument) {
      setToast('Source-document citations cannot be removed. Detach it in the source panel instead.')
      return
    }
    removeMut.mutate(citation.id)
  }

  const resultLine = tooShort
    ? 'Type at least three characters to search.'
    : canSearch
      ? `${results.length} result${results.length === 1 ? '' : 's'} · fetched ${formatClock(pubmedResp?.fetchedAt)}`
      : 'Enter a query to search PubMed.'

  const handleReset = () => {
    setQuery('')
    setAbstractOpenId(null)
  }

  return (
    <div className="flex h-full flex-col" data-panel-body="literature">

      {/* Header */}
      <div
        className="flex flex-none flex-col gap-2.5"
        style={{ padding: '14px 16px', borderBottom: '1px solid #E2E8F0' }}
        data-lit-header
      >
        <div className="flex items-center gap-2.5">
          <svg width="15" height="15" viewBox="0 0 14 14" fill="none" stroke="#0D9488" strokeWidth="1.3" className="flex-none">
            <rect x="1.2" y="2" width="5" height="10" rx="1" />
            <rect x="7.8" y="2" width="5" height="10" rx="1" />
          </svg>
          <p className="min-w-0 flex-1 text-sm font-semibold">Literature search</p>
          <button
            type="button"
            onClick={api.widen}
            data-lit-widen
            title="Widen panel"
            className="flex items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100"
            style={{ width: 24, height: 24 }}
          >
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
              <rect x="6.4" y="1.6" width="1.2" height="10.8" rx="0.6" fill="currentColor" />
              <polygon points="4.6,7 1.2,4.4 1.2,9.6" fill="currentColor" />
              <polygon points="9.4,7 12.8,4.4 12.8,9.6" fill="currentColor" />
            </svg>
          </button>
          <button
            type="button"
            onClick={api.narrow}
            data-lit-narrow
            title="Narrow panel"
            className="flex items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100"
            style={{ width: 24, height: 24 }}
          >
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
              <rect x="6.4" y="1.6" width="1.2" height="10.8" rx="0.6" fill="currentColor" />
              <polygon points="1.6,7 5,4.4 5,9.6" fill="currentColor" />
              <polygon points="12.4,7 9,4.4 9,9.6" fill="currentColor" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => setActivePanel(null)}
            data-lit-close
            className="flex items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100"
            style={{ width: 24, height: 24, fontSize: 15 }}
          >×</button>
        </div>
        <span
          className="self-start font-mono font-medium uppercase"
          style={{
            fontSize:        9,
            letterSpacing:   '0.1em',
            backgroundColor: '#F0FDF4',
            color:           '#15803D',
            borderRadius:    4,
            padding:         '4px 7px',
          }}
          data-lit-badge
        >
          PubMed · NCBI
        </span>
      </div>

      {/* Search block */}
      <div
        className="flex flex-none flex-col gap-2"
        style={{ padding: '12px 16px', borderBottom: '1px solid #E2E8F0' }}
      >
        <div className="flex items-center gap-2">
          <div
            className="flex flex-1 min-w-0 items-center gap-2 rounded-md bg-white"
            style={{ border: '1px solid #E2E8F0', padding: '8px 10px' }}
          >
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none" className="flex-none">
              <circle cx="6" cy="6" r="4.2" stroke="#94A3B8" strokeWidth="1.4" />
              <rect x="8.9" y="9.6" width="4.4" height="1.4" rx="0.7" transform="rotate(45 8.9 9.6)" fill="#94A3B8" />
            </svg>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search PubMed…"
              data-lit-search-input
              className="min-w-0 flex-1 border-none bg-transparent text-xs outline-none"
            />
          </div>
          <button
            type="button"
            data-lit-search-btn
            className="flex-none rounded-md text-xs font-semibold text-white transition-colors"
            style={{ height: 34, padding: '0 12px', backgroundColor: '#0D9488' }}
          >
            Search
          </button>
        </div>
        <p className="font-mono text-[10px] font-medium" style={{ color: '#64748B' }} data-lit-result-line>
          {resultLine}
        </p>
      </div>

      {/* Results scroll */}
      <div
        className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-2"
        style={{ padding: '12px 16px' }}
      >
        {tooShort && (
          <div
            className="text-xs leading-relaxed"
            style={{ backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 6, padding: 16, color: '#64748B' }}
            data-lit-short
          >
            Type at least three characters to search PubMed. Results are retrieved live and each citation records its PMID.
          </div>
        )}

        {results.map(record => {
          const isInserted     = citationByPmid.has(record.pmid)
          const isTopMatch     = record.id === topMatchId
          const isJustInserted = record.id === justInsertedId
          const abstractOpen   = abstractOpenId === record.id
          const insertedLabel  = citationByPmid.get(record.pmid)
            ? insertedLabels.get(citationByPmid.get(record.pmid)!.id)
            : `[${insertedCount + 1}]`

          const bg     = isInserted ? '#F8FAFC' : isTopMatch ? '#F0FDFA' : '#FFFFFF'
          const border = isInserted ? '1px solid #E2E8F0' : isTopMatch ? '1px solid #99F6E4' : '1px solid #E2E8F0'

          return (
            <div
              key={record.id}
              className="flex flex-col gap-2"
              style={{ backgroundColor: bg, border, borderRadius: 6, padding: 12 }}
              data-lit-result={record.id}
              data-lit-inserted={isInserted || undefined}
              data-lit-top-match={isTopMatch || undefined}
            >
              {isTopMatch && (
                <span
                  className="self-start font-mono font-medium uppercase"
                  style={{
                    fontSize: 9, letterSpacing: '0.1em',
                    backgroundColor: '#CCFBF1', color: '#0F766E',
                    borderRadius: 3, padding: '3px 6px',
                  }}
                  data-lit-top-badge
                >
                  Most relevant
                </span>
              )}
              <p className="text-[13px] font-semibold leading-relaxed" style={{ color: isInserted ? '#64748B' : '#1E293B' }}>
                {record.title}
              </p>
              <p className="text-xs leading-relaxed" style={{ color: '#64748B' }}>{record.source}</p>
              <div className="flex flex-wrap items-center gap-1.5">
                <span
                  className="font-mono font-medium"
                  style={{ fontSize: 9, color: '#475569', backgroundColor: '#F1F5F9', borderRadius: 3, padding: '3px 6px' }}
                  data-lit-pmid
                >
                  {record.pmid}
                </span>
                <span
                  className="inline-flex items-center gap-1 rounded-full text-[11px] font-semibold"
                  style={{ padding: '3px 8px', backgroundColor: '#F0FDF4', color: '#15803D' }}
                >
                  PubMed ✓
                </span>
              </div>

              {isJustInserted && (
                <div
                  className="text-[11px] font-semibold"
                  style={{
                    color:           '#0F766E',
                    backgroundColor: '#F0FDFA',
                    border:          '1px solid #99F6E4',
                    borderRadius:    4,
                    padding:         '6px 8px',
                  }}
                  data-lit-just-inserted
                >
                  ✓ Inserted as {insertedLabel} — Vancouver format
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2.5">
                {!isInserted && (
                  <button
                    type="button"
                    onClick={() => handleInsert(record)}
                    data-lit-insert={record.id}
                    className="rounded-md bg-white text-xs font-semibold transition-colors hover:bg-teal-50"
                    style={{ padding: '6px 11px', border: '1px solid #0D9488', color: '#0F766E' }}
                  >
                    Insert citation
                  </button>
                )}
                {isInserted && (
                  <>
                    <span
                      className="inline-flex items-center gap-1.5 rounded-full text-[11px] font-semibold"
                      style={{ padding: '4px 9px', backgroundColor: '#F0FDF4', color: '#15803D' }}
                    >
                      ✓ Already in manuscript
                    </span>
                    <button
                      type="button"
                      onClick={() => handleRemoveByPmid(record)}
                      data-lit-remove={record.id}
                      className="text-xs font-semibold text-slate-500 transition-colors hover:text-slate-900"
                    >
                      Remove
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => setAbstractOpenId(abstractOpen ? null : record.id)}
                  data-lit-abstract-toggle={record.id}
                  className="text-xs text-slate-500 transition-colors hover:text-slate-900"
                >
                  {abstractOpen ? 'Hide abstract' : 'View abstract'}
                </button>
              </div>

              {abstractOpen && (
                <div
                  className="text-[11px] leading-relaxed"
                  style={{ backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 4, padding: '8px 10px', color: '#475569' }}
                  data-lit-abstract
                >
                  {record.abstractText}
                </div>
              )}
            </div>
          )
        })}

        {noResults && (
          <div
            className="flex flex-col items-start gap-2 rounded-md bg-white"
            style={{ border: '1px solid #E2E8F0', padding: '20px 16px' }}
            data-lit-no-results
          >
            <p className="text-[13px] font-semibold">No PubMed records match this query</p>
            <p className="text-xs leading-relaxed" style={{ color: '#94A3B8' }}>
              Broaden the terms, or cite a project source document instead.
            </p>
            <button
              type="button"
              onClick={handleReset}
              className="text-xs font-semibold"
              style={{ color: '#0F766E' }}
            >
              Reset search
            </button>
          </div>
        )}

        {/* In this manuscript */}
        <div className="mt-1 flex flex-col gap-2" style={{ borderTop: '1px solid #E2E8F0', paddingTop: 12 }}>
          <button
            type="button"
            onClick={() => setListOpen(v => !v)}
            data-lit-list-toggle
            className="flex items-center gap-2 text-left"
          >
            <span className="min-w-0 flex-1 font-mono text-[11px] font-medium uppercase tracking-widest" style={{ color: '#64748B' }}>
              In this manuscript ({insertedCount})
            </span>
            <svg
              width="10"
              height="10"
              viewBox="0 0 10 10"
              style={{ transform: listOpen ? 'none' : 'rotate(-90deg)' }}
            >
              <polygon points="1,3 9,3 5,8" fill="#64748B" />
            </svg>
          </button>
          {listOpen && (
            <div className="flex flex-col gap-1.5" data-lit-manuscript-list>
              {orderedCitations.map(citation => {
                const label = insertedLabels.get(citation.id) ?? '[?]'
                return (
                  <div
                    key={citation.id}
                    className="flex items-start gap-2 rounded-md"
                    style={{ backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0', padding: '8px 10px' }}
                    data-manuscript-citation={citation.id}
                  >
                    <span className="mt-0.5 flex-none font-mono text-[11px] font-medium" style={{ color: '#0F766E' }}>
                      {label}
                    </span>
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <p className="text-xs leading-relaxed">{citation.shortRef}</p>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-mono text-[10px] font-medium" style={{ color: '#94A3B8' }}>{citation.locus}</span>
                        {citation.isSourceDocument && (
                          <SourceChip label="Clinical Writing" dotColor="#0D9488" size="sm" />
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemoveCitation(citation)}
                      data-manuscript-remove={citation.id}
                      className="flex-none text-[11px] font-semibold text-slate-500 transition-colors hover:text-slate-900"
                    >
                      Remove
                    </button>
                  </div>
                )
              })}
            </div>
          )}
          <p className="text-[11px] leading-relaxed" style={{ color: '#94A3B8' }}>
            Every inserted citation records its PMID or source document version to the audit trail.
          </p>
        </div>
      </div>

      {toast && (
        <div
          className="pointer-events-none fixed left-1/2 z-50 flex -translate-x-1/2 items-center gap-2.5 rounded-lg text-[13px] text-white"
          style={{
            bottom: 20, maxWidth: 560,
            backgroundColor: '#1E293B',
            padding: '12px 16px',
            boxShadow: '0 12px 28px rgba(15,23,42,0.24)',
          }}
          data-lit-toast
        >
          <span className="h-1.5 w-1.5 flex-none rounded-full" style={{ backgroundColor: '#0D9488' }} />
          <span className="leading-relaxed">{toast}</span>
        </div>
      )}
    </div>
  )
}

