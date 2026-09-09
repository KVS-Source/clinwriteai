import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import type { MedContentItem, MedContentStatus, MedContentType } from '@platform/types'
import { MED_CONTENT_TYPE_META, MED_CONTENT_STATUS_META } from '@platform/types'
import { medContentApi } from '../../modules/medical-writing/api/medContent'
import { useMedContentStore } from '../../modules/medical-writing/store'
import expiryFixture from '../../data/contentExpiryRecords.json'

// --- Static config ---

type StageTab =
  | 'all'
  | 'briefing'
  | 'kol-session'
  | 'in-authoring'
  | 'mlr-review'
  | 'formatting'
  | 'approved'

interface TabDef {
  id:       StageTab
  label:    string
  statuses: MedContentStatus[] | null
}

const TABS: TabDef[] = [
  { id: 'all',          label: 'All',                    statuses: null },
  { id: 'briefing',     label: 'Stage 1 (Briefing)',     statuses: ['briefing'] },
  { id: 'kol-session',  label: 'Stage 2 (KOL Session)',  statuses: ['kol-session'] },
  { id: 'in-authoring', label: 'Stage 3 (Authoring)',    statuses: ['in-authoring'] },
  { id: 'mlr-review',   label: 'Stage 4 (MLR Review)',   statuses: ['pre-mlr', 'in-mlr-review'] },
  { id: 'formatting',   label: 'Stage 5 (Formatting)',   statuses: ['formatting'] },
  { id: 'approved',     label: 'Stage 6 (Approved)',     statuses: ['mlr-approved', 'final-output'] },
]

const TA_OPTIONS = ['Oncology', 'Cardiometabolic', 'Neurology', 'Immunology', 'Rare Disease', 'Respiratory'] as const
type TAOption = typeof TA_OPTIONS[number] | 'all'

const TYPE_FILTER_OPTIONS: { id: MedContentType | 'all'; label: string }[] = [
  { id: 'all',              label: 'All types' },
  { id: 'hcp-slide-deck',   label: 'HCP Slide Deck' },
  { id: 'mi-letter',        label: 'MI Letter' },
  { id: 'pil',              label: 'PIL' },
  { id: 'cme-module',       label: 'CME Module' },
  { id: 'disease-dossier',  label: 'Disease Dossier' },
  { id: 'eu-ctr-pls',       label: 'EU CTR PLS' },
  { id: 'advisory-report',  label: 'Advisory Report' },
]

const TRACK_META = {
  mlr:   { label: 'MLR TRACK',   bg: '#EFF6FF', fg: '#2563EB' },
  accme: { label: 'ACCME TRACK', bg: '#F0FDF4', fg: '#15803D' },
} as const

// --- Helpers ---

function isPatientFacing(type: MedContentType): boolean {
  return MED_CONTENT_TYPE_META[type]?.patientFacing === true
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${String(d.getUTCDate()).padStart(2, '0')} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

function ownerInitials(id: string | null | undefined): string {
  if (!id) return '—'
  const cleaned = id.replace(/^user-/, '')
  return cleaned.slice(0, 2).toUpperCase()
}

function tabMatches(item: MedContentItem, tab: TabDef): boolean {
  if (tab.statuses === null) return true
  return tab.statuses.includes(item.status)
}

const EXPIRY_MAP: Record<string, string> = Object.fromEntries(
  (expiryFixture as { contentItemId: string; expiryDate: string }[])
    .map(r => [r.contentItemId, r.expiryDate])
)

// --- Subcomponents ---

interface StatChipProps {
  value:     number | string
  label:     string
  emphasize?: boolean
}
function StatChip({ value, label }: StatChipProps) {
  return (
    <div
      className="flex flex-col gap-1.5 rounded-lg border border-slate-200 bg-white"
      style={{ padding: '16px 20px', borderLeft: '3px solid #7C3AED' }}
      data-stat-chip={label}
    >
      <p className="text-[28px] font-bold leading-none" style={{ color: '#7C3AED' }}>{value}</p>
      <p className="font-mono text-[11px] font-medium uppercase tracking-widest text-slate-500">{label}</p>
    </div>
  )
}

interface FilterTabProps {
  tab:    TabDef
  active: boolean
  count:  number
  onClick: () => void
}
function FilterTab({ tab, active, count, onClick }: FilterTabProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-tab={tab.id}
      data-active={active || undefined}
      className="flex items-center gap-1.5 text-[13px] transition-colors"
      style={{
        padding:      '10px 12px',
        borderBottom: `2px solid ${active ? '#7C3AED' : 'transparent'}`,
        color:        active ? '#5B21B6' : '#64748B',
        fontWeight:   active ? 600 : 500,
      }}
    >
      {tab.label}
      <span className="font-mono text-[11px] font-medium" style={{ color: '#94A3B8' }}>{count}</span>
    </button>
  )
}

