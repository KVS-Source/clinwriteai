import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useLocation, useNavigate } from 'react-router-dom'
import { useProjectStore } from '../../store/projectStore'
import { useDocumentStore } from '../../store/documentStore'
import { useAuthStore } from '../../store/authStore'
import { authApi, documentsApi, projectsApi } from '../../api'
import { usePlatformStore, hasPersonaOverride, clearPersonaOverride, PLATFORM_DEMO_USERS } from '../../platform/store'
import { platformApi } from '../../platform/api/platformApi'
import { ApiError } from '../../api/client'
import { AUTH_BYPASS } from '../../config/auth'
import { PLATFORM_USER_ROLE_LABEL } from '@platform/types'
import type { PlatformUser } from '@platform/types'
import { MODULE_KEY_TO_LABEL, type ModuleKey } from '../../config/modules'
import { useTranslation } from 'react-i18next'
import { useAppLanguage } from '../../i18n/useAppLanguage'
import { SUPPORTED_LANGUAGES, LANGUAGE_LABELS } from '../../i18n'

// Module slug → i18n key for the breadcrumb crumb between the project and
// the document. Kept inline since this is the only consumer of the mapping;
// adding a module here needs no other code change.
const MODULE_LABEL_KEYS: Record<string, string> = {
  'clinical-writing':    'component.top_nav.module_clinical_writing',
  'scientific-writing':  'component.top_nav.module_scientific_writing',
  'medical-writing':     'component.top_nav.module_medical_writing',
  'regulatory-writing':  'component.top_nav.module_regulatory_writing',
  'ideation-publishing': 'component.top_nav.module_ideation_publishing',
}

