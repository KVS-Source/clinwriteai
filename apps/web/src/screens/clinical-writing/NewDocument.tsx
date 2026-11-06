// New Document wizard — rendered inside a right-edge SlidePanel from
// ClinicalWritingHome. API ready at POST /projects/:id/documents
// (apps/api/src/modules/clinical-writing/documents/routes.ts).
//
// Three-step flow:
//   1. Document type        — dropdown; drives the section template + the
//                             source-category filter in step 2
//   2. Source documents     — mandatory ≥ 1; filtered by category to the
//                             set relevant to the chosen type; "+ Upload"
//                             button hands off to the parent-managed
//                             upload drawer which stacks over the wizard
//   3. Details              — title, assignee, target date, description.
//                             "Create document" at the end.
//
// M2 (this file): the type dropdown + its source-category filter now
// come from GET /document-templates (DocumentTemplate DB rows seeded
// per migration 53). The hardcoded DOC_TYPES_FALLBACK + the hardcoded
// SOURCE_CATEGORIES_BY_DOC_TYPE map are retained ONLY as a graceful
// degradation when the API call is in flight or fails, so the wizard
// still renders without a stall.
//
// M3+ will add a 4th step for AI drafting opt-in.

import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Trans, useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import type { BestPractice, CreateDocumentBody, DocumentType } from '@platform/types'
import { documentsApi, type DocumentTemplate } from '../../api'
import { ApiError } from '../../api/client'
import { assignableUsersApi } from '../../api/raci'
import { AssigneeCombobox, type AssigneeOption } from '../../components/raci/AssigneeCombobox'
import { platformApi } from '../../platform/api/platformApi'
import { sourceCategoryLabel } from '../../utils/sourceCategories'
import { sourceCategoriesForDocType } from '../../utils/documentTypeSourceCategories'

// Fallback used only when /document-templates hasn't responded yet or
// errors out. Keep in sync with apps/api/prisma/seeds/document-templates.ts
// so dev-with-mocks + offline builds still show the right 10 types.
const DOC_TYPES_FALLBACK: { value: DocumentType; label: string; description: string }[] = [
  { value: 'csr-full',             label: 'CSR (Full)',             description: 'Full Clinical Study Report — ICH E3 structure.' },
  { value: 'csr-synopsis',         label: 'CSR Synopsis',           description: 'Study report synopsis for regulatory submission.' },
  { value: 'protocol',             label: 'Protocol',               description: 'Study protocol — ICH E6(R3) GCP compliance.' },
  { value: 'protocol-amendment',   label: 'Protocol Amendment',     description: 'Amendment to an in-progress protocol.' },
  { value: 'ib',                   label: 'Investigator Brochure',  description: 'Investigator Brochure (IB).' },
  { value: 'icf',                  label: 'Informed Consent Form',  description: 'ICF — 21 CFR Part 50 + IRB review.' },
  { value: 'safety-narrative',     label: 'Safety Narrative',       description: 'Individual safety narrative.' },
  { value: 'dsur',                 label: 'DSUR',                   description: 'Development Safety Update Report — ICH E2F.' },
  { value: 'end-of-study-summary', label: 'End-of-Study Summary',   description: 'EU CTR Article 37 summary.' },
  { value: 'patient-narrative',    label: 'Patient Narrative',      description: 'Patient-level clinical narrative.' },
]

interface Props {
  projectId: string
  // Optional id of an existing document to prefill the form from
  // (duplicate flow). Only type + title + assignee are copied.
  duplicateSourceId?: string | null
  // Source documents (uploads) to preselect — "Create document from this source".
  initialSourceIds?: string[]
  // The project's therapeutic area — every document inherits it (FR-A-002)
  projectTherapeuticArea?: string | null
  // The project's short title — used in the Title field's example text
  projectShortTitle?: string | null
  // Parent-handled upload trigger — parent opens the source-document
  // upload drawer stacked over the wizard. The wizard stays mounted so
  // the user returns to step 2 with their picks + the new source visible.
  onRequestUpload?: () => void
  // Id of the source just saved from that upload drawer — selected automatically.
  uploadedSourceId?: string | null
  onCreated?: (documentId: string) => void
  onCancel?:  () => void
}

