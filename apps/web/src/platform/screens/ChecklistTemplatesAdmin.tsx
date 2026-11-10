// Admin Panel · Checklist Templates — Phase 4b + 4c.
//
// Catalog of every checklist template the current admin can see (platform
// baselines + per-project overrides) with full edit controls on drafts:
// bump-new-draft, add/edit/delete items, reorder up/down, approve + lock.

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
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

const STAGE_LABEL_KEYS: Record<(typeof STAGE_ORDER)[number], string> = {
  study_start_up:          'page.checklist_templates_admin.stage_study_start_up',
  during_study:            'page.checklist_templates_admin.stage_during_study',
  reporting:               'page.checklist_templates_admin.stage_reporting',
  cross_functional_review: 'page.checklist_templates_admin.stage_cross_functional_review',
  crm:                     'page.checklist_templates_admin.stage_crm',
  final_output:            'page.checklist_templates_admin.stage_final_output',
}

const DELIVERABLE_LABEL_KEYS: Record<string, string> = {
  csr_full:              'page.checklist_templates_admin.deliverable_csr_full',
  csr_synopsis:          'page.checklist_templates_admin.deliverable_csr_synopsis',
  protocol:              'page.checklist_templates_admin.deliverable_protocol',
  protocol_amendment:    'page.checklist_templates_admin.deliverable_protocol_amendment',
  ib:                    'page.checklist_templates_admin.deliverable_ib',
  icf:                   'page.checklist_templates_admin.deliverable_icf',
  safety_narrative:      'page.checklist_templates_admin.deliverable_safety_narrative',
  dsur:                  'page.checklist_templates_admin.deliverable_dsur',
  end_of_study_summary:  'page.checklist_templates_admin.deliverable_end_of_study_summary',
  patient_narrative:     'page.checklist_templates_admin.deliverable_patient_narrative',
}

const RACI_COLOUR: Record<'R' | 'A' | 'C' | 'I', { bg: string; fg: string }> = {
  R: { bg: '#DBEAFE', fg: '#1D4ED8' },
  A: { bg: '#FEF3C7', fg: '#B45309' },
  C: { bg: '#E0E7FF', fg: '#4338CA' },
  I: { bg: '#F1F5F9', fg: '#475569' },
}

const AUTO_LABEL_KEYS: Record<string, string> = {
  submit_for_review: 'page.checklist_templates_admin.auto_submit_for_review',
  crm_complete:      'page.checklist_templates_admin.auto_crm_complete',
  document_signed:   'page.checklist_templates_admin.auto_document_signed',
}

