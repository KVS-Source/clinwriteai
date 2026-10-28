// ChecklistItemBadge — small coloured chip rendering the ownerRaci letter
// on a checklist item. Lets the ChecklistPanel distinguish Q (QC) items
// from R/C/A/I items at a glance without a legend.
//
// Standalone component; drop into any list that renders checklist items.
// Pure presentational — no fetching, no state.

import type { RaciLetter } from '../../api/raci'

export interface ChecklistItemBadgeProps {
  ownerRaci: RaciLetter | string
  className?: string
}

const LETTER_META: Record<string, { label: string; classes: string }> = {
  R: { label: 'R',  classes: 'bg-sky-50 text-sky-700 border-sky-200' },
  A: { label: 'A',  classes: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  C: { label: 'C',  classes: 'bg-slate-50 text-slate-700 border-slate-200' },
  I: { label: 'I',  classes: 'bg-stone-50 text-stone-700 border-stone-200' },
  Q: { label: 'QC', classes: 'bg-amber-50 text-amber-800 border-amber-200' },
}

export function ChecklistItemBadge({ ownerRaci, className }: ChecklistItemBadgeProps) {
  const meta = LETTER_META[ownerRaci.toUpperCase()] ?? LETTER_META.C
  return (
    <span
      className={`inline-flex items-center justify-center min-w-[1.75rem] h-5 px-1.5 rounded border text-[11px] font-semibold uppercase tracking-wider ${meta.classes} ${className ?? ''}`}
      aria-label={`Owner RACI: ${ownerRaci}`}
    >
      {meta.label}
    </span>
  )
}
