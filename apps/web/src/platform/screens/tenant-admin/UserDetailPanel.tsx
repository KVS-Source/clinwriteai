// User detail — the right-hand panel User Management opens when a row is clicked (as in Genrac).
//
//   Header   — name and status.
//   Details  — email (masked), every role held, title, department, tenant, activated, last active, created.
//              Edit changes title and department (PATCH /admin/users/:id, audited); not for deprovisioned users.
//   Roles    — the platform roles the user holds (at most 2; rights are the union). Slide to revoke
//              one (never the last); "Add another role" adds one alongside the current role. Only the
//              allowed pairs are offered: an admin role is never combined, nor Auditor + Contributor
//              (the API decides: POST / DELETE /admin/users/:id/roles, both audited). Active users only.
//   Footer   — suspend / unsuspend, as in the row's actions.

import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { SlidePanel } from '../../../components/ui'
import { describeApiError } from '../../../api'
import { maskEmail } from '../../../utils/maskEmail'
import {
  ADDABLE_ROLES, MAX_ROLES, StatusChip, canCombine, roleLabelOf, rolesOfUser, usersApi,
  type AdminUser,
} from './userAdminShared'

const fmt = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—')

// Drag the handle to the end (or press End / → to the end) to revoke. Let go early and it springs back.
function SlideToRevoke({ label, disabled, onRevoke }: { label: string; disabled: boolean; onRevoke: () => void }) {
  const { t } = useTranslation()
  const [value, setValue] = useState(0)
  const confirmed = value >= 85
  const release = () => { if (confirmed) onRevoke(); setValue(0) }
  return (
    <div className={`relative h-8 w-[180px] flex-none select-none overflow-hidden rounded-full border ${confirmed ? 'border-red-300 bg-red-50' : 'border-slate-200 bg-slate-100'} ${disabled ? 'opacity-60' : ''}`} data-slide-revoke>
      <span className={`pointer-events-none absolute inset-0 flex items-center pl-9 font-mono text-[10px] font-bold uppercase tracking-wider ${confirmed ? 'text-red-600' : 'text-slate-400'}`}>
        {confirmed ? t('page.user_management_live.release_to_revoke') : t('page.user_management_live.slide_to_revoke')}
      </span>
      <span
        className={`pointer-events-none absolute top-[2px] flex h-[26px] w-[26px] items-center justify-center rounded-full text-[12px] font-bold text-white shadow ${disabled ? 'bg-slate-300' : confirmed ? 'bg-red-600' : 'bg-[#1E3A5F]'}`}
        style={{ left: `calc(${value}% * (180 - 32) / 100 + 3px)` }}
        aria-hidden="true"
      >›</span>
      <input
        type="range" min={0} max={100} step={1} value={value} disabled={disabled}
        onChange={e => setValue(Number(e.currentTarget.value))}
        onPointerUp={release} onKeyUp={release} onBlur={() => setValue(0)}
        aria-label={t('page.user_management_live.revoke_aria', { role: label })}
        className="absolute inset-0 h-full w-full cursor-grab opacity-0 disabled:cursor-not-allowed"
        data-action="slide-revoke"
      />
    </div>
  )
}

