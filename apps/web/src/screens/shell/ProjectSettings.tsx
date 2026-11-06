// Project Settings — v2 (team RACI editable).
//
// Access gated to Authors — team members with RACI='R' whose userId
// matches the current user — and the PM. Any Author can add / change /
// remove team members; a PM who isn't one sees the team read-only (the API
// refuses their edits) and controls the project's status here. Admins
// deliberately don't see this screen (API refuses too). Anyone else who
// deep-links to the URL is bounced back to the project dashboard (not
// /home) so they stay oriented.
//
// Metadata section stays read-only in v2; inline edit lands in a follow-up
// once we have the project PATCH endpoint.

import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import type { ProjectStatus, RACIRole, TeamMember } from '@platform/types'
import { projectsApi } from '../../api'
import { ProjectManagersSection } from './ProjectManagersSection'
import { assignableUsersApi } from '../../api/raci'
import { usePlatformStore } from '../../platform/store'
import { ApiError } from '../../api/client'
import { ProjectStatusPill } from '../../components/ui'
import { ProjectStatusDialog, ProjectStatusHistory, ProjectStatusMenu } from './ProjectStatusControl'
import { holdsRole } from '../../config/roles'

const RACI_LABEL_KEYS: Record<RACIRole, string> = {
  R: 'page.project_settings.raci_label_responsible',
  A: 'page.project_settings.raci_label_accountable',
  C: 'page.project_settings.raci_label_consulted',
  I: 'page.project_settings.raci_label_informed',
}

const RACI_COLOUR: Record<RACIRole, { bg: string; fg: string }> = {
  R: { bg: '#DBEAFE', fg: '#1D4ED8' },
  A: { bg: '#FEF3C7', fg: '#B45309' },
  C: { bg: '#E0E7FF', fg: '#4338CA' },
  I: { bg: '#F1F5F9', fg: '#475569' },
}

const STATUS_LABEL_KEYS: Record<string, string> = {
  initiated: 'page.project_settings.status_initiated',
  ongoing:   'page.project_settings.status_ongoing',
  'on-hold': 'page.project_settings.status_on_hold',
  're-open': 'page.project_settings.status_re_open',
  closed:    'page.project_settings.status_closed',
}

