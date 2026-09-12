import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { PlatformUser, PlatformUserRole } from '@platform/types'
import { PLATFORM_ACCENT, PLATFORM_USER_ROLE_LABEL } from '@platform/types'
import { platformApi } from '../api/platformApi'
import { usePlatformStore } from '../store'

type ModuleKey = 'A' | 'B' | 'C' | 'D' | 'E'

const MODULE_META: Record<ModuleKey, { label: string; colour: string }> = {
  A: { label: 'Clinical Writing',      colour: '#2563EB' },
  B: { label: 'Scientific Writing',    colour: '#0D9488' },
  C: { label: 'Medical Writing',       colour: '#7C3AED' },
  D: { label: 'Regulatory Writing',    colour: '#B0200D' },
  E: { label: 'Ideation & Publishing', colour: '#0D9488' },
}
const ALL_MODULES: ModuleKey[] = ['A', 'B', 'C', 'D', 'E']

const ROLE_OPTIONS: PlatformUserRole[] = [
  'admin', 'ideation-lead', 'regulatory-writer', 'ma-team-lead',
  'content-calendar-manager', 'clinical-lead', 'cmc-lead',
  'author', 'qc-checker', 'e-signatory', 'creative-team-member',
]

const RACI_IMPACT_PROJECTS = ['VELORA-301 NDA', 'AURELIA-101 IND']

