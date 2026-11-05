import { THERAPEUTIC_AREA_LABEL } from '../../utils/labels'
import { useEffect, useMemo, useState } from 'react'
import { keepPreviousData, useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useTaLabels } from '../../hooks'
import type { MasterLibraryItem, MasterLibraryItemType, ModuleKey } from '@platform/types'
import type { LibraryListParams } from '../api/platformApi'
import { PLATFORM_ACCENT, PLATFORM_USER_ROLE_LABEL } from '@platform/types'
import { platformApi } from '../api/platformApi'
import { usePlatformStore } from '../store/platformStore'
import { documentsApi, projectsApi, describeApiError } from '../../api'
import { raciApi } from '../../api/raci'
import { SlidePanel } from '../../components/ui/SlidePanel'

// Business-module display labels. Keyed only on A..E (the writing
// disciplines); the 'platform' value from @platform/types.ModuleKey
// isn't a discipline so it's intentionally excluded from this map.
const DISCIPLINE_LABEL_KEYS: Record<'A' | 'B' | 'C' | 'D' | 'E', string> = {
  A: 'page.master_library.discipline_a',
  B: 'page.master_library.discipline_b',
  C: 'page.master_library.discipline_c',
  D: 'page.master_library.discipline_d',
  E: 'page.master_library.discipline_e',
}

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

const PAGE_SIZE = 20
const SEARCH_DEBOUNCE_MS = 300
const AUTHORING_LOCKED = ['in_review', 'pending_signature', 'signed']   // mirrors the API's AUTHORING_LOCKED_STATUSES

type SortKey = 'recent' | 'oldest' | 'name-asc' | 'name-desc'
const SORT_LABEL_KEYS: Record<SortKey, string> = {
  'recent':    'page.master_library.sort_recent',
  'oldest':    'page.master_library.sort_oldest',
  'name-asc':  'page.master_library.sort_name_asc',
  'name-desc': 'page.master_library.sort_name_desc',
}

