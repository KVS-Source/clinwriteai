import { THERAPEUTIC_AREA_LABEL } from '../../utils/labels'
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useTaLabels } from '../../hooks'
import type { MasterLibraryItem, MasterLibraryItemType, ModuleKey } from '@platform/types'
import type { LibraryListParams } from '../api/platformApi'
import { PLATFORM_ACCENT, PLATFORM_USER_ROLE_LABEL } from '@platform/types'
import { platformApi } from '../api/platformApi'
import { usePlatformStore } from '../store/platformStore'
import { documentsApi, projectsApi, describeApiError } from '../../api'
import { raciApi } from '../../api/raci'
import { api } from '../../api/client'
import { SlidePanel } from '../../components/ui/SlidePanel'
import { SortIcon } from '../../components/ui/SortIcon'

const MODULE_COLOURS: Record<ModuleKey, string> = {
  A: '#2563EB', B: '#0D9488', C: '#7C3AED', D: '#B0200D', E: '#0D9488', platform: PLATFORM_ACCENT.primary,
}

const ITEM_TYPE_KEYS: Record<MasterLibraryItemType, string> = {
  'document':      'page.master_library.item_type_document',
  'section':       'page.master_library.item_type_section',
  'best-practice': 'page.master_library.item_type_best_practice',
}

// Document types always offered as filters, merged with whatever the library holds.
const BASE_DOC_TYPES = ['NDA', 'CSR', 'SmPC', 'RMP', 'Blog Post', 'IND', 'KOL Summary', 'Manuscript', 'Clinical Brief', 'HA Response']