function initialsOf(name: string): string {
  return name.trim().split(/\s+/).filter(w => !/^(dr|mr|mrs|ms|prof)\.?$/i.test(w))
    .slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('') || '?'
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function ProjectSettings() {
  const { t } = useTranslation()
  const { projectId } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const currentUser = usePlatformStore(s => s.currentUser)

  const [addOpen, setAddOpen] = useState(false)
  const [opError, setOpError] = useState<string | null>(null)
  const [statusChange, setStatusChange] = useState<ProjectStatus | null>(null)
  const isPm = holdsRole(currentUser, 'pm')

  const { data: project, isLoading, isError } = useQuery({
    queryKey: ['project', projectId],
    queryFn:  () => projectsApi.get(projectId!),
    enabled:  !!projectId,
  })

  // Author-only access — a non-Author landing here (deep link / stale tab)
  // bounces to the project dashboard, not /home, so they stay oriented.
  const isAuthor = useMemo(
    () => Boolean(project?.team.some(t => t.raci === 'R' && t.userId === currentUser.id)),
    [project, currentUser.id],
  )
  useEffect(() => {
    if (project && !isAuthor && !isPm) navigate(`/projects/${projectId}`, { replace: true })
  }, [project, isAuthor, isPm, projectId, navigate])

  const invalidate = () => qc.invalidateQueries({ queryKey: ['project', projectId] })

  const extractErr = (err: unknown): string => {
    if (err instanceof ApiError) {
      const body = err.body as { message?: string } | null
      return body?.message ?? `HTTP ${err.status}`
    }
    return err instanceof Error ? err.message : t('page.project_settings.err_request_failed')
  }

  const addMut = useMutation({
    mutationFn: (body: Parameters<typeof projectsApi.addTeamMember>[1]) =>
      projectsApi.addTeamMember(projectId!, body),
    onSuccess: () => { setOpError(null); setAddOpen(false); invalidate() },
    onError:   (err) => setOpError(t('page.project_settings.err_add_member', { detail: extractErr(err) })),
  })
  const patchMut = useMutation({
    mutationFn: (args: { userId: string } & Parameters<typeof projectsApi.updateTeamMember>[2]) => {
      const { userId, ...body } = args
      return projectsApi.updateTeamMember(projectId!, userId, body)
    },
    onSuccess: () => { setOpError(null); invalidate() },
    onError:   (err) => setOpError(t('page.project_settings.err_update_member', { detail: extractErr(err) })),
  })
  const removeMut = useMutation({
    mutationFn: (userId: string) => projectsApi.removeTeamMember(projectId!, userId),
    onSuccess:  () => { setOpError(null); invalidate() },
    onError:    (err) => setOpError(t('page.project_settings.err_remove_member', { detail: extractErr(err) })),
  })

  if (isLoading) {
    return <div className="p-8 text-sm text-slate-500">{t('page.project_settings.loading')}</div>
  }
  if (isError || !project) {
    return <div className="p-8 text-sm text-red-700" role="alert">{t('page.project_settings.load_failed')}</div>
  }
  if (!isAuthor && !isPm) return null

  return (
    <div className="flex h-full flex-col overflow-auto bg-slate-50" data-screen="project-settings">
      <div className="flex flex-col gap-4 px-8 py-6" style={{ maxWidth: 1024 }}>
        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-xs text-slate-500" aria-label="Breadcrumb">
          <button onClick={() => navigate('/projects')} className="hover:text-slate-900 transition-colors">
            {t('page.project_settings.crumb_all_projects')}
          </button>
          <span className="text-slate-300">›</span>
          <button onClick={() => navigate(`/projects/${projectId}`)} className="hover:text-slate-900 transition-colors">
            {project.shortTitle}
          </button>
          <span className="text-slate-300">›</span>
          <span className="font-semibold text-slate-900">{t('page.project_settings.crumb_settings')}</span>
        </nav>

        {opError && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700" role="alert">
            {opError}
          </div>
        )}

        {isPm && <ProjectManagersSection projectId={project.id} currentUserId={currentUser.id} />}

        {isPm && (
          <section className="rounded-lg border border-slate-200 bg-white" data-section="project-status">
            <h2 className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-900">
              <span className="flex items-center gap-3">
                {t('component.project_status.section_title')}
                <ProjectStatusPill status={project.status} />
              </span>
              <ProjectStatusMenu projectId={project.id} onPick={setStatusChange} />
            </h2>
            <h3 className="px-4 pt-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{t('component.project_status.history_title')}</h3>
            <ProjectStatusHistory projectId={project.id} />
          </section>
        )}

        {/* Metadata — read-only in v2 */}
        <section className="rounded-lg border border-slate-200 bg-white" data-section="metadata">
          <h2 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-900">
            {t('page.project_settings.metadata_title')}
            <span className="ml-2 text-[11px] font-normal text-slate-500">{t('page.project_settings.metadata_read_only')}</span>
          </h2>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 px-4 py-4 text-[13px]">
            <MetaRow label={t('page.project_settings.field_short_title')}       value={project.shortTitle} />
            <MetaRow label={t('page.project_settings.field_full_name')}         value={project.name} />
            <MetaRow label={t('page.project_settings.field_client')}            value={project.client || '—'} />
            <MetaRow label={t('page.project_settings.field_status')}            value={STATUS_LABEL_KEYS[project.status] ? t(STATUS_LABEL_KEYS[project.status]!) : project.status} />
            <MetaRow label={t('page.project_settings.field_phase')}             value={project.phase} />
            <MetaRow label={t('page.project_settings.field_therapeutic_area')}  value={project.therapeuticArea} />
            <MetaRow label={t('page.project_settings.field_indication')}        value={project.indication ?? '—'} />
            <MetaRow label={t('page.project_settings.field_start_date')}        value={fmtDate(project.startDate)} />
            <MetaRow label={t('page.project_settings.field_data_cutoff')}       value={fmtDate(project.dataCutoff)} />
            <MetaRow label={t('page.project_settings.field_reference_trial')}   value={project.referenceTrial ?? '—'} />
            <MetaRow label={t('page.project_settings.field_modules')}
                     value={project.activeModules.length > 0 ? project.activeModules.join(', ') : '—'} />
            <MetaRow label={t('page.project_settings.field_countries')}
                     value={project.submissionCountries.length > 0 ? project.submissionCountries.join(', ') : '—'} />
          </dl>
        </section>

        {/* Team — editable in v2 */}
        <section className="rounded-lg border border-slate-200 bg-white" data-section="team">
          <h2 className="flex items-baseline justify-between border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-900">
            <span>{t('page.project_settings.team_header', { count: project.team.length })}</span>
            {isAuthor && (
              <button
                type="button"
                onClick={() => { setAddOpen(true); setOpError(null) }}
                className="rounded-md bg-blue-600 px-3 py-1 text-[12px] font-semibold text-white hover:bg-blue-700"
                data-action="add-member"
              >
                {t('page.project_settings.add_team_member')}
              </button>
            )}
          </h2>
          {project.team.length === 0 ? (
            <p className="px-4 py-4 text-[13px] text-slate-500">{t('page.project_settings.team_empty')}</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {project.team.map(member => !isAuthor ? (
                <div key={member.userId} className="flex items-center gap-3 px-4 py-2.5 text-[13px]" data-team-member-readonly={member.userId}>
                  <span className="min-w-0 flex-1 truncate font-semibold text-slate-900">{member.name}</span>
                  <span className="truncate text-[12px] text-slate-500">{member.role}</span>
                  <span className="flex-none rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: RACI_COLOUR[member.raci].bg, color: RACI_COLOUR[member.raci].fg }} title={t(RACI_LABEL_KEYS[member.raci])}>{member.raci}</span>
                </div>
              ) : (
                <TeamRow
                  key={member.userId}
                  member={member}
                  isSelf={member.userId === currentUser.id}
                  busy={patchMut.isPending || removeMut.isPending}
                  onPatch={(patch) => patchMut.mutate({ userId: member.userId, ...patch })}
                  onRemove={() => {
                    if (!window.confirm(t('page.project_settings.confirm_remove', { name: member.name }))) return
                    removeMut.mutate(member.userId)
                  }}
                />
              ))}
            </div>
          )}
        </section>
      </div>

      {statusChange && (
        <ProjectStatusDialog project={project} to={statusChange} onClose={() => setStatusChange(null)} />
      )}

      {addOpen && (
        <AddMemberModal
          projectId={projectId!}
          existingUserIds={new Set(project.team.map(m => m.userId))}
          onCancel={() => setAddOpen(false)}
          onSave={(body) => addMut.mutate(body)}
          submitting={addMut.isPending}
          error={addMut.isError ? extractErr(addMut.error) : null}
        />
      )}
    </div>
  )
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-slate-900">{value}</dd>
    </div>
  )
}

