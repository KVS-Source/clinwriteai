import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import type { Publication, PublicationStage, PublicationStatus, PublicationType } from '@platform/types'
import { publicationsApi } from '../../api'
import { SourceChip } from '../../components/ui'
import { usePublicationStore } from '../../modules/scientific-writing/store'

// Stable empty-array fallback for useQuery — prevents React #185
// (setter-in-useEffect loops on the transient `[]` default reference).
const EMPTY_PUBS: Publication[] = []

// --- Static config ---

type Tab = 'all' | PublicationStage

const TABS: { id: Tab; label: string; stage: PublicationStage | null }[] = [
  { id: 'all',        label: 'All',           stage: null },
  { id: 'planning',   label: 'Planning',      stage: 'planning' },
  { id: 'authoring',  label: 'Authoring',     stage: 'authoring' },
  { id: 'review',     label: 'Review',        stage: 'review' },
  { id: 'submission', label: 'Submission',    stage: 'submission' },
  { id: 'published',  label: 'Final Output',  stage: 'published' },
]

// Publication type → badge colours
const TYPE_META: Record<PublicationType, { label: string; bg: string; fg: string }> = {
  'manuscript':             { label: 'MANUSCRIPT', bg: '#F0FDFA', fg: '#0F766E' },
  'abstract':               { label: 'ABSTRACT',   bg: '#F0FDFA', fg: '#0F766E' },
  'poster':                 { label: 'POSTER',     bg: '#F0FDFA', fg: '#0F766E' },
  'pls':                    { label: 'PLS',        bg: '#F1F5F9', fg: '#64748B' },
  'plain-language-summary': { label: 'PLS',        bg: '#F1F5F9', fg: '#64748B' },
  'letter':                 { label: 'LETTER',     bg: '#F1F5F9', fg: '#64748B' },
  'review':                 { label: 'REVIEW',     bg: '#F0FDFA', fg: '#0F766E' },
}

// Publication status → pill colours + label
const STATUS_META: Record<PublicationStatus, { label: string; bg: string; fg: string }> = {
  'not-started':       { label: 'Not Started',       bg: '#F8FAFC', fg: '#64748B' },
  'in-authoring':      { label: 'In Authoring',      bg: '#EFF6FF', fg: '#2563EB' },
  'in-review':         { label: 'In Review',         bg: '#FFFBEB', fg: '#B45309' },
  'under-peer-review': { label: 'Under Peer Review', bg: '#FFFBEB', fg: '#B45309' },
  'submitted':         { label: 'Submitted',         bg: '#F0FDF4', fg: '#15803D' },
  'accepted':          { label: 'Accepted',          bg: '#F0FDF4', fg: '#15803D' },
  'published':         { label: 'Published',         bg: '#F0FDF4', fg: '#15803D' },
  'withdrawn':         { label: 'Withdrawn',         bg: '#F1F5F9', fg: '#475569' },
}

// Stage label used in the mono chip inside the card header
const STAGE_LABEL: Record<PublicationStage, string> = {
  planning:   'Planning',
  authoring:  'Authoring',
  review:     'Review',
  submission: 'Submission',
  published:  'Final Output',
}

// --- Subcomponents ---

interface StatTileProps {
  value: number
  label: string
}
function StatTile({ value, label }: StatTileProps) {
  return (
    <div
      className="flex flex-col gap-1.5 rounded-lg border border-slate-200 bg-white"
      style={{ padding: '16px 20px' }}
      data-stat-tile={label}
    >
      <p className="text-[28px] font-bold leading-none" style={{ color: '#0D9488' }}>{value}</p>
      <p className="font-mono text-[11px] font-medium uppercase tracking-widest text-slate-500">{label}</p>
    </div>
  )
}

interface FilterTabProps {
  tab: (typeof TABS)[number]
  active: boolean
  count: number
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
        padding:            '10px 12px',
        borderBottom:       `2px solid ${active ? '#0D9488' : 'transparent'}`,
        color:              active ? '#0F766E' : '#64748B',
        fontWeight:         active ? 600 : 500,
      }}
    >
      {tab.label}
      <span className="font-mono text-[11px] font-medium" style={{ color: '#94A3B8' }}>{count}</span>
    </button>
  )
}

