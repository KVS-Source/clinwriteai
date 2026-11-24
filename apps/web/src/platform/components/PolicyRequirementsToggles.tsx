// Policy requirements toggles — shared control used across every
// policy admin screen (Clinical, Regulatory, Medical, Publication,
// Ideation). The PM flips which inputs are MANDATORY per doc type
// before the AI drafter can run: source documents, a template, and
// the author's purpose (= the Create wizard's "Instructions for the
// AI drafter" field, migration 100).
//
// Dumb controlled component — no state, no API calls. The parent
// policy screen owns the value + mutation lifecycle.

import type { PolicyRequirements } from '../api/platformApi'
import { DEFAULT_POLICY_REQUIREMENTS } from '../api/platformApi'

export interface PolicyRequirementsTogglesProps {
  value:    PolicyRequirements
  onChange: (next: PolicyRequirements) => void
  disabled?: boolean
}

interface ToggleRow {
  key:   keyof PolicyRequirements
  label: string
  help:  string
}

const ROWS: ToggleRow[] = [
  {
    key:   'requireSources',
    label: 'Source documents',
    help:  'Author must attach at least one usable PDF source before the AI drafter can run.',
  },
  {
    key:   'requireTemplate',
    label: 'Template',
    help:  'A document template must resolve for this doc type (pinned on the policy or auto-matched from Master Library → Templates).',
  },
  {
    key:   'requirePurpose',
    label: 'Purpose',
    help:  "Author must fill in the Instructions for the AI drafter field in the Create wizard — a sentence describing why this document exists.",
  },
]

export function PolicyRequirementsToggles({
  value, onChange, disabled,
}: PolicyRequirementsTogglesProps) {
  const requirements = value ?? DEFAULT_POLICY_REQUIREMENTS
  return (
    <div
      className="flex flex-col gap-2 rounded-md border border-slate-200 bg-slate-50 p-3"
      data-policy-requirements
    >
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">
          Required inputs
        </span>
        <span className="text-[11px] text-slate-500">
          Switch off per doc type when not needed
        </span>
      </div>
      <ul className="flex flex-col gap-1.5">
        {ROWS.map(row => {
          const checked = !!requirements[row.key]
          return (
            <li key={row.key} className="flex items-start gap-3 rounded border border-slate-200 bg-white px-3 py-2">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 flex-none cursor-pointer accent-blue-600"
                checked={checked}
                disabled={disabled}
                onChange={e => onChange({ ...requirements, [row.key]: e.currentTarget.checked })}
                data-requirement={row.key}
                aria-describedby={`policy-req-${row.key}-help`}
              />
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-slate-800">{row.label}</p>
                <p id={`policy-req-${row.key}-help`} className="mt-0.5 text-[11px] text-slate-500">
                  {row.help}
                </p>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
