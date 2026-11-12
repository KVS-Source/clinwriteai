import { THERAPEUTIC_AREA_LABEL } from '../../utils/labels'
import { MasterLibraryHeading } from '../components/MasterLibraryHeading'
import { MultiSelect } from '../components/MultiSelect'
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useTaLabels } from '../../hooks'
import type { MasterLibraryItem, MasterLibrarySourceDocument, ModuleKey } from '@platform/types'
import type { LibraryListParams } from '../api/platformApi'
import { PLATFORM_ACCENT } from '@platform/types'
import { platformApi } from '../api/platformApi'
import { MASTER_DOCUMENT_ITEM_TYPES } from './MasterLibraryShell'
import { usePlatformStore } from '../store/platformStore'
import { documentsApi, projectsApi, describeApiError } from '../../api'
import { raciApi } from '../../api/raci'
import { api } from '../../api/client'
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
// Mirrors the API's AUTHORING_LOCKED_STATUSES. The web sends statuses with hyphens (in-review), the API with underscores.
const AUTHORING_LOCKED = ['in-review', 'pending-signature', 'signed']
const isAuthoringLocked = (status: string | undefined) => !!status && AUTHORING_LOCKED.includes(status.replace(/_/g, '-'))

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

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const labelClass = 'font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500'
const selectClass = 'h-8 w-full rounded-md border border-slate-300 bg-white px-2 text-[12px]'

