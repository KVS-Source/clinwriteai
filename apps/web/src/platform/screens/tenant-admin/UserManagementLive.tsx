// User management (live) — Arc 4.5 of docs/pivot-plan.md.
//
// A lean rewiring of the admin user-management surface against the real
// API. Covers the four lifecycle actions landed in Arc 3.3 (invite /
// resend / suspend / reactivate) + deprovision from the pre-existing
// users route.
//
// Separate from the existing UserManagement.tsx screen (which stays in
// place for the broader mock-driven admin dashboard view) so this one
// can be the home for the real API wiring without churning the UX of
// the older screen.

import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { describeApiError } from '../../../api'
import { api } from '../../../api/client'

type UserStatus = 'invited' | 'active' | 'suspended' | 'deprovisioned'

interface AdminUser {
  id: string
  email: string
  name: string
  initials: string | null
  role: string
  modules: string[]
  status: UserStatus
  tenantId: string | null
  lastActiveAt: string | null   // stamped on each sign-in (auth/routes.ts)
  createdAt: string
  updatedAt: string
}

// "Last active" cell: relative for the last week, a date after that.
function formatLastActive(iso: string, t: (k: string, o?: Record<string, unknown>) => string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000)
  if (mins < 1)  return t('page.user_management_live.last_active_just_now')
  if (mins < 60) return t('page.user_management_live.last_active_mins', { count: mins })
  const hours = Math.floor(mins / 60)
  if (hours < 24) return t('page.user_management_live.last_active_hours', { count: hours })
  const days = Math.floor(hours / 24)
  if (days < 7) return t('page.user_management_live.last_active_days', { count: days })
  return new Date(iso).toLocaleDateString()
}

// One-time sign-up link returned by invite / resend (valid 7 days). Shown to
// the admin to share until email dispatch is wired.
interface InviteLink {
  inviteUrl: string
  inviteExpiresAt: string
}

// Role dropdown for the invite / edit forms.
//
// Canonical set after migration 48 (docs/roles-and-permissions.md §2):
//   tenant-admin | pm | contributor | auditor | guest
//
// Legacy role names (admin, clinical-writer, …) are still accepted by
// the API for existing users whose rows haven't been rewritten, but
// new invites should always use the canonical names — hence the
// dropdown is filtered down to the five.
const ROLE_OPTIONS: { value: string; labelKey: string; descriptionKey: string }[] = [
  { value: 'tenant-admin', labelKey: 'page.user_management_live.role_label_tenant_admin', descriptionKey: 'page.user_management_live.role_desc_tenant_admin' },
  { value: 'pm',           labelKey: 'page.user_management_live.role_label_pm',           descriptionKey: 'page.user_management_live.role_desc_pm' },
  { value: 'contributor',  labelKey: 'page.user_management_live.role_label_contributor',  descriptionKey: 'page.user_management_live.role_desc_contributor' },
  { value: 'auditor',      labelKey: 'page.user_management_live.role_label_auditor',      descriptionKey: 'page.user_management_live.role_desc_auditor' },
  { value: 'guest',        labelKey: 'page.user_management_live.role_label_guest',        descriptionKey: 'page.user_management_live.role_desc_guest' },
]

const usersApi = {
  list:         () => api.get<AdminUser[]>('/admin/users'),
  invite:       (body: { email: string; name: string; role: string; modules?: string[]; tenantId?: string }) =>
    api.post<AdminUser & InviteLink>('/admin/users', body),
  suspend:      (id: string) => api.post<AdminUser>(`/admin/users/${id}/suspend`, {}),
  reactivate:   (id: string) => api.post<AdminUser>(`/admin/users/${id}/reactivate`, {}),
  deprovision:  (id: string) => api.delete<{ ok: true }>(`/admin/users/${id}`),
  resendInvite: (id: string) => api.post<{ ok: true; email: string; note: string } & InviteLink>(`/admin/users/${id}/resend-invite`, {}),
}

