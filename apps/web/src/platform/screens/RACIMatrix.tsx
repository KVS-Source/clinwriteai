import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useBlocker, useLocation, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type {
  RaciTask, PlatformUser, RACIRole, AuditTrailEntry, PlatformUserRole,
  ProjectRaciAssignment, ProjectRaciAssignmentBody,
} from '@platform/types'
import { PLATFORM_ACCENT, PLATFORM_USER_ROLE_LABEL } from '@platform/types'
import { projectsApi } from '../../api'
import { ApiError } from '../../api/client'
import { SlidePanel } from '../../components/ui'
import { platformApi } from '../api/platformApi'
import { usePlatformStore } from '../store'
import { DEFAULT_RACI_TEMPLATE as DEFAULT_TEMPLATE, raciActivityKey as activityKey, raciRoleOf } from '../raciTemplate'
import { isAdminRole } from '../../config/roles'

type ModuleKey = 'A' | 'B' | 'C' | 'D' | 'E'

const INACTIVE_STATUSES: string[] = ['suspended', 'deprovisioned']

const RACI_COLOURS: Record<RACIRole, { bg: string; fg: string }> = {
  R: { bg: '#FEF2F2', fg: '#B0200D' },
  A: { bg: '#FFFBEB', fg: '#D97706' },
  C: { bg: '#EFF6FF', fg: '#1A3C5E' },
  I: { bg: '#F1F5F9', fg: '#475569' },
}

const MODULE_LABEL_KEYS: Record<'A' | 'B' | 'C' | 'D' | 'E', string> = {
  A: 'page.raci_matrix.module_a',
  B: 'page.raci_matrix.module_b',
  C: 'page.raci_matrix.module_c',
  D: 'page.raci_matrix.module_d',
  E: 'page.raci_matrix.module_e',
}

