import { useMemo, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import type { Document, DocumentStage, DocumentStatus } from '@platform/types'
import { STATUS_META } from '@platform/types'
import { documentsApi, projectsApi } from '../../api'
import { useProjectStore } from '../../store'

// Stage grouping — order matches the prototype's Stage overview list top → bottom
const STAGE_ORDER: DocumentStage[] = [
  'study-start-up',
  'during-study',
  'post-study',
  'cross-functional-review',
  'crm',
  'final-output',
]

const STAGE_LABEL: Record<DocumentStage, string> = {
  'study-start-up':          'Study Start-Up',
  'during-study':            'During Study',
  'post-study':              'Post Study',
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

const STATUS_PILL_BORDER: Partial<Record<DocumentStatus, string>> = {
  'signed':      '1px solid #BBF7D0',
  'not-started': '1px solid #E2E8F0',
}

const TYPE_LABEL: Record<string, string> = {
  'csr-full':           'CSR (Full)',
  'csr-synopsis':       'CSR Synopsis',
  'protocol':           'Protocol',
  'protocol-amendment': 'Protocol Amendment',
  'safety-narrative':   'Safety Narrative',
  'dsur':               'DSUR',
  'ib':                 'IB',
  'icf':                'ICF',
}

// Avatar palette — Pattern 7
const AVATAR_COLOURS: Record<string, { bg: string; fg: string }> = {
  MW: { bg: '#DBEAFE', fg: '#1D4ED8' },
  SC: { bg: '#F0FDF4', fg: '#15803D' },
  JO: { bg: '#F5F3FF', fg: '#7C3AED' },
  EV: { bg: '#FEF3C7', fg: '#D97706' },
  AH: { bg: '#E0F2FE', fg: '#0369A1' },
  PN: { bg: '#FEE2E2', fg: '#DC2626' },
  RT: { bg: '#FCE7F3', fg: '#9D174D' },
  LP: { bg: '#F3F4F6', fg: '#374151' },
}

const TEAM_LOOKUP: Record<string, { initials: string; name: string }> = {
  'user-MW': { initials: 'MW', name: 'Marcus Webb' },
  'user-SC': { initials: 'SC', name: 'Dr. Sarah Chen' },
  'user-JO': { initials: 'JO', name: 'Dr. James Okonkwo' },
  'user-EV': { initials: 'EV', name: 'Dr. Elena Vasquez' },
  'user-AH': { initials: 'AH', name: 'Dr. Amir Hossain' },
  'user-PN': { initials: 'PN', name: 'Priya Nair' },
  'user-RT': { initials: 'RT', name: 'Rebecca Thorne' },
  'user-LP': { initials: 'LP', name: 'Laurel Park' },
}

// The single "NEW" badge — matches prototype (CSR is the newest doc)
const NEW_BADGE_DOC_IDS = new Set(['DOC-001'])

// Next-steps card content — matches prototype exactly
const NEXT_STEPS = [
  { label: 'Start CSR Synopsis',      status: 'Not Started',      docId: 'DOC-002', colour: '#64748B', arrow: '#2563EB' },
  { label: 'Continue SAE Narratives', status: 'In Authoring',     docId: 'DOC-005', colour: '#2563EB', arrow: '#2563EB' },
  { label: 'Review IB comments',      status: 'CRM In Progress',  docId: 'DOC-008', colour: '#7C3AED', arrow: '#94A3B8' },
]

// Filter chips — visual only in Phase 1
const FILTER_CHIPS = ['All stages', 'Study Start-Up', 'During Study', 'Post-Study', 'In Review', 'CRM', 'Final Output']

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
  return (
    <span
      className="inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold"
      style={{ backgroundColor: meta.bg, color: meta.fg, ...(border ? { border } : {}) }}
    >
      {meta.label}
    </span>
  )
}

function Avatar({ initials, size = 20 }: { initials: string; size?: number }) {
  const c = AVATAR_COLOURS[initials] ?? AVATAR_COLOURS.MW
  return (
    <div
      className="flex flex-none items-center justify-center rounded-full font-mono font-bold"
      style={{ width: size, height: size, backgroundColor: c.bg, color: c.fg, fontSize: 10 }}
    >
      {initials}
    </div>
  )
}

function formatUpdated(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${String(d.getUTCDate()).padStart(2, '0')} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

// Row navigation — signed → final; in-review → reviewer; else → editor
function documentRouteFor(doc: Document, projectId: string): string {
  const base = `/projects/${projectId}/clinical-writing/documents/${doc.id}`
  if (doc.status === 'signed')    return `${base}/final`
  if (doc.status === 'in-review') return `${base}/review`
  return base
}

interface DocRowProps {
  doc:      Document
  onOpen:   () => void
  showNew:  boolean
}

function DocRow({ doc, onOpen, showNew }: DocRowProps) {
  const assignee = TEAM_LOOKUP[doc.assigneeId ?? ''] ?? { initials: '??', name: 'Unassigned' }
  const typeLabel = TYPE_LABEL[doc.type] ?? doc.type
  const actionLabel = doc.status === 'not-started' ? 'Open' : (doc.status === 'signed' ? 'View' : 'Open')

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
              data-new-badge
            >
              NEW
            </span>
          )}
        </div>
        <p className="text-xs text-slate-500">{typeLabel}</p>
      </div>

      {/* Assignee cell */}
      <div className="flex w-[186px] min-w-0 flex-none items-center gap-2">
        <Avatar initials={assignee.initials} />
        <span className="overflow-hidden text-ellipsis whitespace-nowrap text-xs text-slate-900">{assignee.name}</span>
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
        className="flex-none rounded-md border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-900 hover:bg-slate-100 transition-colors"
      >
        {actionLabel}
      </button>
    </div>
  )
}

