// Admin Panel · Checklist Templates — Phase 4b + 4c.
//
// Catalog of every checklist template the current admin can see (platform
// baselines + per-project overrides) with full edit controls on drafts:
// bump-new-draft, add/edit/delete items, reorder up/down, approve + lock.

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { documentsApi } from '../../api/documents'
import { projectsApi } from '../../api/projects'
import { ApiError } from '../../api/client'

type Template = Awaited<ReturnType<typeof documentsApi.listChecklistTemplates>>[number]
type TemplateDetail = Awaited<ReturnType<typeof documentsApi.getChecklistTemplate>>
type TemplateItem = TemplateDetail['items'][number]
type Stage = TemplateItem['stage']
type Raci = TemplateItem['ownerRaci']
type AutoTrigger = Exclude<TemplateItem['autoCompleteOn'], null | undefined>

// --- Metadata (mirrors ChecklistPanel so the admin + authoring views look consistent)

const STAGE_ORDER = [
  'study_start_up',
  'during_study',
  'reporting',
  'cross_functional_review',
  'crm',
  'final_output',
] as const

const STAGE_LABEL: Record<(typeof STAGE_ORDER)[number], string> = {
  study_start_up:          'Study Start-Up',
  during_study:            'During Study',
  reporting:               'Post-Study',
  cross_functional_review: 'Cross-Functional Review',
  crm:                     'CRM',
  final_output:            'Final Output',
}

const DELIVERABLE_LABEL: Record<string, string> = {
  csr_full:              'CSR (Full)',
  csr_synopsis:          'CSR Synopsis',
  protocol:              'Protocol',
  protocol_amendment:    'Protocol Amendment',
  ib:                    "Investigator's Brochure",
  icf:                   'Informed Consent Form',
  safety_narrative:      'Safety Narrative',
  dsur:                  'DSUR',
  end_of_study_summary:  'End of Study Summary',
  patient_narrative:     'Patient Narrative',
}

const RACI_COLOUR: Record<'R' | 'A' | 'C' | 'I', { bg: string; fg: string }> = {
  R: { bg: '#DBEAFE', fg: '#1D4ED8' },
  A: { bg: '#FEF3C7', fg: '#B45309' },
  C: { bg: '#E0E7FF', fg: '#4338CA' },
  I: { bg: '#F1F5F9', fg: '#475569' },
}

const AUTO_LABEL: Record<string, string> = {
  submit_for_review: 'Auto on submit',
  crm_complete:      'Auto on CRM close',
  document_signed:   'Auto on signature',
}

