import { useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { projectsApi } from '../../api'
import { ProjectStatusPill } from '../../components/ui'
import { useProjectStore } from '../../store'

// --- Static module metadata for the "Available modules" grid ---
const INACTIVE_MODULES = [
  { key: 'scientific-writing',  label: 'Scientific Writing',    letter: 'B', colour: '#0D9488', desc: 'Manuscripts, abstracts, congress materials.' },
  { key: 'medical-writing',     label: 'Medical Writing',       letter: 'C', colour: '#7C3AED', desc: 'Medical information, MSL and payer content.' },
  { key: 'regulatory-writing',  label: 'Regulatory Writing',    letter: 'D', colour: '#D97706', desc: 'Briefing books, responses, submission modules.' },
  { key: 'ideation',            label: 'Ideation & Publishing', letter: 'E', colour: '#E11D48', desc: 'Publication planning and channel output.' },
] as const

// --- Active-module labels/colours (for iterating project.activeModules) ---
const ACTIVE_MODULE_META: Record<string, { label: string; colour: string; description: string }> = {
  'clinical-writing': {
    label: 'Clinical Writing',
    colour: '#2563EB',
    description: 'Clinical study report authoring, TLF integration and QC cycle for VELORA-301.',
  },
  'scientific-writing': { label: 'Scientific Writing', colour: '#0D9488', description: 'Manuscripts, abstracts, congress materials.' },
  'medical-writing':    { label: 'Medical Writing',    colour: '#7C3AED', description: 'Medical information, MSL and payer content.' },
  'regulatory-writing': { label: 'Regulatory Writing', colour: '#D97706', description: 'Briefing books, responses, submission modules.' },
  'ideation':           { label: 'Ideation & Publishing', colour: '#E11D48', description: 'Publication planning and channel output.' },
}

export function ProjectDashboard() {
  const { projectId }    = useParams()
  const navigate         = useNavigate()
  const setActiveProject = useProjectStore(s => s.setActiveProject)

  const { data: project, isLoading } = useQuery({
    queryKey: ['project', projectId],
    queryFn:  () => projectsApi.get(projectId!),
    enabled:  !!projectId,
  })

  useEffect(() => {
    if (project) setActiveProject(project)
  }, [project, setActiveProject])

  if (isLoading || !project) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="font-mono text-sm text-slate-400">Loading project…</p>
      </div>
    )
  }

  const leadName = project.team.find(t => t.raci === 'R')?.name ?? project.team[0]?.name ?? '—'

  return (
    <div className="flex h-full flex-col">

      {/* ============ Page Header ============ */}
      <div className="flex flex-col gap-3.5 border-b border-slate-200 bg-white px-8 pt-5 pb-[22px]">

        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <button onClick={() => navigate('/projects')} className="hover:text-slate-900 transition-colors">
            All Projects
          </button>
          <span className="text-slate-300">›</span>
          <span className="font-semibold text-slate-900">{project.shortTitle}</span>
        </div>

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
              <span>{project.client}</span>
              <span className="text-slate-300">·</span>
              <span>Phase {project.phase} · NSCLC</span>
              <span className="text-slate-300">·</span>
              <span>Project lead {leadName}</span>
            </div>
          </div>

          {/* Right actions */}
          <div className="flex flex-none items-center gap-2.5">
            <div
              className="flex items-center gap-1.5 rounded-md px-3 py-2 text-xs font-semibold"
              style={{ backgroundColor: '#F1F5F9', color: '#475569' }}
            >
              <span className="h-1.5 w-1.5 flex-none rounded-full" style={{ backgroundColor: '#16A34A' }} />
              All changes autosaved 09:12 UTC
            </div>
            <button
              type="button"
              className="rounded-md border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-900 hover:bg-slate-50 transition-colors"
            >
              Project settings
            </button>
            <button
              type="button"
              className="rounded-md border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-900 hover:bg-slate-50 transition-colors"
            >
              Audit trail
            </button>
          </div>

        </div>
      </div>

      {/* ============ Content ============ */}
      <div className="flex-1 overflow-auto px-8 py-6">
        <div className="flex flex-col gap-6">

          {/* Success banner — DB lock confirmed */}
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
              Database lock confirmed {project.dataCutoff ?? '22 Oct 2024'}. Final TLFs are available in the Master Library — CSR sections 9–14 are unblocked for authoring.
            </div>
            <button type="button" className="whitespace-nowrap text-[13px] font-semibold text-blue-600 hover:text-blue-700">
              View TLF set
            </button>
          </div>

          {/* 4 KPI cards */}
          <div className="grid grid-cols-4 gap-4">
            <KpiCard label="Documents In Flight" value="8" sub="2 in QC review · 1 awaiting sign-off" />
            <KpiCard label="Open Comments" value="3" valueRight={<span className="text-xs font-semibold" style={{ color: '#B45309' }}>1 overdue</span>} sub="Oldest raised 6 days ago" />
            <KpiCard label="Days to Data Cut-off" value="0" valueRight={<span className="text-xs font-semibold" style={{ color: '#15803D' }}>Complete</span>} sub={`Data cut completed ${project.dataCutoff ?? '22 Oct 2024'}`} />
            <KpiCard label="Team Members" value={String(project.team.length)} sub="3 writers · 2 stats · 3 reviewers" />
          </div>

          {/* Active module cards (one per project.activeModules) */}
          {project.activeModules.map(moduleKey => {
            const meta = ACTIVE_MODULE_META[moduleKey] ?? { label: moduleKey, colour: '#2563EB', description: '' }
            return (
              <div
                key={moduleKey}
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
                        Active
                      </span>
                    </div>
                    <p className="text-sm leading-relaxed text-slate-500">{meta.description}</p>
                  </div>

                  <div className="flex gap-8">
                    <KV label="Documents"      value="8 active · 2 completed" />
                    <KV label="Current stage"  value="CSR Section 11 — Efficacy · in medical review" />
                    <KV label="Next milestone" value="Draft 2 circulation · 18 Nov 2024" />
                  </div>

                  <div className="flex flex-col gap-2">
                    <div className="flex justify-between text-xs text-slate-500">
                      <span className="font-semibold">Module progress</span>
                      <span>62%</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-[3px] bg-slate-200">
                      <div className="h-full" style={{ width: '62%', backgroundColor: meta.colour }} />
                    </div>
                  </div>
                </div>

                {/* Right column: open button + needs-attention panel */}
                <div className="flex w-[260px] flex-none flex-col gap-3">
                  <button
                    type="button"
                    onClick={() => navigate(`/projects/${project.id}/${moduleKey}`)}
                    className="w-full rounded-md px-4 py-3 text-sm font-semibold text-white transition-colors hover:opacity-90"
                    style={{ backgroundColor: meta.colour }}
                  >
                    Open {meta.label}
                  </button>
                  <div className="flex flex-col gap-2.5 rounded-lg border border-slate-200 bg-slate-50 p-3.5">
                    <p className="text-xs font-semibold text-slate-500">Needs your attention</p>
                    <div className="flex justify-between text-[13px]">
                      <span>CSR Sec. 11 review</span>
                      <span className="font-semibold" style={{ color: '#B45309' }}>Overdue</span>
                    </div>
                    <div className="flex justify-between text-[13px]">
                      <span>Sec. 14 TLF reconciliation</span>
                      <span className="text-slate-500">Due Fri</span>
                    </div>
                  </div>
                </div>
              </div>
            )
          })}

          {/* Available (inactive) modules */}
          <div className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between">
              <p className="text-xs font-semibold text-slate-500">Available modules</p>
              <button type="button" className="text-xs font-semibold text-blue-600 hover:text-blue-700">
                Compare module scopes
              </button>
            </div>
            <div className="grid grid-cols-4 gap-4">
              {INACTIVE_MODULES.map(m => (
                <div
                  key={m.key}
                  className="flex flex-col gap-3 rounded-lg border border-dashed border-slate-200 bg-white p-4.5 hover:border-slate-300 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 flex-none rounded-full" style={{ backgroundColor: m.colour, opacity: 0.45 }} />
                    <p className="text-sm font-semibold text-slate-500">{m.label}</p>
                    <span className="font-mono text-[10px] tracking-wider text-slate-300">{m.letter}</span>
                  </div>
                  <p className="flex-1 text-xs leading-relaxed text-slate-500">{m.desc}</p>
                  <div className="mt-auto flex items-center justify-between">
                    <span className="text-xs text-slate-500">Not Active</span>
                    <button type="button" className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 hover:border-slate-300 transition-colors">
                      + Add Module
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Cost & Performance */}
          <div className="flex flex-col gap-4">
            <div className="flex items-baseline justify-between">
              <div className="flex flex-col gap-1">
                <p className="font-mono text-[11px] font-medium uppercase tracking-widest text-slate-500">Cost &amp; Performance</p>
                <h3 className="text-xl font-bold tracking-tight text-slate-900">Clinical Writing Performance</h3>
                <p className="text-xs text-slate-500">vs. manual benchmark</p>
              </div>
              <button type="button" className="text-xs font-semibold text-blue-600 hover:text-blue-700">
                Export report
              </button>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <KpiCard label="Hours Saved"        value="142 hrs" sub="Across 10 documents this quarter" />
              <KpiCard label="Estimated Value"    value="$28,400" sub="At blended writer rate $200/hr" />
              <div className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-[18px]">
                <p className="text-xs font-semibold text-slate-500">Documents Completed</p>
                <p className="text-[28px] font-bold leading-none tracking-tight">
                  2 <span className="text-base font-semibold text-slate-500">of 8</span>
                </p>
                <div className="h-1.5 overflow-hidden rounded-[3px] bg-slate-200">
                  <div className="h-full w-1/4" style={{ backgroundColor: '#16A34A' }} />
                </div>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}

// --- Small sub-components ---

interface KpiProps {
  label:      string
  value:      string
  sub?:       string
  valueRight?: React.ReactNode
}
function KpiCard({ label, value, sub, valueRight }: KpiProps) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-[18px]">
      <p className="text-xs font-semibold text-slate-500">{label}</p>
      <div className="flex items-baseline gap-2.5">
        <p className="text-[28px] font-bold leading-none tracking-tight text-slate-900">{value}</p>
        {valueRight}
      </div>
      {sub && <p className="text-xs text-slate-500">{sub}</p>}
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
