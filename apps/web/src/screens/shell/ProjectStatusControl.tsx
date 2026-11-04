// Project status control, for the PM: the valid next moves (the API decides them), a required reason,
// a stronger confirm for Close and Re-open, the history from the audit trail, and an optional suggestion
// that only ever opens the same dialog. Nothing here changes a status without the PM confirming it.

import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import type { Document, Project, ProjectStatus } from '@platform/types'
import { documentsApi, projectsApi } from '../../api'
import { ApiError } from '../../api/client'

const STATUS_KEY: Record<ProjectStatus, string> = {
  initiated: 'status_initiated',
  ongoing:   'status_ongoing',
  'on-hold': 'status_on_hold',
  're-open': 'status_re_open',
  closed:    'status_closed',
}
const MIN_REASON = 3
const MAX_REASON = 500

/** These two change what everyone on the project can do, so they ask for more than a click. */
const needsStrongConfirm = (to: ProjectStatus) => to === 'closed' || to === 're-open'

function useProjectStatus(projectId: string) {
  return useQuery({
    queryKey: ['project-status', projectId],
    queryFn:  () => projectsApi.getStatus(projectId),
    retry:    false,
  })
}

function useStatusLabel() {
  const { t } = useTranslation()
  return (status: string | null) =>
    status && status in STATUS_KEY ? t(`component.project_status.${STATUS_KEY[status as ProjectStatus]}`) : status ?? '—'
}

// --- The menu ---------------------------------------------------------------

