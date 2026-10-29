// Project Settings — thin v1.
//
// Scope: shows the project's metadata + team, read-only. Edit controls land
// in a follow-up. Access is gated to the project's Lead (team member with
// RACI='A' Accountable, matching the current user) — admins deliberately
// don't see this screen, their domain is tenant admin / audit / users.
// A non-lead who deep-links to the URL is bounced back to the project
// dashboard.

import { useEffect, useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import type { RACIRole } from '@platform/types'
import { projectsApi } from '../../api'
import { usePlatformStore } from '../../platform/store'

const RACI_LABEL: Record<RACIRole, string> = {
  R: 'Responsible',
  A: 'Accountable',
  C: 'Consulted',
  I: 'Informed',
}

const RACI_COLOUR: Record<RACIRole, { bg: string; fg: string }> = {
  R: { bg: '#DBEAFE', fg: '#1D4ED8' },
  A: { bg: '#FEF3C7', fg: '#B45309' },
  C: { bg: '#E0E7FF', fg: '#4338CA' },
  I: { bg: '#F1F5F9', fg: '#475569' },
}

const STATUS_LABEL: Record<string, string> = {
  initiated: 'Initiated',
  ongoing:   'Ongoing',
  'on-hold': 'On hold',
  're-open': 'Re-opened',
  closed:    'Closed',
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function ProjectSettings() {
  const { projectId } = useParams()
  const navigate = useNavigate()
  const currentUser = usePlatformStore(s => s.currentUser)

  const { data: project, isLoading, isError } = useQuery({
    queryKey: ['project', projectId],
    queryFn:  () => projectsApi.get(projectId!),
    enabled:  !!projectId,
  })

  // Lead-only access — a non-lead landing on this URL (deep link or stale
  // tab) gets bounced to the project dashboard, not /home, so they stay
  // oriented. The redirect runs post-load so the project data is available
  // to check team membership.
  const isLead = useMemo(
    () => Boolean(project?.team.some(t => t.raci === 'A' && t.userId === currentUser.id)),
    [project, currentUser.id],
  )
  useEffect(() => {
    if (project && !isLead) navigate(`/projects/${projectId}`, { replace: true })
  }, [project, isLead, projectId, navigate])

  if (isLoading) {
    return (
      <div className="p-8 text-sm text-slate-500">Loading project settings…</div>
    )
  }
  if (isError || !project) {
    return (
      <div className="p-8 text-sm text-red-700" role="alert">Could not load the project.</div>
    )
  }
  // Guard the first-render pass before the redirect effect fires.
  if (!isLead) return null

  return (
    <div className="flex h-full flex-col overflow-auto bg-slate-50" data-screen="project-settings">
      <div className="flex flex-col gap-4 px-8 py-6" style={{ maxWidth: 1024 }}>
        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-xs text-slate-500" aria-label="Breadcrumb">
          <button onClick={() => navigate('/projects')} className="hover:text-slate-900 transition-colors">
            All Projects
          </button>
          <span className="text-slate-300">›</span>
          <button onClick={() => navigate(`/projects/${projectId}`)} className="hover:text-slate-900 transition-colors">
            {project.shortTitle}
          </button>
          <span className="text-slate-300">›</span>
          <span className="font-semibold text-slate-900">Settings</span>
        </nav>

        {/* Immutability notice — read-only in v1 so no accidental edits. */}
        <p className="rounded-md border border-slate-200 bg-white px-3 py-2 text-[12px] text-slate-500" data-section="readonly-notice">
          Read-only view (thin v1). Edit controls land in a follow-up —
          contact the tenant Admin to change project metadata or team today.
        </p>

        {/* Metadata */}
        <section className="rounded-lg border border-slate-200 bg-white" data-section="metadata">
          <h2 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-900">
            Project metadata
          </h2>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 px-4 py-4 text-[13px]">
            <MetaRow label="Short title"           value={project.shortTitle} />
            <MetaRow label="Full name"             value={project.name} />
            <MetaRow label="Client"                value={project.client} />
            <MetaRow label="Status"                value={STATUS_LABEL[project.status] ?? project.status} />
            <MetaRow label="Phase"                 value={project.phase} />
            <MetaRow label="Therapeutic area"      value={project.therapeuticArea} />
            <MetaRow label="Indication"            value={project.indication ?? '—'} />
            <MetaRow label="Start date"            value={fmtDate(project.startDate)} />
            <MetaRow label="Data cutoff"           value={fmtDate(project.dataCutoff)} />
            <MetaRow label="Reference trial"       value={project.referenceTrial ?? '—'} />
            <MetaRow label="Modules enabled"
                     value={project.activeModules.length > 0 ? project.activeModules.join(', ') : '—'} />
            <MetaRow label="Submission countries"
                     value={project.submissionCountries.length > 0 ? project.submissionCountries.join(', ') : '—'} />
          </dl>
        </section>

        {/* Team */}
        <section className="rounded-lg border border-slate-200 bg-white" data-section="team">
          <h2 className="flex items-baseline justify-between border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-900">
            <span>Team · {project.team.length} member{project.team.length === 1 ? '' : 's'}</span>
            <span className="text-[11px] font-normal text-slate-500">RACI letter owns per-document completion. See roles-and-permissions doc.</span>
          </h2>
          {project.team.length === 0 ? (
            <p className="px-4 py-4 text-[13px] text-slate-500">No team members yet.</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {project.team.map(member => {
                const colour = RACI_COLOUR[member.raci]
                return (
                  <div
                    key={member.userId}
                    className="flex items-center gap-3 px-4 py-2.5"
                    data-team-member={member.userId}
                  >
                    <div
                      className="flex h-7 w-7 flex-none items-center justify-center rounded-full font-mono text-[10px] font-bold"
                      style={{ backgroundColor: '#F1F5F9', color: '#475569' }}
                    >
                      {member.initials}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-semibold text-slate-900">{member.name}</p>
                      <p className="truncate text-[11px] text-slate-500">{member.role}</p>
                    </div>
                    <span
                      className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide"
                      style={{ backgroundColor: colour.bg, color: colour.fg }}
                      title={`${RACI_LABEL[member.raci]} (${member.raci})`}
                    >
                      {member.raci}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-slate-900">{value}</dd>
    </div>
  )
}
