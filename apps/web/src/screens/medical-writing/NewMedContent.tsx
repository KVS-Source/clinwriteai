// New Med-Content form — rendered inside a right-edge SlidePanel from
// MedicalWritingHome. Hits POST /projects/:id/med-content (API routes in
// apps/api/src/modules/medical-writing/content/routes.ts).
//
// Field notes:
//   - The API's `type` is snake_case (hcp_slide_deck); UI picks hyphen-case
//     from MED_CONTENT_TYPE_META and we snake-case on submit.
//   - complianceTrack: the API accepts promotional | non_promotional | cme |
//     advisory; UI shows friendly labels. We send canonical values.
//   - sourceModuleAProjectId: defaults to the current project so cross-
//     module source linking isn't required for the demo. Editor can rebind
//     later.

import { THERAPEUTIC_AREA_LABEL } from '../../utils/labels'
import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { MedContentType } from '@platform/types'
import { ApiError } from '../../api/client'
import { medContentApi } from '../../modules/medical-writing/api/medContent'
import { assignableUsersApi } from '../../api/raci'
import { platformApi, type MedContentTypePolicy } from '../../platform/api/platformApi'

// Phase M-C.6 — policy-aware wizard. Pulls the configured
// MedContentTypePolicy rows (admin-curated in Master Library → Medical
// Policies) and lists them as first-class choices with the pins each
// policy carries (policy v, AI prompt pin, BP pin, template pin).
// Picking a configured policy preselects the compliance track from
// policy.complianceTrack if set, and the create route (apps/api
// medContentProjectScopedRoutes) will pin
// medContentTypePolicyVersionAtCreate + medContentAiPromptRecordId +
// medContentBestPracticeRecordId on the new item.
//
// The legacy static MED_TYPE_OPTIONS stays as a fallback for the no-
// policy path — admins who haven't configured anything yet still get
// a working flow.

const MED_TYPE_OPTIONS: { value: MedContentType; label: string; description: string }[] = [
  { value: 'hcp-slide-deck',   label: 'HCP Slide Deck',        description: 'Scientific/promotional deck for HCPs — MLR gated.' },
  { value: 'mi-letter',        label: 'Medical Information Letter', description: 'Response to an unsolicited HCP MI query.' },
  { value: 'pil',              label: 'Patient Information Leaflet', description: 'Patient-facing — FK Grade ≤ 8 enforced.' },
  { value: 'cme-module',       label: 'CME Module',            description: 'ACCME/EACCME-compliant education module.' },
  { value: 'disease-dossier',  label: 'Disease / Drug Dossier', description: 'Comprehensive dossier for formulary or KOL.' },
  { value: 'eu-ctr-pls',       label: 'EU CTR Plain Language Summary', description: 'EU CTR Art 37 PLS — patient-facing.' },
  { value: 'advisory-report',  label: 'Advisory Board Report', description: 'Captured KOL ad-board insights + outputs.' },
]

const TRACK_OPTIONS: { value: string; label: string; description: string }[] = [
  { value: 'promotional',     label: 'MLR Track (Promotional)',       description: 'Default — HCP-facing promotional content, full MLR review.' },
  { value: 'non_promotional', label: 'MLR Track (Non-Promotional)',   description: 'Scientific exchange, MI responses.' },
  { value: 'cme',             label: 'ACCME / CME Track',             description: 'Independent CME — ACCME fair-balance rules apply.' },
  { value: 'advisory',        label: 'Advisory Track',                description: 'KOL advisory boards — AI insights capture.' },
]

// API docType uses underscores; UI MedContentType uses hyphens.
function docTypeToUiType(docType: string): MedContentType | null {
  const hyphenated = docType.replace(/_/g, '-') as MedContentType
  const known: MedContentType[] = [
    'hcp-slide-deck', 'mi-letter', 'pil', 'cme-module',
    'disease-dossier', 'eu-ctr-pls', 'advisory-report',
  ]
  return (known as string[]).includes(hyphenated) ? hyphenated : null
}

function uiTypeLabel(value: MedContentType): string {
  const meta = MED_TYPE_OPTIONS.find(t => t.value === value)
  return meta?.label ?? value
}

interface Props {
  projectId:          string
  projectTA?:         string
  duplicateSourceId?: string | null
  onCreated?:         (contentId: string) => void
  onCancel?:          () => void
}