function deliverableTypeLabel(key: string): string {
  return DELIVERABLE_LABEL[key] ?? key
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function ChecklistTemplatesAdmin() {
  const qc = useQueryClient()
  const [selected, setSelected] = useState<string | null>(null)
  const [approveError, setApproveError] = useState<string | null>(null)
  // When set, the project-override wizard is open for this template id.
  const [cloneForTemplateId, setCloneForTemplateId] = useState<string | null>(null)

  const listQ = useQuery({
    queryKey: ['checklist-templates'],
    queryFn:  () => documentsApi.listChecklistTemplates(),
  })

  const detailQ = useQuery({
    queryKey: ['checklist-template', selected],
    queryFn:  () => documentsApi.getChecklistTemplate(selected!),
    enabled:  !!selected,
  })

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['checklist-templates'] })
    if (selected) void qc.invalidateQueries({ queryKey: ['checklist-template', selected] })
  }

  const extractApiError = (err: unknown): string => {
    if (err instanceof ApiError) {
      const body = err.body as { message?: string } | null
      return body?.message ?? `HTTP ${err.status}`
    }
    return (err instanceof Error ? err.message : 'Request failed')
  }

  const approveMut = useMutation({
    mutationFn: (id: string) => documentsApi.approveChecklistTemplate(id),
    onSuccess:  () => { setApproveError(null); invalidate() },
    onError: (err: unknown) => setApproveError(`Could not approve: ${extractApiError(err)}`),
  })

  const bumpMut = useMutation({
    mutationFn: (id: string) => documentsApi.bumpChecklistTemplateDraft(id),
    onSuccess: (created) => {
      setApproveError(null)
      invalidate()
      setSelected(created.id)
    },
    onError: (err: unknown) => setApproveError(`Could not create draft: ${extractApiError(err)}`),
  })

  const cloneMut = useMutation({
    mutationFn: (args: { templateId: string; projectId: string }) =>
      documentsApi.cloneChecklistTemplateToProject(args.templateId, args.projectId),
    onSuccess: (created) => {
      setApproveError(null)
      setCloneForTemplateId(null)
      invalidate()
      setSelected(created.id)
    },
    onError: (err: unknown) => setApproveError(`Could not clone to project: ${extractApiError(err)}`),
  })

  const addItemMut = useMutation({
    mutationFn: (args: Parameters<typeof documentsApi.addChecklistTemplateItem>[1] & { templateId: string }) =>
      documentsApi.addChecklistTemplateItem(args.templateId, args),
    onSuccess: invalidate,
  })
  const patchItemMut = useMutation({
    mutationFn: (args: { itemId: string } & Parameters<typeof documentsApi.patchChecklistTemplateItem>[1]) => {
      const { itemId, ...rest } = args
      return documentsApi.patchChecklistTemplateItem(itemId, rest)
    },
    onSuccess: invalidate,
  })
  const deleteItemMut = useMutation({
    mutationFn: (itemId: string) => documentsApi.deleteChecklistTemplateItem(itemId),
    onSuccess: invalidate,
  })
  const moveItemMut = useMutation({
    mutationFn: (args: { itemId: string; direction: 'up' | 'down' }) =>
      documentsApi.moveChecklistTemplateItem(args.itemId, args.direction),
    onSuccess: invalidate,
  })

  // Group templates by deliverable type so the catalog reads naturally.
  const grouped = useMemo(() => {
    const bins = new Map<string, Template[]>()
    for (const t of listQ.data ?? []) {
      const list = bins.get(t.deliverableType) ?? []
      list.push(t)
      bins.set(t.deliverableType, list)
    }
    return Array.from(bins.entries())
      .map(([deliverableType, rows]) => ({
        deliverableType,
        label: deliverableTypeLabel(deliverableType),
        rows: rows.sort((a, b) => (a.projectId ?? '') < (b.projectId ?? '') ? -1 : 1),
      }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [listQ.data])

  return (
    <div className="flex h-full flex-col overflow-hidden" data-screen="checklist-templates-admin">
      <div className="flex flex-none items-start justify-between gap-4 border-b border-slate-200 bg-white px-8 py-5">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">Checklist Templates</h1>
          <p className="mt-1 text-sm text-slate-500">
            The compliance floor each new document inherits. Platform baselines ship with the app;
            project overrides, once approved by an Admin, lock in and apply to new documents in
            their project.
          </p>
        </div>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* Left: catalog */}
        <div className="flex w-[420px] flex-none flex-col overflow-hidden border-r border-slate-200 bg-white">
          <div className="flex-1 overflow-y-auto">
            {listQ.isLoading && (
              <p className="px-6 py-6 text-sm text-slate-400">Loading templates…</p>
            )}
            {listQ.isError && (
              <p className="px-6 py-6 text-sm text-red-700" role="alert">
                Failed to load templates.
              </p>
            )}
            {!listQ.isLoading && !listQ.isError && grouped.length === 0 && (
              <p className="px-6 py-6 text-sm text-slate-500">No templates yet.</p>
            )}
            {grouped.map(group => (
              <section key={group.deliverableType} data-group={group.deliverableType}>
                <div className="sticky top-0 bg-slate-50 px-6 py-2 font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                  {group.label}
                </div>
                {group.rows.map(t => {
                  const isSelected = selected === t.id
                  const isPlatformBaseline = t.projectId == null
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => { setSelected(t.id); setApproveError(null) }}
                      className={`flex w-full flex-col gap-1 border-b border-slate-100 px-6 py-3 text-left transition-colors hover:bg-slate-50 ${isSelected ? 'bg-blue-50/60' : ''}`}
                      aria-selected={isSelected}
                      data-template-row={t.id}
                    >
                      <div className="flex items-baseline justify-between gap-3">
                        <p className="text-[13px] font-semibold text-slate-900">
                          v{t.version} {isPlatformBaseline ? '· Platform baseline' : `· Project ${t.projectId}`}
                        </p>
                        <span
                          className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase"
                          style={t.templateStatus === 'locked'
                            ? { backgroundColor: '#DCFCE7', color: '#15803D' }
                            : { backgroundColor: '#FEF3C7', color: '#B45309' }}
                        >
                          {t.templateStatus}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500">
                        {t.itemCount} item{t.itemCount === 1 ? '' : 's'} · {t.instanceCount} doc{t.instanceCount === 1 ? '' : 's'}
                        {t.isCurrent ? ' · current' : ''}
                      </p>
                    </button>
                  )
                })}
              </section>
            ))}
          </div>
        </div>

        {/* Right: detail */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {!selected && (
            <p className="px-8 py-10 text-sm text-slate-500">
              Select a template on the left to view its items.
            </p>
          )}
          {selected && detailQ.isLoading && (
            <p className="px-8 py-10 text-sm text-slate-400">Loading template…</p>
          )}
          {selected && detailQ.isError && (
            <p className="px-8 py-10 text-sm text-red-700" role="alert">
              Failed to load this template.
            </p>
          )}
          {selected && detailQ.data && (
            <TemplateDetailView
              template={detailQ.data}
              onApprove={() => approveMut.mutate(detailQ.data!.id)}
              approving={approveMut.isPending}
              approveError={approveError}
              onBumpDraft={() => bumpMut.mutate(detailQ.data!.id)}
              bumping={bumpMut.isPending}
              onCloneToProject={() => setCloneForTemplateId(detailQ.data!.id)}
              onAddItem={(body) => addItemMut.mutate({ templateId: detailQ.data!.id, ...body })}
              onPatchItem={(itemId, body) => patchItemMut.mutate({ itemId, ...body })}
              onDeleteItem={(itemId) => deleteItemMut.mutate(itemId)}
              onMoveItem={(itemId, direction) => moveItemMut.mutate({ itemId, direction })}
              anyMutating={addItemMut.isPending || patchItemMut.isPending || deleteItemMut.isPending || moveItemMut.isPending}
            />
          )}
        </div>
      </div>

      {cloneForTemplateId && (
        <CloneToProjectModal
          templateId={cloneForTemplateId}
          onCancel={() => setCloneForTemplateId(null)}
          onConfirm={(projectId) => cloneMut.mutate({ templateId: cloneForTemplateId, projectId })}
          submitting={cloneMut.isPending}
          error={cloneMut.isError ? extractApiError(cloneMut.error) : null}
        />
      )}
    </div>
  )
}

