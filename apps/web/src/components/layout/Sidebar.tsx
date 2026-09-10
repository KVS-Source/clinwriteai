import type { ReactNode } from 'react'
import { NavLink, useNavigate, useParams } from 'react-router-dom'
import { MonoLabel } from '../ui'

// Module accent colours — design-system.md Decision 10
const MODULE_COLOURS: Record<string, string> = {
  'clinical-writing':    '#2563EB',
  'scientific-writing':  '#0D9488',
  'medical-writing':     '#7C3AED',
  'regulatory-writing':  '#B0200D',
  'ideation-publishing': '#0D9488',
}

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
  const accentColour = MODULE_COLOURS[activeModule] ?? '#2563EB'

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
    <aside className="flex w-56 flex-none flex-col overflow-hidden" style={{ backgroundColor: '#1E293B' }}>

      {/* Brand wordmark */}
      <div className="flex h-14 flex-none items-center gap-2.5 px-5 border-b border-slate-700">
        <div className="flex h-7 w-7 items-center justify-center rounded-md" style={{ backgroundColor: accentColour }}>
          <span className="font-mono text-[11px] font-bold text-white">C</span>
        </div>
        <div>
          <p className="text-sm font-bold leading-tight text-white">ClinWrite.AI</p>
          <p className="font-mono text-[10px] leading-tight text-slate-400">AI-Native Authoring</p>
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

      {/* Module section — only when inside a project */}
      {projectId && (
        <div className="mt-4 px-3">
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

      {/* Spacer */}
      <div className="flex-1" />

      {/* Module switcher — bottom of sidebar */}
      {projectId && (
        <div className="border-t border-slate-700 px-3 py-3">
          <div className="mb-2 px-2.5">
            <MonoLabel className="text-slate-500">Switch Module</MonoLabel>
          </div>
          <div className="flex flex-col gap-0.5">
            {Object.entries(MODULE_LABELS).map(([key, label]) => {
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
    </aside>
  )
}
