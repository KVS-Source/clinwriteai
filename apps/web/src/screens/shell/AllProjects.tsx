import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import type { Project, ProjectStatus } from '@platform/types'
import { projectsApi } from '../../api'
import { ProjectStatusPill } from '../../components/ui'
import { useProjectStore } from '../../store'

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" className="flex-none text-slate-400">
      <circle cx="6" cy="6" r="4.2"/>
      <path d="M9.6 9.6L12.5 12.5" strokeLinecap="round"/>
    </svg>
  )
}

function ChevronRightIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" className="flex-none text-slate-300">
      <path d="M5 3L9 7L5 11" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

function FolderIcon() {
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-slate-300">
      <path d="M5 10h10l3 4h17v20H5V10Z" strokeLinejoin="round"/>
    </svg>
  )
}

const STATUS_FILTERS: { label: string; value: ProjectStatus | 'all' }[] = [
  { label: 'All',       value: 'all' },
  { label: 'Ongoing',   value: 'ongoing' },
  { label: 'Initiated', value: 'initiated' },
  { label: 'On Hold',   value: 'on-hold' },
]

export function AllProjects() {
  const navigate         = useNavigate()
  const setActiveProject = useProjectStore(s => s.setActiveProject)

  const [search,       setSearch]       = useState('')
  const [statusFilter, setStatusFilter] = useState<ProjectStatus | 'all'>('all')

  const { data: projects = [], isLoading } = useQuery({
    queryKey: ['projects'],
    queryFn:  () => projectsApi.list(),
  })

  const filtered = useMemo(() => {
    return projects.filter((p: Project) => {
      const matchSearch = search === '' ||
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        p.shortTitle.toLowerCase().includes(search.toLowerCase())
      const matchStatus = statusFilter === 'all' || p.status === statusFilter
      return matchSearch && matchStatus
    })
  }, [projects, search, statusFilter])

  const handleProjectClick = (project: Project) => {
    setActiveProject(project)
    navigate(`/projects/${project.id}`)
  }

  const activeCount = projects.filter((p: Project) => p.status === 'ongoing').length

  return (
    <div className="flex h-full flex-col" data-screen="all-projects">

      {/* Page header */}
      <div className="flex items-center justify-between border-b border-slate-200 bg-white px-8 py-6">
        <div>
          <h1 className="text-[22px] font-bold text-slate-900">Projects</h1>
          <p className="mt-0.5 font-mono text-xs text-slate-500">
            {activeCount} active project{activeCount !== 1 ? 's' : ''} · GenBioCa Sciences
          </p>
        </div>
        <button
          onClick={() => navigate('/projects/new')}
          className="flex h-9 items-center gap-1.5 rounded-md bg-blue-600 px-4 text-[13px] font-semibold text-white hover:bg-blue-700 transition-colors"
        >
          <span className="text-base leading-none">+</span>
          New Project
        </button>
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-3 border-b border-slate-200 bg-white px-8 py-4">

        {/* Search */}
        <div className="flex h-9 w-[280px] items-center gap-2 rounded-md border border-slate-200 px-3">
          <SearchIcon />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search projects…"
            className="flex-1 bg-transparent text-[13px] text-slate-900 outline-none placeholder:text-slate-400"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="text-slate-400 hover:text-slate-600 text-xs leading-none"
              aria-label="Clear search"
            >
              ✕
            </button>
          )}
        </div>

        {/* Filter chips */}
        <div className="flex items-center gap-2">
          {STATUS_FILTERS.map(f => (
            <button
              key={f.value}
              onClick={() => setStatusFilter(f.value)}
              className="h-8 rounded-md px-3 text-xs font-medium transition-colors"
              style={statusFilter === f.value ? {
                backgroundColor: '#EFF6FF',
                color: '#2563EB',
                border: '1px solid #DBEAFE',
                fontWeight: 600,
              } : {
                backgroundColor: '#F8FAFC',
                color: '#64748B',
                border: '1px solid #E2E8F0',
              }}
            >
              {f.label}
            </button>
          ))}
        </div>

      </div>

      {/* Project list */}
      <div className="flex-1 overflow-y-auto px-8 pb-8">

        {isLoading && (
          <div className="flex items-center justify-center py-20">
            <p className="font-mono text-sm text-slate-400">Loading projects…</p>
          </div>
        )}

        {!isLoading && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-3 py-20">
            <FolderIcon />
            <div className="text-center">
              <p className="text-[15px] font-bold text-slate-900">No projects found</p>
              <p className="mt-1 text-[13px] text-slate-400">Try adjusting your search or filters</p>
            </div>
          </div>
        )}

        {!isLoading && filtered.map((project: Project, i: number) => (
          <div
            key={project.id}
            onClick={() => handleProjectClick(project)}
            className="flex cursor-pointer items-center gap-4 rounded-lg border border-slate-200 bg-white px-6 py-5 transition-shadow hover:shadow-md"
            style={{ marginTop: i === 0 ? '20px' : '12px' }}
          >

            {/* Left — title + name */}
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-bold text-slate-900">
                {project.shortTitle}
              </p>
              <p className="mt-0.5 truncate text-[13px] text-slate-500">
                {project.name}
              </p>
            </div>

            {/* Centre — meta tags */}
            <div className="flex flex-none items-center gap-6">
              <span className="rounded px-2 py-0.5 font-mono text-[11px] text-slate-500" style={{ backgroundColor: '#F1F5F9' }}>
                {project.therapeuticArea}
              </span>
              {project.phase && (
                <span className="rounded px-2 py-0.5 font-mono text-[11px] text-slate-500" style={{ backgroundColor: '#F1F5F9' }}>
                  Phase {project.phase}
                </span>
              )}
              <span className="text-[13px] text-slate-500">
                {project.activeModules.length > 0 ? '8 documents' : '0 documents'}
              </span>
            </div>

            {/* Right — status + chevron */}
            <div className="flex flex-none items-center gap-3">
              <ProjectStatusPill status={project.status} />
              <ChevronRightIcon />
            </div>

          </div>
        ))}

      </div>
    </div>
  )
}
