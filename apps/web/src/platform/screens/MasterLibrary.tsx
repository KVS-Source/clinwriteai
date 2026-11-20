import { THERAPEUTIC_AREA_LABEL } from '../../utils/labels'
import { MasterLibraryHeading } from '../components/MasterLibraryHeading'
import { MultiSelect } from '../components/MultiSelect'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { keepPreviousData, useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useTaLabels } from '../../hooks'
import type { MasterLibraryAuditEntry, MasterLibraryItem, ModuleKey } from '@platform/types'
import type { LibraryListParams } from '../api/platformApi'
import { PLATFORM_ACCENT } from '@platform/types'
import { platformApi } from '../api/platformApi'
import { MASTER_DOCUMENT_ITEM_TYPES } from './MasterLibraryShell'
import { usePlatformStore } from '../store/platformStore'
import { describeApiError } from '../../api'
import { api, ApiError } from '../../api/client'
import { SlidePanel } from '../../components/ui/SlidePanel'
import { RowActionsMenu } from '../../components/ui/RowActionsMenu'
import { ProtectedPdfViewer } from '../../components/library/ProtectedPdfViewer'
import { SortIcon } from '../../components/ui/SortIcon'
import { DateTimeRangeFilter, lastDaysRange, rangeToIso, toInputValue, type TimeZoneMode } from '../../components/ui/DateTimeRangeFilter'
import { ACTION_PHRASE_KEYS, AUDIT_ACTION_LABEL_KEYS, EVENT_BADGE_PALETTE } from '../../panels/AuditTrailPanel'

const MODULE_COLOURS: Record<ModuleKey, string> = {
  A: '#2563EB', B: '#0D9488', C: '#7C3AED', D: '#B0200D', E: '#0D9488', platform: PLATFORM_ACCENT.primary,
}

// Document types always offered as filters, merged with whatever the library holds.
const BASE_DOC_TYPES = ['NDA', 'CSR', 'SmPC', 'RMP', 'Blog Post', 'IND', 'KOL Summary', 'Manuscript', 'Clinical Brief', 'HA Response']

const PAGE_SIZES = [10, 20, 50]
// Whole documents only. Best practices have their own page, and single sections can no longer be
// pushed, so the section entries from earlier pushes are kept in the database but not listed here.
const LIST_ITEM_TYPES = MASTER_DOCUMENT_ITEM_TYPES
const SEARCH_DEBOUNCE_MS = 300

type SortKey = 'recent' | 'oldest' | 'name-asc' | 'name-desc' | 'type-asc' | 'type-desc' | 'ta-asc' | 'ta-desc'

function formatDay(iso: string): string {
  const d = new Date(iso)
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${String(d.getUTCDate()).padStart(2, '0')} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  return `${formatDay(iso)}, ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} UTC`
}

// India Standard Time is always UTC+05:30 (no daylight saving), so shift the instant and reuse the UTC formatter's
// fields. Used for every date-and-time in the panels: Provenance chain, Share history, Audit trail.
const IST_OFFSET_MS = (5 * 60 + 30) * 60_000
function formatDateTimeIst(iso: string): string {
  const shifted = new Date(new Date(iso).getTime() + IST_OFFSET_MS).toISOString()
  return formatDateTime(shifted).replace(/ UTC$/, ' IST')
}

const labelClass = 'font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500'
const selectClass = 'h-8 w-full rounded-md border border-slate-300 bg-white px-2 text-[12px]'