export function ProjectStatusMenu({ projectId, onPick }: { projectId: string; onPick: (to: ProjectStatus) => void }) {
  const { t } = useTranslation()
  const label = useStatusLabel()
  const { data } = useProjectStatus(projectId)
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (!rootRef.current?.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.document.addEventListener('mousedown', onDown)
    window.document.addEventListener('keydown', onKey)
    return () => {
      window.document.removeEventListener('mousedown', onDown)
      window.document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!data || data.next.length === 0) return null

  return (
    <div ref={rootRef} className="relative flex-none" data-project-status-menu>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="rounded-md border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-900 transition-colors hover:bg-slate-50"
        data-action="change-project-status"
      >
        {t('component.project_status.change_status')} ▾
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-30 mt-1 min-w-[180px] rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
          {data.next.map(to => (
            <button
              key={to}
              type="button"
              role="menuitem"
              onClick={() => { setOpen(false); onPick(to) }}
              className={`block w-full rounded px-3 py-2 text-left text-[13px] font-medium hover:bg-slate-50 ${to === 'closed' ? 'text-red-700' : 'text-slate-800'}`}
              data-status-option={to}
            >
              {label(to)}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// --- The confirm dialog -----------------------------------------------------

export function ProjectStatusDialog({ project, to, onClose }: { project: Project; to: ProjectStatus; onClose: () => void }) {
  const { t } = useTranslation()
  const label = useStatusLabel()
  const qc = useQueryClient()
  const [reason, setReason] = useState('')
  const [typed, setTyped] = useState('')
  const strong = needsStrongConfirm(to)

  const { data: documents = [] } = useQuery<Document[]>({
    queryKey: ['documents', project.id],
    queryFn:  () => documentsApi.list(project.id),
    enabled:  to === 'closed',
  })
  const unsigned = documents.filter(d => d.status !== 'signed').length

  const change = useMutation({
    mutationFn: () => projectsApi.transition(project.id, { to, reason: reason.trim() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project', project.id] })
      qc.invalidateQueries({ queryKey: ['project-status', project.id] })
      qc.invalidateQueries({ queryKey: ['projects'] })
      onClose()
    },
    onError: () => {
      // Someone else may have moved it first: show the moves that are valid now.
      qc.invalidateQueries({ queryKey: ['project-status', project.id] })
    },
  })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !change.isPending) onClose() }
    window.document.addEventListener('keydown', onKey)
    return () => window.document.removeEventListener('keydown', onKey)
  }, [change.isPending, onClose])

  const reasonOk = reason.trim().length >= MIN_REASON
  const typedOk = !strong || typed.trim().toLowerCase() === project.shortTitle.trim().toLowerCase()
  const errorBody = change.error instanceof ApiError ? change.error.body as { message?: string } | null : null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="project-status-title"
      onClick={() => { if (!change.isPending) onClose() }}
      data-project-status-dialog={to}
    >
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl" onClick={e => e.stopPropagation()}>
        <h3 id="project-status-title" className="text-base font-semibold text-slate-900">
          {t('component.project_status.dialog_title', { from: label(project.status), to: label(to) })}
        </h3>
        <p className="mt-1 text-[12px] text-slate-500">{project.shortTitle}</p>

        {to === 'closed' && (
          <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-800" data-status-warning>
            <p className="font-semibold">{t('component.project_status.close_warning')}</p>
            {unsigned > 0 && <p className="mt-1" data-status-unsigned>{t('component.project_status.close_unsigned', { count: unsigned })}</p>}
          </div>
        )}
        {to === 're-open' && (
          <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900" data-status-warning>
            {t('component.project_status.reopen_warning')}
          </div>
        )}

        <label className="mt-4 block">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{t('component.project_status.reason_label')}</span>
          <textarea
            value={reason}
            onChange={e => setReason(e.target.value)}
            maxLength={MAX_REASON}
            rows={3}
            autoFocus
            placeholder={t('component.project_status.reason_placeholder')}
            className="mt-1 w-full rounded border border-slate-200 p-2 text-[13px] outline-none focus:border-blue-600"
            data-field="status-reason"
          />
          <span className="text-[11px] text-slate-500">{t('component.project_status.reason_hint')}</span>
        </label>

        {strong && (
          <label className="mt-3 block">
            <span className="text-[12px] text-slate-700">{t('component.project_status.type_to_confirm', { name: project.shortTitle })}</span>
            <input
              type="text"
              value={typed}
              onChange={e => setTyped(e.target.value)}
              autoComplete="off"
              className="mt-1 h-9 w-full rounded border border-slate-200 px-2 text-[13px] outline-none focus:border-blue-600"
              data-field="status-confirm"
            />
          </label>
        )}

        {change.isError && (
          <div className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700" role="alert" data-status-error>
            {errorBody?.message ?? t('component.project_status.change_failed')}
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={change.isPending}
            className="rounded border border-slate-200 bg-white px-3 py-1.5 text-[12px] font-semibold text-slate-700 hover:bg-slate-50"
            data-action="cancel-status-change"
          >
            {t('component.project_status.cancel')}
          </button>
          <button
            type="button"
            onClick={() => change.mutate()}
            disabled={!reasonOk || !typedOk || change.isPending}
            className={`rounded px-3 py-1.5 text-[12px] font-semibold text-white disabled:bg-slate-300 ${to === 'closed' ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'}`}
            data-action="confirm-status-change"
          >
            {change.isPending ? t('component.project_status.saving') : t('component.project_status.confirm', { to: label(to) })}
          </button>
        </div>
      </div>
    </div>
  )
}

// --- The history ------------------------------------------------------------

export function ProjectStatusHistory({ projectId }: { projectId: string }) {
  const { t } = useTranslation()
  const label = useStatusLabel()
  const { data, isLoading, isError } = useProjectStatus(projectId)

  if (isLoading) return <p className="px-4 py-3 text-[13px] text-slate-500">{t('component.project_status.history_loading')}</p>
  if (isError || !data) return <p className="px-4 py-3 text-[13px] text-red-700" role="alert">{t('component.project_status.history_failed')}</p>
  if (data.history.length === 0) return <p className="px-4 py-3 text-[13px] text-slate-500" data-status-history-empty>{t('component.project_status.history_empty')}</p>

  return (
    <ol className="divide-y divide-slate-100" data-status-history>
      {data.history.map(entry => (
        <li key={entry.id} className="px-4 py-2.5 text-[13px]" data-status-history-entry={entry.id}>
          <p className="font-semibold text-slate-900">{label(entry.from)} → {label(entry.to)}</p>
          <p className="mt-0.5 text-slate-700">{entry.reason ?? t('component.project_status.no_reason')}</p>
          <p className="mt-0.5 text-[11px] text-slate-500">
            {t('component.project_status.history_by', {
              name: entry.by,
              when: new Date(entry.at).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
            })}
          </p>
        </li>
      ))}
    </ol>
  )
}

// --- The suggestion ---------------------------------------------------------

/** What the documents suggest, if anything. Only ever a prompt: the PM still gives a reason and confirms. */
export function suggestProjectStatus(status: ProjectStatus, documents: Pick<Document, 'status'>[]): ProjectStatus | null {
  if (documents.length === 0) return null
  if ((status === 'initiated' || status === 're-open') && documents.some(d => d.status !== 'not-started')) return 'ongoing'
  if (status === 'ongoing' && documents.every(d => d.status === 'signed')) return 'closed'
  return null
}

export function ProjectStatusSuggestion({ project, documents, onPick }: { project: Project; documents: Document[]; onPick: (to: ProjectStatus) => void }) {
  const { t } = useTranslation()
  const label = useStatusLabel()
  const { data } = useProjectStatus(project.id)
  const [dismissed, setDismissed] = useState<string | null>(null)
  const suggestion = suggestProjectStatus(project.status, documents)

  // Dismissal lasts until the suggestion changes, and the API still has to allow the move.
  if (!suggestion || dismissed === `${project.status}:${suggestion}` || !data?.next.includes(suggestion)) return null

  return (
    <div className="flex items-center gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-[13px] text-blue-900" role="status" data-status-suggestion={suggestion}>
      <span className="flex-1">
        {suggestion === 'closed' ? t('component.project_status.suggest_close') : t('component.project_status.suggest_ongoing')}
      </span>
      <button
        type="button"
        onClick={() => onPick(suggestion)}
        className="flex-none rounded-md bg-blue-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-blue-700"
        data-action="apply-status-suggestion"
      >
        {t('component.project_status.suggest_action', { to: label(suggestion) })}
      </button>
      <button
        type="button"
        onClick={() => setDismissed(`${project.status}:${suggestion}`)}
        className="flex-none text-[12px] font-semibold underline"
        data-action="dismiss-status-suggestion"
      >
        {t('component.project_status.dismiss')}
      </button>
    </div>
  )
}
