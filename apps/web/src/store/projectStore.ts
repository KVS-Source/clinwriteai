import { create } from 'zustand'
import type { Project } from '@platform/types'

interface Filters { status: string; ta: string; search: string }

interface ProjectStore {
  projects: Project[]
  activeProject: Project | null
  isLoading: boolean
  filters: Filters
  setProjects: (projects: Project[]) => void
  setActiveProject: (project: Project) => void
  setFilters: (f: Partial<Filters>) => void
  setLoading: (loading: boolean) => void
}

export const useProjectStore = create<ProjectStore>(set => ({
  projects: [],
  activeProject: null,
  isLoading: false,
  filters: { status: '', ta: '', search: '' },
  setProjects: (projects) => set({ projects }),
  setActiveProject: (activeProject) => set({ activeProject }),
  setFilters: (f) => set(s => ({ filters: { ...s.filters, ...f } })),
  setLoading: (isLoading) => set({ isLoading }),
}))
