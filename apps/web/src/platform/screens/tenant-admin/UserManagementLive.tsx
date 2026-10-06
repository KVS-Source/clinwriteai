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

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
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
  createdAt: string
  updatedAt: string
}

const ROLE_OPTIONS = [
  'super-admin', 'admin', 'clinical-writer', 'scientific-writer',
  'medical-writer', 'regulatory-writer', 'ideation-lead', 'reviewer', 'read-only',
] as const

const usersApi = {
  list:         () => api.get<AdminUser[]>('/admin/users'),
  invite:       (body: { email: string; name: string; role: string; modules?: string[]; tenantId?: string }) =>
    api.post<AdminUser>('/admin/users', body),
  suspend:      (id: string) => api.post<AdminUser>(`/admin/users/${id}/suspend`, {}),
  reactivate:   (id: string) => api.post<AdminUser>(`/admin/users/${id}/reactivate`, {}),
  deprovision:  (id: string) => api.delete<{ ok: true }>(`/admin/users/${id}`),
  resendInvite: (id: string) => api.post<{ ok: true; email: string; note: string }>(`/admin/users/${id}/resend-invite`, {}),
}

function StatusChip({ status }: { status: UserStatus }) {
  const palette: Record<UserStatus, { bg: string; fg: string; border: string; label: string }> = {
    active:        { bg: '#F0FDF4', fg: '#166534', border: '#BBF7D0', label: '✓ Active' },
    invited:       { bg: '#EFF6FF', fg: '#1D4ED8', border: '#BFDBFE', label: '📧 Invited' },
    suspended:     { bg: '#FFFBEB', fg: '#B45309', border: '#FDE68A', label: '⚠ Suspended' },
    deprovisioned: { bg: '#F1F5F9', fg: '#475569', border: '#CBD5E1', label: '○ Deprovisioned' },
  }
  const p = palette[status]
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium"
      style={{ backgroundColor: p.bg, color: p.fg, border: `1px solid ${p.border}` }}
    >{p.label}</span>
  )
}

function InviteForm({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient()
  const [email, setEmail] = useState('')
  const [name,  setName]  = useState('')
  const [role,  setRole]  = useState<string>('reviewer')
  const [tenantId, setTenantId] = useState('')
  const [err, setErr] = useState<string | null>(null)

  const invite = useMutation({
    mutationFn: () => usersApi.invite({
      email, name, role, tenantId: tenantId || undefined, modules: ['A'],
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-users'] })
      onDone()
    },
    onError: (e) => setErr(describeApiError(e).message),
  })

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4" data-section="invite-user">
      <h3 className="text-[13px] font-bold text-slate-900">Invite user</h3>
      <div className="mt-3 grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
        <input className="rounded-md border border-slate-300 px-2 py-1.5 text-[13px]" placeholder="name@example.com" value={email} onChange={e => setEmail(e.target.value)} data-input="email" />
        <input className="rounded-md border border-slate-300 px-2 py-1.5 text-[13px]" placeholder="Display name"      value={name}  onChange={e => setName(e.target.value)}  data-input="name" />
        <select className="rounded-md border border-slate-300 px-2 py-1.5 text-[13px]" value={role} onChange={e => setRole(e.target.value)} data-input="role">
          {ROLE_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
        <input className="rounded-md border border-slate-300 px-2 py-1.5 text-[13px]" placeholder="Tenant id (optional)" value={tenantId} onChange={e => setTenantId(e.target.value)} data-input="tenantId" />
      </div>
      {err && <p className="mt-2 rounded-md bg-red-50 p-2 text-[12px] text-red-800" data-error>{err}</p>}
      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={() => invite.mutate()}
          disabled={!email || !name || invite.isPending}
          className="rounded-md bg-slate-800 px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50"
          data-action="invite"
        >
          {invite.isPending ? 'Inviting…' : 'Send invite'}
        </button>
      </div>
    </div>
  )
}

export function UserManagementLive() {
  const qc = useQueryClient()
  const { data: users = [], isLoading, error } = useQuery<AdminUser[]>({
    queryKey: ['admin-users'],
    queryFn: () => usersApi.list(),
  })
  const [showInvite, setShowInvite] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

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
          <span>Admin</span>
          <span style={{ color: '#CBD5E1' }}>&gt;</span>
          <span className="font-semibold text-slate-900">User Management</span>
        </nav>

        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-[22px] font-bold text-slate-900">User management</h1>
            <p className="mt-1 text-[12px] text-slate-500">
              {isLoading ? 'Loading…' : `${users.length} user${users.length === 1 ? '' : 's'}`}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowInvite(v => !v)}
            className="h-9 rounded-md bg-slate-800 px-3 text-[13px] font-semibold text-white hover:bg-slate-700"
            data-action="toggle-invite"
          >{showInvite ? 'Hide invite form' : '+ Invite user'}</button>
        </div>

        {error && <p className="rounded-md bg-red-50 p-3 text-[13px] text-red-800">{describeApiError(error).message}</p>}
        {actionError && <p className="rounded-md bg-red-50 p-3 text-[13px] text-red-800" data-error>{actionError}</p>}

        {showInvite && <InviteForm onDone={() => setShowInvite(false)} />}

        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-[13px]">
            <thead style={{ backgroundColor: '#F8FAFC' }}>
              <tr className="text-left text-[11px] font-semibold uppercase tracking-widest text-slate-500">
                <th className="px-4 py-2">User</th>
                <th className="px-4 py-2">Role</th>
                <th className="px-4 py-2">Tenant</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2 text-right">Actions</th>
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
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex items-center gap-2">
                      {u.status === 'invited' && (
                        <button type="button" onClick={() => wrap(usersApi.resendInvite(u.id))} className="text-[11px] text-slate-700 hover:underline" data-action="resend-invite">Resend</button>
                      )}
                      {u.status === 'active' && (
                        <button type="button" onClick={() => wrap(usersApi.suspend(u.id))} className="text-[11px] text-amber-700 hover:underline" data-action="suspend">Suspend</button>
                      )}
                      {u.status === 'suspended' && (
                        <button type="button" onClick={() => wrap(usersApi.reactivate(u.id))} className="text-[11px] text-green-700 hover:underline" data-action="reactivate">Reactivate</button>
                      )}
                      {u.status !== 'deprovisioned' && (
                        <button
                          type="button"
                          onClick={() => {
                            if (confirm(`Deprovision ${u.email}? User cannot be re-activated — invite as a new user instead.`)) {
                              wrap(usersApi.deprovision(u.id))
                            }
                          }}
                          className="text-[11px] text-red-700 hover:underline"
                          data-action="deprovision"
                        >Deprovision</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {users.length === 0 && !isLoading && (
                <tr><td colSpan={5} className="px-4 py-6 text-center text-[12px] text-slate-500">No users yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