// Account role as a readable label. The API's roles (reviewer, read-only, …) aren't all
// in PLATFORM_USER_ROLE_LABEL, so fall back to the id with dashes turned into spaces.
function accountRoleLabel(u: PlatformUser): string {
  const role = String(u.role)
  const known = PLATFORM_USER_ROLE_LABEL[role as PlatformUserRole]
  if (known) return known
  const words = role.replace(/-/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

function initialsFor(name: string): string {
  return name.split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('')
}

// Signed-off stages — audit entries where action='SIGNATURE_APPLIED' && module=X
// Any A cell in a signed stage's row is read-only per brief §76.
function computeSignedStages(audit: AuditTrailEntry[]): { module: string; entityId: string }[] {
  return audit.filter(a => a.action === 'SIGNATURE_APPLIED').map(a => ({ module: a.module, entityId: a.entityId }))
}

// A customised row replaces the template marks: each role column shows the
// strongest mark held by anyone of that role in the saved assignment (A > R > C > I).
// People whose role isn't a column here still appear in the row's people line.
const MARK_STRENGTH: RACIRole[] = ['A', 'R', 'C', 'I']
function marksFromOverride(o: ProjectRaciAssignment, roleOfUser: (id: string) => string | undefined): Record<string, RACIRole> {
  const marks: Record<string, RACIRole> = {}
  const put = (id: string | null, mark: RACIRole) => {
    const role = id ? roleOfUser(id) : undefined
    if (!role) return
    const current = marks[role]
    if (!current || MARK_STRENGTH.indexOf(mark) < MARK_STRENGTH.indexOf(current)) marks[role] = mark
  }
  put(o.accountableId, 'A')
  put(o.responsibleId, 'R')
  o.consultedIds.forEach(id => put(id, 'C'))
  o.informedIds.forEach(id => put(id, 'I'))
  return marks
}

export function RACIMatrix() {
  const { t } = useTranslation()
  const currentUser = usePlatformStore(s => s.currentUser)
  // Mirrors the API's requireAuth({ roles: ['admin'] }) on PUT/DELETE.
  const canEdit = isAdminRole(currentUser.role)
  const raci = DEFAULT_TEMPLATE
  const { data: projects = [], isLoading: projectsLoading, isError: projectsError, refetch: refetchProjects } =
    useQuery({ queryKey: ['projects'], queryFn: () => projectsApi.list() })
  const { data: users = [], isSuccess: usersLoaded, isError: usersError, refetch: refetchUsers } =
    useQuery<PlatformUser[]>({ queryKey: ['admin-users'], queryFn: () => platformApi.listUsers() })
  const { data: audit = [] } = useQuery<AuditTrailEntry[]>({ queryKey: ['audit'],    queryFn: () => platformApi.listAudit() })

  // Module + project live in the URL (?module=A&project=…) so they survive the
  // full page reload the persona switcher does, and links are shareable.
  const [searchParams, setSearchParams] = useSearchParams()
  const setParam = (key: 'module' | 'project', value: string) =>
    setSearchParams(prev => { const next = new URLSearchParams(prev); next.set(key, value); return next }, { replace: true })

  const moduleParam = searchParams.get('module') as ModuleKey | null
  const activeModule: ModuleKey = moduleParam && raci.modules[moduleParam] ? moduleParam : 'A'
  const setActiveModule = (m: ModuleKey) => setParam('module', m)

  // Default to VELORA-301 (the template's reference project), else the first project.
  const projectParam = searchParams.get('project')
  const projectId = (projectParam && projects.some(p => p.id === projectParam))
    ? projectParam
    : (projects.find(p => p.id === 'proj-velora-301') ?? projects[0])?.id ?? ''
  const setProjectId = (id: string) => setParam('project', id)

  const [mineOn, setMineOn] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  // Tasks in the edit panel with unsaved changes. The panel unmounts its contents
  // on close, so closing with drafts open asks first (inline, no browser dialog).
  const [dirtyTasks, setDirtyTasks] = useState<Set<string>>(new Set())
  const [pendingClose, setPendingClose] = useState(false)
  const reportDirty = useCallback((activity: string, dirty: boolean) => {
    setDirtyTasks(prev => {
      if (prev.has(activity) === dirty) return prev
      const next = new Set(prev)
      if (dirty) next.add(activity); else next.delete(activity)
      return next
    })
  }, [])
  const closePanel = () => { setPendingClose(false); setEditOpen(false) }
  const requestClosePanel = () => { if (dirtyTasks.size > 0) setPendingClose(true); else closePanel() }

  // Any in-app navigation while drafts exist — module/project switches, the browser's back
  // button, links — is held until the user decides. Closing or reloading the tab can only
  // use the browser's own prompt.
  const hasUnsaved = dirtyTasks.size > 0
  const blocker = useBlocker(hasUnsaved)
  const { pathname } = useLocation()
  useEffect(() => {
    if (!hasUnsaved) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [hasUnsaved])

  const discardPrompt = blocker.state === 'blocked'
    ? {
        what:    blocker.location.pathname === pathname ? t('page.raci_matrix.discard_switching') : t('page.raci_matrix.discard_leaving'),
        keep:    () => blocker.reset(),
        discard: () => blocker.proceed(),
      }
    : pendingClose
      ? { what: t('page.raci_matrix.discard_closing'), keep: () => setPendingClose(false), discard: closePanel }
      : null

  const { data: overrides = [], isLoading: overridesLoading, isError: overridesError, refetch: refetchOverrides } = useQuery<ProjectRaciAssignment[]>({
    queryKey: ['project-raci', projectId],
    queryFn:  () => platformApi.listProjectRaci(projectId),
    enabled:  !!projectId,
  })
  const overrideByActivity = useMemo(
    () => new Map(overrides.map(o => [o.activity, o])),
    [overrides],
  )
  const usersById = useMemo(() => new Map(users.map(u => [u.id, u])), [users])
  const roleOfUserId = useCallback((id: string) => {
    const u = usersById.get(id)
    return u ? raciRoleOf(u) : undefined
  }, [usersById])
  // Never surface a raw id: unknown ids are accounts that no longer exist (or the list failed to load).
  const userName = (id: string | null) => {
    if (!id) return '—'
    const name = usersById.get(id)?.name
    if (name) return name
    return usersLoaded ? t('page.raci_matrix.unknown_user') : '—'
  }
  // Deprovisioned / suspended accounts can't take on RACI work.
  const assignableUsers = useMemo(
    () => users.filter(u => !INACTIVE_STATUSES.includes(u.status)),
    [users],
  )

  const selectedProject = projects.find(p => p.id === projectId)
  const moduleTasks = raci.modules[activeModule]?.tasks ?? []
  const moduleLabel = t(MODULE_LABEL_KEYS[activeModule])
  const customisedCount = moduleTasks.filter(ta => overrideByActivity.has(activityKey(activeModule, ta.id))).length

  // Marks shown per task: the template's, or — for a customised task — derived from the saved people.
  const marksByTask = useMemo(() => {
    const m = new Map<string, Record<string, RACIRole | undefined>>()
    for (const ta of moduleTasks) {
      const o = overrideByActivity.get(activityKey(activeModule, ta.id))
      m.set(ta.id, o ? marksFromOverride(o, roleOfUserId) : (ta.assignments as Record<string, RACIRole | undefined>))
    }
    return m
  }, [moduleTasks, overrideByActivity, activeModule, roleOfUserId])

  const allRoles = useMemo(() => {
    const s = new Set<string>()
    moduleTasks.forEach(ta => Object.keys(ta.assignments).forEach(r => s.add(r)))
    return Array.from(s)
  }, [moduleTasks])

  // Customised tasks match on the people saved for this project; template
  // tasks fall back to matching the current user's role column.
  const filteredTasks = useMemo(() => {
    if (!mineOn) return moduleTasks
    return moduleTasks.filter(ta => {
      const o = overrideByActivity.get(activityKey(activeModule, ta.id))
      if (o) {
        return [o.responsibleId, o.accountableId, ...o.consultedIds, ...o.informedIds].includes(currentUser.id)
      }
      return Object.keys(ta.assignments).includes(currentUser.role)
    })
  }, [moduleTasks, mineOn, overrideByActivity, activeModule, currentUser.id, currentUser.role])

  const peopleInRoles = useMemo(() => {
    return allRoles.map(role => ({
      role,
      people: assignableUsers.filter(u => raciRoleOf(u) === role),
    }))
  }, [allRoles, assignableUsers])

  const signedStages = useMemo(() => computeSignedStages(audit), [audit])

  const isRowLocked = (taskLabel: string) => {
    // A row is locked when an audit SIGNATURE_APPLIED exists for that module/stage
    if (!taskLabel.includes('Stage')) return false
    return signedStages.some(s => s.module === activeModule)
  }

  return (
    <div className="bg-slate-50" data-screen="raci-matrix">
      <div className="flex flex-col gap-4 px-4 pb-12 pt-5 sm:px-8" style={{ maxWidth: 1440 }}>

        <nav className="flex items-center gap-2 text-xs text-slate-500">
          <span>{t('page.raci_matrix.crumb_platform')}</span>
          <span style={{ color: '#CBD5E1' }}>&gt;</span>
          <span className="font-semibold text-slate-900">{t('page.raci_matrix.crumb_raci_matrix')}</span>
        </nav>

        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <h1 className="text-[22px] font-bold text-slate-900" style={{ margin: 0 }}>{t('page.raci_matrix.title')}</h1>
            <p className="mt-1 font-mono text-xs text-slate-500" data-current-user>
              {currentUser.name} · {isAdminRole(currentUser.role) ? t('page.raci_matrix.role_admin') : PLATFORM_USER_ROLE_LABEL[currentUser.role]}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">

          {/* Left panel */}
          <aside className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4" data-project-selector>
            <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">{t('page.raci_matrix.project_label')}</p>
            {projectsError && (
              <p className="text-[11px] text-red-700" role="alert" data-error="projects">
                {t('page.raci_matrix.err_load_projects')}{' '}
                <button type="button" onClick={() => refetchProjects()} className="font-semibold underline">{t('page.raci_matrix.retry')}</button>
              </p>
            )}
            <select
              data-project-select
              value={projectId}
              onChange={e => setProjectId(e.target.value)}
              disabled={projects.length === 0}
              className="h-9 w-full min-w-0 truncate rounded-md border border-slate-300 bg-white px-3 text-[13px]"
            >
              {projects.length === 0 && <option value="">{projectsLoading ? t('page.raci_matrix.loading_projects') : t('page.raci_matrix.no_projects')}</option>}
              {projects.map(p => (
                <option key={p.id} value={p.id} title={p.name}>{p.shortTitle || p.name}</option>
              ))}
            </select>

            <p className="mt-2 font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">{t('page.raci_matrix.module_label')}</p>
            <div className="flex flex-wrap gap-1 lg:flex-col" data-module-tabs>
              {(['A','B','C','D','E'] as const).map(m => {
                const isActive = m === activeModule
                const disabled = !raci.modules[m]
                return (
                  <button
                    key={m}
                    type="button"
                    disabled={disabled}
                    onClick={() => setActiveModule(m)}
                    data-module-tab={m}
                    data-active={isActive || undefined}
                    title={disabled ? t('page.raci_matrix.no_template_tooltip') : undefined}
                    className="h-9 min-w-[8rem] flex-1 rounded-md px-3 text-left text-[12px] font-semibold disabled:cursor-not-allowed disabled:opacity-40 lg:w-full lg:flex-none"
                    style={{
                      backgroundColor: isActive ? PLATFORM_ACCENT.primary : '#F1F5F9',
                      color:           isActive ? '#FFFFFF' : '#334155',
                    }}
                  >{t(MODULE_LABEL_KEYS[m])}</button>
                )
              })}
            </div>
          </aside>

          {/* Right panel */}
          <section className="flex min-w-0 flex-col gap-4 rounded-lg border border-slate-200 bg-white p-4 sm:p-5" data-raci-content>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">{t('page.raci_matrix.matrix_eyebrow')}</p>
                <p className="mt-1 text-[16px] font-bold text-slate-900" data-heading>
                  {moduleLabel} · {selectedProject ? (selectedProject.shortTitle || selectedProject.name) : '—'}
                </p>
                <p className="mt-1 text-[12px] text-slate-600" data-customised-count={customisedCount}>
                  {customisedCount === 0
                    ? t('page.raci_matrix.default_template_applied')
                    : t('page.raci_matrix.customised_count', { count: customisedCount })}
                  {' '}{t('page.raci_matrix.project_specific_note')}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setMineOn(!mineOn)}
                  data-mine-toggle
                  data-mine-on={mineOn || undefined}
                  className="h-8 rounded-md border border-slate-300 bg-white px-3 text-[12px] font-semibold text-slate-700 hover:bg-slate-50"
                >{mineOn ? t('page.raci_matrix.show_all_tasks') : t('page.raci_matrix.show_my_tasks')}</button>
                {canEdit && (
                  <button
                    type="button"
                    data-edit-assignments
                    onClick={() => setEditOpen(true)}
                    disabled={!projectId || moduleTasks.length === 0}
                    className="h-8 rounded-md border px-3 text-[12px] font-semibold disabled:cursor-not-allowed disabled:opacity-40"
                    style={{ borderColor: PLATFORM_ACCENT.primary, color: PLATFORM_ACCENT.primary }}
                  >{t('page.raci_matrix.edit_assignments')}</button>
                )}
              </div>
            </div>

            {(overridesError || usersError) && (
              <div className="flex flex-col gap-1 rounded-md border border-red-200 bg-red-50 p-3 text-[12px] text-red-800" role="alert" data-error="load">
                {overridesError && (
                  <p>
                    {t('page.raci_matrix.err_overrides')}{' '}
                    <button type="button" onClick={() => refetchOverrides()} className="font-semibold underline">{t('page.raci_matrix.retry')}</button>
                  </p>
                )}
                {usersError && (
                  <p>
                    {t('page.raci_matrix.err_users')}{' '}
                    <button type="button" onClick={() => refetchUsers()} className="font-semibold underline">{t('page.raci_matrix.retry')}</button>
                  </p>
                )}
              </div>
            )}
            {overridesLoading && !!projectId && (
              <p className="text-[12px] text-slate-500" data-loading="overrides">{t('page.raci_matrix.loading_overrides')}</p>
            )}

            {/* Matrix table */}
            <div className="overflow-auto rounded-lg border border-slate-200" data-raci-table>
              <table className="w-full min-w-[640px] text-[12px]">
                <thead style={{ backgroundColor: '#F8FAFC' }}>
                  <tr className="text-left">
                    <th className="sticky left-0 z-10 border-r border-slate-100 px-3 py-2 font-semibold" style={{ backgroundColor: '#F8FAFC' }}>{t('page.raci_matrix.col_task')}</th>
                    {allRoles.map(r => {
                      const mine = r === currentUser.role
                      return (
                        <th
                          key={r}
                          className="px-3 py-2 text-center font-semibold text-slate-700"
                          style={mine ? { backgroundColor: PLATFORM_ACCENT.bgTint, color: PLATFORM_ACCENT.primary } : undefined}
                          title={PLATFORM_USER_ROLE_LABEL[r as PlatformUserRole] ?? r}
                          data-my-column={mine || undefined}
                        >
                          {(PLATFORM_USER_ROLE_LABEL[r as PlatformUserRole] ?? r).split(' ').map((w, i) => i === 0 ? w : w[0]).join(' ')}
                          {mine && <span className="block font-mono text-[9px] uppercase tracking-widest">{t('page.raci_matrix.you')}</span>}
                        </th>
                      )
                    })}
                  </tr>
                </thead>
                <tbody>
                  {filteredTasks.map(ta => {
                    const locked = isRowLocked(ta.label)
                    const override = overrideByActivity.get(activityKey(activeModule, ta.id))
                    return (
                      <tr key={ta.id} className="border-t border-slate-200" data-raci-row={ta.id} data-row-locked={locked || undefined} data-row-customised={!!override || undefined}>
                        <td className="sticky left-0 z-10 border-r border-slate-100 bg-white px-3 py-2 font-semibold text-slate-900" style={{ backgroundColor: '#FFFFFF' }}>
                          {ta.label}
                          {locked && <span className="ml-2 font-mono text-[10px] text-slate-400">{t('page.raci_matrix.locked_tag')}</span>}
                          {override && (
                            <>
                              <span
                                className="ml-2 rounded px-1.5 py-0.5 font-mono text-[10px]"
                                style={{ backgroundColor: PLATFORM_ACCENT.bgTint, color: PLATFORM_ACCENT.primary }}
                              >{t('page.raci_matrix.customised_tag')}</span>
                              <p className="mt-1 font-mono text-[10px] font-normal text-slate-500" data-override-people>
                                {t('page.raci_matrix.override_r')} {userName(override.responsibleId)} · {t('page.raci_matrix.override_a')} {userName(override.accountableId)}
                                {override.consultedIds.length > 0 && ` · ${t('page.raci_matrix.override_c')} ${override.consultedIds.map(userName).join(', ')}`}
                                {override.informedIds.length > 0 && ` · ${t('page.raci_matrix.override_i')} ${override.informedIds.map(userName).join(', ')}`}
                              </p>
                            </>
                          )}
                        </td>
                        {allRoles.map(r => {
                          const mark = marksByTask.get(ta.id)?.[r]
                          const colStyle = r === currentUser.role ? { backgroundColor: PLATFORM_ACCENT.bgTint } : undefined
                          if (!mark) return <td key={r} className="px-3 py-2 text-center text-slate-300" style={colStyle}>—</td>
                          const c = RACI_COLOURS[mark]
                          return (
                            <td key={r} className="px-3 py-2 text-center" style={colStyle} data-raci-cell={`${r}-${mark}`}>
                              <span
                                className="inline-flex h-6 w-6 items-center justify-center rounded-md font-mono text-[11px] font-bold"
                                style={{ backgroundColor: c.bg, color: c.fg, border: `1px solid ${c.fg}44` }}
                                data-raci-mark={mark}
                              >{mark}</span>
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <p className="font-mono text-[11px] text-slate-500" data-row-count>
              {mineOn
                ? t('page.raci_matrix.task_count_mine', { count: filteredTasks.length, name: currentUser.name })
                : t('page.raci_matrix.task_count', { count: filteredTasks.length })}
            </p>
            {mineOn && filteredTasks.length === 0 && (
              <p className="text-[12px] text-slate-500" data-mine-empty>
                {t('page.raci_matrix.no_assignments', { module: moduleLabel })}
              </p>
            )}

            <div className="flex flex-wrap gap-3 text-[11px]" data-raci-legend>
              <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: RACI_COLOURS.R.bg, border: `1px solid ${RACI_COLOURS.R.fg}` }} />{t('page.raci_matrix.legend_r')}</span>
              <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: RACI_COLOURS.A.bg, border: `1px solid ${RACI_COLOURS.A.fg}` }} />{t('page.raci_matrix.legend_a')}</span>
              <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: RACI_COLOURS.C.bg, border: `1px solid ${RACI_COLOURS.C.fg}` }} />{t('page.raci_matrix.legend_c')}</span>
              <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: RACI_COLOURS.I.bg, border: `1px solid ${RACI_COLOURS.I.fg}` }} />{t('page.raci_matrix.legend_i')}</span>
            </div>

            <p className="font-mono text-[11px] text-slate-500" data-accountability-note>
              {t('page.raci_matrix.accountability_note')}
            </p>

            <div className="border-t border-slate-200 pt-4" data-people-panel>
              <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">{t('page.raci_matrix.people_in_roles')}</p>
              <div className="mt-3 grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
                {peopleInRoles.map(({ role, people }) => (
                  <div key={role} className="flex flex-col gap-2 rounded-md border border-slate-200 p-2" data-person-role={role}>
                    <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                      {PLATFORM_USER_ROLE_LABEL[role as PlatformUserRole] ?? role}
                    </p>
                    {people.length === 0 && (
                      <p className="text-[12px] italic text-slate-400" data-role-empty>{t('page.raci_matrix.no_one_in_role')}</p>
                    )}
                    {people.map(user => {
                      const isMe = user.id === currentUser.id
                      return (
                        <div key={user.id} className="flex items-center gap-2" data-person={user.id}>
                          <span
                            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-mono text-[11px] font-bold text-white"
                            style={{ backgroundColor: PLATFORM_ACCENT.primary }}
                          >{initialsFor(user.name)}</span>
                          <div>
                            <p className="text-[12px] font-semibold text-slate-900">
                              {user.name}{isMe && <span className="ml-1 font-mono text-[10px] text-slate-500">{t('page.raci_matrix.you_suffix')}</span>}
                            </p>
                            {user.status === 'invited' && <p className="font-mono text-[10px] text-slate-500">{t('page.raci_matrix.invited')}</p>}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ))}
              </div>
            </div>

            <p
              className="rounded-md p-3 text-[12px]"
              style={{ backgroundColor: PLATFORM_ACCENT.bgTint, color: PLATFORM_ACCENT.primary }}
              data-audit-note
            >
              {t('page.raci_matrix.audit_note')}
            </p>
          </section>
        </div>
      </div>

      {canEdit && projectId && (
        <SlidePanel
          open={editOpen}
          onClose={requestClosePanel}
          title={t('page.raci_matrix.edit_panel_title')}
          subtitle={`${moduleLabel} · ${selectedProject?.shortTitle || selectedProject?.name || projectId}`}
          storageKey="raci-edit-panel-width"
          defaultWidth={560}
        >
          <div className="flex flex-col gap-3 px-5 py-4" data-raci-edit-panel>
            {discardPrompt && (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-[12px] text-amber-900" role="alert" data-raci-discard-confirm>
                <p>
                  {t('page.raci_matrix.discard_prompt', { count: dirtyTasks.size, what: discardPrompt.what })}
                </p>
                <div className="mt-2 flex gap-2">
                  <button type="button" onClick={discardPrompt.keep}
                    className="h-7 rounded-md border border-slate-300 bg-white px-3 text-[11px] font-semibold text-slate-700">{t('page.raci_matrix.keep_editing')}</button>
                  <button type="button" onClick={discardPrompt.discard} data-raci-discard
                    className="h-7 rounded-md bg-amber-700 px-3 text-[11px] font-semibold text-white">{t('page.raci_matrix.discard_changes')}</button>
                </div>
              </div>
            )}
            {moduleTasks.map(ta => (
              <RaciTaskEditor
                key={`${projectId}-${ta.id}`}
                projectId={projectId}
                activity={activityKey(activeModule, ta.id)}
                task={ta}
                override={overrideByActivity.get(activityKey(activeModule, ta.id))}
                users={assignableUsers}
                accountableLocked={isRowLocked(ta.label)}
                onDirtyChange={reportDirty}
              />
            ))}
          </div>
        </SlidePanel>
      )}
    </div>
  )
}

// One task's editable R/A/C/I people. Saves via PUT (upsert), resets via DELETE.
function RaciTaskEditor({ projectId, activity, task, override, users, accountableLocked, onDirtyChange }: {
  projectId:         string
  activity:          string
  task:              RaciTask
  override:          ProjectRaciAssignment | undefined
  users:             PlatformUser[]
  accountableLocked: boolean
  onDirtyChange:     (activity: string, dirty: boolean) => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const fromOverride = (): ProjectRaciAssignmentBody => ({
    activity,
    responsibleId: override?.responsibleId ?? null,
    accountableId: override?.accountableId ?? null,
    consultedIds:  override?.consultedIds ?? [],
    informedIds:   override?.informedIds ?? [],
  })
  const [draft, setDraft] = useState<ProjectRaciAssignmentBody>(fromOverride)
  const [error, setError] = useState<string | null>(null)
  const [confirmReset, setConfirmReset] = useState(false)

  // Re-sync when the saved row changes (after save/reset or a refetch).
  useEffect(() => { setDraft(fromOverride()) }, [override?.updatedAt, override?.id])

  const saved = fromOverride()
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved)

  // Tell the panel about unsaved drafts (and clear on unmount) so closing can warn.
  useEffect(() => {
    onDirtyChange(activity, dirty)
    return () => onDirtyChange(activity, false)
  }, [activity, dirty, onDirtyChange])

  // Inline, human-readable messages only — never the raw API status or body.
  const onError = (e: unknown) => {
    if (!(e instanceof ApiError)) return setError(t('page.raci_matrix.err_network'))
    if (e.status === 401) return setError(t('page.raci_matrix.err_session_expired'))
    if (e.status === 403) return setError(t('page.raci_matrix.err_forbidden'))
    if (e.status === 404) return setError(t('page.raci_matrix.err_not_found'))
    if (e.status === 400 && (e.body as { error?: string } | null)?.error === 'unknown_user') {
      return setError(t('page.raci_matrix.err_unknown_user'))
    }
    if (e.status === 400 || e.status === 422) return setError(t('page.raci_matrix.err_invalid'))
    return setError(t('page.raci_matrix.err_generic'))
  }
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['project-raci', projectId] })

  const save = useMutation({
    mutationFn: () => platformApi.setProjectRaci(projectId, draft),
    onMutate:   () => setError(null),
    onSuccess:  invalidate,
    onError,
  })
  const reset = useMutation({
    mutationFn: () => platformApi.deleteProjectRaci(projectId, activity),
    onMutate:   () => setError(null),
    onSuccess:  () => { setConfirmReset(false); invalidate() },
    onError,
  })
  const busy = save.isPending || reset.isPending

  const toggle = (field: 'consultedIds' | 'informedIds', id: string) =>
    setDraft(d => ({ ...d, [field]: d[field].includes(id) ? d[field].filter(x => x !== id) : [...d[field], id] }))
  const clearField = (field: 'consultedIds' | 'informedIds') => setDraft(d => ({ ...d, [field]: [] }))

  const [open, setOpen] = useState(false)
  const usersById = useMemo(() => new Map(users.map(u => [u.id, u])), [users])
  const nameOf = (id: string | null) => (id && usersById.get(id)?.name) || '—'

  // Responsible / Accountable: one person each. Native select (keyboard + screen-reader friendly),
  // grouped by role so a long list stays scannable.
  const groupedUsers = useMemo(() => {
    const groups = new Map<string, PlatformUser[]>()
    for (const u of users) {
      const label = accountRoleLabel(u)
      groups.set(label, [...(groups.get(label) ?? []), u])
    }
    return Array.from(groups.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([label, list]) => [label, [...list].sort((a, b) => a.name.localeCompare(b.name))] as const)
  }, [users])

  const userSelect = (field: 'responsibleId' | 'accountableId', disabled = false, invalid = false) => (
    <select
      value={draft[field] ?? ''}
      disabled={disabled || busy}
      onChange={e => setDraft(d => ({ ...d, [field]: e.target.value || null }))}
      data-raci-select={field}
      required={field === 'accountableId'}
      aria-required={field === 'accountableId' || undefined}
      aria-invalid={invalid || undefined}
      className={`h-9 w-full rounded-md border bg-white px-2 text-[12px] disabled:bg-slate-50 ${invalid ? 'border-red-400' : 'border-slate-300'}`}
    >
      <option value="">{t('page.raci_matrix.unassigned_option')}</option>
      {groupedUsers.map(([label, list]) => (
        <optgroup key={label} label={label}>
          {list.map(u => <option key={u.id} value={u.id}>{u.name} — {label}</option>)}
        </optgroup>
      ))}
    </select>
  )

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm" data-raci-editor={activity}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        data-raci-editor-toggle
        className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-slate-50"
      >
        <span aria-hidden="true" className="mt-1 w-3 shrink-0 text-[10px] text-slate-400">{open ? '▾' : '▸'}</span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[13px] font-semibold text-slate-900">{task.label}</span>
            {override && (
              <span className="rounded px-1.5 py-0.5 font-mono text-[10px]"
                style={{ backgroundColor: PLATFORM_ACCENT.bgTint, color: PLATFORM_ACCENT.primary }}>{t('page.raci_matrix.customised_tag')}</span>
            )}
            {dirty && <span className="rounded bg-amber-100 px-1.5 py-0.5 font-mono text-[10px] text-amber-800" data-raci-unsaved>{t('page.raci_matrix.unsaved_tag')}</span>}
          </span>
          {!open && (
            <span className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1" data-raci-summary>
              <SummaryItem letter="R" value={draft.responsibleId ? nameOf(draft.responsibleId) : null} />
              <SummaryItem letter="A" value={draft.accountableId ? nameOf(draft.accountableId) : null} />
              <SummaryItem letter="C" value={draft.consultedIds.length ? t('page.raci_matrix.people_count', { count: draft.consultedIds.length }) : null} />
              <SummaryItem letter="I" value={draft.informedIds.length ? t('page.raci_matrix.people_count', { count: draft.informedIds.length }) : null} />
            </span>
          )}
        </span>
      </button>

      {open && (
        <div className="border-t border-slate-200 px-4 py-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-[11px] font-semibold text-slate-600">
              {t('page.raci_matrix.field_responsible')}
              {userSelect('responsibleId')}
            </label>
            <label className="flex flex-col gap-1 text-[11px] font-semibold text-slate-600">
              <span>{t('page.raci_matrix.field_accountable')} <span className="text-red-700" aria-hidden="true">*</span>{accountableLocked && ' 🔒'}</span>
              {userSelect('accountableId', accountableLocked, !draft.accountableId)}
            </label>
          </div>
          {!draft.accountableId && !accountableLocked && (
            <p className="mt-1 text-[11px] text-red-700" role="alert" data-raci-accountable-hint>
              {t('page.raci_matrix.accountable_hint')}
            </p>
          )}
          {accountableLocked && (
            <p className="mt-1 font-mono text-[10px] text-slate-400">{t('page.raci_matrix.stage_signed_note')}</p>
          )}

          <div className="mt-4 flex flex-col gap-4">
            <PeoplePicker
              label={t('page.raci_matrix.field_consulted')}
              field="consultedIds"
              users={users}
              selectedIds={draft.consultedIds}
              disabled={busy}
              onToggle={id => toggle('consultedIds', id)}
              onClear={() => clearField('consultedIds')}
            />
            <PeoplePicker
              label={t('page.raci_matrix.field_informed')}
              field="informedIds"
              users={users}
              selectedIds={draft.informedIds}
              disabled={busy}
              onToggle={id => toggle('informedIds', id)}
              onClear={() => clearField('informedIds')}
            />
          </div>

          {error && <p className="mt-3 text-[11px] text-red-700" role="alert">{error}</p>}

          <div className="mt-4 flex items-center justify-end gap-2 border-t border-slate-100 pt-3">
            {override && (
              <button
                type="button"
                disabled={busy}
                onClick={() => setConfirmReset(true)}
                data-raci-reset
                className="h-8 rounded-md border border-slate-300 bg-white px-3 text-[12px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
              >{t('page.raci_matrix.reset_to_template')}</button>
            )}
            <button
              type="button"
              disabled={!dirty || busy || !draft.accountableId}
              title={!draft.accountableId ? t('page.raci_matrix.save_tooltip_no_a') : undefined}
              onClick={() => save.mutate()}
              data-raci-save
              className="h-8 rounded-md px-4 text-[12px] font-semibold text-white disabled:opacity-40"
              style={{ backgroundColor: PLATFORM_ACCENT.primary }}
            >{save.isPending ? t('page.raci_matrix.saving') : t('page.raci_matrix.save')}</button>
          </div>
        </div>
      )}

      {confirmReset && (
        <ConfirmResetDialog
          taskLabel={task.label}
          busy={reset.isPending}
          error={error}
          onCancel={() => { setConfirmReset(false); setError(null) }}
          onConfirm={() => reset.mutate()}
        />
      )}
    </div>
  )
}

// One "R  Name" pair in a collapsed task's summary row.
function SummaryItem({ letter, value }: { letter: RACIRole; value: string | null }) {
  const { t } = useTranslation()
  const c = RACI_COLOURS[letter]
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px]">
      <span
        className="inline-flex h-4 w-4 items-center justify-center rounded font-mono text-[9px] font-bold"
        style={{ backgroundColor: c.bg, color: c.fg, border: `1px solid ${c.fg}44` }}
      >{letter}</span>
      <span className={value ? 'font-medium text-slate-700' : 'text-slate-400'}>{value ?? t('page.raci_matrix.not_set')}</span>
    </span>
  )
}

// Multi-person picker for Consulted / Informed. Scales to long user lists: the chosen
// people show as compact removable chips, and a searchable, scrollable list (name or
// role) opens inline — inline, not a floating popover, so the scrolling panel can't clip it.
function PeoplePicker({ label, field, users, selectedIds, disabled, onToggle, onClear }: {
  label:       string
  field:       'consultedIds' | 'informedIds'
  users:       PlatformUser[]
  selectedIds: string[]
  disabled:    boolean
  onToggle:    (id: string) => void
  onClear:     () => void
}) {
  const { t } = useTranslation()
  const [adding, setAdding] = useState(false)
  const [query, setQuery] = useState('')

  const usersById = useMemo(() => new Map(users.map(u => [u.id, u])), [users])
  const selected = selectedIds.map(id => usersById.get(id)).filter((u): u is PlatformUser => !!u)
  const unknownCount = selectedIds.length - selected.length

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    return [...users]
      .filter(u => !q || `${u.name} ${accountRoleLabel(u)}`.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [users, query])

  return (
    <div data-raci-chips={field}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold text-slate-600">
          {label} <span className="font-normal text-slate-400">· {t('page.raci_matrix.selected_count', { count: selectedIds.length })}</span>
        </p>
        <div className="flex items-center gap-2">
          {selectedIds.length > 0 && (
            <button type="button" disabled={disabled} onClick={onClear}
              className="text-[11px] text-slate-500 underline disabled:opacity-40">{t('page.raci_matrix.clear_all')}</button>
          )}
          <button
            type="button"
            disabled={disabled}
            aria-expanded={adding}
            onClick={() => { setAdding(a => !a); setQuery('') }}
            className="h-7 rounded-md border border-slate-300 bg-white px-2.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >{adding ? t('page.raci_matrix.done') : t('page.raci_matrix.add_people')}</button>
        </div>
      </div>

      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {selected.length === 0 && unknownCount === 0 && (
          <p className="text-[11px] italic text-slate-400">{t('page.raci_matrix.no_one_selected')}</p>
        )}
        {selected.map(u => (
          <span
            key={u.id}
            className="inline-flex max-w-full items-center gap-1 rounded-md py-0.5 pl-2 pr-1 text-[11px]"
            style={{ backgroundColor: PLATFORM_ACCENT.bgTint, color: PLATFORM_ACCENT.primary }}
          >
            <span className="truncate font-semibold">{u.name}</span>
            <span className="truncate text-[10px] opacity-70">{accountRoleLabel(u)}</span>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onToggle(u.id)}
              aria-label={t('page.raci_matrix.remove_person_aria', { name: u.name })}
              className="ml-0.5 flex h-4 w-4 items-center justify-center rounded text-[12px] leading-none hover:bg-white/60 disabled:opacity-40"
            >×</button>
          </span>
        ))}
        {unknownCount > 0 && (
          <span className="text-[11px] text-slate-400">{t('page.raci_matrix.unknown_users', { count: unknownCount })}</span>
        )}
      </div>

      {adding && (
        <div className="mt-2 rounded-md border border-slate-300 bg-white" data-raci-picker-panel>
          <input
            type="search"
            autoFocus
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={t('page.raci_matrix.search_placeholder')}
            aria-label={t('page.raci_matrix.search_aria', { label })}
            className="h-8 w-full rounded-t-md border-b border-slate-200 px-3 text-[12px] outline-none"
          />
          <ul className="max-h-48 overflow-y-auto py-1">
            {matches.map(u => {
              const on = selectedIds.includes(u.id)
              return (
                <li key={u.id}>
                  <label className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-[12px] hover:bg-slate-50">
                    <input type="checkbox" checked={on} disabled={disabled} onChange={() => onToggle(u.id)} />
                    <span className="min-w-0 flex-1 truncate font-semibold text-slate-900">{u.name}</span>
                    <span className="shrink-0 text-[11px] text-slate-500">{accountRoleLabel(u)}</span>
                  </label>
                </li>
              )
            })}
            {matches.length === 0 && <li className="px-3 py-2 text-[12px] text-slate-400">{t('page.raci_matrix.no_matches', { query })}</li>}
          </ul>
          <p className="border-t border-slate-100 px-3 py-1 font-mono text-[10px] text-slate-400">
            {t('page.raci_matrix.match_count', { shown: matches.length, total: users.length })}
          </p>
        </div>
      )}
    </div>
  )
}

