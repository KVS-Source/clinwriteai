// Tenant Admin API client — Arc 4.1 of docs/pivot-plan.md.
//
// Covers all four tenant-admin surfaces: tenants, memberships, SSO
// connections, audit viewer. Each sub-object maps 1:1 to a server-side
// plugin so route changes stay traceable (grep for 'tenantsApi' finds
// callers; grep '/admin/tenants' finds server + client sides).

import { api } from './client'

// ---------- Types ----------
// Shaped on the server (apps/api/src/modules/platform/tenant-admin/*).
// Keeping these inline rather than in @platform/types so Arc 4 can
// ship without a types-package rev; promote to the shared package in
// Arc 6 / handover.

export type ModuleKey = 'A' | 'B' | 'C' | 'D' | 'E'

export interface Tenant {
  id: string
  slug: string
  name: string
  status: 'active' | 'suspended' | 'archived'
  modulesEnabled: ModuleKey[]
  effectiveModules: ModuleKey[]
  deploymentCapped: boolean
  createdAt: string
  updatedAt: string
  archivedAt: string | null
}

export interface Membership {
  id: string
  tenantId: string
  userId: string
  role: 'owner' | 'admin' | 'writer' | 'reviewer' | 'viewer'
  status: 'invited' | 'active' | 'suspended'
  invitedAt: string
  activatedAt: string | null
  suspendedAt: string | null
  invitedBy: string | null
  userName: string | null
  userEmail: string | null
  userInitials: string | null
}

export interface SsoConnection {
  id: string
  tenantId: string
  type: 'oidc' | 'saml'
  workosConnectionId: string | null
  callbackUrl: string
  status: 'draft' | 'verified' | 'disabled'
  verifiedAt: string | null
  disabledAt: string | null
  createdAt: string
  updatedAt: string
}

export interface AuditEntry {
  id: string
  timestamp: string
  actorId: string
  // Resolved from users when actorId is a real user; null for system
  // actors such as 'anonymous'.
  actorName: string | null
  actorEmail: string | null
  // Role at the time of the event when recorded; otherwise the user's current
  // role (actorRoleRecorded false). sessionId / old+new values are null when
  // the event didn't capture them (entries written before FR-A-061 support).
  actorRole?: string | null
  actorRoleRecorded?: boolean
  sessionId?: string | null
  oldValue?: unknown
  newValue?: unknown
  action: string
  entityType: string
  entityId: string
  details: Record<string, unknown>
  ipAddress: string | null
  prevHash: string
  rowHash: string
}

export interface AuditPage {
  rows: AuditEntry[]
  nextCursor: string | null
  hasMore: boolean
  // Matches for the current filter; capped server-side (totalCapped → "N+").
  total: number
  totalCapped: boolean
}

export interface AuditFacets {
  actions: string[]
  entityTypes: string[]
}

export interface AuditChainException {
  id:            string
  /** Plain-language explanation for admins. Absent on servers older than this field. */
  summary?:      string
  reason:        string
  fixedInCommit: string
  incidentDoc:   string
}

export interface AuditVerifyResult {
  /** True when every break (if any) is in the known-exceptions list. */
  intact: boolean
  /** First UNEXPECTED break id — not a known exception. null when intact. */
  firstBreakAt: string | null
  /** All real (unexpected) break ids in the checked range. */
  unexpectedBreaks: string[]
  /** Known-bad entries whitelisted by the verifier (surfaced, never hidden). */
  exceptions: AuditChainException[]
  checkedRange: { from: string | null; to: string | null }
  verifiedAt: string
}

// ---------- Tenants ----------

export const tenantsApi = {
  list:    () => api.get<Tenant[]>('/admin/tenants'),
  get:     (id: string) => api.get<Tenant>(`/admin/tenants/${id}`),
  create:  (body: { slug: string; name: string; modulesEnabled?: ModuleKey[] }) =>
    api.post<Tenant>('/admin/tenants', body),
  update:  (id: string, body: Partial<Pick<Tenant, 'name' | 'slug'>>) =>
    api.patch<Tenant>(`/admin/tenants/${id}`, body),
  setModules: (id: string, modulesEnabled: ModuleKey[]) =>
    api.patch<Tenant>(`/admin/tenants/${id}/modules`, { modulesEnabled }),
  suspend: (id: string) => api.post<Tenant>(`/admin/tenants/${id}/suspend`, {}),
  archive: (id: string) => api.post<Tenant>(`/admin/tenants/${id}/archive`, {}),
}

