import { Link } from 'react-router-dom'
import { MODULE_LABELS, type ModuleSlug } from '../../config/modules'

interface Props { slug: ModuleSlug }

// Shown when a user deep-links into a module that's been frozen by the
// 2026-10-06 pivot. Keeps the shell + sidebar visible so navigation out
// is one click away. See docs/pivot-plan.md Arc 1.
export function ModuleDisabledScreen({ slug }: Props) {
  const label = MODULE_LABELS[slug] ?? slug
  return (
    <div className="flex h-full items-center justify-center p-12">
      <div className="max-w-md text-center">
        <p className="font-mono text-xs uppercase tracking-widest text-amber-600">
          Module paused
        </p>
        <h2 className="mt-2 text-xl font-bold text-slate-700">
          {label} is temporarily disabled
        </h2>
        <p className="mt-3 text-sm text-slate-500">
          This workspace is focused on Clinical Writing and Tenant
          Administration while that work hardens for Dev + QA handover.
          {label} will come back online in a later phase.
        </p>
        <p className="mt-4 text-xs text-slate-400">
          Operators: re-enable by adding this module's key to
          <code className="mx-1 rounded bg-slate-100 px-1 py-0.5 font-mono">VITE_MODULES_ENABLED</code>
          and the matching API-side
          <code className="mx-1 rounded bg-slate-100 px-1 py-0.5 font-mono">FEATURE_MODULES_ENABLED</code>.
        </p>
        <Link
          to="/projects"
          className="mt-6 inline-block rounded-md bg-slate-800 px-4 py-2 text-sm text-white hover:bg-slate-700"
        >
          Back to All Projects
        </Link>
      </div>
    </div>
  )
}
