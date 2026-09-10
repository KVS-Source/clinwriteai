import { useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import type { IdeationProject } from '@platform/types'
import { IDEATION_STAGE_META } from '@platform/types'
import { ideationPublishingApi } from '../../modules/ideation-publishing/api/ideationPublishing'
import { useIdeationStore } from '../../modules/ideation-publishing/store'
import ideationCalendarFixture from '../../data/ideationCalendar.json'

const TA_META: Record<string, { bg: string; fg: string }> = {
  'Oncology':        { bg: '#F0FDFA', fg: '#0F766E' },
  'Cardiometabolic': { bg: '#EFF6FF', fg: '#1D4ED8' },
  'Neurology':       { bg: '#F5F3FF', fg: '#5B21B6' },
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${String(d.getUTCDate()).padStart(2, '0')} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

interface StatChipProps { value: number | string; label: string }
function StatChip({ value, label }: StatChipProps) {
  return (
    <div
      className="flex flex-col gap-1.5 rounded-lg border border-slate-200 bg-white"
      style={{ padding: '16px 20px', borderLeft: '3px solid #0D9488' }}
      data-stat-chip={label}
    >
      <p className="text-[28px] font-bold leading-none" style={{ color: '#0D9488' }}>{value}</p>
      <p className="font-mono text-[11px] font-medium uppercase tracking-widest text-slate-500">{label}</p>
    </div>
  )
}

interface StageDotsProps { stage: number; isBlocked: boolean; isApproved: boolean }
function StageDots({ stage, isBlocked, isApproved }: StageDotsProps) {
  return (
    <div className="flex items-center gap-1" data-stage-dots data-stage={stage}>
      {[1, 2, 3, 4].map(n => {
        let bg = '#E2E8F0'
        if (isBlocked && n === 1) bg = '#BE123C'
        else if (isApproved) bg = '#15803D'
        else if (n <= stage) bg = '#0D9488'
        return (
          <span
            key={n}
            className="inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: bg }}
            data-stage-dot={n}
          />
        )
      })}
    </div>
  )
}

interface ProjectCardProps { project: IdeationProject; onOpen: () => void }
function ProjectCard({ project: p, onOpen }: ProjectCardProps) {
  const isBlocked = p.sourceGateStatus === 'blocked'
  const isApproved = p.status === 'approved'

  const stageMeta = IDEATION_STAGE_META[p.status]
  const badgeMeta = isBlocked
    ? { label: 'Blocked', bg: '#FFF1F2', fg: '#BE123C', border: '#FDA4AF' }
    : { label: stageMeta.label, bg: stageMeta.bg, fg: stageMeta.fg, border: 'transparent' }

  const taMeta = TA_META[p.taTag] ?? { bg: '#F1F5F9', fg: '#475569' }

  return (
    <button
      type="button"
      onClick={onOpen}
      data-project-card={p.id}
      className="flex w-full items-start gap-4 rounded-lg border border-slate-200 bg-white p-5 text-left transition-shadow hover:border-slate-300"
      onMouseEnter={(e) => { e.currentTarget.style.boxShadow = '0 4px 12px rgba(15,23,42,0.08)' }}
      onMouseLeave={(e) => { e.currentTarget.style.boxShadow = 'none' }}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className="inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold"
            style={{ backgroundColor: badgeMeta.bg, color: badgeMeta.fg, border: `1px solid ${badgeMeta.border}` }}
            data-stage-badge={p.status}
          >{badgeMeta.label}</span>
          <span
            className="rounded-md px-1.5 py-0.5 text-[10px] font-mono font-semibold uppercase"
            style={{ backgroundColor: taMeta.bg, color: taMeta.fg, letterSpacing: '0.08em' }}
            data-ta-chip={p.taTag}
          >{p.taTag}</span>
          <StageDots stage={p.stage} isBlocked={isBlocked} isApproved={isApproved} />
          <span className="font-mono text-[10px] text-slate-500">Stage {p.stage} of 4</span>
        </div>
        <p className="text-[15px] font-bold text-slate-900">{p.title}</p>
        <p className="text-[13px] text-slate-600">{p.compound} · {p.indication}</p>
        <p className="font-mono text-[11px] text-slate-500">
          {p.projectId} · Created by {p.createdByName} ({p.createdByRole}) · Updated {formatDate(p.updatedAt)}
        </p>

        {/* Stage-specific body copy */}
        {isApproved && (
          <p className="text-[12px] text-slate-700" data-project-summary>
            {p.approvedCardCount} of {p.contentCardCount} cards approved · {p.publishedCount} published · {p.scheduledCount - p.publishedCount} scheduled
          </p>
        )}
        {p.status === 'under-review' && (
          <p className="text-[12px] text-slate-700" data-project-summary>
            {p.contentCardCount} cards · KOL review pending
          </p>
        )}

        <div className="mt-1 flex flex-wrap items-center gap-2">
          {isApproved && p.maApprovedByName && (
            <span
              className="inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold"
              style={{ backgroundColor: '#F0FDF4', color: '#166534' }}
              data-ma-stamp
            >
              MA approved · {p.maApprovedByName} ({p.maApprovedByRole ?? 'MA Team Lead'}) · {formatDate(p.maApprovedAt)}
            </span>
          )}
          {isBlocked && p.sourceGateReason && (
            <span
              className="inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold"
              style={{ backgroundColor: '#FFF1F2', color: '#BE123C', border: '1px solid #FDA4AF' }}
              data-block-reason
            >
              Source gate failed — document 'In Authoring' in Module A
            </span>
          )}
        </div>
      </div>
    </button>
  )
}

export function IdeationPublishingHome() {
  const { projectId } = useParams()
  const navigate      = useNavigate()

  const projects    = useIdeationStore(s => s.projects)
  const setProjects = useIdeationStore(s => s.setProjects)

  const { data: fetched = [] } = useQuery({
    queryKey: ['ideation-projects', projectId],
    queryFn:  () => ideationPublishingApi.listProjects(projectId!),
    enabled:  !!projectId,
  })
  useEffect(() => { setProjects(fetched as IdeationProject[]) }, [fetched, setProjects])

  const metrics = useMemo(() => {
    const active   = projects.filter(p => p.status !== 'uploaded' && p.sourceGateStatus !== 'blocked').length
    const approved = projects.reduce((n, p) => n + (p.approvedCardCount ?? 0), 0)
    const publishedThisMonth = (ideationCalendarFixture as { status: string }[]).filter(e => e.status === 'published').length
    const pendingMA = projects.filter(p => p.status === 'reviewed').length
    return { active, approved, publishedThisMonth, pendingMA }
  }, [projects])

  const openProject = (p: IdeationProject) =>
    navigate(`/projects/${projectId}/ideation-publishing/projects/${p.id}`)
  const openNew = () =>
    navigate(`/projects/${projectId}/ideation-publishing/projects/new`)
  const openCalendar = () =>
    navigate(`/projects/${projectId}/ideation-publishing/calendar`)
  const openPublishing = () =>
    navigate(`/projects/${projectId}/ideation-publishing/publishing`)

  return (
    <div className="bg-slate-50" data-screen="ideation-publishing-home">
      <div className="mx-auto flex flex-col gap-5" style={{ maxWidth: 1280, padding: '20px 32px 48px' }}>

        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-xs text-slate-500">
          <button onClick={() => navigate('/projects')} className="hover:text-slate-900">All projects</button>
          <span style={{ color: '#CBD5E1' }}>&gt;</span>
          <button onClick={() => navigate(`/projects/${projectId}`)} className="hover:text-slate-900">VELORA-301</button>
          <span style={{ color: '#CBD5E1' }}>&gt;</span>
          <span className="font-semibold text-slate-900">Ideation &amp; Publishing</span>
        </nav>

        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="flex min-w-0 flex-col gap-1.5">
            <h1 className="text-[22px] font-bold text-slate-900" style={{ margin: 0 }}>Ideation &amp; Publishing</h1>
            <p className="font-mono text-xs" style={{ color: '#64748B' }}>
              Content repurposing & channel calendar · Sourced from Master Library (Modules A/B/C/D)
            </p>
          </div>
          <div className="flex flex-none gap-2">
            <button
              type="button"
              onClick={openCalendar}
              data-open-calendar
              className="h-9 rounded-md border border-slate-300 bg-white px-3 text-[13px] font-semibold text-slate-700 hover:bg-slate-50"
            >Content Calendar</button>
            <button
              type="button"
              onClick={openPublishing}
              data-open-publishing
              className="h-9 rounded-md border border-slate-300 bg-white px-3 text-[13px] font-semibold text-slate-700 hover:bg-slate-50"
            >Publishing Monitor</button>
            <button
              type="button"
              onClick={openNew}
              data-new-ideation-project
              className="h-9 rounded-md px-3 text-[13px] font-semibold text-white"
              style={{ backgroundColor: '#0D9488' }}
            >+ New Ideation Project</button>
          </div>
        </div>

        {/* Metrics strip */}
        <div
          className="grid gap-4"
          style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}
          data-metrics-strip
        >
          <StatChip value={metrics.active}             label="Active projects" />
          <StatChip value={metrics.approved}           label="Approved content cards" />
          <StatChip value={metrics.publishedThisMonth} label="Published this month" />
          <StatChip value={metrics.pendingMA}          label="Pending MA approval" />
        </div>

        {/* Project card list */}
        <div className="flex flex-col gap-3" data-project-list>
          {projects.map(p => (
            <ProjectCard key={p.id} project={p} onOpen={() => openProject(p)} />
          ))}
          {projects.length === 0 && (
            <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-[13px] text-slate-500">
              No ideation projects yet.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
