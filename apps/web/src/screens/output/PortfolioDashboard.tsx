import { useMemo, useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import type { Document, DocumentStage, DocumentStatus, DocumentType, PlatformUser } from '@platform/types'
import { STATUS_META } from '@platform/types'
import { documentsApi, projectsApi } from '../../api'
import { reportsApi } from '../../api/reports'
import { platformApi } from '../../platform/api/platformApi'
import { SlidePanel } from '../../components/ui'
import { useProjectStore } from '../../store'
import { NewDocumentForm } from '../clinical-writing/NewDocument'

// Document Portfolio (PRD A Screen 22, FR-A-070 / AC-A-053). Every project document grouped by
// stage, with the list rules of PRD A §8.4 (search, quick filters, sort, Reset, state in the URL)
// and a right panel of real figures only: stage overview, measured AI usage, documents completed
// and next steps derived from document status.

// Stage grouping — the six Module A stages in workflow order (FR-A-010)
const STAGE_ORDER: DocumentStage[] = [
  'study-start-up',
  'during-study',
  'post-study',
  'cross-functional-review',
  'crm',
  'final-output',
]

// Same names as Clinical Writing Home
const STAGE_LABEL: Record<DocumentStage, string> = {
  'study-start-up':          'Study Start-Up',
  'during-study':            'During Study',
  'post-study':              'Post-Study / Data Analysis',
  'cross-functional-review': 'Cross-Functional Review',
  'crm':                     'CRM',
  'final-output':            'Final Output',
}

const STAGE_BAR_COLOUR: Record<DocumentStage, string> = {
  'study-start-up':          '#CBD5E1',
  'during-study':            '#2563EB',
  'post-study':              '#2563EB',
  'cross-functional-review': '#D97706',
  'crm':                     '#7C3AED',
  'final-output':            '#16A34A',
}

// All six document statuses (API contract §3), in workflow order
const STATUS_ORDER: DocumentStatus[] = ['not-started', 'in-authoring', 'in-review', 'crm-in-progress', 'pending-signature', 'signed']

const STATUS_PILL_BORDER: Partial<Record<DocumentStatus, string>> = {
  'signed':      '1px solid #BBF7D0',
  'not-started': '1px solid #E2E8F0',
}

const TYPE_LABEL: Record<DocumentType, string> = {
  'csr-full':             'CSR (Full)',
  'csr-synopsis':         'CSR Synopsis',
  'protocol':             'Protocol',
  'protocol-amendment':   'Protocol Amendment',
  'ib':                   "Investigator's Brochure",
  'icf':                  'Informed Consent Form',
  'safety-narrative':     'Safety Narrative',
  'dsur':                 'DSUR',
  'end-of-study-summary': 'End of Study Summary',
  'patient-narrative':    'Patient Narrative Compendium',
}
const typeLabelOf = (t: string) => TYPE_LABEL[t as DocumentType] ?? t

type SortKey = 'updated-desc' | 'updated-asc' | 'title-asc' | 'title-desc' | 'status' | 'assignee'
const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'updated-desc', label: 'Last updated (newest)' },
  { value: 'updated-asc',  label: 'Last updated (oldest)' },
  { value: 'title-asc',    label: 'Title (A–Z)' },
  { value: 'title-desc',   label: 'Title (Z–A)' },
  { value: 'status',       label: 'Status (workflow order)' },
  { value: 'assignee',     label: 'Assigned to (A–Z)' },
]
const DEFAULT_SORT: SortKey = 'updated-desc'

// A document counts as NEW for a week after it is created.
const NEW_FOR_MS = 7 * 86_400_000

// Next steps: open work, most urgent status first.
const NEXT_STEP_FOR: Partial<Record<DocumentStatus, { verb: string; rank: number }>> = {
  'crm-in-progress':   { verb: 'Resolve comments:', rank: 0 },
  'in-review':         { verb: 'Review',            rank: 1 },
  'pending-signature': { verb: 'Sign',              rank: 2 },
  'in-authoring':      { verb: 'Continue',          rank: 3 },
  'not-started':       { verb: 'Start',             rank: 4 },
}

