// Ideation Artefacts — list + policy-aware "New artefact" form for an
// ideation project (Phase M-E.6).

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { ApiError } from '../../api/client'
import {
  ideationPublishingApi,
  type CreateArtefactWithPolicyBody,
  type IdeationArtefactDocType,
} from '../../modules/ideation-publishing/api/ideationPublishing'
import {
  platformApi,
  type IdeationTypePolicy,
  type IdeationChannelHint,
} from '../../platform/api/platformApi'
import { SlidePanel } from '../../components/ui/SlidePanel'
import type { IdeationArtefact } from '@platform/types'

type DocType = IdeationArtefactDocType

const DOC_TYPES: Array<{ value: DocType; label: string; description: string }> = [
  { value: 'kol_engagement_brief',      label: 'KOL engagement brief',       description: 'Talking points + engagement plan for a KOL meeting.' },
  { value: 'patient_story',             label: 'Patient story / testimonial', description: 'Consent-governed patient experience narrative.' },
  { value: 'hcp_insight_report',        label: 'HCP insight report',         description: 'Field insights distilled from HCP conversations.' },
  { value: 'medical_affairs_narrative', label: 'Medical affairs narrative',  description: 'Internal medical-affairs messaging + evidence.' },
  { value: 'disease_awareness_brief',   label: 'Disease awareness brief',    description: 'Non-promotional disease education content.' },
  { value: 'press_release',             label: 'Press release',              description: 'External-facing press announcement.' },
  { value: 'scientific_exchange_note',  label: 'Scientific exchange note',   description: 'Off-label scientific exchange one-pager.' },
  { value: 'congress_summary',          label: 'Congress summary',           description: 'Post-congress digest + takeaways.' },
]

const CHANNEL_HINTS: Array<{ value: IdeationChannelHint; label: string }> = [
  { value: 'kol',     label: 'KOL engagement' },
  { value: 'hcp',     label: 'HCP communication' },
  { value: 'patient', label: 'Patient-facing' },
  { value: 'press',   label: 'Press / public comms' },
]

function errMessage(err: unknown, fallback = 'Request failed'): string {
  if (err instanceof ApiError) {
    const body = err.body as { message?: string; error?: string } | null
    if (body?.message) return body.message
    if (body?.error)   return body.error
    return String(err.status)
  }
  return err instanceof Error ? err.message : fallback
}