export function MasterLibrary() {
  const { t } = useTranslation()

  const queryClient = useQueryClient()
  // Who sees New version and Withdraw: the Project Manager owns the library's content; admins may too (the API still
  // limits everyone to their own tenant's items, and platform-wide items to platform admins).
  // Only a Project Manager adds documents to the library from their computer. Only a Project Manager may
  // share them (SME decision, 2026-11-17); Contributor, Auditor, QC and IT Admin can't (the API enforces the same).
  const hasRole = usePlatformStore(s => s.hasRole)
  const canUpload = hasRole(['pm'])
  const canShare = hasRole(['pm'])

  // Filters start empty — nothing is pre-applied.
  const [search,      setSearch]      = useState('')
  const [docTypes,    setDocTypes]    = useState<string[]>([])
  const [tas,         setTas]         = useState<string[]>([])
  const [sort,        setSort]        = useState<SortKey>('recent')
  const [showWithdrawn, setShowWithdrawn] = useState(false)
  const [page,        setPage]        = useState(1)
  const [pageSize,    setPageSize]    = useState(PAGE_SIZES[1]!)
  const { labels: taLabels } = useTaLabels()

  // Filters, search, sort and paging all run on the server, so the library is
  // not capped at the first page and the total is the real one (CW-061).
  const [debouncedSearch, setDebouncedSearch] = useState('')
  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search.trim()), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(id)
  }, [search])
  const listParams = useMemo<LibraryListParams>(() => ({
    q: debouncedSearch, itemType: LIST_ITEM_TYPES, docType: docTypes, ta: tas,
    sort, includeRetired: showWithdrawn, limit: pageSize,
  }), [debouncedSearch, docTypes, tas, sort, showWithdrawn, pageSize])

  // Any change to a filter, the sort or the page size starts again from page 1.
  useEffect(() => { setPage(1) }, [listParams])
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['library', listParams, page],
    queryFn: () => platformApi.listLibraryPage(listParams, page > 1 ? String((page - 1) * pageSize) : undefined),
    placeholderData: keepPreviousData,
  })
  const items = useMemo(() => data?.items ?? [], [data])
  const total = data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / pageSize))

  // The row whose details are open in the side panel. Kept as a snapshot so it stays open
  // while the list is paged or refiltered underneath it.
  const [selected, setSelected] = useState<MasterLibraryItem | null>(null)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [toast,      setToast]      = useState<string | null>(null)
  // One timer for the toast: a new message replaces the old one and gets its full time (the old timer is cancelled).
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current) }, [])
  const flash = (msg: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setToast(msg)
    toastTimer.current = setTimeout(() => setToast(null), 3600)
  }

  const docTypeOptions = useMemo(
    () => Array.from(new Set([...BASE_DOC_TYPES, ...docTypes, ...items.map(i => i.docType)])).filter(Boolean),
    [items, docTypes],
  )

  const activeFilterCount =
    (search.trim() ? 1 : 0) +
    (docTypes.length ? 1 : 0) + (tas.length ? 1 : 0) +
    (showWithdrawn ? 1 : 0)
  const filtersDirty = activeFilterCount > 0

  function resetFilters() {
    setSearch(''); setDocTypes([]); setTas([])
    setSort('recent'); setShowWithdrawn(false)
  }

  const active = selected ? (items.find(i => i.id === selected.id) ?? selected) : undefined

  // Other versions of the same item (same name, different version) — newest first.
  const versionHistory = useMemo(() => {
    if (!active) return []
    return items
      .filter(i => i.name.toLowerCase() === active.name.toLowerCase())
      .sort((a, b) => new Date(b.pushedAt).getTime() - new Date(a.pushedAt).getTime())
  }, [items, active])

  // A section's note talks about pulling it into documents; a whole document's doesn't.
  const isSectionItem = active?.itemType === 'section'
  const immutabilityNote = active?.isArchived
    ? t(isSectionItem ? 'page.master_library.immutability_archived' : 'page.master_library.immutability_archived_document')
    : t(isSectionItem ? 'page.master_library.immutability_default' : active?.uploaded ? 'page.master_library.immutability_uploaded' : 'page.master_library.immutability_document')

  // A link from a "document shared with you" notification: /master-library/documents?item=<id> opens that
  // document's details. The parameter is removed once read, so closing the panel doesn't reopen it.
  const [searchParams, setSearchParams] = useSearchParams()
  const linkedItemId = searchParams.get('item')
  useEffect(() => {
    if (!linkedItemId) return
    let cancelled = false
    platformApi.getLibraryItem(linkedItemId)
      .then(it => { if (!cancelled) setSelected(it) })
      .catch(() => { if (!cancelled) flash(t('page.master_library.shared_link_missing')) })
      .finally(() => { if (!cancelled) setSearchParams(p => { p.delete('item'); return p }, { replace: true }) })
    return () => { cancelled = true }
  }, [linkedItemId])

  // View and Share each open their own side panel over the details panel. Closing it returns to the
  // details. It also closes when another document is opened, or the details close.
  const [overlay, setOverlay] = useState<'view' | 'share' | null>(null)
  const viewing = overlay === 'view'
  useEffect(() => { setOverlay(null) }, [active?.id])
  // Esc closes only the panel on top, not the details panel under it: this listener runs first (capture) and
  // marks the key handled, which the details panel respects.
  useEffect(() => {
    if (!overlay) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      e.preventDefault()
      setOverlay(null)
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
  }, [overlay])
  const pdfView = useQuery({
    queryKey: ['library-pdf', active?.id],
    queryFn: async () => {
      // Stamped by the API with the reader's email and the time; shown in our own viewer, never the browser's.
      const { blob } = await api.download(`/library/${encodeURIComponent(active!.id)}/pdf`)
      return blob
    },
    enabled: viewing && !!active,
    staleTime: 5 * 60_000,
    retry: false,
  })
  // Share history and Audit trail each have their own side panel, opened from the table's two "View" links (not
  // from the details panel). Opening one closes the details; clicking a row opens the details as before.
  const [sideView, setSideView] = useState<{ kind: 'shares' | 'audit'; item: MasterLibraryItem } | null>(null)
  useEffect(() => { if (selected) setSideView(null) }, [selected])

  const sortFor = (asc: SortKey, desc: SortKey): 'asc' | 'desc' | null => sort === asc ? 'asc' : sort === desc ? 'desc' : null
  const toggleSort = (asc: SortKey, desc: SortKey) => setSort(sort === asc ? desc : asc)
  const SortHead = ({ label, asc, desc }: { label: string; asc: SortKey; desc: SortKey }) => (
    <th className="px-4 py-3 text-left" aria-sort={sort === asc ? 'ascending' : sort === desc ? 'descending' : 'none'}>
      <button type="button" onClick={() => toggleSort(asc, desc)} data-sort={asc}
        className="inline-flex items-center gap-1.5 uppercase tracking-widest hover:text-slate-800">
        {label}<SortIcon state={sortFor(asc, desc)} />
      </button>
    </th>
  )
  const PlainHead = ({ label, center = false }: { label: string; center?: boolean }) => <th className={`px-4 py-3 uppercase tracking-widest ${center ? 'text-center' : 'text-left'}`}>{label}</th>

  const filterControl = 'h-10 w-full rounded-md border border-slate-300 bg-white px-2.5 text-[12px] text-slate-800'

  return (
    <div className="bg-slate-50" data-screen="master-library">
      <div className="flex flex-col gap-4" style={{ maxWidth: 1600, padding: '20px 24px 48px' }}>

        {/* The heading goes up into the Master Library header (above the tabs); the breadcrumb and
            "who you are" line are gone — the top bar carries "Master Library / Master Documents". */}
        <MasterLibraryHeading>
          {/* The Upload button sits in the middle of the header, top to bottom (the header is `relative`, see
              MasterLibraryShell), at its right edge; the text keeps clear of it. */}
          <div className={canUpload ? 'pr-48' : undefined}>
            {/* The item count is on the tab ("Master Documents (2)", MasterLibraryShell), not the title. */}
            <h1 className="text-[20px] font-semibold text-slate-900">{t('page.master_library.tab_documents', { defaultValue: 'Master Documents' })}</h1>
            <p className="mt-0.5 text-[13px] text-slate-500">
              {t('page.master_library.subtitle_documents')}
            </p>
          </div>
          {canUpload && (
            <button type="button" onClick={() => setUploadOpen(true)} data-action="upload-document" data-panel-trigger
              className="absolute right-5 top-1/2 h-9 -translate-y-1/2 whitespace-nowrap rounded-md px-4 text-[13px] font-semibold text-white"
              style={{ backgroundColor: PLATFORM_ACCENT.primary }}>
              {t('page.master_library.upload_button')}
            </button>
          )}
        </MasterLibraryHeading>

        {/* Filters — fill the card's width. At 1100px of content width and up it is one row (search
            twice as wide as each dropdown); narrower, it wraps: search on its own first row, the rest below. */}
        <div className="[container-type:inline-size]" data-filter-panel>
          <div className={`flex flex-wrap items-center gap-3 [@container_(min-width:1100px)]:flex-nowrap`}>
            <input
              type="search" placeholder={t('page.master_library.search_placeholder')} value={search}
              onChange={(e) => setSearch(e.currentTarget.value)}
              data-filter-search aria-label={t('page.master_library.search_aria')}
              className={`${filterControl} basis-full min-w-0 [@container_(min-width:1100px)]:min-w-[180px] [@container_(min-width:1100px)]:flex-[2_1_0%]`}
            />

            <div data-filter-doctype className="min-w-[130px] flex-[1_1_130px] [@container_(min-width:1100px)]:flex-[1_1_0%]">
              <MultiSelect label={t('page.master_library.filter_doc_type')} allLabel={t('page.master_library.all_doc_types')}
                options={docTypeOptions.map(d => ({ value: d, label: d }))} value={docTypes} onChange={setDocTypes}
                optionAttr="data-doctype-chip" className={filterControl} />
            </div>
            <div data-filter-ta className="min-w-[130px] flex-[1_1_130px] [@container_(min-width:1100px)]:flex-[1_1_0%]">
              <MultiSelect label={THERAPEUTIC_AREA_LABEL} allLabel={t('page.master_library.all_ta')}
                options={taLabels.map(ta => ({ value: ta, label: ta }))} value={tas} onChange={setTas}
                optionAttr="data-ta-chip" className={filterControl} />
            </div>

            <button
              type="button"
              onClick={resetFilters}
              disabled={!filtersDirty}
              title={filtersDirty ? t('page.master_library.reset_filters') : t('page.master_library.filters_at_defaults')}
              aria-label={t('page.master_library.reset_filters')}
              className="flex h-10 w-10 flex-none items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900 disabled:cursor-default disabled:opacity-40 disabled:hover:bg-white"
              data-action="reset-filters"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9" />
                <path d="M2.5 2.5v2.8h2.8" />
              </svg>
            </button>
          </div>
        </div>

        {/* Grid */}
        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white" data-results-list>
          {error && (
            <div className="m-3 rounded-md bg-red-50 p-3 text-[12px] text-red-800" role="alert" data-state="error">
              <p className="font-semibold">{t('page.master_library.load_error_title')}</p>
              <p className="mt-0.5">{describeApiError(error).message}</p>
              <button type="button" onClick={() => void refetch()} disabled={isFetching}
                className="mt-2 rounded-md border border-red-300 bg-white px-3 py-1 text-[11px] font-semibold text-red-800 disabled:opacity-50">
                {isFetching ? t('page.master_library.retrying') : t('page.master_library.try_again')}
              </button>
            </div>
          )}

          {/* Fixed column widths (title gets the most room; the rest share the remainder). A narrow window scrolls the table
              sideways inside its card instead of squeezing the columns. */}
          <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] table-fixed border-collapse text-[13px]">
            <colgroup>
              <col style={{ width: '36%' }} /><col style={{ width: '13%' }} /><col style={{ width: '17%' }} />
              <col style={{ width: '9%' }} /><col style={{ width: '14%' }} /><col style={{ width: '11%' }} />
            </colgroup>
            <thead className="border-b border-slate-200 bg-slate-50 font-mono text-[10px] font-semibold text-slate-500">
              <tr>
                <SortHead label={t('page.master_library.col_title')} asc="name-asc" desc="name-desc" />
                <SortHead label={t('page.master_library.filter_doc_type')} asc="type-asc" desc="type-desc" />
                <SortHead label={THERAPEUTIC_AREA_LABEL} asc="ta-asc" desc="ta-desc" />
                <PlainHead label={t('page.master_library.col_version')} />
                <SortHead label={t('page.master_library.col_pushed_on')} asc="oldest" desc="recent" />
                <PlainHead label={t('page.master_library.col_actions')} center />
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-[12px] text-slate-500" data-state="loading">{t('page.master_library.loading_library')}</td></tr>
              )}
              {!isLoading && !error && items.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-[12px] text-slate-500" data-state="empty">
                  {!filtersDirty ? t('page.master_library.empty_library') : t('page.master_library.empty_filters')}
                  {filtersDirty && (
                    <div><button type="button" onClick={resetFilters} className="mt-2 font-semibold text-slate-700 underline">{t('page.master_library.reset_filters')}</button></div>
                  )}
                </td></tr>
              )}
              {items.map(it => {
                const isActive = it.id === active?.id
                return (
                  <tr key={it.id} onClick={() => setSelected(it)} tabIndex={0}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(it) } }}
                    data-library-row={it.id} data-library-active={isActive || undefined} data-library-archived={it.isArchived || undefined}
                    data-panel-trigger aria-current={isActive || undefined}
                    className="cursor-pointer border-b border-slate-100 last:border-b-0 hover:bg-slate-50"
                    style={{ backgroundColor: isActive ? PLATFORM_ACCENT.bgTint : undefined }}>
                    <td className="break-words px-4 py-3 font-semibold text-slate-900 [overflow-wrap:anywhere]">
                      {it.name}
                      {it.isWithdrawn && <span className="ml-2 rounded-md bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold text-red-800">{t('page.master_library.withdrawn_tag')}</span>}
                      {it.isArchived && <span className="ml-2 rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600" data-archived-tag>{t('page.master_library.archived_tag')}</span>}
                      {/* Found only inside the document: say so, with the words around it, so the row isn't a mystery. */}
                      {it.searchMatch === 'text' && (
                        <p className="mt-1 max-w-[640px] text-[12px] font-normal leading-snug text-slate-500" data-search-excerpt>
                          <span className="font-semibold text-slate-600">{t('page.master_library.found_in_text')}</span>{' '}
                          {it.matchExcerpt ? <MatchedWords text={it.matchExcerpt} term={debouncedSearch} /> : null}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-700">{it.docType || '—'}</td>
                    <td className="px-4 py-3 text-slate-700">{(it.ta ?? []).join(', ') || '—'}</td>
                    <td className="px-4 py-3 font-mono text-[12px] text-slate-700">{it.version}</td>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-[12px] text-slate-700">{formatDay(it.pushedAt)}</td>
                    {/* The two buttons open their own side panel and must not also open the details (row click). */}
                    <td className="whitespace-nowrap px-4 py-3 text-center" onClick={e => e.stopPropagation()} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') e.stopPropagation() }}>
                      <div className="flex items-center justify-center gap-2">
                      <button type="button" onClick={() => { setSideView(null); setSelected(it) }}
                        aria-label={`${t('button.open')}: ${it.name}`}
                        className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-900 transition-colors hover:bg-slate-100"
                        data-action="open-document">
                        {t('button.open')}
                      </button>
                      <RowActionsMenu ariaLabel={t('page.master_library.more_actions', { name: it.name })}
                        actions={[
                          { key: 'open-share-history', label: t('page.master_library.share_history'), onSelect: () => { setSelected(null); setSideView({ kind: 'shares', item: it }) } },
                          { key: 'open-audit-trail', label: t('page.master_library.audit_trail'), onSelect: () => { setSelected(null); setSideView({ kind: 'audit', item: it }) } },
                        ]} />
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-slate-200 px-4 py-3" data-pagination>
            <select className="h-9 rounded-md border border-slate-300 bg-white px-2 text-[13px]" value={pageSize}
              onChange={e => setPageSize(Number(e.target.value))} aria-label={t('page.master_library.rows_per_page')} data-page-size>
              {PAGE_SIZES.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
            <div className="flex items-center gap-3 font-mono text-[12px] text-slate-600">
              <span>{t('page.master_library.page_status', { page: Math.min(page, pageCount), pages: pageCount, count: total })}</span>
              <button type="button" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} data-action="prev-page"
                className="h-9 rounded-md border border-slate-300 px-3 text-[13px] text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40">
                ‹ {t('page.master_library.previous')}
              </button>
              <button type="button" onClick={() => setPage(p => Math.min(pageCount, p + 1))} disabled={page >= pageCount} data-action="next-page"
                className="h-9 rounded-md border border-slate-300 px-3 text-[13px] text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40">
                {t('page.master_library.next')} ›
              </button>
            </div>
          </div>
        </section>
      </div>

      {/* Details side panel — opens on a row click */}
      <SlidePanel open={!!active} onClose={() => setSelected(null)} title={active?.name ?? ''} wrapTitle eyebrow={t('page.master_library.details_title')}
        subtitle={active && (
          <>
            <span className="mt-1 flex flex-wrap items-center gap-2" data-active-badges>
              <span className="inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-mono font-semibold uppercase" style={{ backgroundColor: `${MODULE_COLOURS[active.module]}22`, color: MODULE_COLOURS[active.module] }} data-active-module>{active.module}</span>
              <span className="font-mono text-[11px] text-slate-500" data-active-doctype>{active.docType}</span>
              <span className="font-mono text-[11px] text-slate-500">{t('page.master_library.ta_prefix')} {(active.ta ?? []).join(', ')}</span>
              {active.isArchived && (
                <span className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: '#F1F5F9', color: '#475569' }}>{t('page.master_library.archived_tag')}</span>
              )}
            </span>
            <span className="mt-1 block truncate font-mono text-[11px]" data-active-pushed>{t(active.uploaded ? 'page.master_library.uploaded_byline' : 'page.master_library.pushed_byline', { date: formatDay(active.pushedAt), user: active.pushedByName })}</span>
          </>
        )}
        storageKey="library-detail" defaultWidth={520} belowTopBar closeOnOutsideClick>
        {active && (
          // One scroll area (the panel body). pb-20 keeps the last card clear of the floating "Live API" pill.
          <div className="flex min-w-0 flex-col gap-3 px-4 pb-20 pt-4 sm:px-5" data-detail-panel>
            {(active.tags ?? []).length > 0 && (
              <div className="flex flex-wrap gap-1" data-active-tags>
                {(active.tags ?? []).map(tg => <span key={tg} title={tg} className="max-w-full truncate rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">{tg}</span>)}
              </div>
            )}

            <PanelSection title={t('page.master_library.provenance_chain')} data-provenance>
              <FieldGrid>
                {(active.provenanceChain ?? []).map((step, i) => {
                  const cut = step.indexOf(': ')
                  return <Field key={i} label={cut > 0 ? step.slice(0, cut) : step} data-provenance-step={i}>{cut > 0 ? step.slice(cut + 2) : ''}</Field>
                })}
                {/* The library entry: who pushed it and when. */}
                <Field label={t(active.uploaded ? 'page.master_library.meta_uploaded_by' : 'page.master_library.meta_pushed_by')} valueProps={{ 'data-meta-pushed-by': true }}>{active.editedByName ?? active.pushedByName}</Field>
                <Field label={t(active.uploaded ? 'page.master_library.meta_uploaded_at' : 'page.master_library.meta_pushed_at')}>{formatDateTimeIst(active.pushedAt)}</Field>
                {(active.createdByName ?? active.pushedByName) !== (active.editedByName ?? active.pushedByName) && (
                  <Field label={t('page.master_library.meta_first_pushed_by')}>{active.createdByName}</Field>
                )}
                {active.createdAt && active.createdAt !== active.pushedAt && (
                  <Field label={t('page.master_library.meta_first_pushed_at')}>{formatDateTimeIst(active.createdAt)}</Field>
                )}
                <Field label={t('page.master_library.meta_updated')}>{formatDateTimeIst(active.updatedAt ?? active.pushedAt)}</Field>
              </FieldGrid>
            </PanelSection>

            <PanelSection title={t('page.master_library.version_history')} data-version-history>
              <FieldGrid>
                {versionHistory.length <= 1 ? (
                  <Field label={<span className="normal-case">{active.version}</span>}>{t('page.master_library.version_single_value')}</Field>
                ) : versionHistory.map((v, idx) => (
                  <Field key={v.id} label={<span className="normal-case">{v.version}</span>} current={v.id === active.id}>
                    <button type="button" onClick={() => setSelected(v)} data-version-row={v.id}
                      title={t('page.master_library.version_row', { version: v.version, tag: idx === 0 ? t('page.master_library.tag_latest') : t('page.master_library.tag_earlier'), date: formatDay(v.pushedAt), user: v.pushedByName })}
                      className={`max-w-full truncate text-left hover:underline ${v.id === active.id ? 'font-semibold text-slate-900' : 'text-slate-700'}`}>
                      {t('page.master_library.version_row_value', { tag: idx === 0 ? t('page.master_library.tag_latest') : t('page.master_library.tag_earlier'), date: formatDay(v.pushedAt), user: v.pushedByName })}
                    </button>
                  </Field>
                ))}
              </FieldGrid>
            </PanelSection>

            <div className="flex flex-wrap items-center gap-2 pt-1">
              {canShare && !active.isArchived && (
                <button type="button" onClick={() => setOverlay('share')}
                  className="h-9 rounded-md border px-4 text-[13px] font-semibold"
                  style={{ borderColor: PLATFORM_ACCENT.primary, color: PLATFORM_ACCENT.primary }}
                  data-action="share-document"
                >{t('page.master_library.share_document')}</button>
              )}
              <button type="button" onClick={() => setOverlay('view')}
                className="h-9 rounded-md border px-4 text-[13px] font-semibold"
                style={{ borderColor: PLATFORM_ACCENT.primary, color: PLATFORM_ACCENT.primary }}
                data-action="view-document"
              >{t('page.master_library.view_document')}</button>
            </div>

            <p className="rounded-lg p-3 text-[12px] leading-[1.5]"
              style={{ backgroundColor: PLATFORM_ACCENT.bgTint, color: PLATFORM_ACCENT.primary }}
              data-immutability-note
              data-active-archived={active.isArchived || undefined}>{immutabilityNote}</p>
          </div>
        )}
      </SlidePanel>

      {/* Share history / Audit trail — one document's own list, opened from the table */}
      <SlidePanel open={!!sideView} onClose={() => setSideView(null)} storageKey="library-side-view" defaultWidth={460} belowTopBar closeOnOutsideClick
        eyebrow={sideView ? t(sideView.kind === 'shares' ? 'page.master_library.share_history' : 'page.master_library.audit_trail') : undefined}
        title={sideView?.item.name ?? ''} wrapTitle>
        {sideView && (
          <div className="min-w-0 px-5 pb-20 pt-4" data-side-view={sideView.kind}>
            {sideView.kind === 'shares' ? <ShareHistoryList itemId={sideView.item.id} /> : <AuditTrailList key={sideView.item.id} itemId={sideView.item.id} />}
          </div>
        )}
      </SlidePanel>

      {/* Document viewer — its own side panel, opened over the details panel by View. */}
      {active && (
        <SharePanel open={overlay === 'share'} item={active} onClose={() => setOverlay(null)}
          onDone={(msg) => { setOverlay(null); flash(msg); void queryClient.invalidateQueries({ queryKey: ['library-shares', active.id] }); void queryClient.invalidateQueries({ queryKey: ['library-audit', active.id] }) }} />
      )}

      <SlidePanel open={viewing && !!active} onClose={() => setOverlay(null)} title={active?.name ?? ''}
        subtitle={active && <span className="font-mono text-[11px] text-slate-500">{active.docType} · {active.version}</span>}
        storageKey="library-viewer" defaultWidth={860} maxWidth={1400} expandable belowTopBar>
        <div className="flex h-full flex-col bg-slate-100" data-document-viewer>
          {pdfView.isLoading && <p className="p-4 text-[12px] text-slate-500" data-viewer-state="loading">{t('page.master_library.view_loading')}</p>}
          {pdfView.isError && (
            <p className="p-4 text-[12px] text-red-700" role="alert" data-viewer-state="error">
              {t('page.master_library.view_failed')} {describeApiError(pdfView.error).message}
            </p>
          )}
          {viewing && pdfView.data && (
            <div className="min-h-0 flex-1" data-viewer-frame>
              <ProtectedPdfViewer file={pdfView.data} title={active?.name ?? ''} />
            </div>
          )}
        </div>
      </SlidePanel>

      <UploadPanel
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        docTypes={docTypeOptions}
        onDone={(msg) => { setUploadOpen(false); flash(msg); void queryClient.invalidateQueries({ queryKey: ['library'] }); }}
      />

      {toast && (
        <div data-toast role="status"
          className="pointer-events-none fixed bottom-5 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2.5 rounded-lg px-4 py-3 text-[13px]"
          style={{ backgroundColor: '#1E293B', color: '#FFFFFF' }}>
          <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: PLATFORM_ACCENT.primary }} />
          {toast}
        </div>
      )}
    </div>
  )
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const SHARE_MAX_RECIPIENTS = 20

