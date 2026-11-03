// ChecklistItemBadge — small coloured chip rendering the ownerRaci letter
// on a checklist item. Lets the ChecklistPanel distinguish Q (QC) items
// from R/C/A/I items at a glance without a legend.
//
// Standalone component; drop into any list that renders checklist items.
// Pure presentational — no fetching, no state.

import { useTranslation } from 'react-i18next'
import type { RaciLetter } from '../../api/raci'

export interface ChecklistItemBadgeProps {
  ownerRaci: RaciLetter | string
  className?: string
}

const LETTER_META: Record<string, { labelKey: string; classes: string }> = {
  R: { labelKey: 'owner_label_r', classes: 'bg-sky-50 text-sky-700 border-sky-200' },
  A: { labelKey: 'owner_label_a', classes: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  C: { labelKey: 'owner_label_c', classes: 'bg-slate-50 text-slate-700 border-slate-200' },
  I: { labelKey: 'owner_label_i', classes: 'bg-stone-50 text-stone-700 border-stone-200' },
  Q: { labelKey: 'owner_label_q', classes: 'bg-amber-50 text-amber-800 border-amber-200' },
}

export function ChecklistItemBadge({ ownerRaci, className }: ChecklistItemBadgeProps) {
  const { t } = useTranslation()
  const meta = LETTER_META[ownerRaci.toUpperCase()] ?? LETTER_META.C
  return (
    <span
      className={`inline-flex items-center justify-center min-w-[1.75rem] h-5 px-1.5 rounded border text-[11px] font-semibold uppercase tracking-wider ${meta.classes} ${className ?? ''}`}
      aria-label={t('component.checklist_item_badge.aria_label', { letter: ownerRaci })}
    >
      {t(`component.checklist_item_badge.${meta.labelKey}`)}
    </span>
  )
}
