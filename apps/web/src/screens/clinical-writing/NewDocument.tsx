// New Document form — rendered inside a right-edge SlidePanel from
// ClinicalWritingHome. API ready at POST /projects/:id/documents
// (apps/api/src/modules/clinical-writing/documents/routes.ts).

import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { CreateDocumentBody, DocumentType, PlatformUser } from '@platform/types'
import { documentsApi } from '../../api'
import { ApiError } from '../../api/client'
import { platformApi } from '../../platform/api/platformApi'

const DOC_TYPES: { value: DocumentType; label: string; description: string }[] = [
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
  onCreated?: (documentId: string) => void
  onCancel?:  () => void
}

export function NewDocumentForm({ projectId, duplicateSourceId, onCreated, onCancel }: Props) {
  const qc = useQueryClient()

  const [type,                 setType]                 = useState<DocumentType>('csr-full')
  const [title,                setTitle]                = useState('')
  const [assigneeId,           setAssigneeId]           = useState('')
  const [targetCompletionDate, setTargetCompletionDate] = useState('')
  const [description,          setDescription]          = useState('')

  const { data: users = [] } = useQuery<PlatformUser[]>({
    queryKey: ['platform-users'],
    queryFn:  () => platformApi.listUsers(),
  })

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

  const assigneeOptions = useMemo(
    () => users.filter(u => ['clinical-writer', 'scientific-writer', 'medical-writer', 'regulatory-writer', 'admin'].includes(u.role)),
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
      }
      return documentsApi.create(projectId, body)
    },
    onSuccess: (doc) => {
      qc.invalidateQueries({ queryKey: ['documents', projectId] })
      onCreated?.((doc as { id: string }).id)
    },
  })

  const canSubmit = title.trim().length > 0 && assigneeId.length > 0 && !create.isPending

  const errorMsg = create.isError
    ? create.error instanceof ApiError
      ? create.error.status === 503
        ? 'Clinical Writing (Module A) is not enabled on this deployment.'
        : create.error.status === 403
          ? 'You do not have write access to this project.'
          : `Could not create document (HTTP ${create.error.status}).`
      : 'Could not create document — see console for details.'
    : null

  return (
    <form
      onSubmit={e => {
        e.preventDefault()
        if (!canSubmit) return
        create.mutate()
      }}
      className="flex flex-col gap-4 p-5"
      data-form="new-document"
    >
      <section className="rounded-lg border border-slate-200 bg-slate-50 p-4">
        <h3 className="text-[13px] font-semibold text-slate-900">Document type</h3>
        <p className="mt-0.5 text-[11px] text-slate-500">Determines the ICH E3 section template + framework checks applied.</p>
        <div className="mt-3 grid grid-cols-1 gap-2">
          {DOC_TYPES.map(t => (
            <label key={t.value}
              className={`flex cursor-pointer flex-col gap-0.5 rounded-md border p-3 ${
                type === t.value ? 'border-blue-500 bg-blue-50' : 'border-slate-200 bg-white hover:border-slate-300'
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
        <h3 className="text-[13px] font-semibold text-slate-900">Details</h3>
        <div className="mt-3 flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Title *</span>
            <input value={title} onChange={e => setTitle(e.currentTarget.value)} required
              placeholder="VELORA-301 CSR v1.0 — Primary Analysis"
              className="h-9 rounded-md border border-slate-300 px-3 text-[13px]" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Assigned writer *</span>
            <select value={assigneeId} onChange={e => setAssigneeId(e.currentTarget.value)} required
              className="h-9 rounded-md border border-slate-300 px-3 text-[13px]">
              <option value="">Select an assignee…</option>
              {assigneeOptions.map(u => (
                <option key={u.id} value={u.id}>{u.name} ({u.role})</option>
              ))}
            </select>
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
          className="rounded-md bg-blue-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300">
          {create.isPending ? 'Creating…' : 'Create document'}
        </button>
      </div>
    </form>
  )
}
