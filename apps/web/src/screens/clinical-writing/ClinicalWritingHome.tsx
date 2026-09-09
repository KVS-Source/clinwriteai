import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import type { Document, DocumentStage, DocumentStatus, DocumentType } from '@platform/types'
import { documentsApi, projectsApi } from '../../api'
import { StatusPill } from '../../components/ui'
import { useProjectStore } from '../../store'

// --- Enum → display label maps ---

const TYPE_LABELS: Record<DocumentType, string> = {
  'csr-full':             'CSR (Full)',
  'csr-synopsis':         'CSR Synopsis',
  'protocol':             'Protocol',
  'protocol-amendment':   'Protocol Amendment',
  'ib':                   "Investigator's Brochure",
  'icf':                  'Informed Consent Form',
  'safety-narrative':     'Safety Narrative',
  'dsur':                 'DSUR',
  'end-of-study-summary': 'End of Study Summary',
}

const STAGE_LABELS: Record<DocumentStage, string> = {
  'study-start-up':            'Study Start-Up',
  'during-study':              'During Study',
  'post-study':                'Post-Study / Data Analysis',
  'cross-functional-review':   'Cross-Functional Review',
  'crm':                       'CRM',
  'final-output':              'Final Output',
}

const STATUS_LABELS: Record<DocumentStatus, string> = {
  'not-started':       'Not Started',
  'in-authoring':      'In Authoring',
  'in-review':         'In Review',
  'crm-in-progress':   'CRM In Progress',
  'pending-signature': 'Pending Signature',
  'signed':            'Signed',
}

const STAGES_ORDERED: DocumentStage[] = [
  'study-start-up',
  'during-study',
  'post-study',
  'cross-functional-review',
  'crm',
  'final-output',
]

// Stage progress states — first two complete, post-study in progress, rest pending
const STAGE_PROGRESS: Record<DocumentStage, 'complete' | 'in-progress' | 'pending'> = {
  'study-start-up':          'complete',
  'during-study':            'complete',
  'post-study':              'in-progress',
  'cross-functional-review': 'pending',
  'crm':                     'pending',
  'final-output':            'pending',
}

const STAGE_STEPPER_WIDTHS: Record<DocumentStage, string> = {
  'study-start-up':          '88px',
  'during-study':            '88px',
  'post-study':              '100px',
  'cross-functional-review': '88px',
  'crm':                     '56px',
  'final-output':            '72px',
}

const FIXED_COMMENTS = [
  { id: 'CMT-041', section: '§11.4.1', by: 'Dr. Elena Vasquez', initials: 'EV', snippet: 'CI decimal places',           age: '6 days ago' },
  { id: 'CMT-042', section: '§12.2',   by: 'Dr. Amir Hossain',  initials: 'AH', snippet: 'Patient 0042 cross-reference', age: '3 days ago' },
  { id: 'CMT-044', section: '§12.2',   by: 'Dr. Elena Vasquez', initials: 'EV', snippet: 'MedDRA v27.0 confirm',        age: 'yesterday' },
]

const CHECKLIST_SUMMARY = [
  { label: 'Complete',    count: 4, colour: '#16A34A' },
  { label: 'In progress', count: 1, colour: '#2563EB' },
  { label: 'Pending',     count: 1, colour: '#CBD5E1' },
  { label: 'Waived',      count: 1, colour: '#D97706' },
]

// --- Column widths (matches prototype grid-template) ---
const COL_TEMPLATE = '2.1fr 1fr 1.2fr 1.1fr 0.9fr 1.1fr 0.8fr'