export function MasterLibrary() {
  const { t } = useTranslation()

  const queryClient = useQueryClient()
  const canManage = usePlatformStore(s => s.hasRole)(['tenant-admin', 'admin'])

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
  const [pullOpen,   setPullOpen]   = useState(false)
  const [adminAction, setAdminAction] = useState<'version' | 'withdraw' | null>(null)
  const [toast,      setToast]      = useState<string | null>(null)
  // One timer for the toast: a new message replaces the old one and gets its full time (the old timer is cancelled).
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current) }, [])
  const flash = (msg: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setToast(msg)
    toastTimer.current = setTimeout(() => setToast(null), 3600)
  }

  // "Source: …" line stored beside a pulled section; read-only text in the destination.
  const provenanceLine = (item: MasterLibraryItem): string =>
    t('page.master_library.provenance_line', {
      name:    item.name,
      module:  item.module,
      project: item.projectName,
      date:    formatDay(item.pushedAt),
      user:    item.pushedByName,
    })

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

  // The list leaves each document's text out (it can be hundreds of KB); the full item is read once a row is opened.
  // Everything that needs the text (Pull, New version) uses `activeItem` and waits until it has arrived.
  const detailQ = useQuery({
    queryKey: ['library-item', active?.id],
    queryFn:  () => platformApi.getLibraryItem(active!.id),
    enabled:  !!active,
    staleTime: 30_000,
  })
  const bodyReady = !detailQ.isLoading
  const activeItem = active ? { ...active, body: detailQ.data?.body ?? active.body } : undefined

  // Other versions of the same item (same name, different version) — newest first.
  const versionHistory = useMemo(() => {
    if (!active) return []
    return items
      .filter(i => i.name.toLowerCase() === active.name.toLowerCase())
      .sort((a, b) => new Date(b.pushedAt).getTime() - new Date(a.pushedAt).getTime())
  }, [items, active])

  const canPull = !!activeItem && activeItem.itemType === 'section' && !!activeItem.body && !activeItem.isWithdrawn
  const canAdminister = canManage && !!active && active.itemType !== 'best-practice' && !active.isWithdrawn
  const pullLabel = !active ? t('page.master_library.pull_default')
    : active.itemType !== 'section' ? t('page.master_library.pull_sections_only')
    : active.isWithdrawn ? t('page.master_library.pull_withdrawn')
    : !activeItem?.body ? t('page.master_library.pull_no_text')
    : t('page.master_library.pull_default')
  // A whole document can't be pulled, so its note doesn't talk about pulling.
  const isSectionItem = active?.itemType === 'section'
  const immutabilityNote = active?.isArchived
    ? t(isSectionItem ? 'page.master_library.immutability_archived' : 'page.master_library.immutability_archived_document')
    : t(isSectionItem ? 'page.master_library.immutability_default' : 'page.master_library.immutability_document')

  // Download PDF: the server builds a PDF of the item's own text (title + body, no app
  // details) and the browser saves it as a file — no print dialog, no pop-up.
  async function downloadPdf(item: MasterLibraryItem) {
    try {
      const { blob, filename } = await api.download(`/library/${encodeURIComponent(item.id)}/pdf`)
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = filename ?? `${item.name}.pdf`
      document.body.appendChild(link)
      link.click()
      link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
    } catch (err) {
      flash(`${t('page.master_library.pdf_failed')} ${describeApiError(err).message}`)
    }
  }

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
          {/* The item count is on the tab ("Master Documents (2)", MasterLibraryShell), not the title. */}
          <h1 className="text-[20px] font-semibold text-slate-900">{t('page.master_library.tab_documents', { defaultValue: 'Master Documents' })}</h1>
          <p className="mt-0.5 text-[13px] text-slate-500">
            {t('page.master_library.subtitle_documents', { defaultValue: 'Signed documents pushed here from projects. Search and filter the library, and open any document to see its source, team and signatures.' })}
          </p>
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
                <PlainHead label={t('page.master_library.col_pushed_by')} />
                <SortHead label={t('page.master_library.col_pushed_on')} asc="oldest" desc="recent" />
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-[12px] text-slate-500" data-state="loading">{t('page.master_library.loading_library')}</td></tr>
              )}
              {!isLoading && !error && items.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-[12px] text-slate-500" data-state="empty">
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
                    <td className="px-4 py-3 text-slate-700">{it.pushedByName || '—'}</td>
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
            <span className="mt-1 block truncate font-mono text-[11px]" data-active-pushed>{t('page.master_library.pushed_byline', { date: formatDay(active.pushedAt), user: active.pushedByName })}</span>
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
                <dt className={labelClass}>{t('page.master_library.meta_pushed_by')}</dt><dd className="text-slate-800" data-meta-pushed-by>{active.editedByName ?? active.pushedByName}</dd>
                <dt className={labelClass}>{t('page.master_library.meta_pushed_at')}</dt><dd className="text-slate-800">{formatDateTime(active.pushedAt)}</dd>
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
              {/* Only a section's text can be pulled into a document. The library lists whole
                  documents, so for those there is no pull button at all rather than a dead one. */}
              {active.itemType === 'section' && (
                <button type="button" disabled={!canPull} onClick={() => setPullOpen(true)}
                  data-pull-button data-panel-trigger
                  className="h-9 rounded-md px-4 text-[13px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
                  style={{ backgroundColor: PLATFORM_ACCENT.primary }}
                  title={pullLabel}
                >{pullLabel}</button>
              )}
              <button type="button" onClick={() => downloadPdf(active)}
                className="h-9 rounded-md border px-4 text-[13px] font-semibold"
                style={{ borderColor: PLATFORM_ACCENT.primary, color: PLATFORM_ACCENT.primary }}
                data-download-pdf
              >{t('page.master_library.download_pdf')}</button>
              {canAdminister && (
                <>
                  <button type="button" onClick={() => setAdminAction('version')} data-action="new-version" data-panel-trigger disabled={!bodyReady}
                    className="h-9 rounded-md border border-slate-300 px-4 text-[13px] font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40">
                    {t('page.master_library.action_new_version')}
                  </button>
                  <button type="button" onClick={() => setAdminAction('withdraw')} data-action="withdraw" data-panel-trigger
                    className="h-9 rounded-md border border-red-300 px-4 text-[13px] font-semibold text-red-800 hover:bg-red-50">
                    {t('page.master_library.action_withdraw')}
                  </button>
                </>
              )}
            </div>

            <p className="rounded-md p-2 text-[12px]"
              style={{ backgroundColor: PLATFORM_ACCENT.bgTint, color: PLATFORM_ACCENT.primary }}
              data-immutability-note
              data-active-archived={active.isArchived || undefined}>{immutabilityNote}</p>
          </div>
        )}
      </SlidePanel>

      {activeItem && (
        <PullPanel
          open={pullOpen}
          item={activeItem}
          onClose={() => setPullOpen(false)}
          onDone={(msg) => { setPullOpen(false); flash(msg) }}
          provenanceLine={provenanceLine}
        />
      )}

      {activeItem && canAdminister && (
        <AdminActionPanel
          mode={adminAction}
          item={activeItem}
          onClose={() => setAdminAction(null)}
          onDone={(msg) => { setAdminAction(null); setSelected(null); flash(msg); void queryClient.invalidateQueries({ queryKey: ['library'] }) }}
        />
      )}

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
      {byRole.length === 0 ? (
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

// Pick project -> document -> section, then append the pulled text with a
// read-only provenance line to that section and record the adoption.
function PullPanel({ open, item, onClose, onDone, provenanceLine }: {
  open: boolean
  item: MasterLibraryItem
  onClose: () => void
  onDone: (message: string) => void
  provenanceLine: (item: MasterLibraryItem) => string
}) {
  const { t } = useTranslation()
  const [projectId,  setProjectId]  = useState('')
  const [documentId, setDocumentId] = useState('')
  const [sectionId,  setSectionId]  = useState('')
  const [busy,       setBusy]       = useState(false)
  const [failure,    setFailure]    = useState<string | null>(null)
  const qc = useQueryClient()

  // Reset the picker whenever it is reopened for a different item.
  useEffect(() => { if (open) { setProjectId(''); setDocumentId(''); setSectionId(''); setFailure(null) } }, [open, item.id])

  const projects = useQuery({ queryKey: ['library-pull', 'projects'], queryFn: () => projectsApi.list(), enabled: open })
  const docs = useQuery({
    queryKey: ['library-pull', 'documents', projectId],
    queryFn: () => documentsApi.list(projectId),
    enabled: open && !!projectId,
  })
  const doc = useQuery({
    queryKey: ['library-pull', 'document', documentId],
    queryFn: () => documentsApi.get(documentId),
    enabled: open && !!documentId,
  })

  // Pulling text is editing the document, so it follows the same rule: only the
  // document's Author (R), and only while it is open for authoring (action table
  // row 6). The API refuses anyone else; this just says so before the click.
  const rights = useQuery({
    queryKey: ['library-pull', 'can-edit', documentId],
    queryFn: () => raciApi.canEdit(documentId),
    enabled: open && !!documentId,
  })
  const notAuthor = !!documentId && rights.data?.canEdit === false
  const lockedStatus = doc.data && isAuthoringLocked(doc.data.status) ? doc.data.status : null
  const blocked = notAuthor || !!lockedStatus

  const sections = doc.data?.sections ?? []
  const target = blocked ? undefined : sections.find(s => s.id === sectionId)

  async function confirm() {
    if (!target || !item.body) return
    setBusy(true); setFailure(null)
    try {
      // Read the section again now, not from the copy loaded when the picker opened: the author (or someone else)
      // may have changed it since, and saving the old copy plus the pulled text would overwrite that.
      const fresh = await documentsApi.get(documentId)
      if (isAuthoringLocked(fresh.status)) {
        throw new Error(t('page.master_library.pull_doc_locked', { status: fresh.status.replace(/[_-]/g, ' ') }))
      }
      const freshSection = fresh.sections.find(s => s.id === sectionId)
      if (!freshSection) throw new Error(t('page.master_library.pull_section_gone', { defaultValue: 'That section no longer exists in the document.' }))
      if (freshSection.isLocked) throw new Error(t('page.master_library.pull_section_locked_now', { defaultValue: 'That section is locked by someone else right now. Try again in a moment.' }))
      // Library text is plain text; keep its paragraphs and line breaks.
      const paragraphs = item.body.split(/\n{2,}/).map(par => `<p>${escapeHtml(par.trim()).replace(/\n/g, '<br/>')}</p>`).join('')
      const addition = paragraphs +
        `<p data-provenance="library" data-library-item="${escapeHtml(item.id)}"><em>${escapeHtml(provenanceLine(item))}</em></p>`
      await documentsApi.updateSection(documentId, sectionId, { contentHtml: `${freshSection.contentHtml ?? ''}${addition}` })
      void qc.invalidateQueries({ queryKey: ['library-pull', 'document', documentId] })
      void qc.invalidateQueries({ queryKey: ['document', documentId] })
      // The text is already in the document, so a failure to record the adoption
      // does not undo it — but it is no longer silent: the usage count would be
      // short by one, so the author is told. The target is a Clinical Writing
      // document, so the adopting module is A.
      let adoptionRecorded = true
      await platformApi.adoptLibrarySection(item.id, { adoptingModule: 'A', adoptingEntity: documentId }).catch(() => { adoptionRecorded = false })
      onDone(t('page.master_library.pull_success', { title: doc.data?.title ?? t('page.master_library.pull_fallback_title'), section: target.number })
        + (adoptionRecorded ? '' : ` ${t('page.master_library.pull_adoption_failed')}`))
    } catch (err) {
      setFailure(describeApiError(err).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <SlidePanel open={open} onClose={onClose} title={t('page.master_library.pull_panel_title')} subtitle={item.name} storageKey="library-pull" defaultWidth={420} belowTopBar closeOnOutsideClick>
      <div className="flex flex-col gap-3 p-1" data-pull-panel>
        <p className="text-[12px] text-slate-600">
          {t('page.master_library.pull_panel_hint')}
        </p>

        <label className="flex flex-col gap-1">
          <span className={labelClass}>{t('page.master_library.pull_project')}</span>
          <select className={selectClass} value={projectId} onChange={e => { setProjectId(e.target.value); setDocumentId(''); setSectionId('') }}>
            <option value="">{projects.isLoading ? t('page.master_library.loading_short') : t('page.master_library.choose_project')}</option>
            {(projects.data ?? []).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className={labelClass}>{t('page.master_library.pull_document')}</span>
          <select className={selectClass} value={documentId} disabled={!projectId}
            onChange={e => { setDocumentId(e.target.value); setSectionId('') }}>
            <option value="">{docs.isLoading ? t('page.master_library.loading_short') : docs.data && docs.data.length === 0 ? t('page.master_library.no_documents') : t('page.master_library.choose_document')}</option>
            {(docs.data ?? []).map(d => (
              <option key={d.id} value={d.id} disabled={isAuthoringLocked(d.status)}>
                {d.title}{isAuthoringLocked(d.status) ? t('page.master_library.document_locked_suffix') : ''}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className={labelClass}>{t('page.master_library.pull_section')}</span>
          <select className={selectClass} value={sectionId} disabled={!documentId || blocked}
            onChange={e => setSectionId(e.target.value)}>
            <option value="">{doc.isLoading ? t('page.master_library.loading_short') : t('page.master_library.choose_section')}</option>
            {sections.map(s => <option key={s.id} value={s.id} disabled={!!s.isLocked}>{s.number} {s.title}{s.isLocked ? t('page.master_library.section_locked_suffix') : ''}</option>)}
          </select>
        </label>

        {notAuthor && <p className="rounded-md bg-amber-50 p-2 text-[12px] text-amber-900" role="alert" data-pull-blocked="not-author">{t('page.master_library.pull_not_author')}</p>}
        {lockedStatus && <p className="rounded-md bg-amber-50 p-2 text-[12px] text-amber-900" role="alert" data-pull-blocked="locked">{t('page.master_library.pull_doc_locked', { status: lockedStatus.replace(/[_-]/g, ' ') })}</p>}

        {(projects.error || docs.error || doc.error) && (
          <p className="rounded-md bg-red-50 p-2 text-[12px] text-red-800" role="alert">
            {describeApiError(projects.error ?? docs.error ?? doc.error).message}
          </p>
        )}
        {failure && <p className="rounded-md bg-red-50 p-2 text-[12px] text-red-800" role="alert">{t('page.master_library.pull_failure', { message: failure })}</p>}

        <div className="mt-1 flex items-center gap-2">
          <button type="button" onClick={confirm} disabled={!target || busy} data-action="confirm-pull"
            className="h-9 rounded-md px-4 text-[13px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
            style={{ backgroundColor: PLATFORM_ACCENT.primary }}>
            {busy ? t('page.master_library.pulling') : t('page.master_library.pull_section_action')}
          </button>
          <button type="button" onClick={onClose} className="h-9 rounded-md px-3 text-[13px] text-slate-600 hover:bg-slate-100">{t('button.cancel')}</button>
        </div>
      </div>
    </SlidePanel>
  )
}

// Admin actions on a library item: publish a new version, or withdraw it.
// The API checks the admin's tenant — a tenant admin can't change another
// tenant's item or a platform-wide one.
function AdminActionPanel({ mode, item, onClose, onDone }: {
  mode: 'version' | 'withdraw' | null
  item: MasterLibraryItem
  onClose: () => void
  onDone: (message: string) => void
}) {
  const { t } = useTranslation()
  const [title,   setTitle]   = useState(item.name)
  const [body,    setBody]    = useState(item.body ?? '')
  const [reason,  setReason]  = useState('')
  const [busy,    setBusy]    = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  useEffect(() => {
    if (mode) { setTitle(item.name); setBody(item.body ?? ''); setReason(''); setFailure(null) }
  }, [mode, item.id, item.name, item.body])

  const unchanged = title.trim() === item.name && body.trim() === (item.body ?? '').trim()
  const canSubmit = mode === 'version' ? !!title.trim() && !!body.trim() && !unchanged : reason.trim().length >= 3

  async function submit() {
    if (!canSubmit || !mode) return
    setBusy(true); setFailure(null)
    try {
      if (mode === 'version') {
        await platformApi.versionLibrarySection(item.id, { title: title.trim(), body: body.trim() })
        onDone(t('page.master_library.version_success', { name: title.trim() }))
      } else {
        await platformApi.withdrawLibrarySection(item.id, reason.trim())
        onDone(t('page.master_library.withdraw_success', { name: item.name }))
      }
    } catch (err) {
      setFailure(describeApiError(err).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <SlidePanel open={mode !== null} onClose={onClose} storageKey="library-admin" defaultWidth={460} belowTopBar closeOnOutsideClick
      title={mode === 'withdraw' ? t('page.master_library.withdraw_panel_title') : t('page.master_library.version_panel_title')} subtitle={item.name}>
      <div className="flex flex-col gap-3 p-1" data-admin-panel={mode ?? undefined}>
        {mode === 'version' ? (
          <>
            <p className="text-[12px] text-slate-600">{t('page.master_library.version_panel_hint')}</p>
            <label className="flex flex-col gap-1">
              <span className={labelClass}>{t('page.master_library.field_title')}</span>
              <input className={selectClass} value={title} onChange={e => setTitle(e.currentTarget.value)} />
            </label>
            <label className="flex flex-col gap-1">
              <span className={labelClass}>{t('page.master_library.field_text')}</span>
              <textarea className="min-h-[200px] rounded-md border border-slate-300 bg-white p-2 text-[12px]" value={body} onChange={e => setBody(e.currentTarget.value)} />
            </label>
          </>
        ) : (
          <>
            <p className="text-[12px] text-slate-600">{t('page.master_library.withdraw_panel_hint')}</p>
            <label className="flex flex-col gap-1">
              <span className={labelClass}>{t('page.master_library.withdraw_reason_label')}</span>
              <textarea className="min-h-[100px] rounded-md border border-slate-300 bg-white p-2 text-[12px]" value={reason} onChange={e => setReason(e.currentTarget.value)} />
            </label>
          </>
        )}
        {failure && <p className="rounded-md bg-red-50 p-2 text-[12px] text-red-800" role="alert">{t('page.master_library.admin_failure', { message: failure })}</p>}
        <div className="mt-1 flex items-center gap-2">
          <button type="button" onClick={submit} disabled={!canSubmit || busy} data-action="confirm-admin"
            className="h-9 rounded-md px-4 text-[13px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
            style={{ backgroundColor: mode === 'withdraw' ? '#B91C1C' : PLATFORM_ACCENT.primary }}>
            {mode === 'withdraw'
              ? (busy ? t('page.master_library.withdrawing') : t('page.master_library.withdraw_submit'))
              : (busy ? t('page.master_library.version_saving') : t('page.master_library.version_submit'))}
          </button>
          <button type="button" onClick={onClose} className="h-9 rounded-md px-3 text-[13px] text-slate-600 hover:bg-slate-100">{t('button.cancel')}</button>
        </div>
      </div>
    </SlidePanel>
  )
}
