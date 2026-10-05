// React Query hooks for platform reports / analytics.
// Read-only; all four are plain queries with no corresponding mutations.

import { useQuery } from '@tanstack/react-query'
import { reportsApi } from '../api'

export function useProjectDashboard(projectId: string) {
  return useQuery({
    queryKey: ['reports', 'project-dashboard', projectId],
    queryFn:  () => reportsApi.projectDashboard(projectId),
    enabled:  !!projectId,
    staleTime: 30_000,
  })
}

export function useTenantOverview() {
  return useQuery({
    queryKey: ['reports', 'tenant-overview'],
    queryFn:  () => reportsApi.tenantOverview(),
    staleTime: 60_000,
  })
}

export function useAiSpend(params: { from?: string; to?: string } = {}) {
  return useQuery({
    queryKey: ['reports', 'ai-spend', params.from ?? '', params.to ?? ''],
    queryFn:  () => reportsApi.aiSpend(params),
    staleTime: 60_000,
  })
}

export function useAuditActivity(params: { from?: string; to?: string; bucket?: 'day' | 'week' | 'month' } = {}) {
  return useQuery({
    queryKey: ['reports', 'audit-activity', params.from ?? '', params.to ?? '', params.bucket ?? 'day'],
    queryFn:  () => reportsApi.auditActivity(params),
    staleTime: 60_000,
  })
}
