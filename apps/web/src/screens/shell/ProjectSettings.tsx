// Project Settings — v2 (team RACI editable).
//
// Access gated to Authors — team members with RACI='R' whose userId
// matches the current user. Any Author can add / change / remove team
// members. Admins deliberately don't see this screen (API refuses too).
// A non-Author who deep-links to the URL is bounced back to the project
// dashboard (not /home) so they stay oriented.
//
// Metadata section stays read-only in v2; inline edit lands in a follow-up
// once we have the project PATCH endpoint.

import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { PlatformUser, RACIRole, TeamMember } from '@platform/types'
import { projectsApi } from '../../api'
import { platformApi } from '../../platform/api/platformApi'
import { usePlatformStore } from '../../platform/store'
import { ApiError } from '../../api/client'

const RACI_LABEL: Record<RACIRole, string> = {
  R: 'Responsible',
  A: 'Accountable',
  C: 'Consulted',
  I: 'Informed',
}

const RACI_COLOUR: Record<RACIRole, { bg: string; fg: string }> = {
  R: { bg: '#DBEAFE', fg: '#1D4ED8' },
  A: { bg: '#FEF3C7', fg: '#B45309' },
  C: { bg: '#E0E7FF', fg: '#4338CA' },
  I: { bg: '#F1F5F9', fg: '#475569' },
}

