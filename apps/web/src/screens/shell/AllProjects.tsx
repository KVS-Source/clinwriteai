import { formatDate } from '../../utils/formatDate'
import { useEffect, useState, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import type { Project, ProjectStatus } from '@platform/types'
import { projectsApi } from '../../api'
import { ProjectStatusPill, SlidePanel } from '../../components/ui'
import { useProjectStore } from '../../store'
import { usePlatformStore } from '../../platform/store'
import { useTaLabels } from '../../hooks'
import { NewProjectForm } from './NewProject'
import { DocumentCountChips } from './DocumentCountChips'
import { ProjectSettingsPanel } from './ProjectSettingsPanel'
import { ProjectOverviewPanel } from './ProjectOverviewPanel'
import { holdsRole } from '../../config/roles'

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" className="flex-none text-slate-400">
      <circle cx="6" cy="6" r="4.2"/>
      <path d="M9.6 9.6L12.5 12.5" strokeLinecap="round"/>
    </svg>
  )
}

function ChevronRightIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" className="flex-none text-slate-300">
      <path d="M5 3L9 7L5 11" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

function GearIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="flex-none">
      <circle cx="7" cy="7" r="2.3" />
      <path d="M7 1v1.5M7 11.5V13M1 7h1.5M11.5 7H13M2.75 2.75l1.06 1.06M10.19 10.19l1.06 1.06M2.75 11.25l1.06-1.06M10.19 3.81l1.06-1.06" />
    </svg>
  )
}

function FolderIcon() {
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-slate-300">
      <path d="M5 10h10l3 4h17v20H5V10Z" strokeLinejoin="round"/>
    </svg>
  )
}

// Row columns: project · documents · TA · phase · start date · submission countries · AI spend · status · gear · chevron
const ROW_GRID = 'minmax(220px,2fr) 220px minmax(120px,1fr) 100px 120px minmax(120px,1fr) 100px 120px 28px 14px'
type SortKey = 'project' | 'ta' | 'phase' | 'start' | 'documents' | 'ai' | 'status'
type SortState = { key: SortKey; dir: 'asc' | 'desc' } | null
// Countries has no sensible order, so it isn't sortable.
const COLUMN_HEADERS: Array<{ labelKey: string; key: SortKey | null }> = [
  { labelKey: 'page.all_projects.col_project',   key: 'project' },
  { labelKey: 'page.all_projects.col_documents', key: 'documents' },
  { labelKey: 'page.all_projects.col_ta',        key: 'ta' },
  { labelKey: 'page.all_projects.col_phase',     key: 'phase' },
  { labelKey: 'page.all_projects.col_start',     key: 'start' },
  { labelKey: 'page.all_projects.col_countries', key: null },
  { labelKey: 'page.all_projects.col_ai_spend',  key: 'ai' },
  { labelKey: 'page.all_projects.col_status',    key: 'status' },
]

