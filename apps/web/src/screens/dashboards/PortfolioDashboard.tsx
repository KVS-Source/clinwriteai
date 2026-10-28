// Portfolio dashboard — cross-project rollup for admin / PM / contributor.
//
// Backend: GET /dashboards/portfolio (shipped in commit b4433cc).
// Visibility is server-enforced: admin sees every project in the tenant,
// non-admin sees the projects they're an active ProjectMember of.
//
// Layout:
//   totals strip      counts across every visible project
//   project table     one row per project with status / docs / overdue
//
// Minimal, headless-ish styling — meant as a daily-driver view, not a
// marketing dashboard. Rows link to the per-project PM dashboard.

import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { dashboardsApi, type PortfolioDashboardProject } from '../../api/raci'

export function PortfolioDashboard() {
  const q = useQuery({
    queryKey: ['dashboards', 'portfolio'],
    queryFn:  () => dashboardsApi.portfolio(),
    staleTime: 30_000,
  })

  if (q.isLoading) {
    return <Shell><div className="text-sm text-slate-500">Loading portfolio…</div></Shell>
  }
  if (q.isError || !q.data) {
    return (
      <Shell>
        <div className="text-sm text-rose-600">
          Could not load the portfolio dashboard. {q.error instanceof Error ? q.error.message : ''}
        </div>
      </Shell>
    )
  }

  const { projects, totals, generatedAt } = q.data

  return (
    <Shell>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">Portfolio</h1>
        <p className="mt-1 text-xs text-slate-500">
          Cross-project rollup. Last refreshed {new Date(generatedAt).toLocaleTimeString()}.
        </p>
      </header>

      <section className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <TotalCard label="Projects"            value={totals.projects} />
        <TotalCard label="Documents"           value={totals.documents} />
        <TotalCard label="Overdue"             value={totals.overdueDocuments} tone={totals.overdueDocuments > 0 ? 'amber' : 'neutral'} />
        <TotalCard label="Active members"      value={totals.members} />
      </section>

      {projects.length === 0 ? (
        <div className="rounded border border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">
          No projects to show. If you expected a project here, you're probably not an active member yet — ask the PM to add you.
        </div>
      ) : (
        <div className="overflow-hidden rounded border border-slate-200">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                <th className="px-4 py-2">Project</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2 text-right">Documents</th>
                <th className="px-4 py-2 text-right">Overdue</th>
                <th className="px-4 py-2 text-right">Members</th>
                <th className="px-4 py-2">By status</th>
              </tr>
            </thead>
            <tbody>
              {projects.map(p => (
                <ProjectRow key={p.id} project={p} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-full overflow-y-auto p-6" data-screen="portfolio-dashboard">
      <div className="mx-auto max-w-6xl">
        {children}
      </div>
    </div>
  )
}

function TotalCard({ label, value, tone = 'neutral' }: { label: string; value: number; tone?: 'neutral' | 'amber' }) {
  const toneClasses =
    tone === 'amber'
      ? 'border-amber-200 bg-amber-50 text-amber-900'
      : 'border-slate-200 bg-white text-slate-900'
  return (
    <div className={`rounded border p-4 ${toneClasses}`}>
      <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-bold">{value}</div>
    </div>
  )
}

function ProjectRow({ project }: { project: PortfolioDashboardProject }) {
  const link = `/projects/${project.id}/clinical-writing`
  const statusEntries = Object.entries(project.byStatus).sort(([a], [b]) => a.localeCompare(b))
  return (
    <tr className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
      <td className="px-4 py-2">
        <Link to={link} className="font-semibold text-blue-700 hover:underline">
          {project.name}
        </Link>
      </td>
      <td className="px-4 py-2 text-xs capitalize text-slate-700">
        {project.status.replace(/-/g, ' ')}
      </td>
      <td className="px-4 py-2 text-right font-mono text-sm text-slate-800">{project.documentCount}</td>
      <td className="px-4 py-2 text-right">
        <span className={`font-mono text-sm ${project.overdueCount > 0 ? 'font-semibold text-amber-700' : 'text-slate-400'}`}>
          {project.overdueCount}
        </span>
      </td>
      <td className="px-4 py-2 text-right font-mono text-sm text-slate-800">{project.memberCount}</td>
      <td className="px-4 py-2">
        <div className="flex flex-wrap gap-1">
          {statusEntries.length === 0 && <span className="text-xs text-slate-400">—</span>}
          {statusEntries.map(([status, count]) => (
            <span
              key={status}
              className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-mono text-slate-700"
              title={`${count} document${count === 1 ? '' : 's'} in ${status}`}
            >
              {status.replace(/-/g, ' ')}: {count}
            </span>
          ))}
        </div>
      </td>
    </tr>
  )
}
