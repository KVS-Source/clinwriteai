// Documents column chips for the Projects list — one chip per module that
// has at least one document on this project, colour-coded with the module
// accent + short monogram (CW / SW / MW / RW / IP).
//
// Clicking a chip navigates the user straight to that module's home for
// this project (e.g. /projects/<id>/clinical-writing), bypassing the
// project landing page. stopPropagation on the click keeps the parent row
// navigation (which goes to /projects/<id>) from also firing.
//
// Empty state — a project with zero docs across every module renders a
// subtle "—" so the column stays aligned with the rest of the grid.

import { useNavigate } from 'react-router-dom'
import type { Project } from '@platform/types'
import {
  MODULE_COLOURS,
  MODULE_LABELS,
  MODULE_MONOGRAMS,
  MODULE_SLUG_TO_KEY,
  isModuleEnabled,
  type ModuleSlug,
} from '../../config/modules'

interface Props {
  project: Project
}

const MODULE_ORDER: ModuleSlug[] = [
  'clinical-writing',
  'scientific-writing',
  'medical-writing',
  'regulatory-writing',
  'ideation-publishing',
]

// Project.documentCountByModule key → ModuleSlug. Keeps the server shape
// readable (camelCase) while letting the UI reuse its slug-keyed lookups.
const COUNT_KEY_FOR_SLUG: Record<ModuleSlug, keyof NonNullable<Project['documentCountByModule']>> = {
  'clinical-writing':    'clinicalWriting',
  'scientific-writing':  'scientificWriting',
  'medical-writing':     'medicalWriting',
  'regulatory-writing':  'regulatoryWriting',
  'ideation-publishing': 'ideationPublishing',
}

export function DocumentCountChips({ project }: Props) {
  const navigate = useNavigate()
  const counts = project.documentCountByModule

  // Back-compat: if the server didn't send per-module counts (older build
  // or non-list endpoint), fall back to the plain documentCount so the
  // column isn't blank.
  if (!counts) {
    return (
      <span className="text-slate-500">
        {project.documentCount ?? 0} document{(project.documentCount ?? 0) === 1 ? '' : 's'}
      </span>
    )
  }

  const chips = MODULE_ORDER
    .map(slug => ({ slug, n: counts[COUNT_KEY_FOR_SLUG[slug]] ?? 0 }))
    .filter(({ n }) => n > 0)

  if (chips.length === 0) {
    return <span className="text-slate-400">—</span>
  }

  return (
    <div className="flex flex-wrap gap-1">
      {chips.map(({ slug, n }) => {
        const colour = MODULE_COLOURS[slug]
        const label  = MODULE_LABELS[slug]
        const mono   = MODULE_MONOGRAMS[slug]
        const enabled = isModuleEnabled(MODULE_SLUG_TO_KEY[slug])
        // Disable navigation when the install has that module turned off
        // (licence doesn't enable it) — the route would just land on
        // ModuleDisabledScreen anyway. Chip still renders so the count is
        // visible even when the writer can't click through.
        return (
          <button
            key={slug}
            type="button"
            disabled={!enabled}
            onClick={(e) => {
              // stopPropagation so the parent row's onClick doesn't also
              // fire — otherwise clicking a chip would navigate to
              // /projects/<id> instead of the module route.
              e.stopPropagation()
              if (!enabled) return
              navigate(`/projects/${project.id}/${slug}`)
            }}
            title={`${n} ${label} document${n === 1 ? '' : 's'}${enabled ? '' : ' — module disabled'}`}
            data-module-chip={slug}
            data-module-count={n}
            className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-mono font-semibold transition-opacity disabled:cursor-not-allowed disabled:opacity-50 hover:opacity-80"
            style={{
              borderColor:     `${colour}55`,
              backgroundColor: `${colour}14`,
              color:           colour,
            }}
          >
            <span className="tabular-nums">{n}</span>
            <span>{mono}</span>
          </button>
        )
      })}
    </div>
  )
}
