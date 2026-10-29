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
import type { BestPractice, CreateDocumentBody, DocumentType, PlatformUser } from '@platform/types'
import { documentsApi, type DocumentTemplate } from '../../api'
import { ApiError } from '../../api/client'
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
  onCreated?: (documentId: string) => void
  onCancel?:  () => void
}

type Step = 1 | 2 | 3
const STEP_LABELS: Record<Step, string> = {
  1: 'Document type',
  2: 'Source documents',
  3: 'Details',
}

export function NewDocumentForm({
  projectId,
  duplicateSourceId,
  initialSourceIds,
  projectTherapeuticArea,
  projectShortTitle,
  onRequestUpload,
  onCreated,
  onCancel,
}: Props) {
  const qc = useQueryClient()

  const [step,                 setStep]                 = useState<Step>(1)
  const [type,                 setType]                 = useState<DocumentType>('csr-full')
  const [title,                setTitle]                = useState('')
  const [assigneeId,           setAssigneeId]           = useState('')
  const [targetCompletionDate, setTargetCompletionDate] = useState('')
  const [description,          setDescription]          = useState('')
  const [sourceIds,            setSourceIds]            = useState<string[]>(initialSourceIds ?? [])
  const [showAllCategories,    setShowAllCategories]    = useState(false)

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
  const { data: sourcePage, refetch: refetchSources } = useQuery({
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

  const filteredSources = useMemo(() => {
    if (showAllCategories || !recommendedCategories) return sources
    return sources.filter(s => recommendedSet.has(s.category))
  }, [sources, showAllCategories, recommendedCategories, recommendedSet])

  // If the user had sources selected that fall outside the recommended
  // set, keep them (don't silently drop) — they'll see them under the
  // "Show all categories" toggle. But flag the count so they can act.
  const outOfScopeSelectedCount = useMemo(() => {
    if (!recommendedCategories) return 0
    return sourceIds.filter(id => {
      const src = sources.find(s => s.id === id)
      return src && !recommendedSet.has(src.category)
    }).length
  }, [sourceIds, sources, recommendedCategories, recommendedSet])

  const { data: users = [] } = useQuery<PlatformUser[]>({
    queryKey: ['platform-users'],
    queryFn:  () => platformApi.listUsers(),
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
    return allBestPractices.filter(bp => {
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
  const assigneeOptions = useMemo(
    () => users.filter(u => {
      const status = u.status as string   // the API also returns 'deprovisioned'
      if (status === 'suspended' || status === 'deprovisioned') return false
      const role = u.role as string
      if (['clinical-writer', 'scientific-writer', 'medical-writer', 'regulatory-writer', 'admin', 'tenant-admin'].includes(role)) return true
      if (role !== 'contributor') return false
      const capabilities = (u as { capabilities?: string[] }).capabilities
      return !capabilities || capabilities.includes('can-author')
    }),
    [users],
  )

  const create = useMutation({
    mutationFn: () => {
      const body: CreateDocumentBody = {
        type,
        title,
        assigneeId,
        targetCompletionDate: targetCompletionDate ? new Date(targetCompletionDate).toISOString() : undefined,
        description: description || undefined,
        sourceUploadIds: sourceIds.length ? sourceIds : undefined,
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
  const canSubmit           = title.trim().length > 0 && assigneeId.length > 0 && !create.isPending && canAdvanceFromStep2

  const next = () => {
    if (step === 1 && canAdvanceFromStep1) setStep(2)
    else if (step === 2 && canAdvanceFromStep2) setStep(3)
  }
  const back = () => {
    if (step === 3) setStep(2)
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
        if (!canSubmit || step !== 3) return
        create.mutate()
      }}
      className="flex h-full flex-col"
      data-form="new-document"
      data-step={step}
    >
      {/* Progress indicator */}
      <div className="flex-none border-b border-slate-200 bg-white px-5 py-3">
        <div className="flex items-center gap-2">
          {[1, 2, 3].map(n => {
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
                  {STEP_LABELS[s]}
                </span>
                {n < 3 && <span className={`h-px flex-1 ${step > s ? 'bg-blue-600' : 'bg-slate-200'}`} />}
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
              <h3 className="text-[14px] font-semibold text-slate-900">What are you writing?</h3>
              <p className="mt-0.5 text-[12px] text-slate-500">
                The type determines the section template + framework checks applied.
              </p>
            </div>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Document type *</span>
              <select
                value={type}
                onChange={e => setType(e.currentTarget.value as DocumentType)}
                className="h-10 rounded-md border border-slate-300 px-3 text-[13px]"
                data-field="type"
              >
                {docTypeOptions.map(t => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </label>
            {selectedTypeMeta && (
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                <p className="text-[12px] text-slate-700">{selectedTypeMeta.description}</p>
                {recommendedCategories && (
                  <p className="mt-2 text-[11px] text-slate-500">
                    <span className="font-semibold">Typical sources:</span>{' '}
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
              <h3 className="text-[14px] font-semibold text-slate-900">Pick the sources this document is written from</h3>
              <p className="mt-0.5 text-[12px] text-slate-500">
                Mandatory — the writer (and later, the AI drafter) uses these as evidence.
                {recommendedCategories && !showAllCategories && (
                  <> Filtered to <span className="font-semibold">{recommendedCategories.map(c => sourceCategoryLabel(c)).join(' · ')}</span> for {selectedTypeMeta?.label}.</>
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
                    + Upload source
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => refetchSources()}
                  className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-[12px] text-slate-600 hover:bg-slate-50"
                >
                  Refresh
                </button>
              </div>
              {recommendedCategories && (
                <label className="flex items-center gap-2 text-[11px] text-slate-600">
                  <input
                    type="checkbox"
                    checked={showAllCategories}
                    onChange={e => setShowAllCategories(e.currentTarget.checked)}
                  />
                  Show all categories
                </label>
              )}
            </div>

            {filteredSources.length === 0 ? (
              <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-5 text-center">
                <p className="text-[12px] text-slate-600">
                  {sources.length === 0
                    ? "This project's library has no source documents yet."
                    : "No sources match the recommended categories for this document type."}
                </p>
                {onRequestUpload && (
                  <button
                    type="button"
                    onClick={onRequestUpload}
                    className="mt-3 rounded-md bg-blue-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-blue-700"
                  >
                    + Upload a source
                  </button>
                )}
                {sources.length > 0 && !showAllCategories && (
                  <button
                    type="button"
                    onClick={() => setShowAllCategories(true)}
                    className="ml-2 mt-3 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-[12px] font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Show all categories
                  </button>
                )}
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
                  ? 'Select at least one source to continue.'
                  : `${sourceIds.length} selected`}
              </span>
              {outOfScopeSelectedCount > 0 && (
                <span className="text-amber-600">
                  {outOfScopeSelectedCount} outside recommended categories
                </span>
              )}
            </div>
          </section>
        )}

        {step === 3 && (
          <section className="flex flex-col gap-4" data-step-body="details">
            <div>
              <h3 className="text-[14px] font-semibold text-slate-900">Document details</h3>
              <p className="mt-0.5 text-[12px] text-slate-500">
                You picked {selectedTypeMeta?.label} with {sourceIds.length} source{sourceIds.length === 1 ? '' : 's'}.
                {relevantBestPractices.length > 0 && (
                  <> {relevantBestPractices.length} best practice{relevantBestPractices.length === 1 ? '' : 's'} will apply{relevantBestPractices.some(bp => bp.reviewDue) ? ' (one is marked Review due)' : ''}.</>
                )}
              </p>
            </div>

            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Title *</span>
              <input value={title} onChange={e => setTitle(e.currentTarget.value)} required
                placeholder={projectShortTitle ? `${projectShortTitle} CSR v1.0 — Primary Analysis` : 'e.g. CSR v1.0 — Primary Analysis'}
                className="h-9 rounded-md border border-slate-300 px-3 text-[13px]" />
            </label>

            {/* FR-A-002 / AC-A-007: mandatory, inherited from the project, fixed after creation (Admin-only change) */}
            <div className="flex flex-col gap-1" data-field="therapeutic-area">
              <span className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Therapeutic area *
                <span className="rounded bg-blue-50 px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-wide text-blue-700" data-ta-inherited>INHERITED</span>
              </span>
              <div className="flex h-9 items-center rounded-md border border-slate-200 bg-slate-100 px-3 text-[13px] text-slate-700" aria-readonly="true">
                {projectTherapeuticArea || 'Loading…'}
              </div>
              <span className="text-[11px] text-slate-500">Set by the project. Only an Admin can change it after the document is created.</span>
            </div>

            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Assigned writer *</span>
              <select value={assigneeId} onChange={e => setAssigneeId(e.currentTarget.value)} required
                className="h-9 rounded-md border border-slate-300 px-3 text-[13px]">
                <option value="">Select an assignee…</option>
                {assigneeOptions.map(u => (
                  <option key={u.id} value={u.id}>{u.name} ({u.role})</option>
                ))}
              </select>
              <span className="text-[11px] text-slate-500">The assignee is auto-added as the Responsible (R) on the RACI matrix.</span>
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Target completion date</span>
              <input type="date" value={targetCompletionDate} onChange={e => setTargetCompletionDate(e.currentTarget.value)}
                className="h-9 rounded-md border border-slate-300 px-3 text-[13px]" />
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Description</span>
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
      </div>

      {/* Footer — step-aware button row */}
      <div className="flex flex-none items-center justify-between gap-2 border-t border-slate-200 bg-white px-5 py-3">
        <button type="button" onClick={onCancel}
          className="rounded-md border border-slate-300 bg-white px-4 py-2 text-[13px] font-semibold text-slate-700 hover:bg-slate-50">
          Cancel
        </button>
        <div className="flex items-center gap-2">
          {step > 1 && (
            <button type="button" onClick={back}
              className="rounded-md border border-slate-300 bg-white px-4 py-2 text-[13px] font-semibold text-slate-700 hover:bg-slate-50"
              data-action="wizard-back"
            >
              Back
            </button>
          )}
          {step < 3 ? (
            <button
              type="button"
              onClick={next}
              disabled={step === 2 && !canAdvanceFromStep2}
              className="rounded-md bg-blue-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
              data-action="wizard-next"
            >
              Next
            </button>
          ) : (
            <button
              type="submit"
              disabled={!canSubmit}
              className="rounded-md bg-blue-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {create.isPending ? 'Creating…' : 'Create document'}
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
  const [expanded, setExpanded] = useState(items.length <= 2 || items.some(bp => bp.reviewDue))

  if (items.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-slate-200 bg-white p-3">
        <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">
          Best practices
        </p>
        <p className="mt-1 text-[12px] text-slate-500">
          No best-practice items apply to {docTypeLabel}. Platform admins can publish items
          via <span className="font-mono">Library → Best Practices</span>.
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
            Best practices for {docTypeLabel}
          </span>
          <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
            {items.length}
          </span>
          {reviewDueCount > 0 && (
            <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
              {reviewDueCount} review due
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
                    Review due
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
