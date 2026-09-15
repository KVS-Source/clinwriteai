import type { ReactNode } from 'react'
import { NavLink, useNavigate, useParams } from 'react-router-dom'
import { MonoLabel } from '../ui'
import { usePlatformStore } from '../../platform/store'

// Module accent colours — design-system.md Decision 10 (Platform = navy per PM00 §7 rule 1)
const MODULE_COLOURS: Record<string, string> = {
  'clinical-writing':    '#2563EB',
  'scientific-writing':  '#0D9488',
  'medical-writing':     '#7C3AED',
  'regulatory-writing':  '#B0200D',
  'ideation-publishing': '#0D9488',
  'platform':            '#1A3C5E',
}

// Platform section nav — items land as their sPM screens are built (PM00 §4).
// Each entry is {label, href, roles} — filtered client-side against currentUser.role.
interface PlatformNavItem { label: string; href: string; roles: readonly ('admin' | 'super-admin')[] }
const PLATFORM_NAV: PlatformNavItem[] = [
  { label: 'Admin Panel',      href: '/admin',       roles: ['admin', 'super-admin'] as const },
  { label: 'User Management',  href: '/admin/users', roles: ['admin', 'super-admin'] as const },
  { label: 'Audit Trail',      href: '/admin/audit', roles: ['admin', 'super-admin'] as const },
  { label: 'TA Tags',          href: '/admin/taxonomy', roles: ['admin', 'super-admin'] as const },
  { label: 'RACI Matrix',      href: '/admin/raci',  roles: ['admin', 'super-admin'] as const },
  { label: 'Notifications',    href: '/notifications', roles: ['admin', 'super-admin'] as const },
  { label: 'Master Library',   href: '/library',    roles: ['admin', 'super-admin'] as const },
  { label: 'Best Practices',   href: '/library/best-practices', roles: ['admin', 'super-admin'] as const },
  { label: 'Services',         href: '/services',   roles: ['admin', 'super-admin'] as const },
  { label: 'Subscription',     href: '/admin/subscription', roles: ['admin', 'super-admin'] as const },
  { label: 'Reports',          href: '/reports',    roles: ['admin', 'super-admin'] as const },
]
const SUPER_ADMIN_NAV: PlatformNavItem[] = [
  { label: 'Super Admin Panel',   href: '/super-admin',            roles: ['super-admin'] as const },
  { label: 'Framework Registry',  href: '/super-admin/frameworks', roles: ['super-admin'] as const },
  { label: 'Rate Card',           href: '/super-admin/rate-card',  roles: ['super-admin'] as const },
]

const MODULE_LABELS: Record<string, string> = {
  'clinical-writing':    'Clinical Writing',
  'scientific-writing':  'Scientific Writing',
  'medical-writing':     'Medical Writing',
  'regulatory-writing':  'Regulatory Writing',
  'ideation-publishing': 'Ideation & Publishing',
}