interface ContentRowProps {
  item:   MedContentItem
  onOpen: () => void
}
function ContentRow({ item, onOpen }: ContentRowProps) {
  const typeMeta   = MED_CONTENT_TYPE_META[item.type]
  const statusMeta = MED_CONTENT_STATUS_META[item.status]
  const trackMeta  = TRACK_META[item.complianceTrack]
  const showFk     = isPatientFacing(item.type) && item.fkScore !== null && item.fkScore !== undefined
  const showTier   = item.reviewTier !== null && item.reviewTier !== undefined
  const expiryDate = EXPIRY_MAP[item.id] ?? item.expiryDate ?? null
  const showExpiry = expiryDate !== null
  const overdue    = item.mlrOverdue === true
  const sourceLabel = item.sourceModuleAProjectId ? 'Module A ✓' : null

  const fkLabel = showFk
    ? `FK ${item.fkScore!.toFixed(1)}${item.fkPassed ? ' ✓' : ''}`
    : ''
  const fkPass = showFk && item.fkPassed === true

  const tierMeta = showTier
    ? item.reviewTier === 1
      ? { label: `Tier ${item.reviewTier} · Expedited`, bg: '#F0FDF4', fg: '#15803D' }
      : item.reviewTier === 2
        ? { label: `Tier ${item.reviewTier} · Standard`, bg: '#FFFBEB', fg: '#B45309' }
        : { label: `Tier ${item.reviewTier} · Enhanced`, bg: '#EFF6FF', fg: '#005F8E' }
    : null

  const meta = [
    item.project,
    item.version,
    item.channels.length ? item.channels.join(' · ') : null,
    `Updated ${formatDate(item.updatedAt)}`,
  ].filter(Boolean).join(' · ')

  return (
    <div
      onClick={onOpen}
      data-content-row={item.id}
      data-overdue={overdue || undefined}
      className="flex cursor-pointer items-start gap-6 rounded-lg bg-white transition-shadow"
      style={{
        padding:      '20px 24px',
        border:       overdue ? '1px solid #FDE68A' : '1px solid #E2E8F0',
        boxShadow:    overdue ? '0 0 0 1px #FDE68A inset' : 'none',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.boxShadow = '0 4px 12px rgba(15,23,42,0.08)' }}
      onMouseLeave={(e) => { e.currentTarget.style.boxShadow = overdue ? '0 0 0 1px #FDE68A inset' : 'none' }}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2.5">
          <span
            className="font-mono font-medium"
            style={{
              fontSize:        9,
              letterSpacing:   '0.1em',
              borderRadius:    4,
              padding:         '4px 7px',
              backgroundColor: typeMeta.bg,
              color:           typeMeta.fg,
              textTransform:   'uppercase',
            }}
            data-type-badge={item.type}
          >
            {typeMeta.code}
          </span>
          <span
            className="font-mono font-medium"
            style={{
              fontSize:        9,
              letterSpacing:   '0.1em',
              borderRadius:    4,
              padding:         '4px 7px',
              backgroundColor: trackMeta.bg,
              color:           trackMeta.fg,
              textTransform:   'uppercase',
            }}
            data-track-chip={item.complianceTrack}
          >
            {trackMeta.label}
          </span>
          {overdue && (
            <span
              className="font-mono font-semibold"
              style={{
                fontSize:        10,
                letterSpacing:   '0.08em',
                borderRadius:    4,
                padding:         '3px 7px',
                backgroundColor: '#FFFBEB',
                color:           '#B45309',
                border:          '1px solid #FDE68A',
                textTransform:   'uppercase',
              }}
              data-mlr-overdue
            >
              MLR OVERDUE
            </span>
          )}
        </div>
        <p className="text-[15px] font-bold" style={{ lineHeight: 1.45, color: '#1E293B' }}>{item.title}</p>
        <p className="text-[13px]" style={{ color: '#64748B' }}>
          {item.channels.length ? item.channels.join(' · ') : 'No channels selected'} · Target: {item.targetAudience.join(', ')}
        </p>
        <p className="font-mono text-[11px] font-medium" style={{ color: '#64748B' }}>{meta}</p>
        <div className="mt-0.5 flex flex-wrap items-center gap-2">
          {showFk && (
            <span
              data-fk-badge
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 font-mono text-[11px] font-semibold"
              style={{
                backgroundColor: fkPass ? '#F0FDF4' : '#FFFBEB',
                color:           fkPass ? '#15803D' : '#B45309',
                border:          `1px solid ${fkPass ? '#BBF7D0' : '#FCD34D'}`,
              }}
            >
              {fkLabel}
            </span>
          )}
          {tierMeta && (
            <span
              data-tier-badge={item.reviewTier}
              className="inline-flex items-center rounded-md px-2 py-1 text-[11px] font-semibold"
              style={{ backgroundColor: tierMeta.bg, color: tierMeta.fg }}
            >
              {tierMeta.label}
            </span>
          )}
          {showExpiry && (
            <span
              data-expiry-chip
              className="font-mono font-semibold uppercase"
              style={{
                fontSize:        9,
                letterSpacing:   '0.08em',
                borderRadius:    5,
                padding:         '4px 8px',
                backgroundColor: '#FFFBEB',
                color:           '#B45309',
                border:          '1px solid #FDE68A',
              }}
            >
              Expires {formatDate(expiryDate!)}
            </span>
          )}
          {sourceLabel && (
            <span
              data-source-chip
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-semibold"
              style={{ backgroundColor: '#F5F3FF', color: '#5B21B6', border: '1px solid #DDD6FE' }}
            >
              <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: '#7C3AED' }} />
              {sourceLabel}
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-none items-center gap-3">
        <span
          className="inline-flex items-center whitespace-nowrap rounded-full text-xs font-semibold"
          style={{ padding: '4px 10px', backgroundColor: statusMeta.bg, color: statusMeta.fg }}
          data-status-pill={item.status}
        >
          {statusMeta.label}
        </span>
        <span
          className="font-mono text-[11px] font-medium"
          style={{ color: '#475569', backgroundColor: '#F1F5F9', borderRadius: 4, padding: '4px 7px' }}
          data-version-chip
        >
          {item.version}
        </span>
        <div
          className="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold"
          style={{ backgroundColor: '#F5F3FF', color: '#5B21B6' }}
          data-owner-avatar
        >
          {ownerInitials(item.ownerId)}
        </div>
      </div>
    </div>
  )
}

