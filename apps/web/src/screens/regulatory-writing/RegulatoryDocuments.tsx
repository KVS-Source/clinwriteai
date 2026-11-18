// Regulatory Documents — list + policy-aware "New document" form for a
// submission (Phase M-D.6).

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { ApiError } from '../../api/client'
import {
  regulatoryWritingApi,
  type CreateRegulatoryDocumentBody,
  type RegulatoryDocumentRow,
} from '../../modules/regulatory-writing/api/regulatoryWriting'
import {
  platformApi,
  type RegulatoryTypePolicy,
  type RegulatoryTrack,
} from '../../platform/api/platformApi'
import { SlidePanel } from '../../components/ui/SlidePanel'

type DocType = CreateRegulatoryDocumentBody['docType']

const DOC_TYPES: Array<{ value: DocType; label: string; description: string }> = [
  { value: 'ctd_m2_3_qos',              label: 'CTD §2.3 Quality Overall Summary',           description: 'CMC overall summary for the quality module.' },
  { value: 'ctd_m2_4_nonclin_overview', label: 'CTD §2.4 Nonclinical Overview',               description: 'Nonclinical pharmacology, PK, toxicology integrated overview.' },
  { value: 'ctd_m2_5_clinical_overview',label: 'CTD §2.5 Clinical Overview',                  description: 'Clinical pharmacology, efficacy, safety + benefit-risk conclusions.' },
  { value: 'ctd_m2_6_nonclin_summary',  label: 'CTD §2.6 Nonclinical Summaries',              description: 'Written + tabulated summaries by discipline.' },
  { value: 'ctd_m2_7_clinical_summary', label: 'CTD §2.7 Clinical Summary',                   description: 'Pooled summaries by discipline + synopses of individual studies.' },
  { value: 'cover_letter',              label: 'Submission cover letter',                     description: 'Module 1 cover letter.' },
  { value: 'ha_response_narrative',     label: 'HA response narrative',                       description: 'Narrative response to a List of Questions.' },
  { value: 'risk_benefit_statement',    label: 'Risk-benefit statement',                      description: 'Stand-alone benefit / risk conclusion.' },
]

