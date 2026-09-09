import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { MedDRATerm } from '@platform/types'
import { meddraApi } from '../api'
import { useDocumentStore } from '../store'
import meddraFixture from '../data/meddra.json'

const MEDDRA_VERSION      = 'v27.0'
const TOTAL_TERMS         = '80,026'
const SUBSCRIPTION_EXPIRY = '31 Dec 2025'
const DEFAULT_QUERY       = 'pneumonitis'
const MIN_QUERY_LENGTH    = 3

// Static recently-used list — served from fixture at build time
const RECENTLY_USED = meddraFixture.recentlyUsed as MedDRATerm[]

// Derive a "insert into §X.X" section label from the currently-active section id
function sectionLabelFromActive(activeSectionId: string | null): string {
  if (!activeSectionId) return '§12.2'
  const stripped = activeSectionId.replace(/^s/, '').replace(/_/g, '.')
  return `§${stripped}`
}

function SearchIcon({ size = 14, colour = '#94A3B8' }: { size?: number; colour?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" className="flex-none">
      <circle cx="6" cy="6" r="4.2" stroke={colour} strokeWidth="1.4" />
      <rect x="8.9" y="9.6" width="4.4" height="1.4" rx="0.7" transform="rotate(45 8.9 9.6)" fill={colour} />
    </svg>
  )
}

function ClockIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 14 14" fill="none" className="flex-none">
      <circle cx="7" cy="7" r="5.4" stroke="#94A3B8" strokeWidth="1.4" />
      <rect x="6.4" y="3.4" width="1.2" height="4.2" rx="0.6" fill="#94A3B8" />
      <rect x="6.9" y="6.7" width="3.4" height="1.2" rx="0.6" fill="#94A3B8" />
    </svg>
  )
}

interface ResultCardProps {
  term:         MedDRATerm
  isSelected:   boolean
  usedInDoc:    boolean
  sectionLabel: string
  onSelect:     () => void
  onCopy:       () => void
  onInsert:     () => void
}

function ResultCard({ term, isSelected, usedInDoc, sectionLabel, onSelect, onCopy, onInsert }: ResultCardProps) {
  return (
    <div
      className="mx-4 my-2 flex cursor-pointer flex-col gap-1.5 rounded-lg p-3 transition-colors"
      style={
        isSelected
          ? { border: '2px solid #2563EB', backgroundColor: '#EFF6FF' }
          : { border: '1px solid #E2E8F0', backgroundColor: '#FFFFFF' }
      }
      onClick={onSelect}
      data-meddra-result={term.code}
      data-selected={isSelected || undefined}
    >
      <div className="flex items-baseline gap-2">
        <p
          className="min-w-0 overflow-hidden text-ellipsis text-[13px] font-bold"
          style={{ color: isSelected ? '#1D4ED8' : '#1E293B' }}
        >
          {term.pt}
        </p>
        <div className="flex-1" />
        <span className="flex-none font-mono text-[9px] font-medium tracking-wider text-slate-500">PT</span>
      </div>

      <p className="font-mono text-[11px] font-medium text-slate-500">
        MedDRA {MEDDRA_VERSION} · Code: {term.code}
      </p>
      <p className="text-[11px] leading-relaxed text-slate-500">{term.soc}</p>

      {usedInDoc && (
        <p className="text-[11px] font-semibold" style={{ color: '#15803D' }} data-used-in-document>
          ✓ Used in document
        </p>
      )}

      {isSelected && (
        <div className="mt-0.5 flex gap-1.5" data-meddra-actions>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onCopy() }}
            className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-900 hover:bg-slate-50 transition-colors"
            data-meddra-copy
          >
            Copy PT
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onInsert() }}
            className="rounded-md bg-blue-600 px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-blue-700 transition-colors"
            data-meddra-insert
          >
            Insert into {sectionLabel}
          </button>
        </div>
      )}
    </div>
  )
}

interface Props {
  documentId: string
}

