// A document's date with inline editing, for whoever the API says may change it. Deadlines are
// calendar days stored as UTC midnight, so they are read and shown in UTC: no off-by-one by timezone.

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ApiError } from '../../api/client'

export const deadlineDay = (iso: string | null | undefined): string => iso?.slice(0, 10) ?? ''

export function fmtDeadline(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

/** Today on the viewer's own calendar, as 'YYYY-MM-DD'. */
export function localToday(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

export function DeadlineField({ field, value, canEdit, canClear, projectId, documentId, onSave }: {
  /** Names the field in the page, e.g. "target-date". */
  field: string
  value: string | null | undefined
  canEdit: boolean
  canClear?: boolean
  projectId: string
  documentId: string
  onSave: (date: string | null) => Promise<unknown>
}) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const current = deadlineDay(value)

  const save = useMutation({
    mutationFn: (date: string | null) => onSave(date),
    onSuccess: () => {
      setEditing(false)
      qc.invalidateQueries({ queryKey: ['documents', projectId] })
      qc.invalidateQueries({ queryKey: ['document', documentId] })
      qc.invalidateQueries({ queryKey: ['document-audit', documentId] })
    },
  })
  const errorBody = save.error instanceof ApiError ? save.error.body as { message?: string } | null : null

  if (!editing) {
    return (
      <span className="flex items-baseline gap-2" data-deadline={field}>
        <span data-deadline-value>{fmtDeadline(value)}</span>
        {canEdit && (
          <button
            type="button"
            onClick={() => { save.reset(); setDraft(current); setEditing(true) }}
            className="text-[12px] font-semibold text-blue-600 hover:text-blue-700"
            data-action={`edit-${field}`}
          >
            {t('component.deadlines.edit')}
          </button>
        )}
      </span>
    )
  }

  const today = localToday()
  const valid = !!draft && (draft === current || draft >= today)

  return (
    <span className="flex flex-col gap-1.5" data-deadline={field} data-editing>
      <input
        type="date"
        value={draft}
        min={today}
        onChange={e => setDraft(e.currentTarget.value)}
        aria-label={t('component.deadlines.date_aria')}
        className="h-8 w-40 rounded-md border border-slate-300 px-2 text-[13px]"
        data-field={`${field}-input`}
      />
      <span className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => save.mutate(draft)}
          disabled={!valid || save.isPending}
          className="rounded-md bg-blue-600 px-2.5 py-1 text-[12px] font-semibold text-white hover:bg-blue-700 disabled:bg-slate-300"
          data-action={`save-${field}`}
        >
          {save.isPending ? t('component.deadlines.saving') : t('component.deadlines.save')}
        </button>
        <button
          type="button"
          onClick={() => setEditing(false)}
          disabled={save.isPending}
          className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[12px] font-semibold text-slate-700 hover:bg-slate-50"
          data-action={`cancel-${field}`}
        >
          {t('component.deadlines.cancel')}
        </button>
        {canClear && !!current && (
          <button
            type="button"
            onClick={() => save.mutate(null)}
            disabled={save.isPending}
            className="text-[12px] font-semibold text-red-700 hover:text-red-800"
            data-action={`clear-${field}`}
          >
            {t('component.deadlines.clear')}
          </button>
        )}
      </span>
      {draft && !valid && <span className="text-[11px] text-amber-800" data-deadline-past>{t('component.deadlines.past')}</span>}
      {save.isError && (
        <span role="alert" className="text-[12px] text-red-700" data-deadline-error>
          {errorBody?.message ?? t('component.deadlines.save_failed')}
        </span>
      )}
    </span>
  )
}
