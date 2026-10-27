import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Comment, CommentSeverity, Document, DocumentStage, DocumentStatus, DocumentType, PlatformUser } from '@platform/types'
import { documentsApi, projectsApi } from '../../api'
import { platformApi } from '../../platform/api/platformApi'
import { StatusPill, SlidePanel } from '../../components/ui'
import { useProjectStore } from '../../store'
import { NewDocumentForm } from './NewDocument'
import { UploadDocumentForm } from './UploadDocument'
import { SourceDocumentsTab } from './SourceDocumentsTab'
import { DocumentDetailPanel } from './DocumentDetailPanel'

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
  'patient-narrative':    'Patient Narrative Compendium',
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

type DocSortKey = 'title' | 'type' | 'stage' | 'status' | 'updated' | 'assignee'

// Click cycle per column: ascending → descending → back to the list's natural order.
const nextSort = (cur: { key: DocSortKey; dir: 'asc' | 'desc' } | null, key: DocSortKey) =>
  cur?.key !== key ? { key, dir: 'asc' as const } : cur.dir === 'asc' ? { key, dir: 'desc' as const } : null

// Stepper state derived at render time from each document's real stage
// (PRD A, FR-A-010). Rule:
//   complete    = every document has moved past this stage
//   in-progress = at least one document is currently at this stage
//   pending     = no document has reached this stage yet
// Multiple stages can be in-progress at the same time (the project genuinely
// has parallel work streams); the stepper renders each independently.
type StageProgressState = 'complete' | 'in-progress' | 'pending'

function computeStageProgress(
  documents: ReadonlyArray<{ stage: DocumentStage }>,
): Record<DocumentStage, StageProgressState> {
  const stageIdx = (s: DocumentStage) => STAGES_ORDERED.indexOf(s)
  const indices = documents
    .map(d => stageIdx(d.stage))
    .filter(i => i >= 0)
  // Fallback when a project has no documents yet — treat Study Start-Up as
  // the "earliest with work" so the stepper visibly shows that's where
  // things start.
  const occupied = new Set(indices)
  const minIdx = indices.length === 0 ? 0 : Math.min(...indices)

  const out = {} as Record<DocumentStage, StageProgressState>
  for (let i = 0; i < STAGES_ORDERED.length; i++) {
    const stage = STAGES_ORDERED[i]!
    if (indices.length === 0) {
      out[stage] = i === 0 ? 'in-progress' : 'pending'
    } else if (occupied.has(i)) {
      out[stage] = 'in-progress'
    } else if (i < minIdx) {
      out[stage] = 'complete'
    } else {
      out[stage] = 'pending'
    }
  }
  return out
}

const STAGE_STEPPER_WIDTHS: Record<DocumentStage, string> = {
  'study-start-up':          '88px',
  'during-study':            '88px',
  'post-study':              '100px',
  'cross-functional-review': '88px',
  'crm':                     '56px',
  'final-output':            '72px',
}

// Open Comments sidebar — how many of the newest open comments to show.
const SIDEBAR_COMMENT_LIMIT = 4

const SEVERITY_BADGE: Record<CommentSeverity, { label: string; bg: string; fg: string }> = {
  major: { label: 'Major', bg: '#FEE2E2', fg: '#DC2626' },
  minor: { label: 'Minor', bg: '#FFFBEB', fg: '#B45309' },
  query: { label: 'Query', bg: '#EFF6FF', fg: '#2563EB' },
}

const CHECKLIST_ROW_COLOURS = {
  complete: '#16A34A',
  pending:  '#CBD5E1',
  waived:   '#D97706',
}

// --- Column widths (matches prototype grid-template) ---
const COL_TEMPLATE = '2.1fr 1fr 1.2fr 1.1fr 0.9fr 1.1fr 0.8fr'

