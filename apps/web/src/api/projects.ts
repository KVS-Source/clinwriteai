import { api } from './client'
import type { Project, RACIRole, TeamMember } from '@platform/types'

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
  // TLF packages delivered to the project (Clinical Writing). Newest first.
  listTlfPackages: (projectId: string) =>
    api.get<Array<{ id: string; version: string; createdAt: string; _count?: { items: number } }>>(`/projects/${projectId}/tlf-packages`),

  // Team RACI assignment — Project Settings v2 (2026-10-28). API gates on
  // "actor is a team member with raci='R' on this project"; admins locked
  // out server-side too.
  addTeamMember: (projectId: string, body: {
    userId: string
    name: string
    role: string
    raci: RACIRole
    initials?: string
    colourKey?: string
  }) => api.post<TeamMember>(`/projects/${projectId}/team`, body),
  updateTeamMember: (projectId: string, userId: string, body: Partial<{
    name: string
    role: string
    raci: RACIRole
    initials: string
    colourKey: string
  }>) => api.patch<TeamMember>(`/projects/${projectId}/team/${encodeURIComponent(userId)}`, body),
  removeTeamMember: (projectId: string, userId: string) =>
    api.delete<void>(`/projects/${projectId}/team/${encodeURIComponent(userId)}`),
}
