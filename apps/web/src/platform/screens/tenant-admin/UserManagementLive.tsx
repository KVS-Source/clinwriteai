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

import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { describeApiError } from '../../../api'
import { SortIcon } from '../../../components/ui/SortIcon'
import { maskEmail } from '../../../utils/maskEmail'
import {
  ROLE_OPTIONS, StatusChip, roleLabelOf, rolesOfUser, usersApi,
  type AdminUser, type InviteLink, type UserStatus,
} from './userAdminShared'
import { UserDetailPanel } from './UserDetailPanel'

// Filter / sort state for the table. Filtering and sorting run client-side
// over the full /admin/users list (already scoped to the admin's tenant).
type SortKey = 'name' | 'role' | 'tenant' | 'status' | 'lastActive'
type SortDir = 'asc' | 'desc'

const STATUS_ORDER: UserStatus[] = ['active', 'invited', 'suspended', 'deprovisioned']

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

// Tenant column: the tenant the account is linked to (CW-099); without one, the Tenant ID the user
// typed when registering. When there are both, the typed ID is shown underneath.
const tenantOf = (u: AdminUser) => u.tenantName || u.tenantId || u.tenantRef || null
const linkedTenant = (u: AdminUser) => u.tenantName || u.tenantId || null

// The invite form asks only for email + role. The API still needs a display
// name, so derive one from the address: "jane.doe@acme.com" \u2192 "Jane Doe".
function nameFromEmail(email: string): string {
  const local = email.split('@')[0] ?? ''
  const words = local.split(/[._\-+]+/).filter(Boolean)
  const name = words.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
  return name || local || email
}

