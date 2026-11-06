import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { STATUS_META, type Document, type ProjectStatus } from '@platform/types'
import { documentsApi, projectsApi, reportsApi } from '../../api'
import { ProjectStatusPill } from '../../components/ui'
import { useProjectStore } from '../../store'
import { usePlatformStore } from '../../platform/store'
import { MODULE_KEY_TO_SLUG, type ModuleKey, type ModuleSlug } from '../../config/modules'
import { isAdminRole, holdsRole } from '../../config/roles'
import { ProjectStatusDialog, ProjectStatusHistory, ProjectStatusMenu, ProjectStatusSuggestion } from './ProjectStatusControl'
import { deadlineDay, fmtDeadline, localToday } from '../clinical-writing/DeadlineField'

// --- Module metadata for the "Available modules" grid (filtered against project.activeModules) ---
const INACTIVE_MODULES = [
  { key: 'clinical-writing',     label: 'Clinical Writing',      colour: '#2563EB', desc: 'Clinical study reports, protocols and regulated clinical documents.' },
  { key: 'scientific-writing',   label: 'Scientific Writing',    colour: '#0D9488', desc: 'Manuscripts, abstracts, congress materials.' },
  { key: 'medical-writing',      label: 'Medical Writing',       colour: '#7C3AED', desc: 'Medical information, MSL and payer content.' },
  { key: 'regulatory-writing',   label: 'Regulatory Writing',    colour: '#B0200D', desc: 'CTD/eCTD dossier authoring and submission.' },
  { key: 'ideation-publishing',  label: 'Ideation & Publishing', colour: '#0D9488', desc: 'Publication planning and channel output.' },
] as const

// --- Active-module labels/colours (for iterating project.activeModules) ---
const ACTIVE_MODULE_META: Record<string, { label: string; colour: string; description: string }> = {
  'clinical-writing': {
    label: 'Clinical Writing',
    colour: '#2563EB',
    // {project} is replaced with the project's short title at render time.
    description: 'Clinical study report authoring, TLF integration and QC cycle for {project}.',
  },
  'scientific-writing':  { label: 'Scientific Writing',    colour: '#0D9488', description: 'Manuscripts, abstracts, congress materials.' },
  'medical-writing':     { label: 'Medical Writing',       colour: '#7C3AED', description: 'Medical information, MSL and payer content.' },
  'regulatory-writing':  { label: 'Regulatory Writing',    colour: '#B0200D', description: 'CTD/eCTD dossier authoring and submission.' },
  'ideation-publishing': { label: 'Ideation & Publishing', colour: '#0D9488', description: 'Publication planning and channel output.' },
}