export function UserDetailPanel({ user, onClose, onSuspend, onReactivate }: {
  user: AdminUser | null
  onClose: () => void
  onSuspend: (u: AdminUser) => void
  onReactivate: (u: AdminUser) => void
}) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [selected, setSelected] = useState('')
  const [profile, setProfile] = useState<{ title: string; department: string } | null>(null)   // set while editing
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // A different user resets the panel; a success note clears itself after a few seconds.
  useEffect(() => { setSelected(''); setMessage(null); setProfile(null) }, [user?.id])
  useEffect(() => {
    if (message?.type !== 'success') return
    const timer = setTimeout(() => setMessage(null), 6000)
    return () => clearTimeout(timer)
  }, [message])

  const done = (key: string, role: string) => {
    void qc.invalidateQueries({ queryKey: ['admin-users'] })
    setMessage({ type: 'success', text: t(key, { role: roleLabelOf(role, t) }) })
  }
  const failed = (e: unknown) => setMessage({ type: 'error', text: describeApiError(e).message })

  const add = useMutation({
    mutationFn: (role: string) => usersApi.addRole(user!.id, role),
    onMutate: () => setMessage(null),
    onSuccess: (_u, role) => { setSelected(''); done('page.user_management_live.role_added', role) },
    onError: failed,
  })
  const revoke = useMutation({
    mutationFn: (role: string) => usersApi.revokeRole(user!.id, role),
    onMutate: () => setMessage(null),
    onSuccess: (_u, role) => done('page.user_management_live.role_revoked', role),
    onError: failed,
  })

  const saveProfile = useMutation({
    mutationFn: (v: { id: string; title: string; department: string }) => usersApi.updateProfile(v.id, { title: v.title.trim(), department: v.department.trim() }),
    onSuccess: async (_u, v) => {
      await qc.invalidateQueries({ queryKey: ['admin-users'] })
      setProfile(p => (user?.id === v.id ? null : p))
    },
  })
  const startEdit = (u: AdminUser) => { saveProfile.reset(); setProfile({ title: u.title ?? '', department: u.department ?? '' }) }

  const roles = user ? rolesOfUser(user) : []
  const active = user?.status === 'active'
  const onlyOne = roles.length <= 1
  const atCap = roles.length >= MAX_ROLES
  const available = ADDABLE_ROLES.filter(r => !roles.includes(r))
  const busy = add.isPending || revoke.isPending
  const adminAlone = roles.some(r => !canCombine([r], 'pm'))     // an admin role is never combined

  return (
    <SlidePanel open={!!user} onClose={onClose} title={t('page.user_management_live.detail_title')}
      storageKey="panel-width-user-detail" defaultWidth={520} closeOnOutsideClick belowTopBar>
      {user && (
        <div className="flex flex-col gap-4 p-5" data-panel="user-detail" data-user-id={user.id}>

          {/* Header */}
          <section className="rounded-lg border border-slate-200 bg-white p-5">
            <h3 className="truncate text-[20px] font-bold text-slate-900" data-detail-name>{user.name}</h3>
            <div className="mt-2"><StatusChip status={user.status} /></div>
          </section>

          {/* Details */}
          <section className="grid grid-cols-2 gap-x-6 gap-y-4 rounded-lg border border-slate-200 bg-white p-5 text-[13px]" data-detail-fields>
            {user.status !== 'deprovisioned' && !profile && (
              <button type="button" onClick={() => startEdit(user)} data-action="edit-profile"
                aria-label={t('page.user_management_live.edit_profile_aria')}
                className="col-span-2 -mb-2 justify-self-end text-[12px] font-medium text-indigo-700 hover:underline">
                {t('button.edit')}
              </button>
            )}
            <div>
              <p className="text-[11px] text-slate-500">{t('page.user_management_live.field_email')}</p>
              <p className="break-all font-mono text-[12px] text-slate-900" data-detail-email>{maskEmail(user.email)}</p>
            </div>
            <div>
              <p className="text-[11px] text-slate-500">{t('page.user_management_live.field_role')}</p>
              <p className="text-slate-900" data-detail-role>{roles.map(r => roleLabelOf(r, t)).join(', ')}</p>
            </div>
            <div>
              <p className="text-[11px] text-slate-500">{t('page.user_management_live.detail_job_title')}</p>
              {profile ? (
                <input value={profile.title} onChange={e => setProfile({ ...profile, title: e.currentTarget.value })} maxLength={120} autoFocus
                  aria-label={t('page.user_management_live.detail_job_title')} data-input="profile-title"
                  className="mt-1 h-9 w-full rounded-md border border-slate-300 px-2 text-[13px] text-slate-900" />
              ) : <p className="break-words text-slate-900" data-detail-title>{user.title || '—'}</p>}
            </div>
            <div>
              <p className="text-[11px] text-slate-500">{t('page.user_management_live.detail_department')}</p>
              {profile ? (
                <input value={profile.department} onChange={e => setProfile({ ...profile, department: e.currentTarget.value })} maxLength={120}
                  aria-label={t('page.user_management_live.detail_department')} data-input="profile-department"
                  className="mt-1 h-9 w-full rounded-md border border-slate-300 px-2 text-[13px] text-slate-900" />
              ) : <p className="break-words text-slate-900" data-detail-department>{user.department || '—'}</p>}
            </div>
            {profile && (
              <div className="col-span-2 flex flex-col gap-2">
                {saveProfile.isError && <p role="alert" data-profile-error className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-800">{describeApiError(saveProfile.error).message}</p>}
                <div className="flex gap-2">
                  <button type="button" data-action="save-profile"
                    disabled={saveProfile.isPending || (profile.title.trim() === (user.title ?? '') && profile.department.trim() === (user.department ?? ''))}
                    onClick={() => saveProfile.mutate({ id: user.id, ...profile })}
                    className="h-8 rounded-md bg-indigo-600 px-3 text-[12px] font-semibold text-white hover:bg-indigo-700 disabled:opacity-40">
                    {t('button.save')}
                  </button>
                  <button type="button" data-action="cancel-profile" disabled={saveProfile.isPending} onClick={() => setProfile(null)}
                    className="h-8 rounded-md border border-slate-300 bg-white px-3 text-[12px] font-semibold text-slate-700">
                    {t('button.cancel')}
                  </button>
                </div>
              </div>
            )}
            <div>
              <p className="text-[11px] text-slate-500">{t('page.user_management_live.col_tenant')}</p>
              <p className="text-slate-900" data-detail-tenant>{user.tenantName || user.tenantId || user.tenantRef || '—'}</p>
              {user.tenantRef && (user.tenantName || user.tenantId) && <p className="mt-0.5 font-mono text-[10px] text-slate-500">{t('page.user_management_live.tenant_ref_entered', { ref: user.tenantRef })}</p>}
            </div>
            <div>
              <p className="text-[11px] text-slate-500">{t('page.user_management_live.detail_activated')}</p>
              <p className="text-slate-900" data-detail-activated>{fmt(user.termsAcceptedAt)}</p>
            </div>
            <div>
              <p className="text-[11px] text-slate-500">{t('page.user_management_live.col_last_active')}</p>
              <p className="text-slate-900" data-detail-last-active>{fmt(user.lastActiveAt)}</p>
            </div>
            <div>
              <p className="text-[11px] text-slate-500">{t('page.user_management_live.detail_created')}</p>
              <p className="text-slate-900">{fmt(user.createdAt)}</p>
            </div>
          </section>

          {/* Roles */}
          <section className="rounded-lg border border-slate-200 bg-white p-5" data-detail-roles>
            <div className="flex items-baseline justify-between">
              <h4 className="text-[16px] font-bold text-slate-900">{t('page.user_management_live.roles_heading')}</h4>
              {active && <span className="text-[12px] text-slate-500" data-roles-count>{t('page.user_management_live.roles_active', { count: roles.length })}</span>}
            </div>

            {message && (
              <p role={message.type === 'error' ? 'alert' : 'status'} data-roles-message={message.type}
                className={`mt-3 rounded-md px-3 py-2 text-[12px] ${message.type === 'error' ? 'border border-red-200 bg-red-50 text-red-800' : 'text-green-700'}`}>
                {message.text}
              </p>
            )}

            <ul className="mt-3 flex flex-col gap-2">
              {roles.map(r => (
                <li key={r} className="flex items-center justify-between gap-3 rounded-lg border border-slate-300 px-4 py-2.5" data-role-item={r}>
                  <span className="text-[14px] font-medium text-slate-900">{roleLabelOf(r, t)}</span>
                  <SlideToRevoke label={roleLabelOf(r, t)} disabled={!active || onlyOne || busy} onRevoke={() => revoke.mutate(r)} />
                </li>
              ))}
            </ul>

            <div className="mt-4 border-t border-slate-200 pt-4">
              {!active ? (
                <p className="text-[12px] text-slate-400" data-roles-inactive>{t('page.user_management_live.roles_active_only')}</p>
              ) : (
                <>
                  <label htmlFor="add-role-select" className="text-[13px] font-semibold text-slate-800">{t('page.user_management_live.add_another_role')}</label>
                  <div className="mt-2 flex gap-2">
                    <select id="add-role-select" value={selected} onChange={e => setSelected(e.currentTarget.value)}
                      disabled={busy || atCap || available.length === 0} data-input="add-role"
                      className="h-10 min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-3 text-[13px] text-slate-900 disabled:bg-slate-50 disabled:text-slate-400">
                      <option value="">{t('page.user_management_live.select_role')}</option>
                      {available.map(r => {
                        const ok = canCombine(roles, r)
                        return (
                          <option key={r} value={r} disabled={!ok}>
                            {roleLabelOf(r, t)}{ok ? '' : ` — ${t('page.user_management_live.role_not_combinable')}`}
                          </option>
                        )
                      })}
                    </select>
                    <button type="button" disabled={!selected || busy || atCap} onClick={() => add.mutate(selected)} data-action="add-role"
                      className="h-10 rounded-md bg-indigo-600 px-4 text-[13px] font-semibold text-white hover:bg-indigo-700 disabled:opacity-40">
                      {t('page.user_management_live.add_role')}
                    </button>
                  </div>
                  {atCap && <p className="mt-1.5 text-[12px] text-slate-500" data-roles-max>{t('page.user_management_live.roles_max', { max: MAX_ROLES })}</p>}
                  {!atCap && adminAlone && (
                    <p className="mt-1.5 text-[12px] text-slate-500" data-roles-admin-alone>{t('page.user_management_live.roles_admin_alone')}</p>
                  )}
                </>
              )}
            </div>
          </section>

          {/* Footer actions — the same lifecycle actions as the row */}
          {(user.status === 'active' || user.status === 'suspended') && (
            <div className="flex">
              {user.status === 'active' ? (
                <button type="button" onClick={() => onSuspend(user)} data-action="panel-suspend"
                  className="rounded-md bg-red-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-red-700">
                  {t('page.user_management_live.suspend_user')}
                </button>
              ) : (
                <button type="button" onClick={() => onReactivate(user)} data-action="panel-unsuspend"
                  className="rounded-md bg-green-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-green-700">
                  {t('page.user_management_live.unsuspend_user')}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </SlidePanel>
  )
}