function InviteForm({ onDone }: { onDone: (email: string, link: InviteLink) => void }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [email, setEmail] = useState('')
  // No role until one is chosen: the dropdown shows a grey "Select a role" placeholder, and Send invite waits for it.
  const [role,  setRole]  = useState<string>('')
  const [err, setErr] = useState<string | null>(null)

  // Pasted addresses can carry stray spaces or zero-width characters that fail validation.
  const cleanEmail = email.replace(/[\s\u200B-\u200D\uFEFF]/g, '')

  // No tenant is sent: the API puts the invitee in the inviting admin's tenant.
  const invite = useMutation({
    mutationFn: () => usersApi.invite({ email: cleanEmail, name: nameFromEmail(cleanEmail), role, modules: ['A'] }),
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
      <div className="mt-3 grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
        <label className="flex flex-col gap-1 text-[11px] font-semibold text-slate-600">
          {t('page.user_management_live.field_email')}
          <input type="email" className="rounded-md border border-slate-300 px-2 py-1.5 text-[13px] font-normal text-slate-900" placeholder={t('page.user_management_live.email_placeholder')} value={email} onChange={e => { setEmail(e.target.value); setErr(null) }} data-input="email" />
        </label>
        <label className="flex flex-col gap-1 text-[11px] font-semibold text-slate-600">
          {t('page.user_management_live.field_role')}
          <select
            className={`rounded-md border border-slate-300 px-2 py-1.5 text-[13px] font-normal ${role ? 'text-slate-900' : 'text-slate-400'}`}
            value={role}
            onChange={e => { setRole(e.target.value); setErr(null) }}
            title={activeRoleDesc ? t(activeRoleDesc) : undefined}
            data-input="role" data-placeholder-shown={!role || undefined}
          >
            <option value="" disabled hidden>{t('page.user_management_live.role_placeholder')}</option>
            {ROLE_OPTIONS.map(r => <option key={r.value} value={r.value} title={t(r.descriptionKey)} className="text-slate-900">{t(r.labelKey)}</option>)}
          </select>
        </label>
      </div>
      {err && <p className="mt-2 rounded-md bg-red-50 p-2 text-[12px] text-red-800" data-error>{err}</p>}
      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={() => {
            if (!/^[^@]+@[^@]+\.[^@]+$/.test(cleanEmail)) {
              setErr(t('page.user_management_live.err_invalid_email', { email: email.trim() }))
              return
            }
            invite.mutate()
          }}
          disabled={!cleanEmail || !role || invite.isPending}
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
  // The user whose details are open in the right-hand panel (always read from the fresh list).
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selectedUser = users.find(u => u.id === selectedId) ?? null

  // --- filters + sort ---------------------------------------------------
  const [statusFilter, setStatusFilter] = useState<'all' | UserStatus>('all')
  const [roleFilter,   setRoleFilter]   = useState<string>('all')
  const [search,       setSearch]       = useState('')
  // null = keep the API order (newest first) until a header is clicked.
  const [sort, setSort] = useState<SortKey | null>(null)
  const [dir,  setDir]  = useState<SortDir>('asc')

  // Roles offered in the filter: the canonical five only. Users still on a
  // legacy role (e.g. clinical-writer) show under "All Roles".
  const roleOptions = ROLE_OPTIONS.map(r => r.value)

  const filtersActive = statusFilter !== 'all' || roleFilter !== 'all' || search.trim() !== ''
  const clearFilters = () => { setStatusFilter('all'); setRoleFilter('all'); setSearch('') }

  const visibleUsers = useMemo(() => {
    const q = search.trim().toLowerCase()
    const filtered = users.filter(u =>
      (statusFilter === 'all' || u.status === statusFilter) &&
      (roleFilter === 'all' || rolesOfUser(u).includes(roleFilter)) &&
      (!q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)),
    )
    if (!sort) return filtered

    const byName = (a: AdminUser, b: AdminUser) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    const sign = dir === 'asc' ? 1 : -1
    return [...filtered].sort((a, b) => {
      let c = 0
      switch (sort) {
        case 'name':   c = byName(a, b); break
        case 'role':   c = roleLabelOf(a.role, t).localeCompare(roleLabelOf(b.role, t), undefined, { sensitivity: 'base' }); break
        case 'status': c = STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status); break
        case 'tenant':
        case 'lastActive': {
          const av = sort === 'tenant' ? tenantOf(a) : a.lastActiveAt
          const bv = sort === 'tenant' ? tenantOf(b) : b.lastActiveAt
          // Blank tenant / never-active rows always sink to the bottom.
          if (!av || !bv) return av === bv ? byName(a, b) : av ? -1 : 1
          c = sort === 'tenant' ? av.localeCompare(bv) : new Date(av).getTime() - new Date(bv).getTime()
          break
        }
      }
      return c !== 0 ? c * sign : byName(a, b)
    })
    // Role labels come from t(); re-sort when the language changes.
  }, [users, statusFilter, roleFilter, search, sort, dir, t])

  const toggleSort = (key: SortKey) => {
    if (sort === key) setDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else { setSort(key); setDir(key === 'lastActive' ? 'desc' : 'asc') }
  }

  // A render helper (not a nested component) so headers don't remount on every render.
  const th = (label: string, key?: SortKey, className = '') => (
    <th
      scope="col"
      aria-sort={key && sort === key ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={`px-4 py-2 ${className}`}
    >
      {key ? (
        <button type="button" onClick={() => toggleSort(key)} className="inline-flex items-center gap-1.5 uppercase tracking-widest hover:text-slate-800" data-sort={key}>
          {label}<SortIcon state={sort === key ? dir : null} />
        </button>
      ) : label}
    </th>
  )

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
              {isLoading
                ? t('status.loading')
                : filtersActive
                  ? t('page.user_management_live.showing_count', { shown: visibleUsers.length, total: users.length })
                  : t('page.user_management_live.user_count', { count: users.length })}
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
                ? t('page.user_management_live.invite_resent_notice', { email: maskEmail(inviteLink.email) })
                : t('page.user_management_live.invite_sent_notice')}
            </p>
            <div className="mt-2 flex gap-3">
              <button type="button" className="underline" data-action="dismiss-invite-link" onClick={() => setInviteLink(null)}>{t('page.user_management_live.dismiss')}</button>
            </div>
          </div>
        )}

        {/* Filter bar: status, role, search (name / email), clear. */}
        <div className="flex flex-wrap items-center gap-3" data-section="user-filters">
          {/* With no filter chosen, each box shows a grey placeholder ("All Status"), like the search box. The
              placeholder is a hidden option (value ""), so the list itself offers "All …" and every value; choosing
              "All …" clears the filter and the placeholder shows again. */}
          <select
            value={statusFilter === 'all' ? '' : statusFilter}
            onChange={e => setStatusFilter((e.currentTarget.value || 'all') as 'all' | UserStatus)}
            aria-label={t('page.user_management_live.filter_status_aria')}
            data-filter="status" data-placeholder-shown={statusFilter === 'all' || undefined}
            className={`h-9 min-w-[160px] rounded-md border border-slate-200 bg-white px-3 font-mono text-[12px] ${statusFilter === 'all' ? 'text-slate-400' : 'text-slate-900'}`}
          >
            <option value="" disabled hidden>{t('page.user_management_live.filter_status_placeholder')}</option>
            <option value="all" className="text-slate-900">{t('page.user_management_live.filter_all_status')}</option>
            {STATUS_ORDER.map(s => <option key={s} value={s} className="text-slate-900">{t(`page.user_management_live.status_${s}`)}</option>)}
          </select>
          <select
            value={roleFilter === 'all' ? '' : roleFilter}
            onChange={e => setRoleFilter(e.currentTarget.value || 'all')}
            aria-label={t('page.user_management_live.filter_role_aria')}
            data-filter="role" data-placeholder-shown={roleFilter === 'all' || undefined}
            className={`h-9 min-w-[170px] rounded-md border border-slate-200 bg-white px-3 font-mono text-[12px] ${roleFilter === 'all' ? 'text-slate-400' : 'text-slate-900'}`}
          >
            <option value="" disabled hidden>{t('page.user_management_live.filter_role_placeholder')}</option>
            <option value="all" className="text-slate-900">{t('page.user_management_live.filter_all_roles')}</option>
            {roleOptions.map(r => <option key={r} value={r} className="text-slate-900">{roleLabelOf(r, t)}</option>)}
          </select>
          <div className="flex h-9 min-w-[240px] flex-1 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 focus-within:border-slate-800">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="#94A3B8" strokeWidth="1.5" aria-hidden="true"><circle cx="7" cy="7" r="4.5" /><path d="m10.5 10.5 3.5 3.5" strokeLinecap="round" /></svg>
            <input
              type="search"
              value={search}
              onChange={e => setSearch(e.currentTarget.value)}
              placeholder={t('page.user_management_live.search_placeholder')}
              aria-label={t('page.user_management_live.search_aria')}
              data-filter="search"
              className="w-full border-none bg-transparent font-mono text-[12px] text-slate-900 outline-none placeholder:text-slate-400"
            />
          </div>
          <button
            type="button"
            onClick={clearFilters}
            disabled={!filtersActive}
            className="inline-flex items-center gap-1.5 font-mono text-[12px] text-slate-500 hover:text-slate-900 disabled:cursor-default disabled:opacity-50 disabled:hover:text-slate-500"
            data-action="clear-filters"
          >
            <span aria-hidden="true">✕</span>{t('page.user_management_live.clear_filters')}
          </button>
        </div>

        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-[13px]">
            <thead style={{ backgroundColor: '#F8FAFC' }}>
              <tr className="text-left text-[11px] font-semibold uppercase tracking-widest text-slate-500">
                {th(t('page.user_management_live.col_user'), 'name')}
                {th(t('page.user_management_live.col_role'), 'role')}
                {th(t('page.user_management_live.col_tenant'), 'tenant')}
                {th(t('page.user_management_live.col_status'), 'status')}
                {th(t('page.user_management_live.col_last_active'), 'lastActive')}
                {th(t('page.user_management_live.col_actions'), undefined, 'text-right')}
              </tr>
            </thead>
            <tbody>
              {visibleUsers.map(u => (
                <tr
                  key={u.id}
                  className={`cursor-pointer border-t border-slate-200 hover:bg-slate-50 ${selectedId === u.id ? 'bg-indigo-50/60' : ''}`}
                  data-user-row={u.id}
                  // Opens the details panel; marked as a panel trigger so picking another row switches it.
                  data-panel-trigger
                  data-selected={selectedId === u.id || undefined}
                  tabIndex={0}
                  aria-label={t('page.user_management_live.open_details_aria', { name: u.name })}
                  onClick={() => setSelectedId(u.id)}
                  onKeyDown={e => { if (e.key === 'Enter' && e.target === e.currentTarget) setSelectedId(u.id) }}
                >
                  <td className="px-4 py-3">
                    <p className="font-semibold text-slate-900">{u.name}</p>
                    {/* Masked for display: first character, then * for every letter / digit. */}
                    <p className="mt-0.5 font-mono text-[10px] text-slate-500" data-user-email>{maskEmail(u.email)}</p>
                  </td>
                  <td className="px-4 py-3 text-slate-700" data-user-roles>{rolesOfUser(u).map(r => roleLabelOf(r, t)).join(', ')}</td>
                  <td className="px-4 py-3 text-[12px] text-slate-700" data-tenant-cell>
                    <p>{tenantOf(u) ?? '—'}</p>
                    {u.tenantRef && linkedTenant(u) && (
                      <p className="mt-0.5 font-mono text-[10px] text-slate-500" data-tenant-ref>
                        {t('page.user_management_live.tenant_ref_entered', { ref: u.tenantRef })}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3"><StatusChip status={u.status} /></td>
                  <td className="px-4 py-3 text-[12px] text-slate-600" data-last-active>
                    {u.lastActiveAt
                      ? <span title={new Date(u.lastActiveAt).toLocaleString()}>{formatLastActive(u.lastActiveAt, t)}</span>
                      : <span className="text-slate-400">{t('page.user_management_live.never_active')}</span>}
                  </td>
                  <td className="px-4 py-3 text-right" onClick={e => e.stopPropagation()}>
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
                        <button type="button" onClick={() => wrap(usersApi.reactivate(u.id))} className="text-[11px] text-green-700 hover:underline" data-action="unsuspend">{t('page.user_management_live.reactivate')}</button>
                      )}
                      {u.status !== 'deprovisioned' && (
                        <button
                          type="button"
                          onClick={() => {
                            if (confirm(t('page.user_management_live.confirm_deprovision', { email: maskEmail(u.email) }))) {
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
                <tr><td colSpan={6} className="px-4 py-6 text-center text-[12px] text-slate-500">{t('page.user_management_live.no_users')}</td></tr>
              )}
              {users.length > 0 && visibleUsers.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-[12px] text-slate-500" data-empty-filtered>
                    {t('page.user_management_live.no_matches')}{' '}
                    <button type="button" onClick={clearFilters} className="font-semibold text-blue-600 hover:text-blue-700">{t('page.user_management_live.clear_filters')}</button>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <UserDetailPanel
        user={selectedUser}
        onClose={() => setSelectedId(null)}
        onSuspend={u => wrap(usersApi.suspend(u.id))}
        onReactivate={u => wrap(usersApi.reactivate(u.id))}
      />
    </div>
  )
}