export function ProjectDashboard() {
  const { t } = useTranslation()
  const { projectId }    = useParams()
  const navigate         = useNavigate()
  const setActiveProject = useProjectStore(s => s.setActiveProject)

  const { data: project, isLoading, isError } = useQuery({
    queryKey: ['project', projectId],
    queryFn:  () => projectsApi.get(projectId!),
    enabled:  !!projectId,
  })

  // Real per-project document stats — replaces the hardcoded KPIs
  // that used to show the same VELORA-301 numbers for every project.
  const { data: documents = [] } = useQuery<Document[]>({
    queryKey: ['documents', projectId],
    queryFn:  () => documentsApi.list(projectId!),
    enabled:  !!projectId,
  })

  // Everyone on the project, each counted once: members (PMs included), the team roster, RACI holders on any
  // of its documents, document assignees and creators. Counted by the API.
  const { data: people } = useQuery({
    queryKey: ['project-people-count', projectId],
    queryFn:  () => projectsApi.people(projectId!),
    enabled:  !!projectId,
    retry: false,
  })
  // While the count loads (or if it can't), fall back to the roster so the card is never empty.
  const teamCount = people?.count ?? project?.team.length ?? 0

  // TLF packages decide whether the data-cut banner may say final TLFs are available.
  const { data: tlfPackages } = useQuery({
    queryKey: ['tlf-packages', projectId],
    queryFn:  () => projectsApi.listTlfPackages(projectId!),
    enabled:  !!projectId,
    retry:    false,
  })
  const hasTlfs = (tlfPackages?.length ?? 0) > 0

  // Measured AI usage for this project (from the AI call log).
  const { data: aiUsage, isLoading: aiLoading, isError: aiFailed } = useQuery({
    queryKey: ['project-ai-usage', projectId],
    queryFn:  () => reportsApi.projectAiUsage(projectId!),
    enabled:  !!projectId,
    retry:    false,
  })

  // The audit trail page is admin-only — don't offer the button to anyone else.
  const currentUser = usePlatformStore(s => s.currentUser)
  const role    = currentUser.role
  const isAdmin = isAdminRole(role)
  const isPm    = holdsRole(currentUser, 'pm')
  const [statusChange, setStatusChange] = useState<ProjectStatus | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)

  // Project Settings is gated to Authors — team members with RACI='R'
  // whose userId matches the current user. Any Author can add / edit /
  // remove team RACI assignments. Admins deliberately don't see this
  // button — their domain is tenant admin / audit / users, not per-project
  // configuration. See AskUserQuestion answers 2026-10-28.
  const isProjectAuthor = useMemo(
    () => Boolean(project?.team.some(t => t.raci === 'R' && t.userId === currentUser.id)),
    [project, currentUser.id],
  )

  useEffect(() => {
    if (project) setActiveProject(project)
  }, [project, setActiveProject])

  const stats = useMemo(() => {
    const inFlight     = documents.filter(d => d.status !== 'signed').length
    const inReview     = documents.filter(d => d.status === 'in-review').length
    const awaitingSign = documents.filter(d => d.status === 'pending-signature').length
    const signed       = documents.filter(d => d.status === 'signed').length
    const inAuthoring  = documents.filter(d => d.status === 'in-authoring').length
    const notStarted   = documents.filter(d => d.status === 'not-started').length
    const inCrm        = documents.filter(d => d.status === 'crm-in-progress').length
    // "Current focus" = the most recently updated document that is being worked on.
    // Not-started documents only count when nothing has been started yet.
    const byNewest = (a: Document, b: Document) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')
    const unsigned = documents.filter(d => d.status !== 'signed' && d.updatedAt)
    const current = [...unsigned.filter(d => d.status !== 'not-started')].sort(byNewest)[0]
      ?? [...unsigned].sort(byNewest)[0]
    // Last activity = newest update on any document, signed ones included.
    const lastActivity = documents.reduce<string | null>(
      (max, d) => (d.updatedAt && (!max || d.updatedAt > max) ? d.updatedAt : max), null)
    return { inFlight, inReview, awaitingSign, signed, inAuthoring, notStarted, inCrm, current, lastActivity }
  }, [documents])

  // Open documents with a date set. Review due only counts while the document is in review.
  const deadlines = useMemo(() => {
    const today = localToday()
    return documents
      .filter(d => d.status !== 'signed' && (d.targetCompletionDate || d.reviewDueAt))
      .map(d => {
        const inReview = d.status === 'in-review' || d.status === 'crm-in-progress'
        const target = deadlineDay(d.targetCompletionDate)
        const review = inReview ? deadlineDay(d.reviewDueAt) : ''
        return {
          ...d,
          reviewDueAt: review ? d.reviewDueAt : null,
          targetOverdue: !!target && target < today,
          reviewOverdue: !!review && review < today,
          soonest: [target, review].filter(Boolean).sort()[0] ?? '',
        }
      })
      .filter(d => d.soonest)
      .sort((a, b) => a.soonest.localeCompare(b.soonest))
  }, [documents])

  // Documents with a date that has passed (either one).
  const overdueCount = useMemo(() => deadlines.filter(d => d.targetOverdue || d.reviewOverdue).length, [deadlines])

  // Team role breakdown — real counts from project.team.raci instead
  // of the hardcoded "3 writers · 2 stats · 3 reviewers" string.
  const teamBreakdown = useMemo(() => {
    if (!project) return ''
    const writers   = project.team.filter(m => m.raci === 'R').length
    const approvers = project.team.filter(m => m.raci === 'A').length
    const consulted = project.team.filter(m => m.raci === 'C').length
    const informed  = project.team.filter(m => m.raci === 'I').length
    return [
      writers   && t('page.project_dashboard.team_responsible',  { count: writers }),
      approvers && t('page.project_dashboard.team_accountable',  { count: approvers }),
      consulted && t('page.project_dashboard.team_consulted',    { count: consulted }),
      informed  && t('page.project_dashboard.team_informed',     { count: informed }),
    ].filter(Boolean).join(' · ')
  }, [project, t])

  // Days-to-data-cutoff — real relative value from project.dataCutoff.
  const daysToCutoff = useMemo(() => {
    if (!project?.dataCutoff) return { value: '—', sub: t('page.project_dashboard.cutoff_none'), complete: false }
    const diff = Math.ceil((new Date(project.dataCutoff).getTime() - Date.now()) / (24 * 60 * 60 * 1000))
    if (diff <= 0) {
      return { value: '0', sub: t('page.project_dashboard.cutoff_completed', { date: project.dataCutoff.slice(0, 10) }), complete: true }
    }
    return { value: String(diff), sub: t('page.project_dashboard.cutoff_at', { date: project.dataCutoff.slice(0, 10) }), complete: false }
  }, [project, t])

  // A project the API won't return (no access, or it doesn't exist) must not
  // read as "loading" forever.
  if (isError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <p className="text-sm text-slate-600">{t('page.project_dashboard.not_found')}</p>
        <Link to="/projects" className="text-sm font-semibold text-blue-600 hover:text-blue-700">{t('page.project_dashboard.back_to_projects')}</Link>
      </div>
    )
  }

  if (isLoading || !project) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="font-mono text-sm text-slate-400">{t('page.project_dashboard.loading')}</p>
      </div>
    )
  }

  const leadName = project.team.find(m => m.raci === 'R')?.name ?? project.team[0]?.name ?? '—'
  // Time summary (architecture §44.3): days elapsed since the project's start date.
  const startMs = project.startDate ? new Date(project.startDate).getTime() : NaN
  const daysSinceStart = Number.isNaN(startMs) ? null : Math.floor((Date.now() - startMs) / (24 * 60 * 60 * 1000))
  const startLabel = Number.isNaN(startMs) ? null : new Date(startMs).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  // Stored phases vary ("Phase III", "IIb", "Preclinical") — only add the "Phase" prefix when it's missing.
  const phaseLabel = /^phase\b|preclinical/i.test(project.phase) ? project.phase : t('page.project_dashboard.phase_prefix', { phase: project.phase })
  const activeSlugs = new Set(project.activeModules.map(k => MODULE_KEY_TO_SLUG[k as ModuleKey] ?? k))
  const availableModules = INACTIVE_MODULES.filter(m => !activeSlugs.has(m.key))

  return (
    <div className="flex h-full flex-col" data-screen="project-dashboard">

      {/* ============ Page Header ============ */}
      <div className="flex flex-col gap-3.5 border-b border-slate-200 bg-white px-8 pt-5 pb-[22px]">

        {/* Breadcrumb moved to TopNav (Projects / Project). */}

        {/* Title row + right actions */}
        <div className="flex items-start justify-between gap-6">

          {/* Title + meta */}
          <div className="flex flex-col gap-2.5">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight text-slate-900">{project.shortTitle}</h1>
              <span
                className="rounded-[5px] px-2.5 py-1 text-xs font-semibold"
                style={{ backgroundColor: '#F1F5F9', color: '#475569' }}
              >
                {project.therapeuticArea}
              </span>
              <ProjectStatusPill status={project.status} />
            </div>
            <div className="flex flex-wrap items-center gap-3.5 text-sm text-slate-500">
              {project.client && <><span>{project.client}</span><span className="text-slate-300">·</span></>}
              <span>{phaseLabel}{project.indication ? ` · ${project.indication}` : ''}</span>
              <span className="text-slate-300">·</span>
              <span>{t('page.project_dashboard.project_lead', { name: leadName })}</span>
              {daysSinceStart !== null && (
                <>
                  <span className="text-slate-300">·</span>
                  <span data-days-since-start>
                    {daysSinceStart >= 0
                      ? t('page.project_dashboard.started_days_ago', { date: startLabel, count: daysSinceStart })
                      : t('page.project_dashboard.starts_at', { date: startLabel })}
                  </span>
                </>
              )}
            </div>
          </div>

          {/* Right actions */}
          <div className="flex flex-none items-center gap-2.5">
            <div
              className="flex items-center gap-1.5 rounded-md px-3 py-2 text-xs font-semibold"
              style={{ backgroundColor: '#F1F5F9', color: '#475569' }}
            >
              <span className="h-1.5 w-1.5 flex-none rounded-full" style={{ backgroundColor: '#16A34A' }} />
              {stats.lastActivity
                ? t('page.project_dashboard.last_activity', { time: new Date(stats.lastActivity).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) })
                : t('page.project_dashboard.no_activity')}
            </div>
            {isPm && (
              <>
                <button
                  type="button"
                  onClick={() => setHistoryOpen(v => !v)}
                  aria-expanded={historyOpen}
                  className="rounded-md border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-900 transition-colors hover:bg-slate-50"
                  data-action="toggle-status-history"
                >
                  {t('component.project_status.history_title')}
                </button>
                <ProjectStatusMenu projectId={project.id} onPick={setStatusChange} />
              </>
            )}
            {(isProjectAuthor || isPm) && (
              <button
                type="button"
                onClick={() => navigate(`/projects/${encodeURIComponent(projectId ?? '')}/settings`)}
                title={t('page.project_dashboard.project_settings_tooltip')}
                className="rounded-md border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-900 hover:bg-slate-50 transition-colors"
                data-action="project-settings"
              >
                {t('page.project_dashboard.project_settings')}
              </button>
            )}
            {isAdmin && (
              <button
                type="button"
                onClick={() => navigate(`/admin/audit?projectId=${encodeURIComponent(projectId ?? '')}`)}
                title={t('page.project_dashboard.audit_trail_tooltip')}
                className="rounded-md border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-900 hover:bg-slate-50 transition-colors"
              >
                {t('page.project_dashboard.audit_trail')}
              </button>
            )}
          </div>

        </div>
      </div>

      {/* ============ Content ============ */}
      <div className="flex-1 overflow-auto px-8 py-6">
        <div className="flex flex-col gap-6">

          {isPm && historyOpen && (
            <section className="rounded-lg border border-slate-200 bg-white" data-section="status-history">
              <h2 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-900">{t('component.project_status.history_title')}</h2>
              <ProjectStatusHistory projectId={project.id} />
            </section>
          )}

          {isPm && <ProjectStatusSuggestion project={project} documents={documents} onPick={setStatusChange} />}

          {/* Success banner — only shown when data cutoff has passed */}
          {daysToCutoff.complete && (
            <div
              className="flex items-start gap-3 rounded-lg px-4 py-3.5"
              style={{ backgroundColor: '#F0FDF4', border: '1px solid #BBF7D0' }}
            >
              <div
                className="mt-px flex h-[18px] w-[18px] flex-none items-center justify-center rounded-full text-[11px] font-extrabold text-white"
                style={{ backgroundColor: '#16A34A' }}
              >
                ✓
              </div>
              <div className="flex-1 text-[13px] leading-relaxed text-slate-900">
                {hasTlfs
                  ? t('page.project_dashboard.cutoff_passed_with_tlfs', { date: project.dataCutoff?.slice(0, 10) ?? '' })
                  : t('page.project_dashboard.cutoff_passed', { date: project.dataCutoff?.slice(0, 10) ?? '' })}
              </div>
            </div>
          )}

          {/* KPI cards in a single row — real per-project values. Deadlines is the last card. */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            <KpiCard
              label={t('page.project_dashboard.kpi_docs_in_flight')}
              value={String(stats.inFlight)}
              sub={t('page.project_dashboard.kpi_docs_in_flight_sub', { review: stats.inReview, crm: stats.inCrm, sign: stats.awaitingSign })}
            />
            <KpiCard
              label={t('page.project_dashboard.kpi_completed_docs')}
              value={String(stats.signed)}
              sub={t('page.project_dashboard.kpi_completed_docs_sub', { signed: stats.signed, total: documents.length })}
            />
            <KpiCard
              label={t('page.project_dashboard.kpi_days_to_cutoff')}
              value={daysToCutoff.value}
              valueRight={daysToCutoff.complete
                ? <span className="text-xs font-semibold" style={{ color: '#15803D' }}>{t('page.project_dashboard.cutoff_complete_badge')}</span>
                : null}
              sub={daysToCutoff.sub}
            />
            <KpiCard
              label={t('page.project_dashboard.kpi_team_members')}
              value={String(teamCount)}
              sub={teamBreakdown || undefined}
            />
            <DeadlinesCard
              projectId={project.id}
              deadlines={deadlines}
              overdueCount={overdueCount}
              onOpenDocument={id => navigate(`/projects/${project.id}/clinical-writing/documents/${id}`)}
            />
          </div>

          {/* Active module cards. project.activeModules comes from the
              API as ModuleKey[] (letters like 'A'); the UI meta map +
              routes are slug-keyed, so translate once per iteration. */}
          {project.activeModules.map((rawKey) => {
            const slug: ModuleSlug | string = MODULE_KEY_TO_SLUG[rawKey as ModuleKey] ?? rawKey
            const meta = ACTIVE_MODULE_META[slug] ?? { label: slug, colour: '#2563EB', description: '' }
            return (
              <div
                key={slug}
                className="flex items-start gap-8 rounded-lg border border-slate-200 bg-white p-6"
                style={{ borderTop: `3px solid ${meta.colour}` }}
              >
                {/* Left: module heading + KV pairs + progress */}
                <div className="flex flex-1 flex-col gap-4">
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center gap-2.5">
                      <span className="h-2 w-2 flex-none rounded-full" style={{ backgroundColor: meta.colour }} />
                      <h2 className="text-xl font-bold tracking-tight" style={{ color: meta.colour }}>{meta.label}</h2>
                      <span
                        className="rounded-[5px] px-2.5 py-0.5 text-xs font-semibold"
                        style={{ backgroundColor: '#F0FDF4', color: '#15803D' }}
                      >
                        {t('page.project_dashboard.active_badge')}
                      </span>
                    </div>
                    <p className="text-sm leading-relaxed text-slate-500">{meta.description.replace('{project}', project.shortTitle)}</p>
                  </div>

                  <div className="flex gap-8">
                    <KV label={t('page.project_dashboard.kv_documents')}     value={t('page.project_dashboard.kv_documents_value', { active: stats.inFlight, completed: stats.signed })} />
                    <KV label={t('page.project_dashboard.kv_current_focus')} value={stats.current ? `${stats.current.title} · ${STATUS_META[stats.current.status]?.label ?? stats.current.status}` : t('page.project_dashboard.kv_no_active_doc')} />
                    <KV label={t('page.project_dashboard.kv_last_updated')}  value={stats.lastActivity ? new Date(stats.lastActivity).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'} />
                  </div>

                  {(() => {
                    const total = stats.inFlight + stats.signed
                    const pct   = total === 0 ? 0 : Math.round((stats.signed / total) * 100)
                    return (
                      <div className="flex flex-col gap-2">
                        <div className="flex justify-between text-xs text-slate-500">
                          <span className="font-semibold">{t('page.project_dashboard.documents_complete')}</span>
                          <span>{t('page.project_dashboard.documents_complete_pct', { pct, done: stats.signed, total })}</span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-[3px] bg-slate-200">
                          <div className="h-full transition-all" style={{ width: `${pct}%`, backgroundColor: meta.colour }} />
                        </div>
                      </div>
                    )
                  })()}
                </div>

                {/* Right column: open button + needs-attention panel */}
                <div className="flex w-[260px] flex-none flex-col gap-3">
                  <button
                    type="button"
                    onClick={() => navigate(`/projects/${project.id}/${slug}`)}
                    className="w-full rounded-md px-4 py-3 text-sm font-semibold text-white transition-colors hover:opacity-90"
                    style={{ backgroundColor: meta.colour }}
                  >
                    {t('page.project_dashboard.open_module', { module: meta.label })}
                  </button>
                  <div className="flex flex-col gap-2.5 rounded-lg border border-slate-200 bg-slate-50 p-3.5">
                    <p className="text-xs font-semibold text-slate-500">{t('page.project_dashboard.document_status')}</p>
                    {stats.notStarted > 0 && (
                      <div className="flex justify-between text-[13px]">
                        <span>{t('page.project_dashboard.doc_status_not_started')}</span>
                        <span className="font-semibold text-slate-500">{stats.notStarted}</span>
                      </div>
                    )}
                    {stats.inAuthoring > 0 && (
                      <div className="flex justify-between text-[13px]">
                        <span>{t('page.project_dashboard.doc_status_in_authoring')}</span>
                        <span className="font-semibold text-slate-700">{stats.inAuthoring}</span>
                      </div>
                    )}
                    {stats.inReview > 0 && (
                      <div className="flex justify-between text-[13px]">
                        <span>{t('page.project_dashboard.doc_status_in_review')}</span>
                        <span className="font-semibold" style={{ color: '#B45309' }}>{stats.inReview}</span>
                      </div>
                    )}
                    {stats.inCrm > 0 && (
                      <div className="flex justify-between text-[13px]">
                        <span>{t('page.project_dashboard.doc_status_in_crm')}</span>
                        <span className="font-semibold" style={{ color: '#7C3AED' }}>{stats.inCrm}</span>
                      </div>
                    )}
                    {stats.awaitingSign > 0 && (
                      <div className="flex justify-between text-[13px]">
                        <span>{t('page.project_dashboard.doc_status_awaiting_sig')}</span>
                        <span className="font-semibold" style={{ color: '#2563EB' }}>{stats.awaitingSign}</span>
                      </div>
                    )}
                    {stats.signed > 0 && (
                      <div className="flex justify-between text-[13px]">
                        <span>{t('page.project_dashboard.doc_status_signed')}</span>
                        <span className="font-semibold" style={{ color: '#15803D' }}>{stats.signed}</span>
                      </div>
                    )}
                    {documents.length === 0 && (
                      <p className="text-[12px] italic text-slate-400">{t('page.project_dashboard.no_documents_yet')}</p>
                    )}
                  </div>
                </div>
              </div>
            )
          })}

          {/* Available (inactive) modules — only those not already active on this project */}
          {availableModules.length > 0 && (
          <div className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between">
              <p className="text-xs font-semibold text-slate-500">{t('page.project_dashboard.available_modules')}</p>
              <button type="button" className="text-xs font-semibold text-blue-600 hover:text-blue-700">
                {t('page.project_dashboard.compare_scopes')}
              </button>
            </div>
            <div className="grid grid-cols-4 gap-4">
              {availableModules.map(m => (
                <div
                  key={m.key}
                  className="flex flex-col gap-3 rounded-lg border border-dashed border-slate-200 bg-white p-4.5 hover:border-slate-300 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 flex-none rounded-full" style={{ backgroundColor: m.colour, opacity: 0.45 }} />
                    <p className="text-sm font-semibold text-slate-500">{m.label}</p>
                  </div>
                  <p className="flex-1 text-xs leading-relaxed text-slate-500">{m.desc}</p>
                  <div className="mt-auto flex items-center justify-between">
                    <span className="text-xs text-slate-500">{t('page.project_dashboard.not_active')}</span>
                    <button type="button" className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 hover:border-slate-300 transition-colors">
                      + {t('page.project_dashboard.add_module')}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
          )}

          {/* Cost & Performance — measured from the project's AI call log (spend, tokens, speed, drafts
              accepted), plus real document counts. Nothing here is a benchmark or an estimate. */}
          {documents.length > 0 && (() => {
            const total = stats.inFlight + stats.signed
            const pct   = total === 0 ? 0 : Math.round((stats.signed / total) * 100)
            const u     = aiUsage
            const money = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: n < 1 ? 4 : 2 })}`
            const tokens = u ? (u.inputTokens + u.outputTokens).toLocaleString() : ''
            const none  = aiLoading ? '…' : '—'
            const rate  = u?.acceptanceRate != null ? Math.round(u.acceptanceRate * 100) : null
            return (
              <div className="flex flex-col gap-4">
                <div className="flex items-baseline justify-between">
                  <div className="flex flex-col gap-1">
                    <p className="font-mono text-[11px] font-medium uppercase tracking-widest text-slate-500">{t('page.project_dashboard.ai_section_label')}</p>
                    <h3 className="text-xl font-bold tracking-tight text-slate-900">{t('page.project_dashboard.ai_section_title')}</h3>
                    <p className="text-xs text-slate-500" data-ai-usage-note>
                      {aiFailed ? t('page.project_dashboard.ai_load_failed') : t('page.project_dashboard.ai_measured_note')}
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4 lg:grid-cols-4" data-ai-usage>
                  <KpiCard
                    label={t('page.project_dashboard.kpi_ai_spend')}
                    value={u ? money(u.costUsd) : none}
                    sub={u
                      ? t('page.project_dashboard.kpi_ai_spend_sub', {
                          calls: u.calls.toLocaleString(),
                          callsCount: u.calls,
                          tokens,
                          avg: u.calls > 0 ? ` · ${t('page.project_dashboard.kpi_ai_spend_avg', { secs: (u.avgLatencyMs / 1000).toFixed(1) })}` : '',
                        })
                      : undefined}
                  />
                  <div className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-[18px]">
                    <p className="text-xs font-semibold text-slate-500">{t('page.project_dashboard.kpi_drafts_accepted')}</p>
                    <p className="text-[28px] font-bold leading-none tracking-tight">
                      {u ? (u.draftsGenerated === 0 ? '—' : u.draftsAccepted) : none}
                      {u && u.draftsGenerated > 0 && <span className="text-base font-semibold text-slate-500"> {t('page.project_dashboard.of_total', { total: u.draftsGenerated })}</span>}
                    </p>
                    <div className="h-1.5 overflow-hidden rounded-[3px] bg-slate-200">
                      <div className="h-full transition-all" style={{ width: `${rate ?? 0}%`, backgroundColor: '#2563EB' }} />
                    </div>
                    <p className="text-xs text-slate-500">{u ? (rate == null ? t('page.project_dashboard.kpi_no_drafts_yet') : t('page.project_dashboard.kpi_accepted_pct', { pct: rate })) : ''}</p>
                  </div>
                  <KpiCard
                    label={t('page.project_dashboard.kpi_cost_per_doc')}
                    value={u && stats.signed > 0 ? money(u.costUsd / stats.signed) : none}
                    sub={stats.signed > 0 ? t('page.project_dashboard.kpi_cost_per_doc_sub', { count: stats.signed }) : t('page.project_dashboard.kpi_no_completed_docs')}
                  />
                  <div className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-[18px]">
                    <p className="text-xs font-semibold text-slate-500">{t('page.project_dashboard.kpi_docs_completed')}</p>
                    <p className="text-[28px] font-bold leading-none tracking-tight">
                      {stats.signed} <span className="text-base font-semibold text-slate-500">{t('page.project_dashboard.of_total', { total })}</span>
                    </p>
                    <div className="h-1.5 overflow-hidden rounded-[3px] bg-slate-200">
                      <div className="h-full transition-all" style={{ width: `${pct}%`, backgroundColor: '#16A34A' }} />
                    </div>
                  </div>
                </div>
              </div>
            )
          })()}

        </div>
      </div>

      {statusChange && (
        <ProjectStatusDialog project={project} to={statusChange} onClose={() => setStatusChange(null)} />
      )}
    </div>
  )
}

// --- Small sub-components ---

// Whole days from today to a date (negative = in the past). Both are yyyy-mm-dd, so there is no time-zone drift.
function daysFromToday(day: string): number {
  const [y, m, dd] = day.split('-').map(Number)
  const [ty, tm, td] = localToday().split('-').map(Number)
  return Math.round((Date.UTC(y!, m! - 1, dd!) - Date.UTC(ty!, tm! - 1, td!)) / 86_400_000)
}

function DeadlineCell({ label, iso, overdue, field, compact }: { label: string; iso: string | null | undefined; overdue: boolean; field: string; compact?: boolean }) {
  const { t } = useTranslation()
  const day = deadlineDay(iso)
  const diff = day ? daysFromToday(day) : null
  const note = diff === null ? null
    : diff < 0 ? { text: t('component.deadlines.days_overdue', { count: -diff, defaultValue_one: '{{count}} day overdue', defaultValue_other: '{{count}} days overdue' }), tone: 'text-red-700' }
    : diff === 0 ? { text: t('component.deadlines.due_today', { defaultValue: 'Due today' }), tone: 'text-amber-700' }
    : { text: t('component.deadlines.due_in', { count: diff, defaultValue_one: 'in {{count}} day', defaultValue_other: 'in {{count}} days' }), tone: diff <= 3 ? 'text-amber-700' : 'text-slate-500' }
  return (
    <span className={compact ? 'flex flex-col sm:flex-row sm:items-baseline sm:gap-2' : 'flex flex-col'} data-deadline-cell={field} data-overdue={overdue || undefined}>
      <span className={`text-[10px] font-semibold uppercase tracking-wider text-slate-400 ${compact ? '' : 'md:hidden'}`}>{label}</span>
      <span className={`text-[13px] ${overdue ? 'font-semibold text-red-700' : day ? 'font-medium text-slate-800' : 'text-slate-400'}`}>{fmtDeadline(iso)}</span>
      {note && <span className={`text-[11px] font-medium ${note.tone}`}>{note.text}</span>}
    </span>
  )
}

type DeadlineRow = Document & { targetOverdue: boolean; reviewOverdue: boolean; soonest: string }

// A Deadlines card for the row of KPI cards: how many are overdue, and the most urgent date. Clicking it
// opens the full list (every open document with a date, soonest first) just below the card.
function DeadlinesCard({ projectId, deadlines, overdueCount, onOpenDocument }: {
  projectId: string
  deadlines: DeadlineRow[]
  overdueCount: number
  onOpenDocument: (documentId: string) => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => { setOpen(false) }, [projectId])
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey) }
  }, [open])

  // The most urgent: the soonest date (overdue ones sort first).
  const top = deadlines[0]
  const topDay = top ? top.soonest : ''
  const topDiff = topDay ? daysFromToday(topDay) : null
  const topNote = topDiff === null ? ''
    : topDiff < 0 ? t('component.deadlines.days_overdue', { count: -topDiff, defaultValue_one: '{{count}} day overdue', defaultValue_other: '{{count}} days overdue' })
    : topDiff === 0 ? t('component.deadlines.due_today', { defaultValue: 'Due today' })
    : t('component.deadlines.due_in', { count: topDiff, defaultValue_one: 'in {{count}} day', defaultValue_other: 'in {{count}} days' })
  const late = overdueCount > 0

  return (
    <div ref={box} className="relative min-w-0">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        className={`flex h-full w-full min-w-0 flex-col gap-1.5 rounded-lg border bg-white px-4 py-3.5 text-left transition-colors hover:bg-slate-50 ${late ? 'border-red-200' : 'border-slate-200'}`}
        data-deadlines-card
      >
        <span className="flex items-center justify-between gap-2">
          <span className="truncate text-[11px] font-semibold uppercase tracking-wider text-slate-500">{t('component.deadlines.title')}</span>
          <span className={`text-slate-400 transition-transform ${open ? 'rotate-90' : ''}`} aria-hidden="true">›</span>
        </span>
        <span className="flex items-baseline gap-2">
          {deadlines.length === 0 ? (
            <span className="text-2xl font-bold leading-none tracking-tight text-slate-400">—</span>
          ) : late ? (
            <>
              <span className="text-2xl font-bold leading-none tracking-tight text-red-700" data-deadlines-overdue>{overdueCount}</span>
              <span className="text-xs font-semibold text-red-700">{t('component.deadlines.overdue')}</span>
            </>
          ) : (
            <span className="text-2xl font-bold leading-none tracking-tight text-emerald-700">{t('component.deadlines.on_track', { defaultValue: 'On track' })}</span>
          )}
        </span>
        <span className="line-clamp-2 text-[11px] leading-snug text-slate-500" data-deadlines-next>
          {top ? `${top.title} · ${topNote}` : t('component.deadlines.none_set', { defaultValue: 'No dates set' })}
        </span>
      </button>

      {open && deadlines.length > 0 && (
        <div className="absolute right-0 top-full z-30 mt-2 w-[min(560px,calc(100vw-2rem))] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg" data-section="deadlines">
          <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-2.5">
            <h2 className="text-[13px] font-semibold text-slate-900">{t('component.deadlines.title')}</h2>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600" data-deadlines-count>{deadlines.length}</span>
          </div>
          <div className="max-h-[320px] overflow-y-auto">
            {deadlines.map(d => {
              const meta = STATUS_META[d.status]
              return (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => onOpenDocument(d.id)}
                  className="relative grid w-full grid-cols-1 gap-y-1 border-b border-slate-100 px-4 py-2.5 text-left last:border-b-0 hover:bg-slate-50"
                  data-deadline-row={d.id}
                >
                  {(d.targetOverdue || d.reviewOverdue) && <span className="absolute inset-y-0 left-0 w-[3px] bg-red-500" aria-hidden="true" />}
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="min-w-0 truncate text-[13px] font-semibold text-slate-900">{d.title}</span>
                    <span
                      className="flex-none rounded-full px-2 py-0.5 text-[10px] font-semibold"
                      style={{ backgroundColor: meta?.bg ?? '#F1F5F9', color: meta?.fg ?? '#475569' }}
                    >{meta?.label ?? d.status}</span>
                  </span>
                  <span className="flex flex-wrap gap-x-5 gap-y-1">
                    <DeadlineCell compact label={t('component.deadlines.target')} iso={d.targetCompletionDate} overdue={d.targetOverdue} field="target" />
                    <DeadlineCell compact label={t('component.deadlines.review_due')} iso={d.reviewDueAt} overdue={d.reviewOverdue} field="review" />
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

interface KpiProps {
  label:      string
  value:      string
  sub?:       string
  valueRight?: React.ReactNode
}
function KpiCard({ label, value, sub, valueRight }: KpiProps) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 rounded-lg border border-slate-200 bg-white px-4 py-3.5">
      <p className="truncate text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
      <div className="flex items-baseline gap-2">
        <p className="text-2xl font-bold leading-none tracking-tight text-slate-900">{value}</p>
        {valueRight}
      </div>
      {sub && <p className="line-clamp-2 text-[11px] leading-snug text-slate-500">{sub}</p>}
    </div>
  )
}

interface KVProps { label: string; value: string }
function KV({ label, value }: KVProps) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs font-semibold text-slate-500">{label}</p>
      <p className="text-sm font-semibold">{value}</p>
    </div>
  )
}