export function MedDRAPanel({ documentId }: Props) {
  const activeSection = useDocumentStore(s => s.activeSection)

  const [query, setQuery]                 = useState(DEFAULT_QUERY)
  const [selectedCode, setSelectedCode]   = useState<string | null>('10035742') // Default to first PT (Pneumonitis)
  const [usedTerms, setUsedTerms]         = useState<Set<string>>(new Set(['10035742']))
  const [toast, setToast]                 = useState<string | null>(null)

  const trimmed = query.trim()
  const canSearch = trimmed.length >= MIN_QUERY_LENGTH

  const { data } = useQuery({
    queryKey: ['meddra-search', trimmed],
    queryFn:  () => meddraApi.search(trimmed),
    enabled:  canSearch,
  })

  const results = useMemo(() => data?.results ?? [], [data])

  const sectionLabel = sectionLabelFromActive(activeSection)

  // Toast auto-clear
  useEffect(() => {
    if (!toast) return
    const t = window.setTimeout(() => setToast(null), 1800)
    return () => window.clearTimeout(t)
  }, [toast])

  const handleCopy = (term: MedDRATerm) => {
    const text = `${term.pt} (${term.code})`
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).catch(() => { /* ignore */ })
    }
    setToast(`Copied ${text} to clipboard`)
  }

  const handleInsert = (term: MedDRATerm) => {
    setUsedTerms(prev => {
      const next = new Set(prev)
      next.add(term.code)
      return next
    })
    setToast(`Inserted ${term.pt} into ${sectionLabel}`)
    console.log('[meddra] insert', { documentId, code: term.code, pt: term.pt, section: sectionLabel })
  }

  const handleRecentlySelect = (code: string) => {
    setSelectedCode(code)
  }

  const clearSearch = () => setQuery('')

  return (
    <div className="flex h-full flex-col" data-panel-body="meddra">

      {/* Version chip near header title (rendered inside DocumentEditor's header slot? — here we render inline at top for standalone) */}
      <div className="flex-none border-b border-slate-200 px-4 py-3.5" data-meddra-search>

        {/* Search input */}
        <div className="relative flex items-center">
          <span className="absolute left-3"><SearchIcon size={14} colour="#94A3B8" /></span>
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search MedDRA terms..."
            data-meddra-search-input
            className="w-full rounded-md border border-slate-200 bg-white text-[13px] text-slate-900 outline-none focus:border-blue-600 focus:shadow-focus"
            style={{ padding: '10px 32px 10px 34px' }}
          />
          {query.length > 0 && (
            <button
              type="button"
              onClick={clearSearch}
              className="absolute right-3 text-xs text-slate-500 hover:text-slate-700"
              aria-label="Clear search"
              data-meddra-clear
            >
              ×
            </button>
          )}
        </div>

        {/* Version meta */}
        <div className="mt-1.5 flex items-baseline justify-between gap-2">
          <p className="text-[11px] text-slate-500">
            MedDRA {MEDDRA_VERSION} · {TOTAL_TERMS} terms
          </p>
          <button className="whitespace-nowrap text-[11px] font-semibold text-blue-600 hover:text-blue-700">
            Update to v27.1
          </button>
        </div>
      </div>

      {/* Results + recently used */}
      <div className="flex-1 overflow-y-auto">

        {/* Results header + list */}
        {!canSearch ? (
          <div className="px-4 py-6 text-center text-[12px] text-slate-500" data-meddra-hint>
            Enter at least {MIN_QUERY_LENGTH} characters to search MedDRA {MEDDRA_VERSION}.
          </div>
        ) : (
          <>
            <div className="flex items-baseline justify-between gap-2 px-4 pb-1.5 pt-3">
              <p className="font-mono text-[10px] font-medium uppercase tracking-widest text-slate-500">
                Results for &lsquo;{trimmed}&rsquo;
              </p>
              <p className="whitespace-nowrap text-[11px] text-slate-500">{results.length} matches</p>
            </div>

            {results.map(term => {
              const usedInDoc = term.usedInDocument || usedTerms.has(term.code)
              return (
                <ResultCard
                  key={term.code}
                  term={term}
                  isSelected={selectedCode === term.code}
                  usedInDoc={usedInDoc}
                  sectionLabel={sectionLabel}
                  onSelect={() => setSelectedCode(term.code)}
                  onCopy={() => handleCopy(term)}
                  onInsert={() => handleInsert(term)}
                />
              )
            })}
          </>
        )}

        {/* Recently used */}
        <div className="px-4 pb-1.5 pt-3">
          <p className="font-mono text-[10px] font-medium uppercase tracking-widest text-slate-500">
            Recently used in this document
          </p>
        </div>
        {RECENTLY_USED.map(term => (
          <button
            key={term.code}
            type="button"
            onClick={() => handleRecentlySelect(term.code)}
            className="flex w-full items-center gap-2 px-4 py-2 text-left hover:bg-slate-50 transition-colors"
            style={{ borderBottom: '1px solid #F1F5F9' }}
            data-meddra-recent={term.code}
          >
            <ClockIcon />
            <p className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-xs text-slate-900">
              {term.pt}
            </p>
            <p className="flex-none font-mono text-[10px] font-medium text-slate-500">
              PT · {term.code}
            </p>
            <div className="flex-1" />
            {term.sections?.[0] && (
              <span
                className="flex-none rounded text-[11px] font-semibold text-slate-600"
                style={{ backgroundColor: '#F1F5F9', padding: '2px 6px' }}
              >
                {term.sections[0]}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Footer */}
      <div className="flex-none border-t border-slate-200 px-4 py-3">
        <div className="flex flex-col gap-1">
          <p className="text-[11px] text-slate-500">
            MedDRA subscription: Active · Expires {SUBSCRIPTION_EXPIRY}
          </p>
          <button className="self-start text-xs font-semibold text-blue-600 hover:text-blue-700">
            View full hierarchy →
          </button>
        </div>
        {/* Mock data amber indicator — Phase 1 warning */}
        <div
          className="mt-2 flex items-center gap-1.5 rounded px-2 py-1.5"
          style={{ backgroundColor: '#FFFBEB', border: '1px solid #FDE68A' }}
          data-meddra-mock
        >
          <span className="h-1.5 w-1.5 flex-none rounded-full" style={{ backgroundColor: '#D97706' }} />
          <p className="text-[11px] font-semibold" style={{ color: '#B45309' }}>
            MedDRA {MEDDRA_VERSION} · Mock data — not for production use
          </p>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div
          className="pointer-events-none absolute bottom-4 left-4 right-4 flex justify-center"
          style={{ zIndex: 20 }}
          data-meddra-toast
        >
          <div
            className="pointer-events-auto rounded-md px-3 py-2 text-xs font-semibold text-white shadow-lg"
            style={{ backgroundColor: '#1E293B' }}
          >
            {toast}
          </div>
        </div>
      )}
    </div>
  )
}