function formatDay(iso: string): string {
  const d = new Date(iso)
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${String(d.getUTCDate()).padStart(2, '0')} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`
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
  const [disciplines, setDisciplines] = useState<ModuleKey[]>([])
  const [itemTypes,   setItemTypes]   = useState<MasterLibraryItemType[]>([])
  const [docTypes,    setDocTypes]    = useState<string[]>([])
  const [tas,         setTas]         = useState<string[]>([])
  const [project,     setProject]     = useState('')
  const [version,     setVersion]     = useState('')
  const [fromDay,     setFromDay]     = useState('')
  const [toDay,       setToDay]       = useState('')
  const [sort,        setSort]        = useState<SortKey>('recent')
  const [showWithdrawn, setShowWithdrawn] = useState(false)
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
    q: debouncedSearch, module: disciplines, itemType: itemTypes, docType: docTypes, ta: tas,
    projectId: project, version, from: fromDay, to: toDay, sort, includeRetired: showWithdrawn, limit: PAGE_SIZE,
  }), [debouncedSearch, disciplines, itemTypes, docTypes, tas, project, version, fromDay, toDay, sort, showWithdrawn])

  const { data, isLoading, error, refetch, isFetching, isFetchingNextPage, fetchNextPage, hasNextPage } = useInfiniteQuery({
    queryKey: ['library', listParams],
    queryFn: ({ pageParam }) => platformApi.listLibraryPage(listParams, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: last => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
    enabled: !dateRangeInvalid,
  })
  const items = useMemo(() => data?.pages.flatMap(pg => pg.items) ?? [], [data])
  const total = data?.pages[0]?.total ?? 0

  const [selectedId, setSelectedId] = useState<string>('')
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

  const toggleFrom = <T extends string>(arr: T[], value: T, setter: (v: T[]) => void) =>
    setter(arr.includes(value) ? arr.filter(x => x !== value) : [...arr, value])

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
    (search.trim() ? 1 : 0) + (disciplines.length ? 1 : 0) + (itemTypes.length ? 1 : 0) +
    (docTypes.length ? 1 : 0) + (tas.length ? 1 : 0) + (project ? 1 : 0) + (version ? 1 : 0) +
    (fromDay || toDay ? 1 : 0) + (showWithdrawn ? 1 : 0)
  const filtersDirty = activeFilterCount > 0

  function resetFilters() {
    setSearch(''); setDisciplines([]); setItemTypes([]); setDocTypes([]); setTas([])
    setProject(''); setVersion(''); setFromDay(''); setToDay('')
    setSort('recent'); setShowWithdrawn(false)
  }

  const active = items.find(i => i.id === selectedId) ?? items[0]

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

  // Download PDF: a clean printable view of the item; the browser's
  // "Save as PDF" does the rest.
  function downloadPdf(item: MasterLibraryItem) {
    const rows: [string, string][] = [
      [t('page.master_library.pdf_row_module'),        `${item.module} · ${DISCIPLINE_LABEL_KEYS[item.module as 'A' | 'B' | 'C' | 'D' | 'E'] ? t(DISCIPLINE_LABEL_KEYS[item.module as 'A' | 'B' | 'C' | 'D' | 'E']) : item.module}`],
      [t('page.master_library.pdf_row_item_type'),     ITEM_TYPE_KEYS[item.itemType] ? t(ITEM_TYPE_KEYS[item.itemType]) : item.itemType],
      [t('page.master_library.pdf_row_doc_type'),      item.docType],
      [THERAPEUTIC_AREA_LABEL,                         item.ta.join(', ') || '—'],
      [t('page.master_library.pdf_row_version'),       item.version],
      [t('page.master_library.pdf_row_project'),       item.projectName],
      [t('page.master_library.pdf_row_pushed'),        t('page.master_library.pdf_pushed_value', { date: formatDay(item.pushedAt), user: item.pushedByName })],
      [t('page.master_library.pdf_row_tags'),          item.tags.join(', ') || '—'],
      [t('page.master_library.pdf_row_status'),        item.isArchived ? t('page.master_library.pdf_status_archived', { reason: item.archivedReason ? ` — ${item.archivedReason}` : '' }) : t('page.master_library.pdf_status_current')],
    ]
    const html = (`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(item.name)}</title>
      <style>body{font:14px/1.5 system-ui,sans-serif;color:#0f172a;max-width:760px;margin:32px auto;padding:0 24px}
      h1{font-size:22px;margin:0 0 4px}h2{font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#64748b;margin:24px 0 6px}
      table{border-collapse:collapse;width:100%}td{padding:4px 12px 4px 0;vertical-align:top}td:first-child{width:160px;color:#64748b}
      ol{padding-left:20px}.body{white-space:pre-wrap}.foot{margin-top:32px;font-size:11px;color:#64748b}</style></head><body>
      <h1>${escapeHtml(item.name)}</h1><p style="color:#64748b;margin:0">${escapeHtml(t('page.master_library.pdf_subtitle'))}</p>
      <h2>${escapeHtml(t('page.master_library.pdf_details'))}</h2><table>${rows.map(([k, v]) => `<tr><td>${escapeHtml(k)}</td><td>${escapeHtml(v)}</td></tr>`).join('')}</table>
      <h2>${escapeHtml(t('page.master_library.pdf_provenance'))}</h2><ol>${item.provenanceChain.map(s => `<li>${escapeHtml(s)}</li>`).join('')}</ol>
      ${item.body ? `<h2>${escapeHtml(t('page.master_library.pdf_content'))}</h2><div class="body">${escapeHtml(item.body)}</div>` : ''}
      <p class="foot">${escapeHtml(t('page.master_library.pdf_footer', { time: new Date().toUTCString(), note: immutabilityNote }))}</p>
      </body></html>`)
    // Print from a hidden frame on this page: no pop-up for a blocker to stop (CW-064).
    const frame = document.createElement('iframe')
    frame.setAttribute('aria-hidden', 'true')
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'
    frame.srcdoc = html
    frame.onload = () => {
      const win = frame.contentWindow
      if (!win) { frame.remove(); flash(t('page.master_library.pdf_failed')); return }
      win.onafterprint = () => frame.remove()
      win.focus()
      win.print()
      setTimeout(() => frame.remove(), 60_000)   // some browsers never fire afterprint
    }
    document.body.appendChild(frame)
  }

  return (
    <div className="bg-slate-50" data-screen="master-library">
      <div className="flex flex-col gap-4" style={{ maxWidth: 1600, padding: '20px 24px 48px' }}>

        <nav className="flex items-center gap-2 text-xs text-slate-500">
          <span>{t('page.master_library.crumb_platform')}</span>
          <span style={{ color: '#CBD5E1' }}>&gt;</span>
          <span className="font-semibold text-slate-900">{t('page.master_library.crumb_master_library')}</span>
        </nav>

        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <h1 className="text-[22px] font-bold text-slate-900" style={{ margin: 0 }}>{t('page.master_library.title')}</h1>
            <p className="mt-1 font-mono text-xs text-slate-500" data-current-user>{currentUser.name} · {roleLabel}</p>
          </div>
        </div>

        <div className="grid gap-4" style={{ gridTemplateColumns: '280px 340px 1fr' }}>

          {/* LEFT — filters */}
          <aside className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4" data-filter-panel>
            <input
              type="search" placeholder={t('page.master_library.search_placeholder')} value={search}
              onChange={(e) => setSearch(e.currentTarget.value)}
              data-filter-search aria-label={t('page.master_library.search_aria')}
              className="h-9 rounded-md border border-slate-300 px-3 text-[13px]"
            />

            <div data-filter-discipline>
              <p className={labelClass}>{t('page.master_library.filter_module')}</p>
              <div className="mt-1 flex flex-col gap-1">
                {(['A','B','C','D','E'] as ModuleKey[]).map(m => (
                  <label key={m} className="flex items-center gap-2 text-[12px] text-slate-800">
                    <input type="checkbox" checked={disciplines.includes(m)} onChange={() => toggleFrom(disciplines, m, setDisciplines)}
                      data-discipline={m} style={{ accentColor: MODULE_COLOURS[m] }} />
                    <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: MODULE_COLOURS[m] }} />
                    {t(DISCIPLINE_LABEL_KEYS[m as 'A' | 'B' | 'C' | 'D' | 'E'])}
                  </label>
                ))}
              </div>
            </div>

            <div data-filter-item-type>
              <p className={labelClass}>{t('page.master_library.filter_item_type')}</p>
              <div className="mt-1 flex flex-col gap-1 text-[12px]">
                {(['document', 'section', 'best-practice'] as MasterLibraryItemType[]).map(ty => (
                  <label key={ty} className="flex items-center gap-2 text-slate-800">
                    <input type="checkbox" checked={itemTypes.includes(ty)} onChange={() => toggleFrom(itemTypes, ty, setItemTypes)}
                      data-item-type={ty} style={{ accentColor: PLATFORM_ACCENT.primary }} />
                    {t(ITEM_TYPE_KEYS[ty])}
                  </label>
                ))}
              </div>
            </div>

            <div data-filter-doctype>
              <p className={labelClass}>{t('page.master_library.filter_doc_type')}</p>
              <div className="mt-1 flex flex-wrap gap-1">
                {docTypeOptions.map(ty => {
                  const on = docTypes.includes(ty)
                  return (
                    <button key={ty} type="button" onClick={() => toggleFrom(docTypes, ty, setDocTypes)}
                      aria-pressed={on} data-doctype-chip={ty} data-doctype-active={on || undefined}
                      className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
                      style={{ backgroundColor: on ? PLATFORM_ACCENT.primary : '#F1F5F9', color: on ? '#FFFFFF' : '#475569' }}
                    >{ty}{on ? ' ✕' : ''}</button>
                  )
                })}
              </div>
            </div>

            <div data-filter-ta>
              <p className={labelClass}>{THERAPEUTIC_AREA_LABEL}</p>
              <div className="mt-1 flex flex-wrap gap-1">
                {taLabels.map(ta => {
                  const on = tas.includes(ta)
                  return (
                    <button key={ta} type="button" onClick={() => toggleFrom(tas, ta, setTas)}
                      aria-pressed={on} data-ta-chip={ta} data-ta-active={on || undefined}
                      className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
                      style={{ backgroundColor: on ? PLATFORM_ACCENT.primary : '#F1F5F9', color: on ? '#FFFFFF' : '#475569' }}
                    >{ta}{on ? ' ✕' : ''}</button>
                  )
                })}
              </div>
            </div>

            <label className="flex flex-col gap-1" data-filter-project>
              <span className={labelClass}>{t('page.master_library.filter_project')}</span>
              <select className={selectClass} value={project} onChange={e => setProject(e.target.value)}>
                <option value="">{t('page.master_library.all_projects')}</option>
                {projectOptions.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>

            <label className="flex flex-col gap-1" data-filter-version>
              <span className={labelClass}>{t('page.master_library.filter_version')}</span>
              <select className={selectClass} value={version} onChange={e => setVersion(e.target.value)}>
                <option value="">{t('page.master_library.all_versions')}</option>
                {versionOptions.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </label>

            <div data-filter-dates>
              <p className={labelClass}>{t('page.master_library.pushed_between')}</p>
              <div className="mt-1 grid grid-cols-2 gap-2">
                <input type="date" aria-label={t('page.master_library.from_date_aria')} className={selectClass} value={fromDay} onChange={e => setFromDay(e.target.value)} />
                <input type="date" aria-label={t('page.master_library.to_date_aria')} className={selectClass} value={toDay} onChange={e => setToDay(e.target.value)} />
              </div>
              {dateRangeInvalid && <p className="mt-1 text-[11px] text-red-700">{t('page.master_library.date_range_invalid')}</p>}
            </div>

            <label className="flex items-center gap-2 text-[12px] text-slate-800" data-filter-withdrawn>
              <input type="checkbox" checked={showWithdrawn} onChange={e => setShowWithdrawn(e.currentTarget.checked)} style={{ accentColor: PLATFORM_ACCENT.primary }} />
              {t('page.master_library.show_withdrawn')}
            </label>

            <p className="mt-1 rounded-md p-2 text-[12px]" style={{ backgroundColor: PLATFORM_ACCENT.bgTint, color: PLATFORM_ACCENT.primary }} data-results-count>
              {isLoading ? t('page.master_library.loading_short') : t('page.master_library.results_count', { items: total, filters: activeFilterCount })}
            </p>

            {filtersDirty && (
              <button type="button" onClick={resetFilters} data-action="reset-filters"
                className="h-8 rounded-md border border-slate-300 text-[12px] font-semibold text-slate-700 hover:bg-slate-50">
                {t('page.master_library.reset_filters')}
              </button>
            )}
          </aside>

          {/* CENTRE — results */}
          <section className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-3" data-results-list>
            <div className="flex items-center justify-between gap-2">
              <label className="flex items-center gap-2">
                <span className={labelClass}>{t('page.master_library.sort_label')}</span>
                <select className="h-7 rounded-md border border-slate-300 bg-white px-2 text-[11px]" value={sort}
                  onChange={e => setSort(e.target.value as SortKey)} data-sort>
                  {(Object.keys(SORT_LABEL_KEYS) as SortKey[]).map(k => <option key={k} value={k}>{t(SORT_LABEL_KEYS[k])}</option>)}
                </select>
              </label>
            </div>

            {isLoading && <p className="px-2 py-6 text-center text-[12px] text-slate-500" data-state="loading">{t('page.master_library.loading_library')}</p>}

            {error && (
              <div className="rounded-md bg-red-50 p-3 text-[12px] text-red-800" role="alert" data-state="error">
                <p className="font-semibold">{t('page.master_library.load_error_title')}</p>
                <p className="mt-0.5">{describeApiError(error).message}</p>
                <button type="button" onClick={() => void refetch()} disabled={isFetching}
                  className="mt-2 rounded-md border border-red-300 bg-white px-3 py-1 text-[11px] font-semibold text-red-800 disabled:opacity-50">
                  {isFetching ? t('page.master_library.retrying') : t('page.master_library.try_again')}
                </button>
              </div>
            )}

            {!isLoading && !error && items.length === 0 && (
              <div className="px-2 py-6 text-center text-[12px] text-slate-500" data-state="empty">
                {!filtersDirty ? t('page.master_library.empty_library') : t('page.master_library.empty_filters')}
                {filtersDirty && (
                  <div><button type="button" onClick={resetFilters} className="mt-2 font-semibold text-slate-700 underline">{t('page.master_library.reset_filters')}</button></div>
                )}
              </div>
            )}

            <div className="flex flex-col divide-y divide-slate-200">
              {items.map(it => {
                const colour = MODULE_COLOURS[it.module]
                const isActive = it.id === active?.id
                return (
                  <button
                    key={it.id} type="button" onClick={() => setSelectedId(it.id)}
                    data-library-row={it.id}
                    data-library-active={isActive || undefined}
                    data-library-archived={it.isArchived || undefined}
                    aria-current={isActive || undefined}
                    className="flex flex-col items-start gap-1 px-2 py-2 text-left hover:bg-slate-50"
                    style={{ backgroundColor: isActive ? PLATFORM_ACCENT.bgTint : undefined }}
                  >
                    <div className="flex w-full items-center justify-between gap-2">
                      <span className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-mono font-semibold uppercase"
                        style={{ backgroundColor: `${colour}22`, color: colour }} data-module-chip={it.module}>{it.module}</span>
                      <span className="flex items-center gap-1">
                        <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">{ITEM_TYPE_KEYS[it.itemType] ? t(ITEM_TYPE_KEYS[it.itemType]) : it.itemType}</span>
                        {it.isArchived && (
                          <span className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: '#F1F5F9', color: '#475569' }} data-archived-tag>{t('page.master_library.archived_tag')}</span>
                        )}
                      </span>
                    </div>
                    <p className="text-[13px] font-semibold text-slate-900">{it.name}</p>
                    <p className="font-mono text-[10px] text-slate-500">{it.docType} · {it.ta.join(', ')} · {it.version}</p>
                    <p className="font-mono text-[10px] text-slate-500">{t('page.master_library.row_meta', { project: it.projectName, date: formatDay(it.pushedAt), user: it.pushedByName })}</p>
                  </button>
                )
              })}
            </div>

            {hasNextPage && (
              <button type="button" onClick={() => void fetchNextPage()} disabled={isFetchingNextPage} data-action="load-more"
                className="mt-1 h-8 rounded-md border border-slate-300 text-[12px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                {isFetchingNextPage ? t('page.master_library.loading_short') : t('page.master_library.load_more', { count: Math.max(total - items.length, 0) })}
              </button>
            )}
          </section>

          {/* RIGHT — detail */}
          <aside className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-5" data-detail-panel>
            {!active && !isLoading && (
              <p className="text-[12px] text-slate-500">{t('page.master_library.select_hint')}</p>
            )}
            {active && (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-mono font-semibold uppercase" style={{ backgroundColor: `${MODULE_COLOURS[active.module]}22`, color: MODULE_COLOURS[active.module] }} data-active-module>{active.module}</span>
                  <span className="font-mono text-[11px] text-slate-500" data-active-doctype>{active.docType}</span>
                  <span className="font-mono text-[11px] text-slate-500">{t('page.master_library.ta_prefix')} {active.ta.join(', ')}</span>
                  <span className="font-mono text-[11px] text-slate-500" data-active-version>{active.version}</span>
                  {active.isArchived && (
                    <span className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: '#F1F5F9', color: '#475569' }}>{t('page.master_library.archived_tag')}</span>
                  )}
                </div>

                <h2 className="text-[16px] font-bold text-slate-900" data-active-name>{active.name}</h2>
                <p className="font-mono text-[11px] text-slate-500" data-active-pushed>{t('page.master_library.pushed_byline', { date: formatDay(active.pushedAt), user: active.pushedByName, project: active.projectName })}</p>

                {active.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1" data-active-tags>
                    {active.tags.map(tg => <span key={tg} className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">{tg}</span>)}
                  </div>
                )}

                <div className="rounded-md border border-slate-200 p-3" data-provenance>
                  <p className={labelClass}>{t('page.master_library.provenance_chain')}</p>
                  <ol className="mt-2 flex flex-col gap-2">
                    {active.provenanceChain.map((step, i) => (
                      <li key={i} className="flex items-start gap-2 text-[12px] text-slate-800" data-provenance-step={i}>
                        <span className="mt-0.5 inline-flex h-4 w-4 flex-none items-center justify-center rounded-full font-mono text-[9px] font-bold text-white" style={{ backgroundColor: PLATFORM_ACCENT.primary }}>{i + 1}</span>
                        <span>{step}</span>
                      </li>
                    ))}
                  </ol>
                </div>

                <div className="rounded-md border border-slate-200 p-3" data-version-history>
                  <p className={labelClass}>{t('page.master_library.version_history')}</p>
                  {versionHistory.length <= 1 ? (
                    <p className="mt-1 text-[12px] text-slate-800">{t('page.master_library.version_single', { version: active.version })}</p>
                  ) : (
                    <ul className="mt-1 flex flex-col gap-1">
                      {versionHistory.map((v, idx) => (
                        <li key={v.id}>
                          <button type="button" onClick={() => setSelectedId(v.id)}
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
                    data-pull-button
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
                      <button type="button" onClick={() => setAdminAction('version')} data-action="new-version"
                        className="h-9 rounded-md border border-slate-300 px-4 text-[13px] font-semibold text-slate-700 hover:bg-slate-50">
                        {t('page.master_library.action_new_version')}
                      </button>
                      <button type="button" onClick={() => setAdminAction('withdraw')} data-action="withdraw"
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
              </>
            )}
          </aside>
        </div>
      </div>

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
          onDone={(msg) => { setAdminAction(null); flash(msg); void queryClient.invalidateQueries({ queryKey: ['library'] }) }}
        />
      )}

      {toast && (
        <div data-toast role="status"
          className="pointer-events-none fixed bottom-5 left-1/2 flex -translate-x-1/2 items-center gap-2.5 rounded-lg px-4 py-3 text-[13px]"
          style={{ backgroundColor: '#1E293B', color: '#FFFFFF' }}>
          <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: PLATFORM_ACCENT.primary }} />
          {toast}
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
  const lockedStatus = doc.data && AUTHORING_LOCKED.includes(doc.data.status) ? doc.data.status : null
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
    <SlidePanel open={open} onClose={onClose} title={t('page.master_library.pull_panel_title')} subtitle={item.name} storageKey="library-pull" defaultWidth={420}>
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
            {(docs.data ?? []).map(d => <option key={d.id} value={d.id}>{d.title}</option>)}
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
        {lockedStatus && <p className="rounded-md bg-amber-50 p-2 text-[12px] text-amber-900" role="alert" data-pull-blocked="locked">{t('page.master_library.pull_doc_locked', { status: lockedStatus.replace(/_/g, ' ') })}</p>}

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
    <SlidePanel open={mode !== null} onClose={onClose} storageKey="library-admin" defaultWidth={460}
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
