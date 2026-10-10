import { useEffect, useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import type { Document } from '@platform/types'
import { documentsApi, projectsApi } from '../../api'
import { ProjectStatusPill } from '../../components/ui'
import { useProjectStore } from '../../store'
import { MODULE_KEY_TO_SLUG, type ModuleKey, type ModuleSlug } from '../../config/modules'

// --- Static module metadata for the "Available modules" grid ---
const INACTIVE_MODULES = [
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
    description: 'Clinical study report authoring, TLF integration and QC cycle for VELORA-301.',
  },
  'scientific-writing':  { label: 'Scientific Writing',    colour: '#0D9488', description: 'Manuscripts, abstracts, congress materials.' },
  'medical-writing':     { label: 'Medical Writing',       colour: '#7C3AED', description: 'Medical information, MSL and payer content.' },
  'regulatory-writing':  { label: 'Regulatory Writing',    colour: '#B0200D', description: 'CTD/eCTD dossier authoring and submission.' },
  'ideation-publishing': { label: 'Ideation & Publishing', colour: '#0D9488', description: 'Publication planning and channel output.' },
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

  // Real per-project document stats — replaces the hardcoded KPIs
  // that used to show the same VELORA-301 numbers for every project.
  const { data: documents = [] } = useQuery<Document[]>({
    queryKey: ['documents', projectId],
    queryFn:  () => documentsApi.list(projectId!),
    enabled:  !!projectId,
  })

  useEffect(() => {
    if (project) setActiveProject(project)
  }, [project, setActiveProject])

  const stats = useMemo(() => {
    const inFlight     = documents.filter(d => d.status !== 'signed').length
    const inReview     = documents.filter(d => d.status === 'in-review').length
    const awaitingSign = documents.filter(d => d.status === 'pending-signature').length
    const signed       = documents.filter(d => d.status === 'signed').length
    const inAuthoring  = documents.filter(d => d.status === 'in-authoring').length
    // Most recently updated non-signed doc = the "current focus"
    const current = [...documents]
      .filter(d => d.status !== 'signed' && d.updatedAt)
      .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))[0]
    return { inFlight, inReview, awaitingSign, signed, inAuthoring, current }
  }, [documents])

  // Team role breakdown — real counts from project.team.raci instead
  // of the hardcoded "3 writers · 2 stats · 3 reviewers" string.
  const teamBreakdown = useMemo(() => {
    if (!project) return ''
    const writers   = project.team.filter(t => t.raci === 'R').length
    const approvers = project.team.filter(t => t.raci === 'A').length
    const consulted = project.team.filter(t => t.raci === 'C').length
    const informed  = project.team.filter(t => t.raci === 'I').length
    return [
      writers   && `${writers} responsible`,
      approvers && `${approvers} accountable`,
      consulted && `${consulted} consulted`,
      informed  && `${informed} informed`,
    ].filter(Boolean).join(' · ')
  }, [project])

  // Days-to-data-cutoff — real relative value from project.dataCutoff.
  const daysToCutoff = useMemo(() => {
    if (!project?.dataCutoff) return { value: '—', sub: 'No cutoff set', complete: false }
    const diff = Math.ceil((new Date(project.dataCutoff).getTime() - Date.now()) / (24 * 60 * 60 * 1000))
    if (diff <= 0) {
      return { value: '0', sub: `Data cut completed ${project.dataCutoff.slice(0, 10)}`, complete: true }
    }
    return { value: String(diff), sub: `Cutoff ${project.dataCutoff.slice(0, 10)}`, complete: false }
  }, [project])

  if (isLoading || !project) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="font-mono text-sm text-slate-400">Loading project…</p>
      </div>
    )
  }

  const leadName = project.team.find(t => t.raci === 'R')?.name ?? project.team[0]?.name ?? '—'

  return (
    <div className="flex h-full flex-col" data-screen="project-dashboard">

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
              <span>Phase {project.phase}{project.indication ? ` · ${project.indication}` : ''}</span>
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
              {stats.current?.updatedAt
                ? `Last activity ${new Date(stats.current.updatedAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}`
                : 'No activity yet'}
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
                Database lock confirmed {project.dataCutoff?.slice(0, 10)}. Final TLFs are available in the Master Library — sections dependent on data lock are unblocked for authoring.
              </div>
            </div>
          )}

          {/* 4 KPI cards — real per-project values */}
          <div className="grid grid-cols-4 gap-4">
            <KpiCard
              label="Documents In Flight"
              value={String(stats.inFlight)}
              sub={`${stats.inReview} in review · ${stats.awaitingSign} awaiting sign-off`}
            />
            <KpiCard
              label="Completed Documents"
              value={String(stats.signed)}
              sub={stats.inAuthoring > 0 ? `${stats.inAuthoring} in authoring` : 'None in authoring'}
            />
            <KpiCard
              label="Days to Data Cut-off"
              value={daysToCutoff.value}
              valueRight={daysToCutoff.complete
                ? <span className="text-xs font-semibold" style={{ color: '#15803D' }}>Complete</span>
                : null}
              sub={daysToCutoff.sub}
            />
            <KpiCard
              label="Team Members"
              value={String(project.team.length)}
              sub={teamBreakdown || 'Roster pending'}
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
                        Active
                      </span>
                    </div>
                    <p className="text-sm leading-relaxed text-slate-500">{meta.description}</p>
                  </div>

                  <div className="flex gap-8">
                    <KV label="Documents"      value={`${stats.inFlight} active · ${stats.signed} completed`} />
                    <KV label="Current focus"  value={stats.current ? `${stats.current.title} · ${stats.current.status.replace(/-/g, ' ')}` : 'No active document'} />
                    <KV label="Last updated"   value={stats.current?.updatedAt ? new Date(stats.current.updatedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'} />
                  </div>

                  {(() => {
                    const total = stats.inFlight + stats.signed
                    const pct   = total === 0 ? 0 : Math.round((stats.signed / total) * 100)
                    return (
                      <div className="flex flex-col gap-2">
                        <div className="flex justify-between text-xs text-slate-500">
                          <span className="font-semibold">Documents complete</span>
                          <span>{pct}% ({stats.signed}/{total})</span>
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
                    Open {meta.label}
                  </button>
                  <div className="flex flex-col gap-2.5 rounded-lg border border-slate-200 bg-slate-50 p-3.5">
                    <p className="text-xs font-semibold text-slate-500">Document status</p>
                    {stats.inAuthoring > 0 && (
                      <div className="flex justify-between text-[13px]">
                        <span>In authoring</span>
                        <span className="font-semibold text-slate-700">{stats.inAuthoring}</span>
                      </div>
                    )}
                    {stats.inReview > 0 && (
                      <div className="flex justify-between text-[13px]">
                        <span>In review</span>
                        <span className="font-semibold" style={{ color: '#B45309' }}>{stats.inReview}</span>
                      </div>
                    )}
                    {stats.awaitingSign > 0 && (
                      <div className="flex justify-between text-[13px]">
                        <span>Awaiting signature</span>
                        <span className="font-semibold" style={{ color: '#2563EB' }}>{stats.awaitingSign}</span>
                      </div>
                    )}
                    {stats.signed > 0 && (
                      <div className="flex justify-between text-[13px]">
                        <span>Signed</span>
                        <span className="font-semibold" style={{ color: '#15803D' }}>{stats.signed}</span>
                      </div>
                    )}
                    {documents.length === 0 && (
                      <p className="text-[12px] italic text-slate-400">No documents yet. Use + New Document on the module home.</p>
                    )}
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

          {/* Cost & Performance — estimates derived from real doc counts
              (14 hrs/doc avg × $200/hr blended rate, industry rough-
              order-of-magnitude). Replaces hardcoded VELORA numbers. */}
          {documents.length > 0 && (() => {
            const total      = stats.inFlight + stats.signed
            const pct        = total === 0 ? 0 : Math.round((stats.signed / total) * 100)
            const hoursSaved = stats.signed * 14
            const dollars    = hoursSaved * 200
            return (
              <div className="flex flex-col gap-4">
                <div className="flex items-baseline justify-between">
                  <div className="flex flex-col gap-1">
                    <p className="font-mono text-[11px] font-medium uppercase tracking-widest text-slate-500">Cost &amp; Performance</p>
                    <h3 className="text-xl font-bold tracking-tight text-slate-900">AI-assisted authoring value</h3>
                    <p className="text-xs text-slate-500">Rough estimate vs. a manual benchmark of ~14 hrs/document at a blended $200/hr writer rate.</p>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <KpiCard label="Hours Saved"     value={`${hoursSaved} hrs`} sub={`Across ${stats.signed} completed document${stats.signed === 1 ? '' : 's'}`} />
                  <KpiCard label="Estimated Value" value={`$${dollars.toLocaleString()}`} sub="At blended writer rate $200/hr" />
                  <div className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-[18px]">
                    <p className="text-xs font-semibold text-slate-500">Documents Completed</p>
                    <p className="text-[28px] font-bold leading-none tracking-tight">
                      {stats.signed} <span className="text-base font-semibold text-slate-500">of {total}</span>
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