const PAGE_SIZES = [10, 20, 50]
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
  const currentUser = usePlatformStore(s => s.currentUser)
  const roleLabel = PLATFORM_USER_ROLE_LABEL[currentUser.role] ?? currentUser.role

  const queryClient = useQueryClient()
  const canManage = usePlatformStore(s => s.hasRole)(['tenant-admin', 'admin'])

  // Filters start empty — nothing is pre-applied.
  const [search,      setSearch]      = useState('')
  const [itemTypes,   setItemTypes]   = useState<MasterLibraryItemType[]>([])
  const [docTypes,    setDocTypes]    = useState<string[]>([])
  const [tas,         setTas]         = useState<string[]>([])
  const [project,     setProject]     = useState('')
  const [version,     setVersion]     = useState('')
  const [fromDay,     setFromDay]     = useState('')
  const [toDay,       setToDay]       = useState('')
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
  const dateRangeInvalid = !!fromDay && !!toDay && fromDay > toDay
  const listParams = useMemo<LibraryListParams>(() => ({
    q: debouncedSearch, itemType: itemTypes, docType: docTypes, ta: tas,
    projectId: project, version, from: fromDay, to: toDay, sort, includeRetired: showWithdrawn, limit: pageSize,
  }), [debouncedSearch, itemTypes, docTypes, tas, project, version, fromDay, toDay, sort, showWithdrawn])

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
  const flash = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3600) }

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
  // Every project the user can see, not just the ones on the loaded page.
  const { data: projectList = [] } = useQuery({ queryKey: ['library-projects'], queryFn: () => projectsApi.list() })
  const projectOptions = useMemo(
    () => projectList.map(p => ({ id: p.id, name: p.name })).sort((a, b) => a.name.localeCompare(b.name)),
    [projectList],
  )
  const versionOptions = useMemo(
    () => Array.from(new Set([...(version ? [version] : []), ...items.map(i => i.version)])).filter(Boolean).sort(),
    [items, version],
  )

  const activeFilterCount =
    (search.trim() ? 1 : 0) + (itemTypes.length ? 1 : 0) +
    (docTypes.length ? 1 : 0) + (tas.length ? 1 : 0) + (project ? 1 : 0) + (version ? 1 : 0) +
    (fromDay || toDay ? 1 : 0) + (showWithdrawn ? 1 : 0)
  const filtersDirty = activeFilterCount > 0

  function resetFilters() {
    setSearch(''); setItemTypes([]); setDocTypes([]); setTas([])
    setProject(''); setVersion(''); setFromDay(''); setToDay('')
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

  const canPull = !!active && active.itemType === 'section' && !!active.body && !active.isWithdrawn
  const canAdminister = canManage && !!active && active.itemType !== 'best-practice' && !active.isWithdrawn
  const pullLabel = !active ? t('page.master_library.pull_default')
    : active.itemType !== 'section' ? t('page.master_library.pull_sections_only')
    : active.isWithdrawn ? t('page.master_library.pull_withdrawn')
    : !active.body ? t('page.master_library.pull_no_text')
    : t('page.master_library.pull_default')
  const immutabilityNote = active?.isArchived
    ? t('page.master_library.immutability_archived')
    : t('page.master_library.immutability_default')

  // Download PDF: the server builds a PDF of the item's own text (title + body, no app
  // details) and the browser saves it as a file — no print dialog, no pop-up.
  async function downloadPdf(item: MasterLibraryItem) {
    if (!item.body) { flash(t('page.master_library.pdf_no_content')); return }
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

  const itemTypeOptions = (['document', 'section', 'best-practice'] as MasterLibraryItemType[]).map(ty => ({ value: ty, label: t(ITEM_TYPE_KEYS[ty]) }))
  const filterControl = 'h-10 w-44 rounded-md border border-slate-300 bg-white px-3 text-[13px] text-slate-800'

  return (
    <div className="bg-slate-50" data-screen="master-library">
      <div className="flex flex-col gap-4" style={{ maxWidth: 1600, padding: '20px 24px 48px' }}>

        <nav className="flex items-center gap-2 text-xs text-slate-500">
          <span>{t('page.master_library.crumb_platform')}</span>
          <span style={{ color: '#CBD5E1' }}>&gt;</span>
          <span className="font-semibold text-slate-900">{t('page.master_library.crumb_master_library')}</span>
        </nav>

        <div>
          <h1 className="text-[22px] font-bold text-slate-900" style={{ margin: 0 }}>{t('page.master_library.title')}</h1>
          <p className="mt-1 font-mono text-xs text-slate-500" data-current-user>{currentUser.name} · {roleLabel}</p>
        </div>

        <div className="flex items-center gap-2" data-results-count>
          <span className="rounded-full border border-slate-200 bg-white px-3 py-1 font-mono text-[11px] font-semibold uppercase tracking-wide text-slate-700">
            {isLoading ? t('page.master_library.loading_short') : t('page.master_library.results_count', { items: total, filters: activeFilterCount })}
          </span>
        </div>

        {/* Filters — one row, wrapping on narrow screens */}
        <div className="flex flex-wrap items-center gap-3" data-filter-panel>
          <input
            type="search" placeholder={t('page.master_library.search_placeholder')} value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
            data-filter-search aria-label={t('page.master_library.search_aria')}
            className={`${filterControl} min-w-[260px] !w-auto flex-1`}
          />

          <div data-filter-item-type>
            <MultiSelect label={t('page.master_library.filter_item_type')} allLabel={t('page.master_library.all_item_types')}
              options={itemTypeOptions} value={itemTypes} onChange={v => setItemTypes(v as MasterLibraryItemType[])}
              optionAttr="data-item-type" className={filterControl} />
          </div>
          <div data-filter-doctype>
            <MultiSelect label={t('page.master_library.filter_doc_type')} allLabel={t('page.master_library.all_doc_types')}
              options={docTypeOptions.map(d => ({ value: d, label: d }))} value={docTypes} onChange={setDocTypes}
              optionAttr="data-doctype-chip" className={filterControl} />
          </div>
          <div data-filter-ta>
            <MultiSelect label={THERAPEUTIC_AREA_LABEL} allLabel={t('page.master_library.all_ta')}
              options={taLabels.map(ta => ({ value: ta, label: ta }))} value={tas} onChange={setTas}
              optionAttr="data-ta-chip" className={filterControl} />
          </div>

          <select className={filterControl} value={project} onChange={e => setProject(e.target.value)} data-filter-project aria-label={t('page.master_library.filter_project')}>
            <option value="">{t('page.master_library.all_projects')}</option>
            {projectOptions.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>

          <select className={filterControl} value={version} onChange={e => setVersion(e.target.value)} data-filter-version aria-label={t('page.master_library.filter_version')}>
            <option value="">{t('page.master_library.all_versions')}</option>
            {versionOptions.map(v => <option key={v} value={v}>{v}</option>)}
          </select>

          <div className="flex items-center gap-2" data-filter-dates>
            <span className="text-[12px] text-slate-500">{t('page.master_library.pushed_between')}</span>
            <input type="date" aria-label={t("page.master_library.from_date_aria")} className={`${filterControl} !w-40`} value={fromDay} onChange={e => setFromDay(e.target.value)} />
            <input type="date" aria-label={t("page.master_library.to_date_aria")} className={`${filterControl} !w-40`} value={toDay} onChange={e => setToDay(e.target.value)} />
          </div>

          <label className="flex items-center gap-2 text-[13px] text-slate-700" data-filter-withdrawn>
            <input type="checkbox" checked={showWithdrawn} onChange={e => setShowWithdrawn(e.currentTarget.checked)} style={{ accentColor: PLATFORM_ACCENT.primary }} />
            {t('page.master_library.show_withdrawn')}
          </label>

          {filtersDirty && (
            <button type="button" onClick={resetFilters} data-action="reset-filters"
              className="h-10 px-2 text-[13px] font-semibold text-slate-600 hover:text-slate-900">
              ✕ {t('page.master_library.reset_filters')}
            </button>
          )}
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
                <PlainHead label={t('page.master_library.col_type')} />
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
                <tr><td colSpan={8} className="px-4 py-8 text-center text-[12px] text-slate-500" data-state="loading">{t('page.master_library.loading_library')}</td></tr>
              )}
              {!isLoading && !error && items.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-[12px] text-slate-500" data-state="empty">
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
                    <td className="px-4 py-3"><span className="rounded-full bg-slate-100 px-2.5 py-0.5 font-mono text-[11px] text-slate-700">{ITEM_TYPE_KEYS[it.itemType] ? t(ITEM_TYPE_KEYS[it.itemType]) : it.itemType}</span></td>
                    <td className="px-4 py-3 text-slate-700">{it.docType || '—'}</td>
                    <td className="px-4 py-3 text-slate-700">{it.ta.join(', ') || '—'}</td>
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
              <span className="font-mono text-[11px] text-slate-500">{t('page.master_library.ta_prefix')} {active.ta.join(', ')}</span>
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
            {active.tags.length > 0 && (
              <div className="flex flex-wrap gap-1" data-active-tags>
                {active.tags.map(tg => <span key={tg} className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">{tg}</span>)}
              </div>
            )}

            <div className="rounded-md border border-slate-200 p-3" data-provenance>
              <p className={labelClass}>{t('page.master_library.provenance_chain')}</p>
              <dl className="mt-2 grid grid-cols-[100px_1fr] gap-x-3 gap-y-1.5 text-[12px]">
                {active.provenanceChain.map((step, i) => {
                  const cut = step.indexOf(': ')
                  return (
                    <Fragment key={i}>
                      <dt className={labelClass} data-provenance-step={i}>{cut > 0 ? step.slice(0, cut) : step}</dt>
                      <dd className="text-slate-800">{cut > 0 ? step.slice(cut + 2) : ''}</dd>
                    </Fragment>
                  )
                })}
              </dl>
              <dl className="mt-1.5 grid grid-cols-[100px_1fr] gap-x-3 gap-y-1.5 text-[12px]" data-active-meta>
                <dt className={labelClass}>{t('page.master_library.meta_editor')}</dt><dd className="text-slate-800">{active.editedByName ?? active.pushedByName}</dd>
                <dt className={labelClass}>{t('page.master_library.meta_created_by')}</dt><dd className="text-slate-800">{active.createdByName ?? active.pushedByName}</dd>
                <dt className={labelClass}>{t('page.master_library.meta_created_at')}</dt><dd className="text-slate-800">{formatDateTime(active.createdAt ?? active.pushedAt)}</dd>
                <dt className={labelClass}>{t('page.master_library.meta_updated')}</dt><dd className="text-slate-800">{formatDateTime(active.updatedAt ?? active.pushedAt)}</dd>
              </dl>
            </div>

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
              <button type="button" disabled={!canPull} onClick={() => setPullOpen(true)}
                data-pull-button data-panel-trigger
                className="h-9 rounded-md px-4 text-[13px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
                style={{ backgroundColor: PLATFORM_ACCENT.primary }}
                title={pullLabel}
              >{pullLabel}</button>
              <button type="button" onClick={() => downloadPdf(active)}
                className="h-9 rounded-md border px-4 text-[13px] font-semibold"
                style={{ borderColor: PLATFORM_ACCENT.primary, color: PLATFORM_ACCENT.primary }}
                data-download-pdf
              >{t('page.master_library.download_pdf')}</button>
              {canAdminister && (
                <>
                  <button type="button" onClick={() => setAdminAction('version')} data-action="new-version" data-panel-trigger
                    className="h-9 rounded-md border border-slate-300 px-4 text-[13px] font-semibold text-slate-700 hover:bg-slate-50">
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

      {active && (
        <PullPanel
          open={pullOpen}
          item={active}
          onClose={() => setPullOpen(false)}
          onDone={(msg) => { setPullOpen(false); flash(msg) }}
          provenanceLine={provenanceLine}
        />
      )}

      {active && canAdminister && (
        <AdminActionPanel
          mode={adminAction}
          item={active}
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

// A dropdown of checkboxes: nothing ticked means "all". Closes on an outside click or Esc.
function MultiSelect({ label, allLabel, options, value, onChange, optionAttr, className }: {
  label: string
  allLabel: string
  options: { value: string; label: string }[]
  value: string[]
  onChange: (next: string[]) => void
  optionAttr: string
  className: string
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])
  const summary = value.length === 0 ? allLabel : value.length === 1 ? (options.find(o => o.value === value[0])?.label ?? value[0]) : t('page.master_library.n_selected', { label, count: value.length })
  return (
    <div ref={ref} className="relative w-44">
      <button type="button" onClick={() => setOpen(o => !o)} aria-haspopup="listbox" aria-expanded={open} aria-label={label}
        className={`${className} inline-flex items-center justify-between gap-2 text-left`}>
        <span className="truncate">{summary}</span>
        <span aria-hidden="true" className="text-[10px] text-slate-500">▾</span>
      </button>
      {open && (
        <div className="absolute left-0 top-11 z-20 max-h-72 min-w-full overflow-auto rounded-md border border-slate-200 bg-white p-1 shadow-lg" role="listbox" aria-multiselectable="true">
          {options.map(o => {
            const on = value.includes(o.value)
            return (
              <label key={o.value} className="flex cursor-pointer items-center gap-2 whitespace-nowrap rounded px-2 py-1.5 text-[13px] text-slate-800 hover:bg-slate-50">
                <input type="checkbox" checked={on} {...{ [optionAttr]: o.value }}
                  onChange={() => onChange(on ? value.filter(v => v !== o.value) : [...value, o.value])}
                  style={{ accentColor: PLATFORM_ACCENT.primary }} />
                {o.label}
              </label>
            )
          })}
          {value.length > 0 && (
            <button type="button" onClick={() => onChange([])} className="mt-1 w-full rounded px-2 py-1.5 text-left text-[12px] font-semibold text-slate-600 hover:bg-slate-50">
              {t('page.master_library.clear_selection')}
            </button>
          )}
        </div>
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
      // Library text is plain text; keep its paragraphs and line breaks.
      const paragraphs = item.body.split(/\n{2,}/).map(par => `<p>${escapeHtml(par.trim()).replace(/\n/g, '<br/>')}</p>`).join('')
      const addition = paragraphs +
        `<p data-provenance="library" data-library-item="${escapeHtml(item.id)}"><em>${escapeHtml(provenanceLine(item))}</em></p>`
      await documentsApi.updateSection(documentId, sectionId, { contentHtml: `${target.contentHtml ?? ''}${addition}` })
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
    <SlidePanel open={mode !== null} onClose={onClose} storageKey="library-admin" defaultWidth={460} belowTopBar
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
