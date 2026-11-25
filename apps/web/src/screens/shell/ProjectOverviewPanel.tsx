// Quick-view Project Overview — the right-side panel that replaces the
// row-click navigation on the Projects list. Shows the header metadata,
// the 5 KPI cards, and a compact Cost & Performance block, so writers
// can size up a project without leaving the list.
//
// "Available modules" is deliberately absent — those are already rendered
// as per-row DocumentCountChips on the list, keeping this panel focused.
// For everything the panel doesn't carry (module cards, status history,
// deep status controls) the "Open full dashboard →" link navigates to
// the existing /projects/:id page.

import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import type { Document, Project } from '@platform/types'
import { SlidePanel, ProjectStatusPill } from '../../components/ui'
import { documentsApi, projectsApi, reportsApi } from '../../api'
import {
  MODULE_COLOURS,
  MODULE_KEY_TO_SLUG,
  MODULE_LABELS,
  type ModuleKey,
  type ModuleSlug,
} from '../../config/modules'

interface Props {
  open:     boolean
  onClose:  () => void
  project:  Project | null
}

// Map a module slug onto the corresponding Project.documentCountByModule
// camelCase key so the overview panel can read the count the server sent
// without duplicating the per-module list.
const COUNT_KEY_FOR_SLUG: Record<ModuleSlug, keyof NonNullable<Project['documentCountByModule']>> = {
  'clinical-writing':    'clinicalWriting',
  'scientific-writing':  'scientificWriting',
  'medical-writing':     'medicalWriting',
  'regulatory-writing':  'regulatoryWriting',
  'ideation-publishing': 'ideationPublishing',
}

function moduleDocCount(project: Project, slug: ModuleSlug): number {
  return project.documentCountByModule?.[COUNT_KEY_FOR_SLUG[slug]] ?? 0
}