function initialsFor(name: string): string {
  return name.split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('')
}
function formatDay(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${String(d.getUTCDate()).padStart(2, '0')} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

function StatusChip({ status }: { status: 'active' | 'invited' | 'suspended' }) {
  if (status === 'active')    return <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium" style={{ backgroundColor: '#F0FDF4', color: '#166534', border: '1px solid #BBF7D0' }} data-status-chip="active">✓ Active</span>
  if (status === 'invited')   return <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium" style={{ backgroundColor: '#FFFBEB', color: '#B45309', border: '1px solid #FDE68A' }} data-status-chip="invited">📧 Invited</span>
  return <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium" style={{ backgroundColor: '#F1F5F9', color: '#475569', border: '1px solid #CBD5E1' }} data-status-chip="suspended">○ Suspended</span>
}

function ModuleDots({ modules }: { modules: ModuleKey[] }) {
  return (
    <div className="flex items-center gap-1" data-module-dots>
      {ALL_MODULES.map(m => {
        const active = modules.includes(m)
        return (
          <span
            key={m}
            title={MODULE_META[m].label}
            className="inline-flex h-5 w-5 items-center justify-center rounded font-mono text-[10px] font-semibold"
            style={{
              backgroundColor: active ? `${MODULE_META[m].colour}22` : '#F1F5F9',
              color:           active ? MODULE_META[m].colour : '#94A3B8',
              border:          `1px solid ${active ? MODULE_META[m].colour : '#E2E8F0'}`,
            }}
            data-module-dot={m}
            data-module-active={active || undefined}
          >{m}</span>
        )
      })}
    </div>
  )
}

// -------------- Panels --------------

function InviteDrawer({
  clientName, email, firstName, lastName, role, modules,
  onEmail, onFirstName, onLastName, onRole, onToggleModule, onSend, onClose,
}: {
  clientName:     string
  email:          string
  firstName:      string
  lastName:       string
  role:           PlatformUserRole | ''
  modules:        ModuleKey[]
  onEmail:        (v: string) => void
  onFirstName:    (v: string) => void
  onLastName:     (v: string) => void
  onRole:         (v: PlatformUserRole | '') => void
  onToggleModule: (m: ModuleKey) => void
  onSend:         () => void
  onClose:        () => void
}) {
  const canSend = email.length > 3 && email.includes('@') && role !== ''
  return (
    <aside
      className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-5"
      data-invite-drawer
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Invite user</p>
          <h3 className="mt-1 text-[16px] font-bold text-slate-900">Add a new team member</h3>
        </div>
        <button type="button" onClick={onClose} className="text-[12px] font-semibold text-slate-500 hover:underline" data-close-drawer>Close</button>
      </div>

      <div>
        <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Client</p>
        <p className="mt-1 text-[13px] font-semibold text-slate-900" data-invite-client>{clientName}</p>
      </div>

      <label className="flex flex-col gap-1">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Email</span>
        <input type="email" value={email} onChange={(e) => onEmail(e.currentTarget.value)} data-invite-email
          className="h-9 rounded-md border border-slate-300 px-3 text-[13px]" />
      </label>
      <div className="grid gap-2" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">First name</span>
          <input type="text" value={firstName} onChange={(e) => onFirstName(e.currentTarget.value)} data-invite-first
            className="h-9 rounded-md border border-slate-300 px-3 text-[13px]" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Last name</span>
          <input type="text" value={lastName} onChange={(e) => onLastName(e.currentTarget.value)} data-invite-last
            className="h-9 rounded-md border border-slate-300 px-3 text-[13px]" />
        </label>
      </div>
      <label className="flex flex-col gap-1">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Role</span>
        <select value={role} onChange={(e) => onRole(e.currentTarget.value as PlatformUserRole | '')} data-invite-role
          className="h-9 rounded-md border border-slate-300 px-3 text-[13px]">
          <option value="">Select a role…</option>
          {ROLE_OPTIONS.map(r => <option key={r} value={r}>{PLATFORM_USER_ROLE_LABEL[r]}</option>)}
        </select>
      </label>

      <fieldset className="flex flex-col gap-2 rounded-md border border-slate-200 p-3" data-invite-modules>
        <legend className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Module access</legend>
        {ALL_MODULES.map(m => (
          <label key={m} className="flex items-center gap-2 text-[13px] text-slate-800">
            <input type="checkbox" checked={modules.includes(m)} onChange={() => onToggleModule(m)}
              data-invite-module={m} style={{ accentColor: MODULE_META[m].colour }} />
            <span className="font-mono font-semibold" style={{ color: MODULE_META[m].colour }}>{m}</span>
            <span>{MODULE_META[m].label}</span>
          </label>
        ))}
      </fieldset>

      <button
        type="button"
        onClick={onSend}
        disabled={!canSend}
        data-send-invitation
        className="h-9 rounded-md px-4 text-[13px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
        style={{ backgroundColor: PLATFORM_ACCENT.primary }}
      >Send invitation →</button>

      <p className="rounded-md p-3 text-[12px]" style={{ backgroundColor: PLATFORM_ACCENT.bgTint, color: PLATFORM_ACCENT.primary }} data-invite-note>
        Invitation expires after 7 days. The user must accept the terms and conditions on first sign-in.
      </p>
    </aside>
  )
}

function RoleChangePanel({
  user, newRole, onRole, onPreview, onApply, onSuspend, onClose, showPreview, roleChanged,
}: {
  user:         PlatformUser
  newRole:      PlatformUserRole
  onRole:       (r: PlatformUserRole) => void
  onPreview:    () => void
  onApply:      () => void
  onSuspend:    () => void
  onClose:      () => void
  showPreview:  boolean
  roleChanged:  boolean
}) {
  const previousLabel = PLATFORM_USER_ROLE_LABEL[user.role as PlatformUserRole] ?? user.role
  const nextLabel     = PLATFORM_USER_ROLE_LABEL[newRole]

  return (
    <aside className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-5" data-role-change-panel data-selected-user={user.id}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Edit role</p>
          <h3 className="mt-1 text-[16px] font-bold text-slate-900" data-selected-name>{user.name}</h3>
          <p className="mt-0.5 font-mono text-[11px] text-slate-500" data-selected-meta>
            {previousLabel} · Modules {user.modules.join(', ')}
          </p>
        </div>
        <button type="button" onClick={onClose} className="text-[12px] font-semibold text-slate-500 hover:underline" data-close-role-panel>Close</button>
      </div>

      <label className="flex flex-col gap-1">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">New role</span>
        <select value={newRole} onChange={(e) => onRole(e.currentTarget.value as PlatformUserRole)} data-role-value
          className="h-9 rounded-md border border-slate-300 px-3 text-[13px]">
          {ROLE_OPTIONS.map(r => <option key={r} value={r}>{PLATFORM_USER_ROLE_LABEL[r]}</option>)}
        </select>
      </label>

      <button type="button" onClick={onPreview} className="self-start text-[12px] font-semibold hover:underline"
        style={{ color: PLATFORM_ACCENT.primary }} data-preview-affected>Preview affected assignments →</button>

      {showPreview && (
        <div className="rounded-md p-3 text-[12px]" style={{ backgroundColor: PLATFORM_ACCENT.bgTint, color: PLATFORM_ACCENT.primary }} data-raci-impact>
          Changing {user.name} from {previousLabel} to {nextLabel} will affect their RACI assignments in {RACI_IMPACT_PROJECTS.length} active projects: {RACI_IMPACT_PROJECTS.join(' and ')}.
        </div>
      )}

      <button type="button" onClick={onApply} data-apply-role
        className="h-9 rounded-md px-4 text-[13px] font-semibold text-white"
        style={{ backgroundColor: PLATFORM_ACCENT.primary }}>Apply role change →</button>

      {roleChanged && (
        <p className="rounded-md p-2 text-[12px]" style={{ backgroundColor: '#F0FDF4', color: '#166534' }} data-role-change-toast>
          ✓ Role changed. Takes effect at the user's next sign-in. Written to the audit trail.
        </p>
      )}

      <p className="font-mono text-[11px] text-slate-500" data-role-audit-note>
        Role changes take effect at the user's next sign-in and are written to the audit trail.
      </p>

      <div className="mt-2 flex flex-col gap-2 border-t border-slate-200 pt-3">
        <button type="button" className="self-start text-[12px] font-semibold hover:underline"
          style={{ color: PLATFORM_ACCENT.primary }} data-view-audit>View audit trail →</button>
        <button
          type="button"
          onClick={onSuspend}
          data-suspend-user
          className="h-9 self-start rounded-md px-4 text-[13px] font-semibold text-white"
          style={{ backgroundColor: '#B0200D' }}
        >Suspend user</button>
        <p className="font-mono text-[11px] text-slate-500" data-suspend-note>
          Suspension requires Admin role. The acting Admin is named in the audit record.
        </p>
      </div>
    </aside>
  )
}

// -------------- Screen --------------

export function UserManagement() {
  const currentUser = usePlatformStore(s => s.currentUser)
  const { data: users = [] } = useQuery<PlatformUser[]>({
    queryKey: ['admin-users'],
    queryFn:  () => platformApi.listUsers(),
  })

  const [search,       setSearch]       = useState('')
  const [roleFilter,   setRoleFilter]   = useState<'all' | PlatformUserRole>('all')
  const [moduleFilter, setModuleFilter] = useState<'all' | ModuleKey>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'invited' | 'suspended'>('all')

  const [inviteOpen,   setInviteOpen]   = useState(false)
  const [inviteEmail,  setInviteEmail]  = useState('')
  const [inviteFirst,  setInviteFirst]  = useState('')
  const [inviteLast,   setInviteLast]   = useState('')
  const [inviteRole,   setInviteRole]   = useState<PlatformUserRole | ''>('')
  const [inviteMods,   setInviteMods]   = useState<ModuleKey[]>([])

  const [selectedUserId, setSelectedUserId] = useState<string | null>(null)
  const [newRole,        setNewRole]        = useState<PlatformUserRole>('author')
  const [showPreview,    setShowPreview]    = useState(false)
  const [roleChanged,    setRoleChanged]    = useState(false)
  const [confirmSuspend, setConfirmSuspend] = useState(false)

  const selectedUser = users.find(u => u.id === selectedUserId) ?? null

  const filtered = useMemo(() => {
    return users.filter(u => {
      if (search && !u.name.toLowerCase().includes(search.toLowerCase()) && !u.email.toLowerCase().includes(search.toLowerCase())) return false
      if (roleFilter !== 'all'   && u.role !== roleFilter)                  return false
      if (moduleFilter !== 'all' && !u.modules.includes(moduleFilter))      return false
      if (statusFilter !== 'all' && u.status !== statusFilter)              return false
      return true
    })
  }, [users, search, roleFilter, moduleFilter, statusFilter])

  const counts = useMemo(() => {
    const active    = users.filter(u => u.status === 'active').length
    const invited   = users.filter(u => u.status === 'invited').length
    const suspended = users.filter(u => u.status === 'suspended').length
    return { total: users.length, active, invited, suspended }
  }, [users])

  const openInvite = () => { setInviteOpen(true); setSelectedUserId(null) }
  const closeInvite = () => setInviteOpen(false)
  const toggleInviteMod = (m: ModuleKey) => setInviteMods(prev => prev.includes(m) ? prev.filter(x => x !== m) : [...prev, m])
  const sendInvite = () => {
    // Fire-and-forget for prototype
    void platformApi.inviteUser({
      name:    `${inviteFirst} ${inviteLast}`.trim() || inviteEmail.split('@')[0],
      email:   inviteEmail,
      role:    inviteRole || 'author',
      modules: inviteMods,
    }).catch(() => {})
    setInviteEmail(''); setInviteFirst(''); setInviteLast(''); setInviteRole(''); setInviteMods([])
    setInviteOpen(false)
  }

  const openRolePanel = (u: PlatformUser) => {
    setSelectedUserId(u.id)
    setNewRole('regulatory-writer' as PlatformUserRole)
    setShowPreview(false)
    setRoleChanged(false)
    setConfirmSuspend(false)
    setInviteOpen(false)
  }
  const closeRolePanel = () => setSelectedUserId(null)
  const applyRole = () => { setRoleChanged(true); setShowPreview(false) }

  return (
    <div className="bg-slate-50" data-screen="user-management">
      <div className="mx-auto flex flex-col gap-4" style={{ maxWidth: 1440, padding: '20px 32px 48px' }}>

        <nav className="flex items-center gap-2 text-xs text-slate-500">
          <span>Platform</span>
          <span style={{ color: '#CBD5E1' }}>&gt;</span>
          <span className="font-semibold text-slate-900">User Management</span>
        </nav>

        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <h1 className="text-[22px] font-bold text-slate-900" style={{ margin: 0 }}>User Management</h1>
            <p className="mt-1 font-mono text-xs text-slate-500" data-current-user>
              {currentUser.name} · Admin · GenBioCa Sciences
            </p>
            <p className="mt-1 font-mono text-[11px]" style={{ color: PLATFORM_ACCENT.primary }} data-user-counts>
              {counts.total} users · {counts.active} active · {counts.invited} invited{counts.suspended ? ` · ${counts.suspended} suspended` : ''}
            </p>
          </div>
        </div>

        {/* Filter bar */}
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-3" data-filter-bar>
          <input
            type="search" placeholder="Search name or email…" value={search}
            onChange={(e) => setSearch(e.currentTarget.value)} data-filter-search
            className="h-9 flex-1 min-w-[200px] rounded-md border border-slate-300 px-3 text-[13px]"
          />
          <select value={roleFilter} onChange={(e) => setRoleFilter(e.currentTarget.value as 'all' | PlatformUserRole)} data-filter-role
            className="h-9 rounded-md border border-slate-300 px-3 text-[13px]">
            <option value="all">All roles</option>
            {ROLE_OPTIONS.map(r => <option key={r} value={r}>{PLATFORM_USER_ROLE_LABEL[r]}</option>)}
          </select>
          <select value={moduleFilter} onChange={(e) => setModuleFilter(e.currentTarget.value as 'all' | ModuleKey)} data-filter-module
            className="h-9 rounded-md border border-slate-300 px-3 text-[13px]">
            <option value="all">All modules</option>
            {ALL_MODULES.map(m => <option key={m} value={m}>Module {m}</option>)}
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.currentTarget.value as 'all' | 'active' | 'invited' | 'suspended')} data-filter-status
            className="h-9 rounded-md border border-slate-300 px-3 text-[13px]">
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="invited">Invited</option>
            <option value="suspended">Suspended</option>
          </select>
          <button type="button" onClick={openInvite} data-open-invite
            className="h-9 rounded-md px-4 text-[13px] font-semibold text-white"
            style={{ backgroundColor: PLATFORM_ACCENT.primary }}>Invite user →</button>
        </div>

        {/* Layout */}
        <div className="grid gap-4" style={{ gridTemplateColumns: (inviteOpen || selectedUser) ? '1fr 360px' : '1fr' }}>

          {/* User table */}
          <section className="overflow-hidden rounded-lg border border-slate-200 bg-white" data-user-table data-user-count={filtered.length}>
            <table className="w-full text-[13px]">
              <thead style={{ backgroundColor: '#F8FAFC' }}>
                <tr className="text-left text-[11px] font-semibold uppercase tracking-widest text-slate-500">
                  <th className="px-4 py-2">Name</th>
                  <th className="px-4 py-2">Email</th>
                  <th className="px-4 py-2">Role</th>
                  <th className="px-4 py-2">Modules</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2">Last active</th>
                  <th className="px-4 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(u => {
                  const isInvited = u.status === 'invited'
                  return (
                    <tr key={u.id} className="border-t border-slate-200" data-user-row={u.id} data-user-status={u.status}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span
                            className="inline-flex h-8 w-8 items-center justify-center rounded-full font-mono text-[11px] font-bold text-white"
                            style={{ backgroundColor: PLATFORM_ACCENT.primary }}
                            data-user-initials={initialsFor(u.name)}
                          >{initialsFor(u.name)}</span>
                          <span className="font-semibold text-slate-900">{u.name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-700">{u.email}</td>
                      <td className="px-4 py-3 text-slate-700">{PLATFORM_USER_ROLE_LABEL[u.role as PlatformUserRole] ?? u.role}</td>
                      <td className="px-4 py-3"><ModuleDots modules={u.modules as ModuleKey[]} /></td>
                      <td className="px-4 py-3"><StatusChip status={u.status} /></td>
                      <td className="px-4 py-3 font-mono text-[11px] text-slate-500">{formatDay(u.lastActive)}</td>
                      <td className="px-4 py-3 text-right">
                        {isInvited
                          ? <button type="button" className="text-[12px] font-semibold hover:underline" style={{ color: PLATFORM_ACCENT.primary }} data-user-action="resend">Resend invitation</button>
                          : <button type="button" onClick={() => openRolePanel(u)} className="text-[12px] font-semibold hover:underline" style={{ color: PLATFORM_ACCENT.primary }} data-user-action="edit-role">Edit role</button>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <p
              className="border-t border-slate-200 p-3 text-[12px]"
              style={{ backgroundColor: PLATFORM_ACCENT.bgTint, color: PLATFORM_ACCENT.primary }}
              data-preserve-note
            >
              Suspending a user preserves every document, signature and audit record they created. User records are never deleted.
            </p>
          </section>

          {/* Right panel */}
          {inviteOpen && (
            <InviteDrawer
              clientName="GenBioCa Sciences"
              email={inviteEmail} firstName={inviteFirst} lastName={inviteLast}
              role={inviteRole} modules={inviteMods}
              onEmail={setInviteEmail} onFirstName={setInviteFirst} onLastName={setInviteLast}
              onRole={setInviteRole} onToggleModule={toggleInviteMod}
              onSend={sendInvite} onClose={closeInvite}
            />
          )}

          {!inviteOpen && selectedUser && (
            <div className="flex flex-col gap-3">
              <RoleChangePanel
                user={selectedUser} newRole={newRole} onRole={setNewRole}
                onPreview={() => setShowPreview(true)} onApply={applyRole}
                onSuspend={() => setConfirmSuspend(true)} onClose={closeRolePanel}
                showPreview={showPreview} roleChanged={roleChanged}
              />
              {confirmSuspend && (
                <div className="rounded-lg border p-4" style={{ backgroundColor: '#FEF2F2', borderColor: '#FCA5A5' }} data-suspend-confirm>
                  <p className="text-[13px] font-semibold" style={{ color: '#7F1D1D' }}>Confirm suspension of {selectedUser.name}?</p>
                  <p className="mt-1 text-[12px] text-slate-700">This preserves their content and is logged to the audit trail. It can be reversed.</p>
                  <div className="mt-3 flex gap-2">
                    <button type="button" className="h-8 rounded-md px-3 text-[12px] font-semibold text-white" style={{ backgroundColor: '#B0200D' }} data-confirm-suspend>Confirm suspend</button>
                    <button type="button" onClick={() => setConfirmSuspend(false)} className="h-8 rounded-md border border-slate-300 bg-white px-3 text-[12px] font-semibold text-slate-700">Cancel</button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
