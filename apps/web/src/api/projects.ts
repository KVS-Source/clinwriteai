import { api } from './client'
import type { Project, ProjectStatus, RACIRole, TeamMember } from '@platform/types'

export interface PmDirectoryEntry { id: string; name: string; email: string; status: string }
export interface ProjectManagerRow extends PmDirectoryEntry { addedBy: string; addedAt: string; isCreator: boolean }

// A project's managers, and the PMs a PM can pick from.
export const projectManagersApi = {
  directory: () => api.get<PmDirectoryEntry[]>('/projects/pm-directory'),
  list: (projectId: string) => api.get<ProjectManagerRow[]>(`/projects/${projectId}/managers`),
  add: (projectId: string, userId: string) =>
    api.post<{ managers: ProjectManagerRow[]; emailQueued: boolean | null }>(`/projects/${projectId}/managers`, { userId }),
  invite: (projectId: string, email: string) =>
    api.post<{ managers: ProjectManagerRow[]; emailQueued: boolean | null }>(`/projects/${projectId}/managers/invite`, { email }),
  resend: (projectId: string, userId: string) =>
    api.post<{ emailQueued: boolean }>(`/projects/${projectId}/managers/${encodeURIComponent(userId)}/resend`, {}),
  remove: (projectId: string, userId: string) =>
    api.delete<{ managers: ProjectManagerRow[] }>(`/projects/${projectId}/managers/${encodeURIComponent(userId)}`),
}

export const projectsApi = {
  list: (params?: { status?: string; ta?: string; search?: string }) => {
    const qs = new URLSearchParams(
      Object.entries(params ?? {}).filter(([, v]) => v) as [string, string][],
    ).toString()
    return api.get<Project[]>(`/projects${qs ? `?${qs}` : ''}`)
  },
  get:    (projectId: string) => api.get<Project>(`/projects/${projectId}`),
  create: (body: Omit<Project, 'id' | 'team' | 'activeModules' | 'client'> & { client?: string }) =>
    api.post<Project>('/projects', body),
  // Status control (PM): where the project is, where it may go, and its past moves.
  getStatus: (projectId: string) => api.get<{
    status: ProjectStatus
    next: ProjectStatus[]
    history: Array<{ id: string; at: string; by: string; from: string | null; to: string | null; reason: string | null }>
  }>(`/projects/${projectId}/status`),
  transition: (projectId: string, body: { to: ProjectStatus; reason: string }) =>
    api.post<Project>(`/projects/${projectId}/transition`, body),
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
