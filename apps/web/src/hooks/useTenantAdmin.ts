// React Query hooks for Tenant Admin — Arc 4.2 of docs/pivot-plan.md.
//
// Pattern mirrors useReports/useSignatures: list queries + typed
// mutations with invalidation. All queries are cheap enough that we
// stay with the project's default staleTime (no explicit tuning).

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  tenantsApi,
  membershipsApi,
  ssoApi,
  auditApi,
  type Tenant,
  type Membership,
  type SsoConnection,
  type AuditQuery,
  type ModuleKey,
} from '../api'

// ---------- Tenants ----------

export function useTenants() {
  return useQuery({ queryKey: ['tenants'], queryFn: () => tenantsApi.list() })
}

export function useTenant(tenantId: string | undefined) {
  return useQuery({
    queryKey: ['tenants', tenantId],
    queryFn:  () => tenantsApi.get(tenantId!),
    enabled:  !!tenantId,
  })
}

export function useCreateTenant() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { slug: string; name: string; modulesEnabled?: ModuleKey[] }) => tenantsApi.create(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tenants'] }),
  })
}

export function useUpdateTenant(tenantId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: Partial<Pick<Tenant, 'name' | 'slug'>>) => tenantsApi.update(tenantId, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tenants'] })
      qc.invalidateQueries({ queryKey: ['tenants', tenantId] })
    },
  })
}

export function useSetTenantModules(tenantId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (modulesEnabled: ModuleKey[]) => tenantsApi.setModules(tenantId, modulesEnabled),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tenants'] })
      qc.invalidateQueries({ queryKey: ['tenants', tenantId] })
    },
  })
}

export function useSuspendTenant(tenantId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => tenantsApi.suspend(tenantId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tenants'] })
      qc.invalidateQueries({ queryKey: ['tenants', tenantId] })
    },
  })
}

export function useArchiveTenant(tenantId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => tenantsApi.archive(tenantId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tenants'] })
      qc.invalidateQueries({ queryKey: ['tenants', tenantId] })
    },
  })
}

// ---------- Memberships ----------

export function useMemberships(tenantId: string | undefined) {
  return useQuery({
    queryKey: ['memberships', tenantId],
    queryFn:  () => membershipsApi.list(tenantId!),
    enabled:  !!tenantId,
  })
}

export function useAddMember(tenantId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { userId: string; role?: Membership['role'] }) => membershipsApi.create(tenantId, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['memberships', tenantId] }),
  })
}

export function useUpdateMembership(tenantId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (args: { membershipId: string; role?: Membership['role']; status?: Membership['status'] }) =>
      membershipsApi.update(args.membershipId, { role: args.role, status: args.status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['memberships', tenantId] }),
  })
}

export function useRemoveMembership(tenantId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (membershipId: string) => membershipsApi.remove(membershipId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['memberships', tenantId] }),
  })
}

// ---------- SSO ----------

export function useSsoConnections(tenantId: string | undefined) {
  return useQuery({
    queryKey: ['sso', tenantId],
    queryFn:  () => ssoApi.list(tenantId!),
    enabled:  !!tenantId,
  })
}

export function useCreateSsoConnection(tenantId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { type: 'oidc' | 'saml'; callbackUrl: string; workosConnectionId?: string }) =>
      ssoApi.create(tenantId, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sso', tenantId] }),
  })
}

export function useUpdateSsoConnection(tenantId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (args: { id: string; callbackUrl?: string; workosConnectionId?: string }) =>
      ssoApi.update(args.id, { callbackUrl: args.callbackUrl, workosConnectionId: args.workosConnectionId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sso', tenantId] }),
  })
}

export function useTestSsoConnection(tenantId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => ssoApi.test(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sso', tenantId] }),
  })
}

export function useDisableSsoConnection(tenantId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => ssoApi.disable(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sso', tenantId] }),
  })
}

// ---------- Audit viewer ----------

export function useAuditQuery(q: AuditQuery) {
  return useQuery({
    queryKey: ['audit', 'query', q],
    queryFn:  () => auditApi.query(q),
    // Audit log is naturally append-only — a short staleTime keeps the
    // table fresh while a user is on the screen without hammering the
    // paginated endpoint on every keystroke.
    staleTime: 15_000,
  })
}

export function useAuditVerify() {
  return useMutation({
    mutationFn: (args: { fromId?: string; toId?: string } = {}) =>
      auditApi.verify(args.fromId, args.toId),
  })
}

// Export the CSV URL helper so screens can wire an <a href> without
// going through React Query — browser handles the file download.
export const auditExportUrl = auditApi.exportUrl

// Re-exported SSO/Tenant types for consumer convenience.
export type { Tenant, Membership, SsoConnection, ModuleKey, AuditQuery }