interface PublicationCardProps {
  pub: Publication
  onOpen: () => void
}
function PublicationCard({ pub, onOpen }: PublicationCardProps) {
  const typeMeta   = TYPE_META[pub.type]   ?? { label: pub.type.toUpperCase(), bg: '#F0FDFA', fg: '#0F766E' }
  const statusMeta = STATUS_META[pub.status] ?? { label: pub.status, bg: '#F1F5F9', fg: '#64748B' }
  const stageLabel = STAGE_LABEL[pub.stage] ?? pub.stage

  const meta = pub.journal
    ? `Target: ${pub.journal}${pub.targetSubmissionDate ? ` · Submission ${formatDate(pub.targetSubmissionDate)}` : ''}`
    : pub.targetSubmissionDate
      ? `Submission ${formatDate(pub.targetSubmissionDate)}`
      : pub.doi
        ? `DOI ${pub.doi}`
        : `Updated ${formatDate(pub.updatedAt)}`

  return (
    <div
      onClick={onOpen}
      data-pub-card={pub.id}
      className="flex cursor-pointer items-start gap-6 rounded-lg border border-slate-200 bg-white transition-shadow hover:border-slate-300"
      style={{
        padding:    '20px 24px',
        transition: 'box-shadow 120ms ease, border-color 120ms ease',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.boxShadow = '0 4px 14px rgba(15,23,42,0.07)' }}
      onMouseLeave={(e) => { e.currentTarget.style.boxShadow = 'none' }}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2.5">
          <span
            className="font-mono font-medium"
            style={{
              fontSize:       9,
              letterSpacing:  '0.1em',
              borderRadius:   4,
              padding:        '4px 7px',
              backgroundColor: typeMeta.bg,
              color:           typeMeta.fg,
            }}
            data-type-badge={pub.type}
          >
            {typeMeta.label}
          </span>
          <span className="font-mono text-[11px] font-medium" style={{ color: '#94A3B8' }}>
            {stageLabel}
          </span>
        </div>
        <p className="text-[15px] font-bold" style={{ lineHeight: 1.45, color: '#1E293B' }}>{pub.title}</p>
        <p className="text-[13px]" style={{ color: '#64748B' }}>{subtitleFor(pub)}</p>
        <div className="flex flex-wrap items-center gap-2.5 pt-0.5">
          <span className="font-mono text-[11px] font-medium" style={{ color: '#64748B' }}>{meta}</span>
        </div>
        {pub.sourceDocumentLabel && (
          <SourceChip label={pub.sourceDocumentLabel} dotColor="#2563EB" size="sm" />
        )}
      </div>

      <div className="flex flex-none items-center gap-3">
        <span
          className="inline-flex items-center whitespace-nowrap rounded-full text-xs font-semibold"
          style={{ padding: '4px 10px', backgroundColor: statusMeta.bg, color: statusMeta.fg }}
          data-status-pill={pub.status}
        >
          {statusMeta.label}
        </span>
        <span
          className="font-mono text-[11px] font-medium"
          style={{
            color:           '#475569',
            backgroundColor: '#F1F5F9',
            borderRadius:    4,
            padding:         '4px 7px',
          }}
          data-version-chip
        >
          {pub.version}
        </span>
        <div
          className="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold"
          style={{ backgroundColor: '#F1F5F9', color: '#475569' }}
          data-owner-avatar
        >
          {pub.ownerInitials}
        </div>
      </div>
    </div>
  )
}

