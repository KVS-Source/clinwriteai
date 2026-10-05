// Platform reports / analytics wrappers.
// Shape matches apps/api/src/modules/platform/reports/routes.ts.

import { api } from './client'

export interface ProjectDashboard {
  project: { id: string; name: string; therapeuticArea: string }
  moduleA: { documentsByStatus: Record<string, number>; openComments: number }
  moduleB: { publicationsByStatus: Record<string, number>; publicationsByStage: Record<string, number> }
  moduleC: { medContentByStatus: Record<string, number> }
  moduleD: { submissionsByStage: Record<string, number> }
  moduleE: { cardsByOverallStatus: Record<string, number> }
  generatedAt: string
}

export interface TenantOverview {
  projects: number
  documents: number
  publications: number
  submissions: number
  medContent: number
  ideationCards: number
  activeUsers: number
  aiCostUsdTotal: number
  generatedAt: string
}

export interface AiSpendReport {
  range: { from: string; to: string }
  totalCostUsd: number
  rows: Array<{
    module: string
    model: string
    callCount: number
    costUsd: number
    inputTokens: number
    outputTokens: number
    cachedTokens: number
  }>
  rejectsByModule: Record<string, number>
  generatedAt: string
}

export interface AuditActivityReport {
  range: { from: string; to: string }
  bucket: 'day' | 'week' | 'month'
  actions: string[]
  histogram: Record<string, Record<string, number>>
  generatedAt: string
}

export const reportsApi = {
  projectDashboard: (projectId: string) =>
    api.get<ProjectDashboard>(`/reports/projects/${projectId}/dashboard`),

  tenantOverview: () =>
    api.get<TenantOverview>('/reports/tenant/overview'),

  aiSpend: (params: { from?: string; to?: string } = {}) => {
    const q = new URLSearchParams()
    if (params.from) q.set('from', params.from)
    if (params.to) q.set('to', params.to)
    const suffix = q.toString() ? `?${q}` : ''
    return api.get<AiSpendReport>(`/reports/ai-spend${suffix}`)
  },

  auditActivity: (params: { from?: string; to?: string; bucket?: 'day' | 'week' | 'month' } = {}) => {
    const q = new URLSearchParams()
    if (params.from) q.set('from', params.from)
    if (params.to) q.set('to', params.to)
    if (params.bucket) q.set('bucket', params.bucket)
    const suffix = q.toString() ? `?${q}` : ''
    return api.get<AuditActivityReport>(`/reports/audit-activity${suffix}`)
  },
}
