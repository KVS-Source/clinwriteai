import { THERAPEUTIC_AREA_LABEL } from '../../utils/labels'
import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useTaLabels } from '../../hooks'
import type { MasterLibraryItem, MasterLibraryItemType, ModuleKey } from '@platform/types'
import { PLATFORM_ACCENT, PLATFORM_USER_ROLE_LABEL } from '@platform/types'
import { platformApi } from '../api/platformApi'
import { usePlatformStore } from '../store/platformStore'
import { documentsApi, projectsApi, describeApiError } from '../../api'
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

  const { data: items = [], isLoading, error, refetch, isFetching } = useQuery<MasterLibraryItem[]>({
    queryKey: ['library'],
    queryFn:  () => platformApi.listLibrary(),
  })

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
  const [visible,     setVisible]     = useState(PAGE_SIZE)
  const { labels: taLabels } = useTaLabels()

  const [selectedId, setSelectedId] = useState<string>('')
  const [pullOpen,   setPullOpen]   = useState(false)
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
    () => Array.from(new Set([...BASE_DOC_TYPES, ...items.map(i => i.docType)])).filter(Boolean),
    [items],
  )
  const projectOptions = useMemo(
    () => Array.from(new Set(items.map(i => i.projectName))).filter(Boolean).sort(),
    [items],
  )
  const versionOptions = useMemo(
    () => Array.from(new Set(items.map(i => i.version))).filter(Boolean).sort(),
    [items],
  )

  const activeFilterCount =
    (search.trim() ? 1 : 0) + (disciplines.length ? 1 : 0) + (itemTypes.length ? 1 : 0) +
    (docTypes.length ? 1 : 0) + (tas.length ? 1 : 0) + (project ? 1 : 0) + (version ? 1 : 0) +
    (fromDay || toDay ? 1 : 0)
  const filtersDirty = activeFilterCount > 0

  function resetFilters() {
    setSearch(''); setDisciplines([]); setItemTypes([]); setDocTypes([]); setTas([])
    setProject(''); setVersion(''); setFromDay(''); setToDay('')
    setSort('recent'); setVisible(PAGE_SIZE)
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const fromMs = fromDay ? new Date(`${fromDay}T00:00:00.000Z`).getTime() : null
    const toMs   = toDay   ? new Date(`${toDay}T23:59:59.999Z`).getTime()   : null
    const rows = items.filter(i => {
      if (q) {
        const hay = [i.name, i.docType, i.projectName, i.pushedByName, i.version, ...i.ta, ...i.tags].join(' ').toLowerCase()
        if (!hay.includes(q)) return false
      }
      if (disciplines.length && !disciplines.includes(i.module as ModuleKey)) return false
      if (itemTypes.length && !itemTypes.includes(i.itemType))               return false
      if (docTypes.length && !docTypes.includes(i.docType))                  return false
      if (tas.length && !i.ta.some(ta => tas.includes(ta)))                  return false
      if (project && i.projectName !== project)                              return false
      if (version && i.version !== version)                                  return false
      const pushedMs = new Date(i.pushedAt).getTime()
      if (fromMs !== null && pushedMs < fromMs)                              return false
      if (toMs   !== null && pushedMs > toMs)                                return false
      return true
    })
    rows.sort((a, b) => {
      switch (sort) {
        case 'oldest':    return new Date(a.pushedAt).getTime() - new Date(b.pushedAt).getTime()
        case 'name-asc':  return a.name.localeCompare(b.name)
        case 'name-desc': return b.name.localeCompare(a.name)
        default:          return new Date(b.pushedAt).getTime() - new Date(a.pushedAt).getTime()
      }
    })
    return rows
  }, [items, search, disciplines, itemTypes, docTypes, tas, project, version, fromDay, toDay, sort])

  // Any filter / sort change goes back to the first page of results.
  useEffect(() => { setVisible(PAGE_SIZE) }, [search, disciplines, itemTypes, docTypes, tas, project, version, fromDay, toDay, sort])

  const active = filtered.find(i => i.id === selectedId) ?? filtered[0]
  const shown = filtered.slice(0, visible)
  const dateRangeInvalid = !!fromDay && !!toDay && fromDay > toDay

  // Other versions of the same item (same name, different version) — newest first.
  const versionHistory = useMemo(() => {
    if (!active) return []
    return items
      .filter(i => i.name.toLowerCase() === active.name.toLowerCase())
      .sort((a, b) => new Date(b.pushedAt).getTime() - new Date(a.pushedAt).getTime())
  }, [items, active])

  const canPull = !!active && active.itemType === 'section' && !!active.body
  const pullLabel = !active ? t('page.master_library.pull_default')
    : active.itemType !== 'section' ? t('page.master_library.pull_sections_only')
    : !active.body ? t('page.master_library.pull_no_text')
    : t('page.master_library.pull_default')
  const immutabilityNote = active?.isArchived
    ? t('page.master_library.immutability_archived')
    : t('page.master_library.immutability_default')

  // Download PDF: a clean printable view of the item; the browser's
  // "Save as PDF" does the rest.
  function downloadPdf(item: MasterLibraryItem) {
    const w = window.open('', '_blank', 'noopener=no,width=900,height=1000')
    if (!w) { flash(t('page.master_library.popup_blocked')); return }
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
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(item.name)}</title>
      <style>body{font:14px/1.5 system-ui,sans-serif;color:#0f172a;max-width:760px;margin:32px auto;padding:0 24px}
      h1{font-size:22px;margin:0 0 4px}h2{font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#64748b;margin:24px 0 6px}
      table{border-collapse:collapse;width:100%}td{padding:4px 12px 4px 0;vertical-align:top}td:first-child{width:160px;color:#64748b}
      ol{padding-left:20px}.body{white-space:pre-wrap}.foot{margin-top:32px;font-size:11px;color:#64748b}</style></head><body>
      <h1>${escapeHtml(item.name)}</h1><p style="color:#64748b;margin:0">${escapeHtml(t('page.master_library.pdf_subtitle'))}</p>
      <h2>${escapeHtml(t('page.master_library.pdf_details'))}</h2><table>${rows.map(([k, v]) => `<tr><td>${escapeHtml(k)}</td><td>${escapeHtml(v)}</td></tr>`).join('')}</table>
      <h2>${escapeHtml(t('page.master_library.pdf_provenance'))}</h2><ol>${item.provenanceChain.map(s => `<li>${escapeHtml(s)}</li>`).join('')}</ol>
      ${item.body ? `<h2>${escapeHtml(t('page.master_library.pdf_content'))}</h2><div class="body">${escapeHtml(item.body)}</div>` : ''}
      <p class="foot">${escapeHtml(t('page.master_library.pdf_footer', { time: new Date().toUTCString(), note: immutabilityNote }))}</p>
      <script>window.onload=function(){window.print()}</script></body></html>`)
    w.document.close()
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
                {projectOptions.map(p => <option key={p} value={p}>{p}</option>)}
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

            <p className="mt-1 rounded-md p-2 text-[12px]" style={{ backgroundColor: PLATFORM_ACCENT.bgTint, color: PLATFORM_ACCENT.primary }} data-results-count>
              {isLoading ? t('page.master_library.loading_short') : t('page.master_library.results_count', { items: filtered.length, filters: activeFilterCount })}
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

            {!isLoading && !error && filtered.length === 0 && (
              <div className="px-2 py-6 text-center text-[12px] text-slate-500" data-state="empty">
                {items.length === 0 ? t('page.master_library.empty_library') : t('page.master_library.empty_filters')}
                {items.length > 0 && filtersDirty && (
                  <div><button type="button" onClick={resetFilters} className="mt-2 font-semibold text-slate-700 underline">{t('page.master_library.reset_filters')}</button></div>
                )}
              </div>
            )}

            <div className="flex flex-col divide-y divide-slate-200">
              {shown.map(it => {
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

            {filtered.length > shown.length && (
              <button type="button" onClick={() => setVisible(v => v + PAGE_SIZE)} data-action="load-more"
                className="mt-1 h-8 rounded-md border border-slate-300 text-[12px] font-semibold text-slate-700 hover:bg-slate-50">
                {t('page.master_library.load_more', { count: filtered.length - shown.length })}
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

  const sections = doc.data?.sections ?? []
  const target = sections.find(s => s.id === sectionId)

  async function confirm() {
    if (!target || !item.body) return
    setBusy(true); setFailure(null)
    try {
      const addition = `<p>${escapeHtml(item.body).replace(/\n/g, '<br/>')}</p>` +
        `<p data-provenance="library" data-library-item="${escapeHtml(item.id)}"><em>${escapeHtml(provenanceLine(item))}</em></p>`
      await documentsApi.updateSection(documentId, sectionId, { contentHtml: `${target.contentHtml ?? ''}${addition}` })
      // Recording the adoption is best-effort: the text is already in the document.
      await platformApi.adoptLibrarySection(item.id, { adoptingModule: 'A', adoptingEntity: documentId }).catch(() => undefined)
      onDone(t('page.master_library.pull_success', { title: doc.data?.title ?? t('page.master_library.pull_fallback_title'), section: target.number }))
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
          <select className={selectClass} value={sectionId} disabled={!documentId}
            onChange={e => setSectionId(e.target.value)}>
            <option value="">{doc.isLoading ? t('page.master_library.loading_short') : t('page.master_library.choose_section')}</option>
            {sections.map(s => <option key={s.id} value={s.id} disabled={!!s.isLocked}>{s.number} {s.title}{s.isLocked ? t('page.master_library.section_locked_suffix') : ''}</option>)}
          </select>
        </label>

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