function StatusChip({ status }: { status: UserStatus }) {
  const { t } = useTranslation()
  const palette: Record<UserStatus, { bg: string; fg: string; border: string; label: string }> = {
    active:        { bg: '#F0FDF4', fg: '#166534', border: '#BBF7D0', label: `✓ ${t('page.user_management_live.status_active')}` },
    invited:       { bg: '#EFF6FF', fg: '#1D4ED8', border: '#BFDBFE', label: `📧 ${t('page.user_management_live.status_invited')}` },
    suspended:     { bg: '#FFFBEB', fg: '#B45309', border: '#FDE68A', label: `⚠ ${t('page.user_management_live.status_suspended')}` },
    deprovisioned: { bg: '#F1F5F9', fg: '#475569', border: '#CBD5E1', label: `○ ${t('page.user_management_live.status_deprovisioned')}` },
  }
  const p = palette[status]
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium"
      style={{ backgroundColor: p.bg, color: p.fg, border: `1px solid ${p.border}` }}
    >{p.label}</span>
  )
}

function InviteForm({ onDone }: { onDone: (email: string, link: InviteLink) => void }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [email, setEmail] = useState('')
  const [name,  setName]  = useState('')
  const [role,  setRole]  = useState<string>('contributor')
  const [tenantId, setTenantId] = useState('')
  const [err, setErr] = useState<string | null>(null)

  const invite = useMutation({
    // Pasted addresses can carry stray spaces or zero-width characters that fail validation.
    mutationFn: () => usersApi.invite({
      email: email.replace(/[\s​-‍﻿]/g, ''),
      name: name.trim(), role, tenantId: tenantId.trim() || undefined, modules: ['A'],
    }),
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: ['admin-users'] })
      onDone(created.email, { inviteUrl: created.inviteUrl, inviteExpiresAt: created.inviteExpiresAt })
    },
    onError: (e) => setErr(describeApiError(e).message),
  })

  const activeRoleDesc = ROLE_OPTIONS.find(r => r.value === role)?.descriptionKey
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4" data-section="invite-user">
      <h3 className="text-[13px] font-bold text-slate-900">{t('page.user_management_live.invite_user_heading')}</h3>
      {/* Labelled fields, name first: with placeholders only, a filled form gave no hint which
          box was which and names typed into the email box came back as "Invalid email". */}
      <div className="mt-3 grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
        <label className="flex flex-col gap-1 text-[11px] font-semibold text-slate-600">
          {t('page.user_management_live.field_display_name')}
          <input className="rounded-md border border-slate-300 px-2 py-1.5 text-[13px] font-normal text-slate-900" placeholder={t('page.user_management_live.display_name_placeholder')} value={name} onChange={e => { setName(e.target.value); setErr(null) }} data-input="name" />
        </label>
        <label className="flex flex-col gap-1 text-[11px] font-semibold text-slate-600">
          {t('page.user_management_live.field_email')}
          <input type="email" className="rounded-md border border-slate-300 px-2 py-1.5 text-[13px] font-normal text-slate-900" placeholder={t('page.user_management_live.email_placeholder')} value={email} onChange={e => { setEmail(e.target.value); setErr(null) }} data-input="email" />
        </label>
        <label className="flex flex-col gap-1 text-[11px] font-semibold text-slate-600">
          {t('page.user_management_live.field_role')}
          <select
            className="rounded-md border border-slate-300 px-2 py-1.5 text-[13px] font-normal text-slate-900"
            value={role}
            onChange={e => setRole(e.target.value)}
            title={activeRoleDesc ? t(activeRoleDesc) : undefined}
            data-input="role"
          >
            {ROLE_OPTIONS.map(r => <option key={r.value} value={r.value} title={t(r.descriptionKey)}>{t(r.labelKey)}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[11px] font-semibold text-slate-600">
          {t('page.user_management_live.field_tenant_id')}
          <input className="rounded-md border border-slate-300 px-2 py-1.5 text-[13px] font-normal text-slate-900" placeholder={t('page.user_management_live.tenant_id_placeholder')} value={tenantId} onChange={e => setTenantId(e.target.value)} data-input="tenantId" />
        </label>
      </div>
      {err && <p className="mt-2 rounded-md bg-red-50 p-2 text-[12px] text-red-800" data-error>{err}</p>}
      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={() => {
            const clean = email.replace(/[\s​-‍﻿]/g, '')
            if (!/^[^@]+@[^@]+\.[^@]+$/.test(clean)) {
              setErr(name.includes('@')
                ? t('page.user_management_live.err_swap_fields')
                : t('page.user_management_live.err_invalid_email', { email: email.trim() }))
              return
            }
            invite.mutate()
          }}
          disabled={!email || !name || invite.isPending}
          className="rounded-md bg-slate-800 px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50"
          data-action="invite"
        >
          {invite.isPending ? t('page.user_management_live.inviting') : t('page.user_management_live.send_invite')}
        </button>
      </div>
    </div>
  )
}

