// Project Settings: who manages this project, and adding or removing them. Each change applies at once.

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ApiError } from '../../api/client'
import { projectManagersApi } from '../../api/projects'
import i18n from '../../i18n'
import { ProjectManagerPicker, StatusChip } from './ProjectManagersField'

// The API's refusals, in the reader's language. Shared with the New Project form.
export function projectManagerError(err: unknown): string {
  if (err instanceof ApiError) {
    const body = err.body as { error?: string; message?: string } | null
    if (body?.error === 'pm_email_not_pm') return i18n.t('page.project_managers.err_email_not_pm')
    if (body?.error === 'pm_user_not_eligible') return i18n.t('page.project_managers.err_not_eligible')
    if (body?.error === 'last_project_manager') return i18n.t('page.project_managers.err_last_pm')
    if (body?.error === 'project_manager_forbidden') return i18n.t('page.project_managers.err_forbidden')
    if (body?.message) return body.message
  }
  return i18n.t('page.project_managers.err_generic')
}

export function ProjectManagersSection({ projectId, currentUserId }: { projectId: string; currentUserId: string }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [notice, setNotice] = useState<string | null>(null)
  const key = ['project-managers', projectId]
  const managers = useQuery({ queryKey: key, queryFn: () => projectManagersApi.list(projectId), retry: false })

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: key })
    void qc.invalidateQueries({ queryKey: ['pm-directory'] })
    void qc.invalidateQueries({ queryKey: ['project', projectId] })
  }
  const sentNotice = (email: string, emailQueued: boolean | null) => {
    if (emailQueued === null) return setNotice(null)
    setNotice(emailQueued ? t('page.project_managers.invite_sent', { email }) : t('page.project_managers.invite_not_sent', { email }))
  }

  const add = useMutation({
    mutationFn: (pm: { id: string; email: string }) => projectManagersApi.add(projectId, pm.id),
    onSuccess: (res, pm) => { sentNotice(pm.email, res.emailQueued); refresh() },
  })
  const invite = useMutation({
    mutationFn: (email: string) => projectManagersApi.invite(projectId, email),
    onSuccess: (res, email) => { sentNotice(email, res.emailQueued); refresh() },
  })
  const resend = useMutation({
    mutationFn: (pm: { id: string; email: string }) => projectManagersApi.resend(projectId, pm.id),
    onSuccess: (res, pm) => sentNotice(pm.email, res.emailQueued),
  })
  const remove = useMutation({
    mutationFn: (userId: string) => projectManagersApi.remove(projectId, userId),
    onSuccess: () => { setNotice(null); refresh() },
  })

  const failed = [add, invite, resend, remove].find(m => m.isError)
  const busy = add.isPending || invite.isPending || resend.isPending || remove.isPending
  const rows = managers.data ?? []
  const onProject = useMemo(() => new Set(rows.map(m => m.id)), [rows])

  return (
    <section className="rounded-lg border border-slate-200 bg-white" data-section="project-managers">
      <h2 className="border-b border-slate-100 px-4 py-3 text-sm font-bold text-slate-900">{t('page.project_managers.section_title')}</h2>
      <div className="flex flex-col gap-4 p-4">
        {managers.isError && <p className="text-[13px] text-red-700" role="alert">{t('page.project_managers.load_failed')}</p>}
        {managers.isSuccess && rows.length === 0 && (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-[12px] text-amber-800" data-pm-none>{t('page.project_managers.none_yet')}</p>
        )}
        {rows.length > 0 && <ul className="flex flex-col divide-y divide-slate-100 rounded-md border border-slate-200" data-pm-current>
          {rows.map(pm => (
            <li key={pm.id} className="flex items-center gap-2 px-3 py-2" data-pm-row={pm.id}>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-semibold text-slate-900">
                  {pm.name}{pm.id === currentUserId ? ` ${t('page.project_managers.you_suffix')}` : ''}
                </p>
                <p className="truncate text-[11px] text-slate-500">{pm.email}</p>
              </div>
              {pm.isCreator && (
                <span className="flex-none rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600" data-pm-creator>
                  {t('page.project_managers.creator')}
                </span>
              )}
              <StatusChip status={pm.status} />
              {pm.status === 'invited' && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => resend.mutate(pm)}
                  className="flex-none text-[12px] font-semibold text-blue-700 hover:underline disabled:opacity-50"
                  data-pm-resend={pm.id}
                >{t('page.project_managers.resend')}</button>
              )}
              <button
                type="button"
                disabled={busy}
                onClick={() => { if (window.confirm(t('page.project_managers.confirm_remove', { name: pm.name }))) remove.mutate(pm.id) }}
                className="flex-none text-[12px] font-semibold text-slate-500 hover:text-red-700 disabled:opacity-50"
                data-pm-remove={pm.id}
              >{t('page.project_managers.remove')}</button>
            </li>
          ))}
        </ul>}

        {notice && <p className="rounded-md bg-green-50 px-3 py-2 text-[12px] text-green-800" role="status" data-pm-notice>{notice}</p>}
        {failed && <p className="rounded-md bg-red-50 px-3 py-2 text-[12px] text-red-800" role="alert" data-pm-error>{projectManagerError(failed.error)}</p>}

        <ProjectManagerPicker
          excludedIds={onProject}
          excludedEmails={new Set(rows.map(m => m.email.toLowerCase()))}
          busy={busy}
          onPick={pm => { [add, invite, resend, remove].forEach(m => m.reset()); add.mutate(pm) }}
          onInvite={email => { [add, invite, resend, remove].forEach(m => m.reset()); invite.mutate(email) }}
        />
      </div>
    </section>
  )
}