function formatUsd(amount: number): string {
  // Running-total column — compact display: cents to 2dp, ~$1 to 2dp, big
  // amounts to 0dp with k/M suffix. Keeps the column narrow while staying
  // precise on the common sub-dollar figures the demo emits.
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`
  if (amount >= 1_000)     return `$${(amount / 1_000).toFixed(1)}k`
  if (amount >= 1)         return `$${amount.toFixed(2)}`
  if (amount > 0)          return `$${amount.toFixed(4)}`
  return '—'
}
// asc → desc → back to the default (newest first) order
const nextSort = (cur: SortState, key: SortKey): SortState =>
  cur?.key !== key ? { key, dir: 'asc' } : cur.dir === 'asc' ? { key, dir: 'desc' } : null

const STATUS_RANK: Record<string, number> = { initiated: 0, ongoing: 1, 're-open': 2, 'on-hold': 3, closed: 4 }

// Preclinical < Phase 1 < Phase 1/2 < Phase 2 < Phase 2b < Phase 3 …; handles roman (III, IIb) and arabic.
function phaseRank(phase: string): number {
  const t = phase.toLowerCase()
  if (/pre-?clinical/.test(t)) return 0
  const m = t.match(/\b(iv|v?i{1,3}|\d+)\s*([ab])?\s*(\/\s*(iv|v?i{1,3}|\d+))?/)
  if (!m) return 99
  const num = (x: string) => (/^\d+$/.test(x) ? Number(x) : ({ i: 1, ii: 2, iii: 3, iv: 4, v: 5 } as Record<string, number>)[x] ?? 99)
  return num(m[1]!) + (m[2] ? 0.1 : 0) + (m[3] ? 0.5 : 0)
}

function SortIcon({ state }: { state: 'asc' | 'desc' | null }) {
  return (
    <svg width="10" height="12" viewBox="0 0 10 12" fill="none" aria-hidden="true" className="flex-none">
      <path d="M5 1 2 4.5h6L5 1Z" fill={state === 'asc' ? '#1E293B' : '#CBD5E1'} />
      <path d="M5 11 2 7.5h6L5 11Z" fill={state === 'desc' ? '#1E293B' : '#CBD5E1'} />
    </svg>
  )
}

// Closed projects are hidden from the Projects list for now (temporary, for the demo). Set to false to show
// them again — the list, the counts, the TA options and the Closed chip all come back.
export const HIDE_CLOSED_PROJECTS = true

const STATUS_FILTERS: { labelKey: string; value: ProjectStatus | 'all' }[] = [
  { labelKey: 'page.all_projects.filter_all',       value: 'all' },
  { labelKey: 'component.project_status.status_ongoing',   value: 'ongoing' },
  { labelKey: 'component.project_status.status_initiated', value: 'initiated' },
  { labelKey: 'component.project_status.status_on_hold',   value: 'on-hold' },
  { labelKey: 'component.project_status.status_re_open',   value: 're-open' },
  { labelKey: 'component.project_status.status_closed',    value: 'closed' },
].filter(f => !(HIDE_CLOSED_PROJECTS && f.value === 'closed')) as { labelKey: string; value: ProjectStatus | 'all' }[]

/** Human label for a project status — translated per status. */
function statusLabel(status: ProjectStatus, t: TFunction): string {
  switch (status) {
    case 'ongoing':   return t('page.all_projects.status_ongoing')
    case 'initiated': return t('page.all_projects.status_initiated')
    case 're-open':   return t('page.all_projects.status_re_open')
    case 'on-hold':   return t('page.all_projects.status_on_hold')
    case 'closed':    return t('page.all_projects.status_closed')
  }
}

export function AllProjects() {
  const { t } = useTranslation()
  const navigate         = useNavigate()
  const setActiveProject = useProjectStore(s => s.setActiveProject)

  // "+ New Project" is a PM-only action. Admins (tenant-admin) deliberately
  // don't create projects — their domain is tenant admin / users / audit.
  // Contributors / reviewers / auditors / guests never see the button.
  // The API gate (POST /projects) now also requires role='pm'.
  const currentUser = usePlatformStore(s => s.currentUser)
  const isPm = holdsRole(currentUser, 'pm')

  const [search,       setSearch]       = useState('')
  const [statusFilter, setStatusFilter] = useState<ProjectStatus | 'all'>('all')
  const [taFilter,     setTaFilter]     = useState<string>('all')   // TA label or 'all'
  // Row-level Project Settings panel — `settingsFor` carries the project the
  // gear was clicked on; null = panel closed. Same panel the Project
  // Dashboard uses, so tweaks here and there stay in sync.
  const [settingsFor, setSettingsFor] = useState<Project | null>(null)
  // Row click now opens a quick-view overview panel (header + KPIs +
  // Cost & Performance) instead of navigating straight to the full
  // dashboard page. Panel carries "Open full dashboard →" for deeper
  // drill-down (module cards, status history, documents list).
  const [overviewFor, setOverviewFor] = useState<Project | null>(null)
  const [newProjectOpen, setNewProjectOpen] = useState(false)
  const [sort, setSort] = useState<SortState>(null)

  const { data: allProjects = [], isLoading } = useQuery({
    queryKey: ['projects'],
    queryFn:  () => projectsApi.list(),
  })
  // Closed projects are hidden for now (HIDE_CLOSED_PROJECTS): left out of the list, the counts and the filters.
  const projects = useMemo(
    () => (HIDE_CLOSED_PROJECTS ? allProjects.filter((p: Project) => p.status !== 'closed') : allProjects),
    [allProjects],
  )

  // Deep-link support — `/projects?open=<id>` auto-opens the overview
  // panel for that project once its row has loaded. ProjectDashboardRedirect
  // sends users here when they hit the legacy /projects/:id URL; share links
  // keep working without the full dashboard page behind them. The query
  // param is cleared from the URL after the panel opens so a subsequent
  // Close doesn't re-open on every render.
  const [searchParams, setSearchParams] = useSearchParams()
  const openParam = searchParams.get('open')
  useEffect(() => {
    if (!openParam || projects.length === 0) return
    const match = projects.find((p: Project) => p.id === openParam)
    if (!match) return
    setActiveProject(match)
    setOverviewFor(match)
    const next = new URLSearchParams(searchParams)
    next.delete('open')
    setSearchParams(next, { replace: true })
  }, [openParam, projects, searchParams, setSearchParams, setActiveProject])

  // AC-A-004b: filterable by TA tag. Offer the master list plus any TA a
  // project already carries that predates it, so no project is unreachable.
  const { labels: taLabels } = useTaLabels()
  const taOptions = useMemo(() => {
    const known = new Set(taLabels.map(l => l.toLowerCase()))
    const legacy = [...new Set(projects.map((p: Project) => p.therapeuticArea).filter(Boolean))]
      .filter(ta => !known.has(ta.toLowerCase()))
    return [...taLabels, ...legacy].sort((a, b) => a.localeCompare(b))
  }, [taLabels, projects])


  const filtered = useMemo(() => {
    return projects.filter((p: Project) => {
      const matchSearch = search === '' ||
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        p.shortTitle.toLowerCase().includes(search.toLowerCase())
      const matchStatus = statusFilter === 'all' || p.status === statusFilter
      const matchTa     = taFilter === 'all' || p.therapeuticArea?.toLowerCase() === taFilter.toLowerCase()
      return matchSearch && matchStatus && matchTa
    })
  }, [projects, search, statusFilter, taFilter])

  const sorted = useMemo(() => {
    if (!sort) return filtered
    const val = (p: Project): string | number => {
      switch (sort.key) {
        case 'project':   return p.shortTitle
        case 'ta':        return p.therapeuticArea ?? ''
        case 'phase':     return phaseRank(p.phase ?? '')
        case 'start':     return p.startDate ? Date.parse(p.startDate) : 0
        case 'documents': return p.documentCount ?? 0
        case 'ai':        return p.aiSpendUsd ?? 0
        case 'status':    return STATUS_RANK[p.status] ?? 99
      }
    }
    const sign = sort.dir === 'asc' ? 1 : -1
    return [...filtered].sort((a, b) => {
      const x = val(a), y = val(b)
      const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { sensitivity: 'base', numeric: true })
      return c * sign || a.id.localeCompare(b.id)
    })
  }, [filtered, sort])

  const handleProjectClick = (project: Project) => {
    // Set the active project so downstream screens (sidebar, breadcrumb,
    // nested routes) have the context when the writer drills in from the
    // panel's "Open full dashboard →" link.
    setActiveProject(project)
    setOverviewFor(project)
  }

  // "4 ongoing · 8 initiated · 12 total" — every status that has projects, in lifecycle order.
  const STATUS_ORDER: ProjectStatus[] = ['ongoing', 'initiated', 're-open', 'on-hold', 'closed']
  const statusSummary = [
    ...STATUS_ORDER
      .map(st => ({ st, n: projects.filter((p: Project) => p.status === st).length }))
      .filter(x => x.n > 0)
      .map(x => t('page.all_projects.status_summary_item', { count: x.n, label: statusLabel(x.st, t) })),
    t('page.all_projects.status_summary_total', { count: projects.length }),
  ].join(' · ')

  return (
    <div className="flex h-full flex-col" data-screen="all-projects">

      {/* Page header */}
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 bg-white px-8 pt-5 pb-[22px]">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2.5">
            <span className="h-2 w-2 flex-none rounded-full" style={{ backgroundColor: '#2563EB' }} />
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">{t('page.all_projects.title')}</h1>
          </div>
          <p className="text-sm text-slate-500">
            {statusSummary}
          </p>
        </div>
        {isPm && (
          <button
            onClick={() => setNewProjectOpen(true)}
            data-panel-trigger
            data-action="new-project"
            className="flex h-9 items-center gap-1.5 rounded-md bg-blue-600 px-4 text-[13px] font-semibold text-white hover:bg-blue-700 transition-colors"
          >
            {/* A drawn plus, not a "+" character: the font sets that below the middle of the text. */}
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" className="flex-none" data-new-project-icon>
              <path d="M6 1.5v9M1.5 6h9" />
            </svg>
            {t('page.all_projects.new_project')}
          </button>
        )}
      </div>

      {/* Body: one card holding the filters and the table, like the documents list. */}
      <div className="flex-1 overflow-auto px-8 py-6">
        <div className="flex flex-col gap-3.5">
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">

            {/* Filter bar */}
            <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-5 py-4">
              <div className="flex min-w-[200px] flex-1 items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                <SearchIcon />
                <input
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder={t('page.all_projects.search_placeholder')}
                  className="w-full border-none bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400"
                />
                {search && (
                  <button
                    onClick={() => setSearch('')}
                    className="text-xs leading-none text-slate-400 hover:text-slate-600"
                    aria-label={t('page.all_projects.clear_search')}
                  >
                    ✕
                  </button>
                )}
              </div>

              {/* Status chips */}
              <div className="flex flex-wrap items-center gap-2">
                {STATUS_FILTERS.map(f => (
                  <button
                    key={f.value}
                    onClick={() => setStatusFilter(f.value)}
                    data-status-filter={f.value}
                    className={`h-[38px] rounded-md border px-3 text-sm transition-colors ${statusFilter === f.value
                      ? 'border-blue-200 bg-blue-50 font-semibold text-blue-600'
                      : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100'}`}
                  >
                    {t(f.labelKey)}
                  </button>
                ))}
              </div>

              {/* TA filter */}
              <select
                value={taFilter}
                onChange={e => setTaFilter(e.target.value)}
                data-ta-filter
                aria-label={t('page.all_projects.filter_by_ta')}
                className="h-[38px] rounded-md border border-slate-200 bg-slate-50 px-3 text-sm text-slate-900"
              >
                <option value="all">{t('page.all_projects.all_tas')}</option>
                {taOptions.map(ta => <option key={ta} value={ta}>{ta}</option>)}
              </select>
            </div>

            {/* Scrolls sideways on narrow screens instead of squeezing the columns together. */}
            <div className="overflow-x-auto">
              <div className="min-w-[960px]">
                {/* Column headers */}
                <div className="grid items-center border-b border-slate-200 bg-slate-50 px-5 py-3 text-xs font-semibold text-slate-500" style={{ gridTemplateColumns: ROW_GRID }}>
                  {COLUMN_HEADERS.map(h => h.key ? (
                    <div key={h.labelKey} aria-sort={sort?.key === h.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                      <button
                        type="button"
                        onClick={() => setSort(cur => nextSort(cur, h.key!))}
                        data-sort={h.key}
                        className="inline-flex items-center gap-1.5 font-semibold hover:text-slate-800"
                      >
                        {t(h.labelKey)}<SortIcon state={sort?.key === h.key ? sort.dir : null} />
                      </button>
                    </div>
                  ) : <div key={h.labelKey}>{t(h.labelKey)}</div>)}
                  {/* Empty header cells for the gear + chevron columns */}
                  <div />
                  <div />
                </div>

                {isLoading && (
                  <div className="p-12 text-center font-mono text-sm text-slate-400">{t('page.all_projects.loading')}</div>
                )}

                {!isLoading && filtered.length === 0 && (
                  <div className="flex flex-col items-center justify-center gap-3 px-5 py-12">
                    <FolderIcon />
                    <div className="text-center">
                      <p className="text-sm font-semibold text-slate-900">{t('page.all_projects.empty_title')}</p>
                      <p className="mt-1 text-[13px] text-slate-400">{t('page.all_projects.empty_hint')}</p>
                    </div>
                  </div>
                )}

                {!isLoading && sorted.map((project: Project, i: number) => {
                  // Gear visible only to users who can actually open the
                  // Settings panel for this row — a PM, or any of the
                  // project's Authors (team member with RACI='R'). Everyone
                  // else gets an empty cell; click behaviour stays as "open
                  // the project dashboard" via the row click.
                  const isProjectAuthor = project.team?.some(
                    m => m.raci === 'R' && m.userId === currentUser.id,
                  ) ?? false
                  const canOpenSettings = isPm || isProjectAuthor
                  return (
                    <div
                      key={project.id}
                      onClick={() => handleProjectClick(project)}
                      data-project-row={project.id}
                      className={`grid cursor-pointer items-center px-5 py-4 text-sm transition-colors hover:bg-slate-50 ${i === sorted.length - 1 ? '' : 'border-b border-slate-100'}`}
                      style={{ gridTemplateColumns: ROW_GRID }}
                    >
                      <div className="min-w-0 pr-4">
                        <p className="truncate font-semibold text-slate-900">{project.shortTitle}</p>
                        {project.name && project.name !== project.shortTitle && (
                          <p className="mt-0.5 truncate text-xs text-slate-500" title={project.name}>{project.name}</p>
                        )}
                      </div>
                      <div className="min-w-0 overflow-hidden pr-4"><DocumentCountChips project={project} /></div>
                      <div className="min-w-0 truncate pr-2 text-slate-900" title={project.therapeuticArea ?? undefined}>
                        {project.therapeuticArea || <span className="text-slate-400">—</span>}
                      </div>
                      <div className="text-slate-500">{project.phase ? (/^phase\b|preclinical/i.test(project.phase) ? project.phase : t('page.all_projects.phase_prefix', { phase: project.phase })) : '—'}</div>
                      <div className="text-slate-500">{project.startDate ? formatDate(project.startDate) : '—'}</div>
                      <div className="flex flex-wrap gap-1">
                        {project.submissionCountries?.length
                          ? project.submissionCountries.map(c => (
                              <span key={c} className="rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] font-medium text-slate-500">{c}</span>
                            ))
                          : <span className="text-slate-400">—</span>}
                      </div>
                      <div className="font-mono text-[12px] text-slate-700 tabular-nums" data-ai-spend={project.aiSpendUsd ?? 0}
                        title={project.aiSpendUsd != null ? `$${project.aiSpendUsd.toFixed(6)} across all AI calls on this project` : 'No AI usage recorded'}>
                        {formatUsd(project.aiSpendUsd ?? 0)}
                      </div>
                      <div data-project-status={project.status}><ProjectStatusPill status={project.status} /></div>
                      {canOpenSettings ? (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); setSettingsFor(project) }}
                          title="Project settings"
                          aria-label={`Open settings for ${project.shortTitle}`}
                          data-action="row-project-settings"
                          data-panel-trigger
                          className="flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                        >
                          <GearIcon />
                        </button>
                      ) : (
                        <div />
                      )}
                      <ChevronRightIcon />
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          {/* Count footer */}
          {!isLoading && (
            <div className="flex justify-between px-1 text-xs text-slate-500">
              <span data-projects-count>{t('page.all_projects.showing_count', { visible: filtered.length, total: projects.length })}</span>
            </div>
          )}
        </div>
      </div>

      <SlidePanel
        open={newProjectOpen}
        onClose={() => setNewProjectOpen(false)}
        title={t('page.all_projects.new_project_panel_title')}
        subtitle={t('page.all_projects.new_project_panel_subtitle')}
        storageKey="panel-width-new-project"
        closeOnOutsideClick
      >
        <NewProjectForm
          onCancel={() => setNewProjectOpen(false)}
          onCreated={(id, inviteNotSent) => {
            setNewProjectOpen(false)
            navigate(inviteNotSent ? `/projects/${id}/settings` : `/projects/${id}`)
          }}
        />
      </SlidePanel>

      <ProjectSettingsPanel
        open={!!settingsFor}
        onClose={() => setSettingsFor(null)}
        projectId={settingsFor?.id ?? null}
        projectName={settingsFor?.shortTitle}
      />

      <ProjectOverviewPanel
        open={!!overviewFor}
        onClose={() => setOverviewFor(null)}
        project={overviewFor}
      />
    </div>
  )
}