const STATUS_LABEL: Record<string, string> = {
  initiated: 'Initiated',
  ongoing:   'Ongoing',
  'on-hold': 'On hold',
  're-open': 'Re-opened',
  closed:    'Closed',
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
  const { projectId } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const currentUser = usePlatformStore(s => s.currentUser)

  const [addOpen, setAddOpen] = useState(false)
  const [opError, setOpError] = useState<string | null>(null)

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
    if (project && !isAuthor) navigate(`/projects/${projectId}`, { replace: true })
  }, [project, isAuthor, projectId, navigate])

  const invalidate = () => qc.invalidateQueries({ queryKey: ['project', projectId] })

  const extractErr = (err: unknown): string => {
    if (err instanceof ApiError) {
      const body = err.body as { message?: string } | null
      return body?.message ?? `HTTP ${err.status}`
    }
    return err instanceof Error ? err.message : 'Request failed'
  }

  const addMut = useMutation({
    mutationFn: (body: Parameters<typeof projectsApi.addTeamMember>[1]) =>
      projectsApi.addTeamMember(projectId!, body),
    onSuccess: () => { setOpError(null); setAddOpen(false); invalidate() },
    onError:   (err) => setOpError(`Could not add member: ${extractErr(err)}`),
  })
  const patchMut = useMutation({
    mutationFn: (args: { userId: string } & Parameters<typeof projectsApi.updateTeamMember>[2]) => {
      const { userId, ...body } = args
      return projectsApi.updateTeamMember(projectId!, userId, body)
    },
    onSuccess: () => { setOpError(null); invalidate() },
    onError:   (err) => setOpError(`Could not update member: ${extractErr(err)}`),
  })
  const removeMut = useMutation({
    mutationFn: (userId: string) => projectsApi.removeTeamMember(projectId!, userId),
    onSuccess:  () => { setOpError(null); invalidate() },
    onError:    (err) => setOpError(`Could not remove member: ${extractErr(err)}`),
  })

  if (isLoading) {
    return <div className="p-8 text-sm text-slate-500">Loading project settings…</div>
  }
  if (isError || !project) {
    return <div className="p-8 text-sm text-red-700" role="alert">Could not load the project.</div>
  }
  if (!isAuthor) return null

  return (
    <div className="flex h-full flex-col overflow-auto bg-slate-50" data-screen="project-settings">
      <div className="flex flex-col gap-4 px-8 py-6" style={{ maxWidth: 1024 }}>
        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-xs text-slate-500" aria-label="Breadcrumb">
          <button onClick={() => navigate('/projects')} className="hover:text-slate-900 transition-colors">
            All Projects
          </button>
          <span className="text-slate-300">›</span>
          <button onClick={() => navigate(`/projects/${projectId}`)} className="hover:text-slate-900 transition-colors">
            {project.shortTitle}
          </button>
          <span className="text-slate-300">›</span>
          <span className="font-semibold text-slate-900">Settings</span>
        </nav>

        {opError && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700" role="alert">
            {opError}
          </div>
        )}

        {/* Metadata — read-only in v2 */}
        <section className="rounded-lg border border-slate-200 bg-white" data-section="metadata">
          <h2 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-900">
            Project metadata
            <span className="ml-2 text-[11px] font-normal text-slate-500">read-only — edit lands in v3</span>
          </h2>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 px-4 py-4 text-[13px]">
            <MetaRow label="Short title"           value={project.shortTitle} />
            <MetaRow label="Full name"             value={project.name} />
            <MetaRow label="Client"                value={project.client || '—'} />
            <MetaRow label="Status"                value={STATUS_LABEL[project.status] ?? project.status} />
            <MetaRow label="Phase"                 value={project.phase} />
            <MetaRow label="Therapeutic area"      value={project.therapeuticArea} />
            <MetaRow label="Indication"            value={project.indication ?? '—'} />
            <MetaRow label="Start date"            value={fmtDate(project.startDate)} />
            <MetaRow label="Data cutoff"           value={fmtDate(project.dataCutoff)} />
            <MetaRow label="Reference trial"       value={project.referenceTrial ?? '—'} />
            <MetaRow label="Modules enabled"
                     value={project.activeModules.length > 0 ? project.activeModules.join(', ') : '—'} />
            <MetaRow label="Submission countries"
                     value={project.submissionCountries.length > 0 ? project.submissionCountries.join(', ') : '—'} />
          </dl>
        </section>

        {/* Team — editable in v2 */}
        <section className="rounded-lg border border-slate-200 bg-white" data-section="team">
          <h2 className="flex items-baseline justify-between border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-900">
            <span>Team · {project.team.length} member{project.team.length === 1 ? '' : 's'}</span>
            <button
              type="button"
              onClick={() => { setAddOpen(true); setOpError(null) }}
              className="rounded-md bg-blue-600 px-3 py-1 text-[12px] font-semibold text-white hover:bg-blue-700"
              data-action="add-member"
            >
              + Add team member
            </button>
          </h2>
          {project.team.length === 0 ? (
            <p className="px-4 py-4 text-[13px] text-slate-500">No team members yet.</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {project.team.map(member => (
                <TeamRow
                  key={member.userId}
                  member={member}
                  isSelf={member.userId === currentUser.id}
                  busy={patchMut.isPending || removeMut.isPending}
                  onPatch={(patch) => patchMut.mutate({ userId: member.userId, ...patch })}
                  onRemove={() => {
                    if (!window.confirm(`Remove ${member.name} from the team?`)) return
                    removeMut.mutate(member.userId)
                  }}
                />
              ))}
            </div>
          )}
        </section>
      </div>

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
          {isSelf && <span className="ml-1 text-[10px] font-normal text-slate-500">(you)</span>}
        </p>
        <input
          type="text"
          value={role}
          onChange={e => setRole(e.target.value)}
          disabled={busy}
          className="mt-0.5 w-full border-b border-transparent bg-transparent text-[12px] text-slate-500 hover:border-slate-200 focus:border-blue-600 focus:text-slate-900 focus:outline-none"
          data-field="role"
          placeholder="Role on project"
        />
      </div>
      <select
        value={raci}
        onChange={e => setRaci(e.target.value as RACIRole)}
        disabled={busy}
        className="flex-none rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide"
        style={{ backgroundColor: colour.bg, color: colour.fg, borderColor: colour.bg }}
        title={RACI_LABEL[raci]}
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
          Save
        </button>
      )}
      <button
        type="button"
        onClick={onRemove}
        disabled={busy}
        className="rounded border border-red-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-red-700 hover:bg-red-50 disabled:text-slate-300"
        data-action="remove-member"
      >
        Remove
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
  void projectId
  const [userId, setUserId] = useState<string>('')
  const [role, setRole]     = useState<string>('')
  const [raci, setRaci]     = useState<RACIRole>('R')

  // Reuses the admin user directory. Non-admin callers will 403 against
  // the API if their role doesn't have read access — in which case we'd
  // show a prompt to enter userId manually; for the common case (Authors
  // in tenants where the directory is readable) this is clean.
  const usersQ = useQuery<PlatformUser[]>({
    queryKey: ['platform-users'],
    queryFn:  () => platformApi.listUsers(),
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
          Add team member
        </h3>
        <p className="mt-1 text-[12px] text-slate-500">
          Pick a user, their role on this project, and a RACI letter. The user must already exist in the tenant directory.
        </p>

        <div className="mt-4 flex flex-col gap-3">
          <label className="block">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">User</span>
            {usersQ.isLoading && <p className="mt-1 text-[12px] text-slate-400">Loading users…</p>}
            {usersQ.isError && <p className="mt-1 text-[12px] text-red-700">Could not load the user directory.</p>}
            {usersQ.data && (
              <select
                value={userId}
                onChange={e => setUserId(e.target.value)}
                className="mt-1 h-9 w-full rounded border border-slate-200 bg-white px-2 text-[13px] outline-none focus:border-blue-600"
                data-field="user"
              >
                <option value="">— Select a user —</option>
                {candidates.map(u => (
                  <option key={u.id} value={u.id}>{u.name} ({u.email})</option>
                ))}
              </select>
            )}
          </label>

          <label className="block">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Role on project</span>
            <input
              type="text"
              value={role}
              onChange={e => setRole(e.target.value)}
              placeholder="e.g. Lead Clinical Writer / Medical Reviewer"
              className="mt-1 h-9 w-full rounded border border-slate-200 bg-white px-2 text-[13px] outline-none focus:border-blue-600"
              data-field="role"
            />
          </label>

          <label className="block">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">RACI letter</span>
            <select
              value={raci}
              onChange={e => setRaci(e.target.value as RACIRole)}
              className="mt-1 h-9 w-full rounded border border-slate-200 bg-white px-2 text-[13px] outline-none focus:border-blue-600"
              data-field="raci"
            >
              <option value="R">R — Responsible (Author)</option>
              <option value="A">A — Accountable</option>
              <option value="C">C — Consulted</option>
              <option value="I">I — Informed</option>
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
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            className="rounded bg-blue-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-blue-700 disabled:bg-slate-300"
            data-action="confirm-add-member"
          >
            {submitting ? 'Adding…' : 'Add member'}
          </button>
        </div>
      </div>
    </div>
  )
}