export function NewMedContent({ projectId, projectTA, duplicateSourceId, onCreated, onCancel }: Props) {
  const qc = useQueryClient()

  const [type,            setType]            = useState<MedContentType>('hcp-slide-deck')
  const [title,           setTitle]           = useState('')
  const [complianceTrack, setComplianceTrack] = useState<string>('promotional')
  const [taTag,           setTaTag]           = useState(projectTA ?? '')
  const [ownerId,         setOwnerId]         = useState('')
  // null means "no configured policy selected" (legacy path). A string
  // is the docType of the configured policy card the author picked.
  const [selectedPolicyDocType, setSelectedPolicyDocType] = useState<string | null>(null)

  useEffect(() => {
    if (projectTA && !taTag) setTaTag(projectTA)
  }, [projectTA])

  // Who can own it: the project's candidates (the tenant user directory is admin-only).
  const { data: ownerOptions = [] } = useQuery({
    queryKey: ['assignable-users', projectId],
    queryFn:  () => assignableUsersApi.listForAssignee(projectId),
    retry: false,
  })

  // Configured policies — admin curation in Master Library. Keeps the
  // legacy static type list visible if the fetch fails or nothing is
  // configured yet.
  const { data: policyList } = useQuery({
    queryKey: ['med-content-type-policies'],
    queryFn:  () => platformApi.listMedContentTypePolicies(),
    retry: false,
  })
  const configuredPolicies: MedContentTypePolicy[] = useMemo(() => {
    const rows = policyList?.policies ?? []
    return rows
      .filter(p => p.isCurrent && !p.retiredAt && !!docTypeToUiType(p.docType))
      .sort((a, b) => a.docType.localeCompare(b.docType))
  }, [policyList])

  const { data: sourceContent } = useQuery({
    queryKey: ['medContent', duplicateSourceId],
    queryFn:  () => medContentApi.get(duplicateSourceId!),
    enabled:  !!duplicateSourceId,
  })
  useEffect(() => {
    if (!sourceContent) return
    setType(sourceContent.type)
    setTitle(`${sourceContent.title} (copy)`)
    setTaTag(sourceContent.taTag)
    setOwnerId(sourceContent.ownerId)
  }, [sourceContent])

  // When a configured policy card is selected, snap the compliance
  // track (if the policy pins one) + align the hyphenated type.
  const applyPolicy = (policy: MedContentTypePolicy) => {
    setSelectedPolicyDocType(policy.docType)
    const uiType = docTypeToUiType(policy.docType)
    if (uiType) setType(uiType)
    if (policy.complianceTrack) setComplianceTrack(policy.complianceTrack)
  }
  const clearPolicySelection = () => {
    setSelectedPolicyDocType(null)
  }

  const create = useMutation({
    mutationFn: () => medContentApi.create(projectId, {
      type,
      title,
      taTag,
      complianceTrack,
      ownerId: ownerId || undefined,
      channels: [],
      targetAudience: [],
      // sourceModuleAProjectId is required by the API but defaulted server-
      // side when we extend the schema; for now the Module C API read
      // sourceModuleAProjectId from the create body. Pass projectId as a
      // sensible default — same clinical project.
      projectId,
    } as unknown as Parameters<typeof medContentApi.create>[1] & { sourceModuleAProjectId: string }),
    onSuccess: (item) => {
      qc.invalidateQueries({ queryKey: ['medContent', projectId] })
      onCreated?.((item as { id: string }).id)
    },
  })

  const canSubmit = title.trim().length > 0 && taTag.trim().length > 0 && !create.isPending

  const errorMsg = create.isError
    ? create.error instanceof ApiError
      ? create.error.status === 503
        ? 'Medical Writing is not enabled on this deployment.'
        : create.error.status === 403
          ? 'You do not have write access to this project.'
          // Surface the API's reason (e.g. an inactive therapeutic area).
          : (create.error.body as { message?: string } | null)?.message
            ?? `Could not create (HTTP ${create.error.status}).`
      : 'Could not create — see console for details.'
    : null

  return (
    <form
      onSubmit={e => {
        e.preventDefault()
        if (!canSubmit) return
        create.mutate()
      }}
      className="flex flex-col gap-4 p-5"
      data-form="new-med-content"
    >
      <section className="rounded-lg border border-slate-200 bg-slate-50 p-4">
        <h3 className="text-[13px] font-semibold text-slate-900">Content type</h3>
        <p className="mt-0.5 text-[11px] text-slate-500">
          Determines the MLR track defaults + patient-facing checks (e.g. FK Grade ≤ 8 for PIL/PLS).
        </p>

        {configuredPolicies.length === 0 && (
          <div
            className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800"
            data-banner="no-policies"
          >
            No medical-content policies are configured yet. The create flow will fall back to the
            default section skeleton. Admins — Master Library → Medical Policies → add a policy to
            wire template + AI prompt + best-practice pins.
          </div>
        )}

        {configuredPolicies.length > 0 && (
          <div className="mt-3 flex flex-col gap-2" data-policies>
            <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">
              Configured policies
            </p>
            {configuredPolicies.map(p => {
              const uiType = docTypeToUiType(p.docType)
              const isSelected = selectedPolicyDocType === p.docType
              return (
                <label key={p.id}
                  className={`flex cursor-pointer flex-col gap-1 rounded-md border p-3 ${
                    isSelected ? 'border-violet-500 bg-violet-50' : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                  data-policy-card={p.docType}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <input type="radio" name="policy" value={p.docType} checked={isSelected}
                        onChange={() => applyPolicy(p)} />
                      <span className="text-[13px] font-semibold text-slate-900">
                        {uiType ? uiTypeLabel(uiType) : p.docType.replace(/_/g, ' ')}
                      </span>
                    </div>
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] uppercase text-slate-700">
                      policy v{p.version}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 pl-5">
                    {p.templateId && (
                      <span className="rounded bg-sky-100 px-1.5 py-0.5 font-mono text-[9px] uppercase text-sky-800">
                        template pinned
                      </span>
                    )}
                    {p.checklistTemplateId && (
                      <span className="rounded bg-emerald-100 px-1.5 py-0.5 font-mono text-[9px] uppercase text-emerald-800">
                        checklist pinned
                      </span>
                    )}
                    {p.complianceTrack && (
                      <span className="rounded bg-violet-100 px-1.5 py-0.5 font-mono text-[9px] uppercase text-violet-800">
                        track: {p.complianceTrack}
                      </span>
                    )}
                    {p.smePrompt?.trim() && (
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 font-mono text-[9px] uppercase text-amber-800">
                        SME prompt
                      </span>
                    )}
                  </div>
                </label>
              )
            })}
          </div>
        )}

        <div className="mt-4 flex flex-col gap-2">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">
            {configuredPolicies.length > 0 ? 'Or pick a legacy type (no policy)' : 'Available types'}
          </p>
          {MED_TYPE_OPTIONS.map(t => (
            <label key={t.value}
              className={`flex cursor-pointer flex-col gap-0.5 rounded-md border p-3 ${
                type === t.value && !selectedPolicyDocType ? 'border-violet-500 bg-violet-50' : 'border-slate-200 bg-white hover:border-slate-300'
              }`}>
              <div className="flex items-center gap-2">
                <input type="radio" name="type" value={t.value} checked={type === t.value && !selectedPolicyDocType}
                  onChange={() => { setType(t.value); clearPolicySelection() }} />
                <span className="text-[13px] font-semibold text-slate-900">{t.label}</span>
              </div>
              <span className="pl-5 text-[11px] text-slate-500">{t.description}</span>
            </label>
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-slate-50 p-4">
        <h3 className="text-[13px] font-semibold text-slate-900">Compliance track</h3>
        <div className="mt-3 grid grid-cols-1 gap-2">
          {TRACK_OPTIONS.map(t => (
            <label key={t.value}
              className={`flex cursor-pointer flex-col gap-0.5 rounded-md border p-3 ${
                complianceTrack === t.value ? 'border-violet-500 bg-violet-50' : 'border-slate-200 bg-white hover:border-slate-300'
              }`}>
              <div className="flex items-center gap-2">
                <input type="radio" name="complianceTrack" value={t.value} checked={complianceTrack === t.value}
                  onChange={() => setComplianceTrack(t.value)} />
                <span className="text-[13px] font-semibold text-slate-900">{t.label}</span>
              </div>
              <span className="pl-5 text-[11px] text-slate-500">{t.description}</span>
            </label>
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-slate-50 p-4">
        <h3 className="text-[13px] font-semibold text-slate-900">Details</h3>
        <div className="mt-3 flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Title *</span>
            <input value={title} onChange={e => setTitle(e.currentTarget.value)} required
              placeholder="e.g. Type 2 diabetes patient leaflet"
              className="h-9 rounded-md border border-slate-300 px-3 text-[13px]" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{THERAPEUTIC_AREA_LABEL} *</span>
            <input value={taTag} onChange={e => setTaTag(e.currentTarget.value)} required
              placeholder="e.g. Cardiometabolic"
              className="h-9 rounded-md border border-slate-300 px-3 text-[13px]" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Owner (writer)</span>
            <select value={ownerId} onChange={e => setOwnerId(e.currentTarget.value)}
              className="h-9 rounded-md border border-slate-300 px-3 text-[13px]">
              <option value="">You (default — reassign later)</option>
              {ownerOptions.map(u => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </label>
        </div>
      </section>

      {errorMsg && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700" role="alert">
          {errorMsg}
        </div>
      )}

      <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-slate-200 bg-white px-5 py-3 -mx-5 -mb-5">
        <button type="button" onClick={onCancel}
          className="rounded-md border border-slate-300 bg-white px-4 py-2 text-[13px] font-semibold text-slate-700 hover:bg-slate-50">
          Cancel
        </button>
        <button type="submit" disabled={!canSubmit}
          className="rounded-md px-4 py-2 text-[13px] font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
          style={{ backgroundColor: canSubmit ? '#7C3AED' : undefined }}>
          {create.isPending ? 'Creating…' : 'Create content item'}
        </button>
      </div>
    </form>
  )
}