// Within-module leaf slugs (e.g. /clinical-writing/comments) → i18n key.
// Only slugs that appear here get a leaf crumb; anything else falls through
// without a trailing crumb (the module landing page is enough context).
const LEAF_LABEL_KEYS: Record<string, string> = {
  'comments':     'component.top_nav.leaf_comments',
  'portfolio':    'component.top_nav.leaf_portfolio',
  'audit-review': 'component.top_nav.leaf_audit_review',
  'crm':          'component.top_nav.leaf_crm',
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

function LogOutIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M5.25 12.25H2.917a1.167 1.167 0 0 1-1.167-1.167V2.917A1.167 1.167 0 0 1 2.917 1.75H5.25" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M9.333 9.917 12.25 7 9.333 4.083M12.25 7h-7" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

function initialsFor(name: string): string {
  return name.split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('')
}

// Group personas for the switcher menu. Post 2026-10-27 role consolidation:
// 'super-admin' retired → platform admin = ('admin'|'tenant-admin') with
// tenantId=null; tenant-scoped admins = ('admin'|'tenant-admin') with a
// tenant id. 'pm' is its own bucket since migration 48 (canonical role).
const ADMIN_ROLES = new Set(['admin', 'tenant-admin', 'super-admin'])
function groupPersonas(users: PlatformUser[]) {
  const platformAdmin = users.filter(u => ADMIN_ROLES.has(u.role) && (u.tenantId ?? null) == null)
  const tenantAdmin   = users.filter(u => ADMIN_ROLES.has(u.role) && (u.tenantId ?? null) != null)
  const pms           = users.filter(u => u.role === 'pm' && u.status === 'active')
  const moduleUsers   = users.filter(u => !ADMIN_ROLES.has(u.role) && u.role !== 'pm' && u.status === 'active')
  const invited       = users.filter(u => u.status === 'invited')
  return [
    { labelKey: 'component.top_nav.persona_group_platform_admin',   users: platformAdmin },
    { labelKey: 'component.top_nav.persona_group_client_admin',     users: tenantAdmin },
    { labelKey: 'component.top_nav.persona_group_project_managers', users: pms },
    { labelKey: 'component.top_nav.persona_group_module_users',     users: moduleUsers },
    { labelKey: 'component.top_nav.persona_group_invited',          users: invited },
  ].filter(g => g.users.length > 0)
}

// Colour by role for the avatar tint. 'super-admin' key kept for legacy demo
// fixtures that may still carry it; new code uses 'admin'.
const ROLE_COLOUR: Record<string, string> = {
  'super-admin':               '#1A3C5E',
  'admin':                     '#2563EB',
  'tenant-admin':              '#2563EB',
  'pm':                        '#7C3AED',
  'contributor':               '#0D9488',
  'auditor':                   '#94A3B8',
  'guest':                     '#64748B',
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
  const logoutLocal    = useAuthStore(s => s.logout)
  const { t }          = useTranslation()
  const language       = useAppLanguage()

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

  // Enriched breadcrumbs so every screen under /projects/* can drop its own
  // in-screen "All Projects › Project › Module › Leaf" row and reclaim a
  // full line of vertical space. Four shapes we handle:
  //   /projects                                    → Projects
  //   /projects/:projectId                         → Projects / <Project>
  //   /projects/:projectId/<module>                → Projects / <Project> / <ModuleLabel>
  //   /projects/:projectId/<module>/<leaf>         → Projects / <Project> / <ModuleLabel> / <LeafLabel>
  //   /projects/:projectId/<module>/documents/:id  → Projects / <Project> / <ModuleLabel> / <DocTitle>
  //
  // The last crumb is a label (href=null) because the user is already on
  // that resource; everything prior is clickable.
  const projectRouteMatch = /^\/projects\/([^/]+)(?:\/([^/]+)(?:\/(.+))?)?/.exec(pathname)
  const inProjectRoute = !!projectRouteMatch
  const moduleSlug     = projectRouteMatch?.[2] ?? null
  const moduleLabel    = moduleSlug && MODULE_LABEL_KEYS[moduleSlug] ? t(MODULE_LABEL_KEYS[moduleSlug]!) : null
  const trailing       = projectRouteMatch?.[3] ?? ''      // whatever follows /module/
  const docMatch       = /^documents\/([^/]+)/.exec(trailing)

  // Screens that don't put the project / document into the store (CRM, E-Signature) used to get a
  // cut-short breadcrumb (CW-100). Load them from the URL instead, on the same query keys the
  // screens use, so this is normally a cache read.
  const routeProjectId  = projectRouteMatch?.[1] && projectRouteMatch[1] !== 'new' ? projectRouteMatch[1] : null
  const routeDocumentId = docMatch?.[1] ?? null
  const { data: routeProject } = useQuery({
    queryKey: ['project', routeProjectId],
    queryFn:  () => projectsApi.get(routeProjectId!),
    enabled:  !!routeProjectId && project?.id !== routeProjectId,
    retry:    false,
  })
  const { data: routeDocument } = useQuery({
    queryKey: ['document', routeDocumentId],
    queryFn:  () => documentsApi.get(routeDocumentId!),
    enabled:  !!routeDocumentId && activeDocument?.id !== routeDocumentId,
    retry:    false,
  })
  const crumbProject  = project?.id === routeProjectId ? project : routeProject ?? null
  const crumbDocument = activeDocument?.id === routeDocumentId ? activeDocument : routeDocument ?? null
  const leafSlug       = !docMatch && trailing ? trailing.split('/')[0]! : null
  const leafLabel      = leafSlug && LEAF_LABEL_KEYS[leafSlug] ? t(LEAF_LABEL_KEYS[leafSlug]!) : null

  const crumbs: Array<{ label: string; href: string | null }> = [
    ADMIN_ROLES.has(currentUser.role) ? null : { label: t('component.top_nav.crumb_projects'), href: '/projects' },
    inProjectRoute && crumbProject ? { label: crumbProject.shortTitle, href: `/projects/${crumbProject.id}` } : null,
    inProjectRoute && moduleLabel && crumbProject
      ? { label: moduleLabel, href: `/projects/${crumbProject.id}/${moduleSlug}` }
      : null,
    // Leaf OR document title — mutually exclusive since docMatch and
    // leafSlug can't both be truthy by construction above.
    docMatch && crumbDocument
      ? { label: crumbDocument.title, href: null }
      : leafLabel
        ? { label: leafLabel, href: null }
        : null,
  ].filter(Boolean) as Array<{ label: string; href: string | null }>

  const currentRoleLabel = PLATFORM_USER_ROLE_LABEL[currentUser.role] ?? currentUser.role

  // Persona list for the switcher — the real users, via /auth/demo-personas,
  // so every persona (admin or contributor) sees the same names. Lazy: only
  // fetch when the dropdown is actually opened. If that fails (e.g. an older
  // API without the route), fall back to the hardcoded PLATFORM_DEMO_USERS
  // fixture so the user still has a way to switch back to an admin persona.
  // Unread count of real notifications (e.g. @mentions); the dot shows only when there are some.
  const { data: unread } = useQuery({
    queryKey: ['notifications-unread'],
    queryFn:  () => platformApi.myUnreadNotificationCount(),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    retry: false,
  })
  const unreadCount = unread?.count ?? 0
  const { data: liveUsers, isPending: usersPending, error: usersError } = useQuery({
    queryKey: ['demo-personas'],
    queryFn:  () => platformApi.listDemoPersonas(),
    enabled:  open && AUTH_BYPASS,
    staleTime: 60_000,
    retry: false,
  })
  const forbidden = usersError instanceof ApiError
  const effectiveUsers = liveUsers ?? (forbidden ? PLATFORM_DEMO_USERS : null)
  const groups = effectiveUsers ? groupPersonas(effectiveUsers) : []

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

  // Demo (AUTH_BYPASS) persona panel "Log out": end the server session (revokes
  // it, clears the cookie, audits auth.logout), forget the demo persona, then a
  // full page load to /sign-in so every in-memory store and query cache starts
  // empty. A failed API call (e.g. no session under the dev bypass) still logs
  // out locally.
  const [loggingOut, setLoggingOut] = useState(false)
  const logOut = async () => {
    setLoggingOut(true)
    try { await authApi.logout() } catch { /* still sign out locally */ }
    clearPersonaOverride()
    logoutLocal()
    window.location.assign('/sign-in')
  }

  // Real sign-in only: end the session server-side, then back to sign-in.
  const [signingOut, setSigningOut] = useState(false)
  const signOut = async () => {
    setSigningOut(true)
    await authApi.logout().catch(() => undefined)
    window.location.assign('/sign-in')
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
          title={t('component.top_nav.notifications_title')}
        >
          <BellIcon />
          {unreadCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-600 px-1 font-mono text-[9px] font-bold text-white" data-notif-count>
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
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

          {/* Account menu — real sign-in replaces the demo persona switcher. */}
          {open && !AUTH_BYPASS && (
            <div
              className="absolute right-0 top-full z-50 mt-2 w-[260px] overflow-hidden rounded-lg border border-slate-700 bg-white shadow-xl"
              data-account-menu
            >
              <div className="px-3 py-2.5" style={{ backgroundColor: '#F8FAFC', borderBottom: '1px solid #E2E8F0' }}>
                <p className="truncate text-[13px] font-semibold text-slate-900">{currentUser.name}</p>
                <p className="truncate text-[11px] text-slate-500">{currentUser.email}</p>
                <p className="mt-0.5 font-mono text-[10px] text-slate-500">{currentRoleLabel}</p>
              </div>
              <button
                type="button"
                onClick={() => { setOpen(false); navigate('/set-password') }}
                className="flex w-full items-center px-3 py-2 text-left text-[13px] text-slate-700 hover:bg-slate-50"
                data-action="change-password"
              >{t('header.change_password')}</button>

              {/* Language toggle — Phase 1 i18n (2026-11-03). Chrome only;
                  content stays as authored. */}
              <div className="border-t border-slate-100 px-3 py-2.5" data-account-language>
                <p className="mb-1.5 font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                  {t('header.language')}
                </p>
                <div className="flex gap-1">
                  {SUPPORTED_LANGUAGES.map(code => {
                    const active = language.current === code
                    return (
                      <button
                        key={code}
                        type="button"
                        onClick={() => { void language.change(code) }}
                        aria-pressed={active}
                        data-language-toggle={code}
                        className={`flex-1 rounded-md border px-2 py-1 text-[12px] font-medium transition-colors ${
                          active
                            ? 'border-blue-500 bg-blue-50 text-blue-700'
                            : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                        }`}
                      >
                        {LANGUAGE_LABELS[code]}
                      </button>
                    )
                  })}
                </div>
              </div>

              <button
                type="button"
                onClick={signOut}
                disabled={signingOut}
                className="flex w-full items-center border-t border-slate-100 px-3 py-2 text-left text-[13px] font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-60"
                data-action="sign-out"
              >{signingOut ? t('header.signing_out') : t('header.sign_out')}</button>
            </div>
          )}

          {open && AUTH_BYPASS && (
            <div
              className="absolute right-0 top-full z-50 mt-2 flex w-[320px] flex-col overflow-hidden rounded-lg border border-slate-700 bg-white shadow-xl"
              style={{ maxHeight: 'calc(100vh - 4.5rem)' }}
              data-persona-menu
            >
              {/* Log out sits at the top so it's never pushed off-screen by a long persona list
                  (or hidden under the dev MSW badge in the bottom-right corner). */}
              <div className="flex-none px-3 py-2" style={{ borderBottom: '1px solid #E2E8F0' }}>
                <button
                  type="button"
                  onClick={() => { void logOut() }}
                  disabled={loggingOut}
                  className="flex w-full items-center justify-center gap-2 rounded-md bg-rose-600 px-2 py-2 text-[13px] font-semibold text-white hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
                  data-action="log-out"
                >
                  <LogOutIcon />
                  {loggingOut ? t('component.top_nav.logging_out') : t('component.top_nav.log_out')}
                </button>
              </div>

              <div className="flex-none px-3 py-2" style={{ backgroundColor: '#F8FAFC', borderBottom: '1px solid #E2E8F0' }}>
                <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">{t('component.top_nav.switch_persona_header')}</p>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  {t('component.top_nav.switch_persona_body')}
                </p>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto">
                {usersPending && (
                  <p className="px-3 py-6 text-center text-[12px] italic text-slate-500">{t('component.top_nav.users_loading')}</p>
                )}
                {usersError && !forbidden && (
                  <p className="px-3 py-4 text-center text-[12px] text-rose-600">
                    {t('component.top_nav.users_load_failed')}
                  </p>
                )}
                {forbidden && (
                  <p className="px-3 pt-2 pb-1 text-center text-[11px] italic text-slate-500">
                    {t('component.top_nav.users_demo_fallback')}
                  </p>
                )}
                {!usersPending && !usersError && groups.length === 0 && (
                  <p className="px-3 py-6 text-center text-[12px] italic text-slate-500">{t('component.top_nav.users_none')}</p>
                )}
                {groups.map(group => (
                  <div key={group.labelKey}>
                    <p className="px-3 pt-3 pb-1 font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">{t(group.labelKey)}</p>
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
                              {isCurrent && <span className="ml-1.5 font-mono text-[10px] font-normal text-blue-700">{t('component.top_nav.persona_active_marker')}</span>}
                            </p>
                            <p className="truncate font-mono text-[10px] text-slate-500">
                              {roleLabel}{u.modules.length > 0 && ` · ${u.modules.map(k => MODULE_KEY_TO_LABEL[k as ModuleKey] ?? k).join(', ')}`}
                            </p>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                ))}
              </div>

              <div className="flex-none border-t border-slate-200 px-3 py-2">
                {hasPersonaOverride() && (
                  <button
                    type="button"
                    onClick={() => { clearPersonaOverride(); window.location.reload() }}
                    className="mb-1.5 w-full rounded-md border border-slate-300 px-2 py-1.5 text-[12px] font-semibold text-slate-700 hover:bg-slate-50"
                    data-action="use-real-signin"
                  >{t('component.top_nav.use_real_signin')}</button>
                )}
                <p className="font-mono text-[10px] text-slate-500">
                  {t('component.top_nav.selection_persists_hint')}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
