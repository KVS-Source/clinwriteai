import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useProjectStore } from '../../store/projectStore'
import { useDocumentStore } from '../../store/documentStore'
import { usePlatformStore, PLATFORM_DEMO_USERS, hasPersonaOverride, clearPersonaOverride } from '../../platform/store'
import { PLATFORM_USER_ROLE_LABEL } from '@platform/types'
import type { PlatformUser } from '@platform/types'

// Module slug → label for the breadcrumb crumb between the project and the
// document. Kept inline since this is the only consumer of the mapping;
// adding a module here needs no other code change.
const MODULE_LABEL: Record<string, string> = {
  'clinical-writing':    'Clinical Writing',
  'scientific-writing':  'Scientific Writing',
  'medical-writing':     'Medical Writing',
  'regulatory-writing':  'Regulatory Writing',
  'ideation-publishing': 'Ideation & Publishing',
}

function BellIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M9 1.5a5.25 5.25 0 0 1 5.25 5.25c0 2.625.656 4.219 1.313 5.25H2.437c.657-1.031 1.313-2.625 1.313-5.25A5.25 5.25 0 0 1 9 1.5Z"/>
      <path d="M6.75 15a2.25 2.25 0 0 0 4.5 0"/>
    </svg>
  )
}
function ChevronIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M3 4.5 6 7.5 9 4.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

function initialsFor(name: string): string {
  return name.split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('')
}

// Group personas for the switcher menu. Post 2026-10-27 role consolidation:
// 'super-admin' is retired → platform admin = role='admin' with tenantId=null;
// tenant-scoped admins = role='admin' with a tenant id.
function groupPersonas(users: PlatformUser[]) {
  const platformAdmin = users.filter(u => u.role === 'admin' && (u.tenantId ?? null) == null)
  const tenantAdmin   = users.filter(u => u.role === 'admin' && (u.tenantId ?? null) != null)
  const moduleUsers   = users.filter(u => u.role !== 'admin' && u.status === 'active')
  const invited       = users.filter(u => u.status === 'invited')
  return [
    { label: 'Platform Admin (GenBioCa)', users: platformAdmin },
    { label: 'Client Admin',              users: tenantAdmin },
    { label: 'Module users',              users: moduleUsers },
    { label: 'Invited (not activated)',   users: invited },
  ].filter(g => g.users.length > 0)
}

// Colour by role for the avatar tint. 'super-admin' key kept for legacy demo
// fixtures that may still carry it; new code uses 'admin'.
const ROLE_COLOUR: Record<string, string> = {
  'super-admin':               '#1A3C5E',
  'admin':                     '#2563EB',
  'ideation-lead':             '#0D9488',
  'ma-team-lead':              '#0D9488',
  'content-calendar-manager':  '#0D9488',
  'regulatory-writer':         '#B0200D',
  'cmc-lead':                  '#B0200D',
  'clinical-lead':             '#2563EB',
  'author':                    '#7C3AED',
  'qc-checker':                '#94A3B8',
  'e-signatory':               '#94A3B8',
  'creative-team-member':      '#0D9488',
}