type Step = 1 | 2 | 3 | 4
/** Step → i18n key under page.new_document.step_label_*. The actual
 *  translated label is resolved via `t()` at render time. */
const STEP_LABEL_KEYS: Record<Step, string> = {
  1: 'page.new_document.step_label_1',
  2: 'page.new_document.step_label_2',
  3: 'page.new_document.step_label_3',
  4: 'page.new_document.step_label_4',
}

export function NewDocumentForm({
  projectId,
  duplicateSourceId,
  initialSourceIds,
  projectTherapeuticArea,
  projectShortTitle,
  onRequestUpload,
  uploadedSourceId,
  onCreated,
  onCancel,
}: Props) {
  const { t } = useTranslation()
  const qc = useQueryClient()

  const [step,                 setStep]                 = useState<Step>(1)
  const [type,                 setType]                 = useState<DocumentType>('csr-full')
  const [title,                setTitle]                = useState('')
  const [assigneeId,           setAssigneeId]           = useState('')
  const [targetCompletionDate, setTargetCompletionDate] = useState('')
  const [description,          setDescription]          = useState('')
  const [sourceIds,            setSourceIds]            = useState<string[]>(initialSourceIds ?? [])
  const [showAllCategories,    setShowAllCategories]    = useState(false)
  // Sources uploaded from this wizard (via "+ Upload source").
  const [uploadedHere,         setUploadedHere]         = useState<string[]>([])
  // Step 4 — every new document is drafted by AI from its sources (CW-056: there is
  // no "Create blank"; step 2 already requires at least one source).
  // Author's free-text prompt to the AI drafter. Max 2000 chars enforced
  // at the API edge; UI shows a live char counter + warns at 1900.
  const [aiInstructions,       setAiInstructions]       = useState<string>('')

  // Document templates — DB-backed section skeleton + source-category
  // rules per type. Drives both the step-1 dropdown and the step-2
  // category filter so adding a new deliverable type is a seed-row
  // change, not a code change.
  const { data: dbTemplates = [] } = useQuery<DocumentTemplate[]>({
    queryKey: ['document-templates'],
    queryFn:  () => documentsApi.listTemplates(),
    staleTime: 5 * 60_000,
    retry: false,
  })

  // Dropdown options: prefer DB-fetched templates; fall back to the
  // hardcoded list while the fetch is in flight or if it 403/errors.
  const docTypeOptions = useMemo(() => {
    if (dbTemplates.length > 0) {
      return dbTemplates.map(t => ({ value: t.type as DocumentType, label: t.label, description: t.description }))
    }
    return DOC_TYPES_FALLBACK
  }, [dbTemplates])

  // Saved source documents in this project's library (evidence the document is written from).
  const { data: sourcePage } = useQuery({
    queryKey: ['source-documents', projectId, 'picker'],
    queryFn:  () => documentsApi.listSources(projectId, { state: 'saved', sort: 'title', dir: 'asc', pageSize: 100 }),
  })
  const sources = sourcePage?.items ?? []

  const toggleSource = (id: string) =>
    setSourceIds(cur => (cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id]))

  // Categories recommended for the chosen document type. Pull from the
  // DocumentTemplate row first; fall back to the hardcoded map when the
  // API hasn't loaded yet. null means we don't know the type's needs —
  // show every source as a safe default.
  const recommendedCategories = useMemo<readonly string[] | null>(() => {
    const dbRow = dbTemplates.find(t => t.type === type)
    if (dbRow) return dbRow.requiredSourceCategories.length > 0 ? dbRow.requiredSourceCategories : null
    return sourceCategoriesForDocType(type)
  }, [dbTemplates, type])
  const recommendedSet = useMemo(() => new Set(recommendedCategories ?? []), [recommendedCategories])

  // A source uploaded from this wizard is picked for the document straight away.
  useEffect(() => {
    if (!uploadedSourceId) return
    setSourceIds(cur => (cur.includes(uploadedSourceId) ? cur : [...cur, uploadedSourceId]))
    setUploadedHere(cur => (cur.includes(uploadedSourceId) ? cur : [...cur, uploadedSourceId]))
    setShowAllCategories(false)
  }, [uploadedSourceId])

  // After an upload from this wizard the list shows the source(s) uploaded here
  // plus everything selected; otherwise the recommended categories plus
  // everything selected. "Show all categories" lists every source.
  const filteredSources = useMemo(() => {
    if (showAllCategories) return sources
    if (uploadedHere.length > 0) return sources.filter(s => uploadedHere.includes(s.id) || sourceIds.includes(s.id))
    if (!recommendedCategories) return sources
    return sources.filter(s => recommendedSet.has(s.category) || sourceIds.includes(s.id))
  }, [sources, showAllCategories, uploadedHere, recommendedCategories, recommendedSet, sourceIds])

  // Sources selected outside the recommended set stay selected and listed —
  // flag the count so the user can act.
  const outOfScopeSelectedCount = useMemo(() => {
    if (!recommendedCategories) return 0
    return sourceIds.filter(id => {
      const src = sources.find(s => s.id === id)
      return src && !recommendedSet.has(src.category)
    }).length
  }, [sourceIds, sources, recommendedCategories, recommendedSet])

  // Assignees come from the project's candidates, which any signed-in user can read.
  const { data: members = [] } = useQuery({
    queryKey: ['assignable-users', projectId],
    queryFn:  () => assignableUsersApi.listForAssignee(projectId),
    retry: false,
  })

  // Best Practices Library — surface the items whose applicableDocTypes
  // includes the chosen type (and that are Module A / Clinical Writing
  // or platform-wide). The writer sees them during setup so framework
  // expectations aren't a surprise during authoring.
  const { data: allBestPractices = [] } = useQuery<BestPractice[]>({
    queryKey: ['best-practices'],
    queryFn:  () => platformApi.listBestPractices(),
    staleTime: 5 * 60_000,
    retry: false,
  })
  const relevantBestPractices = useMemo(() => {
    // Guidance that has run out (validUntil before today) or hasn't started yet
    // (effectiveFrom after today) must not steer a new document. Items that are only
    // close to expiry stay, flagged "review due". The Best Practices screen still
    // lists everything so an admin can renew it. Dates are UTC calendar days, as the API sends them.
    const today = new Date().toISOString().slice(0, 10)
    return allBestPractices.filter(bp => {
      if (bp.validUntil && bp.validUntil < today) return false
      if (bp.effectiveFrom && bp.effectiveFrom > today) return false
      // Module match: Module A (Clinical Writing) items + platform-wide.
      // (The screen is clinical-writing-only; other modules' items filter out.)
      const moduleOk = bp.module === 'A' || (bp.module as string) === 'platform'
      if (!moduleOk) return false
      // If applicableDocTypes is empty, treat it as "applies to all" for
      // the module — operators who leave it blank clearly meant everything.
      if (!bp.applicableDocTypes || bp.applicableDocTypes.length === 0) return true
      return bp.applicableDocTypes.includes(type)
    })
  }, [allBestPractices, type])

  const { data: sourceDoc } = useQuery({
    queryKey: ['document', duplicateSourceId],
    queryFn:  () => documentsApi.get(duplicateSourceId!),
    enabled:  !!duplicateSourceId,
  })
  useEffect(() => {
    if (!sourceDoc) return
    setType(sourceDoc.type as DocumentType)
    setTitle(`${sourceDoc.title} (copy)`)
    setAssigneeId(sourceDoc.assigneeId)
  }, [sourceDoc])

  // Migration 48 moved writers to role 'contributor' + the 'can-author' capability and admins to
  // 'tenant-admin'; the legacy role names are still accepted for rows not yet rewritten. An API whose
  // Prisma client predates the capabilities column returns no `capabilities`, so a contributor
  // without the field still counts as a writer.
  const assigneeOptions = useMemo((): AssigneeOption[] => {
    // Project members who can author (a member without recorded capabilities counts as a writer, as below).
    const fromMembers = members
      .filter(m => m.capabilities.length === 0 || m.capabilities.includes('can-author'))
      .map(m => ({ id: m.id, name: m.name, email: m.email, role: m.projectRole }))
    return fromMembers
  }, [members])

  const create = useMutation({
    mutationFn: () => {
      const body: CreateDocumentBody = {
        type,
        title,
        assigneeId,
        targetCompletionDate: targetCompletionDate ? new Date(targetCompletionDate).toISOString() : undefined,
        description: description || undefined,
        sourceUploadIds: sourceIds.length ? sourceIds : undefined,
        // AI drafting is the only path; step 2 guarantees at least one source.
        aiDraft: true,
        // Author's prompt to the AI drafter. Empty string → undefined so the
        // API treats it as "no directive" rather than "clear directive".
        aiInstructions: aiInstructions.trim().length > 0 ? aiInstructions.trim() : undefined,
      }
      return documentsApi.create(projectId, body)
    },
    onSuccess: (doc) => {
      qc.invalidateQueries({ queryKey: ['documents', projectId] })
      if (sourceIds.length) qc.invalidateQueries({ queryKey: ['source-documents', projectId] })
      onCreated?.((doc as { id: string }).id)
    },
  })

  // Per-step validation. Step 1 is always valid (type has a default).
  // Step 2 requires at least one source selected. Step 3 requires title +
  // assignee. The final Create button is only reachable when all three pass.
  const canAdvanceFromStep1 = true
  const canAdvanceFromStep2 = sourceIds.length > 0
  // Must be someone on the list: a duplicated document can carry over an assignee who no longer qualifies.
  const canAdvanceFromStep3 = title.trim().length > 0 && assigneeOptions.some(o => o.id === assigneeId)
  const canSubmit           = canAdvanceFromStep3 && canAdvanceFromStep2 && !create.isPending

  const next = () => {
    if (step === 1 && canAdvanceFromStep1) setStep(2)
    else if (step === 2 && canAdvanceFromStep2) setStep(3)
    else if (step === 3 && canAdvanceFromStep3) setStep(4)
  }
  const back = () => {
    if (step === 4) setStep(3)
    else if (step === 3) setStep(2)
    else if (step === 2) setStep(1)
  }

  const selectedTypeMeta = useMemo(() => docTypeOptions.find(t => t.value === type), [docTypeOptions, type])

  const errorMsg = create.isError
    ? create.error instanceof ApiError
      ? create.error.status === 503
        ? 'Clinical Writing is not enabled on this deployment.'
        : create.error.status === 403
          ? 'You do not have write access to this project.'
          : create.error.status === 422
            ? 'A selected source document is no longer usable. Deselect it and try again.'
            : `Could not create document (HTTP ${create.error.status}).`
      : 'Could not create document — see console for details.'
    : null

  return (
    <form
      onSubmit={e => {
        e.preventDefault()
        if (!canSubmit || step !== 4) return
        create.mutate()
      }}
      className="flex h-full flex-col"
      data-form="new-document"
      data-step={step}
    >
      {/* Progress indicator */}
      <div className="flex-none border-b border-slate-200 bg-white px-5 py-3">
        <div className="flex items-center gap-2">
          {[1, 2, 3, 4].map(n => {
            const s = n as Step
            const isActive = step === s
            const isDone   = step > s
            return (
              <div key={n} className="flex flex-1 items-center gap-2">
                <span
                  className={`flex h-6 w-6 flex-none items-center justify-center rounded-full text-[11px] font-semibold ${
                    isDone  ? 'bg-blue-600 text-white'
                    : isActive ? 'bg-blue-100 text-blue-700 ring-2 ring-blue-500'
                    : 'bg-slate-200 text-slate-500'
                  }`}
                >{isDone ? '✓' : n}</span>
                <span className={`truncate text-[12px] ${isActive ? 'font-semibold text-slate-900' : 'text-slate-500'}`}>
                  {t(STEP_LABEL_KEYS[s])}
                </span>
                {n < 4 && <span className={`h-px flex-1 ${step > s ? 'bg-blue-600' : 'bg-slate-200'}`} />}
              </div>
            )
          })}
        </div>
      </div>

      {/* Step body */}
      <div className="flex-1 overflow-y-auto p-5">
        {step === 1 && (
          <section className="flex flex-col gap-4" data-step-body="type">
            <div>
              <h3 className="text-[14px] font-semibold text-slate-900">{t('page.new_document.step1_title')}</h3>
              <p className="mt-0.5 text-[12px] text-slate-500">
                {t('page.new_document.step1_hint')}
              </p>
            </div>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{t('page.new_document.document_type_label')}</span>
              <select
                value={type}
                onChange={e => setType(e.currentTarget.value as DocumentType)}
                className="h-10 rounded-md border border-slate-300 px-3 text-[13px]"
                data-field="type"
              >
                {docTypeOptions.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </label>
            {selectedTypeMeta && (
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                <p className="text-[12px] text-slate-700">{selectedTypeMeta.description}</p>
                {recommendedCategories && (
                  <p className="mt-2 text-[11px] text-slate-500">
                    <span className="font-semibold">{t('page.new_document.typical_sources_label')}</span>{' '}
                    {recommendedCategories.map(c => sourceCategoryLabel(c)).join(' · ')}
                  </p>
                )}
              </div>
            )}

            {/* Best Practices Library — items whose applicableDocTypes
                matches the selected type. Shows the writer the framework
                expectations before they even hit step 2. Collapsible so
                writers who already know can skip past. */}
            <BestPracticesCard
              items={relevantBestPractices}
              docTypeLabel={selectedTypeMeta?.label ?? type}
            />
          </section>
        )}

        {step === 2 && (
          <section className="flex flex-col gap-4" data-step-body="sources">
            <div>
              <h3 className="text-[14px] font-semibold text-slate-900">{t('page.new_document.step2_title')}</h3>
              <p className="mt-0.5 text-[12px] text-slate-500">
                {t('page.new_document.step2_hint')}
                {uploadedHere.length > 0 && !showAllCategories && (
                  <> {t('page.new_document.step2_showing_uploaded_prefix')} <span className="font-semibold">{t('page.new_document.show_all_categories')}</span> {t('page.new_document.step2_showing_uploaded_suffix')}</>
                )}
                {recommendedCategories && !showAllCategories && uploadedHere.length === 0 && (
                  <> {t('page.new_document.step2_filtered_prefix')} <span className="font-semibold">{recommendedCategories.map(c => sourceCategoryLabel(c)).join(' · ')}</span> {t('page.new_document.step2_filtered_suffix', { type: selectedTypeMeta?.label ?? '' })}</>
                )}
              </p>
            </div>

            <div className="flex items-center justify-between gap-2">
              <div className="flex gap-2">
                {onRequestUpload && (
                  <button
                    type="button"
                    onClick={onRequestUpload}
                    className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-[12px] font-semibold text-slate-700 hover:bg-slate-50"
                    data-action="open-upload"
                  >
                    + {t('page.new_document.upload_source')}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setShowAllCategories(true)}
                  className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-[12px] font-semibold text-slate-700 hover:bg-slate-50"
                  title={t('page.new_document.upload_existing_title')}
                  data-action="pick-existing-source"
                >
                  {t('page.new_document.upload_from_existing')}
                </button>
              </div>
              {recommendedCategories && (
                <label className="flex items-center gap-2 text-[11px] text-slate-600">
                  <input
                    type="checkbox"
                    checked={showAllCategories}
                    onChange={e => setShowAllCategories(e.currentTarget.checked)}
                  />
                  {t('page.new_document.show_all_categories')}
                </label>
              )}
            </div>

            {filteredSources.length === 0 ? (
              <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-5 text-center">
                <p className="text-[12px] text-slate-600">
                  {sources.length === 0
                    ? t('page.new_document.no_sources_library')
                    : t('page.new_document.no_sources_match_category')}
                </p>
              </div>
            ) : (
              <div className="flex max-h-[55vh] flex-col gap-1.5 overflow-y-auto">
                {filteredSources.map(src => (
                  <label key={src.id}
                    className={`flex cursor-pointer items-start gap-2 rounded-md border p-2.5 ${
                      sourceIds.includes(src.id) ? 'border-blue-500 bg-blue-50' : 'border-slate-200 bg-white hover:border-slate-300'
                    }`}>
                    <input type="checkbox" className="mt-0.5" checked={sourceIds.includes(src.id)} onChange={() => toggleSource(src.id)} data-source-id={src.id} />
                    <span className="min-w-0">
                      <span className="block truncate text-[12px] font-semibold text-slate-900">{src.title}</span>
                      <span className="block truncate text-[11px] text-slate-500">
                        {sourceCategoryLabel(src.category)} · {src.fileName}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            )}

            <div className="flex items-center justify-between text-[11px]">
              <span className={sourceIds.length === 0 ? 'text-rose-600' : 'text-slate-600'}>
                {sourceIds.length === 0
                  ? t('page.new_document.select_one_source_hint')
                  : t('page.new_document.selected_count', { count: sourceIds.length })}
              </span>
              {outOfScopeSelectedCount > 0 && (
                <span className="text-amber-600">
                  {t('page.new_document.out_of_scope_count', { count: outOfScopeSelectedCount })}
                </span>
              )}
            </div>
          </section>
        )}

        {step === 3 && (
          <section className="flex flex-col gap-4" data-step-body="details">
            <div>
              <h3 className="text-[14px] font-semibold text-slate-900">{t('page.new_document.step3_title')}</h3>
              <p className="mt-0.5 text-[12px] text-slate-500">
                {t('page.new_document.step3_summary', { type: selectedTypeMeta?.label ?? '', count: sourceIds.length })}
                {relevantBestPractices.length > 0 && (
                  <> {t('page.new_document.step3_best_practices', { count: relevantBestPractices.length })}{relevantBestPractices.some(bp => bp.reviewDue) ? t('page.new_document.step3_review_due_suffix') : ''}.</>
                )}
              </p>
            </div>

            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{t('page.new_document.title_label')}</span>
              <input value={title} onChange={e => setTitle(e.currentTarget.value)} required
                placeholder={projectShortTitle ? t('page.new_document.title_placeholder_with_project', { project: projectShortTitle }) : t('page.new_document.title_placeholder_fallback')}
                className="h-9 rounded-md border border-slate-300 px-3 text-[13px]" />
            </label>

            {/* FR-A-002 / AC-A-007: mandatory, inherited from the project, fixed after creation (Admin-only change) */}
            <div className="flex flex-col gap-1" data-field="therapeutic-area">
              <span className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                {t('page.new_document.ta_label')}
                <span className="rounded bg-blue-50 px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-wide text-blue-700" data-ta-inherited>{t('page.new_document.ta_inherited_badge')}</span>
              </span>
              <div className="flex h-9 items-center rounded-md border border-slate-200 bg-slate-100 px-3 text-[13px] text-slate-700" aria-readonly="true">
                {projectTherapeuticArea || t('page.new_document.ta_loading')}
              </div>
              <span className="text-[11px] text-slate-500">{t('page.new_document.ta_hint')}</span>
            </div>

            <div className="flex flex-col gap-1">
              <AssigneeCombobox
                label={t('page.new_document.assignee_label')}
                placeholder={t('page.new_document.assignee_placeholder')}
                options={assigneeOptions}
                value={assigneeId}
                onChange={setAssigneeId}
              />
              <span className="text-[11px] text-slate-500">{t('page.new_document.assignee_hint')}</span>
            </div>

            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{t('page.new_document.target_date_label')}</span>
              <input type="date" value={targetCompletionDate} onChange={e => setTargetCompletionDate(e.currentTarget.value)}
                className="h-9 rounded-md border border-slate-300 px-3 text-[13px]" />
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{t('page.new_document.description_label')}</span>
              <textarea value={description} onChange={e => setDescription(e.currentTarget.value)} rows={3}
                className="rounded-md border border-slate-300 px-3 py-2 text-[13px]" />
            </label>

            {errorMsg && (
              <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700" role="alert">
                {errorMsg}
              </div>
            )}
          </section>
        )}

        {step === 4 && (
          <section className="flex flex-col gap-4" data-step-body="ai-drafting">
            <div>
              <h3 className="text-[14px] font-semibold text-slate-900">{t('page.new_document.step4_title')}</h3>
              <p className="mt-0.5 text-[12px] text-slate-500">
                {t('page.new_document.step4_hint', { count: sourceIds.length })}
              </p>
            </div>

            {/* AI drafting is the only path (CW-056), so this is information, not a choice. */}
            <div className="rounded-md border border-blue-500 bg-blue-50 p-3" data-ai-draft-info>
              <p className="text-[13px] font-semibold text-slate-900">{t('page.new_document.ai_on_title')}</p>
              <p className="mt-1 text-[12px] text-slate-600">
                {t('page.new_document.ai_on_description')}
              </p>
            </div>

            {/* Author's optional prompt to the AI drafter. */}
            <AiInstructionsField value={aiInstructions} onChange={setAiInstructions} t={t} />

            {errorMsg && (
              <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700" role="alert">
                {errorMsg}
              </div>
            )}
          </section>
        )}
      </div>

      {/* Footer — step-aware button row */}
      <div className="flex flex-none items-center justify-between gap-2 border-t border-slate-200 bg-white px-5 py-3">
        <button type="button" onClick={onCancel}
          className="rounded-md border border-slate-300 bg-white px-4 py-2 text-[13px] font-semibold text-slate-700 hover:bg-slate-50">
          {t('button.cancel')}
        </button>
        <div className="flex items-center gap-2">
          {step > 1 && (
            <button type="button" onClick={back}
              className="rounded-md border border-slate-300 bg-white px-4 py-2 text-[13px] font-semibold text-slate-700 hover:bg-slate-50"
              data-action="wizard-back"
            >
              {t('button.back')}
            </button>
          )}
          {/* Distinct keys: without them React reuses one <button> for Next and
              Create, flipping it to type="submit" while the Next click is still
              being handled — the browser then submits the form and the
              document is created without the user ever seeing step 4. */}
          {step < 4 ? (
            <button
              key="wizard-next"
              type="button"
              onClick={e => { e.preventDefault(); next() }}
              disabled={
                (step === 2 && !canAdvanceFromStep2) ||
                (step === 3 && !canAdvanceFromStep3)
              }
              className="rounded-md bg-blue-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
              data-action="wizard-next"
            >
              {t('button.next')}
            </button>
          ) : (
            <button
              key="wizard-create"
              type="submit"
              disabled={!canSubmit}
              className="rounded-md bg-blue-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {create.isPending ? t('page.new_document.creating') : t('page.new_document.create_with_ai')}
            </button>
          )}
        </div>
      </div>
    </form>
  )
}

// Best Practices card — collapsible list of applicable best-practice items
// for the chosen document type. Starts collapsed when there are >2 items so
// the step doesn't scroll the user past the Next button. "Review due" items
// expand on first open regardless, since those are the ones that most want
// the writer's attention.
function BestPracticesCard({ items, docTypeLabel }: { items: BestPractice[]; docTypeLabel: string }) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(items.length <= 2 || items.some(bp => bp.reviewDue))

  if (items.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-slate-200 bg-white p-3">
        <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">
          {t('page.new_document.best_practices_header')}
        </p>
        <p className="mt-1 text-[12px] text-slate-500">
          <Trans
            i18nKey="page.new_document.best_practices_empty"
            values={{ docType: docTypeLabel }}
            components={{ libraryPath: <span className="font-mono" /> }}
          />
        </p>
      </div>
    )
  }

  const reviewDueCount = items.filter(bp => bp.reviewDue).length

  return (
    <div className="rounded-md border border-slate-200 bg-white">
      <button
        type="button"
        onClick={() => setExpanded(e => !e)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left"
        aria-expanded={expanded}
        data-action="toggle-best-practices"
      >
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">
            {t('page.new_document.best_practices_for', { docType: docTypeLabel })}
          </span>
          <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
            {items.length}
          </span>
          {reviewDueCount > 0 && (
            <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
              {t('page.new_document.best_practices_review_due_count', { count: reviewDueCount })}
            </span>
          )}
        </div>
        <span className="text-slate-400">{expanded ? '▾' : '▸'}</span>
      </button>

      {expanded && (
        <div className="flex flex-col gap-2 border-t border-slate-200 p-3">
          {items.map(bp => (
            <div
              key={bp.id}
              className={`rounded-md border p-2.5 ${bp.reviewDue ? 'border-amber-200 bg-amber-50/50' : 'border-slate-200 bg-slate-50'}`}
              data-best-practice-id={bp.id}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-[13px] font-semibold text-slate-900">{bp.name}</p>
                {bp.reviewDue && (
                  <span className="flex-none rounded-full border border-amber-300 bg-white px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                    {t('page.new_document.best_practices_review_due_badge')}
                  </span>
                )}
              </div>
              {bp.guidance && (
                <p className="mt-1 text-[12px] leading-relaxed text-slate-700">{bp.guidance}</p>
              )}
              <p className="mt-2 font-mono text-[10px] text-slate-500">
                {bp.version} · {bp.category}
                {bp.frameworkRefs.length > 0 && <> · {bp.frameworkRefs.join(', ')}</>}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// Instructions for the AI drafter — appears below the "Draft with AI"
// opt-in in the NewDocument wizard. Free-text with inline helper +
// clickable example chips that prepend to the current value. 2000-char
// cap enforced server-side; the UI shows a live counter + warns at 1900.
const AI_INSTRUCTIONS_MAX = 2000
const AI_INSTRUCTIONS_WARN_AT = 1900
/** Example-chip keys — each resolves to a translated phrase via t(). The
 *  stable code identifies the chip for data-attribute telemetry; the
 *  rendered text is per-language. */
const AI_INSTRUCTIONS_EXAMPLE_KEYS = [
  'draft_japanese',
  'plain_english',
  'include_tables',
  'mhra_style',
] as const

function AiInstructionsField({ value, onChange, t }: { value: string; onChange: (v: string) => void; t: TFunction }) {
  const remaining = AI_INSTRUCTIONS_MAX - value.length
  const counterTone =
    value.length > AI_INSTRUCTIONS_MAX ? 'text-rose-600' :
    value.length > AI_INSTRUCTIONS_WARN_AT ? 'text-amber-700' : 'text-slate-400'

  const prependExample = (example: string) => {
    if (value.trim().length === 0) {
      onChange(example)
      return
    }
    // Prepend as its own line so the author can keep adding directives.
    const next = `${example}\n${value}`
    onChange(next.slice(0, AI_INSTRUCTIONS_MAX))
  }

  return (
    <div
      className="flex flex-col gap-2 rounded-md border border-slate-200 bg-white p-3"
      data-ai-instructions
    >
      <div className="flex items-baseline justify-between">
        <label htmlFor="ai-instructions" className="text-[12px] font-semibold text-slate-800">
          {t('page.new_document.ai_instructions_label')}
          <span className="ml-2 font-normal text-slate-500">{t('page.new_document.ai_instructions_optional')}</span>
        </label>
        <span className={`font-mono text-[10px] ${counterTone}`} data-ai-instructions-counter>
          {t('page.new_document.ai_instructions_remaining', { count: remaining })}
        </span>
      </div>
      <p className="text-[12px] text-slate-600">
        {t('page.new_document.ai_instructions_help')}
      </p>
      <textarea
        id="ai-instructions"
        value={value}
        onChange={e => onChange(e.currentTarget.value.slice(0, AI_INSTRUCTIONS_MAX))}
        rows={3}
        maxLength={AI_INSTRUCTIONS_MAX}
        placeholder={t('page.new_document.ai_instructions_placeholder')}
        className="w-full resize-y rounded-md border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-900 outline-none placeholder:text-slate-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-100"
        data-ai-instructions-input
      />
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-mono text-[10px] text-slate-400 uppercase tracking-wider">{t('page.new_document.examples_label')}</span>
        {AI_INSTRUCTIONS_EXAMPLE_KEYS.map(code => {
          const label = t(`page.new_document.ai_instructions_example_${code}`)
          return (
            <button
              key={code}
              type="button"
              onClick={() => prependExample(label)}
              className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-[11px] text-slate-700 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
              data-ai-instructions-example={code}
            >
              + {label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
