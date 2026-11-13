import { THERAPEUTIC_AREA_LABEL } from '../../utils/labels'
import { MasterLibraryHeading } from '../components/MasterLibraryHeading'
import { MultiSelect } from '../components/MultiSelect'
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useTaLabels } from '../../hooks'
import type { MasterLibraryItem, MasterLibrarySourceDocument, ModuleKey } from '@platform/types'
import type { LibraryListParams } from '../api/platformApi'
import { PLATFORM_ACCENT } from '@platform/types'
import { platformApi } from '../api/platformApi'
import { MASTER_DOCUMENT_ITEM_TYPES } from './MasterLibraryShell'
import { usePlatformStore } from '../store/platformStore'
import { describeApiError, projectsApi } from '../../api'
import { api, ApiError } from '../../api/client'
import { SlidePanel } from '../../components/ui/SlidePanel'
import { SortIcon } from '../../components/ui/SortIcon'
import { DateTimeRangeFilter, rangeToIso, toInputValue, type TimeZoneMode } from '../../components/ui/DateTimeRangeFilter'

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

type SortKey = 'recent' | 'oldest' | 'name-asc' | 'name-desc'

function formatDay(iso: string): string {
  const d = new Date(iso)
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${String(d.getUTCDate()).padStart(2, '0')} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  return `${formatDay(iso)}, ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} UTC`
}

const labelClass = 'font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500'
const selectClass = 'h-8 w-full rounded-md border border-slate-300 bg-white px-2 text-[12px]'

