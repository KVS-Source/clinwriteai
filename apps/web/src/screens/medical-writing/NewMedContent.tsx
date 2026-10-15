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

import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { MedContentType, PlatformUser } from '@platform/types'
import { ApiError } from '../../api/client'
import { medContentApi } from '../../modules/medical-writing/api/medContent'
import { platformApi } from '../../platform/api/platformApi'

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

  useEffect(() => {
    if (projectTA && !taTag) setTaTag(projectTA)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectTA])

  const { data: users = [] } = useQuery<PlatformUser[]>({
    queryKey: ['platform-users'],
    queryFn:  () => platformApi.listUsers(),
  })

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

  const ownerOptions = useMemo(
    () => users.filter(u => ['medical-writer', 'scientific-writer', 'clinical-writer', 'admin'].includes(u.role)),
    [users],
  )

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
        ? 'Medical Writing (Module C) is not enabled on this deployment.'
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
        <div className="mt-3 grid grid-cols-1 gap-2">
          {MED_TYPE_OPTIONS.map(t => (
            <label key={t.value}
              className={`flex cursor-pointer flex-col gap-0.5 rounded-md border p-3 ${
                type === t.value ? 'border-violet-500 bg-violet-50' : 'border-slate-200 bg-white hover:border-slate-300'
              }`}>
              <div className="flex items-center gap-2">
                <input type="radio" name="type" value={t.value} checked={type === t.value}
                  onChange={() => setType(t.value)} />
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
              placeholder="Veloricept + Pembrolizumab — HCP Slide Deck v0.1"
              className="h-9 rounded-md border border-slate-300 px-3 text-[13px]" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Therapeutic area *</span>
            <input value={taTag} onChange={e => setTaTag(e.currentTarget.value)} required
              placeholder="Oncology"
              className="h-9 rounded-md border border-slate-300 px-3 text-[13px]" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Owner (writer)</span>
            <select value={ownerId} onChange={e => setOwnerId(e.currentTarget.value)}
              className="h-9 rounded-md border border-slate-300 px-3 text-[13px]">
              <option value="">You (default — reassign later)</option>
              {ownerOptions.map(u => (
                <option key={u.id} value={u.id}>{u.name} ({u.role})</option>
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