// --- Team row with inline edit ---

function TeamRow({ member, isSelf, busy, onPatch, onRemove }: {
  member: TeamMember
  isSelf: boolean
  busy: boolean
  onPatch: (patch: Partial<{ role: string; raci: RACIRole }>) => void
  onRemove: () => void
}) {
  const { t } = useTranslation()
  const [role, setRole] = useState(member.role)
  const [raci, setRaci] = useState<RACIRole>(member.raci)
  const roleDirty = role !== member.role
  const raciDirty = raci !== member.raci

  const colour = RACI_COLOUR[raci]

  return (
    <div className="flex items-center gap-3 px-4 py-2.5" data-team-member={member.userId}>
      <div
        className="flex h-7 w-7 flex-none items-center justify-center rounded-full font-mono text-[10px] font-bold"
        style={{ backgroundColor: '#F1F5F9', color: '#475569' }}
      >
        {member.initials || initialsOf(member.name)}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-semibold text-slate-900">
          {member.name}
          {isSelf && <span className="ml-1 text-[10px] font-normal text-slate-500">{t('page.project_settings.you_label')}</span>}
        </p>
        <input
          type="text"
          value={role}
          onChange={e => setRole(e.target.value)}
          disabled={busy}
          className="mt-0.5 w-full border-b border-transparent bg-transparent text-[12px] text-slate-500 hover:border-slate-200 focus:border-blue-600 focus:text-slate-900 focus:outline-none"
          data-field="role"
          placeholder={t('page.project_settings.role_placeholder')}
        />
      </div>
      <select
        value={raci}
        onChange={e => setRaci(e.target.value as RACIRole)}
        disabled={busy}
        className="flex-none rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide"
        style={{ backgroundColor: colour.bg, color: colour.fg, borderColor: colour.bg }}
        title={t(RACI_LABEL_KEYS[raci])}
        data-field="raci"
      >
        {(['R', 'A', 'C', 'I'] as const).map(l => (
          <option key={l} value={l}>{l}</option>
        ))}
      </select>
      {(roleDirty || raciDirty) && (
        <button
          type="button"
          onClick={() => onPatch({
            ...(roleDirty && { role }),
            ...(raciDirty && { raci }),
          })}
          disabled={busy}
          className="rounded border border-blue-300 bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700 hover:bg-blue-100 disabled:opacity-50"
          data-action="save-member"
        >
          {t('page.project_settings.save')}
        </button>
      )}
      <button
        type="button"
        onClick={onRemove}
        disabled={busy}
        className="rounded border border-red-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-red-700 hover:bg-red-50 disabled:text-slate-300"
        data-action="remove-member"
      >
        {t('page.project_settings.remove')}
      </button>
    </div>
  )
}

