// Project managers: pick from the list of PMs in the tenant, or invite someone by email. Used on the
// New Project form, where the choices are sent with the project, and on Project Settings, where each
// one applies straight away. The API repeats every check here (projects/project-managers.ts).

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { projectManagersApi, type PmDirectoryEntry } from '../../api/projects'

const looksLikeEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim())
const initialsOf = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('') || '?'

export function StatusChip({ status }: { status: string }) {
  const { t } = useTranslation()
  if (status !== 'invited') return null
  return (
    <span className="flex-none rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700" data-pm-invited>
      {t('page.project_managers.status_invited')}
    </span>
  )
}

interface PickerProps {
  /** People already chosen or on the project, who are not offered again. */
  excludedIds: Set<string>
  excludedEmails?: Set<string>
  busy?: boolean
  onPick: (pm: PmDirectoryEntry) => void
  onInvite: (email: string) => void
}

export function ProjectManagerPicker({ excludedIds, excludedEmails, busy, onPick, onInvite }: PickerProps) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [email, setEmail] = useState('')
  const directory = useQuery({ queryKey: ['pm-directory'], queryFn: () => projectManagersApi.directory(), retry: false })

  const available = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (directory.data ?? [])
      .filter(pm => !excludedIds.has(pm.id))
      .filter(pm => !q || `${pm.name} ${pm.email}`.toLowerCase().includes(q))
  }, [directory.data, excludedIds, query])

  const trimmed = email.trim().toLowerCase()
  const invite = () => {
    if (!looksLikeEmail(trimmed) || busy || excludedEmails?.has(trimmed)) return
    onInvite(trimmed)
    setEmail('')
  }

  return (
    <div className="flex flex-col gap-3" data-pm-picker>
      <div className="flex flex-col gap-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{t('page.project_managers.list_label')}</span>
        <input
          value={query}
          onChange={e => setQuery(e.currentTarget.value)}
          placeholder={t('page.project_managers.search_placeholder')}
          aria-label={t('page.project_managers.search_placeholder')}
          className="h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-[13px]"
          data-pm-search
        />
        <div className="max-h-44 overflow-y-auto rounded-md border border-slate-200 bg-white" data-pm-list>
          {directory.isLoading && <p className="px-3 py-2 text-[12px] text-slate-400">{t('page.project_managers.loading')}</p>}
          {directory.isError && <p className="px-3 py-2 text-[12px] text-red-700" role="alert">{t('page.project_managers.list_failed')}</p>}
          {directory.isSuccess && available.length === 0 && (
            <p className="px-3 py-2 text-[12px] text-slate-500" data-pm-list-empty>{t('page.project_managers.list_empty')}</p>
          )}
          {available.map(pm => (
            <div key={pm.id} className="flex items-center gap-3 border-b border-slate-100 px-3 py-2 transition-colors last:border-b-0 hover:bg-slate-50" data-pm-option={pm.id}>
              <span aria-hidden="true" className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-blue-50 text-[11px] font-semibold text-blue-700">
                {initialsOf(pm.name)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-semibold text-slate-900">{pm.name}</p>
                <p className="truncate text-[11px] text-slate-500">{pm.email}</p>
              </div>
              <StatusChip status={pm.status} />
              <button
                type="button"
                disabled={busy}
                onClick={() => onPick(pm)}
                aria-label={`${t('page.project_managers.add')}: ${pm.name}`}
                className="inline-flex h-8 flex-none items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-3 text-[12px] font-semibold text-blue-700 transition-colors hover:border-blue-600 hover:bg-blue-600 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
                data-pm-add={pm.id}
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                  <path d="M6 2v8M2 6h8" />
                </svg>
                {t('page.project_managers.add')}
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{t('page.project_managers.invite_label')}</span>
        <div className="flex gap-2">
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.currentTarget.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); invite() } }}
            placeholder={t('page.project_managers.invite_placeholder')}
            aria-label={t('page.project_managers.invite_label')}
            className="h-9 min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-3 text-[13px]"
            data-pm-invite-email
          />
          <button
            type="button"
            disabled={busy || !looksLikeEmail(trimmed) || excludedEmails?.has(trimmed)}
            onClick={invite}
            className="h-9 flex-none rounded-md border border-blue-600 bg-blue-600 px-4 text-[12px] font-semibold text-white transition-colors hover:bg-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
            data-pm-invite-submit
          >{t('page.project_managers.invite')}</button>
        </div>
        <p className="text-[11px] text-slate-500">{t('page.project_managers.invite_hint')}</p>
      </div>
    </div>
  )
}