function subtitleFor(pub: Publication): string {
  if (pub.journal)  return `${pub.journal} · ${pub.guideline}`
  if (pub.type === 'abstract' || pub.type === 'poster') return `Congress presentation · ${pub.guideline}`
  if (pub.type === 'pls' || pub.type === 'plain-language-summary') return `EU CTR requirement · Lay audience`
  return `${pub.guideline}`
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${String(d.getUTCDate()).padStart(2, '0')} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

// --- Screen ---

export function ScientificWritingHome() {
  const { projectId }         = useParams()
  const navigate              = useNavigate()
  const stageFilter           = usePublicationStore(s => s.stageFilter)
  const searchQuery           = usePublicationStore(s => s.searchQuery)
  const setStageFilter        = usePublicationStore(s => s.setStageFilter)
  const setSearchQuery        = usePublicationStore(s => s.setSearchQuery)
  const setPublications       = usePublicationStore(s => s.setPublications)

  // Design prop toggles (kept as local state for prototype flexibility)
  const [showStats]           = useState(true)
  const [showEmptyState]      = useState(false)

  const { data: publications = EMPTY_PUBS } = useQuery({
    queryKey: ['publications', projectId],
    queryFn:  () => publicationsApi.list(projectId!),
    enabled:  !!projectId,
  })

  useEffect(() => {
    setPublications(publications)
  }, [publications, setPublications])

  const all: Publication[] = showEmptyState ? [] : publications

  // Filter — stage + search
  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return all.filter(p => {
      if (stageFilter !== 'all' && p.stage !== stageFilter) return false
      if (!q) return true
      const hay = `${p.title} ${p.type} ${p.journal ?? ''} ${p.keyMessage ?? ''}`.toLowerCase()
      return hay.includes(q)
    })
  }, [all, stageFilter, searchQuery])

  const counts = useMemo(() => {
    const map: Record<Tab, number> = {
      all: all.length, planning: 0, authoring: 0, review: 0, submission: 0, published: 0,
    }
    for (const p of all) {
      if (p.stage in map) map[p.stage as Tab] += 1
    }
    return map
  }, [all])

  const stats = useMemo(() => ({
    total:     all.length,
    authoring: all.filter(p => p.stage === 'authoring').length,
    review:    all.filter(p => p.stage === 'review').length,
    submitted: all.filter(p => p.stage === 'submission' || p.stage === 'published').length,
  }), [all])

  const dirty = stageFilter !== 'all' || searchQuery.trim().length > 0

  const handleReset = () => {
    setStageFilter('all')
    setSearchQuery('')
  }

  const handleNewPublication = () => {
    navigate(`/projects/${projectId}/scientific-writing/new`)
  }

  const handleOpenPub = (pub: Publication) => {
    navigate(`/projects/${projectId}/scientific-writing/publications/${pub.id}`)
  }

  const hasRows       = filtered.length > 0
  const filteredEmpty = filtered.length === 0 && !showEmptyState
  const trueEmpty     = showEmptyState

  return (
    <div className="bg-slate-50" data-screen="scientific-writing-home">
      <div
        className="flex flex-col gap-5"
        style={{ maxWidth: 1180, padding: '20px 32px 48px' }}
      >

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
          <span className="font-semibold text-slate-900">Scientific Writing</span>
        </nav>

        {/* Header row */}
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="flex min-w-0 flex-col gap-1.5">
            <h1 className="text-[22px] font-bold tracking-tight text-slate-900" style={{ margin: 0 }}>
              Scientific Writing
            </h1>
            <p className="font-mono text-xs font-medium text-slate-500">
              VELORA-301 · Oncology · GPP 2022 compliant
            </p>
          </div>
          <div className="flex flex-none gap-2">
            <button
              type="button"
              onClick={handleNewPublication}
              data-new-publication
              className="flex h-9 items-center gap-1.5 rounded-md px-3.5 text-[13px] font-semibold text-white transition-colors"
              style={{ backgroundColor: '#0D9488' }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#0F766E' }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#0D9488' }}
            >
              <span style={{ fontSize: 15, lineHeight: 1 }}>+</span>
              New publication
            </button>
            <button
              type="button"
              className="flex h-9 items-center rounded-md bg-white px-3.5 text-[13px] font-semibold transition-colors"
              style={{ border: '1px solid #0D9488', color: '#0F766E' }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#F0FDFA' }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#FFFFFF' }}
            >
              Upload existing
            </button>
          </div>
        </div>

        {/* Stats bar */}
        {showStats && (
          <div
            className="grid gap-4"
            style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}
            data-stats-bar
          >
            <StatTile value={stats.total}     label="publications" />
            <StatTile value={stats.authoring} label="drafting" />
            <StatTile value={stats.review}    label="in review" />
            <StatTile value={stats.submitted} label="submitted" />
          </div>
        )}

        {/* Filter tabs + search */}
        <div className="flex flex-wrap items-end justify-between gap-5" style={{ borderBottom: '1px solid #E2E8F0' }}>
          <div className="flex flex-wrap gap-1">
            {TABS.map(tab => (
              <FilterTab
                key={tab.id}
                tab={tab}
                active={stageFilter === tab.id}
                count={counts[tab.id]}
                onClick={() => setStageFilter(tab.id)}
              />
            ))}
          </div>
          <div className="flex items-center gap-2 pb-2.5">
            <div
              className="flex items-center gap-2 rounded-md bg-white"
              style={{ width: 240, border: '1px solid #E2E8F0', padding: '8px 10px' }}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="flex-none">
                <circle cx="6" cy="6" r="4.2" fill="none" stroke="#94A3B8" strokeWidth="1.4" />
                <rect x="8.9" y="9.6" width="4.4" height="1.4" rx="0.7" transform="rotate(45 8.9 9.6)" fill="#94A3B8" />
              </svg>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search publications…"
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
                style={{ color: '#0F766E' }}
              >
                Reset filters
              </button>
            )}
          </div>
        </div>

        {/* Publication cards */}
        {hasRows && (
          <div className="flex flex-col gap-2.5" data-publication-list>
            {filtered.map(pub => (
              <PublicationCard key={pub.id} pub={pub} onOpen={() => handleOpenPub(pub)} />
            ))}
          </div>
        )}

        {/* Filtered empty */}
        {filteredEmpty && !trueEmpty && (
          <div
            className="flex flex-col items-center gap-2.5 rounded-lg border border-slate-200 bg-white"
            style={{ padding: '56px 24px' }}
            data-filtered-empty
          >
            <p className="text-[15px] font-bold">No publications match these filters</p>
            <p className="text-[13px]" style={{ color: '#94A3B8' }}>
              {searchQuery.trim()
                ? `No publication in ${stageFilter === 'all' ? 'this project' : STAGE_LABEL[stageFilter as PublicationStage] ?? stageFilter} matches "${searchQuery.trim()}".`
                : `This project has no publication at the ${stageFilter === 'all' ? 'All' : STAGE_LABEL[stageFilter as PublicationStage] ?? stageFilter} stage.`}
            </p>
            <button
              type="button"
              onClick={handleReset}
              className="mt-1 text-[13px] font-semibold"
              style={{ color: '#0F766E' }}
            >
              Reset filters
            </button>
          </div>
        )}

        {/* True empty */}
        {trueEmpty && (
          <div
            className="flex flex-col items-center gap-3 rounded-lg border border-slate-200 bg-white"
            style={{ padding: '64px 24px' }}
            data-true-empty
          >
            <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
              <rect x="7" y="12" width="22" height="24" rx="2" fill="none" stroke="#99F6E4" strokeWidth="2" />
              <rect x="11" y="8" width="22" height="24" rx="2" fill="#F0FDFA" stroke="#0D9488" strokeWidth="2" />
              <rect x="16" y="15" width="12" height="2" rx="1" fill="#0D9488" />
              <rect x="16" y="20" width="12" height="2" rx="1" fill="#0D9488" />
              <rect x="16" y="25" width="7"  height="2" rx="1" fill="#99F6E4" />
            </svg>
            <p className="mt-1 text-[15px] font-bold">No publications yet</p>
            <p className="text-center text-[13px] leading-relaxed" style={{ color: '#94A3B8', maxWidth: 360 }}>
              Create your first publication from this project's CSR data
            </p>
            <button
              type="button"
              onClick={handleNewPublication}
              className="mt-1.5 flex h-9 items-center gap-1.5 rounded-md px-3.5 text-[13px] font-semibold text-white"
              style={{ backgroundColor: '#0D9488' }}
            >
              <span style={{ fontSize: 15, lineHeight: 1 }}>+</span>
              New publication
            </button>
          </div>
        )}

        {/* Amber governance banner */}
        <div
          className="flex items-start gap-3 rounded-lg"
          style={{
            backgroundColor: '#FFFBEB',
            border:          '1px solid #FDE68A',
            padding:         '14px 16px',
            marginTop:       4,
          }}
          data-governance-banner
        >
          <div
            className="flex flex-none items-center justify-center rounded text-xs font-extrabold text-white"
            style={{ width: 18, height: 18, backgroundColor: '#D97706', borderRadius: 5, marginTop: 1 }}
          >
            !
          </div>
          <p className="text-[13px] leading-relaxed">
            All publications require author approval and authorised sign-off before journal or congress submission.
          </p>
        </div>
      </div>
    </div>
  )
}