export function PortfolioDashboard() {
  const { projectId }    = useParams()
  const navigate         = useNavigate()
  const setActiveProject = useProjectStore(s => s.setActiveProject)

  const { data: documents = [] } = useQuery({
    queryKey: ['documents', projectId],
    queryFn:  () => documentsApi.list(projectId!),
    enabled:  !!projectId,
  })

  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn:  () => projectsApi.get(projectId!),
    enabled:  !!projectId,
  })

  useEffect(() => {
    if (project) setActiveProject(project)
  }, [project, setActiveProject])

  // Group by stage — preserves STAGE_ORDER
  const groups = useMemo(() => {
    return STAGE_ORDER.map(stage => ({
      stage,
      label: STAGE_LABEL[stage],
      docs:  documents.filter(d => d.stage === stage),
    })).filter(g => g.docs.length > 0)
  }, [documents])

  const totalCount = documents.length
  // Completed = signed
  const completedCount = documents.filter(d => d.status === 'signed').length
  const completedPct   = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0

  const handleOpenDoc = (doc: Document) => {
    if (!projectId) return
    navigate(documentRouteFor(doc, projectId))
  }

  const handleNextStep = (docId: string) => {
    const doc = documents.find(d => d.id === docId)
    if (doc && projectId) navigate(documentRouteFor(doc, projectId))
  }

  return (
    <div className="flex h-full flex-col" data-screen="portfolio-dashboard">

      {/* ============ Header ============ */}
      <div className="flex flex-none flex-col gap-2.5 border-b border-slate-200 bg-white px-8 py-5">
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <button onClick={() => navigate('/projects')} className="hover:text-slate-900 transition-colors">All Projects</button>
          <span className="text-slate-300">›</span>
          <button onClick={() => navigate(`/projects/${projectId}`)} className="hover:text-slate-900 transition-colors">
            {project?.shortTitle ?? '…'}
          </button>
          <span className="text-slate-300">›</span>
          <button onClick={() => navigate(`/projects/${projectId}/clinical-writing`)} className="hover:text-slate-900 transition-colors">
            Clinical Writing
          </button>
          <span className="text-slate-300">›</span>
          <span className="font-semibold text-slate-900">Portfolio</span>
        </div>

        <div className="flex items-end justify-between gap-6">
          <div className="flex flex-col gap-1.5">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Document Portfolio</h1>
            <p className="text-[13px] text-slate-500">
              {project?.shortTitle ?? 'VELORA-301'} · Clinical Writing · {totalCount} documents · Last updated 28 Oct 2024
            </p>
          </div>
          <div className="flex flex-none items-center gap-2.5">
            <button
              type="button"
              className="rounded-md border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-900 hover:bg-slate-50 transition-colors"
            >
              Export report
            </button>
            <button
              type="button"
              onClick={() => navigate(`/projects/${projectId}/clinical-writing/new`)}
              className="rounded-md bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 transition-colors"
            >
              + New Document
            </button>
          </div>
        </div>
      </div>

      {/* ============ Filter strip ============ */}
      <div className="flex flex-none flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-8 py-3">
        {FILTER_CHIPS.map((chip, i) => {
          const selected = i === 0
          return (
            <span
              key={chip}
              className="whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold cursor-pointer"
              style={selected
                ? { border: '1px solid #2563EB', backgroundColor: '#EFF6FF', color: '#1D4ED8' }
                : { border: '1px solid #E2E8F0', backgroundColor: '#FFFFFF', color: '#475569' }}
            >
              {chip}
            </span>
          )
        })}
        <span className="h-5 w-px bg-slate-200" />
        {['All statuses', 'All types', 'Last updated'].map(label => (
          <div
            key={label}
            className="flex items-center gap-2 whitespace-nowrap rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 cursor-pointer hover:border-slate-300 transition-colors"
          >
            {label}
            <svg width="9" height="9" viewBox="0 0 10 10"><polygon points="1,3 9,3 5,8" fill="#64748B" /></svg>
          </div>
        ))}
      </div>

      {/* ============ Body ============ */}
      <div className="flex flex-1 min-h-0 gap-6 overflow-auto px-8 py-6">

        {/* Left: document list, stage-grouped */}
        <div className="min-w-0 flex-1">
          {groups.map(group => (
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
                  onOpen={() => handleOpenDoc(doc)}
                  showNew={NEW_BADGE_DOC_IDS.has(doc.id)}
                />
              ))}
            </div>
          ))}
        </div>

        {/* Right: summary panels */}
        <div className="flex w-[280px] flex-none flex-col gap-3">

          {/* Stage overview */}
          <div className="flex flex-col gap-1 rounded-lg border border-slate-200 bg-white p-4" data-panel="stage-overview">
            <p className="mb-1 text-[13px] font-bold text-slate-900">Stage overview</p>
            {STAGE_ORDER.map(stage => {
              const count = documents.filter(d => d.stage === stage).length
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

          {/* Clinical Writing Performance */}
          <div className="flex flex-col gap-0.5 rounded-lg border border-slate-200 bg-white p-4" data-panel="performance">
            <p className="text-[13px] font-bold text-slate-900">Clinical Writing Performance</p>
            <p className="mb-1.5 text-[11px] text-slate-500">vs. manual benchmark</p>
            <div className="flex items-baseline justify-between gap-2.5 border-b py-1.5 text-[13px]" style={{ borderColor: '#F1F5F9' }}>
              <span className="text-slate-500">Hours saved</span>
              <span className="font-bold text-slate-900">142 hrs</span>
            </div>
            <div className="flex items-baseline justify-between gap-2.5 border-b py-1.5 text-[13px]" style={{ borderColor: '#F1F5F9' }}>
              <span className="text-slate-500">Estimated value</span>
              <span className="font-bold" style={{ color: '#15803D' }}>$28,400</span>
            </div>
            <div className="flex items-baseline justify-between gap-2.5 border-b py-1.5 text-[13px]" style={{ borderColor: '#F1F5F9' }}>
              <span className="text-slate-500">AI-assisted sections</span>
              <span className="font-bold text-slate-900">34 of 47</span>
            </div>
            <div className="mt-2.5 flex items-baseline justify-between">
              <span className="text-xs text-slate-500">Documents completed</span>
              <span className="text-sm font-bold text-slate-900">{completedCount} of {totalCount}</span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-[3px]" style={{ backgroundColor: '#E2E8F0' }}>
              <div className="h-full" style={{ width: `${completedPct}%`, backgroundColor: '#2563EB' }} />
            </div>
          </div>

          {/* Next steps — blue-bordered card */}
          <div
            className="flex flex-col gap-0.5 rounded-lg bg-white p-4"
            style={{ border: '2px solid #2563EB' }}
            data-panel="next-steps"
          >
            <p className="mb-1 text-[13px] font-bold text-slate-900">Next steps</p>
            {NEXT_STEPS.map(step => (
              <button
                key={step.docId}
                type="button"
                onClick={() => handleNextStep(step.docId)}
                data-next-step={step.docId}
                className="flex items-center gap-2 border-b py-1.5 text-left hover:bg-slate-50 transition-colors"
                style={{ borderColor: '#F1F5F9' }}
              >
                <svg width="12" height="12" viewBox="0 0 12 12" className="flex-none">
                  <rect x="1" y="5.3" width="7" height="1.4" rx="0.7" fill={step.arrow} />
                  <polygon points="7.4,3.2 11,6 7.4,8.8" fill={step.arrow} />
                </svg>
                <span
                  className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-[13px]"
                  style={{ color: step.status === 'Not Started' ? '#64748B' : '#1E293B' }}
                >
                  {step.label}
                </span>
                <span className="flex-none whitespace-nowrap text-[11px]" style={{ color: step.colour }}>
                  {step.status}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