const TRACK_OPTIONS: Array<{ value: RegulatoryTrack; label: string }> = [
  { value: 'ind',       label: 'IND (Investigational New Drug)' },
  { value: 'nda',       label: 'NDA (New Drug Application)' },
  { value: 'maa',       label: 'MAA (EU Marketing Authorisation Application)' },
  { value: 'bla',       label: 'BLA (Biologics License Application)' },
  { value: 'variation', label: 'Variation / Type II (post-approval change)' },
  { value: 'other',     label: 'Other' },
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

export function RegulatoryDocuments() {
  const { projectId, submissionId } = useParams()
  const navigate = useNavigate()
  const [newOpen, setNewOpen] = useState(false)

  const docsQ = useQuery({
    queryKey: ['regulatory-documents', submissionId],
    queryFn:  () => regulatoryWritingApi.listDocuments(submissionId!),
    enabled:  !!submissionId,
  })

  if (!projectId || !submissionId) {
    return <p className="p-6 text-[13px] text-rose-700">Missing route parameters.</p>
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-5" data-screen="regulatory-documents">
      <header className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-[20px] font-semibold text-slate-900">Documents</h1>
          <p className="mt-0.5 text-[13px] text-slate-500">
            Long-form narrative documents authored inside this submission. Each document pins the
            current Regulatory Policy (template + AI prompt + best-practice digest) at creation
            time.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setNewOpen(true)}
          className="rounded-md border border-blue-600 bg-blue-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-blue-700"
          data-action="new-regulatory-document"
        >
          + New document
        </button>
      </header>

      {docsQ.isLoading && <p className="text-[13px] text-slate-500">Loading documents…</p>}
      {docsQ.error && (
        <p className="text-[13px] text-rose-700">{errMessage(docsQ.error, 'Could not load documents')}</p>
      )}

      {docsQ.data && docsQ.data.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed border-slate-300 bg-white p-8 text-center">
          <p className="text-[13px] font-semibold text-slate-800">No regulatory documents yet</p>
          <p className="max-w-md text-[12px] text-slate-500">
            Start with a CTD Module 2 overview, cover letter, or HA response narrative.
          </p>
          <button
            type="button"
            onClick={() => setNewOpen(true)}
            className="rounded-md border border-blue-600 bg-blue-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-blue-700"
          >+ New document</button>
        </div>
      )}

      {docsQ.data && docsQ.data.length > 0 && (
        <div className="overflow-hidden rounded-md border border-slate-200 bg-white" data-table>
          <table className="w-full text-[13px]">
            <thead className="bg-slate-50 text-left font-mono text-[10px] uppercase tracking-widest text-slate-500">
              <tr>
                <th className="px-3 py-2 font-semibold">Title</th>
                <th className="px-3 py-2 font-semibold">Doc type</th>
                <th className="px-3 py-2 font-semibold">Track</th>
                <th className="px-3 py-2 font-semibold">AI draft</th>
                <th className="px-3 py-2 font-semibold">Updated</th>
              </tr>
            </thead>
            <tbody>
              {docsQ.data.map(d => (
                <tr
                  key={d.id}
                  onClick={() => navigate(`/projects/${projectId}/regulatory-writing/submissions/${submissionId}/documents/${d.id}/live-editor`)}
                  tabIndex={0}
                  className="cursor-pointer border-t border-slate-100 hover:bg-blue-50/60"
                  data-row={d.id}
                >
                  <td className="px-3 py-2 align-top">
                    <div className="flex flex-col">
                      <span className="font-semibold text-slate-900">{d.title}</span>
                      <span className="font-mono text-[10px] text-slate-500">{d.version} · policy v{d.regTypePolicyVersionAtCreate ?? '—'}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2 align-top font-mono text-[11px]">{d.docType}</td>
                  <td className="px-3 py-2 align-top">{d.regulatoryTrack ?? '—'}</td>
                  <td className="px-3 py-2 align-top"><AiDraftBadge state={d.aiDraftState} /></td>
                  <td className="px-3 py-2 align-top font-mono text-[10px] text-slate-500">{new Date(d.updatedAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <SlidePanel
        open={newOpen}
        onClose={() => setNewOpen(false)}
        title="New regulatory document"
        subtitle="Anchor a new CTD narrative document in this submission."
        storageKey="clinwrite.regDocs.new.width"
        defaultWidth={560}
        minWidth={440}
        maxWidth={900}
      >
        <NewRegulatoryDocumentForm
          submissionId={submissionId}
          onCreated={(doc) => {
            setNewOpen(false)
            navigate(`/projects/${projectId}/regulatory-writing/submissions/${submissionId}/documents/${doc.id}/live-editor`)
          }}
          onCancel={() => setNewOpen(false)}
        />
      </SlidePanel>
    </div>
  )
}

function AiDraftBadge({ state }: { state: string }) {
  const palette: Record<string, string> = {
    idle:       'bg-slate-100 text-slate-700',
    drafting:   'bg-blue-100 text-blue-800 animate-pulse',
    validating: 'bg-amber-100 text-amber-800 animate-pulse',
    complete:   'bg-emerald-100 text-emerald-800',
    failed:     'bg-rose-100 text-rose-800',
  }
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-widest ${palette[state] ?? 'bg-slate-100 text-slate-700'}`}>
      {state}
    </span>
  )
}

function NewRegulatoryDocumentForm({
  submissionId, onCreated, onCancel,
}: {
  submissionId: string
  onCreated: (doc: RegulatoryDocumentRow) => void
  onCancel?: () => void
}) {
  const qc = useQueryClient()
  const [docType, setDocType]                 = useState<DocType>('ctd_m2_5_clinical_overview')
  const [title, setTitle]                     = useState('')
  const [regulatoryTrack, setRegulatoryTrack] = useState<RegulatoryTrack | ''>('')
  const [selectedPolicyDocType, setSelectedPolicyDocType] = useState<string | null>(null)

  const { data: policyList } = useQuery({
    queryKey: ['regulatory-type-policies'],
    queryFn:  () => platformApi.listRegulatoryTypePolicies(),
    retry: false,
  })
  const configuredPolicies: RegulatoryTypePolicy[] = useMemo(() => {
    const rows = policyList?.policies ?? []
    const known = new Set(DOC_TYPES.map(t => t.value))
    return rows
      .filter(p => p.isCurrent && !p.retiredAt && known.has(p.docType as DocType))
      .sort((a, b) => a.docType.localeCompare(b.docType))
  }, [policyList])

  const applyPolicy = (p: RegulatoryTypePolicy) => {
    setSelectedPolicyDocType(p.docType)
    setDocType(p.docType as DocType)
    if (p.regulatoryTrack) setRegulatoryTrack(p.regulatoryTrack)
  }
  const clearPolicySelection = () => setSelectedPolicyDocType(null)

  const create = useMutation({
    mutationFn: () => regulatoryWritingApi.createDocument(submissionId, {
      docType,
      title,
      regulatoryTrack: regulatoryTrack || undefined,
    }),
    onSuccess: (doc) => {
      qc.invalidateQueries({ queryKey: ['regulatory-documents', submissionId] })
      onCreated(doc)
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

  return (
    <form
      onSubmit={e => { e.preventDefault(); if (canSubmit) create.mutate() }}
      className="flex flex-col gap-4 p-5"
      data-form="new-regulatory-document"
    >
      <section className="rounded-lg border border-slate-200 bg-slate-50 p-4">
        <h3 className="text-[13px] font-semibold text-slate-900">Document type</h3>
        <p className="mt-0.5 text-[11px] text-slate-500">
          Determines the section skeleton + the AI prompt / BP digest / template pins the drafter
          will respect.
        </p>

        {configuredPolicies.length === 0 && (
          <div
            className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800"
            data-banner="no-policies"
          >
            No regulatory policies configured yet. The create flow will fall back to the default
            section skeleton for the chosen doc type. Admins — Master Library → Regulatory Policies
            → add a policy to wire template + AI prompt + best-practice pins.
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
                    {p.regulatoryTrack && (
                      <span className="rounded bg-violet-100 px-1.5 py-0.5 font-mono text-[9px] uppercase text-violet-800">track: {p.regulatoryTrack}</span>
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
        <h3 className="text-[13px] font-semibold text-slate-900">Regulatory track</h3>
        <select
          value={regulatoryTrack}
          onChange={e => setRegulatoryTrack(e.currentTarget.value as RegulatoryTrack | '')}
          className="mt-2 h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-[13px]"
          data-field="regulatory-track"
        >
          <option value="">— inherit from policy —</option>
          {TRACK_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
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
          {create.isPending ? 'Creating…' : 'Create document'}
        </button>
      </div>
    </form>
  )
}
