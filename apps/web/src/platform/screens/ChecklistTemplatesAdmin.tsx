// Admin Panel · Checklist Templates — Phase 4b + 4c.
//
// Catalog of every checklist template the current admin can see (platform
// baselines + per-project overrides) with full edit controls on drafts:
// bump-new-draft, add/edit/delete items, reorder up/down, approve + lock.

import { MasterLibraryHeading } from '../components/MasterLibraryHeading'
import { MultiSelect } from '../components/MultiSelect'
import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { documentsApi } from '../../api/documents'
import { projectsApi } from '../../api/projects'
import { ApiError } from '../../api/client'
import { SlidePanel } from '../../components/ui/SlidePanel'
import { SortIcon } from '../../components/ui/SortIcon'
import { PLATFORM_ACCENT } from '@platform/types'

type Template = Awaited<ReturnType<typeof documentsApi.listChecklistTemplates>>[number]
type TemplateDetail = Awaited<ReturnType<typeof documentsApi.getChecklistTemplate>>
type TemplateItem = TemplateDetail['items'][number]
type Stage = TemplateItem['stage']
type Raci = TemplateItem['ownerRaci']
type AutoTrigger = Exclude<TemplateItem['autoCompleteOn'], null | undefined>

// --- Metadata (mirrors ChecklistPanel so the admin + authoring views look consistent)

const STAGE_ORDER = [
  'study_start_up',
  'during_study',
  'reporting',
  'cross_functional_review',
  'crm',
  'final_output',
] as const

const STAGE_LABEL_KEYS: Record<(typeof STAGE_ORDER)[number], string> = {
  study_start_up:          'page.checklist_templates_admin.stage_study_start_up',
  during_study:            'page.checklist_templates_admin.stage_during_study',
  reporting:               'page.checklist_templates_admin.stage_reporting',
  cross_functional_review: 'page.checklist_templates_admin.stage_cross_functional_review',
  crm:                     'page.checklist_templates_admin.stage_crm',
  final_output:            'page.checklist_templates_admin.stage_final_output',
}

const DELIVERABLE_LABEL_KEYS: Record<string, string> = {
  csr_full:              'page.checklist_templates_admin.deliverable_csr_full',
  csr_synopsis:          'page.checklist_templates_admin.deliverable_csr_synopsis',
  protocol:              'page.checklist_templates_admin.deliverable_protocol',
  protocol_amendment:    'page.checklist_templates_admin.deliverable_protocol_amendment',
  ib:                    'page.checklist_templates_admin.deliverable_ib',
  icf:                   'page.checklist_templates_admin.deliverable_icf',
  safety_narrative:      'page.checklist_templates_admin.deliverable_safety_narrative',
  dsur:                  'page.checklist_templates_admin.deliverable_dsur',
  end_of_study_summary:  'page.checklist_templates_admin.deliverable_end_of_study_summary',
  patient_narrative:     'page.checklist_templates_admin.deliverable_patient_narrative',
}

const RACI_COLOUR: Record<'R' | 'A' | 'C' | 'I', { bg: string; fg: string }> = {
  R: { bg: '#DBEAFE', fg: '#1D4ED8' },
  A: { bg: '#FEF3C7', fg: '#B45309' },
  C: { bg: '#E0E7FF', fg: '#4338CA' },
  I: { bg: '#F1F5F9', fg: '#475569' },
}

const AUTO_LABEL_KEYS: Record<string, string> = {
  submit_for_review: 'page.checklist_templates_admin.auto_submit_for_review',
  crm_complete:      'page.checklist_templates_admin.auto_crm_complete',
  document_signed:   'page.checklist_templates_admin.auto_document_signed',
}

const TEMPLATE_STATUS_KEYS: Record<string, string> = {
  draft:  'page.checklist_templates_admin.status_draft',
  locked: 'page.checklist_templates_admin.status_locked',
}