export function NewIdeationArtefactsList() {
  const { projectId, ideationProjectId } = useParams()
  const navigate = useNavigate()
  const [newOpen, setNewOpen] = useState(false)

  const listQ = useQuery({
    queryKey: ['ideation-artefacts', ideationProjectId],
    queryFn:  () => ideationPublishingApi.listArtefacts(ideationProjectId!),
    enabled:  !!ideationProjectId,
  })

  if (!projectId || !ideationProjectId) {
    return <p className="p-6 text-[13px] text-rose-700">Missing route parameters.</p>
  }

  const rows = listQ.data ?? []

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-5" data-screen="ideation-artefacts">
      <header className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-[20px] font-semibold text-slate-900">Artefacts</h1>
          <p className="mt-0.5 text-[13px] text-slate-500">
            Long-form ideation artefacts authored inside this project. Each artefact pins the
            current Ideation Policy (template + AI prompt + BP digest) at creation time.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setNewOpen(true)}
          className="rounded-md border border-blue-600 bg-blue-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-blue-700"
          data-action="new-ideation-artefact"
        >
          + New artefact
        </button>
      </header>

      {listQ.isLoading && <p className="text-[13px] text-slate-500">Loading artefacts…</p>}
      {listQ.error && (
        <p className="text-[13px] text-rose-700">{errMessage(listQ.error, 'Could not load artefacts')}</p>
      )}

      {listQ.data && listQ.data.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed border-slate-300 bg-white p-8 text-center">
          <p className="text-[13px] font-semibold text-slate-800">No artefacts yet</p>
          <p className="max-w-md text-[12px] text-slate-500">
            Start with a KOL engagement brief, patient story, or HCP insight report.
          </p>
          <button
            type="button"
            onClick={() => setNewOpen(true)}
            className="rounded-md border border-blue-600 bg-blue-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-blue-700"
          >+ New artefact</button>
        </div>
      )}

      {rows.length > 0 && (
        <div className="overflow-hidden rounded-md border border-slate-200 bg-white" data-table>
          <table className="w-full text-[13px]">
            <thead className="bg-slate-50 text-left font-mono text-[10px] uppercase tracking-widest text-slate-500">
              <tr>
                <th className="px-3 py-2 font-semibold">Title</th>
                <th className="px-3 py-2 font-semibold">Doc type</th>
                <th className="px-3 py-2 font-semibold">Source</th>
                <th className="px-3 py-2 font-semibold">Approval</th>
                <th className="px-3 py-2 font-semibold">Version</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(a => (
                <tr
                  key={a.id}
                  onClick={() => navigate(`/projects/${projectId}/ideation-publishing/projects/${ideationProjectId}/artefacts/${a.id}/live-editor`)}
                  tabIndex={0}
                  className="cursor-pointer border-t border-slate-100 hover:bg-blue-50/60"
                  data-row={a.id}
                >
                  <td className="px-3 py-2 align-top font-semibold text-slate-900">{a.title}</td>
                  <td className="px-3 py-2 align-top font-mono text-[11px]">{(a as unknown as { docType?: string }).docType ?? '—'}</td>
                  <td className="px-3 py-2 align-top font-mono text-[11px]">{a.sourceModule ?? '—'}</td>
                  <td className="px-3 py-2 align-top font-mono text-[11px]">{a.approvalStatusCheck}</td>
                  <td className="px-3 py-2 align-top font-mono text-[11px]">{a.version}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <SlidePanel
        open={newOpen}
        onClose={() => setNewOpen(false)}
        title="New ideation artefact"
        subtitle="Anchor a new ideation artefact in this project."
        storageKey="clinwrite.ideationArtefacts.new.width"
        defaultWidth={560}
        minWidth={440}
        maxWidth={900}
      >
        <NewIdeationArtefactForm
          ideationProjectId={ideationProjectId}
          onCreated={(artefact) => {
            setNewOpen(false)
            navigate(`/projects/${projectId}/ideation-publishing/projects/${ideationProjectId}/artefacts/${artefact.id}/live-editor`)
          }}
          onCancel={() => setNewOpen(false)}
        />
      </SlidePanel>
    </div>
  )
}

function NewIdeationArtefactForm({
  ideationProjectId, onCreated, onCancel,
}: {
  ideationProjectId: string
  onCreated: (artefact: IdeationArtefact) => void
  onCancel?: () => void
}) {
  const qc = useQueryClient()
  const [docType, setDocType]       = useState<DocType>('kol_engagement_brief')
  const [title, setTitle]           = useState('')
  const [version, setVersion]       = useState('v0.1')
  const [sourceModule, setSourceModule] = useState<'A' | 'B' | 'C' | 'D' | 'external'>('external')
  const [selectedPolicyDocType, setSelectedPolicyDocType] = useState<string | null>(null)

  const { data: policyList } = useQuery({
    queryKey: ['ideation-type-policies'],
    queryFn:  () => platformApi.listIdeationTypePolicies(),
    retry: false,
  })
  const configuredPolicies: IdeationTypePolicy[] = useMemo(() => {
    const rows = policyList?.policies ?? []
    const known = new Set(DOC_TYPES.map(t => t.value as string))
    return rows
      .filter(p => p.isCurrent && !p.retiredAt && known.has(p.docType))
      .sort((a, b) => a.docType.localeCompare(b.docType))
  }, [policyList])

  const applyPolicy = (p: IdeationTypePolicy) => {
    setSelectedPolicyDocType(p.docType)
    setDocType(p.docType as DocType)
  }
  const clearPolicySelection = () => setSelectedPolicyDocType(null)

  const create = useMutation({
    mutationFn: () => ideationPublishingApi.createArtefactWithPolicy(ideationProjectId, {
      docType,
      title,
      version,
      originalApprovalDate: new Date().toISOString(),
      sourceModule,
    } as CreateArtefactWithPolicyBody),
    onSuccess: (artefact) => {
      qc.invalidateQueries({ queryKey: ['ideation-artefacts', ideationProjectId] })
      onCreated(artefact)
    },
  })

  const canSubmit = title.trim().length > 0 && !create.isPending

  const errorMsg = create.isError
    ? create.error instanceof ApiError
      ? (create.error.body as { message?: string } | null)?.message
        ?? `Could not create (HTTP ${create.error.status}).`
      : 'Could not create — see console for details.'
    : null

  const typeLabel = (v: string) => DOC_TYPES.find(t => t.value === v)?.label ?? v

  const channelLabel = (hint: IdeationChannelHint | null): string =>
    hint ? CHANNEL_HINTS.find(h => h.value === hint)?.label ?? hint : ''

  return (
    <form
      onSubmit={e => { e.preventDefault(); if (canSubmit) create.mutate() }}
      className="flex flex-col gap-4 p-5"
      data-form="new-ideation-artefact"
    >
      <section className="rounded-lg border border-slate-200 bg-slate-50 p-4">
        <h3 className="text-[13px] font-semibold text-slate-900">Artefact type</h3>
        <p className="mt-0.5 text-[11px] text-slate-500">
          Determines the section skeleton + the AI prompt / BP digest / template pins the drafter
          will respect.
        </p>

        {configuredPolicies.length === 0 && (
          <div
            className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800"
            data-banner="no-policies"
          >
            No ideation policies configured yet. The create flow will fall back to the default
            section skeleton for the chosen doc type. Admins — Master Library → Ideation
            Policies → add a policy to wire template + AI prompt + best-practice pins.
          </div>
        )}

        {configuredPolicies.length > 0 && (
          <div className="mt-3 flex flex-col gap-2" data-policies>
            <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">
              Configured policies
            </p>
            {configuredPolicies.map(p => {
              const isSelected = selectedPolicyDocType === p.docType
              return (
                <label key={p.id}
                  className={`flex cursor-pointer flex-col gap-1 rounded-md border p-3 ${
                    isSelected ? 'border-blue-500 bg-blue-50' : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                  data-policy-card={p.docType}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <input type="radio" name="policy" value={p.docType} checked={isSelected}
                        onChange={() => applyPolicy(p)} />
                      <span className="text-[13px] font-semibold text-slate-900">{typeLabel(p.docType)}</span>
                    </div>
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] uppercase text-slate-700">
                      policy v{p.version}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 pl-5">
                    {p.templateId && (
                      <span className="rounded bg-sky-100 px-1.5 py-0.5 font-mono text-[9px] uppercase text-sky-800">template pinned</span>
                    )}
                    {p.checklistTemplateId && (
                      <span className="rounded bg-emerald-100 px-1.5 py-0.5 font-mono text-[9px] uppercase text-emerald-800">checklist pinned</span>
                    )}
                    {p.channelHint && (
                      <span className="rounded bg-violet-100 px-1.5 py-0.5 font-mono text-[9px] uppercase text-violet-800">channel: {channelLabel(p.channelHint)}</span>
                    )}
                    {p.smePrompt?.trim() && (
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 font-mono text-[9px] uppercase text-amber-800">SME prompt</span>
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
          {DOC_TYPES.map(t => (
            <label key={t.value}
              className={`flex cursor-pointer flex-col gap-0.5 rounded-md border p-3 ${
                docType === t.value && !selectedPolicyDocType ? 'border-blue-500 bg-blue-50' : 'border-slate-200 bg-white hover:border-slate-300'
              }`}>
              <div className="flex items-center gap-2">
                <input type="radio" name="docType" value={t.value} checked={docType === t.value && !selectedPolicyDocType}
                  onChange={() => { setDocType(t.value); clearPolicySelection() }} />
                <span className="text-[13px] font-semibold text-slate-900">{t.label}</span>
              </div>
              <span className="pl-5 text-[11px] text-slate-500">{t.description}</span>
            </label>
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-slate-50 p-4">
        <h3 className="text-[13px] font-semibold text-slate-900">Title *</h3>
        <input
          value={title}
          onChange={e => setTitle(e.currentTarget.value)}
          required
          placeholder={`e.g. ${typeLabel(docType)} — Study ABC-123`}
          className="mt-2 h-9 w-full rounded-md border border-slate-300 px-3 text-[13px]"
        />
      </section>

      <section className="rounded-lg border border-slate-200 bg-slate-50 p-4">
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Version</span>
            <input value={version} onChange={e => setVersion(e.currentTarget.value)}
              className="h-9 rounded-md border border-slate-300 bg-white px-3 text-[13px]" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Source module</span>
            <select value={sourceModule}
              onChange={e => setSourceModule(e.currentTarget.value as 'A' | 'B' | 'C' | 'D' | 'external')}
              className="h-9 rounded-md border border-slate-300 bg-white px-3 text-[13px]">
              <option value="A">Clinical Writing</option>
              <option value="B">Scientific Writing</option>
              <option value="C">Medical Writing</option>
              <option value="D">Regulatory Writing</option>
              <option value="external">External upload</option>
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
        {onCancel && (
          <button type="button" onClick={onCancel}
            className="rounded-md border border-slate-300 bg-white px-4 py-2 text-[13px] font-semibold text-slate-700 hover:bg-slate-50">
            Cancel
          </button>
        )}
        <button type="submit" disabled={!canSubmit}
          className="rounded-md bg-blue-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300">
          {create.isPending ? 'Creating…' : 'Create artefact'}
        </button>
      </div>
    </form>
  )
}
