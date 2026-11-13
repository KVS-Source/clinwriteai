import { useEffect, useMemo, useState } from 'react'
import { MasterLibraryHeading } from '../components/MasterLibraryHeading'
import { MultiSelect } from '../components/MultiSelect'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { RegulatoryFramework, RegulatoryFrameworkStatus } from '@platform/types'
import { PLATFORM_ACCENT } from '@platform/types'
import { ApiError } from '../../api/client'
import { SlidePanel } from '../../components/ui'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { SortIcon } from '../../components/ui/SortIcon'
import { platformApi, type FrameworkSupersedeRequest } from '../api/platformApi'
import { usePlatformStore } from '../store'
import { holdsRole } from '../../config/roles'

const SCOPE_COLOURS: Record<string, string> = {
  A: '#2563EB', B: '#0D9488', C: '#7C3AED', D: '#B0200D', E: '#0D9488', platform: PLATFORM_ACCENT.primary,
}
const SCOPE_LABEL_KEYS: Record<string, string> = {
  A: 'page.regulatory_framework_admin.scope_a',
  B: 'page.regulatory_framework_admin.scope_b',
  C: 'page.regulatory_framework_admin.scope_c',
  D: 'page.regulatory_framework_admin.scope_d',
  E: 'page.regulatory_framework_admin.scope_e',
  platform: 'page.regulatory_framework_admin.scope_platform',
}
const STATUS_OPTIONS: RegulatoryFrameworkStatus[] = ['Current', 'Draft revision', 'Updated', 'Deprecated']

function StatusChip({ status }: { status: RegulatoryFrameworkStatus }) {
  const { t } = useTranslation()
  const meta =
    status === 'Current'        ? { bg: '#F0FDF4', fg: '#166534', border: '#BBF7D0', label: t('page.regulatory_framework_admin.chip_current') } :
    status === 'Updated'        ? { bg: '#FFFBEB', fg: '#B45309', border: '#FDE68A', label: t('page.regulatory_framework_admin.chip_updated') } :
    status === 'Draft revision' ? { bg: '#FFFBEB', fg: '#B45309', border: '#FDE68A', label: t('page.regulatory_framework_admin.chip_draft_revision') } :
                                  { bg: '#F1F5F9', fg: '#475569', border: '#CBD5E1', label: t('page.regulatory_framework_admin.chip_superseded') }
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium"
      style={{ backgroundColor: meta.bg, color: meta.fg, border: `1px solid ${meta.border}` }}
      data-status-chip={status}
    >{meta.label}</span>
  )
}

function ScopeDots({ scope }: { scope: string[] }) {
  const { t } = useTranslation()
  if (scope.length === 0) return <span className="font-mono text-[11px] text-slate-400" title={t('page.regulatory_framework_admin.scope_missing_tooltip')}>—</span>
  return (
    <div className="flex items-center gap-1" data-scope-dots>
      {scope.map(s => (
        <span
          key={s}
          title={SCOPE_LABEL_KEYS[s] ? t(SCOPE_LABEL_KEYS[s]) : s}
          className="inline-flex h-5 w-5 items-center justify-center rounded-full font-mono text-[9px] font-semibold text-white"
          style={{ backgroundColor: SCOPE_COLOURS[s] ?? '#94A3B8' }}
          data-scope-dot={s}
        >{s}</span>
      ))}
    </div>
  )
}

const CATEGORY_OPTIONS = ['clinical', 'regulatory', 'safety', 'quality', 'compliance', 'publication'] as const
const CATEGORY_KEYS: Record<string, string> = {
  clinical:    'page.regulatory_framework_admin.category_clinical',
  regulatory:  'page.regulatory_framework_admin.category_regulatory',
  safety:      'page.regulatory_framework_admin.category_safety',
  quality:     'page.regulatory_framework_admin.category_quality',
  compliance:  'page.regulatory_framework_admin.category_compliance',
  publication: 'page.regulatory_framework_admin.category_publication',
}