export function TopNav() {
  const navigate       = useNavigate()
  const { pathname }   = useLocation()
  const project        = useProjectStore(s => s.activeProject)
  const activeDocument = useDocumentStore(s => s.activeDocument)
  const currentUser    = usePlatformStore(s => s.currentUser)
  const setCurrentUser = usePlatformStore(s => s.setCurrentUser)

  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // Enriched breadcrumb when inside a document editor so the in-screen
  // "All Projects › … › Clinical Writing › DSUR Year 2" row can be dropped
  // and the content area gets a free ~24px of vertical space. The last
  // crumb is the document title; shown as a label (non-link) because the
  // user is already on it.
  //
  // Route shape: /projects/:projectId/<module-slug>/documents/:documentId...
  const docRouteMatch = /\/projects\/([^/]+)\/([^/]+)\/documents\/([^/]+)/.exec(pathname)
  const moduleSlug    = docRouteMatch?.[2]
  const moduleLabel   = moduleSlug ? MODULE_LABEL[moduleSlug] : null

  const crumbs: Array<{ label: string; href: string | null }> = [
    { label: 'Projects', href: '/projects' },
    project ? { label: project.shortTitle, href: `/projects/${project.id}` } : null,
    docRouteMatch && moduleLabel && project
      ? { label: moduleLabel, href: `/projects/${project.id}/${moduleSlug}` }
      : null,
    docRouteMatch && activeDocument
      ? { label: activeDocument.title, href: null }
      : null,
  ].filter(Boolean) as Array<{ label: string; href: string | null }>

  const currentRoleLabel = PLATFORM_USER_ROLE_LABEL[currentUser.role] ?? currentUser.role
  const groups = groupPersonas(PLATFORM_DEMO_USERS)

  const switchTo = (u: PlatformUser) => {
    // setCurrentUser persists the user id under
    // 'clinwrite.demo.currentUserId'; apps/web/src/api/client.ts reads
    // that key and sends it as X-Demo-Persona on every request so the
    // API resolves the matching DB user and returns the right role.
    setCurrentUser(u)
    setOpen(false)
    // Reload so every query re-fetches under the new persona and permission-scoped
    // fixtures (notifications, RACI, etc.) render for the new user.
    if (typeof window !== 'undefined') window.location.reload()
  }

  return (
    <header
      className="flex h-14 flex-none items-center justify-between px-6"
      style={{ backgroundColor: '#1E293B', borderBottom: '1px solid rgba(255,255,255,0.08)' }}
      data-topnav
    >

      {/* Left — breadcrumb. Last crumb is a label (not a link) when the user
          is already on that resource — e.g. inside a document editor, the
          document title crumb has href=null and renders as a non-clickable
          span so there's no self-navigation. Truncate the document title on
          narrow screens so the persona switcher never gets squeezed. */}
      <nav className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
        {crumbs.map((crumb, i) => (
          <span key={`${i}-${crumb.label}`} className="flex min-w-0 items-center gap-2">
            {i > 0 && <span className="flex-none text-slate-500">/</span>}
            {crumb.href
              ? (
                <button
                  onClick={() => navigate(crumb.href!)}
                  className="flex-none text-sm font-medium text-slate-400 hover:text-white transition-colors"
                >
                  {crumb.label}
                </button>
              )
              : (
                <span className="truncate text-sm font-semibold text-white" title={crumb.label}>
                  {crumb.label}
                </span>
              )}
          </span>
        ))}
      </nav>

      {/* Right — actions + persona switcher */}
      <div className="flex items-center gap-4">

        <button
          className="relative flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
          onClick={() => navigate('/notifications')}
          title="Notifications"
        >
          <BellIcon />
          <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-blue-600" />
        </button>

        <div className="h-6 w-px bg-slate-700" />

        {/* Persona switcher */}
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setOpen(v => !v)}
            data-persona-trigger
            data-current-user-id={currentUser.id}
            className="flex items-center gap-2.5 rounded-md px-2 py-1 hover:bg-slate-800 transition-colors"
          >
            <span
              className="flex h-8 w-8 items-center justify-center rounded-full font-mono text-xs font-bold text-white"
              style={{ backgroundColor: ROLE_COLOUR[currentUser.role] ?? '#475569' }}
            >{initialsFor(currentUser.name)}</span>
            <div className="hidden text-left sm:block">
              <p className="text-sm font-semibold leading-tight text-white">{currentUser.name}</p>
              <p className="text-xs leading-tight text-slate-400">{currentRoleLabel}</p>
            </div>
            <span className="text-slate-400"><ChevronIcon /></span>
          </button>

          {open && (
            <div
              className="absolute right-0 top-full z-50 mt-2 w-[320px] overflow-hidden rounded-lg border border-slate-700 bg-white shadow-xl"
              data-persona-menu
            >
              <div className="px-3 py-2" style={{ backgroundColor: '#F8FAFC', borderBottom: '1px solid #E2E8F0' }}>
                <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Switch persona (demo)</p>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  Role guards are enforced: each persona only reaches the pages its role allows. Switching persona changes this browser's demo context (RACI, notifications, menus); it does not change your real sign-in.
                </p>
              </div>

              <div className="max-h-[70vh] overflow-y-auto">
                {groups.map(group => (
                  <div key={group.label}>
                    <p className="px-3 pt-3 pb-1 font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">{group.label}</p>
                    {group.users.map(u => {
                      const isCurrent = u.id === currentUser.id
                      const roleLabel = PLATFORM_USER_ROLE_LABEL[u.role] ?? u.role
                      return (
                        <button
                          key={u.id}
                          type="button"
                          onClick={() => switchTo(u)}
                          disabled={u.status === 'invited'}
                          data-persona-option={u.id}
                          data-persona-current={isCurrent || undefined}
                          className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                          style={{ backgroundColor: isCurrent ? '#EFF6FF' : undefined }}
                        >
                          <span
                            className="flex h-8 w-8 flex-none items-center justify-center rounded-full font-mono text-[11px] font-bold text-white"
                            style={{ backgroundColor: ROLE_COLOUR[u.role] ?? '#475569' }}
                          >{initialsFor(u.name)}</span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[13px] font-semibold text-slate-900">
                              {u.name}
                              {isCurrent && <span className="ml-1.5 font-mono text-[10px] font-normal text-blue-700">✓ active</span>}
                            </p>
                            <p className="truncate font-mono text-[10px] text-slate-500">
                              {roleLabel} · modules {u.modules.join(', ') || '—'}
                            </p>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                ))}
              </div>

              <div className="border-t border-slate-200 px-3 py-2">
                {hasPersonaOverride() && (
                  <button
                    type="button"
                    onClick={() => { clearPersonaOverride(); window.location.reload() }}
                    className="mb-1.5 w-full rounded-md border border-slate-300 px-2 py-1.5 text-[12px] font-semibold text-slate-700 hover:bg-slate-50"
                    data-action="use-real-signin"
                  >Use my real sign-in</button>
                )}
                <p className="font-mono text-[10px] text-slate-500">
                  Selection persists in localStorage · reload happens on switch
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
