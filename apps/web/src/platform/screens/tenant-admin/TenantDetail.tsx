// Tenant detail — Arc 4.4 of docs/pivot-plan.md.
//
// Three sections: identity (name/slug/status + archive/suspend),
// module toggles (checkbox grid, PATCH /modules on change), and a
// member list drawn from the memberships API. SSO lives on a separate
// screen linked from here to keep the main detail screen scannable.

import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  useArchiveTenant, useMemberships, useSetTenantModules, useSuspendTenant,
  useTenant, useUpdateMembership, useRemoveMembership, type Membership, type ModuleKey,
} from '../../../hooks'
import { describeApiError } from '../../../api'

const MODULE_META: Record<ModuleKey, { label: string; colour: string }> = {
  A: { label: 'Clinical Writing',      colour: '#2563EB' },
  B: { label: 'Scientific Writing',    colour: '#0D9488' },
  C: { label: 'Medical Writing',       colour: '#7C3AED' },
  D: { label: 'Regulatory Writing',    colour: '#B0200D' },
  E: { label: 'Ideation & Publishing', colour: '#0D9488' },
}
const ALL_MODULES: ModuleKey[] = ['A', 'B', 'C', 'D', 'E']
const ROLE_OPTIONS: Membership['role'][] = ['owner', 'admin', 'writer', 'reviewer', 'viewer']

function StatusChip({ status }: { status: 'active' | 'suspended' | 'archived' | Membership['status'] }) {
  const palette: Record<string, { bg: string; fg: string; border: string; label: string }> = {
    active:    { bg: '#F0FDF4', fg: '#166534', border: '#BBF7D0', label: '✓ Active' },
    suspended: { bg: '#FFFBEB', fg: '#B45309', border: '#FDE68A', label: '⚠ Suspended' },
    archived:  { bg: '#F1F5F9', fg: '#475569', border: '#CBD5E1', label: '○ Archived' },
    invited:   { bg: '#EFF6FF', fg: '#1D4ED8', border: '#BFDBFE', label: '📧 Invited' },
  }
  const p = palette[status] ?? palette.active!
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium"
      style={{ backgroundColor: p.bg, color: p.fg, border: `1px solid ${p.border}` }}
    >{p.label}</span>
  )
}