function HomeIcon()   { return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2 6.5L8 2l6 4.5V14H2V6.5Z"/></svg> }
function FolderIcon() { return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M1.5 4.5h4l1.5 2h7.5v7h-13V4.5Z"/></svg> }
function ChatIcon()   { return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M1.5 1.5h13v9h-7l-4 4V10.5h-2V1.5Z"/></svg> }
function ShieldIcon() { return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M8 1.5l5.5 2.5v4c0 3-2.5 5.5-5.5 6.5C5 13.5 2.5 11 2.5 8V4L8 1.5Z"/></svg> }
function GridIcon()   { return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="1.5" y="1.5" width="5" height="5" rx="1"/><rect x="9.5" y="1.5" width="5" height="5" rx="1"/><rect x="1.5" y="9.5" width="5" height="5" rx="1"/><rect x="9.5" y="9.5" width="5" height="5" rx="1"/></svg> }

interface NavItem {
  label: string
  href: string
  icon: ReactNode
}

interface Props {
  activeModule?: string
}

// Per-module nav items — each module only exposes routes that exist in the router.
type NavKey = 'home' | 'portfolio' | 'comments' | 'audit' | 'crm' | 'kol' | 'claims' | 'intelligence' | 'calendar' | 'publishing'

const MODULE_NAV: Record<string, NavKey[]> = {
  'clinical-writing':    ['home', 'portfolio', 'comments', 'audit', 'crm'],
  'scientific-writing':  ['home', 'portfolio'],
  'medical-writing':     ['home', 'portfolio', 'kol', 'claims'],
  'regulatory-writing':  ['home', 'intelligence'],
  'ideation-publishing': ['home', 'calendar', 'publishing'],
}

export function Sidebar({ activeModule = 'clinical-writing' }: Props) {
  const { projectId } = useParams()
  const navigate = useNavigate()
  const currentUser = usePlatformStore(s => s.currentUser)
  const accentColour = MODULE_COLOURS[activeModule] ?? '#2563EB'

  // Role-scoped visibility — sidebar sections only appear for users who actually
  // hold the role. Module users (Ideation Lead, Regulatory Writer, MA Team Lead,
  // Clinical Lead, CMC Lead, Content Calendar Manager, Author) see neither
  // Platform nor Super Admin sections — only their module + project navigation.
  const isSuperAdmin = currentUser.role === 'super-admin'
  const isAdmin      = currentUser.role === 'admin' || isSuperAdmin
  const platformItems   = isAdmin      ? PLATFORM_NAV.filter(i => i.roles.includes(currentUser.role as 'admin' | 'super-admin'))   : []
  const superAdminItems = isSuperAdmin ? SUPER_ADMIN_NAV.filter(i => i.roles.includes(currentUser.role as 'admin' | 'super-admin')) : []
  const showPlatform   = platformItems.length   > 0
  const showSuperAdmin = superAdminItems.length > 0

  // Module access — admin/super-admin see all 5 modules; module users see only
  // the modules listed in their profile (`currentUser.modules`).
  const MODULE_SLUG_TO_KEY: Record<string, 'A' | 'B' | 'C' | 'D' | 'E'> = {
    'clinical-writing':    'A',
    'scientific-writing':  'B',
    'medical-writing':     'C',
    'regulatory-writing':  'D',
    'ideation-publishing': 'E',
  }
  const userModuleKeys = new Set(currentUser.modules)
  const canSeeModule = (slug: string) =>
    isAdmin || userModuleKeys.has(MODULE_SLUG_TO_KEY[slug])
  const visibleModules = Object.entries(MODULE_LABELS).filter(([slug]) => canSeeModule(slug))
  const hasCurrentModuleAccess = canSeeModule(activeModule)

  const allNavItems: Record<NavKey, NavItem> = {
    home:      { label: 'Home',          href: `/projects/${projectId}/${activeModule}`,               icon: <HomeIcon />   },
    portfolio: { label: 'Portfolio',     href: `/projects/${projectId}/${activeModule}/portfolio`,     icon: <GridIcon />   },
    comments:  { label: 'Comments',      href: `/projects/${projectId}/${activeModule}/comments`,      icon: <ChatIcon />   },
    audit:     { label: 'Audit & QA',    href: `/projects/${projectId}/${activeModule}/audit-review`,  icon: <ShieldIcon /> },
    crm:       { label: 'CRM',           href: `/projects/${projectId}/${activeModule}/crm`,           icon: <FolderIcon /> },
    kol:          { label: 'KOL Sessions',   href: `/projects/${projectId}/${activeModule}/kol-session`,   icon: <ChatIcon />   },
    claims:       { label: 'Claims Matrix',  href: `/projects/${projectId}/${activeModule}/claims-matrix`, icon: <ShieldIcon /> },
    intelligence: { label: 'Intelligence',   href: `/projects/${projectId}/${activeModule}/intelligence`,  icon: <ShieldIcon /> },
    calendar:     { label: 'Calendar',       href: `/projects/${projectId}/${activeModule}/calendar`,      icon: <GridIcon />   },
    publishing:   { label: 'Publishing',     href: `/projects/${projectId}/${activeModule}/publishing`,    icon: <FolderIcon /> },
  }

  const moduleNavItems: NavItem[] = projectId
    ? (MODULE_NAV[activeModule] ?? ['home']).map(k => allNavItems[k])
    : []

  return (
    <aside className="flex w-56 flex-none flex-col overflow-y-auto" style={{ backgroundColor: '#1E293B' }}>

      {/* Brand wordmark — official ClinWrite logo on a white pill (green/red brand
          colours are unreadable directly on the dark navy sidebar). */}
      <div className="flex h-14 flex-none flex-col items-start justify-center gap-1 px-4 border-b border-slate-700">
        <div className="flex w-full items-center justify-center rounded-md bg-white px-3 py-1.5">
          <img
            src="/logo/clinwrite.svg"
            alt="ClinWrite.AI"
            className="h-6 w-auto"
            data-brand-logo
          />
        </div>
      </div>

      {/* All Projects link */}
      <div className="px-3 pt-4">
        <NavLink
          to="/projects"
          className={({ isActive }) =>
            `flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors ${
              isActive
                ? 'bg-slate-700 text-white'
                : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
            }`
          }
        >
          <GridIcon />
          <span>All Projects</span>
        </NavLink>
      </div>

      {/* Current module nav — appears IMMEDIATELY below All Projects when inside
          a project, so users doing project work don't have to scroll past the
          Platform admin section to reach their day-to-day nav. */}
      {projectId && hasCurrentModuleAccess && (
        <div className="mt-4 px-3" data-sidebar-section="module-current">
          <div className="mb-2 px-2.5">
            <MonoLabel className="text-slate-500">
              {MODULE_LABELS[activeModule]}
            </MonoLabel>
          </div>

          <nav className="flex flex-col gap-0.5">
            {moduleNavItems.map(item => (
              <NavLink
                key={item.href}
                to={item.href}
                end={item.href.endsWith(activeModule)}
                className={({ isActive }) =>
                  `flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors ${
                    isActive
                      ? 'text-white'
                      : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                  }`
                }
                style={({ isActive }) =>
                  isActive ? { backgroundColor: `${accentColour}33` } : {}
                }
              >
                {({ isActive }) => (
                  <>
                    <span style={{ color: isActive ? accentColour : undefined }} className="flex-none">
                      {item.icon}
                    </span>
                    <span>{item.label}</span>
                  </>
                )}
              </NavLink>
            ))}
          </nav>
        </div>
      )}

      {/* Module switcher — sits directly below the current-module nav so users
          in a project keep switch controls together with their working nav. */}
      {projectId && visibleModules.length > 0 && (
        <div className="mt-4 border-t border-slate-700 px-3 pt-3" data-sidebar-section="module-switch">
          <div className="mb-2 px-2.5">
            <MonoLabel className="text-slate-500">
              {visibleModules.length === 1 ? 'Your module' : 'Switch module'}
            </MonoLabel>
          </div>
          <div className="flex flex-col gap-0.5">
            {visibleModules.map(([key, label]) => {
              const colour = MODULE_COLOURS[key]
              const isActive = key === activeModule
              return (
                <button
                  key={key}
                  onClick={() => navigate(`/projects/${projectId}/${key}`)}
                  className={`flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-xs transition-colors text-left ${
                    isActive ? 'text-white' : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  <div className="h-2 w-2 flex-none rounded-full" style={{ backgroundColor: colour }} />
                  {label}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Platform section (PM00 §4) — visible to Admin + Super Admin only */}
      {showPlatform && (
        <div className="mt-4 px-3" data-sidebar-section="platform">
          <div className="mb-2 px-2.5">
            <MonoLabel className="text-slate-500">Platform</MonoLabel>
          </div>
          <nav className="flex flex-col gap-0.5">
            {platformItems.map(item => (
              <NavLink
                key={item.href}
                to={item.href}
                data-platform-link={item.href}
                className={({ isActive }) =>
                  `flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors ${
                    isActive ? 'text-white' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                  }`
                }
                style={({ isActive }) =>
                  isActive ? { backgroundColor: `${MODULE_COLOURS['platform']}44` } : {}
                }
              >
                {({ isActive }) => (
                  <>
                    <span style={{ color: isActive ? MODULE_COLOURS['platform'] : undefined }} className="flex-none">
                      <ShieldIcon />
                    </span>
                    <span>{item.label}</span>
                  </>
                )}
              </NavLink>
            ))}
          </nav>
        </div>
      )}

      {/* Super Admin section (PM00 §4) — visible ONLY to Super Admin (Alex Thornton) */}
      {showSuperAdmin && (
        <div className="mt-4 px-3" data-sidebar-section="super-admin">
          <div className="mb-2 px-2.5">
            <MonoLabel className="text-slate-500">Super Admin</MonoLabel>
          </div>
          <nav className="flex flex-col gap-0.5">
            {superAdminItems.map(item => (
              <NavLink
                key={item.href}
                to={item.href}
                data-super-admin-link={item.href}
                className={({ isActive }) =>
                  `flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors ${
                    isActive ? 'text-white' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                  }`
                }
                style={({ isActive }) =>
                  isActive ? { backgroundColor: `${MODULE_COLOURS['platform']}44` } : {}
                }
              >
                <ShieldIcon />
                <span>{item.label}</span>
              </NavLink>
            ))}
          </nav>
        </div>
      )}

      {/* trailing spacer keeps content from stretching if viewport is very tall */}
      <div className="flex-1 min-h-4" />
    </aside>
  )
}
