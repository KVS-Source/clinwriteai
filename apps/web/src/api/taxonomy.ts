// Therapeutic-areas taxonomy wrappers.
// Shape matches apps/api/src/modules/platform/taxonomy/routes.ts.

import { api } from './client'

export interface TherapeuticArea {
  code: string
  label: string
  parentCode: string | null
  status: 'active' | 'archived'
  description: string | null
  createdBy: string
  createdAt: string
  updatedAt: string
  archivedAt: string | null
}

export interface TherapeuticAreaNode extends TherapeuticArea {
  children: TherapeuticAreaNode[]
}

export interface ValidateResponse {
  code: string
  valid: boolean
  exists: boolean
  status: 'active' | 'archived' | null
  label: string | null
}

export const taxonomyApi = {
  list: (opts: { tree?: boolean; includeArchived?: boolean } = {}) => {
    const q = new URLSearchParams()
    if (opts.tree) q.set('tree', 'true')
    if (opts.includeArchived) q.set('includeArchived', 'true')
    const suffix = q.toString() ? `?${q}` : ''
    return api.get<TherapeuticArea[] | TherapeuticAreaNode[]>(`/taxonomy/therapeutic-areas${suffix}`)
  },

  validate: (code: string) =>
    api.get<ValidateResponse>(`/taxonomy/therapeutic-areas/validate?code=${encodeURIComponent(code)}`),

  get: (code: string) =>
    api.get<TherapeuticArea & { children: TherapeuticArea[] }>(`/taxonomy/therapeutic-areas/${encodeURIComponent(code)}`),

  create: (body: { code: string; label: string; parentCode?: string; description?: string }) =>
    api.post<TherapeuticArea>('/admin/taxonomy/therapeutic-areas', body),

  update: (code: string, body: Partial<{ label: string; parentCode: string | null; description: string | null; status: 'active' | 'archived' }>) =>
    api.patch<TherapeuticArea>(`/admin/taxonomy/therapeutic-areas/${encodeURIComponent(code)}`, body),

  archive: (code: string) =>
    api.delete<TherapeuticArea>(`/admin/taxonomy/therapeutic-areas/${encodeURIComponent(code)}`),
}
