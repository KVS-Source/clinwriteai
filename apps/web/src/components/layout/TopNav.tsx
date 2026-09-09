import { useNavigate } from 'react-router-dom'
import type { USER_COLOURS } from '@platform/types'
import { Avatar } from '../ui'
import { useAuthStore }     from '../../store/authStore'
import { useProjectStore }  from '../../store/projectStore'

function BellIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M9 1.5a5.25 5.25 0 0 1 5.25 5.25c0 2.625.656 4.219 1.313 5.25H2.437c.657-1.031 1.313-2.625 1.313-5.25A5.25 5.25 0 0 1 9 1.5Z"/>
      <path d="M6.75 15a2.25 2.25 0 0 0 4.5 0"/>
    </svg>
  )
}

export function TopNav() {
  const navigate = useNavigate()
  const user     = useAuthStore(s => s.user)
  const project  = useProjectStore(s => s.activeProject)

  const crumbs = [
    { label: 'Projects', href: '/projects' },
    project && { label: project.shortTitle, href: `/projects/${project.id}` },
  ].filter(Boolean) as { label: string; href: string }[]

  return (
    <header
      className="flex h-14 flex-none items-center justify-between px-6"
      style={{ backgroundColor: '#1E293B', borderBottom: '1px solid rgba(255,255,255,0.08)' }}
    >

      {/* Left — breadcrumb */}
      <nav className="flex items-center gap-2">
        {crumbs.map((crumb, i) => (
          <span key={crumb.href} className="flex items-center gap-2">
            {i > 0 && <span className="text-slate-500">/</span>}
            <button
              onClick={() => navigate(crumb.href)}
              className="text-sm font-medium text-slate-400 hover:text-white transition-colors"
            >
              {crumb.label}
            </button>
          </span>
        ))}
      </nav>

      {/* Right — actions + user */}
      <div className="flex items-center gap-4">

        {/* Notification bell */}
        <button className="relative flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white transition-colors">
          <BellIcon />
          <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-blue-600" />
        </button>

        {/* Divider */}
        <div className="h-6 w-px bg-slate-700" />

        {/* User avatar + name */}
        {user ? (
          <div className="flex items-center gap-2.5">
            <Avatar initials={user.initials} colourKey={user.colourKey as keyof typeof USER_COLOURS} size="md" />
            <div className="hidden sm:block">
              <p className="text-sm font-semibold leading-tight text-white">{user.name}</p>
              <p className="text-xs leading-tight text-slate-400">{user.role}</p>
            </div>
          </div>
        ) : (
          // Prototype default — MW is always logged in
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 font-mono text-xs font-bold text-blue-700">
              MW
            </div>
            <div className="hidden sm:block">
              <p className="text-sm font-semibold leading-tight text-white">Marcus Webb</p>
              <p className="text-xs leading-tight text-slate-400">Lead Clinical Writer</p>
            </div>
          </div>
        )}
      </div>
    </header>
  )
}