type SortKey = 'deliverable-asc' | 'deliverable-desc' | 'version-asc' | 'version-desc' | 'items-asc' | 'items-desc' | 'recent' | 'oldest'
const PAGE_SIZES = [10, 20, 50]
const filterControl = 'h-10 w-full rounded-md border border-slate-300 bg-white px-2.5 text-[12px] text-slate-800'

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function ChecklistTemplatesAdmin() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [selected, setSelected] = useState<string | null>(null)
  const [approveError, setApproveError] = useState<string | null>(null)
  // When set, the project-override wizard is open for this template id.
  const [cloneForTemplateId, setCloneForTemplateId] = useState<string | null>(null)

  const deliverableTypeLabel = (key: string): string => {
    const k = DELIVERABLE_LABEL_KEYS[key]
    return k ? t(k) : key
  }

  const listQ = useQuery({
    queryKey: ['checklist-templates'],
    queryFn:  () => documentsApi.listChecklistTemplates(),
  })

  const detailQ = useQuery({
    queryKey: ['checklist-template', selected],
    queryFn:  () => documentsApi.getChecklistTemplate(selected!),
    enabled:  !!selected,
  })

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['checklist-templates'] })
    if (selected) void qc.invalidateQueries({ queryKey: ['checklist-template', selected] })
  }

  const extractApiError = (err: unknown): string => {
    if (err instanceof ApiError) {
      const body = err.body as { message?: string } | null
      return body?.message ?? `HTTP ${err.status}`
    }
    return (err instanceof Error ? err.message : t('page.checklist_templates_admin.err_request_failed'))
  }

  // After an approval: how many in-flight documents were told a newer version is available (CW-028).
  const [approvedNotice, setApprovedNotice] = useState<string | null>(null)
  const approveMut = useMutation({
    mutationFn: (id: string) => documentsApi.approveChecklistTemplate(id),
    onSuccess:  (res) => {
      setApproveError(null)
      setApprovedNotice(t('page.checklist_templates_admin.approved_notice', { count: res.inFlightDocumentsNotified ?? 0 }))
      invalidate()
    },
    onError: (err: unknown) => setApproveError(t('page.checklist_templates_admin.err_approve', { message: extractApiError(err) })),
  })

  const bumpMut = useMutation({
    mutationFn: (id: string) => documentsApi.bumpChecklistTemplateDraft(id),
    onSuccess: (created) => {
      setApproveError(null)
      invalidate()
      setSelected(created.id)
    },
    onError: (err: unknown) => setApproveError(t('page.checklist_templates_admin.err_create_draft', { message: extractApiError(err) })),
  })

  const cloneMut = useMutation({
    mutationFn: (args: { templateId: string; projectId: string }) =>
      documentsApi.cloneChecklistTemplateToProject(args.templateId, args.projectId),
    onSuccess: (created) => {
      setApproveError(null)
      setCloneForTemplateId(null)
      invalidate()
      setSelected(created.id)
    },
    onError: (err: unknown) => setApproveError(t('page.checklist_templates_admin.err_clone', { message: extractApiError(err) })),
  })

  const addItemMut = useMutation({
    mutationFn: (args: Parameters<typeof documentsApi.addChecklistTemplateItem>[1] & { templateId: string }) =>
      documentsApi.addChecklistTemplateItem(args.templateId, args),
    onSuccess: invalidate,
  })
  const patchItemMut = useMutation({
    mutationFn: (args: { itemId: string } & Parameters<typeof documentsApi.patchChecklistTemplateItem>[1]) => {
      const { itemId, ...rest } = args
      return documentsApi.patchChecklistTemplateItem(itemId, rest)
    },
    onSuccess: invalidate,
  })
  const deleteItemMut = useMutation({
    mutationFn: (itemId: string) => documentsApi.deleteChecklistTemplateItem(itemId),
    onSuccess: invalidate,
  })
  const moveItemMut = useMutation({
    mutationFn: (args: { itemId: string; direction: 'up' | 'down' }) =>
      documentsApi.moveChecklistTemplateItem(args.itemId, args.direction),
    onSuccess: invalidate,
  })

  // --- List: filters, sort and paging (the same controls as Master Documents; the list is small, so they run in the browser)
  const [search,       setSearch]       = useState('')
  const [deliverables, setDeliverables] = useState<string[]>([])
  const [statuses,     setStatuses]     = useState<string[]>([])
  const [scopes,       setScopes]       = useState<string[]>([])
  const [sort,         setSort]         = useState<SortKey>('deliverable-asc')
  const [page,         setPage]         = useState(1)
  const [pageSize,     setPageSize]     = useState(PAGE_SIZES[0]!)

  const deliverableOptions = useMemo(
    () => Array.from(new Set((listQ.data ?? []).map(r => r.deliverableType)))
      .map(k => ({ value: k, label: deliverableTypeLabel(k) }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [listQ.data, t])
  const statusOptions = ['draft', 'locked'].map(k => ({ value: k, label: TEMPLATE_STATUS_KEYS[k] ? t(TEMPLATE_STATUS_KEYS[k]) : k }))
  const scopeOptions = [
    { value: 'platform', label: t('page.checklist_templates_admin.scope_platform_baseline') },
    { value: 'project',  label: t('page.checklist_templates_admin.scope_project_override', { defaultValue: 'Project override' }) },
  ]

  const filtersDirty = search.trim() !== '' || deliverables.length > 0 || statuses.length > 0 || scopes.length > 0
  const resetFilters = () => { setSearch(''); setDeliverables([]); setStatuses([]); setScopes([]) }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const rows = (listQ.data ?? []).filter(r => {
      if (deliverables.length > 0 && !deliverables.includes(r.deliverableType)) return false
      if (statuses.length > 0 && !statuses.includes(r.templateStatus)) return false
      if (scopes.length > 0 && !scopes.includes(r.projectId == null ? 'platform' : 'project')) return false
      if (q && ![deliverableTypeLabel(r.deliverableType), r.projectId ?? '', r.changeReason ?? '', r.createdByName ?? r.createdBy ?? '', r.approvedByName ?? r.approvedBy ?? '']
        .some(v => v.toLowerCase().includes(q))) return false
      return true
    })
    const label = (r: Template) => deliverableTypeLabel(r.deliverableType)
    const time = (v: string | null) => (v ? new Date(v).getTime() : 0)
    const by: Record<SortKey, (x: Template, y: Template) => number> = {
      'deliverable-asc':  (x, y) => label(x).localeCompare(label(y)) || y.version - x.version,
      'deliverable-desc': (x, y) => label(y).localeCompare(label(x)) || y.version - x.version,
      'version-asc':      (x, y) => x.version - y.version,
      'version-desc':     (x, y) => y.version - x.version,
      'items-asc':        (x, y) => x.itemCount - y.itemCount,
      'items-desc':       (x, y) => y.itemCount - x.itemCount,
      'recent':           (x, y) => time(y.effectiveDate) - time(x.effectiveDate),
      'oldest':           (x, y) => time(x.effectiveDate) - time(y.effectiveDate),
    }
    return [...rows].sort(by[sort])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listQ.data, search, deliverables, statuses, scopes, sort, t])

  useEffect(() => { setPage(1) }, [search, deliverables, statuses, scopes, sort, pageSize])
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const pageRows  = filtered.slice((Math.min(page, pageCount) - 1) * pageSize, Math.min(page, pageCount) * pageSize)

  const sortFor = (asc: SortKey, desc: SortKey): 'asc' | 'desc' | null => sort === asc ? 'asc' : sort === desc ? 'desc' : null
  const SortHead = ({ label, asc, desc }: { label: string; asc: SortKey; desc: SortKey }) => (
    <th className="px-4 py-3 text-left" aria-sort={sort === asc ? 'ascending' : sort === desc ? 'descending' : 'none'}>
      <button type="button" onClick={() => setSort(sort === asc ? desc : asc)} data-sort={asc}
        className="inline-flex items-center gap-1.5 uppercase tracking-widest hover:text-slate-800">
        {label}<SortIcon state={sortFor(asc, desc)} />
      </button>
    </th>
  )
  const PlainHead = ({ label }: { label: string }) => <th className="px-4 py-3 text-left uppercase tracking-widest">{label}</th>

  const detail = detailQ.data
  const openRow = (id: string) => { setSelected(id); setApproveError(null); setApprovedNotice(null) }
  const closePanel = () => { setSelected(null); setApproveError(null); setApprovedNotice(null) }

  return (
    <div className="bg-slate-50" data-screen="checklist-templates-admin">
      <div className="flex flex-col gap-4" style={{ maxWidth: 1600, padding: '20px 24px 48px' }}>
        <MasterLibraryHeading>
          <h1 className="text-[20px] font-semibold text-slate-900">{t('page.checklist_templates_admin.title')}</h1>
          <p className="mt-0.5 text-[13px] text-slate-500">
            {t('page.checklist_templates_admin.subtitle')}
          </p>
        </MasterLibraryHeading>

        {/* Filters — search, Deliverable, Status, Scope and reset in one row, like Master Documents. New drafts and
            project overrides are made from a template's panel (a template is never started from nothing). */}
        <div className="[container-type:inline-size]" data-filter-panel>
          <div className="flex flex-wrap items-center gap-3 [@container_(min-width:900px)]:flex-nowrap">
            <input
              type="search" value={search} onChange={e => setSearch(e.currentTarget.value)}
              placeholder={t('page.checklist_templates_admin.search_placeholder', { defaultValue: 'Search checklists' })}
              aria-label={t('page.checklist_templates_admin.search_placeholder', { defaultValue: 'Search checklists' })}
              data-filter-search
              className={`${filterControl} basis-full min-w-0 [@container_(min-width:900px)]:min-w-[180px] [@container_(min-width:900px)]:flex-[2_1_0%] [@container_(min-width:900px)]:basis-auto`}
            />
            <div data-filter-deliverable className="min-w-[150px] flex-[1_1_150px] [@container_(min-width:900px)]:flex-[1_1_0%]">
              <MultiSelect label={t('page.checklist_templates_admin.col_deliverable', { defaultValue: 'Deliverable' })} allLabel={t('page.checklist_templates_admin.all_deliverables', { defaultValue: 'All deliverables' })}
                options={deliverableOptions} value={deliverables} onChange={setDeliverables} optionAttr="data-deliverable-option" className={filterControl} />
            </div>
            <div data-filter-status className="min-w-[140px] flex-[1_1_140px] [@container_(min-width:900px)]:flex-[1_1_0%]">
              <MultiSelect label={t('page.checklist_templates_admin.versions_col_status')} allLabel={t('page.checklist_templates_admin.all_statuses', { defaultValue: 'All statuses' })}
                options={statusOptions} value={statuses} onChange={setStatuses} optionAttr="data-status-option" className={filterControl} />
            </div>
            <div data-filter-scope className="min-w-[140px] flex-[1_1_140px] [@container_(min-width:900px)]:flex-[1_1_0%]">
              <MultiSelect label={t('page.checklist_templates_admin.col_scope', { defaultValue: 'Scope' })} allLabel={t('page.checklist_templates_admin.all_scopes', { defaultValue: 'All scopes' })}
                options={scopeOptions} value={scopes} onChange={setScopes} optionAttr="data-scope-option" className={filterControl} />
            </div>
            <button
              type="button" onClick={resetFilters} disabled={!filtersDirty}
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

        {listQ.isError && (
          <p className="rounded-md bg-red-50 p-3 text-[12px] text-red-800" role="alert" data-state="error">{t('page.checklist_templates_admin.load_failed_list')}</p>
        )}

        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white" data-results-list>
          <table className="w-full border-collapse text-[13px]">
            <thead className="border-b border-slate-200 bg-slate-50 font-mono text-[10px] font-semibold text-slate-500">
              <tr>
                <SortHead label={t('page.checklist_templates_admin.col_deliverable', { defaultValue: 'Deliverable' })} asc="deliverable-asc" desc="deliverable-desc" />
                <SortHead label={t('page.checklist_templates_admin.versions_col_version')} asc="version-asc" desc="version-desc" />
                <PlainHead label={t('page.checklist_templates_admin.col_scope', { defaultValue: 'Scope' })} />
                <PlainHead label={t('page.checklist_templates_admin.versions_col_status')} />
                <SortHead label={t('page.checklist_templates_admin.col_items', { defaultValue: 'Items' })} asc="items-asc" desc="items-desc" />
                <PlainHead label={t('page.checklist_templates_admin.col_documents', { defaultValue: 'Documents' })} />
                <SortHead label={t('page.checklist_templates_admin.versions_col_effective')} asc="oldest" desc="recent" />
                <PlainHead label={t('page.checklist_templates_admin.versions_col_people')} />
              </tr>
            </thead>
            <tbody>
              {listQ.isLoading && (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-[12px] text-slate-500" data-state="loading">{t('page.checklist_templates_admin.loading_list')}</td></tr>
              )}
              {!listQ.isLoading && !listQ.isError && pageRows.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-[12px] text-slate-500" data-state="empty">
                  {filtersDirty ? t('page.checklist_templates_admin.empty_filtered', { defaultValue: 'No checklists match these filters.' }) : t('page.checklist_templates_admin.empty_list')}
                  {filtersDirty && (
                    <div><button type="button" onClick={resetFilters} className="mt-2 font-semibold text-slate-700 underline">{t('page.master_library.reset_filters')}</button></div>
                  )}
                </td></tr>
              )}
              {pageRows.map(tpl => {
                const isActive = tpl.id === selected
                return (
                  <tr key={tpl.id} onClick={() => openRow(tpl.id)} tabIndex={0}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openRow(tpl.id) } }}
                    data-template-row={tpl.id} data-template-active={isActive || undefined} data-panel-trigger aria-current={isActive || undefined}
                    className="cursor-pointer border-b border-slate-100 last:border-b-0 hover:bg-slate-50"
                    style={{ backgroundColor: isActive ? PLATFORM_ACCENT.bgTint : undefined }}>
                    <td className="px-4 py-3 font-semibold text-slate-900">{deliverableTypeLabel(tpl.deliverableType)}</td>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-[12px] text-slate-700">
                      v{tpl.version}
                      {tpl.isCurrent && <span className="ml-1.5 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700">{t('page.checklist_templates_admin.version_current')}</span>}
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {tpl.projectId == null ? t('page.checklist_templates_admin.scope_platform_baseline') : t('page.checklist_templates_admin.scope_project', { projectId: tpl.projectId })}
                    </td>
                    <td className="px-4 py-3">
                      <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase"
                        style={tpl.templateStatus === 'locked' ? { backgroundColor: '#DCFCE7', color: '#15803D' } : { backgroundColor: '#FEF3C7', color: '#B45309' }}>
                        {TEMPLATE_STATUS_KEYS[tpl.templateStatus] ? t(TEMPLATE_STATUS_KEYS[tpl.templateStatus]) : tpl.templateStatus}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-700">{tpl.itemCount}</td>
                    <td className="px-4 py-3 text-slate-700">{tpl.instanceCount}</td>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-[12px] text-slate-700">{tpl.templateStatus === 'locked' ? fmtDate(tpl.effectiveDate) : '—'}</td>
                    <td className="px-4 py-3 text-[12px] text-slate-600" data-template-row-history>
                      {tpl.createdByName ?? tpl.createdBy}
                      {tpl.approvedAt && <> → {tpl.approvedByName ?? tpl.approvedBy ?? '—'}</>}
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
              <span>{t('page.master_library.page_status', { page: Math.min(page, pageCount), pages: pageCount, count: filtered.length })}</span>
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

      {/* The template's items and actions open in a right-hand panel; a click outside it closes it, like every
          Master Library panel. */}
      <SlidePanel open={!!selected} onClose={closePanel}
        title={detail ? `${deliverableTypeLabel(detail.deliverableType)} · ${t('page.checklist_templates_admin.detail_version', { version: detail.version })}` : t('page.checklist_templates_admin.title')}
        subtitle={detail && (
          <span className="mt-1 block truncate text-[12px] text-slate-500">
            {detail.projectId == null ? t('page.checklist_templates_admin.scope_platform_baseline') : t('page.checklist_templates_admin.scope_project', { projectId: detail.projectId })}
          </span>
        )}
        storageKey="checklist-detail" defaultWidth={880} belowTopBar closeOnOutsideClick>
        {selected && detailQ.isLoading && (
          <p className="px-5 py-10 text-sm text-slate-400">{t('page.checklist_templates_admin.loading_detail')}</p>
        )}
        {selected && detailQ.isError && (
          <p className="px-5 py-10 text-sm text-red-700" role="alert">{t('page.checklist_templates_admin.load_failed_detail')}</p>
        )}
        {selected && detail && (
          <TemplateDetailView
            template={detail}
            deliverableTypeLabel={deliverableTypeLabel}
            onApprove={() => approveMut.mutate(detail.id)}
            approving={approveMut.isPending}
            approveError={approveError}
            approvedNotice={approvedNotice}
            versions={(listQ.data ?? []).filter(r => r.deliverableType === detail.deliverableType && r.projectId === detail.projectId)}
            onSelectVersion={openRow}
            onBumpDraft={() => bumpMut.mutate(detail.id)}
            bumping={bumpMut.isPending}
            onCloneToProject={() => setCloneForTemplateId(detail.id)}
            onAddItem={(body) => addItemMut.mutate({ templateId: detail.id, ...body })}
            onPatchItem={(itemId, body) => patchItemMut.mutate({ itemId, ...body })}
            onDeleteItem={(itemId) => deleteItemMut.mutate(itemId)}
            onMoveItem={(itemId, direction) => moveItemMut.mutate({ itemId, direction })}
            anyMutating={addItemMut.isPending || patchItemMut.isPending || deleteItemMut.isPending || moveItemMut.isPending}
          />
        )}
      </SlidePanel>

      {cloneForTemplateId && (
        <CloneToProjectModal
          templateId={cloneForTemplateId}
          onCancel={() => setCloneForTemplateId(null)}
          onConfirm={(projectId) => cloneMut.mutate({ templateId: cloneForTemplateId, projectId })}
          submitting={cloneMut.isPending}
          error={cloneMut.isError ? extractApiError(cloneMut.error) : null}
        />
      )}
    </div>
  )
}