export function UserManagementLive() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const { data: users = [], isLoading, error } = useQuery<AdminUser[]>({
    queryKey: ['admin-users'],
    queryFn: () => usersApi.list(),
  })
  const [showInvite, setShowInvite] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [inviteLink, setInviteLink] = useState<(InviteLink & { email: string; kind?: 'sent' | 'resent' }) | null>(null)
  // Per-row Resend feedback, shown next to the button the admin clicked
  // (the top banner can be off-screen, or already showing identical text).
  const [resendState, setResendState] = useState<{ id: string; phase: 'sending' | 'done' | 'failed'; message?: string } | null>(null)
  const noticeRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (inviteLink) noticeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [inviteLink])

  function resend(u: AdminUser) {
    setResendState({ id: u.id, phase: 'sending' })
    usersApi.resendInvite(u.id)
      .then(r => {
        setActionError(null)
        setInviteLink({ email: r.email, inviteUrl: r.inviteUrl, inviteExpiresAt: r.inviteExpiresAt, kind: 'resent' })
        setResendState({ id: u.id, phase: 'done' })
      })
      .catch(e => {
        const message = describeApiError(e).message
        setActionError(message)
        setResendState({ id: u.id, phase: 'failed', message })
      })
      .finally(() => {
        // Clear the inline confirmation after a few seconds.
        setTimeout(() => setResendState(s => (s?.id === u.id && s.phase !== 'sending' ? null : s)), 5000)
      })
  }

  function wrap<T>(p: Promise<T>) {
    return p.then(() => {
      setActionError(null)
      qc.invalidateQueries({ queryKey: ['admin-users'] })
    }).catch(e => setActionError(describeApiError(e).message))
  }

  return (
    <div className="bg-slate-50" data-screen="user-management-live">
      <div className="flex flex-col gap-4" style={{ maxWidth: 1280, padding: '20px 32px 48px' }}>
        <nav className="flex items-center gap-2 text-xs text-slate-500">
          <span>{t('page.user_management_live.crumb_admin')}</span>
          <span style={{ color: '#CBD5E1' }}>&gt;</span>
          <span className="font-semibold text-slate-900">{t('page.user_management_live.crumb_user_management')}</span>
        </nav>

        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-[22px] font-bold text-slate-900">{t('page.user_management_live.title')}</h1>
            <p className="mt-1 text-[12px] text-slate-500">
              {isLoading ? t('status.loading') : t('page.user_management_live.user_count', { count: users.length })}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowInvite(v => !v)}
            className="h-9 rounded-md bg-slate-800 px-3 text-[13px] font-semibold text-white hover:bg-slate-700"
            data-action="toggle-invite"
          >{showInvite ? t('page.user_management_live.hide_invite_form') : t('page.user_management_live.invite_user_button')}</button>
        </div>

        {error && <p className="rounded-md bg-red-50 p-3 text-[13px] text-red-800">{describeApiError(error).message}</p>}
        {actionError && <p className="rounded-md bg-red-50 p-3 text-[13px] text-red-800" data-error>{actionError}</p>}

        {showInvite && (
          <InviteForm onDone={(email, link) => { setShowInvite(false); setInviteLink({ email, ...link, kind: 'sent' }) }} />
        )}

        {inviteLink && (
          <div ref={noticeRef} className="rounded-md border border-blue-200 bg-blue-50 p-3 text-[12px] text-blue-900" data-section="invite-link">
            <p className="font-semibold">
              {inviteLink.kind === 'resent'
                ? t('page.user_management_live.invite_resent_notice', { email: inviteLink.email })
                : t('page.user_management_live.invite_sent_notice')}
            </p>
            <div className="mt-2 flex gap-3">
              <button type="button" className="underline" data-action="dismiss-invite-link" onClick={() => setInviteLink(null)}>{t('page.user_management_live.dismiss')}</button>
            </div>
          </div>
        )}

        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-[13px]">
            <thead style={{ backgroundColor: '#F8FAFC' }}>
              <tr className="text-left text-[11px] font-semibold uppercase tracking-widest text-slate-500">
                <th className="px-4 py-2">{t('page.user_management_live.col_user')}</th>
                <th className="px-4 py-2">{t('page.user_management_live.col_role')}</th>
                <th className="px-4 py-2">{t('page.user_management_live.col_tenant')}</th>
                <th className="px-4 py-2">{t('page.user_management_live.col_status')}</th>
                <th className="px-4 py-2">{t('page.user_management_live.col_last_active')}</th>
                <th className="px-4 py-2 text-right">{t('page.user_management_live.col_actions')}</th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id} className="border-t border-slate-200" data-user-row={u.id}>
                  <td className="px-4 py-3">
                    <p className="font-semibold text-slate-900">{u.name}</p>
                    <p className="mt-0.5 font-mono text-[10px] text-slate-500">{u.email}</p>
                  </td>
                  <td className="px-4 py-3 text-slate-700">{u.role}</td>
                  <td className="px-4 py-3 font-mono text-[11px] text-slate-500">{u.tenantId ?? '—'}</td>
                  <td className="px-4 py-3"><StatusChip status={u.status} /></td>
                  <td className="px-4 py-3 text-[12px] text-slate-600" data-last-active>
                    {u.lastActiveAt
                      ? <span title={new Date(u.lastActiveAt).toLocaleString()}>{formatLastActive(u.lastActiveAt, t)}</span>
                      : <span className="text-slate-400">{t('page.user_management_live.never_active')}</span>}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex items-center gap-2">
                      {u.status === 'invited' && resendState?.id === u.id && resendState.phase === 'done' && (
                        <span className="text-[11px] font-semibold text-green-700" data-resend-done>{t('page.user_management_live.resent_marker')}</span>
                      )}
                      {u.status === 'invited' && resendState?.id === u.id && resendState.phase === 'failed' && (
                        <span className="text-[11px] font-semibold text-red-700" title={resendState.message} data-resend-failed>{t('page.user_management_live.resend_failed')}</span>
                      )}
                      {u.status === 'invited' && (
                        <button
                          type="button"
                          onClick={() => resend(u)}
                          disabled={resendState?.id === u.id && resendState.phase === 'sending'}
                          className="text-[11px] text-slate-700 hover:underline disabled:cursor-wait disabled:opacity-60"
                          data-action="resend-invite"
                        >{resendState?.id === u.id && resendState.phase === 'sending' ? t('page.user_management_live.sending') : t('page.user_management_live.resend')}</button>
                      )}
                      {u.status === 'active' && (
                        <button type="button" onClick={() => wrap(usersApi.suspend(u.id))} className="text-[11px] text-amber-700 hover:underline" data-action="suspend">{t('page.user_management_live.suspend')}</button>
                      )}
                      {u.status === 'suspended' && (
                        <button type="button" onClick={() => wrap(usersApi.reactivate(u.id))} className="text-[11px] text-green-700 hover:underline" data-action="reactivate">{t('page.user_management_live.reactivate')}</button>
                      )}
                      {u.status !== 'deprovisioned' && (
                        <button
                          type="button"
                          onClick={() => {
                            if (confirm(t('page.user_management_live.confirm_deprovision', { email: u.email }))) {
                              wrap(usersApi.deprovision(u.id))
                            }
                          }}
                          className="text-[11px] text-red-700 hover:underline"
                          data-action="deprovision"
                        >{t('page.user_management_live.deprovision')}</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {users.length === 0 && !isLoading && (
                <tr><td colSpan={5} className="px-4 py-6 text-center text-[12px] text-slate-500">{t('page.user_management_live.no_users')}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