// ---------- Memberships ----------

export const membershipsApi = {
  list:   (tenantId: string) =>
    api.get<Membership[]>(`/admin/tenants/${tenantId}/memberships`),
  create: (tenantId: string, body: { userId: string; role?: Membership['role'] }) =>
    api.post<Membership>(`/admin/tenants/${tenantId}/memberships`, body),
  update: (membershipId: string, body: { role?: Membership['role']; status?: Membership['status'] }) =>
    api.patch<Membership>(`/admin/memberships/${membershipId}`, body),
  remove: (membershipId: string) =>
    api.delete<{ ok: true }>(`/admin/memberships/${membershipId}`),
}

// ---------- SSO ----------

export const ssoApi = {
  list:   (tenantId: string) =>
    api.get<SsoConnection[]>(`/admin/tenants/${tenantId}/sso-connections`),
  create: (tenantId: string, body: { type: 'oidc' | 'saml'; callbackUrl: string; workosConnectionId?: string }) =>
    api.post<SsoConnection>(`/admin/tenants/${tenantId}/sso-connections`, body),
  get:    (id: string) => api.get<SsoConnection>(`/admin/sso-connections/${id}`),
  update: (id: string, body: { callbackUrl?: string; workosConnectionId?: string }) =>
    api.patch<SsoConnection>(`/admin/sso-connections/${id}`, body),
  test:   (id: string) =>
    api.post<{ ok: boolean; connection?: SsoConnection; error?: string; message?: string }>(`/admin/sso-connections/${id}/test`, {}),
  disable: (id: string) => api.delete<SsoConnection>(`/admin/sso-connections/${id}`),
}

// ---------- Audit viewer ----------

export type AuditSortKey = 'id' | 'timestamp' | 'action' | 'entity' | 'actor' | 'ip'

export interface AuditQuery {
  actorId?: string
  q?: string            // free-text search across the visible columns
  sortBy?: AuditSortKey // default 'id'; non-id sorts page by offset cursor
  actor?: string        // partial name / email, or exact actor id
  entityType?: string   // partial, case-insensitive
  entityId?: string
  projectId?: string    // everything belonging to one project (project record, its documents, entries carrying its id)
  action?: string       // partial, case-insensitive
  fromDate?: string     // ISO 8601, with Z or an offset
  toDate?: string
  order?: 'desc' | 'asc'
  limit?: number
  cursor?: string
}

export interface AuditNewer {
  /** Matching entries newer than the one asked about, up to 100. */
  count:  number
  /** True when there are more than `count` (shown as "100+"). */
  capped: boolean
}

// Max rows a single CSV export carries — mirrors EXPORT_ROW_CAP in the API.
export const AUDIT_EXPORT_ROW_CAP = 10_000

function toQueryString(params: Record<string, string | number | undefined>): string {
  const entries = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => [k, String(v)] as [string, string])
  if (entries.length === 0) return ''
  return '?' + new URLSearchParams(entries).toString()
}

export const auditApi = {
  query:  (q: AuditQuery = {}) => api.get<AuditPage>(`/admin/audit${toQueryString({ ...q })}`),
  facets: () => api.get<AuditFacets>('/admin/audit/facets'),
  // Cheap "anything newer than entry #afterId that matches these filters?" check used to
  // keep the open table current (the server stops counting at 100 and flags `capped`).
  newer: (filters: Omit<AuditQuery, 'limit' | 'cursor' | 'sortBy' | 'order'>, afterId: string) =>
    api.get<AuditNewer>(`/admin/audit/newer${toQueryString({ ...filters, afterId })}`),
  verify: (fromId?: string, toId?: string) =>
    api.get<AuditVerifyResult>(`/admin/audit/verify${toQueryString({ fromId, toId })}`),
  // CSV export URL — not called via api.get because the response is a
  // file download. The UI points an <a href> at this URL (same cookie,
  // same origin via credentials: 'include' handled by the browser).
  exportUrl: (q: Omit<AuditQuery, 'limit' | 'cursor'> = {}) => {
    const base = (import.meta.env.VITE_API_URL ?? '/api').replace(/\/$/, '')
    return `${base}/admin/audit/export${toQueryString({ ...q })}`
  },
}
