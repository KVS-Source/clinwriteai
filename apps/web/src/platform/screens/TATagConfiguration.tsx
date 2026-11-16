import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import type { TATag } from '@platform/types'
import { PLATFORM_ACCENT } from '@platform/types'
import { ApiError } from '../../api/client'
import { SlidePanel } from '../../components/ui'
import { SortIcon } from '../../components/ui/SortIcon'
import { MultiSelect } from '../components/MultiSelect'
import { platformApi } from '../api/platformApi'
import { usePlatformStore } from '../store'

// createdAt arrives as an ISO timestamp (or 'YYYY-MM-DD' from mocks); only the
// date part is shown, parsed as a local date so the day never shifts with the
// viewer's timezone.
function formatCreated(ymd: string | undefined): string {
  if (!ymd) return '—'
  const [y, m, d] = ymd.slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return ymd
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })
}

// Search, filters, sort and paging: the same controls as Master Documents and ICH Frameworks. The list is
// small, so they run in the browser.
type SortKey =
  | 'default'
  | 'name-asc' | 'name-desc'
  | 'abbrev-asc' | 'abbrev-desc'
  | 'status-asc' | 'status-desc'
  | 'oldest' | 'recent'
  | 'use-asc' | 'use-desc'
type UseFilter = 'in-use' | 'unused'
const PAGE_SIZES = [10, 20, 50]
const filterControl = 'h-10 w-full rounded-md border border-slate-300 bg-white px-2.5 text-[12px] text-slate-800'
const usage = (ta: TATag) => ta.projectCount + ta.documentCount

function StatusChip({ status }: { status: 'active' | 'archived' }) {
  const { t } = useTranslation()
  if (status === 'active')
    return <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium" style={{ backgroundColor: '#F0FDF4', color: '#166534', border: '1px solid #BBF7D0' }} data-status-chip="active">{t('page.ta_tag_configuration.chip_active')}</span>
  return <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium" style={{ backgroundColor: '#F1F5F9', color: '#475569', border: '1px solid #CBD5E1' }} data-status-chip="archived">{t('page.ta_tag_configuration.chip_archived')}</span>
}

