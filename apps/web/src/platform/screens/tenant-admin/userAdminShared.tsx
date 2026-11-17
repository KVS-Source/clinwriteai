// Shared by the User Management screen and its user detail panel.

import { useTranslation } from 'react-i18next'
import { api } from '../../../api/client'

export type UserStatus = 'invited' | 'active' | 'suspended' | 'deprovisioned'

export interface AdminUser {
  id: string
  email: string
  name: string
  initials: string | null
  role: string                  // primary role
  additionalRoles?: string[]    // a second role held alongside it (at most 2 in all)
  capabilities: string[]
  modules: string[]
  status: UserStatus
  tenantId: string | null
  tenantName?: string | null    // the real tenant's name (looked up by the API from tenantId)
  tenantRef?: string | null     // Tenant ID the user typed when registering (free text)
  termsAcceptedAt?: string | null   // set when the invitation is accepted (registration)
  lastActiveAt: string | null   // stamped on each sign-in (auth/routes.ts)
  createdAt: string
  updatedAt: string
}

// One-time sign-up link returned by invite / resend (valid 15 minutes). Shown to
// the admin to share until email dispatch is wired.
export interface InviteLink {
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
export const ROLE_OPTIONS: { value: string; labelKey: string; descriptionKey: string }[] = [
  { value: 'tenant-admin', labelKey: 'page.user_management_live.role_label_tenant_admin', descriptionKey: 'page.user_management_live.role_desc_tenant_admin' },
  { value: 'pm',           labelKey: 'page.user_management_live.role_label_pm',           descriptionKey: 'page.user_management_live.role_desc_pm' },
  { value: 'contributor',  labelKey: 'page.user_management_live.role_label_contributor',  descriptionKey: 'page.user_management_live.role_desc_contributor' },
  { value: 'auditor',      labelKey: 'page.user_management_live.role_label_auditor',      descriptionKey: 'page.user_management_live.role_desc_auditor' },
  { value: 'qc',           labelKey: 'page.user_management_live.role_label_qc',           descriptionKey: 'page.user_management_live.role_desc_qc' },
  { value: 'guest',        labelKey: 'page.user_management_live.role_label_guest',        descriptionKey: 'page.user_management_live.role_desc_guest' },
]

// Display label for a role: the canonical label when there is one, else the raw (legacy) name.
export function roleLabelOf(role: string, t: (k: string) => string): string {
  const opt = ROLE_OPTIONS.find(r => r.value === role)
  return opt ? t(opt.labelKey) : role
}

export const usersApi = {
  list:         () => api.get<AdminUser[]>('/admin/users'),
  invite:       (body: { email: string; name: string; role: string; modules?: string[]; tenantId?: string }) =>
    api.post<AdminUser & InviteLink>('/admin/users', body),
  suspend:      (id: string) => api.post<AdminUser>(`/admin/users/${id}/suspend`, {}),
  reactivate:   (id: string) => api.post<AdminUser>(`/admin/users/${id}/reactivate`, {}),
  deprovision:  (id: string) => api.delete<{ ok: true }>(`/admin/users/${id}`),
  addRole:      (id: string, role: string) => api.post<AdminUser>(`/admin/users/${id}/roles`, { role }),
  revokeRole:   (id: string, role: string) => api.delete<AdminUser>(`/admin/users/${id}/roles/${encodeURIComponent(role)}`),
  resendInvite: (id: string) => api.post<{ ok: true; email: string; note: string } & InviteLink>(`/admin/users/${id}/resend-invite`, {}),
}

export function StatusChip({ status }: { status: UserStatus }) {
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

// Every role a user holds, primary first.
export const rolesOfUser = (u: Pick<AdminUser, 'role' | 'additionalRoles'>): string[] =>
  [u.role, ...(u.additionalRoles ?? []).filter(r => r !== u.role)]

// Roles an admin can add as a user's second role, and which pairs are allowed — mirrors
// apps/api/src/auth/role-combos.ts (the API is the real check): at most 2; an admin role is
// never combined; Auditor + Contributor is not allowed.
export const MAX_ROLES = 2
export const ADDABLE_ROLES = ['tenant-admin', 'pm', 'contributor', 'auditor', 'qc'] as const
const CANON: Record<string, string> = {
  admin: 'tenant-admin', 'super-admin': 'tenant-admin', 'read-only': 'auditor',
  'clinical-writer': 'contributor', 'scientific-writer': 'contributor', 'medical-writer': 'contributor',
  'regulatory-writer': 'contributor', 'ideation-lead': 'contributor', reviewer: 'contributor',
}
const canon = (r: string) => CANON[r] ?? r
export function canCombine(held: string[], candidate: string): boolean {
  const all = [...held, candidate].map(canon)
  if (all.includes('tenant-admin') || all.includes('guest')) return all.length < 2
  // Auditor or QC never author: neither is held with Contributor.
  return !((all.includes('auditor') || all.includes('qc')) && all.includes('contributor'))
}
