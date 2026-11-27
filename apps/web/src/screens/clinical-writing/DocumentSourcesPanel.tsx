// Sources — the right-hand panel opened by the editor toolbar's "Sources" button (it replaced the left
// sidebar's Sources tab).
//
// Lists the source documents linked to THIS document (GET /documents/:id/sources) as cards: name, category,
// version and how many sections cite it, with search and a category filter. "View" opens a source read-only
// in the panel, in the same SourceViewer the Source References panel uses (PDF, converted Word, text,
// images), with Back to the list. Display only: how sources are stored or used for AI drafting is untouched.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { documentsApi, type DocumentSourceLink } from '../../api/documents'
import { SourceViewer } from '../../panels/SourceReferencesPanel'
import { useDocumentStore } from '../../store'

/** A file is hard to read in the list's width: the panel widens to this while one is open. */
const VIEWER_WIDTH  = 640
const MIN_WIDTH     = 320
const APP_SIDEBAR   = 220

const wrapAnywhere = { overflowWrap: 'anywhere' } as const

export function DocumentSourcesPanel({ documentId, projectId }: { documentId: string; projectId: string }) {
  const { t } = useTranslation()
  const { data, isLoading, isError } = useQuery({
    queryKey: ['document-sources', documentId],
    queryFn:  () => documentsApi.listDocumentSources(documentId),
    retry:    false,
  })
  const items = useMemo(() => data?.items ?? [], [data])

  const [query, setQuery]       = useState('')
  const [category, setCategory] = useState('')
  const categories = useMemo(
    () => [...new Set(items.map(i => i.category).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [items],
  )
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return items.filter(i =>
      (!category || i.category === category)
      && (!q || [i.title, i.fileName, i.category, i.version ?? ''].some(v => v.toLowerCase().includes(q))))
  }, [items, query, category])

  // Viewing a source: widen the panel for reading, and give the width back on Back or close
  // (unless the user has resized it meanwhile).
  const [viewing, setViewing] = useState<DocumentSourceLink | null>(null)
  const setPanelWidth = useDocumentStore(s => s.setPanelWidth)
  const widened = useRef<{ before: number; set: number } | null>(null)
  const restoreWidth = () => {
    const w = widened.current
    widened.current = null
    if (w && useDocumentStore.getState().panelWidth === w.set) setPanelWidth(w.before)
  }
  useEffect(() => () => restoreWidth(), [])   // eslint-disable-line react-hooks/exhaustive-deps -- on close only
  const view = (item: DocumentSourceLink) => {
    const before = useDocumentStore.getState().panelWidth
    const target = Math.max(MIN_WIDTH, Math.min(VIEWER_WIDTH, window.innerWidth - APP_SIDEBAR))
    if (before < target) { widened.current = { before, set: target }; setPanelWidth(target) }
    setViewing(item)
  }
  const back = () => { restoreWidth(); setViewing(null) }

  if (viewing) {
    return (
      <div className="flex min-h-0 flex-1 flex-col" data-panel="sources-viewer">
        <SourceViewer
          projectId={projectId}
          documentId={documentId}
          source={{ id: viewing.uploadId, fileName: viewing.fileName, contentType: viewing.contentType, previewable: viewing.previewable }}
          page={null}
          backLabel={t('page.document_sources_panel.back')}
          onBack={back}
          allowDownload={false}
        />
      </div>
    )
  }

  const filtered = query.trim() !== '' || category !== ''

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-panel="sources">
      {/* Search + category filter */}
      <div className="flex flex-none flex-wrap items-center gap-2 border-b border-slate-200 px-4 py-2.5">
        <div className="relative min-w-[140px] flex-1">
          <input
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            // Esc clears the search first; with nothing typed it closes the panel as usual.
            onKeyDown={e => { if (e.key === 'Escape' && query) { e.preventDefault(); setQuery('') } }}
            placeholder={t('page.document_sources_panel.search_placeholder')}
            aria-label={t('page.document_sources_panel.search_placeholder')}
            data-sources-search
            className="h-8 w-full rounded-md border border-slate-300 bg-white pl-7 pr-2 text-xs outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-100"
          />
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true"
            className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-slate-400">
            <circle cx="6" cy="6" r="4" />
            <line x1="9" y1="9" x2="12" y2="12" strokeLinecap="round" />
          </svg>
        </div>
        <select
          value={category}
          onChange={e => setCategory(e.target.value)}
          aria-label={t('page.document_sources_panel.category_label')}
          data-sources-category
          className="h-8 max-w-full flex-none rounded-md border border-slate-300 bg-white px-2 text-xs text-slate-700 outline-none focus:border-blue-500"
        >
          <option value="">{t('page.document_sources_panel.all_categories')}</option>
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        {isLoading && (
          <p className="px-4 py-6 text-center text-xs italic text-slate-500" data-sources-state="loading">{t('page.document_sources_panel.loading')}</p>
        )}
        {isError && (
          <p role="alert" className="m-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700" data-sources-state="error">
            {t('page.document_sources_panel.error')}
          </p>
        )}
        {!isLoading && !isError && items.length === 0 && (
          <p className="px-4 py-8 text-center text-xs italic text-slate-500" data-sources-state="empty">{t('page.document_sources_panel.empty')}</p>
        )}
        {!isLoading && !isError && items.length > 0 && (
          <>
            {filtered && (
              <p className="px-4 pt-2.5 font-mono text-[10px] text-slate-500" data-sources-showing>
                {t('page.document_sources_panel.showing_count', { shown: visible.length, total: items.length })}
              </p>
            )}
            {visible.length === 0 ? (
              <p className="px-4 py-8 text-center text-xs italic text-slate-500" data-sources-state="no-match">{t('page.document_sources_panel.no_match')}</p>
            ) : (
              <ul className="flex flex-col gap-2 p-3">
                {visible.map(item => <SourceCard key={item.uploadId} item={item} onView={() => view(item)} />)}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function SourceCard({ item, onView }: { item: DocumentSourceLink; onView: () => void }) {
  const { t } = useTranslation()
  const usedIn = item.sections.length
  const name = item.title || item.fileName
  return (
    <li className="flex items-start gap-2.5 rounded-md border border-slate-200 bg-white p-3" data-source-card={item.uploadId}>
      <span
        className="mt-0.5 flex h-5 min-w-[22px] flex-none items-center justify-center rounded-full px-1.5 font-mono text-[10px] font-bold"
        style={{ backgroundColor: usedIn > 0 ? '#DBEAFE' : '#F1F5F9', color: usedIn > 0 ? '#1D4ED8' : '#64748B' }}
        title={usedIn > 0 ? t('page.document_sources_panel.used_in', { count: usedIn }) : t('page.document_sources_panel.not_cited')}
        data-source-usage={usedIn}
      >
        {usedIn}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold leading-snug text-slate-800" style={wrapAnywhere} data-source-name>{name}</p>
        {item.fileName && item.fileName !== name && (
          <p className="mt-0.5 font-mono text-[11px] leading-snug text-slate-500" style={wrapAnywhere}>{item.fileName}</p>
        )}
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {item.category && (
            <span className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[10px] text-slate-600" data-source-category>{item.category}</span>
          )}
          {item.version && (
            <span className="font-mono text-[10px] text-slate-500" data-source-version>v{item.version.replace(/^v/i, '')}</span>
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={onView}
        data-action="view-source"
        className="flex-none rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
      >
        {t('page.document_sources_panel.view')}
      </button>
    </li>
  )
}