export function ClinicalWritingHome() {
  const { projectId }    = useParams()
  const navigate         = useNavigate()
  const setActiveProject = useProjectStore(s => s.setActiveProject)

  // Tab, filters and search live in the URL (?tab=sources&stage=…&status=…&type=…&q=…), so Back
  // from a document and a page refresh keep them (PRD A §8.4).
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
  const pick = <T extends string>(key: string, allowed: readonly string[]): T | 'all' => {
    const v = searchParams.get(key)
    return v && allowed.includes(v) ? (v as T) : 'all'
  }
  const search         = searchParams.get('q') ?? ''
  const selectedStage  = pick<DocumentStage>('stage', Object.keys(STAGE_LABELS))
  const selectedStatus = pick<DocumentStatus>('status', Object.keys(STATUS_LABELS))
  const selectedType   = pick<DocumentType>('type', Object.keys(TYPE_LABELS))
  const view: 'documents' | 'sources' = searchParams.get('tab') === 'sources' ? 'sources' : 'documents'
  const setSearch         = (v: string) => setParams({ q: v })
  const setSelectedStatus = (v: DocumentStatus | 'all') => setParams({ status: v })
  const setSelectedType   = (v: DocumentType | 'all') => setParams({ type: v })
  const showStage         = (stage: DocumentStage | 'all') => setParams({ tab: null, stage })
  const showSources       = () => setParams({ tab: 'sources' })
  // Slider state — holds the id of the document being duplicated (null
  // for a plain new-doc flow). `null` with the panel open means fresh.
  const [newDocOpen, setNewDocOpen] = useState<false | { duplicateSourceId: string | null; sourceIds?: string[] }>(false)
  const [uploadOpen, setUploadOpen] = useState(false)
  // Document whose detail panel is open (row click) and the table's column sort.
  const [detailDoc, setDetailDoc] = useState<Document | null>(null)
  const [docSort, setDocSort] = useState<{ key: DocSortKey; dir: 'asc' | 'desc' } | null>(null)
  const qc = useQueryClient()
  // Set after "Save to library" in the upload drawer: we stay on the Source Documents
  // tab and offer to write a document from the file that was just saved.
  const [justAdded, setJustAdded] = useState<{ uploadId: string } | null>(null)

  useEffect(() => { if (view !== 'documents') setDetailDoc(null) }, [view])

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

  // Count for the "Source Documents" tab label (also refreshed after uploads).
  const { data: sourceSummary } = useQuery({
    queryKey: ['source-documents', projectId, 'summary'],
    queryFn:  () => documentsApi.listSources(projectId!, { pageSize: 10 }),
    enabled:  !!projectId,
    staleTime: 30_000,
  })
  const sourceCount = sourceSummary?.summary.files

  // Close the upload drawer and refresh the library: a file is stored as soon as
  // it is uploaded, even if the user cancels before saving it to the library.
  // An upload is stored as soon as the file transfers, but it only joins the library when the
  // user presses "Save to library". Closing the panel any other way discards it.
  const pendingUploadRef = useRef<string | null>(null)
  const closeUpload = () => {
    const pending = pendingUploadRef.current
    pendingUploadRef.current = null
    setUploadOpen(false)
    const refresh = () => { void qc.invalidateQueries({ queryKey: ['source-documents', projectId] }) }
    if (pending && projectId) void documentsApi.discardSource(projectId, pending).catch(() => undefined).finally(refresh)
    else refresh()
  }

  // Documents are assigned to user accounts (any writer can be picked in New Document), not only to
  // project-team members — so resolve names from the user directory, with the team as a fallback.
  // The directory is admin-only; for other roles the request is refused and only team names resolve.
  const { data: users = [] } = useQuery<PlatformUser[]>({
    queryKey: ['platform-users'],
    queryFn:  () => platformApi.listUsers(),
    staleTime: 60_000,
    retry: false,
  })
  const teamById = useMemo(() => {
    const map = new Map<string, { name: string; initials: string }>()
    project?.team.forEach(t => map.set(t.userId, { name: t.name, initials: t.initials }))
    users.forEach(u => map.set(u.id, { name: u.name, initials: initialsOf(u.name) }))
    return map
  }, [project, users])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return documents.filter((d: Document) => {
      // Search covers the list's text columns: title, type and assignee (PRD A §8.4).
      const matchSearch = q === '' ||
        d.title.toLowerCase().includes(q) ||
        (TYPE_LABELS[d.type] ?? '').toLowerCase().includes(q) ||
        (teamById.get(d.assigneeId)?.name ?? '').toLowerCase().includes(q)
      const matchStage  = selectedStage  === 'all' || d.stage  === selectedStage
      const matchStatus = selectedStatus === 'all' || d.status === selectedStatus
      const matchType   = selectedType   === 'all' || d.type   === selectedType
      return matchSearch && matchStage && matchStatus && matchType
    })
  }, [documents, search, selectedStage, selectedStatus, selectedType, teamById])

  // Document count per stage, shown on the stage tabs.
  const stageCounts = useMemo(() => {
    const counts = new Map<string, number>()
    documents.forEach((d: Document) => counts.set(d.stage, (counts.get(d.stage) ?? 0) + 1))
    return counts
  }, [documents])

  // Live stepper state driven by real document stages (FR-A-010).
  const stageProgress = useMemo(() => computeStageProgress(documents), [documents])

  // Project-level checklist rollup. Read-only (never materialises instances).
  const { data: checklistSummary, isLoading: checklistLoading } = useQuery({
    queryKey: ['project-checklist-summary', projectId],
    queryFn:  () => documentsApi.getProjectChecklistSummary(projectId!),
    enabled:  !!projectId,
    staleTime: 30_000,
  })

  const sortedDocs = useMemo(() => {
    if (!docSort) return filtered
    const stageOrder = Object.keys(STAGE_LABELS)
    const statusOrder = Object.keys(STATUS_LABELS)
    const val = (d: Document): string | number => {
      switch (docSort.key) {
        case 'title':    return d.title
        case 'type':     return TYPE_LABELS[d.type]
        case 'stage':    return stageOrder.indexOf(d.stage)
        case 'status':   return statusOrder.indexOf(d.status)
        case 'updated':  return d.updatedAt ? Date.parse(d.updatedAt) : 0
        case 'assignee': return teamById.get(d.assigneeId)?.name ?? ''
      }
    }
    const sign = docSort.dir === 'asc' ? 1 : -1
    return [...filtered].sort((a, b) => {
      const x = val(a), y = val(b)
      const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { sensitivity: 'base', numeric: true })
      return c * sign || a.id.localeCompare(b.id)
    })
  }, [filtered, docSort, teamById])

  const filtersDirty = search !== '' || selectedStage !== 'all' || selectedStatus !== 'all' || selectedType !== 'all'

  const resetFilters = () => setParams({ q: null, stage: null, status: null, type: null })

  const handleDocClick = (doc: Document) => {
    navigate(`/projects/${projectId}/clinical-writing/documents/${doc.id}`)
  }

  // Open review comments across the project's documents (FR-A-052). Comments are fetched per
  // document, sharing the cache key the Comments panel uses. Reviewer "approve" verdicts are
  // stored as comments but aren't open issues, so they're left out.
  const commentQueries = useQueries({
    queries: documents.map((d: Document) => ({
      queryKey: ['comments', d.id],
      queryFn:  () => documentsApi.getComments(d.id),
      staleTime: 30_000,
    })),
  })
  const commentsLoading = isLoading || commentQueries.some(q => q.isLoading)
  const commentsFailed  = commentQueries.some(q => q.isError)
  const docTitleById = new Map(documents.map((d: Document) => [d.id, d.title]))
  const openComments = commentQueries
    .flatMap(q => (q.data ?? []) as Comment[])
    .filter(c => c.status === 'open' && c.verdict !== 'approve')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const openCommentDoc = (c: Comment) => docTitleById.get(c.documentId) ?? ''
  const openCommentCount = openComments.length
  const openCommentLabel = commentsLoading ? '…' : String(openCommentCount)
  const activeTypes  = Array.from(new Set(documents.map((d: Document) => d.type))) as DocumentType[]
  const activeStatuses = Array.from(new Set(documents.map((d: Document) => d.status))) as DocumentStatus[]

  return (
    <div className="flex h-full flex-col" data-screen="clinical-writing-home">

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
              {[
                project?.shortTitle ?? '—',
                project?.therapeuticArea ?? '—',
                project ? phaseLabel(project.phase) : '—',
                project?.indication,
                `${documents.length} documents`,
                `${openCommentLabel} open comment${openCommentCount === 1 ? '' : 's'}`,
              ].filter(Boolean).join(' · ')}
            </p>
            <div className="flex gap-2.5 pt-1">
              <button
                type="button"
                onClick={() => setNewDocOpen({ duplicateSourceId: null })}
                className="rounded-md bg-blue-600 px-3.5 py-2.5 text-[13px] font-semibold text-white transition-colors hover:bg-blue-700"
              >
                + New Document
              </button>
              <button
                type="button"
                onClick={() => setUploadOpen(true)}
                className="rounded-md border border-slate-200 bg-white px-3.5 py-2.5 text-[13px] font-semibold text-slate-900 transition-colors hover:bg-slate-50"
                data-action="upload-source"
              >
                Upload source document
              </button>
            </div>
          </div>

          {/* Right: stage progress stepper */}
          <div className="flex flex-1 flex-col gap-2" style={{ maxWidth: '660px' }}>
            <p className="text-xs font-semibold text-slate-500">Stage progress</p>
            <div className="flex items-start">
              {STAGES_ORDERED.map((stage, i) => {
                const state = stageProgress[stage]
                const width = STAGE_STEPPER_WIDTHS[stage]
                const count = stageCounts.get(stage) ?? 0
                const isLast = i === STAGES_ORDERED.length - 1
                const nextComplete = !isLast && stageProgress[STAGES_ORDERED[i+1]] === 'complete'
                return (
                  <Fragment key={stage}>
                    <button
                      type="button"
                      onClick={() => showStage(stage)}
                      className="flex flex-none flex-col items-center gap-2 rounded-md px-1 py-1 hover:bg-slate-50"
                      style={{ width }}
                      aria-label={`${STAGE_LABELS[stage]}: ${count} document${count === 1 ? '' : 's'}`}
                      data-stage-step={stage}
                      data-stage-state={state}
                    >
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
                      <p className="font-mono text-[10px] font-medium tracking-wider" style={{ color: count > 0 ? '#2563EB' : '#94A3B8' }}>
                        {count} doc{count === 1 ? '' : 's'}
                      </p>
                    </button>
                    {!isLast && (
                      <div
                        className="mt-[10px] h-[2px] flex-1"
                        style={{ backgroundColor: state === 'complete' || nextComplete ? '#2563EB' : '#E2E8F0' }}
                      />
                    )}
                  </Fragment>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      {/* ============ Stage Tabs ============ */}
      <div className="flex flex-none gap-6 overflow-x-auto whitespace-nowrap border-b border-slate-200 bg-white px-8">
        <TabButton label={`All Stages (${documents.length})`}  active={view === 'documents' && selectedStage === 'all'} onClick={() => showStage('all')} />
        <TabButton
          label={sourceCount !== undefined ? `Source Documents (${sourceCount})` : 'Source Documents'}
          active={view === 'sources'}
          onClick={showSources}
        />
        <span aria-hidden="true" className="my-3.5 w-px flex-none bg-slate-200" />
        {STAGES_ORDERED.map(stage => (
          <TabButton
            key={stage}
            label={`${STAGE_LABELS[stage]} (${stageCounts.get(stage) ?? 0})`}
            active={view === 'documents' && selectedStage === stage}
            onClick={() => showStage(stage)}
          />
        ))}
      </div>

      {/* ============ Content ============ */}
      <div className="flex flex-1 items-start gap-6 overflow-auto px-8 py-6">

        {view === 'sources' && projectId ? (
          <div className="flex min-w-0 flex-1 flex-col gap-4">
            {justAdded && (
              <div className="flex items-center justify-between gap-3 rounded-md border border-green-200 bg-green-50 px-4 py-3 text-[13px] text-green-900" role="status" data-upload-success>
                <span>Source document saved to the library.</span>
                <span className="flex flex-none items-center gap-4">
                  <button type="button" onClick={() => setJustAdded(null)} className="font-semibold underline" aria-label="Dismiss">Dismiss</button>
                </span>
              </div>
            )}
            <SourceDocumentsTab
              projectId={projectId}
              onUpload={() => setUploadOpen(true)}
            />
          </div>
        ) : (
          <>
        {/* Left column: document table card */}
        <div className="flex min-w-0 flex-1 flex-col gap-3.5">
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">

            {/* Filter bar */}
            <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-5 py-4">
              <div className="flex min-w-[200px] flex-1 items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                <SearchIcon />
                <input
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search documents..."
                  className="w-full border-none bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400"
                />
              </div>
              <select
                value={selectedType}
                onChange={e => setSelectedType(e.target.value as DocumentType | 'all')}
                aria-label="Filter by type"
                className="h-[38px] rounded-md border border-slate-200 bg-slate-50 px-3 text-sm text-slate-900"
              >
                <option value="all">All Types</option>
                {activeTypes.map(t => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
              </select>
              <select
                value={selectedStatus}
                onChange={e => setSelectedStatus(e.target.value as DocumentStatus | 'all')}
                aria-label="Filter by status"
                className="h-[38px] rounded-md border border-slate-200 bg-slate-50 px-3 text-sm text-slate-900"
              >
                <option value="all">All Statuses</option>
                {activeStatuses.map(st => <option key={st} value={st}>{STATUS_LABELS[st]}</option>)}
              </select>
              {filtersDirty && (
                <button onClick={resetFilters} className="p-1 text-xs font-semibold text-blue-600 hover:text-blue-700">
                  Reset filters
                </button>
              )}
            </div>

            {/* Column headers */}
            <div
              className="border-b border-slate-200 bg-slate-50 px-5 py-3 text-xs font-semibold text-slate-500"
              style={{ display: 'grid', gridTemplateColumns: COL_TEMPLATE }}
            >
              {([
                ['Document Title', 'title'], ['Type', 'type'], ['Stage', 'stage'],
                ['Status', 'status'], ['Last Updated', 'updated'], ['Assigned To', 'assignee'],
              ] as Array<[string, DocSortKey]>).map(([label, key]) => (
                <div key={key} aria-sort={docSort?.key === key ? (docSort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                  <button
                    type="button"
                    onClick={() => setDocSort(cur => nextSort(cur, key))}
                    className="inline-flex items-center gap-1.5 font-semibold hover:text-slate-800"
                    data-sort={key}
                  >
                    {label}<SortIcon state={docSort?.key === key ? docSort.dir : null} />
                  </button>
                </div>
              ))}
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

            {!isLoading && sortedDocs.map((doc: Document, i: number) => {
              const assignee = teamById.get(doc.assigneeId) ?? { name: '—', initials: '—' }
              return (
                <div
                  key={doc.id}
                  onClick={() => setDetailDoc(cur => (cur?.id === doc.id ? null : doc))}
                  data-panel-trigger
                  data-doc-row={doc.id}
                  aria-selected={detailDoc?.id === doc.id}
                  className={`cursor-pointer items-center border-b border-slate-100 px-5 py-4 text-sm hover:bg-slate-50 transition-colors ${detailDoc?.id === doc.id ? 'bg-blue-50/50' : ''}`}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: COL_TEMPLATE,
                    borderBottom: i === sortedDocs.length - 1 ? 'none' : undefined,
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
                  <div className="flex items-center justify-end gap-2" onClick={e => e.stopPropagation()}>
                    <button
                      type="button"
                      onClick={e => { e.stopPropagation(); handleDocClick(doc) }}
                      className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-900 hover:bg-slate-100 transition-colors"
                    >
                      Open
                    </button>
                    <DocumentRowMenu
                      doc={doc}
                      onOpen={() => handleDocClick(doc)}
                      onDuplicate={() => setNewDocOpen({ duplicateSourceId: doc.id })}
                    />
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
              <p className="text-xs font-semibold text-slate-500">Open Comments ({openCommentLabel})</p>
              <button
                type="button"
                onClick={() => navigate(`/projects/${projectId}/clinical-writing/comments`)}
                className="text-xs font-semibold text-blue-600 hover:text-blue-700"
                data-action="view-all-comments"
              >
                View all
              </button>
            </div>
            {commentsLoading && (
              <p className="rounded-lg border border-slate-200 bg-white p-3 text-[12px] text-slate-400">Loading comments…</p>
            )}
            {!commentsLoading && openCommentCount === 0 && (
              <p className="rounded-lg border border-slate-200 bg-white p-3 text-[12px] text-slate-500" data-empty-comments>
                {commentsFailed ? 'Some comments could not be loaded.' : 'No open comments.'}
              </p>
            )}
            {!commentsLoading && openComments.slice(0, SIDEBAR_COMMENT_LIMIT).map(c => {
              const sev = SEVERITY_BADGE[c.severity] ?? SEVERITY_BADGE.minor
              return (
                <div
                  key={c.id}
                  className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-3"
                  data-comment-card={c.id}
                >
                  <div className="flex w-full items-center gap-2">
                    <span className="font-mono text-[10px] text-slate-500">{c.id}</span>
                    {c.sectionRef && (
                      <span className="rounded px-1.5 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: '#F1F5F9', color: '#475569' }}>{c.sectionRef}</span>
                    )}
                    <div className="flex-1" />
                    <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: sev.bg, color: sev.fg }}>{sev.label}</span>
                  </div>
                  <div className="flex w-full min-w-0 items-center gap-2">
                    <div className="flex h-[22px] w-[22px] flex-none items-center justify-center rounded-full font-mono text-[10px] font-bold" style={{ backgroundColor: '#F1F5F9', color: '#475569' }}>
                      {initialsOf(c.reviewerName ?? '')}
                    </div>
                    <div className="truncate text-[13px] text-slate-900">{c.text || <span className="italic text-slate-400">No comment text</span>}</div>
                  </div>
                  <p className="w-full truncate text-[11px] text-slate-500">{openCommentDoc(c)}</p>
                  <p className="text-[11px] text-slate-500">{c.reviewerName} · {c.age}</p>
                </div>
              )
            })}
            {!commentsLoading && openCommentCount > SIDEBAR_COMMENT_LIMIT && (
              <p className="text-[11px] text-slate-500">
                + {openCommentCount - SIDEBAR_COMMENT_LIMIT} more open comments
              </p>
            )}
          </div>

          <div className="flex flex-col gap-2.5">
            <p className="text-xs font-semibold text-slate-500">Checklist status</p>
            <div className="flex flex-col gap-2.5 rounded-lg border border-slate-200 bg-white p-3.5" data-checklist-summary>
              {checklistLoading && (
                <p className="text-[12px] text-slate-400">Loading checklist…</p>
              )}
              {!checklistLoading && checklistSummary && checklistSummary.totalItems === 0 && (
                <p className="text-[12px] text-slate-500" data-empty-checklist>
                  No checklist items yet. Open a document's Checklist panel to begin, or ask Admin to seed the master templates.
                </p>
              )}
              {!checklistLoading && checklistSummary && checklistSummary.totalItems > 0 && (
                <>
                  <ChecklistRow label="Complete" count={checklistSummary.complete} colour={CHECKLIST_ROW_COLOURS.complete} />
                  <ChecklistRow label="Pending"  count={checklistSummary.pending}  colour={CHECKLIST_ROW_COLOURS.pending} />
                  <ChecklistRow label="Waived"   count={checklistSummary.waived}   colour={CHECKLIST_ROW_COLOURS.waived} warn />
                  {checklistSummary.mandatoryPending > 0 && (
                    <div className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-[12px] font-semibold text-amber-900" data-mandatory-pending>
                      Mandatory pending: {checklistSummary.mandatoryPending}
                    </div>
                  )}
                  <p className="text-[11px] text-slate-500">
                    {checklistSummary.documentsWithChecklist}/{checklistSummary.totalDocuments} document{checklistSummary.totalDocuments === 1 ? '' : 's'} tracked
                  </p>
                </>
              )}
            </div>
          </div>

        </div>
          </>
        )}
      </div>

      {view === 'documents' && projectId && (
        <DocumentDetailPanel
          projectId={projectId}
          doc={detailDoc}
          typeLabel={detailDoc ? TYPE_LABELS[detailDoc.type] : ''}
          stageLabel={detailDoc ? STAGE_LABELS[detailDoc.stage] : ''}
          assigneeName={detailDoc ? (teamById.get(detailDoc.assigneeId)?.name ?? '—') : ''}
          onClose={() => setDetailDoc(null)}
          onOpen={id => navigate(`/projects/${projectId}/clinical-writing/documents/${id}`)}
        />
      )}

      <SlidePanel
        open={newDocOpen !== false}
        onClose={() => setNewDocOpen(false)}
        title={newDocOpen && newDocOpen.duplicateSourceId ? 'Duplicate document' : 'New document'}
        subtitle={project?.shortTitle ? `Project ${project.shortTitle}` : undefined}
        storageKey="panel-width-new-document"
        closeOnOutsideClick
      >
        {newDocOpen !== false && projectId && (
          <NewDocumentForm
            projectId={projectId}
            duplicateSourceId={newDocOpen.duplicateSourceId}
            initialSourceIds={newDocOpen.sourceIds}
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

      <SlidePanel
        open={uploadOpen}
        onClose={closeUpload}
        title="Upload source document"
        subtitle={project?.shortTitle ? `Project ${project.shortTitle}` : undefined}
        storageKey="panel-width-upload-document"
        closeOnOutsideClick
      >
        {uploadOpen && projectId && (
          <UploadDocumentForm
            projectId={projectId}
            onCancel={closeUpload}
            onPendingChange={id => { pendingUploadRef.current = id }}
            onSaved={uploadId => {
              // Stay on the project's source-document list: the new row appears here as "Saved".
              closeUpload()
              showSources()
              setJustAdded({ uploadId })
            }}
          />
        )}
      </SlidePanel>
    </div>
  )
}

// --- Small helpers ---

// Initials skip honorifics, so "Dr Elena Vasquez" → "EV", not "DE".
const initialsOf = (name: string) =>
  name.trim().split(/\s+/).filter(w => !/^(dr|mr|mrs|ms|prof)\.?$/i.test(w))
    .slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('') || '?'

// Stored phases vary ("Phase III", "IIb", "Preclinical") — only add the "Phase" prefix when it's missing.
const phaseLabel = (phase: string) => (/^phase\b|preclinical/i.test(phase) ? phase : `Phase ${phase}`)

function ChecklistRow({ label, count, colour, warn }: { label: string; count: number; colour: string; warn?: boolean }) {
  return (
    <div className="flex items-center justify-between text-[13px]" style={{ color: warn ? '#B45309' : undefined }} data-checklist-row={label.toLowerCase()}>
      <span className="flex items-center gap-2">
        <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: colour }} />
        {label}
      </span>
      <span className="font-semibold">{count}</span>
    </div>
  )
}

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

function SortIcon({ state }: { state: 'asc' | 'desc' | null }) {
  return (
    <svg width="10" height="12" viewBox="0 0 10 12" fill="none" aria-hidden="true" className="flex-none">
      <path d="M5 1 2 4.5h6L5 1Z" fill={state === 'asc' ? '#1E293B' : '#CBD5E1'} />
      <path d="M5 11 2 7.5h6L5 11Z" fill={state === 'desc' ? '#1E293B' : '#CBD5E1'} />
    </svg>
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

// Document row "⋯" menu — Arc A5. Recommended default action set per
// docs/decisions/module-a-defaults.md §1. Items marked (soon) are
// backend-pending and show a tooltip explaining when they'll light up.
function DocumentRowMenu({ doc, onOpen, onDuplicate }: {
  doc: Document
  onOpen: () => void
  onDuplicate: () => void
}) {
  const [open, setOpen] = useState(false)
  const isSigned = doc.status === 'signed'
  return (
    <div className="relative">
      <button
        type="button"
        aria-label="More actions"
        aria-expanded={open}
        onClick={e => { e.stopPropagation(); setOpen(o => !o) }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className="flex gap-[2.5px] rounded-md p-1.5 hover:bg-slate-100 transition-colors"
      >
        <span className="h-[3px] w-[3px] rounded-full" style={{ backgroundColor: '#64748B' }} />
        <span className="h-[3px] w-[3px] rounded-full" style={{ backgroundColor: '#64748B' }} />
        <span className="h-[3px] w-[3px] rounded-full" style={{ backgroundColor: '#64748B' }} />
      </button>
      {open && (
        <div
          className="absolute right-0 top-full z-20 mt-1 w-56 rounded-md border border-slate-200 bg-white py-1 shadow-lg"
          role="menu"
          onClick={e => e.stopPropagation()}
        >
          <MenuItem onClick={() => { setOpen(false); onOpen() }}>Open</MenuItem>
          <MenuItem onClick={() => { setOpen(false); onDuplicate() }}>Duplicate</MenuItem>
          <MenuItem disabled title="Document-level PDF export lands with Phase 2 of the Module A plan.">
            Export PDF <span className="ml-1 text-[9px] uppercase text-slate-400">soon</span>
          </MenuItem>
          <div className="my-1 border-t border-slate-100" />
          <MenuItem
            disabled
            title={isSigned ? 'Signed documents cannot be archived (Part 11 §11.10).' : 'Archive endpoint pending (Phase 2).'}
          >
            Archive <span className="ml-1 text-[9px] uppercase text-slate-400">soon</span>
          </MenuItem>
          <MenuItem
            disabled
            danger
            title={isSigned ? 'Signed documents cannot be deleted (Part 11 §11.10).' : 'Delete endpoint pending (Phase 2); admin-only.'}
          >
            Delete <span className="ml-1 text-[9px] uppercase text-slate-400">soon</span>
          </MenuItem>
        </div>
      )}
    </div>
  )
}

function MenuItem({ onClick, disabled, danger, title, children }: {
  onClick?: () => void
  disabled?: boolean
  danger?: boolean
  title?: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      role="menuitem"
      className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-[13px] ${
        disabled
          ? 'cursor-not-allowed text-slate-400'
          : danger
            ? 'text-red-600 hover:bg-red-50'
            : 'text-slate-700 hover:bg-slate-50'
      }`}
    >
      {children}
    </button>
  )
}