export function TenantDetail() {
  const { tenantId } = useParams<{ tenantId: string }>()
  const { data: tenant, error: tenantError } = useTenant(tenantId)
  const { data: members = [], error: membersError } = useMemberships(tenantId)

  const setModules  = useSetTenantModules(tenantId ?? '')
  const suspend     = useSuspendTenant(tenantId ?? '')
  const archive     = useArchiveTenant(tenantId ?? '')
  const updateMembership = useUpdateMembership(tenantId ?? '')
  const removeMembership = useRemoveMembership(tenantId ?? '')

  const [pendingModules, setPendingModules] = useState<ModuleKey[] | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  // Reset the pending set whenever the tenant row changes server-side so
  // the checkboxes stay in sync with the latest truth.
  useEffect(() => {
    if (tenant) setPendingModules(tenant.modulesEnabled)
  }, [tenant])

  if (tenantError) return <p className="p-6 text-red-800">{describeApiError(tenantError).message}</p>
  if (!tenant || !pendingModules) return <p className="p-6 text-slate-500">Loading tenant…</p>

  async function saveModules() {
    if (!pendingModules) return
    setActionError(null)
    try {
      await setModules.mutateAsync(pendingModules)
    } catch (e) {
      setActionError(describeApiError(e).message)
    }
  }

  async function runSuspend() {
    setActionError(null)
    try { await suspend.mutateAsync() } catch (e) { setActionError(describeApiError(e).message) }
  }
  async function runArchive() {
    if (!confirm('Archive this tenant? Users retain their records but can no longer sign in.')) return
    setActionError(null)
    try { await archive.mutateAsync() } catch (e) { setActionError(describeApiError(e).message) }
  }

  const modulesDirty = JSON.stringify(pendingModules.slice().sort()) !== JSON.stringify(tenant.modulesEnabled.slice().sort())

  return (
    <div className="bg-slate-50" data-screen="tenant-detail">
      <div className="flex flex-col gap-5" style={{ maxWidth: 1280, padding: '20px 32px 48px' }}>

        <nav className="flex items-center gap-2 text-xs text-slate-500">
          <Link to="/super-admin/tenants" className="hover:underline">Tenants</Link>
          <span style={{ color: '#CBD5E1' }}>&gt;</span>
          <span className="font-semibold text-slate-900">{tenant.name}</span>
        </nav>

        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-[22px] font-bold text-slate-900">{tenant.name}</h1>
              <StatusChip status={tenant.status} />
            </div>
            <p className="mt-1 font-mono text-[11px] text-slate-500">
              {tenant.slug} · created {new Date(tenant.createdAt).toISOString().slice(0, 10)}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              to={`/super-admin/tenants/${tenant.id}/sso`}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-[12px] text-slate-700 hover:bg-slate-50"
            >SSO config →</Link>
            {tenant.status !== 'archived' && (
              <>
                {tenant.status === 'active' && (
                  <button type="button" onClick={runSuspend} className="rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-[12px] text-amber-700 hover:bg-amber-100" data-action="suspend">
                    Suspend
                  </button>
                )}
                <button type="button" onClick={runArchive} className="rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-[12px] text-red-700 hover:bg-red-100" data-action="archive">
                  Archive
                </button>
              </>
            )}
          </div>
        </div>

        {actionError && <p className="rounded-md bg-red-50 p-3 text-[13px] text-red-800">{actionError}</p>}

        {/* Module toggles */}
        <section className="rounded-lg border border-slate-200 bg-white p-5" data-section="modules">
          <h2 className="text-[14px] font-bold text-slate-900">Modules enabled for this tenant</h2>
          <p className="mt-1 text-[12px] text-slate-500">
            Intersected at runtime with the deployment-wide kill-switch
            (<code className="font-mono">FEATURE_MODULES_ENABLED</code>). Un-ticked modules return 503.
          </p>
          <div className="mt-4 grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
            {ALL_MODULES.map(m => {
              const checked = pendingModules.includes(m)
              const effective = tenant.effectiveModules.includes(m)
              const meta = MODULE_META[m]
              return (
                <label
                  key={m}
                  className="flex items-start gap-3 rounded-md border border-slate-200 p-3 cursor-pointer hover:bg-slate-50"
                  data-module-row={m}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={e => {
                      const next = e.currentTarget.checked
                        ? Array.from(new Set([...pendingModules, m])) as ModuleKey[]
                        : pendingModules.filter(x => x !== m) as ModuleKey[]
                      setPendingModules(next)
                    }}
                    className="mt-0.5"
                    style={{ accentColor: meta.colour }}
                  />
                  <div>
                    <p className="text-[13px] font-semibold" style={{ color: meta.colour }}>{meta.label}</p>
                    {checked && !effective && (
                      <p className="mt-1 text-[11px] font-mono text-amber-700">deployment-capped (reserve)</p>
                    )}
                  </div>
                </label>
              )
            })}
          </div>
          <div className="mt-4 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setPendingModules(tenant.modulesEnabled)}
              disabled={!modulesDirty || setModules.isPending}
              className="rounded-md px-3 py-1.5 text-[12px] text-slate-700 hover:bg-slate-100 disabled:opacity-50"
            >
              Reset
            </button>
            <button
              type="button"
              onClick={saveModules}
              disabled={!modulesDirty || setModules.isPending}
              className="rounded-md bg-slate-800 px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50"
              data-action="save-modules"
            >
              {setModules.isPending ? 'Saving…' : 'Save modules'}
            </button>
          </div>
        </section>

        {/* Members */}
        <section className="rounded-lg border border-slate-200 bg-white p-5" data-section="memberships">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-[14px] font-bold text-slate-900">Members</h2>
              <p className="mt-1 text-[12px] text-slate-500">{members.length} member{members.length === 1 ? '' : 's'}</p>
            </div>
            <Link
              to={`/admin/users?tenantId=${tenant.id}`}
              className="text-[12px] font-semibold text-slate-700 hover:underline"
            >Invite users via User Management →</Link>
          </div>

          {membersError && (
            <p className="mt-3 rounded-md bg-red-50 p-3 text-[12px] text-red-800">{describeApiError(membersError).message}</p>
          )}

          <div className="mt-4 overflow-hidden rounded-md border border-slate-200">
            <table className="w-full text-[13px]">
              <thead style={{ backgroundColor: '#F8FAFC' }}>
                <tr className="text-left text-[11px] font-semibold uppercase tracking-widest text-slate-500">
                  <th className="px-4 py-2">User</th>
                  <th className="px-4 py-2">Role</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2 text-right"></th>
                </tr>
              </thead>
              <tbody>
                {members.map(m => (
                  <tr key={m.id} className="border-t border-slate-200" data-membership-row={m.id}>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-slate-900">{m.userName ?? m.userId}</p>
                      <p className="mt-0.5 font-mono text-[10px] text-slate-500">{m.userEmail ?? '—'}</p>
                    </td>
                    <td className="px-4 py-3">
                      <select
                        className="rounded-md border border-slate-300 px-2 py-1 text-[12px]"
                        value={m.role}
                        onChange={e => updateMembership.mutate({ membershipId: m.id, role: e.target.value as Membership['role'] })}
                        data-input="role"
                      >
                        {ROLE_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </td>
                    <td className="px-4 py-3"><StatusChip status={m.status as 'active' | 'invited' | 'suspended'} /></td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => {
                          if (confirm(`Remove ${m.userName ?? m.userEmail ?? m.userId} from ${tenant.name}?`)) {
                            removeMembership.mutate(m.id)
                          }
                        }}
                        className="text-[11px] text-red-700 hover:underline"
                      >Remove</button>
                    </td>
                  </tr>
                ))}
                {members.length === 0 && (
                  <tr><td colSpan={4} className="px-4 py-6 text-center text-[12px] text-slate-500">No members yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  )
}