// --- Project-override wizard ---

function CloneToProjectModal({ templateId, onCancel, onConfirm, submitting, error }: {
  templateId: string
  onCancel: () => void
  onConfirm: (projectId: string) => void
  submitting: boolean
  error: string | null
}) {
  const { t } = useTranslation()
  const [projectId, setProjectId] = useState<string>('')
  const projectsQ = useQuery({
    queryKey: ['projects'],
    queryFn:  () => projectsApi.list(),
  })

  // Hint: templates coming from one project can still be cloned onto another;
  // the backend only blocks when the target already has an override. The
  // modal label stays generic because the user picks the destination.
  void templateId

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="clone-modal-title"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        <h3 id="clone-modal-title" className="text-base font-semibold text-slate-900">
          {t('page.checklist_templates_admin.clone_title')}
        </h3>
        <p className="mt-1 text-[12px] text-slate-500">
          {t('page.checklist_templates_admin.clone_hint_prefix')} <span className="font-semibold">{t('page.checklist_templates_admin.clone_hint_draft_word')}</span>
          {' '}{t('page.checklist_templates_admin.clone_hint_suffix')}
        </p>

        <label className="mt-4 block">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{t('page.checklist_templates_admin.clone_project_label')}</span>
          {projectsQ.isLoading && (
            <p className="mt-1 text-[12px] text-slate-400">{t('page.checklist_templates_admin.loading_projects')}</p>
          )}
          {projectsQ.isError && (
            <p className="mt-1 text-[12px] text-red-700">{t('page.checklist_templates_admin.err_load_projects')}</p>
          )}
          {projectsQ.data && (
            <select
              value={projectId}
              onChange={e => setProjectId(e.target.value)}
              className="mt-1 h-9 w-full rounded border border-slate-200 bg-white px-2 text-[13px] outline-none focus:border-blue-600"
              data-field="project-id"
            >
              <option value="">{t('page.checklist_templates_admin.clone_select_project')}</option>
              {projectsQ.data.map(p => (
                <option key={p.id} value={p.id}>
                  {p.shortTitle ?? p.name} ({p.id})
                </option>
              ))}
            </select>
          )}
        </label>

        {error && (
          <div className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700" role="alert">
            {error}
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="rounded border border-slate-200 bg-white px-3 py-1.5 text-[12px] font-semibold text-slate-700 hover:bg-slate-50"
          >
            {t('button.cancel')}
          </button>
          <button
            type="button"
            onClick={() => projectId && onConfirm(projectId)}
            disabled={!projectId || submitting}
            className="rounded bg-blue-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-blue-700 disabled:bg-slate-300"
            data-action="confirm-clone"
          >
            {submitting ? t('page.checklist_templates_admin.creating_draft') : t('page.checklist_templates_admin.create_override_draft')}
          </button>
        </div>
      </div>
    </div>
  )
}

interface TemplateDetailViewProps {
  template: TemplateDetail
  deliverableTypeLabel: (key: string) => string
  onApprove: () => void
  approving: boolean
  approveError: string | null
  approvedNotice: string | null
  /** Every version of this template (same deliverable type and scope), newest first. */
  versions: Template[]
  onSelectVersion: (id: string) => void
  onBumpDraft: () => void
  bumping: boolean
  onCloneToProject: () => void
  onAddItem: (body: Parameters<typeof documentsApi.addChecklistTemplateItem>[1]) => void
  onPatchItem: (itemId: string, body: Parameters<typeof documentsApi.patchChecklistTemplateItem>[1]) => void
  onDeleteItem: (itemId: string) => void
  onMoveItem: (itemId: string, direction: 'up' | 'down') => void
  anyMutating: boolean
}

function TemplateDetailView(props: TemplateDetailViewProps) {
  const { t } = useTranslation()
  const { template } = props
  const [editingId, setEditingId] = useState<string | null>(null)
  const [addingStage, setAddingStage] = useState<Stage | null>(null)

  // Group items by stage for the detail view, mirroring the per-document
  // ChecklistPanel so the admin preview matches what writers will see.
  const byStage = useMemo(() => {
    const bins = new Map<string, TemplateDetail['items']>()
    for (const it of template.items) {
      const list = bins.get(it.stage) ?? []
      list.push(it)
      bins.set(it.stage, list)
    }
    const ordered: Array<{ stage: Stage; label: string; items: TemplateDetail['items'] }> = []
    for (const s of STAGE_ORDER) {
      if (bins.has(s)) ordered.push({ stage: s, label: t(STAGE_LABEL_KEYS[s]), items: bins.get(s)! })
    }
    return ordered
  }, [template, t])

  const isDraft   = template.templateStatus === 'draft'
  // Approval cycle (CW-029): an author of the draft can't approve it. The API says so (canApprove).
  const showApprove   = isDraft
  const selfAuthored  = isDraft && template.canApprove === false
  const canBump    = template.templateStatus === 'locked'
  const versions = [...props.versions].sort((a, b) => b.version - a.version)

  return (
    <div className="flex flex-col">
      <div className="flex flex-none items-start justify-between gap-4 border-b border-slate-200 bg-white px-5 py-5">
        <div>
          <p className="text-[12px] text-slate-500">
            {t('page.checklist_templates_admin.detail_summary', { items: template.items.length, docs: template.instanceCount, effective: fmtDate(template.effectiveDate) })}
            {template.approvedAt && t('page.checklist_templates_admin.detail_approved_suffix', { date: fmtDate(template.approvedAt) })}
          </p>
          <p className="mt-1 text-[11px] italic text-slate-500">{template.changeReason}</p>
          <p className="mt-1 text-[11px] text-slate-600" data-template-people>
            {t('page.checklist_templates_admin.detail_drafted_by', { name: template.createdByName ?? template.createdBy })}
            {template.approvedAt && <> · {t('page.checklist_templates_admin.detail_approved_by', { name: template.approvedByName ?? template.approvedBy ?? '—', date: fmtDate(template.approvedAt) })}</>}
            {isDraft && (template.draftAuthors?.length ?? 0) > 1 && <> · {t('page.checklist_templates_admin.detail_draft_authors', { names: template.draftAuthors!.join(', ') })}</>}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <span
            className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase"
            style={isDraft
              ? { backgroundColor: '#FEF3C7', color: '#B45309' }
              : { backgroundColor: '#DCFCE7', color: '#15803D' }}
          >
            {TEMPLATE_STATUS_KEYS[template.templateStatus] ? t(TEMPLATE_STATUS_KEYS[template.templateStatus]) : template.templateStatus}
          </span>
          {showApprove && (
            <button
              type="button"
              onClick={props.onApprove}
              disabled={props.approving || selfAuthored}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-blue-700 disabled:bg-slate-300"
              data-action="approve-template"
              title={selfAuthored ? t('page.checklist_templates_admin.self_approval_note') : undefined}
            >
              {props.approving ? t('page.checklist_templates_admin.approving') : t('page.checklist_templates_admin.approve_and_lock')}
            </button>
          )}
          {selfAuthored && (
            <p className="max-w-[260px] text-right text-[11px] text-slate-500" data-self-approval-note>
              {t('page.checklist_templates_admin.self_approval_note')}
            </p>
          )}
          {props.approvedNotice && !isDraft && (
            <p className="max-w-[260px] rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-right text-[11px] text-emerald-800" role="status" data-approved-notice>
              {props.approvedNotice}
            </p>
          )}
          {canBump && (
            <button
              type="button"
              onClick={props.onBumpDraft}
              disabled={props.bumping}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-[12px] font-semibold text-slate-900 hover:bg-slate-50 disabled:text-slate-400"
              data-action="bump-draft"
              title={t('page.checklist_templates_admin.bump_draft_tooltip')}
            >
              {props.bumping ? t('page.checklist_templates_admin.creating_draft') : t('page.checklist_templates_admin.bump_new_draft')}
            </button>
          )}
          {/* Project override — allowed from any locked template (baseline
              or an existing project override). Hidden on drafts to keep the
              workflow linear: approve the current draft first. */}
          {!isDraft && (
            <button
              type="button"
              onClick={props.onCloneToProject}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-[12px] font-semibold text-slate-900 hover:bg-slate-50"
              data-action="clone-to-project"
              title={t('page.checklist_templates_admin.create_project_override_tooltip')}
            >
              {t('page.checklist_templates_admin.create_project_override')}
            </button>
          )}
          {props.approveError && (
            <p className="max-w-[260px] rounded border border-red-200 bg-red-50 px-2 py-1 text-right text-[11px] text-red-700" role="alert">
              {props.approveError}
            </p>
          )}
        </div>
      </div>

      <div className="bg-slate-50 pb-4">
        {/* Template library (CW-029): every version of this template, its status and effective date. */}
        {versions.length > 1 && (
          <section className="mx-5 mt-4 overflow-hidden rounded-lg border border-slate-200 bg-white" data-template-versions>
            <h3 className="border-b border-slate-100 px-4 py-2 font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">
              {t('page.checklist_templates_admin.versions_heading', { count: versions.length })}
            </h3>
            <table className="w-full text-left text-[12px]">
              <thead className="text-[10px] uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-4 py-1.5 font-semibold">{t('page.checklist_templates_admin.versions_col_version')}</th>
                  <th className="px-4 py-1.5 font-semibold">{t('page.checklist_templates_admin.versions_col_status')}</th>
                  <th className="px-4 py-1.5 font-semibold">{t('page.checklist_templates_admin.versions_col_effective')}</th>
                  <th className="px-4 py-1.5 font-semibold">{t('page.checklist_templates_admin.versions_col_people')}</th>
                  <th className="px-4 py-1.5 font-semibold">{t('page.checklist_templates_admin.versions_col_reason')}</th>
                </tr>
              </thead>
              <tbody>
                {versions.map(v => (
                  <tr
                    key={v.id}
                    onClick={() => props.onSelectVersion(v.id)}
                    className={`cursor-pointer border-t border-slate-100 hover:bg-slate-50 ${v.id === template.id ? 'bg-blue-50/60' : ''}`}
                    data-template-version-row={v.version}
                  >
                    <td className="px-4 py-1.5 font-semibold text-slate-900">v{v.version}</td>
                    <td className="px-4 py-1.5">
                      {v.templateStatus === 'draft'
                        ? t('page.checklist_templates_admin.status_draft')
                        : v.isCurrent ? t('page.checklist_templates_admin.version_current') : t('page.checklist_templates_admin.version_superseded')}
                    </td>
                    <td className="px-4 py-1.5 text-slate-600">{v.templateStatus === 'locked' ? fmtDate(v.effectiveDate) : '—'}</td>
                    <td className="px-4 py-1.5 text-slate-600">
                      {v.createdByName ?? v.createdBy}
                      {v.approvedAt && <> → {v.approvedByName ?? v.approvedBy}</>}
                    </td>
                    <td className="px-4 py-1.5 text-slate-500">{v.changeReason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
        {byStage.length === 0 && !isDraft && (
          <p className="px-5 py-10 text-sm text-slate-500">
            {t('page.checklist_templates_admin.empty_template')}
          </p>
        )}
        {/* On a draft, always render every stage so the admin can add
            items into an empty stage via the "+ Add item" button. */}
        {(isDraft ? STAGE_ORDER : byStage.map(g => g.stage)).map(stageKey => {
          const stage = stageKey as Stage
          const group = byStage.find(g => g.stage === stage)
          const items = group?.items ?? []
          return (
            <section key={stage} className="mt-4 first:mt-0" data-stage-group={stage}>
              <h3 className="px-5 pt-4 pb-2 font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                {t('page.checklist_templates_admin.stage_heading', { stage: t(STAGE_LABEL_KEYS[stage]), count: items.length })}
              </h3>
              <div className="mx-5 overflow-hidden rounded-lg border border-slate-200 bg-white">
                {items.map((it, i) => (
                  editingId === it.id ? (
                    <EditItemRow
                      key={it.id}
                      item={it}
                      onCancel={() => setEditingId(null)}
                      onSave={(body) => { props.onPatchItem(it.id, body); setEditingId(null) }}
                      disabled={props.anyMutating}
                    />
                  ) : (
                    <ReadItemRow
                      key={it.id}
                      item={it}
                      isLast={i === items.length - 1}
                      canEdit={isDraft}
                      canMoveUp={isDraft && i > 0}
                      canMoveDown={isDraft && i < items.length - 1}
                      onEdit={() => setEditingId(it.id)}
                      onDelete={() => props.onDeleteItem(it.id)}
                      onMove={(dir) => props.onMoveItem(it.id, dir)}
                      busy={props.anyMutating}
                    />
                  )
                ))}
                {isDraft && addingStage !== stage && (
                  <button
                    type="button"
                    onClick={() => setAddingStage(stage)}
                    className="w-full border-t border-slate-100 px-4 py-2 text-left text-[12px] font-semibold text-blue-600 hover:bg-slate-50"
                    data-action="add-item"
                    data-stage={stage}
                  >
                    {t('page.checklist_templates_admin.add_item')}
                  </button>
                )}
                {isDraft && addingStage === stage && (
                  <AddItemRow
                    stage={stage}
                    onCancel={() => setAddingStage(null)}
                    onSave={(body) => { props.onAddItem(body); setAddingStage(null) }}
                    disabled={props.anyMutating}
                  />
                )}
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}

// --- Row sub-components ---

function ReadItemRow({ item, isLast, canEdit, canMoveUp, canMoveDown, onEdit, onDelete, onMove, busy }: {
  item: TemplateItem
  isLast: boolean
  canEdit: boolean
  canMoveUp: boolean
  canMoveDown: boolean
  onEdit: () => void
  onDelete: () => void
  onMove: (dir: 'up' | 'down') => void
  busy: boolean
}) {
  const { t } = useTranslation()
  return (
    <div
      className={`flex items-start gap-3 px-4 py-3 ${isLast ? '' : 'border-b border-slate-100'}`}
      data-item-id={item.id}
    >
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold text-slate-900">{item.text}</p>
        <p className="mt-0.5 text-[11px] text-slate-500">
          {item.framework}
          {item.frameworkMandatory ? t('page.checklist_templates_admin.mandatory_suffix') : t('page.checklist_templates_admin.recommended_suffix')}
        </p>
        <div className="mt-1 flex flex-wrap gap-1.5">
          <span
            className="inline-flex items-center rounded-full px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide"
            style={{ backgroundColor: RACI_COLOUR[item.ownerRaci].bg, color: RACI_COLOUR[item.ownerRaci].fg }}
          >
            {item.ownerRaci}
          </span>
          {item.autoCompleteOn && (
            <span
              className="inline-flex items-center gap-0.5 rounded-full border px-1.5 py-px text-[10px] font-medium"
              style={{ backgroundColor: '#F0F9FF', borderColor: '#BAE6FD', color: '#0369A1' }}
            >
              ⚡ {AUTO_LABEL_KEYS[item.autoCompleteOn] ? t(AUTO_LABEL_KEYS[item.autoCompleteOn]) : item.autoCompleteOn}
            </span>
          )}
        </div>
      </div>
      {canEdit && (
        <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
          <button type="button" onClick={() => onMove('up')}   disabled={!canMoveUp   || busy} className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] text-slate-700 hover:bg-slate-50 disabled:text-slate-300" title={t('page.checklist_templates_admin.move_up')}   data-action="move-up">↑</button>
          <button type="button" onClick={() => onMove('down')} disabled={!canMoveDown || busy} className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] text-slate-700 hover:bg-slate-50 disabled:text-slate-300" title={t('page.checklist_templates_admin.move_down')} data-action="move-down">↓</button>
          <button type="button" onClick={onEdit} disabled={busy} className="rounded border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:text-slate-300" data-action="edit-item">{t('page.checklist_templates_admin.edit')}</button>
          <button
            type="button"
            onClick={onDelete}
            disabled={busy || item.frameworkMandatory}
            className="rounded border border-red-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-red-700 hover:bg-red-50 disabled:border-slate-200 disabled:text-slate-300"
            title={item.frameworkMandatory ? t('page.checklist_templates_admin.delete_mandatory_tooltip') : t('page.checklist_templates_admin.delete_item_tooltip')}
            data-action="delete-item"
          >
            {t('page.checklist_templates_admin.delete')}
          </button>
        </div>
      )}
    </div>
  )
}

interface ItemFormValues {
  text: string
  framework: string
  frameworkMandatory: boolean
  ownerRaci: Raci
  stage: Stage
  autoCompleteOn: AutoTrigger | ''
}

function AddItemRow({ stage, onCancel, onSave, disabled }: {
  stage: Stage
  onCancel: () => void
  onSave: (body: Parameters<typeof documentsApi.addChecklistTemplateItem>[1]) => void
  disabled: boolean
}) {
  const { t } = useTranslation()
  const [v, setV] = useState<ItemFormValues>({
    text: '',
    framework: 'Custom',
    frameworkMandatory: false,
    ownerRaci: 'R',
    stage,
    autoCompleteOn: '',
  })
  const submit = () => {
    if (!v.text.trim()) return
    onSave({
      text: v.text.trim(),
      framework: v.framework.trim() || 'Custom',
      frameworkMandatory: v.frameworkMandatory,
      ownerRaci: v.ownerRaci,
      stage: v.stage,
      autoCompleteOn: v.autoCompleteOn === '' ? null : v.autoCompleteOn,
    })
  }
  return (
    <div className="border-t border-slate-100 bg-slate-50 px-4 py-3" data-form="add-item">
      <ItemFormFields v={v} setV={setV} />
      <div className="mt-2 flex justify-end gap-2">
        <button type="button" onClick={onCancel} disabled={disabled} className="rounded border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50">{t('button.cancel')}</button>
        <button type="button" onClick={submit} disabled={disabled || !v.text.trim()} className="rounded bg-blue-600 px-3 py-1 text-[11px] font-semibold text-white hover:bg-blue-700 disabled:bg-slate-300">{t('page.checklist_templates_admin.add')}</button>
      </div>
    </div>
  )
}

function EditItemRow({ item, onCancel, onSave, disabled }: {
  item: TemplateItem
  onCancel: () => void
  onSave: (body: Parameters<typeof documentsApi.patchChecklistTemplateItem>[1]) => void
  disabled: boolean
}) {
  const { t } = useTranslation()
  const [v, setV] = useState<ItemFormValues>({
    text: item.text,
    framework: item.framework,
    frameworkMandatory: item.frameworkMandatory,
    ownerRaci: item.ownerRaci,
    stage: item.stage,
    autoCompleteOn: item.autoCompleteOn ?? '',
  })
  const submit = () => {
    if (!v.text.trim()) return
    onSave({
      text: v.text.trim(),
      framework: v.framework.trim() || 'Custom',
      frameworkMandatory: v.frameworkMandatory,
      ownerRaci: v.ownerRaci,
      stage: v.stage,
      autoCompleteOn: v.autoCompleteOn === '' ? null : v.autoCompleteOn,
    })
  }
  return (
    <div className="border-b border-slate-100 bg-amber-50/40 px-4 py-3" data-form="edit-item" data-item-id={item.id}>
      <ItemFormFields v={v} setV={setV} />
      <div className="mt-2 flex justify-end gap-2">
        <button type="button" onClick={onCancel} disabled={disabled} className="rounded border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50">{t('button.cancel')}</button>
        <button type="button" onClick={submit} disabled={disabled || !v.text.trim()} className="rounded bg-blue-600 px-3 py-1 text-[11px] font-semibold text-white hover:bg-blue-700 disabled:bg-slate-300">{t('page.checklist_templates_admin.save')}</button>
      </div>
    </div>
  )
}

function ItemFormFields({ v, setV }: { v: ItemFormValues; setV: (next: ItemFormValues) => void }) {
  const { t } = useTranslation()
  const inputCls = 'h-8 rounded border border-slate-200 bg-white px-2 text-[12px] outline-none focus:border-blue-600'
  return (
    <div className="flex flex-col gap-2">
      <input
        type="text"
        value={v.text}
        onChange={e => setV({ ...v, text: e.target.value })}
        placeholder={t('page.checklist_templates_admin.item_description_placeholder')}
        className={inputCls}
        autoFocus
      />
      <div className="grid grid-cols-5 gap-2">
        <input
          type="text"
          value={v.framework}
          onChange={e => setV({ ...v, framework: e.target.value })}
          placeholder={t('page.checklist_templates_admin.framework_placeholder')}
          className={inputCls}
        />
        <select value={v.stage} onChange={e => setV({ ...v, stage: e.target.value as Stage })} className={inputCls}>
          {STAGE_ORDER.map(s => <option key={s} value={s}>{t(STAGE_LABEL_KEYS[s])}</option>)}
        </select>
        <select value={v.ownerRaci} onChange={e => setV({ ...v, ownerRaci: e.target.value as Raci })} className={inputCls}>
          <option value="R">{t('page.checklist_templates_admin.raci_r')}</option>
          <option value="A">{t('page.checklist_templates_admin.raci_a')}</option>
          <option value="C">{t('page.checklist_templates_admin.raci_c')}</option>
          <option value="I">{t('page.checklist_templates_admin.raci_i')}</option>
        </select>
        <select
          value={v.autoCompleteOn}
          onChange={e => setV({ ...v, autoCompleteOn: e.target.value as AutoTrigger | '' })}
          className={inputCls}
          title={t('page.checklist_templates_admin.auto_complete_tooltip')}
        >
          <option value="">{t('page.checklist_templates_admin.auto_manual')}</option>
          <option value="submit_for_review">{t('page.checklist_templates_admin.auto_submit_for_review')}</option>
          <option value="crm_complete">{t('page.checklist_templates_admin.auto_crm_complete')}</option>
          <option value="document_signed">{t('page.checklist_templates_admin.auto_document_signed')}</option>
        </select>
        <label className="flex items-center gap-1.5 px-1 text-[12px] text-slate-700">
          <input
            type="checkbox"
            checked={v.frameworkMandatory}
            onChange={e => setV({ ...v, frameworkMandatory: e.target.checked })}
          />
          {t('page.checklist_templates_admin.mandatory_checkbox')}
        </label>
      </div>
    </div>
  )
}
