import { useRef, useState, type ReactNode } from 'react'
import { NavLink, useNavigate, useParams } from 'react-router-dom'
import { MonoLabel } from '../ui'
import { usePlatformStore } from '../../platform/store'
import { MODULE_LABELS, MODULE_SLUG_TO_KEY, isModuleEnabled, type ModuleSlug } from '../../config/modules'

// Module accent colours — design-system.md Decision 10 (Platform = navy per PM00 §7 rule 1)
const MODULE_COLOURS: Record<string, string> = {
  'clinical-writing':    '#2563EB',
  'scientific-writing':  '#0D9488',
  'medical-writing':     '#7C3AED',
  'regulatory-writing':  '#B0200D',
  'ideation-publishing': '#0D9488',
  'platform':            '#1A3C5E',
}

// Two-letter badge per module, shown on the collapsed rail.
const MODULE_MONOGRAMS: Record<string, string> = {
  'clinical-writing':    'CW',
  'scientific-writing':  'SW',
  'medical-writing':     'MW',
  'regulatory-writing':  'RW',
  'ideation-publishing': 'IP',
}

// Platform section nav — items land as their sPM screens are built (PM00 §4).
// Each entry is {label, href, roles} — filtered client-side against currentUser.role.
interface PlatformNavItem { label: string; href: string; roles: readonly ('admin')[]; icon: ReactNode }
const PLATFORM_NAV: PlatformNavItem[] = [
  { label: 'Admin Panel',      href: '/admin',       roles: ['admin'] as const, icon: <GearIcon /> },
  { label: 'User Management',  href: '/admin/users', roles: ['admin'] as const, icon: <UsersIcon /> },
  { label: 'Audit Trail',      href: '/admin/audit', roles: ['admin'] as const, icon: <ClipboardIcon /> },
  { label: 'TA Tags',          href: '/admin/taxonomy', roles: ['admin'] as const, icon: <TagIcon /> },
  { label: 'RACI Matrix',      href: '/admin/raci',  roles: ['admin'] as const, icon: <MatrixIcon /> },
  { label: 'Checklist Templates', href: '/admin/checklist-templates', roles: ['admin'] as const, icon: <ClipboardIcon /> },
  { label: 'Notifications',    href: '/notifications', roles: ['admin'] as const, icon: <BellIcon /> },
  { label: 'Master Library',   href: '/library',    roles: ['admin'] as const, icon: <BookIcon /> },
  { label: 'Best Practices',   href: '/library/best-practices', roles: ['admin'] as const, icon: <StarIcon /> },
  { label: 'Services',         href: '/services',   roles: ['admin'] as const, icon: <LayersIcon /> },
  { label: 'Subscription',     href: '/admin/subscription', roles: ['admin'] as const, icon: <CardIcon /> },
  { label: 'Reports',          href: '/reports',    roles: ['admin'] as const, icon: <ChartIcon /> },
]
// Read access to the library is open to every signed-in user (PRD sPM08), so
// users without the Platform section get these two links on their own.
const LIBRARY_NAV: { label: string; href: string; icon: ReactNode }[] = [
  { label: 'Master Library', href: '/library', icon: <BookIcon /> },
  { label: 'Best Practices', href: '/library/best-practices', icon: <StarIcon /> },
]
const SUPER_ADMIN_NAV: PlatformNavItem[] = [
  { label: 'Platform Panel',      href: '/super-admin',            roles: ['admin'] as const, icon: <ShieldCheckIcon /> },
  { label: 'Tenants',             href: '/super-admin/tenants',    roles: ['admin'] as const, icon: <BuildingIcon /> },
  { label: 'Framework Registry',  href: '/super-admin/frameworks', roles: ['admin'] as const, icon: <LayersIcon /> },
  { label: 'Rate Card',           href: '/super-admin/rate-card',  roles: ['admin'] as const, icon: <ReceiptIcon /> },
]