// Avatar colour from the person's name, so every user gets a stable colour
const AVATAR_PALETTE: Array<{ bg: string; fg: string }> = [
  { bg: '#DBEAFE', fg: '#1D4ED8' },
  { bg: '#F0FDF4', fg: '#15803D' },
  { bg: '#F5F3FF', fg: '#7C3AED' },
  { bg: '#FEF3C7', fg: '#D97706' },
  { bg: '#FEE2E2', fg: '#DC2626' },
  { bg: '#E0F2FE', fg: '#0369A1' },
  { bg: '#FCE7F3', fg: '#9D174D' },
]
function hashString(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

// Initials skip honorifics, so "Dr Elena Vasquez" → "EV", not "DE".
const initialsOf = (name: string) =>
  name.trim().split(/\s+/).filter(w => !/^(dr|mr|mrs|ms|prof)\.?$/i.test(w))
    .slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('') || '?'

const time = (iso: string | null | undefined) => (iso ? Date.parse(iso) || 0 : 0)

function formatUpdated(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${String(d.getUTCDate()).padStart(2, '0')} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

const formatUsd = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const csvCell = (v: unknown) => {
  const s = v == null ? '' : String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

// Row navigation — CRM stage → the document's CRM tab; signed → final; awaiting
// signature → sign; in review → reviewer; everything else → editor.
function documentRouteFor(doc: Document, projectId: string): string {
  const base = `/projects/${projectId}/clinical-writing/documents/${doc.id}`
  if (doc.stage === 'crm') return `${base}/crm`
  if (doc.status === 'signed')            return `${base}/final`
  if (doc.status === 'pending-signature') return `${base}/sign`
  if (doc.status === 'in-review')         return `${base}/review`
  return base
}

function DocTypeIcon() {
  return (
    <div
      className="flex h-8 w-8 flex-none items-center justify-center rounded-md"
      style={{ backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0' }}
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <rect x="2.4" y="1.4" width="9.2" height="11.2" rx="1.2" stroke="#94A3B8" strokeWidth="1.3" />
        <rect x="4.4" y="4.2" width="5.2" height="1.2" rx="0.6" fill="#94A3B8" />
        <rect x="4.4" y="7"   width="5.2" height="1.2" rx="0.6" fill="#94A3B8" />
      </svg>
    </div>
  )
}

function StatusPillLocal({ status }: { status: DocumentStatus }) {
  const meta = STATUS_META[status]
  const border = STATUS_PILL_BORDER[status]
  if (!meta) return <span className="text-[11px] text-slate-500">{status}</span>
  return (
    <span
      className="inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold"
      style={{ backgroundColor: meta.bg, color: meta.fg, ...(border ? { border } : {}) }}
    >
      {meta.label}
    </span>
  )
}

function Avatar({ name, size = 20 }: { name: string; size?: number }) {
  const c = AVATAR_PALETTE[hashString(name) % AVATAR_PALETTE.length]
  return (
    <div
      className="flex flex-none items-center justify-center rounded-full font-mono font-bold"
      style={{ width: size, height: size, backgroundColor: c.bg, color: c.fg, fontSize: 10 }}
    >
      {name === '—' ? '—' : initialsOf(name)}
    </div>
  )
}

interface DocRowProps {
  doc:          Document
  assigneeName: string
  onOpen:       () => void
  showNew:      boolean
}

function DocRow({ doc, assigneeName, onOpen, showNew }: DocRowProps) {
  const actionLabel = doc.status === 'signed' ? 'View' : 'Open'

  return (
    <div
      className="mb-2 flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3.5 hover:border-slate-300 transition-colors cursor-pointer"
      data-doc-id={doc.id}
      onClick={onOpen}
    >
      <DocTypeIcon />

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="overflow-hidden text-ellipsis whitespace-nowrap text-sm font-semibold text-slate-900">
            {doc.title}
          </span>
          {showNew && (
            <span
              className="flex-none rounded font-mono text-[9px] font-medium tracking-wider"
              style={{ backgroundColor: '#EFF6FF', color: '#2563EB', padding: '1px 6px' }}
              title="Created in the last 7 days"
              data-new-badge
            >
              NEW
            </span>
          )}
        </div>
        <p className="text-xs text-slate-500">{typeLabelOf(doc.type)}</p>
      </div>

      {/* Assignee cell */}
      <div className="flex w-[186px] min-w-0 flex-none items-center gap-2">
        <Avatar name={assigneeName} />
        <span className="overflow-hidden text-ellipsis whitespace-nowrap text-xs text-slate-900">{assigneeName}</span>
      </div>

      {/* Updated cell */}
      <div className="w-[88px] flex-none text-right text-xs text-slate-500">{formatUpdated(doc.updatedAt)}</div>

      {/* Status pill cell */}
      <div className="flex w-[128px] flex-none justify-end">
        <StatusPillLocal status={doc.status} />
      </div>

      {/* Row action */}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onOpen() }}
        className="flex-none rounded-md border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-900 hover:bg-slate-100 transition-colors focus:outline-none focus:shadow-focus"
      >
        {actionLabel}
      </button>
    </div>
  )
}

function MetricRow({ label, value, hint, colour, testId }: { label: string; value: string; hint?: string; colour?: string; testId?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2.5 border-b py-1.5 text-[13px]" style={{ borderColor: '#F1F5F9' }} data-metric={testId}>
      <span className="text-slate-500">{label}</span>
      <span className="font-bold" style={{ color: colour ?? '#0F172A' }} title={hint}>{value}</span>
    </div>
  )
}

export function PortfolioDashboard() {
  const { projectId }    = useParams()
  const navigate         = useNavigate()
  const setActiveProject = useProjectStore(s => s.setActiveProject)
  const [newDocOpen, setNewDocOpen] = useState(false)

  // Search, filters and sort live in the URL (?q=&stage=&status=&type=&sort=), so a refresh and
  // Back from a document keep them (PRD A §8.4).
  const [searchParams, setSearchParams] = useSearchParams()
  const setParams = (patch: Record<string, string | null>) =>
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === '' || v === 'all') next.delete(k)
        else next.set(k, v)
      }
      return next
    }, { replace: true })
  const pick = <T extends string>(key: string, allowed: readonly string[], fallback: T | 'all' = 'all'): T | 'all' => {
    const v = searchParams.get(key)
    return v && allowed.includes(v) ? (v as T) : fallback
  }
  const search         = searchParams.get('q') ?? ''
  const selectedStage  = pick<DocumentStage>('stage', STAGE_ORDER)
  const selectedStatus = pick<DocumentStatus>('status', STATUS_ORDER)
  const selectedType   = pick<DocumentType>('type', Object.keys(TYPE_LABEL))
  const sort           = pick<SortKey>('sort', SORT_OPTIONS.map(o => o.value), DEFAULT_SORT) as SortKey

  const { data: documents = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['documents', projectId],
    queryFn:  () => documentsApi.list(projectId!),
    enabled:  !!projectId,
  })

  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn:  () => projectsApi.get(projectId!),
    enabled:  !!projectId,
  })

  // Measured AI usage for this project (the AI call log), not an estimate.
  const { data: aiUsage, isError: aiUsageError } = useQuery({
    queryKey: ['project-ai-usage', projectId],
    queryFn:  () => reportsApi.projectAiUsage(projectId!),
    enabled:  !!projectId,
    retry: false,
  })

  // Documents are assigned to user accounts, so resolve names from the user directory, with the
  // project team as a fallback. The directory is admin-only; other roles see team names only.
  const { data: users = [] } = useQuery<PlatformUser[]>({
    queryKey: ['platform-users'],
    queryFn:  () => platformApi.listUsers(),
    staleTime: 60_000,
    retry: false,
  })
  const nameById = useMemo(() => {
    const map = new Map<string, string>()
    project?.team.forEach(t => map.set(t.userId, t.name))
    users.forEach(u => map.set(u.id, u.name))
    return map
  }, [project, users])
  const assigneeOf = (d: Document) => nameById.get(d.assigneeId) ?? '—'

  useEffect(() => {
    if (project) setActiveProject(project)
  }, [project, setActiveProject])

  // Search covers the row's text: title, type and assignee (PRD A §8.4).
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return documents.filter(d =>
      (q === '' ||
        d.title.toLowerCase().includes(q) ||
        typeLabelOf(d.type).toLowerCase().includes(q) ||
        (nameById.get(d.assigneeId) ?? '').toLowerCase().includes(q)) &&
      (selectedStage  === 'all' || d.stage  === selectedStage) &&
      (selectedStatus === 'all' || d.status === selectedStatus) &&
      (selectedType   === 'all' || d.type   === selectedType),
    )
  }, [documents, search, selectedStage, selectedStatus, selectedType, nameById])

  const sorted = useMemo(() => {
    const byText = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true })
    const cmp = (a: Document, b: Document): number => {
      switch (sort) {
        case 'updated-asc':  return time(a.updatedAt) - time(b.updatedAt)
        case 'title-asc':    return byText(a.title, b.title)
        case 'title-desc':   return byText(b.title, a.title)
        case 'status':       return STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status)
        case 'assignee':     return byText(nameById.get(a.assigneeId) ?? '￿', nameById.get(b.assigneeId) ?? '￿')
        default:             return time(b.updatedAt) - time(a.updatedAt)
      }
    }
    return [...filtered].sort((a, b) => cmp(a, b) || a.id.localeCompare(b.id))
  }, [filtered, sort, nameById])

  // Group by stage — preserves STAGE_ORDER
  const groups = useMemo(() => {
    return STAGE_ORDER.map(stage => ({
      stage,
      label: STAGE_LABEL[stage],
      docs:  sorted.filter(d => d.stage === stage),
    })).filter(g => g.docs.length > 0)
  }, [sorted])

  const stageCounts = useMemo(() => {
    const counts = new Map<DocumentStage, number>()
    documents.forEach(d => counts.set(d.stage, (counts.get(d.stage) ?? 0) + 1))
    return counts
  }, [documents])

  const totalCount = documents.length
  // Completed = signed
  const completedCount = documents.filter(d => d.status === 'signed').length
  const completedPct   = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0
  const lastUpdated    = documents.reduce<string | null>((latest, d) => (time(d.updatedAt) > time(latest) ? d.updatedAt : latest), null)
  const now            = Date.now()
  const isNew          = (d: Document) => !!d.createdAt && now - time(d.createdAt) < NEW_FOR_MS

  // Up to three open documents, most urgent status first, most recently updated within a status.
  const nextSteps = useMemo(() => {
    return documents
      .filter(d => NEXT_STEP_FOR[d.status])
      .sort((a, b) => NEXT_STEP_FOR[a.status]!.rank - NEXT_STEP_FOR[b.status]!.rank || time(b.updatedAt) - time(a.updatedAt))
      .slice(0, 3)
  }, [documents])

  const activeTypes = useMemo(
    () => (Object.keys(TYPE_LABEL) as DocumentType[]).filter(t => documents.some(d => d.type === t)),
    [documents],
  )

  const filtersDirty = search !== '' || selectedStage !== 'all' || selectedStatus !== 'all' || selectedType !== 'all' || sort !== DEFAULT_SORT
  const resetFilters = () => setParams({ q: null, stage: null, status: null, type: null, sort: null })

  const handleOpenDoc = (doc: Document) => {
    if (!projectId) return
    navigate(documentRouteFor(doc, projectId))
  }

  // CSV of the documents currently shown (respects search, filters and sort).
  const exportCsv = () => {
    const header = ['Document ID', 'Title', 'Type', 'Stage', 'Status', 'Assigned to', 'Last updated', 'Created']
    const rows = groups.flatMap(g => g.docs).map(d => [
      d.id, d.title, typeLabelOf(d.type), STAGE_LABEL[d.stage] ?? d.stage, STATUS_META[d.status]?.label ?? d.status,
      assigneeOf(d), d.updatedAt ?? '', d.createdAt ?? '',
    ])
    const csv = [header, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n')
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }))
    const a = window.document.createElement('a')
    a.href = url
    a.download = `portfolio-${project?.shortTitle ?? projectId}-${new Date().toISOString().slice(0, 10)}.csv`
    window.document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const shownCount = groups.reduce((n, g) => n + g.docs.length, 0)
  const selectClass = 'rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 hover:border-slate-300 focus:outline-none focus:shadow-focus'

  return (
    <div className="flex h-full flex-col" data-screen="portfolio-dashboard">

      {/* ============ Header ============ */}
      <div className="flex flex-none flex-col gap-2.5 border-b border-slate-200 bg-white px-8 py-5">
        {/* Breadcrumb moved to TopNav (Projects / Project / Clinical Writing / Portfolio). */}

        <div className="flex items-end justify-between gap-6">
          <div className="flex flex-col gap-1.5">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Document Portfolio</h1>
            <p className="text-[13px] text-slate-500" data-portfolio-summary>
              {project?.shortTitle ?? '…'} · Clinical Writing · {totalCount} document{totalCount === 1 ? '' : 's'}
              {lastUpdated ? ` · Last updated ${formatUpdated(lastUpdated)}` : ''}
            </p>
          </div>
          <div className="flex flex-none items-center gap-2.5">
            <button
              type="button"
              onClick={exportCsv}
              disabled={shownCount === 0}
              title="Download the documents shown as CSV"
              data-action="export-portfolio"
              className="rounded-md border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-900 hover:bg-slate-50 transition-colors focus:outline-none focus:shadow-focus disabled:cursor-not-allowed disabled:opacity-50"
            >
              Export report
            </button>
            <button
              type="button"
              onClick={() => setNewDocOpen(true)}
              data-panel-trigger
              className="rounded-md bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 transition-colors focus:outline-none focus:shadow-focus"
            >
              + New Document
            </button>
          </div>
        </div>
      </div>

      {/* ============ Filter strip ============ */}
      <div className="flex flex-none flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-8 py-3">
        {(['all', ...STAGE_ORDER] as const).map(stage => {
          const selected = selectedStage === stage
          const count = stage === 'all' ? totalCount : (stageCounts.get(stage) ?? 0)
          return (
            <button
              key={stage}
              type="button"
              onClick={() => setParams({ stage })}
              aria-pressed={selected}
              data-stage-chip={stage}
              className="whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold focus:outline-none focus:shadow-focus"
              style={selected
                ? { border: '1px solid #2563EB', backgroundColor: '#EFF6FF', color: '#1D4ED8' }
                : { border: '1px solid #E2E8F0', backgroundColor: '#FFFFFF', color: '#475569' }}
            >
              {stage === 'all' ? 'All stages' : STAGE_LABEL[stage]} ({count})
            </button>
          )
        })}
        <span className="h-5 w-px bg-slate-200" />
        <select
          aria-label="Filter by status"
          value={selectedStatus}
          onChange={e => setParams({ status: e.target.value })}
          className={selectClass}
        >
          <option value="all">All statuses</option>
          {STATUS_ORDER.map(s => <option key={s} value={s}>{STATUS_META[s]?.label ?? s}</option>)}
        </select>
        <select
          aria-label="Filter by type"
          value={selectedType}
          onChange={e => setParams({ type: e.target.value })}
          className={selectClass}
        >
          <option value="all">All types</option>
          {activeTypes.map(t => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
        </select>
        <select
          aria-label="Sort documents"
          value={sort}
          onChange={e => setParams({ sort: e.target.value === DEFAULT_SORT ? null : e.target.value })}
          className={selectClass}
        >
          {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <input
          type="search"
          value={search}
          onChange={e => setParams({ q: e.target.value })}
          placeholder="Search title, type, assignee…"
          aria-label="Search documents"
          className="min-w-[200px] flex-1 rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-900 outline-none placeholder:text-slate-400 focus:border-blue-600 focus:shadow-focus"
        />
        {filtersDirty && (
          <button
            type="button"
            onClick={resetFilters}
            className="text-xs font-semibold text-blue-600 hover:text-blue-700 focus:outline-none focus:shadow-focus"
          >
            Reset filters
          </button>
        )}
      </div>

      {/* ============ Body ============ */}
      <div className="flex flex-1 min-h-0 gap-6 overflow-auto px-8 py-6">

        {/* Left: document list, stage-grouped */}
        <div className="min-w-0 flex-1">
          {isLoading && (
            <p className="p-12 text-center font-mono text-sm text-slate-400" data-state="loading">Loading documents…</p>
          )}

          {!isLoading && isError && (
            <div className="flex flex-col items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-5 py-8 text-center" role="alert" data-state="error">
              <p className="text-sm font-semibold text-red-800">Documents could not be loaded.</p>
              <button type="button" onClick={() => void refetch()} className="text-xs font-semibold text-red-700 underline">Retry</button>
            </div>
          )}

          {!isLoading && !isError && totalCount === 0 && (
            <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-slate-300 px-5 py-12 text-center" data-state="empty">
              <p className="text-sm font-semibold text-slate-900">No documents yet</p>
              <button type="button" onClick={() => setNewDocOpen(true)} data-panel-trigger className="text-xs font-semibold text-blue-600 hover:text-blue-700">
                + New Document
              </button>
            </div>
          )}

          {!isLoading && !isError && totalCount > 0 && shownCount === 0 && (
            <div className="flex flex-col items-center gap-2 px-5 py-12 text-center" data-state="no-match">
              <p className="text-sm font-semibold text-slate-900">No documents match these filters</p>
              <button type="button" onClick={resetFilters} className="text-xs font-semibold text-blue-600 hover:text-blue-700">
                Reset filters
              </button>
            </div>
          )}

          {!isLoading && !isError && groups.map(group => (
            <div key={group.stage} data-stage-group={group.stage}>
              {/* Stage header row */}
              <div className="mb-2 flex items-center gap-2.5 py-2" data-stage-header={group.stage}>
                <p className="font-mono text-[10px] font-medium uppercase tracking-widest text-slate-500">
                  {group.label}
                </p>
                <span
                  className="rounded-full px-2 text-[11px] font-semibold text-slate-600"
                  style={{ backgroundColor: '#F1F5F9', padding: '1px 8px' }}
                >
                  {group.docs.length}
                </span>
              </div>

              {group.docs.map(doc => (
                <DocRow
                  key={doc.id}
                  doc={doc}
                  assigneeName={assigneeOf(doc)}
                  onOpen={() => handleOpenDoc(doc)}
                  showNew={isNew(doc)}
                />
              ))}
            </div>
          ))}

          {!isLoading && !isError && totalCount > 0 && (
            <p className="px-1 pt-1 text-xs text-slate-500" data-portfolio-count>Showing {shownCount} of {totalCount} documents</p>
          )}
        </div>

        {/* Right: summary panels */}
        <div className="flex w-[280px] flex-none flex-col gap-3">

          {/* Stage overview */}
          <div className="flex flex-col gap-1 rounded-lg border border-slate-200 bg-white p-4" data-panel="stage-overview">
            <p className="mb-1 text-[13px] font-bold text-slate-900">Stage overview</p>
            {STAGE_ORDER.map(stage => {
              const count = stageCounts.get(stage) ?? 0
              const pct   = totalCount > 0 ? Math.round((count / totalCount) * 100) : 0
              return (
                <div key={stage} className="flex flex-col gap-1 py-1.5" data-stage-bar={stage}>
                  <div className="flex items-center gap-2">
                    <p className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-xs text-slate-500">
                      {STAGE_LABEL[stage]}
                    </p>
                    <p className="flex-none text-xs font-bold text-slate-900">
                      {count} {count === 1 ? 'doc' : 'docs'}
                    </p>
                  </div>
                  <div className="h-1 overflow-hidden rounded-[2px]" style={{ backgroundColor: '#E2E8F0' }}>
                    <div className="h-full" style={{ width: `${pct}%`, backgroundColor: STAGE_BAR_COLOUR[stage] }} />
                  </div>
                </div>
              )
            })}
          </div>

          {/* Clinical Writing Performance (FR-A-070 / AC-A-053). Real figures only: the AI call log
              and document counts. Hours saved and value need a manual benchmark, which isn't
              configured yet, so they show "—" instead of an estimate. */}
          <div className="flex flex-col gap-0.5 rounded-lg border border-slate-200 bg-white p-4" data-panel="performance">
            <p className="text-[13px] font-bold text-slate-900">Clinical Writing Performance</p>
            <p className="mb-1.5 text-[11px] text-slate-500">vs. manual benchmark</p>
            <MetricRow label="Hours saved" value="—" hint="Benchmark not set" testId="hours-saved" />
            <MetricRow label="Estimated value" value="—" hint="Benchmark not set" testId="estimated-value" />
            <MetricRow
              label="AI drafts accepted"
              value={aiUsage ? `${aiUsage.draftsAccepted} of ${aiUsage.draftsGenerated}` : aiUsageError ? '—' : '…'}
              hint="AI-assisted drafts accepted into sections, from the AI usage log"
              testId="ai-drafts"
            />
            <MetricRow
              label="AI spend"
              value={aiUsage ? formatUsd(aiUsage.costUsd) : aiUsageError ? '—' : '…'}
              hint="Measured cost of this project's AI calls"
              testId="ai-spend"
            />
            <p className="pt-1.5 text-[11px] text-slate-400">Hours saved and value need a manual benchmark (not set yet).</p>
            <div className="mt-2.5 flex items-baseline justify-between">
              <span className="text-xs text-slate-500">Documents completed</span>
              <span className="text-sm font-bold text-slate-900" data-metric="completed">{completedCount} of {totalCount}</span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-[3px]" style={{ backgroundColor: '#E2E8F0' }}>
              <div className="h-full" style={{ width: `${completedPct}%`, backgroundColor: '#2563EB' }} />
            </div>
          </div>

          {/* Next steps — blue-bordered card, from the project's open documents */}
          <div
            className="flex flex-col gap-0.5 rounded-lg bg-white p-4"
            style={{ border: '2px solid #2563EB' }}
            data-panel="next-steps"
          >
            <p className="mb-1 text-[13px] font-bold text-slate-900">Next steps</p>
            {nextSteps.length === 0 && (
              <p className="py-1.5 text-[12px] text-slate-500">{totalCount === 0 ? 'Create a document to get started.' : 'No open documents. Everything is signed.'}</p>
            )}
            {nextSteps.map(doc => {
              const step = NEXT_STEP_FOR[doc.status]!
              const meta = STATUS_META[doc.status]
              return (
                <button
                  key={doc.id}
                  type="button"
                  onClick={() => handleOpenDoc(doc)}
                  data-next-step={doc.id}
                  className="flex items-center gap-2 border-b py-1.5 text-left hover:bg-slate-50 transition-colors focus:outline-none focus:shadow-focus"
                  style={{ borderColor: '#F1F5F9' }}
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" className="flex-none">
                    <rect x="1" y="5.3" width="7" height="1.4" rx="0.7" fill="#2563EB" />
                    <polygon points="7.4,3.2 11,6 7.4,8.8" fill="#2563EB" />
                  </svg>
                  <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-[13px] text-slate-900" title={`${step.verb} ${doc.title}`}>
                    {step.verb} {doc.title}
                  </span>
                  <span className="flex-none whitespace-nowrap text-[11px]" style={{ color: meta?.fg ?? '#64748B' }}>
                    {meta?.label ?? doc.status}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      </div>

      <SlidePanel
        open={newDocOpen}
        onClose={() => setNewDocOpen(false)}
        title="New document"
        subtitle={project?.shortTitle ? `Project ${project.shortTitle}` : undefined}
        storageKey="panel-width-new-document"
        closeOnOutsideClick
      >
        {newDocOpen && projectId && (
          <NewDocumentForm
            projectId={projectId}
            projectTherapeuticArea={project?.therapeuticArea}
            projectShortTitle={project?.shortTitle}
            onCancel={() => setNewDocOpen(false)}
            onCreated={id => {
              setNewDocOpen(false)
              navigate(`/projects/${projectId}/clinical-writing/documents/${id}`)
            }}
          />
        )}
      </SlidePanel>
    </div>
  )
}
