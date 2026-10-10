// New Document form — fills the Module A gap left by PlaceholderScreen
// on /projects/:projectId/clinical-writing/new. API ready at
// POST /projects/:projectId/documents (apps/api/src/modules/clinical-
// writing/documents/routes.ts). Any authenticated user can create.

import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { CreateDocumentBody, DocumentType, PlatformUser } from '@platform/types'
import { documentsApi } from '../../api'
import { ApiError } from '../../api/client'
import { platformApi } from '../../platform/api/platformApi'
import { projectsApi } from '../../api'

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

export function NewDocument() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { projectId } = useParams<{ projectId: string }>()
  const [searchParams] = useSearchParams()
  const dupSourceId = searchParams.get('dup')

  const [type,                 setType]                 = useState<DocumentType>('csr-full')
  const [title,                setTitle]                = useState('')
  const [assigneeId,           setAssigneeId]           = useState('')
  const [targetCompletionDate, setTargetCompletionDate] = useState('')
  const [description,          setDescription]          = useState('')

  // Prefill when duplicating from an existing document.
  const { data: sourceDoc } = useQuery({
    queryKey: ['document', dupSourceId],
    queryFn:  () => documentsApi.get(dupSourceId!),
    enabled:  !!dupSourceId,
  })
  useEffect(() => {
    if (!sourceDoc) return
    setType(sourceDoc.type as DocumentType)
    setTitle(`${sourceDoc.title} (copy)`)
    setAssigneeId(sourceDoc.assigneeId)
  }, [sourceDoc])

  const { data: users = [] } = useQuery<PlatformUser[]>({
    queryKey: ['platform-users'],
    queryFn:  () => platformApi.listUsers(),
  })

  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn:  () => projectsApi.get(projectId!),
    enabled:  !!projectId,
  })

  // Narrow the assignee list to writer-ish roles. Admins can create too
  // but typically aren't the ones holding the pen on a document.
  const assigneeOptions = useMemo(
    () => users.filter(u => ['clinical-writer', 'scientific-writer', 'medical-writer', 'regulatory-writer', 'admin'].includes(u.role)),
    [users],
  )

  const create = useMutation({
    mutationFn: () => {
      if (!projectId) throw new Error('projectId missing from route params')
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
      navigate(`/projects/${projectId}/clinical-writing/documents/${(doc as { id: string }).id}`)
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
    <div className="flex h-full flex-col bg-slate-50" data-screen="new-document">
      <div className="border-b border-slate-200 bg-white px-8 py-6">
        <nav className="flex items-center gap-2 text-xs text-slate-500">
          <button onClick={() => navigate(`/projects/${projectId}/clinical-writing`)} className="hover:text-slate-900">
            Clinical Writing
          </button>
          <span style={{ color: '#CBD5E1' }}>&gt;</span>
          <span className="font-semibold text-slate-900">New document</span>
        </nav>
        <div className="mt-2 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-[22px] font-bold text-slate-900">New document</h1>
            <p className="mt-1 text-[13px] text-slate-500">
              {project ? <>Create a new document in <span className="font-mono">{project.shortTitle}</span></> : 'Create a new document for this project.'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => navigate(`/projects/${projectId}/clinical-writing`)}
            className="rounded-md border border-slate-300 bg-white px-4 py-2 text-[13px] font-semibold text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
        </div>
      </div>

      <form
        onSubmit={e => {
          e.preventDefault()
          if (!canSubmit) return
          create.mutate()
        }}
        className="mx-auto w-full max-w-3xl flex-1 overflow-auto p-8"
      >
        <div className="rounded-lg border border-slate-200 bg-white p-6">
          <h2 className="text-[14px] font-semibold text-slate-900">Document type</h2>
          <p className="mt-1 text-[12px] text-slate-500">Determines the ICH E3 section template + framework checks applied.</p>
          <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
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
        </div>

        <div className="mt-4 rounded-lg border border-slate-200 bg-white p-6">
          <h2 className="text-[14px] font-semibold text-slate-900">Details</h2>
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
                  <option key={u.id} value={u.id}>
                    {u.name} ({u.role})
                  </option>
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
        </div>

        {errorMsg && (
          <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700" role="alert">
            {errorMsg}
          </div>
        )}

        <div className="mt-6 flex items-center justify-end gap-2">
          <button type="button" onClick={() => navigate(`/projects/${projectId}/clinical-writing`)}
            className="rounded-md border border-slate-300 bg-white px-4 py-2 text-[13px] font-semibold text-slate-700 hover:bg-slate-50">
            Cancel
          </button>
          <button type="submit" disabled={!canSubmit}
            className="rounded-md bg-blue-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300">
            {create.isPending ? 'Creating…' : 'Create document'}
          </button>
        </div>
      </form>
    </div>
  )
}