// Share a Master Document (Project Manager only) by email address. A colleague with an account gets a
// notification linking to the document in the app. Anyone else — e.g. a CEO with no account — gets an invitation
// whose link opens the document only after a one-time code emailed to that address is entered, so a forwarded
// link is useless. Switched-off accounts are refused. The share is written to the document's audit trail.
// SSO: when the organisation signs in through an identity provider, recipients will be checked against it
// (not built yet — see apps/api/src/modules/platform/library/share.ts).
function SharePanel({ open, item, onClose, onDone }: {
  open: boolean
  item: MasterLibraryItem
  onClose: () => void
  onDone: (message: string) => void
}) {
  const { t } = useTranslation()
  const [emails,  setEmails]  = useState<string[]>([])
  const [draft,   setDraft]   = useState('')
  const [busy,    setBusy]    = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [refused, setRefused] = useState<string[]>([])

  useEffect(() => { if (!open) { setEmails([]); setDraft(''); setFailure(null); setRefused([]) } }, [open, item.id])

  // Adds what is typed (one address, or several separated by commas, semicolons or spaces). Returns the new
  // list, or null when what is typed can't be added (the reason is shown).
  const commit = (): string[] | null => {
    const parts = draft.split(/[\s,;]+/).map(s => s.trim().toLowerCase()).filter(Boolean)
    if (!parts.length) return emails
    const bad = parts.filter(p => !EMAIL_RE.test(p))
    if (bad.length) { setFailure(t('page.master_library.share_invalid_email', { email: bad[0] })); return null }
    const next = [...new Set([...emails, ...parts])]
    if (next.length > SHARE_MAX_RECIPIENTS) { setFailure(t('page.master_library.share_too_many', { max: SHARE_MAX_RECIPIENTS })); return null }
    setEmails(next); setDraft(''); setFailure(null)
    return next
  }
  const remove = (e: string) => { setEmails(list => list.filter(x => x !== e)); setRefused(r => r.filter(x => x !== e)) }

  async function submit() {
    const list = commit()
    if (!list?.length) return
    setBusy(true); setFailure(null); setRefused([])
    try {
      const res = await platformApi.shareLibraryItem(item.id, list)
      if (res.failed.length && !res.shared.length) {
        setRefused(res.failed)
        setFailure(t('page.master_library.share_failed_all'))
        return
      }
      const invited = res.shared.filter(r => r.kind === 'invite').length
      onDone([
        t('page.master_library.share_success', { count: res.shared.length, name: item.name }),
        invited ? t('page.master_library.share_success_invited', { count: invited }) : '',
        res.failed.length ? t('page.master_library.share_success_failed', { emails: res.failed.join(', ') }) : '',
      ].filter(Boolean).join(' '))
    } catch (err) {
      const body = (err instanceof ApiError ? err.body : null) as { error?: string; emails?: string[] } | null
      if (body?.error === 'recipients_not_allowed' && Array.isArray(body.emails)) {
        setRefused(body.emails)
        setFailure(t('page.master_library.share_not_allowed'))
      } else {
        setFailure(describeApiError(err).message)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <SlidePanel open={open} onClose={onClose} storageKey="library-share" defaultWidth={460} belowTopBar
      title={t('page.master_library.share_panel_title')} subtitle={item.name}>
      <div className="flex flex-col gap-3 p-4" data-share-panel>
        <p className="text-[12px] text-slate-600">{t('page.master_library.share_intro')}</p>
        <label className="flex flex-col gap-1">
          <span className={labelClass}>{t('page.master_library.share_field_emails')}</span>
          <input type="email" multiple className={selectClass} value={draft} placeholder={t('page.master_library.share_placeholder')}
            onChange={e => { setDraft(e.currentTarget.value); setFailure(null) }}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ',' || e.key === ';') { e.preventDefault(); commit() } }}
            onBlur={() => { if (draft.trim()) commit() }}
            data-share-input />
          <span className="text-[11px] text-slate-500">{t('page.master_library.share_hint', { max: SHARE_MAX_RECIPIENTS })}</span>
        </label>

        {emails.length > 0 && (
          <ul className="flex flex-wrap gap-1.5" data-share-recipients>
            {emails.map(e => {
              const bad = refused.includes(e)
              return (
                <li key={e} className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] ${bad ? 'bg-red-50 text-red-700 ring-1 ring-red-200' : 'bg-slate-100 text-slate-700'}`}
                  data-share-recipient={e} data-share-refused={bad || undefined}>
                  {e}
                  <button type="button" onClick={() => remove(e)} aria-label={t('page.master_library.share_remove', { email: e })}
                    className="ml-0.5 rounded-full px-1 text-slate-500 hover:bg-slate-200 hover:text-slate-900">×</button>
                </li>
              )
            })}
          </ul>
        )}

        {failure && <p role="alert" className="rounded-md bg-red-50 p-2 text-[12px] text-red-700" data-share-error>{failure}</p>}

        <div className="flex items-center gap-2">
          <button type="button" onClick={submit} disabled={busy || (!emails.length && !draft.trim())}
            className="h-9 rounded-md px-4 text-[13px] font-semibold text-white disabled:opacity-50"
            style={{ backgroundColor: PLATFORM_ACCENT.primary }} data-action="share-submit">
            {busy ? t('page.master_library.share_sending') : t('page.master_library.share_submit')}
          </button>
          <button type="button" onClick={onClose} className="h-9 rounded-md border border-slate-300 px-4 text-[13px] font-semibold text-slate-700">
            {t('page.master_library.share_cancel')}
          </button>
        </div>
      </div>
    </SlidePanel>
  )
}

// Add a document from the computer (Project Manager only): PDF or Word, to the organisation's library (no project
// is asked for). The API reads the text out of the file, keeps the original PDF, and files it like a pushed document.
function UploadPanel({ open, onClose, docTypes, onDone }: {
  open: boolean
  onClose: () => void
  docTypes: string[]
  onDone: (message: string) => void
}) {
  const { t } = useTranslation()
  const { labels: taLabels } = useTaLabels()
  const fileInput = useRef<HTMLInputElement>(null)
  const [file,      setFile]      = useState<File | null>(null)
  const [title,     setTitle]     = useState('')
  const [docType,   setDocType]   = useState('')
  const [ta,        setTa]        = useState('')
  const [busy,     setBusy]      = useState(false)
  const [failure,   setFailure]   = useState<string | null>(null)

  const reset = () => { setFile(null); setTitle(''); setDocType(''); setTa(''); setFailure(null); if (fileInput.current) fileInput.current.value = '' }
  useEffect(() => { if (!open) reset() }, [open])

  const accepted = (f: File) => /\.(pdf|docx)$/i.test(f.name)
  const chooseFile = (f: File | undefined) => {
    setFailure(null)
    if (!f) { setFile(null); return }
    if (!accepted(f)) { setFile(null); setFailure(t('page.master_library.upload_wrong_type')); if (fileInput.current) fileInput.current.value = ''; return }
    setFile(f)
    if (!title.trim()) setTitle(f.name.replace(/\.[^.]+$/, ''))
  }
  const canSubmit = !!file && !!title.trim() && !!docType && !!ta

  async function submit() {
    if (!canSubmit || !file) return
    setBusy(true); setFailure(null)
    try {
      // The fields go first, then the file: the API reads the fields from the file's part.
      const form = new FormData()
      form.append('title', title.trim()); form.append('docType', docType); form.append('taTag', ta)
      form.append('file', file, file.name)
      await platformApi.uploadLibraryDocument(form)
      onDone(t('page.master_library.upload_success', { name: title.trim() }))
    } catch (err) {
      setFailure(describeApiError(err).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <SlidePanel open={open} onClose={onClose} storageKey="library-upload" defaultWidth={460} belowTopBar closeOnOutsideClick
      title={t('page.master_library.upload_panel_title')} subtitle={t('page.master_library.upload_panel_subtitle')}>
      <div className="flex flex-col gap-3 p-3" data-upload-panel>
        <label className="flex flex-col gap-1">
          <span className={labelClass}>{t('page.master_library.upload_field_file')}</span>
          <input ref={fileInput} type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            onChange={e => chooseFile(e.currentTarget.files?.[0])} data-upload-file
            className="block w-full rounded-md border border-slate-300 bg-white p-1.5 text-[12px] file:mr-3 file:rounded file:border-0 file:bg-slate-100 file:px-3 file:py-1 file:text-[12px] file:font-semibold" />
          <span className="text-[11px] text-slate-500">{t('page.master_library.upload_file_hint')}</span>
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelClass}>{t('page.master_library.field_title')}</span>
          <input className={selectClass} value={title} maxLength={200} onChange={e => setTitle(e.currentTarget.value)} data-upload-title />
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelClass}>{t('page.master_library.upload_field_doc_type')}</span>
          <select className={selectClass} value={docType} onChange={e => setDocType(e.currentTarget.value)} data-upload-doctype>
            <option value="">{t('page.master_library.upload_choose')}</option>
            {docTypes.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelClass}>{t('page.master_library.upload_field_ta')}</span>
          <select className={selectClass} value={ta} onChange={e => setTa(e.currentTarget.value)} data-upload-ta>
            <option value="">{t('page.master_library.upload_choose')}</option>
            {taLabels.map(l => <option key={l} value={l}>{l}</option>)}
          </select>
        </label>
        {failure && <p className="rounded-md bg-red-50 p-2 text-[12px] text-red-800" role="alert" data-upload-error>{failure}</p>}
        <div className="mt-1 flex items-center gap-2">
          <button type="button" onClick={submit} disabled={!canSubmit || busy} data-action="confirm-upload"
            className="h-9 rounded-md px-4 text-[13px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
            style={{ backgroundColor: PLATFORM_ACCENT.primary }}>
            {busy ? t('page.master_library.uploading') : t('page.master_library.upload_submit')}
          </button>
          <button type="button" onClick={onClose} className="h-9 rounded-md px-3 text-[13px] text-slate-600 hover:bg-slate-100">{t('button.cancel')}</button>
        </div>
      </div>
    </SlidePanel>
  )
}

// The excerpt with the searched word marked. Same rule as the API (search.ts): the term at the start of a word.
function MatchedWords({ text, term }: { text: string; term: string }) {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  if (!escaped) return <>{text}</>
  const parts = text.split(new RegExp(`((?<![\\p{L}\\p{N}_])(?=[\\p{L}\\p{N}_])${escaped})`, 'iu'))
  return <>{parts.map((part, i) => i % 2 === 1
    ? <mark key={i} className="rounded-sm bg-amber-100 px-0.5 font-semibold text-slate-900" data-search-hit>{part}</mark>
    : <span key={i}>{part}</span>)}</>
}

// ---------------------------------------------------------------------------------------------------------------
// Details panel building blocks: every section is the same card (title row, optional count, optional collapse),
// and label/value pairs share one two-column grid, so Provenance chain, Version history, Share history and the
// Audit trail line up. Long values wrap; long one-liners truncate with the full text as a tooltip.
// ---------------------------------------------------------------------------------------------------------------

type DataAttrs = { [key: `data-${string}`]: unknown }

function PanelSection({ title, children, ...data }: { title: string; children: ReactNode } & DataAttrs) {
  return (
    <section className="min-w-0 rounded-lg border border-slate-200 bg-white" {...data}>
      <div className="px-3.5 py-2.5"><span className={labelClass}>{title}</span></div>
      <div className="border-t border-slate-100 px-3.5 py-3">{children}</div>
    </section>
  )
}

function FieldGrid({ children }: { children: ReactNode }) {
  return <dl className="grid grid-cols-[minmax(84px,120px)_minmax(0,1fr)] items-baseline gap-x-3 gap-y-2">{children}</dl>
}

function Field({ label, children, current = false, valueProps, ...data }: {
  label: ReactNode; children?: ReactNode; current?: boolean; valueProps?: DataAttrs
} & DataAttrs) {
  return (
    <>
      <dt className={`${labelClass} break-words`} {...data}>{label}</dt>
      <dd className={`min-w-0 break-words text-[12px] ${current ? 'font-semibold text-slate-900' : 'text-slate-800'}`} {...valueProps}>{children}</dd>
    </>
  )
}

// Share history: one compact row per share — who it went to and when, with who shared it underneath in small
// text. Newest first, every share (from the permanent audit trail).
function ShareHistoryList({ itemId }: { itemId: string }) {
  const { t } = useTranslation()
  const query = useQuery({ queryKey: ['library-shares', itemId], queryFn: () => platformApi.listLibraryItemShares(itemId) })
  const rows = query.data ?? []
  if (query.isLoading) return <p className="text-[12px] text-slate-500" data-share-history-state="loading">{t('page.master_library.share_history_loading')}</p>
  if (query.error) return <p className="text-[12px] text-red-700" data-share-history-state="error">{t('page.master_library.share_history_failed')}</p>
  if (!rows.length) return <p className="text-[12px] text-slate-500" data-share-history-state="empty">{t('page.master_library.share_history_empty')}</p>
  return (
    <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white px-3.5" data-share-history>
      {rows.map((s, i) => {
        const by = s.sharedBy ?? t('page.master_library.shared_by_unknown')
        return (
          // The date sits right-aligned on the email's line; on a narrow panel it drops under the email instead of squeezing it.
          <li key={i} className="flex min-w-0 flex-wrap items-start justify-between gap-x-3 gap-y-1 py-2.5" data-share-history-row>
            <div className="min-w-0 flex-1 basis-[11rem]">
              <p className="break-words text-[12px] text-slate-800 [overflow-wrap:anywhere]" title={`${t('page.master_library.shared_with')}: ${s.sharedWith}`} data-shared-with>{s.sharedWith}</p>
              <p className="break-words text-[11px] text-slate-500 [overflow-wrap:anywhere]" title={`${t('page.master_library.shared_by')}: ${by}`} data-shared-by>{t('page.master_library.shared_by_line', { name: by })}</p>
            </div>
            <span className="flex-none whitespace-nowrap pt-0.5 font-mono text-[10px] text-slate-500" title={t('page.master_library.shared_at')} data-shared-at>{formatDateTimeIst(s.sharedAt)}</span>
          </li>
        )
      })}
    </ul>
  )
}

// Audit trail: this document's Master Library activity only — uploaded, pushed / auto-pushed, viewed, shared,
// invitation opened, locked out. Newest first, a page at a time. The date range at the top (the same picker as the
// main Audit Trail page) is the only thing that decides which entries appear; it opens on the last 7 days and
// Clear goes back to that. Read-only, and deliberately no export / download / print. Badges and phrases are the
// Clinical Writing Audit Trail panel's own.
const AUDIT_PAGE_SIZE = 50
const DEFAULT_DAYS = 7
function AuditTrailList({ itemId }: { itemId: string }) {
  const { t } = useTranslation()
  const [tz, setTz] = useState<TimeZoneMode>('local')
  const [range, setRange] = useState(() => lastDaysRange(DEFAULT_DAYS, 'local'))
  const rangeInvalid = !!range.from && !!range.to && range.from > range.to
  const period = useMemo(() => ({ from: rangeToIso(range.from, 'start', tz), to: rangeToIso(range.to, 'end', tz) }), [range, tz])
  // Switching the timezone keeps the range pointing at the same moments (as on the main Audit Trail page).
  function changeTz(next: TimeZoneMode) {
    const convert = (v: string, edge: 'start' | 'end') => (v ? toInputValue(new Date(rangeToIso(v, edge, tz)!), next) : '')
    setRange({ from: convert(range.from, 'start'), to: convert(range.to, 'end') }); setTz(next)
  }
  const trail = useInfiniteQuery({
    queryKey: ['library-audit', itemId, period.from ?? null, period.to ?? null],
    queryFn: ({ pageParam }) => platformApi.listLibraryItemAudit(itemId, pageParam, AUDIT_PAGE_SIZE, period),
    initialPageParam: 0,
    getNextPageParam: (last) => {
      const next = last.offset + last.entries.length
      return last.entries.length && next < last.total ? next : undefined
    },
    enabled: !rangeInvalid,
    placeholderData: keepPreviousData,
  })
  const entries = trail.data?.pages.flatMap(p => p.entries) ?? []
  const total = trail.data?.pages[0]?.total ?? 0
  return (
    <div data-library-audit-panel>
      <div className="mb-3" data-audit-dates>
        <DateTimeRangeFilter from={range.from} to={range.to} tz={tz} invalid={rangeInvalid}
          // Clear goes back to the default (last 7 days) instead of an empty range.
          onChange={r => setRange(r.from || r.to ? r : lastDaysRange(DEFAULT_DAYS, tz))} onTzChange={changeTz}
          align="left" buttonClassName="h-9 w-full" />
      </div>
      {rangeInvalid && <p className="mb-2 text-[12px] text-red-700">{t('page.master_library.date_range_invalid')}</p>}
      {trail.isLoading ? (
        <p className="text-[12px] text-slate-500" data-library-audit-state="loading">{t('page.master_library.audit_trail_loading')}</p>
      ) : trail.error ? (
        <p className="text-[12px] text-red-700" data-library-audit-state="error">{t('page.master_library.audit_trail_failed')}</p>
      ) : !entries.length ? (
        <p className="text-[12px] text-slate-500" data-library-audit-state="empty">{t('page.master_library.audit_period_empty')}</p>
      ) : (
        <div className="rounded-lg border border-slate-200 bg-white px-3.5 py-3" data-library-audit>
          <AuditRows entries={entries} />
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <span className="text-[11px] text-slate-500" data-library-audit-count>
              {trail.hasNextPage ? t('page.master_library.audit_trail_count', { shown: entries.length, total }) : t('page.master_library.audit_range_count', { count: total })}
            </span>
            {trail.hasNextPage && (
              <button type="button" onClick={() => void trail.fetchNextPage()} disabled={trail.isFetchingNextPage}
                className="text-[12px] font-semibold hover:underline disabled:opacity-50" style={{ color: PLATFORM_ACCENT.primary }}
                data-action="library-audit-more">
                {trail.isFetchingNextPage ? t('page.master_library.audit_trail_loading') : t('page.master_library.audit_trail_more')}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// Compact timeline rows: time and action badge, then one line — who, what happened and the detail — truncated, with
// the whole line as a tooltip.
function AuditRows({ entries }: { entries: MasterLibraryAuditEntry[] }) {
  const { t } = useTranslation()
  return (
    <ul className="ml-1 border-l border-slate-200">
      {entries.map((e, i) => {
        const rawAction = e.action.replace(/[._]/g, ' ').trim()
        const palette = (e.eventType && EVENT_BADGE_PALETTE[e.eventType]) || { bg: '#F1F5F9', fg: '#475569' }
        const labelKey = e.eventType ? AUDIT_ACTION_LABEL_KEYS[e.eventType] : undefined
        const phraseKey = e.eventType ? ACTION_PHRASE_KEYS[e.eventType] : undefined
        const phrase = phraseKey ? t(phraseKey) : rawAction
        const badge = labelKey ? t(labelKey) : (rawAction || t('page.audit_trail_panel.badge_event_fallback')).toUpperCase()
        // One line: the phrase and the detail. An action with no phrase of its own falls back to its raw name; when its
        // detail is already a sentence ("Master Library copy shared with …") that sentence says it all.
        const sentence = /^[A-Z]/.test(e.detail) && e.detail.includes(' ')
        const what = !e.detail || e.detail === phrase ? phrase : !phraseKey && sentence ? e.detail : `${phrase} — ${e.detail}`
        const when = formatDateTimeIst(e.timestamp)
        return (
          <li key={i} className="relative min-w-0 py-1 pl-3" data-library-audit-row data-action={e.action}>
            <span aria-hidden="true" className="absolute -left-[4px] top-[9px] h-[7px] w-[7px] rounded-full ring-2 ring-white" style={{ backgroundColor: palette.fg }} />
            <div className="flex min-w-0 items-center gap-2">
              <span className="flex-none whitespace-nowrap font-mono text-[10px] text-slate-500" data-audit-when>{when}</span>
              <span className="ml-auto min-w-0 truncate rounded px-1.5 py-px font-mono text-[9px] font-medium tracking-wider"
                title={badge} style={{ backgroundColor: palette.bg, color: palette.fg }}>{badge}</span>
            </div>
            <p className="truncate text-[12px] text-slate-600" title={`${when} · ${e.actor} ${what}`} data-audit-detail>
              <span className="font-semibold text-slate-900" data-audit-who>{e.actor}</span> {what}
            </p>
          </li>
        )
      })}
    </ul>
  )
}