// "+ Add framework" form — fields match POST /admin/frameworks (Super Admin only, audited).
function AddFrameworkPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [code, setCode]               = useState('')
  const [fullName, setFullName]       = useState('')
  const [issuer, setIssuer]           = useState('')
  const [version, setVersion]         = useState('')
  const [category, setCategory]       = useState<string>('regulatory')
  const [effectiveDate, setEffective] = useState('')
  const [sourceUrl, setSourceUrl]     = useState('')
  const [saving, setSaving]           = useState(false)
  const [error, setError]             = useState<string | null>(null)

  const urlValid = !sourceUrl.trim() || /^https?:\/\/\S+$/i.test(sourceUrl.trim())
  const canSave = !!code.trim() && !!issuer.trim() && !!version.trim() && !!effectiveDate && urlValid && !saving

  const reset = () => {
    setCode(''); setFullName(''); setIssuer(''); setVersion(''); setCategory('regulatory')
    setEffective(''); setSourceUrl(''); setError(null)
  }

  const submit = async () => {
    if (!canSave) return
    setSaving(true)
    setError(null)
    try {
      await platformApi.createFramework({
        name:          code.trim(),
        version:       version.trim(),
        jurisdiction:  issuer.trim(),
        category,
        effectiveDate: new Date(`${effectiveDate}T00:00:00Z`).toISOString(),
        ...(fullName.trim()  && { description: fullName.trim() }),
        ...(sourceUrl.trim() && { sourceUrl: sourceUrl.trim() }),
      })
      await qc.invalidateQueries({ queryKey: ['regulatory-frameworks'] })
      reset()
      onClose()
    } catch (e) {
      setError(
        e instanceof ApiError && e.status === 409 ? t('page.regulatory_framework_admin.err_duplicate', { code: code.trim() }) :
        e instanceof ApiError && e.status === 403 ? t('page.regulatory_framework_admin.err_forbidden_add') :
        t('page.regulatory_framework_admin.err_add_generic'),
      )
    } finally {
      setSaving(false)
    }
  }

  const field = 'h-9 w-full min-w-0 rounded-md border border-slate-300 bg-white px-3 text-[13px] focus:border-slate-500 focus:outline-none'
  const label = 'font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500'

  return (
    <SlidePanel open={open} onClose={onClose} title={t('page.regulatory_framework_admin.add_panel_title')} subtitle={t('page.regulatory_framework_admin.add_panel_subtitle')} defaultWidth={480} closeOnOutsideClick>
      <div className="flex flex-col gap-4 px-5 py-5" data-add-framework-form>
        <label className="flex min-w-0 flex-col gap-1.5">
          <span className={label}>{t('page.regulatory_framework_admin.field_code')}</span>
          <input value={code} onChange={e => setCode(e.currentTarget.value)} placeholder="ICH E3" className={field} data-input-code />
        </label>
        <label className="flex min-w-0 flex-col gap-1.5">
          <span className={label}>{t('page.regulatory_framework_admin.field_full_name')}</span>
          <input value={fullName} onChange={e => setFullName(e.currentTarget.value)} placeholder={t('page.regulatory_framework_admin.placeholder_full_name')} className={field} data-input-name />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex min-w-0 flex-col gap-1.5">
            <span className={label}>{t('page.regulatory_framework_admin.field_issuer')}</span>
            <input value={issuer} onChange={e => setIssuer(e.currentTarget.value)} placeholder="ICH" className={field} data-input-issuer />
          </label>
          <label className="flex min-w-0 flex-col gap-1.5">
            <span className={label}>{t('page.regulatory_framework_admin.field_version')}</span>
            <input value={version} onChange={e => setVersion(e.currentTarget.value)} placeholder="R1 2016" className={field} data-input-version />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex min-w-0 flex-col gap-1.5">
            <span className={label}>{t('page.regulatory_framework_admin.field_category')}</span>
            <select value={category} onChange={e => setCategory(e.currentTarget.value)} className={field} data-input-category>
              {CATEGORY_OPTIONS.map(c => <option key={c} value={c}>{t(CATEGORY_KEYS[c])}</option>)}
            </select>
          </label>
          <label className="flex min-w-0 flex-col gap-1.5">
            <span className={label}>{t('page.regulatory_framework_admin.field_effective_date')}</span>
            <input type="date" value={effectiveDate} onChange={e => setEffective(e.currentTarget.value)} className={field} data-input-effective />
          </label>
        </div>
        <label className="flex min-w-0 flex-col gap-1.5">
          <span className={label}>{t('page.regulatory_framework_admin.field_source_url')}</span>
          <input value={sourceUrl} onChange={e => setSourceUrl(e.currentTarget.value)} placeholder="https://database.ich.org/…" className={field} data-input-source-url />
          {!urlValid && <span className="text-[11px] font-semibold" style={{ color: '#B45309' }}>{t('page.regulatory_framework_admin.err_url')}</span>}
        </label>

        {error && <p className="rounded-md bg-red-50 p-2 text-[12px] text-red-800" role="alert" data-add-framework-error>{error}</p>}

        <div className="mt-2 flex gap-2 border-t border-slate-200 pt-4">
          <button type="button" onClick={submit} disabled={!canSave}
            data-submit-framework
            className="h-9 rounded-md px-4 text-[13px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
            style={{ backgroundColor: PLATFORM_ACCENT.primary }}
          >{saving ? t('page.regulatory_framework_admin.adding') : t('page.regulatory_framework_admin.add_framework_action')}</button>
          <button type="button" onClick={onClose}
            className="h-9 rounded-md border border-slate-300 bg-white px-3 text-[13px] font-semibold text-slate-700 hover:bg-slate-50">{t('button.cancel')}</button>
        </div>
        <p className="font-mono text-[11px] text-slate-500">
          {t('page.regulatory_framework_admin.add_audit_footer')}
        </p>
      </div>
    </SlidePanel>
  )
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function formatDay(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getUTCDate()).padStart(2, '0')} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

