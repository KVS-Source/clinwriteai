import { api } from './client'
import type { Project } from '@platform/types'

export const projectsApi = {
  list: (params?: { status?: string; ta?: string; search?: string }) => {
    const qs = new URLSearchParams(
      Object.entries(params ?? {}).filter(([, v]) => v) as [string, string][],
    ).toString()
    return api.get<Project[]>(`/projects${qs ? `?${qs}` : ''}`)
  },
  get:    (projectId: string) => api.get<Project>(`/projects/${projectId}`),
  create: (body: Omit<Project, 'id' | 'team' | 'activeModules'>) =>
    api.post<Project>('/projects', body),
}