// NavLink matches by path prefix, so "/admin" would stay highlighted on
// "/admin/users" (and "/library" on "/library/best-practices", ...). Items whose
// path is a prefix of another item's path must match exactly (`end`) so only
// the page you're actually on is highlighted.
const ALL_NAV_HREFS = [...PLATFORM_NAV, ...SUPER_ADMIN_NAV].map(i => i.href)
const needsExactMatch = (href: string) => ALL_NAV_HREFS.some(other => other !== href && other.startsWith(`${href}/`))

function HomeIcon()   { return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2 6.5L8 2l6 4.5V14H2V6.5Z"/></svg> }
function FolderIcon() { return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M1.5 4.5h4l1.5 2h7.5v7h-13V4.5Z"/></svg> }
function ChatIcon()   { return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M1.5 1.5h13v9h-7l-4 4V10.5h-2V1.5Z"/></svg> }
function ShieldIcon() { return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M8 1.5l5.5 2.5v4c0 3-2.5 5.5-5.5 6.5C5 13.5 2.5 11 2.5 8V4L8 1.5Z"/></svg> }
function GridIcon()   { return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="1.5" y="1.5" width="5" height="5" rx="1"/><rect x="9.5" y="1.5" width="5" height="5" rx="1"/><rect x="1.5" y="9.5" width="5" height="5" rx="1"/><rect x="9.5" y="9.5" width="5" height="5" rx="1"/></svg> }

const icon16 = { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' } as const
function GearIcon()        { return <svg {...icon16}><circle cx="8" cy="8" r="2.2"/><path d="M8 1.5v1.8M8 12.7v1.8M1.5 8h1.8M12.7 8h1.8M3.4 3.4l1.3 1.3M11.3 11.3l1.3 1.3M12.6 3.4l-1.3 1.3M4.7 11.3l-1.3 1.3"/></svg> }
function UsersIcon()       { return <svg {...icon16}><circle cx="6" cy="5.5" r="2.5"/><path d="M1.5 13.5c0-2.5 2-4 4.5-4s4.5 1.5 4.5 4M10.5 3.3a2.4 2.4 0 010 4.4M12 9.8c1.6.5 2.5 1.8 2.5 3.7"/></svg> }
function ClipboardIcon()   { return <svg {...icon16}><rect x="3" y="2.5" width="10" height="11.5" rx="1.5"/><path d="M6 2.5v-1h4v1M5.5 7h5M5.5 9.5h5M5.5 12h3"/></svg> }
function TagIcon()         { return <svg {...icon16}><path d="M1.5 2.5h6l7 7-5 5-7-7v-5Z"/><circle cx="5" cy="6" r="1"/></svg> }
function MatrixIcon()      { return <svg {...icon16}><rect x="2" y="2" width="12" height="12" rx="1.5"/><path d="M2 6h12M2 10h12M6 2v12M10 2v12"/></svg> }
function BellIcon()        { return <svg {...icon16}><path d="M3.5 11.5V7a4.5 4.5 0 019 0v4.5l1 1.5h-11l1-1.5ZM6.5 14.5h3"/></svg> }
function BookIcon()        { return <svg {...icon16}><path d="M2 3h4a2 2 0 012 2v9a1.5 1.5 0 00-1.5-1.5H2V3ZM14 3h-4a2 2 0 00-2 2v9a1.5 1.5 0 011.5-1.5H14V3Z"/></svg> }
function StarIcon()        { return <svg {...icon16}><path d="M8 1.8l1.9 3.9 4.2.6-3 3 .7 4.2L8 11.5l-3.8 2 .7-4.2-3-3 4.2-.6L8 1.8Z"/></svg> }
function LayersIcon()      { return <svg {...icon16}><path d="M8 1.8l6.5 3.4L8 8.6 1.5 5.2 8 1.8ZM1.5 8.2L8 11.6l6.5-3.4M1.5 11l6.5 3.4 6.5-3.4"/></svg> }
function CardIcon()        { return <svg {...icon16}><rect x="1.5" y="3.5" width="13" height="9" rx="1.5"/><path d="M1.5 6.5h13M4 10h3"/></svg> }
function ChartIcon()       { return <svg {...icon16}><path d="M2 14V2M2 14h12M5 11V8M8.5 11V5M12 11V7"/></svg> }
function ShieldCheckIcon() { return <svg {...icon16}><path d="M8 1.5l5.5 2.5v4c0 3-2.5 5.5-5.5 6.5C5 13.5 2.5 11 2.5 8V4L8 1.5Z"/><path d="M5.7 8l1.6 1.6 3-3.3"/></svg> }
function BuildingIcon()    { return <svg {...icon16}><path d="M3 14.5V2.5h7v12M10 6.5h3v8M1.5 14.5h13M5.5 5h2M5.5 8h2M5.5 11h2"/></svg> }
function ReceiptIcon()     { return <svg {...icon16}><path d="M3.5 1.5h9v13l-1.8-1.2-1.7 1.2-1.7-1.2-1.7 1.2-2.1-1.2V1.5ZM6 5.5h4M6 8.5h4"/></svg> }
function ChevronsLeftIcon({ flip }: { flip?: boolean }) {
  return <svg {...icon16} style={flip ? { transform: 'rotate(180deg)' } : undefined}><path d="M9 4L5 8l4 4M13 4L9 8l4 4"/></svg>
}

// ---- Collapsed rail building blocks --------------------------------------------------------
// Labels are hidden on the rail, so every control gets a hover/focus tooltip. It is positioned with
// `fixed` because the rail scrolls vertically, which would clip an absolutely positioned tooltip.
// Only one tooltip at a time: showing one dismisses whichever was open (e.g. a focused icon while hovering another).
let dismissActiveTip: (() => void) | null = null

function RailTip({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const show = () => {
    const r = box.current?.getBoundingClientRect()
    if (!r) return
    if (dismissActiveTip && dismissActiveTip !== hide) dismissActiveTip()
    dismissActiveTip = hide
    setPos({ top: r.top + r.height / 2, left: r.right + 10 })
  }
  const hide = () => { setPos(null); if (dismissActiveTip === hide) dismissActiveTip = null }
  return (
    <div ref={box} className="relative flex" onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide} onClick={hide}>
      {children}
      {pos && (
        <span
          role="tooltip"
          data-rail-tip
          className="pointer-events-none fixed z-[60] -translate-y-1/2 whitespace-nowrap rounded-md bg-slate-950 px-2.5 py-1.5 text-xs font-medium text-white shadow-lg ring-1 ring-slate-700"
          style={{ top: pos.top, left: pos.left }}
        >
          {label}
          {hint && <span className="block text-[10px] font-normal text-slate-400">{hint}</span>}
        </span>
      )}
    </div>
  )
}

const RAIL_BTN = 'relative flex h-10 w-10 flex-none items-center justify-center rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400'

function RailLink({ to, end, label, icon, accent, data }: {
  to: string; end?: boolean; label: string; icon: ReactNode; accent: string; data?: Record<string, string>
}) {
  return (
    <RailTip label={label}>
      <NavLink
        to={to}
        end={end}
        aria-label={label}
        {...data}
        className={({ isActive }) => `${RAIL_BTN} ${isActive ? 'text-white' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-100'}`}
        style={({ isActive }) => (isActive ? { backgroundColor: `${accent}40` } : undefined)}
      >
        {({ isActive }) => (
          <>
            {isActive && <span className="absolute -left-3 top-2 bottom-2 w-[3px] rounded-r-full" style={{ backgroundColor: accent }} />}
            <span style={{ color: isActive ? '#fff' : undefined }}>{icon}</span>
          </>
        )}
      </NavLink>
    </RailTip>
  )
}

const RailDivider = () => <div className="my-2 h-px w-6 flex-none bg-slate-700" aria-hidden="true" />

interface NavItem {
  label: string
  href: string
  icon: ReactNode
}

interface Props {
  activeModule?: string
  /** When true, the sidebar shrinks to an icon-only rail (56px). AppShell
   *  flips this on when the user is inside a document editor so the content
   *  pane has more room; the icons stay clickable for cross-module nav. */
  collapsed?: boolean
  /** Opens / collapses the panel. The toggle sits under the logo in both states. */
  onToggle?: () => void
}

// Per-module nav items — each module only exposes routes that exist in the router.
type NavKey = 'home' | 'portfolio' | 'comments' | 'audit' | 'crm' | 'kol' | 'claims' | 'intelligence' | 'calendar' | 'publishing'

const MODULE_NAV: Record<string, NavKey[]> = {
  // Portfolio is hidden for Clinical Writing — the module home already covers it.
  'clinical-writing':    ['home', 'comments', 'audit', 'crm'],
  'scientific-writing':  ['home', 'portfolio'],
  'medical-writing':     ['home', 'portfolio', 'kol', 'claims'],
  'regulatory-writing':  ['home', 'intelligence'],
  'ideation-publishing': ['home', 'calendar', 'publishing'],
}

export function Sidebar({ activeModule = 'clinical-writing', collapsed = false, onToggle }: Props) {
  const { projectId } = useParams()
  const navigate = useNavigate()
  const currentUser = usePlatformStore(s => s.currentUser)
  const accentColour = MODULE_COLOURS[activeModule] ?? '#2563EB'

  // Role-scoped visibility — sidebar sections only appear for users who actually
  // hold the role. Module users (Ideation Lead, Regulatory Writer, MA Team Lead,
  // Clinical Lead, CMC Lead, Content Calendar Manager, Author) see neither
  // Platform nor Super Admin sections — only their module + project navigation.
  // Post 2026-10-27 role consolidation: platform admin = role='admin' with
  // tenantId=null; tenant admin = role='admin' with a tenant id. The Platform
  // section (Tenants / Framework Registry / Rate Card) is platform-admin-only.
  const isAdmin      = currentUser.role === 'admin'
  const isSuperAdmin = isAdmin && (currentUser.tenantId ?? null) == null
  const platformItems   = isAdmin      ? PLATFORM_NAV.filter(i => i.roles.includes(currentUser.role as 'admin'))   : []
  const superAdminItems = isSuperAdmin ? SUPER_ADMIN_NAV.filter(i => i.roles.includes(currentUser.role as 'admin')) : []
  const showPlatform   = platformItems.length   > 0
  const libraryItems   = showPlatform ? [] : LIBRARY_NAV
  const showSuperAdmin = superAdminItems.length > 0

  // Module access — admin/super-admin see all 5 modules; module users see only
  // the modules listed in their profile (`currentUser.modules`). Deployment
  // kill-switch (VITE_MODULES_ENABLED) is applied first — frozen modules are
  // hidden from everyone, including super-admins. See docs/pivot-plan.md Arc 1.
  const userModuleKeys = new Set(currentUser.modules)
  const canSeeModule = (slug: string) => {
    const key = MODULE_SLUG_TO_KEY[slug as ModuleSlug]
    if (!key || !isModuleEnabled(key)) return false
    return isAdmin || userModuleKeys.has(key)
  }
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

  // Sits right under the logo in both states (top-left is never covered by the dev tools button that floats bottom-left).
  const toggleRow = onToggle && (
    <div className={`flex-none border-b border-slate-700 ${collapsed ? 'flex w-full justify-center py-2' : 'px-3 py-2'}`}>
      {collapsed ? (
        <RailTip label="Open navigation panel" hint="All modules">
          <button
            type="button" onClick={onToggle} data-sidebar-toggle
            aria-label="Open navigation panel" aria-expanded={false}
            className={`${RAIL_BTN} text-slate-400 hover:bg-slate-800 hover:text-white`}
          >
            <ChevronsLeftIcon flip />
          </button>
        </RailTip>
      ) : (
        <button
          type="button" onClick={onToggle} data-sidebar-toggle
          aria-label="Collapse navigation panel" aria-expanded
          className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
        >
          <ChevronsLeftIcon />
          <span>Collapse panel</span>
        </button>
      )}
    </div>
  )

  // ---- Collapsed rail: icon-only, with tooltips, module badges and a pinned toggle ----
  if (collapsed) {
    return (
      <aside
        className="sidebar-scroll flex w-16 flex-none flex-col items-center overflow-y-auto border-r border-slate-700/60 transition-[width] duration-200"
        style={{ backgroundColor: '#1E293B' }}
        data-collapsed
        aria-label="Navigation (collapsed)"
      >
        <div className="flex h-14 w-full flex-none items-center justify-center border-b border-slate-700">
          <RailTip label="ClinWrite.AI">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white text-[12px] font-bold tracking-tight text-slate-900" data-brand-mark>CW</div>
          </RailTip>
        </div>
        {toggleRow}

        <div className="flex w-full flex-col items-center gap-1 px-3 pt-3" data-sidebar-section="primary">
          <RailLink to="/home" label="My Workspace" icon={<HomeIcon />} accent="#64748B" />
          <RailLink to="/projects" label="All Projects" icon={<GridIcon />} accent="#64748B" />
        </div>

        {projectId && hasCurrentModuleAccess && (
          <>
            <RailDivider />
            <nav className="flex w-full flex-col items-center gap-1 px-3" data-sidebar-section="module-current" aria-label={MODULE_LABELS[activeModule as ModuleSlug]}>
              {moduleNavItems.map(item => (
                <RailLink key={item.href} to={item.href} end={item.href.endsWith(activeModule)} label={item.label} icon={item.icon} accent={accentColour} />
              ))}
            </nav>
          </>
        )}

        {projectId && (
          <>
            <RailDivider />
            <div className="flex w-full flex-col items-center gap-1 px-3" data-sidebar-section="module-switch">
              {Object.entries(MODULE_LABELS).map(([key, label]) => {
                const colour = MODULE_COLOURS[key]
                const isActive = key === activeModule
                const moduleKey = MODULE_SLUG_TO_KEY[key as ModuleSlug]
                const enabled = !!moduleKey && isModuleEnabled(moduleKey)
                const available = canSeeModule(key)
                const hint = !enabled ? 'Not enabled on this deployment' : !available ? 'Not in your access — ask your admin' : isActive ? 'Current module' : 'Switch module'
                return (
                  <RailTip key={key} label={label} hint={hint}>
                    <button
                      type="button"
                      onClick={() => available && navigate(`/projects/${projectId}/${key}`)}
                      disabled={!available}
                      aria-label={`${label}${isActive ? ' (current module)' : ''}`}
                      aria-current={isActive ? 'true' : undefined}
                      data-module-switch={key}
                      data-module-available={available}
                      className={`${RAIL_BTN} text-[11px] font-bold tracking-tight ${available ? '' : 'cursor-not-allowed opacity-35'}`}
                      style={{
                        backgroundColor: `${colour}${isActive ? '55' : '26'}`,
                        color: isActive ? '#fff' : '#CBD5E1',
                        boxShadow: isActive ? `inset 0 0 0 1.5px ${colour}` : undefined,
                      }}
                    >
                      {MODULE_MONOGRAMS[key]}
                    </button>
                  </RailTip>
                )
              })}
            </div>
          </>
        )}

        {showPlatform && (
          <>
            <RailDivider />
            <nav className="flex w-full flex-col items-center gap-1 px-3" data-sidebar-section="platform" aria-label="Platform">
              {platformItems.map(item => (
                <RailLink key={item.href} to={item.href} end={needsExactMatch(item.href)} label={item.label} icon={item.icon} accent={MODULE_COLOURS['platform']!} data={{ 'data-platform-link': item.href }} />
              ))}
            </nav>
          </>
        )}
        {libraryItems.length > 0 && (
          <>
            <RailDivider />
            <nav className="flex w-full flex-col items-center gap-1 px-3" data-sidebar-section="library" aria-label="Library">
              {libraryItems.map(item => (
                <RailLink key={item.href} to={item.href} end label={item.label} icon={item.icon} accent={MODULE_COLOURS['platform']!} data={{ 'data-platform-link': item.href }} />
              ))}
            </nav>
          </>
        )}
        {showSuperAdmin && (
          <>
            <RailDivider />
            <nav className="flex w-full flex-col items-center gap-1 px-3" data-sidebar-section="super-admin" aria-label="Super admin">
              {superAdminItems.map(item => (
                <RailLink key={item.href} to={item.href} end={needsExactMatch(item.href)} label={item.label} icon={item.icon} accent={MODULE_COLOURS['platform']!} data={{ 'data-super-admin-link': item.href }} />
              ))}
            </nav>
          </>
        )}

        <div className="min-h-4 flex-1" />
      </aside>
    )
  }

  return (
    <aside
      className="sidebar-scroll flex w-56 flex-none flex-col overflow-y-auto transition-[width] duration-200"
      style={{ backgroundColor: '#1E293B' }}
    >

      {/* Brand wordmark — official ClinWrite logo on a white pill (green/red brand
          colours are unreadable directly on the dark navy sidebar). */}
      <div className="flex h-14 flex-none flex-col items-center justify-center gap-1 border-b border-slate-700 px-2">
        <div className="flex w-full items-center justify-center rounded-md bg-white px-3 py-1.5">
          <img
            src="/logo/clinwrite.svg"
            alt="ClinWrite.AI"
            className="h-6 w-auto"
            data-brand-logo
          />
        </div>
      </div>
      {toggleRow}

      {/* My workspace — role-specific landing page */}
      <div className="px-3 pt-4">
        <NavLink
          to="/home"
          className={({ isActive }) =>
            `flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors ${
              isActive
                ? 'bg-slate-700 text-white'
                : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
            }`
          }
          data-nav="my-workspace"
        >
          <HomeIcon />
          <span>My Workspace</span>
        </NavLink>
      </div>

      {/* All Projects link */}
      <div className="px-3 pt-1">
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
              {MODULE_LABELS[activeModule as ModuleSlug]}
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

      {/* Module switcher — always lists all five modules so users can see what
          the platform offers. A module that is switched off on this deployment
          (VITE_MODULES_ENABLED) or not granted to the user is shown greyed out
          and can't be opened, instead of being hidden or leading to a 503. */}
      {projectId && (
        <div className="mt-4 border-t border-slate-700 px-3 pt-3" data-sidebar-section="module-switch">
          <div className="mb-2 px-2.5">
            <MonoLabel className="text-slate-500">Switch module</MonoLabel>
          </div>
          <div className="flex flex-col gap-0.5">
            {Object.entries(MODULE_LABELS).map(([key, label]) => {
              const colour = MODULE_COLOURS[key]
              const isActive = key === activeModule
              const moduleKey = MODULE_SLUG_TO_KEY[key as ModuleSlug]
              const enabled = !!moduleKey && isModuleEnabled(moduleKey)
              const available = canSeeModule(key)
              const why = !enabled ? 'Not enabled on this deployment' : !available ? 'Not included in your access — ask your admin' : undefined
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => available && navigate(`/projects/${projectId}/${key}`)}
                  disabled={!available}
                  title={why}
                  data-module-switch={key}
                  data-module-available={available}
                  className={`flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-xs transition-colors text-left ${
                    !available
                      ? 'cursor-not-allowed text-slate-600'
                      : isActive ? 'text-white' : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  <div className="h-2 w-2 flex-none rounded-full" style={{ backgroundColor: colour, opacity: available ? 1 : 0.35 }} />
                  <span className="flex-1">{label}</span>
                  {!available && <span className="font-mono text-[9px] uppercase tracking-wider text-slate-600">{!enabled ? 'Off' : 'No access'}</span>}
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
                end={needsExactMatch(item.href)}
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

      {/* Library — for users who don't get the Platform section above */}
      {libraryItems.length > 0 && (
        <div className="mt-4 px-3" data-sidebar-section="library">
          <div className="mb-2 px-2.5">
            <MonoLabel className="text-slate-500">Library</MonoLabel>
          </div>
          <nav className="flex flex-col gap-0.5">
            {libraryItems.map(item => (
              <NavLink
                key={item.href}
                to={item.href}
                end
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
                <span className="flex-none">{item.icon}</span>
                <span>{item.label}</span>
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
                end={needsExactMatch(item.href)}
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
                <span className="flex-none">{item.icon}</span>
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