type SortKey = 'code-asc' | 'code-desc' | 'issuer-asc' | 'issuer-desc' | 'recent' | 'oldest'
const PAGE_SIZES = [10, 20, 50]
const filterControl = 'h-10 w-full rounded-md border border-slate-300 bg-white px-2.5 text-[12px] text-slate-800'

export function RegulatoryFrameworkAdmin({ readOnly = false }: { readOnly?: boolean } = {}) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  // Marking a framework superseded is a two-person decision: a Project Manager sends it for approval, and
  // another PM or a QC approves (the framework is superseded) or rejects it with a reason.
  const me = usePlatformStore(s => s.currentUser)
  const canChangeStatus = holdsRole(me, 'pm')                 // may send for approval
  const canDecide = holdsRole(me, 'pm', 'qc')                 // may approve / reject someone else's request
  const { data: pendingRequests = [] } = useQuery<FrameworkSupersedeRequest[]>({
    queryKey: ['framework-requests', 'pending'],
    queryFn:  () => platformApi.listFrameworkRequests({ status: 'pending' }),
    retry:    false,
  })
  const pendingByFramework = useMemo(() => new Map(pendingRequests.map(r => [r.frameworkId, r])), [pendingRequests])

  const { data: frameworks = [], isLoading } = useQuery<RegulatoryFramework[]>({
    queryKey: ['regulatory-frameworks'],
    queryFn:  () => platformApi.listFrameworks(),
  })

  // Filters, sort and paging — the same controls as Master Documents (the registry is small, so they run in the browser).
  const [search,   setSearch]   = useState('')
  const [statuses, setStatuses] = useState<string[]>([])
  const [issuers,  setIssuers]  = useState<string[]>([])
  const [sort,     setSort]     = useState<SortKey>('code-asc')
  const [page,     setPage]     = useState(1)
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0]!)

  // The framework opened in the right-hand panel, and the "Add framework" panel.
  const [searchParams] = useSearchParams()
  const [openId,   setOpenId]   = useState<string | null>(() => searchParams.get('open'))
  const [newStatus,  setNewStatus]  = useState<RegulatoryFrameworkStatus>('Current')
  const [saving,     setSaving]     = useState(false)
  const [saveResult, setSaveResult] = useState<string | null>(null)
  const [saveError,  setSaveError]  = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [syncing,    setSyncing]    = useState(false)
  const [syncResult, setSyncResult] = useState<string | null>(null)
  const [syncError,  setSyncError]  = useState<string | null>(null)
  const syncFromIch = async () => {
    setSyncing(true); setSyncResult(null); setSyncError(null)
    try {
      const r = await platformApi.syncFrameworksFromIch()
      await qc.invalidateQueries({ queryKey: ['regulatory-frameworks'] })
      setSyncResult(t('page.regulatory_framework_admin.sync_result', { fetched: r.fetched, created: r.created.length, updated: r.updated.length, unchanged: r.unchanged, skipped: r.skipped.length }))
    } catch (err) {
      // 403 → no permission; anything else (ich.org down, timeout) → the plain 'could not reach' message.
      setSyncError((err as { status?: number })?.status === 403 ? t('page.regulatory_framework_admin.sync_forbidden') : t('page.regulatory_framework_admin.sync_failed'))
    } finally { setSyncing(false) }
  }

  const active = frameworks.find(f => f.id === openId) ?? null

  const openFramework = (id: string) => {
    setOpenId(id)
    setNewStatus('Current')
    setSaveResult(null)
    setSaveError(null)
  }

  const statusLabel = (s: RegulatoryFrameworkStatus) =>
    s === 'Current'        ? t('page.regulatory_framework_admin.chip_current') :
    s === 'Updated'        ? t('page.regulatory_framework_admin.chip_updated') :
    s === 'Draft revision' ? t('page.regulatory_framework_admin.chip_draft_revision') :
                             t('page.regulatory_framework_admin.chip_superseded')
  const statusOptions = STATUS_OPTIONS.map(s => ({ value: s, label: statusLabel(s) }))
  // Issuers that appear in the registry (ICH, FDA, EMA …). The registry doesn't store a module scope yet, so Issuer is the second filter.
  const issuerOptions = Array.from(new Set(frameworks.map(f => f.issuer).filter(Boolean))).sort((x, y) => x.localeCompare(y)).map(v => ({ value: v, label: v }))

  const filtersDirty = search.trim() !== '' || statuses.length > 0 || issuers.length > 0
  const resetFilters = () => { setSearch(''); setStatuses([]); setIssuers([]) }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const rows = frameworks.filter(f => {
      if (statuses.length > 0 && !statuses.includes(f.status)) return false
      if (issuers.length > 0 && !issuers.includes(f.issuer)) return false
      if (q && ![f.code, f.name, f.issuer].some(v => (v ?? '').toLowerCase().includes(q))) return false
      return true
    })
    const by: Record<SortKey, (x: RegulatoryFramework, y: RegulatoryFramework) => number> = {
      'code-asc':    (x, y) => x.code.localeCompare(y.code),
      'code-desc':   (x, y) => y.code.localeCompare(x.code),
      'issuer-asc':  (x, y) => x.issuer.localeCompare(y.issuer),
      'issuer-desc': (x, y) => y.issuer.localeCompare(x.issuer),
      'recent':      (x, y) => new Date(y.lastUpdated).getTime() - new Date(x.lastUpdated).getTime(),
      'oldest':      (x, y) => new Date(x.lastUpdated).getTime() - new Date(y.lastUpdated).getTime(),
    }
    return [...rows].sort(by[sort])
  }, [frameworks, search, statuses, issuers, sort])

  useEffect(() => { setPage(1) }, [search, statuses, issuers, sort, pageSize])
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const pageRows  = filtered.slice((Math.min(page, pageCount) - 1) * pageSize, Math.min(page, pageCount) * pageSize)

  // The only status change the registry stores today is "superseded"
  // (POST /admin/frameworks/:id/retire). It is one-way — there is no un-retire.
  const alreadySuperseded = active?.status === 'Deprecated'
  const activePending = active ? pendingByFramework.get(active.id) ?? null : null
  const canSave = !!active && !readOnly && !alreadySuperseded && !activePending && newStatus === 'Deprecated' && !saving
  const [requestReason, setRequestReason] = useState('')

  // The most recent decided request on the open framework (so a rejection and its reason stay visible).
  const { data: activeHistory = [] } = useQuery<FrameworkSupersedeRequest[]>({
    queryKey: ['framework-requests', 'framework', active?.id],
    queryFn:  () => platformApi.listFrameworkRequests({ frameworkId: active!.id }),
    enabled:  !!active,
    retry:    false,
  })
  const lastDecided = activeHistory.find(r => r.status !== 'pending') ?? null

  const refreshRequests = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['framework-requests'] }),
      qc.invalidateQueries({ queryKey: ['regulatory-frameworks'] }),
    ])
  }
  const errorText = (e: unknown, fallbackKey: string) => {
    if (e instanceof ApiError) {
      const body = e.body as { message?: string } | null
      if (body?.message) return body.message
      if (e.status === 403) return t('page.regulatory_framework_admin.err_forbidden_status')
    }
    return t(fallbackKey)
  }

  // "Send for approval" asks first; nothing changes until another PM or a QC approves.
  const [confirmOpen, setConfirmOpen] = useState(false)
  const save = () => { if (canSave && active) setConfirmOpen(true) }
  const doSendForApproval = async () => {
    setConfirmOpen(false)
    if (!canSave || !active) return
    setSaving(true)
    setSaveError(null)
    setSaveResult(null)
    try {
      await platformApi.sendFrameworkForApproval(active.id, requestReason.trim() || undefined)
      await refreshRequests()
      setSaveResult(t('page.regulatory_framework_admin.sent_for_approval', { code: active.code, defaultValue: '{{code}} sent for approval. Every Project Manager and QC has been notified.' }))
      setNewStatus('Current')
      setRequestReason('')
    } catch (e) {
      setSaveError(errorText(e, 'page.regulatory_framework_admin.err_save_generic'))
    } finally {
      setSaving(false)
    }
  }

  // Approve / reject someone else's request.
  const [approveOpen, setApproveOpen] = useState(false)
  const [rejecting, setRejecting] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [deciding, setDeciding] = useState(false)
  useEffect(() => { setRejecting(false); setRejectReason(''); setApproveOpen(false); setSaveError(null); setSaveResult(null) }, [openId])
  const doApprove = async () => {
    setApproveOpen(false)
    if (!activePending || !active) return
    setDeciding(true); setSaveError(null); setSaveResult(null)
    try {
      await platformApi.approveFrameworkRequest(activePending.id)
      await refreshRequests()
      setSaveResult(t('page.regulatory_framework_admin.approved_result', { code: active.code, defaultValue: '✓ Approved. {{code}} is now superseded. Written to the audit trail.' }))
    } catch (e) {
      setSaveError(errorText(e, 'page.regulatory_framework_admin.err_save_generic'))
    } finally {
      setDeciding(false)
    }
  }
  const doReject = async () => {
    if (!activePending || !active || rejectReason.trim().length < 3) return
    setDeciding(true); setSaveError(null); setSaveResult(null)
    try {
      await platformApi.rejectFrameworkRequest(activePending.id, rejectReason.trim())
      await refreshRequests()
      setRejecting(false); setRejectReason('')
      setSaveResult(t('page.regulatory_framework_admin.rejected_result', { code: active.code, defaultValue: 'Request rejected. {{code}} stays current, and the requester has been told why.' }))
    } catch (e) {
      setSaveError(errorText(e, 'page.regulatory_framework_admin.err_save_generic'))
    } finally {
      setDeciding(false)
    }
  }

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

  return (
    <div className="bg-slate-50" data-screen="regulatory-framework-admin" data-read-only={readOnly || undefined}>
      <div className="flex flex-col gap-4" style={{ maxWidth: 1600, padding: '20px 24px 48px' }}>

        {/* The breadcrumb and "who you are" line are gone: the top bar shows "Master Library / ICH Frameworks". */}
        <MasterLibraryHeading>
          <h1 className="text-[20px] font-semibold text-slate-900">{t('page.regulatory_framework_admin.title')}</h1>
          <p className="mt-0.5 text-[13px] text-slate-500" data-header-note>
            {t('page.regulatory_framework_admin.header_note')}{' '}
            <span data-access-note>{t('page.regulatory_framework_admin.access_note')}</span>
          </p>
        </MasterLibraryHeading>

        {/* Filters — search, Status, Issuer, reset and Add framework, in one row like Master Documents. */}
        <div className="[container-type:inline-size]" data-filter-panel>
          <div className="flex flex-wrap items-center gap-3 [@container_(min-width:760px)]:flex-nowrap">
            <input
              type="search" value={search} onChange={e => setSearch(e.currentTarget.value)}
              placeholder={t('page.regulatory_framework_admin.search_placeholder', { defaultValue: 'Search frameworks' })}
              aria-label={t('page.regulatory_framework_admin.search_placeholder', { defaultValue: 'Search frameworks' })}
              data-filter-search
              className={`${filterControl} basis-full min-w-0 [@container_(min-width:760px)]:min-w-[180px] [@container_(min-width:760px)]:flex-[2_1_0%] [@container_(min-width:760px)]:basis-auto`}
            />
            <div data-filter-status className="min-w-[150px] flex-[1_1_150px] [@container_(min-width:760px)]:flex-[1_1_0%]">
              <MultiSelect label={t('page.regulatory_framework_admin.status_label')} allLabel={t('page.regulatory_framework_admin.all_statuses', { defaultValue: 'All statuses' })}
                options={statusOptions} value={statuses} onChange={setStatuses} optionAttr="data-status-option" className={filterControl} />
            </div>
            <div data-filter-issuer className="min-w-[150px] flex-[1_1_150px] [@container_(min-width:760px)]:flex-[1_1_0%]">
              <MultiSelect label={t('page.regulatory_framework_admin.col_issuer')} allLabel={t('page.regulatory_framework_admin.all_issuers', { defaultValue: 'All issuers' })}
                options={issuerOptions} value={issuers} onChange={setIssuers} optionAttr="data-issuer-option" className={filterControl} />
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
            {!readOnly && (
              <button
                type="button"
                onClick={() => { void syncFromIch() }}
                disabled={syncing}
                title={t('page.regulatory_framework_admin.sync_hint')}
                className="h-10 flex-none rounded-md border border-slate-300 bg-white px-4 text-[13px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                data-action="sync-ich"
              >{syncing ? t('page.regulatory_framework_admin.syncing') : t('page.regulatory_framework_admin.sync_button')}</button>
            )}
            {!readOnly && (
              <button
                type="button"
                data-add-framework
                onClick={() => setAddOpen(true)}
                className="h-10 flex-none rounded-md px-4 text-[13px] font-semibold text-white"
                style={{ backgroundColor: PLATFORM_ACCENT.primary }}
              >{t('page.regulatory_framework_admin.add_framework_button')}</button>
            )}
          </div>
        </div>
        {syncResult && <p className="rounded-md p-2 text-[12px]" style={{ backgroundColor: '#F0FDF4', color: '#166534' }} role="status" data-sync-result>{syncResult}</p>}
        {syncError && <p className="rounded-md bg-red-50 p-2 text-[12px] text-red-800" role="alert" data-sync-error>{syncError}</p>}
        {!readOnly && <AddFrameworkPanel open={addOpen} onClose={() => setAddOpen(false)} />}

        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white" data-frameworks-table data-count={frameworks.length}>
          <table className="w-full border-collapse text-[13px]">
            <thead className="border-b border-slate-200 bg-slate-50 font-mono text-[10px] font-semibold text-slate-500">
              <tr>
                <SortHead label={t('page.regulatory_framework_admin.col_code')} asc="code-asc" desc="code-desc" />
                <PlainHead label={t('page.regulatory_framework_admin.col_full_name')} />
                <SortHead label={t('page.regulatory_framework_admin.col_issuer')} asc="issuer-asc" desc="issuer-desc" />
                <PlainHead label={t('page.regulatory_framework_admin.col_scope')} />
                <PlainHead label={t('page.regulatory_framework_admin.col_status')} />
                <SortHead label={t('page.regulatory_framework_admin.col_updated')} asc="oldest" desc="recent" />
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-[12px] text-slate-500" data-state="loading">{t('page.master_library.loading_short')}</td></tr>
              )}
              {!isLoading && pageRows.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-[12px] text-slate-500" data-state="empty">
                  {filtersDirty ? t('page.regulatory_framework_admin.empty_filtered', { defaultValue: 'No frameworks match these filters.' }) : t('page.regulatory_framework_admin.empty_registry', { defaultValue: 'No frameworks in the registry yet.' })}
                  {filtersDirty && (
                    <div><button type="button" onClick={resetFilters} className="mt-2 font-semibold text-slate-700 underline">{t('page.master_library.reset_filters')}</button></div>
                  )}
                </td></tr>
              )}
              {pageRows.map(f => {
                const isActive = f.id === openId
                return (
                  <tr
                    key={f.id}
                    onClick={() => openFramework(f.id)} tabIndex={0}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openFramework(f.id) } }}
                    data-framework-row={f.id}
                    data-selected={isActive || undefined}
                    data-panel-trigger aria-current={isActive || undefined}
                    className="cursor-pointer border-b border-slate-100 last:border-b-0 hover:bg-slate-50"
                    style={{ backgroundColor: isActive ? PLATFORM_ACCENT.bgTint : undefined }}
                  >
                    <td className="px-4 py-3 font-mono text-[11px] font-semibold text-slate-800">{f.code}</td>
                    <td className="px-4 py-3 text-slate-800">{f.name}</td>
                    <td className="px-4 py-3 text-slate-700">{f.issuer}</td>
                    <td className="px-4 py-3"><ScopeDots scope={f.scope} /></td>
                    <td className="px-4 py-3">
                      <StatusChip status={f.status} />
                      {pendingByFramework.has(f.id) && (
                        <span className="ml-1.5 inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800" data-pending-chip>
                          {t('page.regulatory_framework_admin.pending_chip', { defaultValue: 'Pending approval' })}
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-[12px] text-slate-700">{formatDay(f.lastUpdated)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <p className="border-t border-slate-200 px-4 py-2 font-mono text-[11px] text-slate-500" data-scope-hover-hint>
            {t('page.regulatory_framework_admin.scope_hover_hint')}
          </p>

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

      {/* Details panel — opens on a row click; Admins (read-only) see the details without the status controls. */}
      <SlidePanel open={!!active} onClose={() => setOpenId(null)}
        title={active?.code ?? ''}
        subtitle={active && (
          <span className="mt-1 block truncate text-[12px] text-slate-500">
            {active.name} · <span data-active-issuer>{active.issuer}</span> · {t('page.regulatory_framework_admin.updated_prefix')} <span data-active-updated>{formatDay(active.lastUpdated)}</span>
          </span>
        )}
        storageKey="framework-detail" defaultWidth={460} belowTopBar closeOnOutsideClick>
        {active && (
          <div className="flex flex-col gap-4 px-5 py-5" data-edit-drawer data-active-framework={active.id}>
            <div className="flex items-center gap-2">
              <StatusChip status={active.status} />
              {activePending && (
                <span className="inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800" data-active-pending-chip>
                  {t('page.regulatory_framework_admin.pending_chip', { defaultValue: 'Pending approval' })}
                </span>
              )}
              <ScopeDots scope={active.scope} />
            </div>

            <fieldset className="rounded-md border border-slate-200 p-3" data-scope-checkboxes disabled>
              <legend className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">{t('page.regulatory_framework_admin.scope_legend')}</legend>
              {(['A','B','C','D','E'] as const).map(m => (
                <label key={m} className="mt-1 flex items-center gap-2 text-[12px] text-slate-400">
                  <input
                    type="checkbox"
                    checked={active.scope.includes(m)}
                    readOnly
                    data-scope-check={m}
                    style={{ accentColor: SCOPE_COLOURS[m] }}
                  />
                  <span className="font-mono font-semibold">{m}</span>
                  <span>{t(SCOPE_LABEL_KEYS[m])}</span>
                </label>
              ))}
              <p className="mt-2 font-mono text-[10px] text-slate-500" data-scope-unavailable>{t('page.regulatory_framework_admin.scope_unavailable')}</p>
            </fieldset>

            {!readOnly && activePending && !alreadySuperseded && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-[12px] text-amber-900" data-pending-request={activePending.id}>
                <p className="font-semibold">{t('page.regulatory_framework_admin.pending_title', { defaultValue: 'Waiting for approval to mark as superseded' })}</p>
                <p className="mt-0.5" data-pending-requested-by>
                  {t('page.regulatory_framework_admin.pending_by', { name: activePending.requestedByName ?? '—', date: formatDay(activePending.requestedAt), defaultValue: 'Sent by {{name}} on {{date}}' })}
                </p>
                {activePending.reason && <p className="mt-0.5" data-pending-reason>{t('page.regulatory_framework_admin.reason_label', { defaultValue: 'Reason' })}: {activePending.reason}</p>}

                {activePending.requestedBy === me.id ? (
                  <p className="mt-2 text-amber-800" data-pending-own>{t('page.regulatory_framework_admin.pending_own', { defaultValue: 'Another Project Manager or a QC has to approve it.' })}</p>
                ) : canDecide ? (
                  rejecting ? (
                    <div className="mt-2 flex flex-col gap-2" data-reject-form>
                      <label className="flex flex-col gap-1">
                        <span className="font-semibold">{t('page.regulatory_framework_admin.reject_reason_label', { defaultValue: 'Reason for rejecting (required)' })}</span>
                        <textarea value={rejectReason} onChange={e => setRejectReason(e.currentTarget.value)} rows={3} maxLength={1000}
                          data-reject-reason className="rounded-md border border-slate-300 bg-white p-2 text-[12px] text-slate-800" />
                      </label>
                      <div className="flex gap-2">
                        <button type="button" onClick={() => void doReject()} disabled={deciding || rejectReason.trim().length < 3} data-action="confirm-reject"
                          className="h-8 rounded-md bg-red-600 px-3 text-[12px] font-semibold text-white disabled:opacity-40">
                          {t('page.regulatory_framework_admin.reject_confirm', { defaultValue: 'Reject request' })}
                        </button>
                        <button type="button" onClick={() => { setRejecting(false); setRejectReason('') }} className="h-8 rounded-md border border-slate-300 bg-white px-3 text-[12px] font-semibold text-slate-700">
                          {t('button.cancel')}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-2 flex gap-2">
                      <button type="button" onClick={() => setApproveOpen(true)} disabled={deciding} data-action="approve-request"
                        className="h-8 rounded-md px-3 text-[12px] font-semibold text-white disabled:opacity-40" style={{ backgroundColor: PLATFORM_ACCENT.primary }}>
                        {t('page.regulatory_framework_admin.approve_action', { defaultValue: 'Approve' })}
                      </button>
                      <button type="button" onClick={() => setRejecting(true)} disabled={deciding} data-action="reject-request"
                        className="h-8 rounded-md border border-red-300 bg-white px-3 text-[12px] font-semibold text-red-700 disabled:opacity-40">
                        {t('page.regulatory_framework_admin.reject_action', { defaultValue: 'Reject' })}
                      </button>
                    </div>
                  )
                ) : (
                  <p className="mt-2" data-pending-readonly>{t('page.regulatory_framework_admin.pending_deciders', { defaultValue: 'A Project Manager or a QC decides.' })}</p>
                )}
              </div>
            )}
            {!readOnly && !activePending && !alreadySuperseded && lastDecided?.status === 'rejected' && (
              <p className="rounded-md bg-slate-50 p-3 text-[12px] text-slate-600" data-last-rejection>
                {t('page.regulatory_framework_admin.last_rejected', { name: lastDecided.decidedByName ?? '—', date: lastDecided.decidedAt ? formatDay(lastDecided.decidedAt) : '—', reason: lastDecided.rejectionReason ?? '', defaultValue: 'The last request was rejected by {{name}} on {{date}}: {{reason}}' })}
              </p>
            )}
            {!readOnly && !canChangeStatus && !alreadySuperseded && !activePending && (
              <p className="rounded-md bg-slate-50 p-3 text-[12px] text-slate-600" data-status-pm-only>
                {t('page.regulatory_framework_admin.status_pm_only')}
              </p>
            )}
            {!readOnly && !activePending && (canChangeStatus || alreadySuperseded) && (alreadySuperseded ? (
              <p className="rounded-md bg-slate-50 p-3 text-[12px] text-slate-600" data-superseded-note>
                {t('page.regulatory_framework_admin.superseded_note')}
              </p>
            ) : (
              <>
                <label className="flex flex-col gap-1">
                  <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">{t('page.regulatory_framework_admin.status_label')}</span>
                  <select value={newStatus} onChange={(e) => setNewStatus(e.currentTarget.value as RegulatoryFrameworkStatus)}
                    data-status-select
                    className="h-9 rounded-md border border-slate-300 px-3 text-[13px]">
                    {STATUS_OPTIONS.map(s => {
                      const storable = s === 'Current' || s === 'Deprecated'
                      const label = s === 'Deprecated'
                        ? t('page.regulatory_framework_admin.option_superseded')
                        : s === 'Current'        ? t('page.regulatory_framework_admin.option_current')
                        : s === 'Updated'        ? t('page.regulatory_framework_admin.option_updated')
                        :                          t('page.regulatory_framework_admin.option_draft_revision')
                      return (
                        <option key={s} value={s} disabled={!storable}>
                          {storable ? label : t('page.regulatory_framework_admin.option_not_available', { label })}
                        </option>
                      )
                    })}
                  </select>
                </label>

                {newStatus === 'Deprecated' && (
                  <label className="flex flex-col gap-1">
                    <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">{t('page.regulatory_framework_admin.request_reason_label', { defaultValue: 'Reason (optional)' })}</span>
                    <textarea value={requestReason} onChange={e => setRequestReason(e.currentTarget.value)} rows={2} maxLength={1000}
                      data-request-reason className="rounded-md border border-slate-300 p-2 text-[12px]" />
                  </label>
                )}
                <div className="flex gap-2">
                  <button type="button" onClick={save} disabled={!canSave}
                    data-save-framework
                    className="h-9 rounded-md px-4 text-[13px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
                    style={{ backgroundColor: PLATFORM_ACCENT.primary }}
                  >{saving ? t('page.regulatory_framework_admin.saving') : t('page.regulatory_framework_admin.send_for_approval_action', { defaultValue: 'Send for approval →' })}</button>
                  <button type="button" onClick={() => setNewStatus('Current')}
                    className="h-9 rounded-md border border-slate-300 bg-white px-3 text-[13px] font-semibold text-slate-700 hover:bg-slate-50">{t('button.cancel')}</button>
                </div>
                <p className="font-mono text-[11px] text-slate-500" data-status-unavailable>
                  {t('page.regulatory_framework_admin.status_unavailable')}
                </p>
              </>
            ))}

            {saveError && (
              <p className="rounded-md bg-red-50 p-2 text-[12px] text-red-800" role="alert" data-save-error>{saveError}</p>
            )}
            {saveResult && (
              <p className="rounded-md p-2 text-[12px]" style={{ backgroundColor: '#F0FDF4', color: '#166534' }} data-save-result>{saveResult}</p>
            )}

            <p className="font-mono text-[11px] text-slate-500" data-never-deleted-note>
              {t('page.regulatory_framework_admin.never_deleted_note')}
            </p>
          </div>
        )}
      </SlidePanel>

      <ConfirmDialog
        open={confirmOpen && !!active}
        title={t('page.regulatory_framework_admin.confirm_send_title', { code: active?.code ?? '', defaultValue: 'Send {{code}} for approval?' })}
        message={t('page.regulatory_framework_admin.confirm_send_body', { defaultValue: 'Another Project Manager or a QC has to approve before it is marked superseded. Every Project Manager and QC is notified.' })}
        confirmLabel={t('page.regulatory_framework_admin.send_for_approval_confirm', { defaultValue: 'Send for approval' })}
        onConfirm={() => void doSendForApproval()}
        onCancel={() => setConfirmOpen(false)}
      />
      <ConfirmDialog
        open={approveOpen && !!active && !!activePending}
        tone="danger"
        title={t('page.regulatory_framework_admin.confirm_approve_title', { code: active?.code ?? '', defaultValue: 'Approve and mark {{code}} as superseded?' })}
        message={t('page.regulatory_framework_admin.confirm_supersede_body', { defaultValue: "This can't be undone. The framework stays in the registry and stays citable on historical submissions." })}
        confirmLabel={t('page.regulatory_framework_admin.approve_confirm', { defaultValue: 'Approve' })}
        onConfirm={() => void doApprove()}
        onCancel={() => setApproveOpen(false)}
      />
    </div>
  )
}