export function ClinicalWritingHome() {
  const { projectId }    = useParams()
  const navigate         = useNavigate()
  const setActiveProject = useProjectStore(s => s.setActiveProject)

  const [search,         setSearch]        = useState('')
  const [selectedStage,  setSelectedStage] = useState<DocumentStage | 'all'>('all')
  const [selectedStatus, setSelectedStatus]= useState<DocumentStatus | 'all'>('all')
  const [selectedType,   setSelectedType]  = useState<DocumentType | 'all'>('all')

  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn:  () => projectsApi.get(projectId!),
    enabled:  !!projectId,
  })

  const { data: documents = [], isLoading } = useQuery({
    queryKey: ['documents', projectId],
    queryFn:  () => documentsApi.list(projectId!),
    enabled:  !!projectId,
  })

  useEffect(() => {
    if (project) setActiveProject(project)
  }, [project, setActiveProject])

  const teamById = useMemo(() => {
    const map = new Map<string, { name: string; initials: string }>()
    project?.team.forEach(t => map.set(t.userId, { name: t.name, initials: t.initials }))
    return map
  }, [project])

  const filtered = useMemo(() => {
    return documents.filter((d: Document) => {
      const matchSearch = search === '' ||
        d.title.toLowerCase().includes(search.toLowerCase())
      const matchStage  = selectedStage  === 'all' || d.stage  === selectedStage
      const matchStatus = selectedStatus === 'all' || d.status === selectedStatus
      const matchType   = selectedType   === 'all' || d.type   === selectedType
      return matchSearch && matchStage && matchStatus && matchType
    })
  }, [documents, search, selectedStage, selectedStatus, selectedType])

  const filtersDirty = search !== '' || selectedStage !== 'all' || selectedStatus !== 'all' || selectedType !== 'all'

  const resetFilters = () => {
    setSearch('')
    setSelectedStage('all')
    setSelectedStatus('all')
    setSelectedType('all')
  }

  const handleDocClick = (doc: Document) => {
    navigate(`/projects/${projectId}/clinical-writing/documents/${doc.id}`)
  }

  const openCommentCount = FIXED_COMMENTS.length
  const activeTypes  = Array.from(new Set(documents.map((d: Document) => d.type))) as DocumentType[]
  const activeStatuses = Array.from(new Set(documents.map((d: Document) => d.status))) as DocumentStatus[]

  return (
    <div className="flex h-full flex-col">

      {/* ============ Page Header ============ */}
      <div className="flex flex-col gap-4 border-b border-slate-200 bg-white px-8 pt-5 pb-[22px]">
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <button onClick={() => navigate('/projects')} className="hover:text-slate-900 transition-colors">All Projects</button>
          <span className="text-slate-300">›</span>
          <button onClick={() => navigate(`/projects/${projectId}`)} className="hover:text-slate-900 transition-colors">
            {project?.shortTitle ?? '…'}
          </button>
          <span className="text-slate-300">›</span>
          <span className="font-semibold text-slate-900">Clinical Writing</span>
        </div>

        <div className="flex items-start justify-between gap-8">
          {/* Left: title + meta + buttons */}
          <div className="flex flex-none flex-col gap-2">
            <div className="flex items-center gap-2.5">
              <span className="h-2 w-2 flex-none rounded-full" style={{ backgroundColor: '#2563EB' }} />
              <h1 className="text-2xl font-bold tracking-tight text-slate-900">Clinical Writing</h1>
            </div>
            <p className="text-sm text-slate-500">
              {project?.shortTitle ?? '—'} · {project?.therapeuticArea ?? '—'} · Phase {project?.phase ?? '—'} NSCLC · {documents.length} documents · {openCommentCount} open comments
            </p>
            <div className="flex gap-2.5 pt-1">
              <button
                type="button"
                onClick={() => navigate(`/projects/${projectId}/clinical-writing/new`)}
                className="rounded-md bg-blue-600 px-3.5 py-2.5 text-[13px] font-semibold text-white transition-colors hover:bg-blue-700"
              >
                + New Document
              </button>
              <button
                type="button"
                onClick={() => navigate(`/projects/${projectId}/clinical-writing/classify`)}
                className="rounded-md border border-slate-200 bg-white px-3.5 py-2.5 text-[13px] font-semibold text-slate-900 transition-colors hover:bg-slate-50"
              >
                Upload existing
              </button>
            </div>
          </div>

          {/* Right: stage progress stepper */}
          <div className="flex flex-1 flex-col gap-2" style={{ maxWidth: '660px' }}>
            <p className="text-xs font-semibold text-slate-500">Stage progress</p>
            <div className="flex items-start">
              {STAGES_ORDERED.map((stage, i) => {
                const state = STAGE_PROGRESS[stage]
                const width = STAGE_STEPPER_WIDTHS[stage]
                const isLast = i === STAGES_ORDERED.length - 1
                const nextComplete = !isLast && STAGE_PROGRESS[STAGES_ORDERED[i+1]] === 'complete'
                return (
                  <>
                    <div key={stage} className="flex flex-none flex-col items-center gap-2" style={{ width }}>
                      {state === 'complete' && (
                        <div className="flex h-[22px] w-[22px] items-center justify-center rounded-full text-[11px] font-extrabold text-white" style={{ backgroundColor: '#2563EB' }}>
                          ✓
                        </div>
                      )}
                      {state === 'in-progress' && (
                        <div className="h-[22px] w-[22px] rounded-full animate-pulse-blue" style={{ backgroundColor: '#FFFFFF', border: '2px solid #2563EB' }} />
                      )}
                      {state === 'pending' && (
                        <div className="h-[22px] w-[22px] rounded-full" style={{ backgroundColor: '#FFFFFF', border: '2px solid #E2E8F0' }} />
                      )}
                      <div
                        className="text-center text-[11px] leading-tight"
                        style={{ color: state === 'pending' ? '#64748B' : '#1E293B', fontWeight: state === 'in-progress' ? 600 : 400 }}
                      >
                        {STAGE_LABELS[stage]}
                      </div>
                      {state === 'in-progress' && (
                        <p className="font-mono text-[10px] font-medium tracking-widest" style={{ color: '#2563EB' }}>
                          IN PROGRESS
                        </p>
                      )}
                    </div>
                    {!isLast && (
                      <div
                        key={`${stage}-line`}
                        className="mt-[10px] h-[2px] flex-1"
                        style={{ backgroundColor: state === 'complete' || nextComplete ? '#2563EB' : '#E2E8F0' }}
                      />
                    )}
                  </>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      {/* ============ Stage Tabs ============ */}
      <div className="flex flex-none gap-6 overflow-x-auto whitespace-nowrap border-b border-slate-200 bg-white px-8">
        <TabButton label="All Stages"  active={selectedStage === 'all'} onClick={() => setSelectedStage('all')} />
        {STAGES_ORDERED.map(stage => (
          <TabButton
            key={stage}
            label={STAGE_LABELS[stage]}
            active={selectedStage === stage}
            onClick={() => setSelectedStage(stage)}
          />
        ))}
      </div>

      {/* ============ Content ============ */}
      <div className="flex flex-1 items-start gap-6 overflow-auto px-8 py-6">

        {/* Left column: document table card */}
        <div className="flex min-w-0 flex-1 flex-col gap-3.5">
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">

            {/* Filter bar */}
            <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4">
              <div className="flex items-center gap-3">
                <div className="flex max-w-[300px] flex-1 items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                  <SearchIcon />
                  <input
                    type="text"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Search documents..."
                    className="w-full border-none bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400"
                  />
                </div>
                <div className="flex-1" />
                {filtersDirty && (
                  <button onClick={resetFilters} className="p-1 text-xs font-semibold text-blue-600 hover:text-blue-700">
                    Reset filters
                  </button>
                )}
              </div>

              <ChipRow label="Type">
                <FilterChip label="All" active={selectedType === 'all'} onClick={() => setSelectedType('all')} />
                {activeTypes.map(t => (
                  <FilterChip
                    key={t}
                    label={TYPE_LABELS[t]}
                    active={selectedType === t}
                    onClick={() => setSelectedType(t)}
                  />
                ))}
              </ChipRow>

              <ChipRow label="Status">
                <FilterChip label="All" active={selectedStatus === 'all'} onClick={() => setSelectedStatus('all')} />
                {activeStatuses.map(s => (
                  <FilterChip
                    key={s}
                    label={STATUS_LABELS[s]}
                    active={selectedStatus === s}
                    onClick={() => setSelectedStatus(s)}
                  />
                ))}
              </ChipRow>
            </div>

            {/* Column headers */}
            <div
              className="border-b border-slate-200 bg-slate-50 px-5 py-3 text-xs font-semibold text-slate-500"
              style={{ display: 'grid', gridTemplateColumns: COL_TEMPLATE }}
            >
              <div>Document Title</div>
              <div>Type</div>
              <div>Stage</div>
              <div>Status</div>
              <div>Last Updated</div>
              <div>Assigned To</div>
              <div className="text-right">Quick Actions</div>
            </div>

            {/* Rows */}
            {isLoading && (
              <div className="p-12 text-center font-mono text-sm text-slate-400">Loading documents…</div>
            )}

            {!isLoading && filtered.length === 0 && (
              <div className="flex flex-col items-center gap-2 px-5 py-12">
                <p className="text-sm font-semibold text-slate-900">No documents match these filters</p>
                <button onClick={resetFilters} className="text-xs font-semibold text-blue-600 hover:text-blue-700">
                  Reset filters
                </button>
              </div>
            )}

            {!isLoading && filtered.map((doc: Document, i: number) => {
              const assignee = teamById.get(doc.assigneeId) ?? { name: '—', initials: '—' }
              return (
                <div
                  key={doc.id}
                  onClick={() => handleDocClick(doc)}
                  className="cursor-pointer items-center border-b border-slate-100 px-5 py-4 text-sm hover:bg-slate-50 transition-colors"
                  style={{
                    display: 'grid',
                    gridTemplateColumns: COL_TEMPLATE,
                    borderBottom: i === filtered.length - 1 ? 'none' : undefined,
                  }}
                >
                  <div className="pr-4 font-semibold text-slate-900 truncate">{doc.title}</div>
                  <div className="text-slate-900">{TYPE_LABELS[doc.type]}</div>
                  <div className="text-slate-500">{STAGE_LABELS[doc.stage]}</div>
                  <div><StatusPill status={doc.status} size="sm" /></div>
                  <div className="text-slate-500">{doc.updatedAt ? new Date(doc.updatedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}</div>
                  <div className="flex items-center gap-2 min-w-0">
                    <div
                      className="flex h-6 w-6 flex-none items-center justify-center rounded-full font-mono text-[10px] font-bold"
                      style={{ backgroundColor: '#F1F5F9', color: '#475569' }}
                    >
                      {assignee.initials}
                    </div>
                    <div className="truncate text-slate-900">{assignee.name}</div>
                  </div>
                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={e => { e.stopPropagation(); handleDocClick(doc) }}
                      className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-900 hover:bg-slate-100 transition-colors"
                    >
                      Open
                    </button>
                    <button
                      type="button"
                      aria-label="More actions"
                      onClick={e => e.stopPropagation()}
                      className="flex gap-[2.5px] rounded-md p-1.5 hover:bg-slate-100 transition-colors"
                    >
                      <span className="h-[3px] w-[3px] rounded-full" style={{ backgroundColor: '#64748B' }} />
                      <span className="h-[3px] w-[3px] rounded-full" style={{ backgroundColor: '#64748B' }} />
                      <span className="h-[3px] w-[3px] rounded-full" style={{ backgroundColor: '#64748B' }} />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Count footer */}
          <div className="flex justify-between px-1 text-xs text-slate-500">
            <span>Showing {filtered.length} of {documents.length} documents</span>
          </div>
        </div>

        {/* Right column: comments + checklist */}
        <div className="flex w-[280px] flex-none flex-col gap-5">

          <div className="flex flex-col gap-2.5">
            <div className="flex items-baseline justify-between">
              <p className="text-xs font-semibold text-slate-500">Open Comments ({openCommentCount})</p>
              <button className="text-xs font-semibold text-blue-600 hover:text-blue-700">View all</button>
            </div>
            {FIXED_COMMENTS.map(c => (
              <div key={c.id} className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-3">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[10px] text-slate-500">{c.id}</span>
                  <span className="rounded px-1.5 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: '#F1F5F9', color: '#475569' }}>{c.section}</span>
                  <div className="flex-1" />
                  <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: '#FFFBEB', color: '#B45309' }}>Open</span>
                </div>
                <div className="flex items-center gap-2 min-w-0">
                  <div className="flex h-[22px] w-[22px] flex-none items-center justify-center rounded-full font-mono text-[10px] font-bold" style={{ backgroundColor: '#F1F5F9', color: '#475569' }}>
                    {c.initials}
                  </div>
                  <div className="truncate text-[13px] text-slate-900">{c.snippet}</div>
                </div>
                <p className="text-[11px] text-slate-500">{c.by} · {c.age}</p>
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-2.5">
            <p className="text-xs font-semibold text-slate-500">Checklist status</p>
            <div className="flex flex-col gap-2.5 rounded-lg border border-slate-200 bg-white p-3.5">
              {CHECKLIST_SUMMARY.map(row => (
                <div key={row.label} className="flex items-center justify-between text-[13px]" style={{ color: row.label === 'Waived' ? '#B45309' : undefined }}>
                  <span className="flex items-center gap-2">
                    <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: row.colour }} />
                    {row.label}
                  </span>
                  <span className="font-semibold">{row.count}</span>
                </div>
              ))}
              <div className="border-t border-slate-200 pt-2.5">
                <button className="text-xs font-semibold text-blue-600 hover:text-blue-700">View full checklist</button>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}

// --- Small helpers ---

function TabButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="py-3.5 text-[13px] transition-colors"
      style={{
        color:        active ? '#1E293B' : '#64748B',
        fontWeight:   active ? 700 : 400,
        borderBottom: `2px solid ${active ? '#2563EB' : 'transparent'}`,
      }}
    >
      {label}
    </button>
  )
}

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="h-7 rounded-md px-2.5 text-xs transition-colors"
      style={active ? {
        backgroundColor: '#EFF6FF',
        color: '#2563EB',
        border: '1px solid #DBEAFE',
        fontWeight: 600,
      } : {
        backgroundColor: '#F8FAFC',
        color: '#64748B',
        border: '1px solid #E2E8F0',
      }}
    >
      {label}
    </button>
  )
}

function ChipRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-semibold text-slate-500">{label}</span>
      {children}
    </div>
  )
}

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" className="flex-none text-slate-500">
      <circle cx="6" cy="6" r="4.2"/>
      <path d="M9.6 9.6L12.5 12.5" strokeLinecap="round"/>
    </svg>
  )
}