// --- Screen ---

export function MedicalWritingHome() {
  const { projectId } = useParams()
  const navigate      = useNavigate()
  const statusFilter  = useMedContentStore(s => s.statusFilter)
  const searchQuery   = useMedContentStore(s => s.searchQuery)
  const setStatusFilter = useMedContentStore(s => s.setStatusFilter)
  const setSearchQuery  = useMedContentStore(s => s.setSearchQuery)
  const setContents     = useMedContentStore(s => s.setContents)

  const [activeTab, setActiveTab] = useState<StageTab>('all')
  const [taFilter,  setTaFilter]  = useState<TAOption>('all')
  const [typeFilter, setTypeFilter] = useState<MedContentType | 'all'>('all')
  const [toast, setToast]         = useState<string | null>(null)

  const { data: contents = [] } = useQuery({
    queryKey: ['medContent', projectId],
    queryFn:  () => medContentApi.list(projectId!),
    enabled:  !!projectId,
  })

  useEffect(() => { setContents(contents) }, [contents, setContents])

  // Cross-project view when projectId is a "hub-style" id — but for now, list is scoped to :projectId.
  const all: MedContentItem[] = contents

  // Compute counts per tab from the unfiltered list
  const tabCounts = useMemo(() => {
    const map: Record<StageTab, number> = {
      all: 0, briefing: 0, 'kol-session': 0, 'in-authoring': 0,
      'mlr-review': 0, formatting: 0, approved: 0,
    }
    for (const tab of TABS) {
      map[tab.id] = all.filter(i => tabMatches(i, tab)).length
    }
    return map
  }, [all])

  // Apply tab + TA + type + search + status filters
  const filtered = useMemo(() => {
    const q       = searchQuery.trim().toLowerCase()
    const tabDef  = TABS.find(t => t.id === activeTab) ?? TABS[0]
    return all.filter(item => {
      if (!tabMatches(item, tabDef)) return false
      if (taFilter !== 'all' && item.taTag !== taFilter) return false
      if (typeFilter !== 'all' && item.type !== typeFilter) return false
      if (statusFilter !== 'all' && item.status !== statusFilter) return false
      if (q && !item.title.toLowerCase().includes(q)) return false
      return true
    })
  }, [all, activeTab, taFilter, typeFilter, statusFilter, searchQuery])

  // Metrics strip
  const metrics = useMemo(() => {
    const activeItems = all.filter(i => i.status !== 'expired').length
    const mlrPending  = all.filter(i => i.status === 'in-mlr-review').length
    const now         = Date.now()
    const expiringSoon = (expiryFixture as { expiryDate: string }[])
      .filter(r => {
        const days = (new Date(r.expiryDate).getTime() - now) / (1000 * 60 * 60 * 24)
        return days >= 0 && days <= 60
      }).length
    return {
      activeItems,
      mlrPending,
      expiringSoon,
      costSavings: '$124,000',
    }
  }, [all])

  const dirty = activeTab !== 'all' || taFilter !== 'all' || typeFilter !== 'all' || statusFilter !== 'all' || searchQuery.trim().length > 0

  const handleReset = () => {
    setActiveTab('all')
    setTaFilter('all')
    setTypeFilter('all')
    setStatusFilter('all')
    setSearchQuery('')
  }

  const flash = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 3200)
  }

  const handleNewContent = () => navigate(`/projects/${projectId}/medical-writing/content/new`)
  const handleUpload     = () => flash('Upload existing content — Step 1 of the C02 briefing flow.')
  const handleOpen       = (item: MedContentItem) => navigate(`/projects/${projectId}/medical-writing/content/${item.id}`)

  const hasRows       = filtered.length > 0
  const filteredEmpty = filtered.length === 0

  return (
    <div className="bg-slate-50" data-screen="medical-writing-home">
      <div className="mx-auto flex flex-col gap-5" style={{ maxWidth: 1180, padding: '20px 32px 48px' }}>

        {/* Breadcrumbs */}
        <nav className="flex items-center gap-2 text-xs text-slate-500">
          <button onClick={() => navigate('/projects')} className="hover:text-slate-900 transition-colors">
            All projects
          </button>
          <span style={{ color: '#CBD5E1' }}>&gt;</span>
          <button onClick={() => navigate(`/projects/${projectId}`)} className="hover:text-slate-900 transition-colors">
            VELORA-301
          </button>
          <span style={{ color: '#CBD5E1' }}>&gt;</span>
          <span className="font-semibold text-slate-900">Medical Writing</span>
        </nav>

        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="flex min-w-0 flex-col gap-1.5">
            <h1 className="text-[22px] font-bold tracking-tight text-slate-900" style={{ margin: 0 }}>
              Medical Writing
            </h1>
            <p className="font-mono text-xs font-medium text-slate-500">
              VELORA-301 · Oncology · MLR Track · GPP 2022 compliant
            </p>
          </div>
          <div className="flex flex-none gap-2">
            <button
              type="button"
              onClick={handleNewContent}
              data-new-content
              className="flex h-9 items-center gap-1.5 rounded-md px-3.5 text-[13px] font-semibold text-white transition-colors"
              style={{ backgroundColor: '#7C3AED' }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#6D28D9' }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#7C3AED' }}
            >
              <span style={{ fontSize: 15, lineHeight: 1 }}>+</span>
              New Content Item
            </button>
            <button
              type="button"
              onClick={handleUpload}
              data-upload-existing
              className="flex h-9 items-center rounded-md bg-white px-3.5 text-[13px] font-semibold transition-colors"
              style={{ border: '1px solid #7C3AED', color: '#5B21B6' }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#F5F3FF' }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#FFFFFF' }}
            >
              Upload existing
            </button>
          </div>
        </div>

        {/* Metrics strip — 4 chips with violet left-border accent */}
        <div
          className="grid gap-4"
          style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}
          data-metrics-strip
        >
          <StatChip value={metrics.activeItems}  label="Active content items" />
          <StatChip value={metrics.mlrPending}   label="MLR review pending" />
          <StatChip value={metrics.expiringSoon} label="Expiring within 60d" />
          <StatChip value={metrics.costSavings}  label="Cost savings to date" />
        </div>

        {/* Tabs + search */}
        <div className="flex flex-wrap items-end justify-between gap-5" style={{ borderBottom: '1px solid #E2E8F0' }}>
          <div className="flex flex-wrap gap-1" data-tab-bar>
            {TABS.map(tab => (
              <FilterTab
                key={tab.id}
                tab={tab}
                active={activeTab === tab.id}
                count={tabCounts[tab.id]}
                onClick={() => setActiveTab(tab.id)}
              />
            ))}
          </div>
          <div className="flex items-center gap-2 pb-2.5">
            <div className="flex items-center gap-2 rounded-md bg-white" style={{ width: 240, border: '1px solid #E2E8F0', padding: '8px 10px' }}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="flex-none">
                <circle cx="6" cy="6" r="4.2" fill="none" stroke="#94A3B8" strokeWidth="1.4" />
                <rect x="8.9" y="9.6" width="4.4" height="1.4" rx="0.7" transform="rotate(45 8.9 9.6)" fill="#94A3B8" />
              </svg>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search content…"
                data-search-input
                className="min-w-0 flex-1 border-none bg-transparent text-[13px] text-slate-900 outline-none"
              />
            </div>
            {dirty && (
              <button
                type="button"
                onClick={handleReset}
                data-reset-filters
                className="whitespace-nowrap text-xs font-semibold"
                style={{ color: '#5B21B6' }}
              >
                Reset filters
              </button>
            )}
          </div>
        </div>

        {/* Filter bar: TA + type dropdowns */}
        <div className="flex flex-wrap items-center gap-3" data-filter-bar>
          <label className="flex items-center gap-2 text-xs font-semibold text-slate-600">
            <span>Therapy area</span>
            <select
              value={taFilter}
              onChange={(e) => setTaFilter(e.target.value as TAOption)}
              data-ta-filter
              className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[13px] text-slate-800 outline-none"
            >
              <option value="all">All TAs</option>
              {TA_OPTIONS.map(ta => <option key={ta} value={ta}>{ta}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2 text-xs font-semibold text-slate-600">
            <span>Type</span>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as MedContentType | 'all')}
              data-type-filter
              className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[13px] text-slate-800 outline-none"
            >
              {TYPE_FILTER_OPTIONS.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          </label>
        </div>

        {/* Content list */}
        {hasRows && (
          <div className="flex flex-col gap-2.5" data-content-list>
            {filtered.map(item => (
              <ContentRow key={item.id} item={item} onOpen={() => handleOpen(item)} />
            ))}
          </div>
        )}

        {/* Filtered empty */}
        {filteredEmpty && (
          <div
            className="flex flex-col items-center gap-2.5 rounded-lg border border-slate-200 bg-white"
            style={{ padding: '56px 24px' }}
            data-filtered-empty
          >
            <p className="text-[15px] font-bold">No content items match these filters.</p>
            <button
              type="button"
              onClick={handleReset}
              className="mt-1 text-[13px] font-semibold"
              style={{ color: '#5B21B6' }}
            >
              Reset filters
            </button>
          </div>
        )}

        {/* Governance notice */}
        <div
          className="flex gap-3 rounded-lg"
          style={{ padding: '14px 16px', backgroundColor: '#FFFBEB', border: '1px solid #FDE68A', marginTop: 4 }}
          data-governance-notice
        >
          <div className="flex h-5 w-5 flex-none items-center justify-center rounded-full text-xs font-extrabold text-white" style={{ backgroundColor: '#D97706' }}>
            !
          </div>
          <p className="text-[13px]" style={{ lineHeight: 1.6, color: '#78350F' }}>
            All content in this module is governed by IFPMA/EFPIA/ABPI/PhRMA codes and requires MLR approval before external distribution. AI assistance is logged to the audit trail.
          </p>
        </div>
      </div>

      {toast && (
        <div
          data-toast
          className="pointer-events-none fixed bottom-5 left-1/2 flex -translate-x-1/2 items-center gap-2.5 rounded-lg px-4 py-3 text-[13px]"
          style={{ backgroundColor: '#1E293B', color: '#FFFFFF', boxShadow: '0 12px 28px rgba(15,23,42,0.24)' }}
        >
          <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: '#7C3AED' }} />
          {toast}
        </div>
      )}
    </div>
  )
}