export function TATagConfiguration() {
  const { t } = useTranslation()
  const currentUser = usePlatformStore(s => s.currentUser)
  const qc = useQueryClient()
  const { data: tags = [], isLoading, error: loadError } = useQuery<TATag[]>({
    queryKey: ['ta-tags'],
    queryFn:  () => platformApi.listTATags(),
  })

  // Prefer the API's human-readable message (e.g. the in-use refusal).
  const errorMessage = (err: unknown): string => {
    if (err instanceof ApiError) {
      const body = err.body as { message?: string; error?: string } | null
      if (body?.message) return body.message
      if (err.status === 403) return t('page.ta_tag_configuration.err_forbidden')
    }
    return t('page.ta_tag_configuration.err_generic')
  }

  const [drawerOpen, setDrawerOpen] = useState(false)
  const [name,       setName]       = useState('')
  const [abbrev,     setAbbrev]     = useState('')
  const [actionError, setActionError] = useState<string | null>(null)

  const [confirmArchive, setConfirmArchive] = useState<TATag | null>(null)

  const activeCount = tags.filter(ta => ta.status === 'active').length

  const [search,    setSearch]    = useState('')
  const [statuses,  setStatuses]  = useState<string[]>([])
  const [useFilter, setUseFilter] = useState<string[]>([])
  const [sort,      setSort]      = useState<SortKey>('default')
  const [page,      setPage]      = useState(1)
  const [pageSize,  setPageSize]  = useState(PAGE_SIZES[1]!)

  const statusOptions = [
    { value: 'active',   label: t('page.ta_tag_configuration.status_active') },
    { value: 'archived', label: t('page.ta_tag_configuration.status_archived') },
  ]
  const useOptions: Array<{ value: UseFilter; label: string }> = [
    { value: 'in-use', label: t('page.ta_tag_configuration.use_in_use') },
    { value: 'unused', label: t('page.ta_tag_configuration.use_unused') },
  ]

  const filtersDirty = search.trim() !== '' || statuses.length > 0 || useFilter.length > 0
  const resetFilters = () => { setSearch(''); setStatuses([]); setUseFilter([]) }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const rows = tags.filter(ta => {
      if (statuses.length > 0 && !statuses.includes(ta.status)) return false
      if (useFilter.length > 0 && !useFilter.includes(usage(ta) > 0 ? 'in-use' : 'unused')) return false
      if (q && ![ta.name, ta.abbreviation].some(v => (v ?? '').toLowerCase().includes(q))) return false
      return true
    })
    // createdAt is a full ISO timestamp, so string order is creation order — same-day tags included.
    const created = (x: TATag, y: TATag) => (x.createdAt ?? '').localeCompare(y.createdAt ?? '')
    const byName  = (x: TATag, y: TATag) => x.name.localeCompare(y.name)
    const by: Record<SortKey, (x: TATag, y: TATag) => number> = {
      // Before any header is clicked: tags in use first, newest first within each group, then name.
      'default':     (x, y) => Number(usage(y) > 0) - Number(usage(x) > 0) || created(y, x) || byName(x, y),
      'name-asc':    byName,
      'name-desc':   (x, y) => byName(y, x),
      'abbrev-asc':  (x, y) => x.abbreviation.localeCompare(y.abbreviation),
      'abbrev-desc': (x, y) => y.abbreviation.localeCompare(x.abbreviation),
      'status-asc':  (x, y) => x.status.localeCompare(y.status) || byName(x, y),
      'status-desc': (x, y) => y.status.localeCompare(x.status) || byName(x, y),
      'oldest':      (x, y) => created(x, y) || byName(x, y),
      'recent':      (x, y) => created(y, x) || byName(x, y),
      'use-asc':     (x, y) => usage(x) - usage(y) || byName(x, y),
      'use-desc':    (x, y) => usage(y) - usage(x) || byName(x, y),
    }
    return [...rows].sort(by[sort])
  }, [tags, search, statuses, useFilter, sort])

  useEffect(() => { setPage(1) }, [search, statuses, useFilter, sort, pageSize])
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const pageRows  = filtered.slice((Math.min(page, pageCount) - 1) * pageSize, Math.min(page, pageCount) * pageSize)

  const sortHead = (label: string, asc: SortKey, desc: SortKey) => (
    <th className="px-4 py-2" aria-sort={sort === asc ? 'ascending' : sort === desc ? 'descending' : 'none'}>
      <button type="button" onClick={() => setSort(sort === asc ? desc : asc)} data-sort={asc}
        className="inline-flex items-center gap-1.5 uppercase tracking-widest hover:text-slate-800">
        {label}<SortIcon state={sort === asc ? 'asc' : sort === desc ? 'desc' : null} />
      </button>
    </th>
  )

  const nameRule = useMemo(() => {
    if (name === '')                                                             return t('page.ta_tag_configuration.rule_name_required')
    if (tags.some(ta => ta.name.toLowerCase() === name.trim().toLowerCase()))    return t('page.ta_tag_configuration.rule_name_duplicate')
    return ''
  }, [tags, name, t])

  const abbrevRule = useMemo(() => {
    if (abbrev.length > 6)                                                       return t('page.ta_tag_configuration.rule_abbrev_max')
    if (abbrev && !/^[A-Z][A-Z0-9]{1,5}$/.test(abbrev))                          return t('page.ta_tag_configuration.rule_abbrev_format')
    if (abbrev && tags.some(ta => ta.abbreviation.toLowerCase() === abbrev.toLowerCase()))
      return t('page.ta_tag_configuration.rule_abbrev_duplicate')
    return ''
  }, [tags, abbrev, t])

  const canSave = name.trim() && abbrev && !nameRule && !abbrevRule

  const autoSuggest = () => setAbbrev(name.replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 6))

  // Runs a mutation, surfaces the API's refusal message, and refreshes the
  // list plus every TA selector (they read the ['taxonomy'] queries).
  const run = async (fn: () => Promise<unknown>): Promise<boolean> => {
    setActionError(null)
    try {
      await fn()
      return true
    } catch (err) {
      setActionError(errorMessage(err))
      return false
    } finally {
      await qc.invalidateQueries({ queryKey: ['ta-tags'] })
      await qc.invalidateQueries({ queryKey: ['taxonomy'] })
    }
  }

  const save = async () => {
    if (!canSave) return
    if (await run(() => platformApi.createTATag({ name: name.trim(), abbreviation: abbrev }))) {
      setName(''); setAbbrev(''); setDrawerOpen(false)
    }
  }
  const archive = (ta: TATag) => run(() => platformApi.archiveTATag(ta.id))
  const doArchive = async () => {
    if (!confirmArchive) return
    await archive(confirmArchive)
    setConfirmArchive(null)
  }
  const restore = (ta: TATag) => run(() => platformApi.restoreTATag(ta.id))
  const del = (ta: TATag) => run(() => platformApi.deleteTATag(ta.id))

  return (
    <div className="bg-slate-50" data-screen="ta-tag-configuration">
      <div className="flex flex-col gap-4" style={{ maxWidth: 1440, padding: '20px 32px 48px' }}>

        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <h1 className="text-[22px] font-bold text-slate-900" style={{ margin: 0 }}>{t('page.ta_tag_configuration.title')}</h1>
            <p className="mt-1 font-mono text-xs text-slate-500" data-current-user>
              {t('page.ta_tag_configuration.user_byline', { name: currentUser.name })} · <span data-active-count>{t('page.ta_tag_configuration.active_count', { count: activeCount })}</span>
            </p>
            <p className="mt-2 max-w-[720px] text-[13px] text-slate-600" data-scope-note>
              {t('page.ta_tag_configuration.scope_note')}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              data-add-tag
              data-panel-trigger
              className="h-9 rounded-md px-4 text-[13px] font-semibold text-white"
              style={{ backgroundColor: PLATFORM_ACCENT.primary }}
            >{t('page.ta_tag_configuration.add_tag')}</button>
          </div>
        </div>

        <div className="[container-type:inline-size]" data-filter-panel>
          <div className="flex flex-wrap items-center gap-3 [@container_(min-width:760px)]:flex-nowrap">
            <input
              type="search" value={search} onChange={e => setSearch(e.currentTarget.value)}
              placeholder={t('page.ta_tag_configuration.search_placeholder')}
              aria-label={t('page.ta_tag_configuration.search_placeholder')}
              data-filter-search
              className={`${filterControl} basis-full min-w-0 [@container_(min-width:760px)]:min-w-[180px] [@container_(min-width:760px)]:flex-[2_1_0%] [@container_(min-width:760px)]:basis-auto`}
            />
            <div data-filter-status className="min-w-[150px] flex-[1_1_150px] [@container_(min-width:760px)]:flex-[1_1_0%]">
              <MultiSelect label={t('page.ta_tag_configuration.col_status')} allLabel={t('page.ta_tag_configuration.all_statuses')}
                options={statusOptions} value={statuses} onChange={setStatuses} optionAttr="data-status-option" className={filterControl} />
            </div>
            <div data-filter-in-use className="min-w-[150px] flex-[1_1_150px] [@container_(min-width:760px)]:flex-[1_1_0%]">
              <MultiSelect label={t('page.ta_tag_configuration.col_in_use')} allLabel={t('page.ta_tag_configuration.all_usage')}
                options={useOptions} value={useFilter} onChange={setUseFilter} optionAttr="data-in-use-option" className={filterControl} />
            </div>
            <button
              type="button" onClick={resetFilters} disabled={!filtersDirty}
              title={filtersDirty ? t('page.master_library.reset_filters') : t('page.master_library.filters_at_defaults')}
              aria-label={t('page.master_library.reset_filters')}
              className="flex h-10 w-10 flex-none items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900 disabled:cursor-default disabled:opacity-40 disabled:hover:bg-white disabled:hover:text-slate-600"
              data-action="reset-filters"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9" />
                <path d="M2.5 2.5v2.8h2.8" />
              </svg>
            </button>
          </div>
        </div>

        {(loadError || actionError) && (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-[13px] text-red-800" data-ta-error>
            {actionError ?? t('page.ta_tag_configuration.err_load', { message: errorMessage(loadError) })}
          </div>
        )}
        {isLoading && <p className="text-[13px] text-slate-500" data-ta-loading>{t('page.ta_tag_configuration.loading')}</p>}

        <div>
          <section className="overflow-hidden rounded-lg border border-slate-200 bg-white" data-tag-table data-tag-count={tags.length}>
            <table className="w-full text-[13px]">
              <thead style={{ backgroundColor: '#F8FAFC' }}>
                <tr className="text-left text-[11px] font-semibold uppercase tracking-widest text-slate-500">
                  {sortHead(t('page.ta_tag_configuration.col_tag_name'), 'name-asc', 'name-desc')}
                  {sortHead(t('page.ta_tag_configuration.col_abbreviation'), 'abbrev-asc', 'abbrev-desc')}
                  {sortHead(t('page.ta_tag_configuration.col_status'), 'status-asc', 'status-desc')}
                  {sortHead(t('page.ta_tag_configuration.col_created'), 'oldest', 'recent')}
                  {sortHead(t('page.ta_tag_configuration.col_in_use'), 'use-asc', 'use-desc')}
                  <th className="px-4 py-2 text-right">{t('page.ta_tag_configuration.col_actions')}</th>
                </tr>
              </thead>
              <tbody>
                {!isLoading && pageRows.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-[12px] text-slate-500" data-state="empty">
                    {filtersDirty ? t('page.ta_tag_configuration.empty_filtered') : t('page.ta_tag_configuration.empty_none')}
                    {filtersDirty && (
                      <div><button type="button" onClick={resetFilters} className="mt-2 font-semibold text-slate-700 underline">{t('page.master_library.reset_filters')}</button></div>
                    )}
                  </td></tr>
                )}
                {pageRows.map(ta => {
                  const inUse = ta.projectCount + ta.documentCount > 0
                  const note  = inUse ? t('page.ta_tag_configuration.in_use_note', { projects: ta.projectCount, documents: ta.documentCount }) : ''
                  const showDelete   = !inUse && ta.status === 'active'
                  return (
                    <tr key={ta.id} className="border-t border-slate-200"
                        data-tag-row={ta.id}
                        data-tag-status={ta.status}
                        data-tag-in-use={inUse || undefined}
                        data-can-delete={showDelete || undefined}>
                      <td className="px-4 py-3 font-semibold text-slate-900">{ta.name}</td>
                      <td className="px-4 py-3 font-mono text-[11px] text-slate-700">{ta.abbreviation}</td>
                      <td className="px-4 py-3"><StatusChip status={ta.status} /></td>
                      <td className="px-4 py-3 text-[12px] text-slate-600" data-tag-created>{formatCreated(ta.createdAt)}</td>
                      <td className="px-4 py-3 text-[12px] text-slate-600" data-tag-note>
                        {note || <span className="text-slate-400">—</span>}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {ta.status === 'archived'
                          ? <button type="button" onClick={() => restore(ta)} className="text-[12px] font-semibold hover:underline" style={{ color: PLATFORM_ACCENT.primary }} data-tag-primary-action="restore">{t('page.ta_tag_configuration.action_restore')}</button>
                          : (inUse
                              ? <button type="button" onClick={() => setConfirmArchive(ta)} className="text-[12px] font-semibold hover:underline" style={{ color: PLATFORM_ACCENT.primary }} data-tag-primary-action="archive">{t('page.ta_tag_configuration.action_archive')}</button>
                              : <button type="button" onClick={() => { void archive(ta) }} className="text-[12px] font-semibold hover:underline" style={{ color: PLATFORM_ACCENT.primary }} data-tag-primary-action="archive">{t('page.ta_tag_configuration.action_archive')}</button>)}
                        {showDelete && (
                          <button type="button" onClick={() => del(ta)} className="ml-3 text-[12px] font-semibold text-slate-500 hover:text-red-700" data-tag-delete>{t('page.ta_tag_configuration.action_delete')}</button>
                        )}
                      </td>
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
                <span data-page-status>{t('page.master_library.page_status', { page: Math.min(page, pageCount), pages: pageCount, count: filtered.length })}</span>
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
            <p className="border-t border-slate-200 p-3 text-[12px]"
               style={{ backgroundColor: PLATFORM_ACCENT.bgTint, color: PLATFORM_ACCENT.primary }}
               data-archive-note>
              {t('page.ta_tag_configuration.archive_note')}
            </p>
          </section>

        </div>

        {confirmArchive && (
          <div className="rounded-lg border p-4"
               style={{ backgroundColor: '#FFFBEB', borderColor: '#FDE68A' }}
               data-archive-confirm={confirmArchive.id}>
            <p className="text-[13px] font-semibold" style={{ color: '#78350F' }}>
              {t('page.ta_tag_configuration.confirm_archive_body', { name: confirmArchive.name, projects: confirmArchive.projectCount, documents: confirmArchive.documentCount })}
            </p>
            <div className="mt-3 flex gap-2">
              <button type="button" onClick={doArchive} data-confirm-archive
                className="h-8 rounded-md px-3 text-[12px] font-semibold text-white"
                style={{ backgroundColor: PLATFORM_ACCENT.primary }}>{t('page.ta_tag_configuration.confirm_archive_action')}</button>
              <button type="button" onClick={() => setConfirmArchive(null)}
                className="h-8 rounded-md border border-slate-300 bg-white px-3 text-[12px] font-semibold text-slate-700">{t('button.cancel')}</button>
            </div>
          </div>
        )}
      </div>

      {/* Add tag — the shared right-hand panel: non-modal (the table stays usable behind it), resizable from
          its left edge, width remembered. A click anywhere outside it closes it, like the Master Library panels. */}
      <SlidePanel open={drawerOpen} onClose={() => setDrawerOpen(false)}
        title={t('page.ta_tag_configuration.drawer_eyebrow')}
        subtitle={<span className="mt-1 block text-[12px] text-slate-500">{t('page.ta_tag_configuration.drawer_subtitle')}</span>}
        storageKey="ta-tag-add" defaultWidth={420} minWidth={340} belowTopBar closeOnOutsideClick>
        <div className="flex flex-col gap-3 px-5 py-5" data-add-drawer>
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">{t('page.ta_tag_configuration.field_tag_name')}</span>
            <input type="text" value={name} onChange={(e) => setName(e.currentTarget.value)}
              data-input-name
              className="h-9 rounded-md border border-slate-300 px-3 text-[13px]" />
            {nameRule && <p className="text-[11px] font-semibold" style={{ color: '#B45309' }} data-name-rule>{nameRule}</p>}
          </label>

          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">{t('page.ta_tag_configuration.field_abbreviation')}</span>
            <div className="flex items-center gap-2">
              <input type="text" value={abbrev} onChange={(e) => setAbbrev(e.currentTarget.value.toUpperCase())} maxLength={6}
                data-input-abbrev
                className="h-9 flex-1 rounded-md border border-slate-300 px-3 font-mono text-[13px]" />
              <button type="button" onClick={autoSuggest} data-auto-suggest
                className="text-[11px] font-semibold hover:underline"
                style={{ color: PLATFORM_ACCENT.primary }}>{t('page.ta_tag_configuration.auto_suggest')}</button>
            </div>
            {abbrevRule && <p className="text-[11px] font-semibold" style={{ color: '#B45309' }} data-abbrev-rule>{abbrevRule}</p>}
          </label>

          <p className="rounded-md p-3 text-[12px]"
             style={{ backgroundColor: PLATFORM_ACCENT.bgTint, color: PLATFORM_ACCENT.primary }}
             data-audit-note>
            {t('page.ta_tag_configuration.audit_note')}
          </p>

          <div className="flex items-center gap-2">
            <button type="button" onClick={save} disabled={!canSave}
              data-save-tag
              className="h-9 rounded-md px-4 text-[13px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
              style={{ backgroundColor: PLATFORM_ACCENT.primary }}
            >{t('page.ta_tag_configuration.save_tag')}</button>
            <button type="button" onClick={() => setDrawerOpen(false)}
              className="h-9 rounded-md border border-slate-300 bg-white px-3 text-[13px] font-semibold text-slate-700 hover:bg-slate-50"
            >{t('button.cancel')}</button>
          </div>
        </div>
      </SlidePanel>
    </div>
  )
}