const TEMPLATE_STATUS_KEYS: Record<string, string> = {
  draft:  'page.checklist_templates_admin.status_draft',
  locked: 'page.checklist_templates_admin.status_locked',
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function ChecklistTemplatesAdmin() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [selected, setSelected] = useState<string | null>(null)
  const [approveError, setApproveError] = useState<string | null>(null)
  // When set, the project-override wizard is open for this template id.
  const [cloneForTemplateId, setCloneForTemplateId] = useState<string | null>(null)

  const deliverableTypeLabel = (key: string): string => {
    const k = DELIVERABLE_LABEL_KEYS[key]
    return k ? t(k) : key
  }

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
    return (err instanceof Error ? err.message : t('page.checklist_templates_admin.err_request_failed'))
  }

  // After an approval: how many in-flight documents were told a newer version is available (CW-028).
  const [approvedNotice, setApprovedNotice] = useState<string | null>(null)
  const approveMut = useMutation({
    mutationFn: (id: string) => documentsApi.approveChecklistTemplate(id),
    onSuccess:  (res) => {
      setApproveError(null)
      setApprovedNotice(t('page.checklist_templates_admin.approved_notice', { count: res.inFlightDocumentsNotified ?? 0 }))
      invalidate()
    },
    onError: (err: unknown) => setApproveError(t('page.checklist_templates_admin.err_approve', { message: extractApiError(err) })),
  })

  const bumpMut = useMutation({
    mutationFn: (id: string) => documentsApi.bumpChecklistTemplateDraft(id),
    onSuccess: (created) => {
      setApproveError(null)
      invalidate()
      setSelected(created.id)
    },
    onError: (err: unknown) => setApproveError(t('page.checklist_templates_admin.err_create_draft', { message: extractApiError(err) })),
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
    onError: (err: unknown) => setApproveError(t('page.checklist_templates_admin.err_clone', { message: extractApiError(err) })),
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
    for (const tpl of listQ.data ?? []) {
      const list = bins.get(tpl.deliverableType) ?? []
      list.push(tpl)
      bins.set(tpl.deliverableType, list)
    }
    return Array.from(bins.entries())
      .map(([deliverableType, rows]) => ({
        deliverableType,
        label: deliverableTypeLabel(deliverableType),
        rows: rows.sort((a, b) => (a.projectId ?? '') < (b.projectId ?? '') ? -1 : 1),
      }))
      .sort((a, b) => a.label.localeCompare(b.label))
  // deliverableTypeLabel depends on t; include listQ.data as the data source
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listQ.data, t])

  return (
    <div className="flex h-full flex-col overflow-hidden" data-screen="checklist-templates-admin">
      <div className="flex flex-none items-start justify-between gap-4 border-b border-slate-200 bg-white px-8 py-5">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">{t('page.checklist_templates_admin.title')}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {t('page.checklist_templates_admin.subtitle')}
          </p>
        </div>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* Left: catalog */}
        <div className="flex w-[420px] flex-none flex-col overflow-hidden border-r border-slate-200 bg-white">
          <div className="flex-1 overflow-y-auto">
            {listQ.isLoading && (
              <p className="px-6 py-6 text-sm text-slate-400">{t('page.checklist_templates_admin.loading_list')}</p>
            )}
            {listQ.isError && (
              <p className="px-6 py-6 text-sm text-red-700" role="alert">
                {t('page.checklist_templates_admin.load_failed_list')}
              </p>
            )}
            {!listQ.isLoading && !listQ.isError && grouped.length === 0 && (
              <p className="px-6 py-6 text-sm text-slate-500">{t('page.checklist_templates_admin.empty_list')}</p>
            )}
            {grouped.map(group => (
              <section key={group.deliverableType} data-group={group.deliverableType}>
                <div className="sticky top-0 bg-slate-50 px-6 py-2 font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                  {group.label}
                </div>
                {group.rows.map(tpl => {
                  const isSelected = selected === tpl.id
                  const isPlatformBaseline = tpl.projectId == null
                  return (
                    <button
                      key={tpl.id}
                      type="button"
                      onClick={() => { setSelected(tpl.id); setApproveError(null); setApprovedNotice(null) }}
                      className={`flex w-full flex-col gap-1 border-b border-slate-100 px-6 py-3 text-left transition-colors hover:bg-slate-50 ${isSelected ? 'bg-blue-50/60' : ''}`}
                      aria-selected={isSelected}
                      data-template-row={tpl.id}
                    >
                      <div className="flex items-baseline justify-between gap-3">
                        <p className="text-[13px] font-semibold text-slate-900">
                          {isPlatformBaseline
                            ? t('page.checklist_templates_admin.row_version_platform', { version: tpl.version })
                            : t('page.checklist_templates_admin.row_version_project', { version: tpl.version, projectId: tpl.projectId })}
                        </p>
                        <span
                          className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase"
                          style={tpl.templateStatus === 'locked'
                            ? { backgroundColor: '#DCFCE7', color: '#15803D' }
                            : { backgroundColor: '#FEF3C7', color: '#B45309' }}
                        >
                          {TEMPLATE_STATUS_KEYS[tpl.templateStatus] ? t(TEMPLATE_STATUS_KEYS[tpl.templateStatus]) : tpl.templateStatus}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500">
                        {t('page.checklist_templates_admin.row_summary', { items: tpl.itemCount, docs: tpl.instanceCount })}
                        {tpl.isCurrent ? t('page.checklist_templates_admin.row_current_suffix') : ''}
                      </p>
                      {/* Template library (CW-029): who drafted it, and when it took effect and who approved it. */}
                      <p className="text-[11px] text-slate-500" data-template-row-history>
                        {tpl.templateStatus === 'locked' && tpl.approvedAt
                          ? t('page.checklist_templates_admin.row_effective', { date: fmtDate(tpl.effectiveDate), name: tpl.approvedByName ?? tpl.approvedBy ?? '—' })
                          : t('page.checklist_templates_admin.row_drafted_by', { name: tpl.createdByName ?? tpl.createdBy })}
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
              {t('page.checklist_templates_admin.pick_hint')}
            </p>
          )}
          {selected && detailQ.isLoading && (
            <p className="px-8 py-10 text-sm text-slate-400">{t('page.checklist_templates_admin.loading_detail')}</p>
          )}
          {selected && detailQ.isError && (
            <p className="px-8 py-10 text-sm text-red-700" role="alert">
              {t('page.checklist_templates_admin.load_failed_detail')}
            </p>
          )}
          {selected && detailQ.data && (
            <TemplateDetailView
              template={detailQ.data}
              deliverableTypeLabel={deliverableTypeLabel}
              onApprove={() => approveMut.mutate(detailQ.data!.id)}
              approving={approveMut.isPending}
              approveError={approveError}
              approvedNotice={approvedNotice}
              versions={(listQ.data ?? []).filter(r => r.deliverableType === detailQ.data!.deliverableType && r.projectId === detailQ.data!.projectId)}
              onSelectVersion={(id) => { setSelected(id); setApproveError(null); setApprovedNotice(null) }}
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
  const { t } = useTranslation()
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
          {t('page.checklist_templates_admin.clone_title')}
        </h3>
        <p className="mt-1 text-[12px] text-slate-500">
          {t('page.checklist_templates_admin.clone_hint_prefix')} <span className="font-semibold">{t('page.checklist_templates_admin.clone_hint_draft_word')}</span>
          {' '}{t('page.checklist_templates_admin.clone_hint_suffix')}
        </p>

        <label className="mt-4 block">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{t('page.checklist_templates_admin.clone_project_label')}</span>
          {projectsQ.isLoading && (
            <p className="mt-1 text-[12px] text-slate-400">{t('page.checklist_templates_admin.loading_projects')}</p>
          )}
          {projectsQ.isError && (
            <p className="mt-1 text-[12px] text-red-700">{t('page.checklist_templates_admin.err_load_projects')}</p>
          )}
          {projectsQ.data && (
            <select
              value={projectId}
              onChange={e => setProjectId(e.target.value)}
              className="mt-1 h-9 w-full rounded border border-slate-200 bg-white px-2 text-[13px] outline-none focus:border-blue-600"
              data-field="project-id"
            >
              <option value="">{t('page.checklist_templates_admin.clone_select_project')}</option>
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
            {t('button.cancel')}
          </button>
          <button
            type="button"
            onClick={() => projectId && onConfirm(projectId)}
            disabled={!projectId || submitting}
            className="rounded bg-blue-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-blue-700 disabled:bg-slate-300"
            data-action="confirm-clone"
          >
            {submitting ? t('page.checklist_templates_admin.creating_draft') : t('page.checklist_templates_admin.create_override_draft')}
          </button>
        </div>
      </div>
    </div>
  )
}

interface TemplateDetailViewProps {
  template: TemplateDetail
  deliverableTypeLabel: (key: string) => string
  onApprove: () => void
  approving: boolean
  approveError: string | null
  approvedNotice: string | null
  /** Every version of this template (same deliverable type and scope), newest first. */
  versions: Template[]
  onSelectVersion: (id: string) => void
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
  const { t } = useTranslation()
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
      if (bins.has(s)) ordered.push({ stage: s, label: t(STAGE_LABEL_KEYS[s]), items: bins.get(s)! })
    }
    return ordered
  }, [template, t])

  const isPlatformBaseline = template.projectId == null
  const isDraft    = template.templateStatus === 'draft'
  // Approval cycle (CW-029): an author of the draft can't approve it. The API says so (canApprove).
  const showApprove   = isDraft
  const selfAuthored  = isDraft && template.canApprove === false
  const canBump    = template.templateStatus === 'locked'
  const versions = [...props.versions].sort((a, b) => b.version - a.version)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-none items-start justify-between gap-4 border-b border-slate-200 bg-white px-8 py-5">
        <div>
          <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">
            {props.deliverableTypeLabel(template.deliverableType)}
          </p>
          <h2 className="mt-1 text-lg font-semibold text-slate-900">
            {t('page.checklist_templates_admin.detail_version', { version: template.version })}
            <span className="ml-2 text-sm font-normal text-slate-500">
              {isPlatformBaseline
                ? t('page.checklist_templates_admin.scope_platform_baseline')
                : t('page.checklist_templates_admin.scope_project', { projectId: template.projectId })}
            </span>
          </h2>
          <p className="mt-1 text-[12px] text-slate-500">
            {t('page.checklist_templates_admin.detail_summary', { items: template.items.length, docs: template.instanceCount, effective: fmtDate(template.effectiveDate) })}
            {template.approvedAt && t('page.checklist_templates_admin.detail_approved_suffix', { date: fmtDate(template.approvedAt) })}
          </p>
          <p className="mt-1 text-[11px] italic text-slate-500">{template.changeReason}</p>
          <p className="mt-1 text-[11px] text-slate-600" data-template-people>
            {t('page.checklist_templates_admin.detail_drafted_by', { name: template.createdByName ?? template.createdBy })}
            {template.approvedAt && <> · {t('page.checklist_templates_admin.detail_approved_by', { name: template.approvedByName ?? template.approvedBy ?? '—', date: fmtDate(template.approvedAt) })}</>}
            {isDraft && (template.draftAuthors?.length ?? 0) > 1 && <> · {t('page.checklist_templates_admin.detail_draft_authors', { names: template.draftAuthors!.join(', ') })}</>}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <span
            className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase"
            style={isDraft
              ? { backgroundColor: '#FEF3C7', color: '#B45309' }
              : { backgroundColor: '#DCFCE7', color: '#15803D' }}
          >
            {TEMPLATE_STATUS_KEYS[template.templateStatus] ? t(TEMPLATE_STATUS_KEYS[template.templateStatus]) : template.templateStatus}
          </span>
          {showApprove && (
            <button
              type="button"
              onClick={props.onApprove}
              disabled={props.approving || selfAuthored}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-blue-700 disabled:bg-slate-300"
              data-action="approve-template"
              title={selfAuthored ? t('page.checklist_templates_admin.self_approval_note') : undefined}
            >
              {props.approving ? t('page.checklist_templates_admin.approving') : t('page.checklist_templates_admin.approve_and_lock')}
            </button>
          )}
          {selfAuthored && (
            <p className="max-w-[260px] text-right text-[11px] text-slate-500" data-self-approval-note>
              {t('page.checklist_templates_admin.self_approval_note')}
            </p>
          )}
          {props.approvedNotice && !isDraft && (
            <p className="max-w-[260px] rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-right text-[11px] text-emerald-800" role="status" data-approved-notice>
              {props.approvedNotice}
            </p>
          )}
          {canBump && (
            <button
              type="button"
              onClick={props.onBumpDraft}
              disabled={props.bumping}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-[12px] font-semibold text-slate-900 hover:bg-slate-50 disabled:text-slate-400"
              data-action="bump-draft"
              title={t('page.checklist_templates_admin.bump_draft_tooltip')}
            >
              {props.bumping ? t('page.checklist_templates_admin.creating_draft') : t('page.checklist_templates_admin.bump_new_draft')}
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
              title={t('page.checklist_templates_admin.create_project_override_tooltip')}
            >
              {t('page.checklist_templates_admin.create_project_override')}
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
        {/* Template library (CW-029): every version of this template, its status and effective date. */}
        {versions.length > 1 && (
          <section className="mx-8 mt-4 overflow-hidden rounded-lg border border-slate-200 bg-white" data-template-versions>
            <h3 className="border-b border-slate-100 px-4 py-2 font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">
              {t('page.checklist_templates_admin.versions_heading', { count: versions.length })}
            </h3>
            <table className="w-full text-left text-[12px]">
              <thead className="text-[10px] uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-4 py-1.5 font-semibold">{t('page.checklist_templates_admin.versions_col_version')}</th>
                  <th className="px-4 py-1.5 font-semibold">{t('page.checklist_templates_admin.versions_col_status')}</th>
                  <th className="px-4 py-1.5 font-semibold">{t('page.checklist_templates_admin.versions_col_effective')}</th>
                  <th className="px-4 py-1.5 font-semibold">{t('page.checklist_templates_admin.versions_col_people')}</th>
                  <th className="px-4 py-1.5 font-semibold">{t('page.checklist_templates_admin.versions_col_reason')}</th>
                </tr>
              </thead>
              <tbody>
                {versions.map(v => (
                  <tr
                    key={v.id}
                    onClick={() => props.onSelectVersion(v.id)}
                    className={`cursor-pointer border-t border-slate-100 hover:bg-slate-50 ${v.id === template.id ? 'bg-blue-50/60' : ''}`}
                    data-template-version-row={v.version}
                  >
                    <td className="px-4 py-1.5 font-semibold text-slate-900">v{v.version}</td>
                    <td className="px-4 py-1.5">
                      {v.templateStatus === 'draft'
                        ? t('page.checklist_templates_admin.status_draft')
                        : v.isCurrent ? t('page.checklist_templates_admin.version_current') : t('page.checklist_templates_admin.version_superseded')}
                    </td>
                    <td className="px-4 py-1.5 text-slate-600">{v.templateStatus === 'locked' ? fmtDate(v.effectiveDate) : '—'}</td>
                    <td className="px-4 py-1.5 text-slate-600">
                      {v.createdByName ?? v.createdBy}
                      {v.approvedAt && <> → {v.approvedByName ?? v.approvedBy}</>}
                    </td>
                    <td className="px-4 py-1.5 text-slate-500">{v.changeReason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
        {byStage.length === 0 && !isDraft && (
          <p className="px-8 py-10 text-sm text-slate-500">
            {t('page.checklist_templates_admin.empty_template')}
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
                {t('page.checklist_templates_admin.stage_heading', { stage: t(STAGE_LABEL_KEYS[stage]), count: items.length })}
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
                    {t('page.checklist_templates_admin.add_item')}
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
  const { t } = useTranslation()
  return (
    <div
      className={`flex items-start gap-3 px-4 py-3 ${isLast ? '' : 'border-b border-slate-100'}`}
      data-item-id={item.id}
    >
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold text-slate-900">{item.text}</p>
        <p className="mt-0.5 text-[11px] text-slate-500">
          {item.framework}
          {item.frameworkMandatory ? t('page.checklist_templates_admin.mandatory_suffix') : t('page.checklist_templates_admin.recommended_suffix')}
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
              ⚡ {AUTO_LABEL_KEYS[item.autoCompleteOn] ? t(AUTO_LABEL_KEYS[item.autoCompleteOn]) : item.autoCompleteOn}
            </span>
          )}
        </div>
      </div>
      {canEdit && (
        <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
          <button type="button" onClick={() => onMove('up')}   disabled={!canMoveUp   || busy} className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] text-slate-700 hover:bg-slate-50 disabled:text-slate-300" title={t('page.checklist_templates_admin.move_up')}   data-action="move-up">↑</button>
          <button type="button" onClick={() => onMove('down')} disabled={!canMoveDown || busy} className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] text-slate-700 hover:bg-slate-50 disabled:text-slate-300" title={t('page.checklist_templates_admin.move_down')} data-action="move-down">↓</button>
          <button type="button" onClick={onEdit} disabled={busy} className="rounded border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:text-slate-300" data-action="edit-item">{t('page.checklist_templates_admin.edit')}</button>
          <button
            type="button"
            onClick={onDelete}
            disabled={busy || item.frameworkMandatory}
            className="rounded border border-red-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-red-700 hover:bg-red-50 disabled:border-slate-200 disabled:text-slate-300"
            title={item.frameworkMandatory ? t('page.checklist_templates_admin.delete_mandatory_tooltip') : t('page.checklist_templates_admin.delete_item_tooltip')}
            data-action="delete-item"
          >
            {t('page.checklist_templates_admin.delete')}
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
  const { t } = useTranslation()
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
        <button type="button" onClick={onCancel} disabled={disabled} className="rounded border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50">{t('button.cancel')}</button>
        <button type="button" onClick={submit} disabled={disabled || !v.text.trim()} className="rounded bg-blue-600 px-3 py-1 text-[11px] font-semibold text-white hover:bg-blue-700 disabled:bg-slate-300">{t('page.checklist_templates_admin.add')}</button>
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
  const { t } = useTranslation()
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
        <button type="button" onClick={onCancel} disabled={disabled} className="rounded border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50">{t('button.cancel')}</button>
        <button type="button" onClick={submit} disabled={disabled || !v.text.trim()} className="rounded bg-blue-600 px-3 py-1 text-[11px] font-semibold text-white hover:bg-blue-700 disabled:bg-slate-300">{t('page.checklist_templates_admin.save')}</button>
      </div>
    </div>
  )
}

function ItemFormFields({ v, setV }: { v: ItemFormValues; setV: (next: ItemFormValues) => void }) {
  const { t } = useTranslation()
  const inputCls = 'h-8 rounded border border-slate-200 bg-white px-2 text-[12px] outline-none focus:border-blue-600'
  return (
    <div className="flex flex-col gap-2">
      <input
        type="text"
        value={v.text}
        onChange={e => setV({ ...v, text: e.target.value })}
        placeholder={t('page.checklist_templates_admin.item_description_placeholder')}
        className={inputCls}
        autoFocus
      />
      <div className="grid grid-cols-5 gap-2">
        <input
          type="text"
          value={v.framework}
          onChange={e => setV({ ...v, framework: e.target.value })}
          placeholder={t('page.checklist_templates_admin.framework_placeholder')}
          className={inputCls}
        />
        <select value={v.stage} onChange={e => setV({ ...v, stage: e.target.value as Stage })} className={inputCls}>
          {STAGE_ORDER.map(s => <option key={s} value={s}>{t(STAGE_LABEL_KEYS[s])}</option>)}
        </select>
        <select value={v.ownerRaci} onChange={e => setV({ ...v, ownerRaci: e.target.value as Raci })} className={inputCls}>
          <option value="R">{t('page.checklist_templates_admin.raci_r')}</option>
          <option value="A">{t('page.checklist_templates_admin.raci_a')}</option>
          <option value="C">{t('page.checklist_templates_admin.raci_c')}</option>
          <option value="I">{t('page.checklist_templates_admin.raci_i')}</option>
        </select>
        <select
          value={v.autoCompleteOn}
          onChange={e => setV({ ...v, autoCompleteOn: e.target.value as AutoTrigger | '' })}
          className={inputCls}
          title={t('page.checklist_templates_admin.auto_complete_tooltip')}
        >
          <option value="">{t('page.checklist_templates_admin.auto_manual')}</option>
          <option value="submit_for_review">{t('page.checklist_templates_admin.auto_submit_for_review')}</option>
          <option value="crm_complete">{t('page.checklist_templates_admin.auto_crm_complete')}</option>
          <option value="document_signed">{t('page.checklist_templates_admin.auto_document_signed')}</option>
        </select>
        <label className="flex items-center gap-1.5 px-1 text-[12px] text-slate-700">
          <input
            type="checkbox"
            checked={v.frameworkMandatory}
            onChange={e => setV({ ...v, frameworkMandatory: e.target.checked })}
          />
          {t('page.checklist_templates_admin.mandatory_checkbox')}
        </label>
      </div>
    </div>
  )
}