export function MasterLibrary() {
  const { t } = useTranslation()

  const queryClient = useQueryClient()
  // Who sees New version and Withdraw: the Project Manager owns the library's content; admins may too (the API still
  // limits everyone to their own tenant's items, and platform-wide items to platform admins).
  // Only a Project Manager adds documents to the library from their computer. A PM or a Contributor (the
  // writers and reviewers) may share them; Auditor, QC and IT Admin can't (the API enforces the same).
  const hasRole = usePlatformStore(s => s.hasRole)
  const canUpload = hasRole(['pm'])
  const canShare = hasRole(['pm', 'contributor'])

  // Filters start empty — nothing is pre-applied.
  const [search,      setSearch]      = useState('')
  const [docTypes,    setDocTypes]    = useState<string[]>([])
  const [tas,         setTas]         = useState<string[]>([])
  const [project,     setProject]     = useState('')
  // "Pushed" date-and-time range, the same picker as the Audit Trail: values are YYYY-MM-DDTHH:mm in `tz`.
  const [rangeFrom,   setRangeFrom]   = useState('')
  const [rangeTo,     setRangeTo]     = useState('')
  const [tz,          setTz]          = useState<TimeZoneMode>('local')
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
  const dateRangeInvalid = !!rangeFrom && !!rangeTo && rangeFrom > rangeTo
  const listParams = useMemo<LibraryListParams>(() => ({
    q: debouncedSearch, itemType: LIST_ITEM_TYPES, docType: docTypes, ta: tas,
    projectId: project, from: rangeToIso(rangeFrom, 'start', tz), to: rangeToIso(rangeTo, 'end', tz), sort, includeRetired: showWithdrawn, limit: pageSize,
  }), [debouncedSearch, docTypes, tas, project, rangeFrom, rangeTo, tz, sort, showWithdrawn, pageSize])

  // Any change to a filter, the sort or the page size starts again from page 1.
  useEffect(() => { setPage(1) }, [listParams])
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['library', listParams, page],
    queryFn: () => platformApi.listLibraryPage(listParams, page > 1 ? String((page - 1) * pageSize) : undefined),
    placeholderData: keepPreviousData,
    enabled: !dateRangeInvalid,
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
  // Every project that has something in the library, whoever is signed in (not just the user's own projects).
  const { data: projectList = [] } = useQuery({ queryKey: ['library-projects'], queryFn: () => platformApi.listLibraryProjects() })
  const projectOptions = useMemo(
    () => projectList.map(p => ({ id: p.id, name: p.name })).sort((a, b) => a.name.localeCompare(b.name)),
    [projectList],
  )

  const activeFilterCount =
    (search.trim() ? 1 : 0) +
    (docTypes.length ? 1 : 0) + (tas.length ? 1 : 0) + (project ? 1 : 0) +
    (rangeFrom || rangeTo ? 1 : 0) + (showWithdrawn ? 1 : 0)
  const filtersDirty = activeFilterCount > 0

  function resetFilters() {
    setSearch(''); setDocTypes([]); setTas([])
    setProject(''); setRangeFrom(''); setRangeTo('')
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
  }, [linkedItemId]) // eslint-disable-line react-hooks/exhaustive-deps

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
      const { blob } = await api.download(`/library/${encodeURIComponent(active!.id)}/pdf`)
      // The browser shows the file only if it knows it is a PDF.
      return blob.type === 'application/pdf' ? blob : new Blob([blob], { type: 'application/pdf' })
    },
    enabled: viewing && !!active,
    staleTime: 5 * 60_000,
    retry: false,
  })
  // Object URL for the fetched PDF; revoked when it changes or the viewer closes.
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!viewing || !pdfView.data) { setPdfUrl(null); return }
    const u = URL.createObjectURL(pdfView.data)
    setPdfUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [viewing, pdfView.data])

  // Switching the timezone keeps the range pointing at the same moments (as on the Audit Trail).
  function changeTz(next: TimeZoneMode) {
    const convert = (v: string) => (v ? toInputValue(new Date(rangeToIso(v, 'start', tz)!), next) : '')
    setRangeFrom(convert(rangeFrom)); setRangeTo(convert(rangeTo)); setTz(next)
  }

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
  const PlainHead = ({ label }: { label: string }) => <th className="px-4 py-3 text-left uppercase tracking-widest">{label}</th>

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
            <div data-filter-project className="min-w-[130px] flex-[1_1_130px] [@container_(min-width:1100px)]:flex-[1_1_0%]">
              <MultiSelect single label={t('page.master_library.filter_project')} allLabel={t('page.master_library.all_projects')}
                options={projectOptions.map(p => ({ value: p.id, label: p.name }))} value={project ? [project] : []} onChange={v => setProject(v[0] ?? '')}
                optionAttr="data-project-option" className={filterControl} />
            </div>

            <div className="flex flex-none items-center gap-1.5" data-filter-dates>
              <DateTimeRangeFilter from={rangeFrom} to={rangeTo} tz={tz} invalid={dateRangeInvalid}
                onChange={r => { setRangeFrom(r.from); setRangeTo(r.to) }} onTzChange={changeTz}
                align="left" buttonClassName="h-10 w-[220px]" />
            </div>

            <label className="flex flex-none items-center gap-1.5 whitespace-nowrap text-[12px] text-slate-700" data-filter-withdrawn>
              <input type="checkbox" checked={showWithdrawn} onChange={e => setShowWithdrawn(e.currentTarget.checked)} style={{ accentColor: PLATFORM_ACCENT.primary }} />
              {t('page.master_library.show_withdrawn')}
            </label>

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
        {dateRangeInvalid && <p className="-mt-2 text-[12px] text-red-700">{t('page.master_library.date_range_invalid')}</p>}

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

          <table className="w-full border-collapse text-[13px]">
            <thead className="border-b border-slate-200 bg-slate-50 font-mono text-[10px] font-semibold text-slate-500">
              <tr>
                <SortHead label={t('page.master_library.col_title')} asc="name-asc" desc="name-desc" />
                <PlainHead label={t('page.master_library.filter_doc_type')} />
                <PlainHead label={THERAPEUTIC_AREA_LABEL} />
                <PlainHead label={t('page.master_library.col_version')} />
                <PlainHead label={t('page.master_library.filter_project')} />
                <SortHead label={t('page.master_library.col_pushed_on')} asc="oldest" desc="recent" />
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
                    <td className="px-4 py-3 font-semibold text-slate-900">
                      {it.name}
                      {it.isWithdrawn && <span className="ml-2 rounded-md bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold text-red-800">{t('page.master_library.withdrawn_tag')}</span>}
                      {it.isArchived && <span className="ml-2 rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600" data-archived-tag>{t('page.master_library.archived_tag')}</span>}
                    </td>
                    <td className="px-4 py-3 text-slate-700">{it.docType || '—'}</td>
                    <td className="px-4 py-3 text-slate-700">{(it.ta ?? []).join(', ') || '—'}</td>
                    <td className="px-4 py-3 font-mono text-[12px] text-slate-700">{it.version}</td>
                    <td className="px-4 py-3 text-slate-700">{it.projectName || '—'}</td>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-[12px] text-slate-700">{formatDay(it.pushedAt)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>

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
      <SlidePanel open={!!active} onClose={() => setSelected(null)} title={active?.name ?? ''}
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
          <div className="flex flex-col gap-4 px-5 py-5" data-detail-panel>
            {(active.tags ?? []).length > 0 && (
              <div className="flex flex-wrap gap-1" data-active-tags>
                {(active.tags ?? []).map(tg => <span key={tg} className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">{tg}</span>)}
              </div>
            )}

            <div className="rounded-md border border-slate-200 p-3" data-provenance>
              <p className={labelClass}>{t('page.master_library.provenance_chain')}</p>
              <dl className="mt-2 grid grid-cols-[100px_1fr] gap-x-3 gap-y-1.5 text-[12px]">
                {(active.provenanceChain ?? []).map((step, i) => {
                  const cut = step.indexOf(': ')
                  return (
                    <Fragment key={i}>
                      <dt className={labelClass} data-provenance-step={i}>{cut > 0 ? step.slice(0, cut) : step}</dt>
                      <dd className="text-slate-800">{cut > 0 ? step.slice(cut + 2) : ''}</dd>
                    </Fragment>
                  )
                })}
              </dl>
              {/* The library entry: who pushed it and when. The source document's own people are below. */}
              <dl className="mt-1.5 grid grid-cols-[100px_1fr] gap-x-3 gap-y-1.5 text-[12px]" data-active-meta>
                <dt className={labelClass}>{t(active.uploaded ? 'page.master_library.meta_uploaded_by' : 'page.master_library.meta_pushed_by')}</dt><dd className="text-slate-800" data-meta-pushed-by>{active.editedByName ?? active.pushedByName}</dd>
                <dt className={labelClass}>{t(active.uploaded ? 'page.master_library.meta_uploaded_at' : 'page.master_library.meta_pushed_at')}</dt><dd className="text-slate-800">{formatDateTime(active.pushedAt)}</dd>
                {(active.createdByName ?? active.pushedByName) !== (active.editedByName ?? active.pushedByName) && (
                  <>
                    <dt className={labelClass}>{t('page.master_library.meta_first_pushed_by')}</dt><dd className="text-slate-800">{active.createdByName}</dd>
                  </>
                )}
                {active.createdAt && active.createdAt !== active.pushedAt && (
                  <>
                    <dt className={labelClass}>{t('page.master_library.meta_first_pushed_at')}</dt><dd className="text-slate-800">{formatDateTime(active.createdAt)}</dd>
                  </>
                )}
                <dt className={labelClass}>{t('page.master_library.meta_updated')}</dt><dd className="text-slate-800">{formatDateTime(active.updatedAt ?? active.pushedAt)}</dd>
              </dl>
            </div>

            {active.sourceDocument && <SourceDocumentCard info={active.sourceDocument} />}

            <div className="rounded-md border border-slate-200 p-3" data-version-history>
              <p className={labelClass}>{t('page.master_library.version_history')}</p>
              {versionHistory.length <= 1 ? (
                <p className="mt-1 text-[12px] text-slate-800">{t('page.master_library.version_single', { version: active.version })}</p>
              ) : (
                <ul className="mt-1 flex flex-col gap-1">
                  {versionHistory.map((v, idx) => (
                    <li key={v.id}>
                      <button type="button" onClick={() => setSelected(v)}
                        className={`text-left text-[12px] hover:underline ${v.id === active.id ? 'font-semibold text-slate-900' : 'text-slate-700'}`}>
                        {t('page.master_library.version_row', { version: v.version, tag: idx === 0 ? t('page.master_library.tag_latest') : t('page.master_library.tag_earlier'), date: formatDay(v.pushedAt), user: v.pushedByName })}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
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

            <p className="rounded-md p-2 text-[12px]"
              style={{ backgroundColor: PLATFORM_ACCENT.bgTint, color: PLATFORM_ACCENT.primary }}
              data-immutability-note
              data-active-archived={active.isArchived || undefined}>{immutabilityNote}</p>
          </div>
        )}
      </SlidePanel>

      {/* Document viewer — its own side panel, opened over the details panel by View. */}
      {active && (
        <SharePanel open={overlay === 'share'} item={active} onClose={() => setOverlay(null)}
          onDone={(msg) => { setOverlay(null); flash(msg) }} />
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
          {pdfUrl && (
            <iframe key={pdfUrl} src={pdfUrl} title={active?.name ?? ''}
              className="min-h-0 w-full flex-1 border-0 bg-white" data-viewer-frame />
          )}
        </div>
      </SlidePanel>

      <UploadPanel
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        docTypes={docTypeOptions}
        onDone={(msg) => { setUploadOpen(false); flash(msg); void queryClient.invalidateQueries({ queryKey: ['library'] }); void queryClient.invalidateQueries({ queryKey: ['library-projects'] }) }}
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

const ROLE_ORDER = ['R', 'A', 'C', 'Q', 'I'] as const
const ROLE_KEY: Record<string, string> = { R: 'role_author', A: 'role_approver', C: 'role_reviewer', Q: 'role_qc', I: 'role_informed' }

// The document the item was pushed from: who created it, whose edits are in it, its role
// holders and its signatures. The library entry's own "pushed by" is in the card above.
function SourceDocumentCard({ info }: { info: MasterLibrarySourceDocument }) {
  const { t } = useTranslation()
  const byRole = ROLE_ORDER
    .map(letter => ({ letter, names: (info.team ?? []).filter(m => m.letter === letter).map(m => m.name) }))
    .filter(g => g.names.length > 0)
  const meaning = (m: string) => m ? m.charAt(0).toUpperCase() + m.slice(1) : m
  return (
    <div className="rounded-md border border-slate-200 p-3" data-source-document>
      <p className={labelClass}>{t('page.master_library.source_document')}</p>
      <dl className="mt-2 grid grid-cols-[100px_1fr] gap-x-3 gap-y-1.5 text-[12px]">
        <dt className={labelClass}>{t('page.master_library.meta_created_by')}</dt>
        <dd className="text-slate-800" data-source-created-by>{info.createdByName}</dd>
        <dt className={labelClass}>{t('page.master_library.meta_created_at')}</dt>
        <dd className="text-slate-800">{formatDateTime(info.createdAt)}</dd>
        {info.lastEditedByName && (
          <>
            <dt className={labelClass}>{t('page.master_library.last_edited_by')}</dt>
            <dd className="text-slate-800" data-source-last-edited-by>
              {info.lastEditedByName}{info.lastEditedAt && <span className="text-slate-500"> · {formatDateTime(info.lastEditedAt)}</span>}
            </dd>
          </>
        )}
        {(info.editors ?? []).length > 1 && (
          <>
            <dt className={labelClass}>{t('page.master_library.edited_by')}</dt>
            <dd className="text-slate-800" data-source-editors>{(info.editors ?? []).join(', ')}</dd>
          </>
        )}
      </dl>

      <p className={`${labelClass} mt-3`}>{t('page.master_library.document_team')}</p>
      {info.teamHidden ? (
        <p className="mt-1 text-[12px] text-slate-500" data-team-hidden>{t('page.master_library.team_hidden')}</p>
      ) : byRole.length === 0 ? (
        <p className="mt-1 text-[12px] text-slate-500">{t('page.master_library.no_team')}</p>
      ) : (
        <dl className="mt-2 grid grid-cols-[100px_1fr] gap-x-3 gap-y-1.5 text-[12px]" data-source-team>
          {byRole.map(g => (
            <Fragment key={g.letter}>
              <dt className={labelClass}>{t(`page.master_library.${ROLE_KEY[g.letter]}`)}</dt>
              <dd className="text-slate-800" data-team-role={g.letter}>{g.names.join(', ')}</dd>
            </Fragment>
          ))}
        </dl>
      )}

      {(info.signatures ?? []).length > 0 && (
        <>
          <p className={`${labelClass} mt-3`}>{t('page.master_library.signatures')}</p>
          <ul className="mt-1.5 flex flex-col gap-1 text-[12px]" data-source-signatures>
            {(info.signatures ?? []).map((s, i) => (
              <li key={i} className="text-slate-800">
                <span className="font-semibold">{s.name}</span>
                <span className="text-slate-500"> · {meaning(s.meaning)} · {formatDateTime(s.signedAt)}{s.version ? ` · ${s.version}` : ''}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const SHARE_MAX_RECIPIENTS = 20

// Share a Master Document (Project Manager or Contributor) by email address. A colleague with an account gets a
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

// Add a document from the computer (Project Manager only): PDF or Word, against one of the PM's projects.
// The API reads the text out of the file, keeps the original PDF, and files it like a pushed document.
function UploadPanel({ open, onClose, docTypes, onDone }: {
  open: boolean
  onClose: () => void
  docTypes: string[]
  onDone: (message: string) => void
}) {
  const { t } = useTranslation()
  const { labels: taLabels } = useTaLabels()
  const { data: projects = [] } = useQuery({ queryKey: ['library-upload-projects'], queryFn: () => projectsApi.list(), enabled: open, staleTime: 60_000 })
  const openProjects = projects.filter(p => p.status !== 'closed')
  const fileInput = useRef<HTMLInputElement>(null)
  const [file,      setFile]      = useState<File | null>(null)
  const [title,     setTitle]     = useState('')
  const [docType,   setDocType]   = useState('')
  const [ta,        setTa]        = useState('')
  const [projectId, setProjectId] = useState('')
  const [busy,      setBusy]      = useState(false)
  const [failure,   setFailure]   = useState<string | null>(null)

  const reset = () => { setFile(null); setTitle(''); setDocType(''); setTa(''); setProjectId(''); setFailure(null); if (fileInput.current) fileInput.current.value = '' }
  useEffect(() => { if (!open) reset() }, [open])

  const accepted = (f: File) => /\.(pdf|docx)$/i.test(f.name)
  const chooseFile = (f: File | undefined) => {
    setFailure(null)
    if (!f) { setFile(null); return }
    if (!accepted(f)) { setFile(null); setFailure(t('page.master_library.upload_wrong_type')); if (fileInput.current) fileInput.current.value = ''; return }
    setFile(f)
    if (!title.trim()) setTitle(f.name.replace(/\.[^.]+$/, ''))
  }
  const canSubmit = !!file && !!title.trim() && !!docType && !!ta && !!projectId

  async function submit() {
    if (!canSubmit || !file) return
    setBusy(true); setFailure(null)
    try {
      // The fields go first, then the file: the API reads the fields from the file's part.
      const form = new FormData()
      form.append('title', title.trim()); form.append('docType', docType); form.append('taTag', ta); form.append('projectId', projectId)
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
        <label className="flex flex-col gap-1">
          <span className={labelClass}>{t('page.master_library.upload_field_project')}</span>
          <select className={selectClass} value={projectId} onChange={e => setProjectId(e.currentTarget.value)} data-upload-project>
            <option value="">{t('page.master_library.upload_choose')}</option>
            {openProjects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
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