export function ProjectOverviewPanel({ open, onClose, project }: Props) {
  const navigate = useNavigate()
  const projectId = project?.id ?? null

  const { data: documents = [] } = useQuery<Document[]>({
    queryKey: ['documents', projectId],
    queryFn:  () => documentsApi.list(projectId!),
    enabled:  !!projectId,
  })

  const { data: people } = useQuery({
    queryKey: ['project-people-count', projectId],
    queryFn:  () => projectsApi.people(projectId!),
    enabled:  !!projectId,
    retry: false,
  })
  const teamCount = people?.count ?? project?.team.length ?? 0

  const { data: aiUsage } = useQuery({
    queryKey: ['project-ai-usage', projectId],
    queryFn:  () => reportsApi.projectAiUsage(projectId!),
    enabled:  !!projectId,
    retry: false,
  })

  const stats = useMemo(() => {
    const inFlight     = documents.filter(d => d.status !== 'signed').length
    const inReview     = documents.filter(d => d.status === 'in-review').length
    const awaitingSign = documents.filter(d => d.status === 'pending-signature').length
    const signed       = documents.filter(d => d.status === 'signed').length
    const inCrm        = documents.filter(d => d.status === 'crm-in-progress').length
    const lastActivity = documents.reduce<string | null>(
      (max, d) => (d.updatedAt && (!max || d.updatedAt > max) ? d.updatedAt : max), null)
    return { inFlight, inReview, awaitingSign, signed, inCrm, lastActivity }
  }, [documents])

  const daysToCutoff = useMemo(() => {
    if (!project?.dataCutoff) return { value: '—', sub: 'No data-cut date set', complete: false }
    const diff = Math.ceil((new Date(project.dataCutoff).getTime() - Date.now()) / (24 * 60 * 60 * 1000))
    if (diff < 0) return { value: `${-diff}`, sub: `${-diff} days past cutoff`, complete: true }
    if (diff === 0) return { value: '0', sub: 'Data cutoff today', complete: false }
    return { value: `${diff}`, sub: `${diff} days remaining`, complete: false }
  }, [project])

  const deadlines = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10)
    return documents
      .filter(d => d.status !== 'signed' && (d.targetCompletionDate || d.reviewDueAt))
      .map(d => ({
        ...d,
        targetOverdue: !!d.targetCompletionDate && d.targetCompletionDate.slice(0, 10) < today,
        reviewOverdue: !!d.reviewDueAt            && d.reviewDueAt.slice(0, 10) < today && d.status === 'in-review',
      }))
  }, [documents])
  const overdueCount = deadlines.filter(d => d.targetOverdue || d.reviewOverdue).length

  if (!project || !projectId) return null

  const leadName  = project.team.find(m => m.raci === 'R')?.name ?? project.team[0]?.name ?? '—'
  const phaseLbl  = /^phase\b|preclinical/i.test(project.phase) ? project.phase : `Phase ${project.phase}`
  const startIso  = project.startDate ?? ''
  const daysSince = startIso ? Math.floor((Date.now() - new Date(startIso).getTime()) / 86_400_000) : null

  return (
    <SlidePanel
      open={open}
      onClose={onClose}
      eyebrow="Project overview"
      title={project.shortTitle}
      storageKey="project-overview-panel-width"
      defaultWidth={640}
      minWidth={480}
      maxWidth={960}
      expandable
      belowTopBar
    >
      <div className="flex flex-col gap-4 bg-slate-50 p-5" data-screen="project-overview-panel">
        {/* Metadata header — mirrors the full dashboard but compact */}
        <section className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-center gap-2">
            {project.therapeuticArea && (
              <span className="rounded-[5px] px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: '#F1F5F9', color: '#475569' }}>
                {project.therapeuticArea}
              </span>
            )}
            <ProjectStatusPill status={project.status} />
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-slate-500">
            {project.client && <span>{project.client}</span>}
            <span>{phaseLbl}{project.indication ? ` · ${project.indication}` : ''}</span>
            <span>Lead: {leadName}</span>
            {daysSince !== null && (
              <span>
                Started {new Date(startIso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                {daysSince >= 0 ? ` · ${daysSince} days ago` : ''}
              </span>
            )}
          </div>
          {stats.lastActivity && (
            <p className="mt-1 flex items-center gap-1.5 text-[11px] font-medium text-slate-500">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Last activity {new Date(stats.lastActivity).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
            </p>
          )}
        </section>

        {/* 5 KPI cards — 2-col grid at panel width */}
        <section className="grid grid-cols-2 gap-3">
          <Kpi label="Documents in flight" value={String(stats.inFlight)}
            sub={`${stats.inReview} in review · ${stats.inCrm} in CRM · ${stats.awaitingSign} awaiting signature`} />
          <Kpi label="Completed documents" value={String(stats.signed)}
            sub={`${stats.signed} signed of ${documents.length}`} />
          <Kpi label="Days to cut-off" value={daysToCutoff.value} sub={daysToCutoff.sub} />
          <Kpi label="Team members" value={String(teamCount)} />
          <Kpi
            label="Deadlines"
            value={overdueCount > 0 ? `${overdueCount}` : '—'}
            valueColour={overdueCount > 0 ? '#B91C1C' : undefined}
            sub={overdueCount > 0
              ? `${overdueCount} overdue document${overdueCount === 1 ? '' : 's'}`
              : deadlines.length > 0 ? `${deadlines.length} upcoming` : 'None set'}
          />
        </section>

        {/* Cost & Performance — the AI spend summary from the full dashboard */}
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Cost &amp; Performance</p>
          <h3 className="mt-0.5 text-[14px] font-bold text-slate-900">AI usage for this project</h3>
          <p className="mt-0.5 text-[11px] text-slate-500">All figures measured from this project&rsquo;s AI call log.</p>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <Kpi label="AI spend"
              value={aiUsage ? `$${aiUsage.costUsd.toFixed(4)}` : '—'}
              sub={aiUsage ? `${aiUsage.calls} call${aiUsage.calls === 1 ? '' : 's'} · ${(aiUsage.inputTokens + aiUsage.outputTokens).toLocaleString()} tokens` : undefined} />
            <Kpi label="Drafts accepted"
              value={aiUsage ? `${aiUsage.draftsAccepted} of ${aiUsage.draftsGenerated}` : '—'}
              sub={aiUsage?.acceptanceRate != null ? `${Math.round(aiUsage.acceptanceRate * 100)}% acceptance` : undefined} />
          </div>
        </section>

        {/* Active modules — "Open Clinical Writing →" and friends.
            Each row carries the doc count for that module so customers
            see what they're licensed for AND how much work is in each
            one. Zero-count rows render muted but stay clickable so a
            fresh project can jump straight into any enabled module. */}
        {project.activeModules.length > 0 && (
          <section className="rounded-lg border border-slate-200 bg-white p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Modules</p>
            <div className="mt-2 flex flex-col gap-1.5">
              {project.activeModules.map(rawKey => {
                const slug: ModuleSlug = (MODULE_KEY_TO_SLUG[rawKey as ModuleKey] ?? rawKey) as ModuleSlug
                const label  = MODULE_LABELS[slug] ?? slug
                const colour = MODULE_COLOURS[slug] ?? '#2563EB'
                const count  = moduleDocCount(project, slug)
                const isZero = count === 0
                return (
                  <button
                    key={slug}
                    type="button"
                    onClick={() => { onClose(); navigate(`/projects/${project.id}/${slug}`) }}
                    className="flex items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-left text-[13px] hover:bg-slate-50"
                    data-module-open={slug}
                    data-module-count={count}
                  >
                    <span className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: colour }} />
                      <span className="font-semibold" style={{ color: colour }}>{label}</span>
                    </span>
                    <span className="flex items-center gap-2">
                      <span
                        className="inline-flex min-w-[24px] justify-center rounded-md px-1.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums"
                        style={
                          isZero
                            ? { backgroundColor: '#F1F5F9', color: '#94A3B8' }
                            : { backgroundColor: `${colour}14`, color: colour }
                        }
                      >
                        {count}
                      </span>
                      <span className="text-slate-400">Open →</span>
                    </span>
                  </button>
                )
              })}
            </div>
          </section>
        )}
      </div>
    </SlidePanel>
  )
}

interface KpiProps { label: string; value: string; sub?: string; valueColour?: string }
function Kpi({ label, value, sub, valueColour }: KpiProps) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-lg border border-slate-200 bg-white px-3 py-2.5">
      <p className="truncate text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
      <p className="text-xl font-bold leading-tight tracking-tight" style={{ color: valueColour ?? '#0F172A' }}>{value}</p>
      {sub && <p className="line-clamp-2 text-[10px] leading-snug text-slate-500">{sub}</p>}
    </div>
  )
}