// --- Project-override wizard ---

function CloneToProjectModal({ templateId, onCancel, onConfirm, submitting, error }: {
  templateId: string
  onCancel: () => void
  onConfirm: (projectId: string) => void
  submitting: boolean
  error: string | null
}) {
  const [projectId, setProjectId] = useState<string>('')
  const projectsQ = useQuery({
    queryKey: ['projects'],
    queryFn:  () => projectsApi.list(),
  })

  // Hint: templates coming from one project can still be cloned onto another;
  // the backend only blocks when the target already has an override. The
  // modal label stays generic because the user picks the destination.
  void templateId

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="clone-modal-title"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        <h3 id="clone-modal-title" className="text-base font-semibold text-slate-900">
          Create a project-scoped override
        </h3>
        <p className="mt-1 text-[12px] text-slate-500">
          Pick the project to clone this template into. A new <span className="font-semibold">draft</span>
          {' '}copy will be created, scoped to that project. The baseline stays untouched.
        </p>

        <label className="mt-4 block">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Project</span>
          {projectsQ.isLoading && (
            <p className="mt-1 text-[12px] text-slate-400">Loading projects…</p>
          )}
          {projectsQ.isError && (
            <p className="mt-1 text-[12px] text-red-700">Could not load the project list.</p>
          )}
          {projectsQ.data && (
            <select
              value={projectId}
              onChange={e => setProjectId(e.target.value)}
              className="mt-1 h-9 w-full rounded border border-slate-200 bg-white px-2 text-[13px] outline-none focus:border-blue-600"
              data-field="project-id"
            >
              <option value="">— Select a project —</option>
              {projectsQ.data.map(p => (
                <option key={p.id} value={p.id}>
                  {p.shortTitle ?? p.name} ({p.id})
                </option>
              ))}
            </select>
          )}
        </label>

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
            onClick={() => projectId && onConfirm(projectId)}
            disabled={!projectId || submitting}
            className="rounded bg-blue-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-blue-700 disabled:bg-slate-300"
            data-action="confirm-clone"
          >
            {submitting ? 'Creating draft…' : 'Create override draft'}
          </button>
        </div>
      </div>
    </div>
  )
}