// Centred pop-up. Rendered in a portal because the slide-in panel is transformed,
// which would otherwise pin a fixed overlay to the panel instead of the screen.
function ConfirmResetDialog({ taskLabel, busy, error, onCancel, onConfirm }: {
  taskLabel: string
  busy:      boolean
  error:     string | null
  onCancel:  () => void
  onConfirm: () => void
}) {
  const { t } = useTranslation()
  // Escape cancels the dialog only — capture phase so the panel's own Escape handler doesn't also close it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      if (!busy) onCancel()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [busy, onCancel])

  return createPortal(
    <div
      className="fixed inset-0 flex items-center justify-center bg-slate-900/50 p-4"
      style={{ zIndex: 1000 }}
      onMouseDown={e => { if (e.target === e.currentTarget && !busy) onCancel() }}
      data-raci-reset-dialog
    >
      <div role="alertdialog" aria-modal="true" aria-labelledby="raci-reset-title" className="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl">
        <h2 id="raci-reset-title" className="text-[15px] font-bold text-slate-900">{t('page.raci_matrix.reset_dialog_title')}</h2>
        <p className="mt-2 text-[13px] text-slate-600">
          {t('page.raci_matrix.reset_dialog_body_prefix')} <span className="font-semibold">{taskLabel}</span> {t('page.raci_matrix.reset_dialog_body_suffix')}
        </p>
        {error && <p className="mt-2 text-[12px] text-red-700" role="alert">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            autoFocus
            disabled={busy}
            onClick={onCancel}
            className="h-8 rounded-md border border-slate-300 bg-white px-3 text-[12px] font-semibold text-slate-700 disabled:opacity-40"
          >{t('button.cancel')}</button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            data-raci-reset-confirm
            className="h-8 rounded-md bg-red-700 px-3 text-[12px] font-semibold text-white disabled:opacity-40"
          >{busy ? t('page.raci_matrix.resetting') : t('page.raci_matrix.confirm_reset')}</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