// --- Add-member modal ---

function AddMemberModal({ projectId, existingUserIds, onCancel, onSave, submitting, error }: {
  projectId: string
  existingUserIds: Set<string>
  onCancel: () => void
  onSave: (body: {
    userId: string
    name: string
    role: string
    raci: RACIRole
    initials?: string
  }) => void
  submitting: boolean
  error: string | null
}) {
  const { t } = useTranslation()
  const [userId, setUserId] = useState<string>('')
  const [role, setRole]     = useState<string>('')
  const [raci, setRaci]     = useState<RACIRole>('R')

  // The project's candidates: its members and the tenant's active Clinical Writing users.
  const usersQ = useQuery({
    queryKey: ['assignable-users', projectId, 'all'],
    queryFn:  () => assignableUsersApi.list(projectId),
    staleTime: 60_000,
    retry: false,
  })

  const candidates = useMemo(
    () => (usersQ.data ?? [])
      .filter(u => !existingUserIds.has(u.id))
      .sort((a, b) => a.name.localeCompare(b.name)),
    [usersQ.data, existingUserIds],
  )
  const picked = candidates.find(u => u.id === userId)

  const canSubmit = Boolean(userId && role.trim() && raci && !submitting)

  const submit = () => {
    if (!picked) return
    onSave({
      userId: picked.id,
      name:   picked.name,
      role:   role.trim(),
      raci,
      initials: initialsOf(picked.name),
    })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-member-title"
      onClick={onCancel}
    >
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl" onClick={e => e.stopPropagation()}>
        <h3 id="add-member-title" className="text-base font-semibold text-slate-900">
          {t('page.project_settings.add_modal_title')}
        </h3>
        <p className="mt-1 text-[12px] text-slate-500">
          {t('page.project_settings.add_modal_body')}
        </p>

        <div className="mt-4 flex flex-col gap-3">
          <label className="block">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{t('page.project_settings.user_label')}</span>
            {usersQ.isLoading && <p className="mt-1 text-[12px] text-slate-400">{t('page.project_settings.users_loading')}</p>}
            {usersQ.isError && <p className="mt-1 text-[12px] text-red-700">{t('page.project_settings.users_load_failed')}</p>}
            {usersQ.data && (
              <select
                value={userId}
                onChange={e => setUserId(e.target.value)}
                className="mt-1 h-9 w-full rounded border border-slate-200 bg-white px-2 text-[13px] outline-none focus:border-blue-600"
                data-field="user"
              >
                <option value="">{t('page.project_settings.user_select_placeholder')}</option>
                {candidates.map(u => (
                  <option key={u.id} value={u.id}>{t('page.project_settings.user_option', { name: u.name, email: u.email })}</option>
                ))}
              </select>
            )}
          </label>

          <label className="block">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{t('page.project_settings.role_label')}</span>
            <input
              type="text"
              value={role}
              onChange={e => setRole(e.target.value)}
              placeholder={t('page.project_settings.role_add_placeholder')}
              className="mt-1 h-9 w-full rounded border border-slate-200 bg-white px-2 text-[13px] outline-none focus:border-blue-600"
              data-field="role"
            />
          </label>

          <label className="block">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{t('page.project_settings.raci_label')}</span>
            <select
              value={raci}
              onChange={e => setRaci(e.target.value as RACIRole)}
              className="mt-1 h-9 w-full rounded border border-slate-200 bg-white px-2 text-[13px] outline-none focus:border-blue-600"
              data-field="raci"
            >
              <option value="R">{t('page.project_settings.raci_option_r')}</option>
              <option value="A">{t('page.project_settings.raci_option_a')}</option>
              <option value="C">{t('page.project_settings.raci_option_c')}</option>
              <option value="I">{t('page.project_settings.raci_option_i')}</option>
            </select>
          </label>
        </div>

        {error && (
          <div className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700" role="alert">
            {error}
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="rounded border border-slate-200 bg-white px-3 py-1.5 text-[12px] font-semibold text-slate-700 hover:bg-slate-50"
          >
            {t('page.project_settings.cancel')}
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            className="rounded bg-blue-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-blue-700 disabled:bg-slate-300"
            data-action="confirm-add-member"
          >
            {submitting ? t('page.project_settings.adding') : t('page.project_settings.add_member')}
          </button>
        </div>
      </div>
    </div>
  )
}