interface TemplateDetailViewProps {
  template: TemplateDetail
  onApprove: () => void
  approving: boolean
  approveError: string | null
  onBumpDraft: () => void
  bumping: boolean
  onCloneToProject: () => void
  onAddItem: (body: Parameters<typeof documentsApi.addChecklistTemplateItem>[1]) => void
  onPatchItem: (itemId: string, body: Parameters<typeof documentsApi.patchChecklistTemplateItem>[1]) => void
  onDeleteItem: (itemId: string) => void
  onMoveItem: (itemId: string, direction: 'up' | 'down') => void
  anyMutating: boolean
}

function TemplateDetailView(props: TemplateDetailViewProps) {
  const { template } = props
  const [editingId, setEditingId] = useState<string | null>(null)
  const [addingStage, setAddingStage] = useState<Stage | null>(null)

  // Group items by stage for the detail view, mirroring the per-document
  // ChecklistPanel so the admin preview matches what writers will see.
  const byStage = useMemo(() => {
    const bins = new Map<string, TemplateDetail['items']>()
    for (const it of template.items) {
      const list = bins.get(it.stage) ?? []
      list.push(it)
      bins.set(it.stage, list)
    }
    const ordered: Array<{ stage: Stage; label: string; items: TemplateDetail['items'] }> = []
    for (const s of STAGE_ORDER) {
      if (bins.has(s)) ordered.push({ stage: s, label: STAGE_LABEL[s], items: bins.get(s)! })
    }
    return ordered
  }, [template])

  const isPlatformBaseline = template.projectId == null
  const isDraft    = template.templateStatus === 'draft'
  const canApprove = isDraft
  const canBump    = template.templateStatus === 'locked'

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-none items-start justify-between gap-4 border-b border-slate-200 bg-white px-8 py-5">
        <div>
          <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">
            {deliverableTypeLabel(template.deliverableType)}
          </p>
          <h2 className="mt-1 text-lg font-semibold text-slate-900">
            v{template.version}
            <span className="ml-2 text-sm font-normal text-slate-500">
              {isPlatformBaseline ? 'Platform baseline' : `Project ${template.projectId}`}
            </span>
          </h2>
          <p className="mt-1 text-[12px] text-slate-500">
            {template.items.length} item{template.items.length === 1 ? '' : 's'} ·
            {' '}{template.instanceCount} document{template.instanceCount === 1 ? '' : 's'} tracked ·
            {' '}effective {fmtDate(template.effectiveDate)}
            {template.approvedAt && ` · approved ${fmtDate(template.approvedAt)}`}
          </p>
          <p className="mt-1 text-[11px] italic text-slate-500">{template.changeReason}</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <span
            className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase"
            style={isDraft
              ? { backgroundColor: '#FEF3C7', color: '#B45309' }
              : { backgroundColor: '#DCFCE7', color: '#15803D' }}
          >
            {template.templateStatus}
          </span>
          {canApprove && (
            <button
              type="button"
              onClick={props.onApprove}
              disabled={props.approving}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-blue-700 disabled:bg-slate-300"
              data-action="approve-template"
            >
              {props.approving ? 'Approving…' : 'Approve + Lock'}
            </button>
          )}
          {canBump && (
            <button
              type="button"
              onClick={props.onBumpDraft}
              disabled={props.bumping}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-[12px] font-semibold text-slate-900 hover:bg-slate-50 disabled:text-slate-400"
              data-action="bump-draft"
              title="Clone this locked template into a new draft version you can edit."
            >
              {props.bumping ? 'Creating draft…' : 'Bump new draft'}
            </button>
          )}
          {/* Project override — allowed from any locked template (baseline
              or an existing project override). Hidden on drafts to keep the
              workflow linear: approve the current draft first. */}
          {!isDraft && (
            <button
              type="button"
              onClick={props.onCloneToProject}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-[12px] font-semibold text-slate-900 hover:bg-slate-50"
              data-action="clone-to-project"
              title="Clone this template into a project-scoped draft a PM can customise."
            >
              Create project override
            </button>
          )}
          {props.approveError && (
            <p className="max-w-[260px] rounded border border-red-200 bg-red-50 px-2 py-1 text-right text-[11px] text-red-700" role="alert">
              {props.approveError}
            </p>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto bg-slate-50">
        {byStage.length === 0 && !isDraft && (
          <p className="px-8 py-10 text-sm text-slate-500">
            This template has no items yet.
          </p>
        )}
        {/* On a draft, always render every stage so the admin can add
            items into an empty stage via the "+ Add item" button. */}
        {(isDraft ? STAGE_ORDER : byStage.map(g => g.stage)).map(stageKey => {
          const stage = stageKey as Stage
          const group = byStage.find(g => g.stage === stage)
          const items = group?.items ?? []
          return (
            <section key={stage} className="mt-4 first:mt-0" data-stage-group={stage}>
              <h3 className="px-8 pt-4 pb-2 font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                {STAGE_LABEL[stage]} · {items.length} item{items.length === 1 ? '' : 's'}
              </h3>
              <div className="mx-8 overflow-hidden rounded-lg border border-slate-200 bg-white">
                {items.map((it, i) => (
                  editingId === it.id ? (
                    <EditItemRow
                      key={it.id}
                      item={it}
                      onCancel={() => setEditingId(null)}
                      onSave={(body) => { props.onPatchItem(it.id, body); setEditingId(null) }}
                      disabled={props.anyMutating}
                    />
                  ) : (
                    <ReadItemRow
                      key={it.id}
                      item={it}
                      isLast={i === items.length - 1}
                      canEdit={isDraft}
                      canMoveUp={isDraft && i > 0}
                      canMoveDown={isDraft && i < items.length - 1}
                      onEdit={() => setEditingId(it.id)}
                      onDelete={() => props.onDeleteItem(it.id)}
                      onMove={(dir) => props.onMoveItem(it.id, dir)}
                      busy={props.anyMutating}
                    />
                  )
                ))}
                {isDraft && addingStage !== stage && (
                  <button
                    type="button"
                    onClick={() => setAddingStage(stage)}
                    className="w-full border-t border-slate-100 px-4 py-2 text-left text-[12px] font-semibold text-blue-600 hover:bg-slate-50"
                    data-action="add-item"
                    data-stage={stage}
                  >
                    + Add item
                  </button>
                )}
                {isDraft && addingStage === stage && (
                  <AddItemRow
                    stage={stage}
                    onCancel={() => setAddingStage(null)}
                    onSave={(body) => { props.onAddItem(body); setAddingStage(null) }}
                    disabled={props.anyMutating}
                  />
                )}
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}

// --- Row sub-components ---

function ReadItemRow({ item, isLast, canEdit, canMoveUp, canMoveDown, onEdit, onDelete, onMove, busy }: {
  item: TemplateItem
  isLast: boolean
  canEdit: boolean
  canMoveUp: boolean
  canMoveDown: boolean
  onEdit: () => void
  onDelete: () => void
  onMove: (dir: 'up' | 'down') => void
  busy: boolean
}) {
  return (
    <div
      className={`flex items-start gap-3 px-4 py-3 ${isLast ? '' : 'border-b border-slate-100'}`}
      data-item-id={item.id}
    >
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold text-slate-900">{item.text}</p>
        <p className="mt-0.5 text-[11px] text-slate-500">
          {item.framework}
          {item.frameworkMandatory ? ' · Mandatory' : ' · Recommended'}
        </p>
        <div className="mt-1 flex flex-wrap gap-1.5">
          <span
            className="inline-flex items-center rounded-full px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide"
            style={{ backgroundColor: RACI_COLOUR[item.ownerRaci].bg, color: RACI_COLOUR[item.ownerRaci].fg }}
          >
            {item.ownerRaci}
          </span>
          {item.autoCompleteOn && (
            <span
              className="inline-flex items-center gap-0.5 rounded-full border px-1.5 py-px text-[10px] font-medium"
              style={{ backgroundColor: '#F0F9FF', borderColor: '#BAE6FD', color: '#0369A1' }}
            >
              ⚡ {AUTO_LABEL[item.autoCompleteOn]}
            </span>
          )}
        </div>
      </div>
      {canEdit && (
        <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
          <button type="button" onClick={() => onMove('up')}   disabled={!canMoveUp   || busy} className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] text-slate-700 hover:bg-slate-50 disabled:text-slate-300" title="Move up"   data-action="move-up">↑</button>
          <button type="button" onClick={() => onMove('down')} disabled={!canMoveDown || busy} className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] text-slate-700 hover:bg-slate-50 disabled:text-slate-300" title="Move down" data-action="move-down">↓</button>
          <button type="button" onClick={onEdit} disabled={busy} className="rounded border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:text-slate-300" data-action="edit-item">Edit</button>
          <button
            type="button"
            onClick={onDelete}
            disabled={busy || item.frameworkMandatory}
            className="rounded border border-red-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-red-700 hover:bg-red-50 disabled:border-slate-200 disabled:text-slate-300"
            title={item.frameworkMandatory ? "Mandatory items can't be deleted; waive them on the document instead." : 'Delete item'}
            data-action="delete-item"
          >
            Delete
          </button>
        </div>
      )}
    </div>
  )
}

interface ItemFormValues {
  text: string
  framework: string
  frameworkMandatory: boolean
  ownerRaci: Raci
  stage: Stage
  autoCompleteOn: AutoTrigger | ''
}

function AddItemRow({ stage, onCancel, onSave, disabled }: {
  stage: Stage
  onCancel: () => void
  onSave: (body: Parameters<typeof documentsApi.addChecklistTemplateItem>[1]) => void
  disabled: boolean
}) {
  const [v, setV] = useState<ItemFormValues>({
    text: '',
    framework: 'Custom',
    frameworkMandatory: false,
    ownerRaci: 'R',
    stage,
    autoCompleteOn: '',
  })
  const submit = () => {
    if (!v.text.trim()) return
    onSave({
      text: v.text.trim(),
      framework: v.framework.trim() || 'Custom',
      frameworkMandatory: v.frameworkMandatory,
      ownerRaci: v.ownerRaci,
      stage: v.stage,
      autoCompleteOn: v.autoCompleteOn === '' ? null : v.autoCompleteOn,
    })
  }
  return (
    <div className="border-t border-slate-100 bg-slate-50 px-4 py-3" data-form="add-item">
      <ItemFormFields v={v} setV={setV} />
      <div className="mt-2 flex justify-end gap-2">
        <button type="button" onClick={onCancel} disabled={disabled} className="rounded border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50">Cancel</button>
        <button type="button" onClick={submit} disabled={disabled || !v.text.trim()} className="rounded bg-blue-600 px-3 py-1 text-[11px] font-semibold text-white hover:bg-blue-700 disabled:bg-slate-300">Add</button>
      </div>
    </div>
  )
}

function EditItemRow({ item, onCancel, onSave, disabled }: {
  item: TemplateItem
  onCancel: () => void
  onSave: (body: Parameters<typeof documentsApi.patchChecklistTemplateItem>[1]) => void
  disabled: boolean
}) {
  const [v, setV] = useState<ItemFormValues>({
    text: item.text,
    framework: item.framework,
    frameworkMandatory: item.frameworkMandatory,
    ownerRaci: item.ownerRaci,
    stage: item.stage,
    autoCompleteOn: item.autoCompleteOn ?? '',
  })
  const submit = () => {
    if (!v.text.trim()) return
    onSave({
      text: v.text.trim(),
      framework: v.framework.trim() || 'Custom',
      frameworkMandatory: v.frameworkMandatory,
      ownerRaci: v.ownerRaci,
      stage: v.stage,
      autoCompleteOn: v.autoCompleteOn === '' ? null : v.autoCompleteOn,
    })
  }
  return (
    <div className="border-b border-slate-100 bg-amber-50/40 px-4 py-3" data-form="edit-item" data-item-id={item.id}>
      <ItemFormFields v={v} setV={setV} />
      <div className="mt-2 flex justify-end gap-2">
        <button type="button" onClick={onCancel} disabled={disabled} className="rounded border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50">Cancel</button>
        <button type="button" onClick={submit} disabled={disabled || !v.text.trim()} className="rounded bg-blue-600 px-3 py-1 text-[11px] font-semibold text-white hover:bg-blue-700 disabled:bg-slate-300">Save</button>
      </div>
    </div>
  )
}

function ItemFormFields({ v, setV }: { v: ItemFormValues; setV: (next: ItemFormValues) => void }) {
  const inputCls = 'h-8 rounded border border-slate-200 bg-white px-2 text-[12px] outline-none focus:border-blue-600'
  return (
    <div className="flex flex-col gap-2">
      <input
        type="text"
        value={v.text}
        onChange={e => setV({ ...v, text: e.target.value })}
        placeholder="Item description"
        className={inputCls}
        autoFocus
      />
      <div className="grid grid-cols-5 gap-2">
        <input
          type="text"
          value={v.framework}
          onChange={e => setV({ ...v, framework: e.target.value })}
          placeholder="Framework (e.g. ICH E3)"
          className={inputCls}
        />
        <select value={v.stage} onChange={e => setV({ ...v, stage: e.target.value as Stage })} className={inputCls}>
          {STAGE_ORDER.map(s => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
        </select>
        <select value={v.ownerRaci} onChange={e => setV({ ...v, ownerRaci: e.target.value as Raci })} className={inputCls}>
          <option value="R">R — Responsible</option>
          <option value="A">A — Accountable</option>
          <option value="C">C — Consulted</option>
          <option value="I">I — Informed</option>
        </select>
        <select
          value={v.autoCompleteOn}
          onChange={e => setV({ ...v, autoCompleteOn: e.target.value as AutoTrigger | '' })}
          className={inputCls}
          title="Auto-complete trigger (optional)"
        >
          <option value="">Manual tick</option>
          <option value="submit_for_review">Auto on submit</option>
          <option value="crm_complete">Auto on CRM close</option>
          <option value="document_signed">Auto on signature</option>
        </select>
        <label className="flex items-center gap-1.5 px-1 text-[12px] text-slate-700">
          <input
            type="checkbox"
            checked={v.frameworkMandatory}
            onChange={e => setV({ ...v, frameworkMandatory: e.target.checked })}
          />
          Mandatory
        </label>
      </div>
    </div>
  )
}
