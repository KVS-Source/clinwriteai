// Upload source document form — rendered inside a SlidePanel from
// ClinicalWritingHome. A source document is evidence (protocol, SAP, TLF, lab
// export, anything from another system), NOT an authored document: this flow
// only stores the file in the project's source library. Documents are written
// from sources later, via New Document → "Based on source documents".
//
// Three progressive states:
//   1. dropzone  — before any file is selected
//   2. uploading — bytes transferring + category suggestion running
//   3. review    — suggestion shown; user can edit and "Save to library"
//
// API: POST /projects/:id/documents/upload                  (multipart)
//      POST /projects/:id/source-documents/:uploadId/save
//
// The category suggestion is a filename heuristic in dev (`stub: true`); the
// panel surfaces that so reviewers know to double-check the fields.

import { SOURCE_FILE_ACCEPT, SOURCE_FILE_ERROR, SOURCE_FILE_EXT_RE, SOURCE_FILE_HINT } from '../../utils/sourceFileTypes'
import { SOURCE_CATEGORIES } from '../../utils/sourceCategories'
import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { documentsApi } from '../../api'
import { ApiError } from '../../api/client'

interface Props {
  projectId:   string
  onSaved?:    (uploadId: string) => void
  onCancel?:   () => void
}

const MAX_BYTES = 50 * 1024 * 1024
const ACCEPT_MIME = SOURCE_FILE_ACCEPT
const ACCEPT_EXT_RE = SOURCE_FILE_EXT_RE

interface Classification {
  sourceCategory:           string
  sourceCategoryConfidence: number
  version:                  string
  versionConfidence:        number
  stub:                     boolean
}

interface UploadResponse {
  uploadId:          string
  fileName:          string
  fileSizeMB:        number
  virusScanStatus:   string
  classification:    Classification
}

function confidenceColour(pct: number) {
  if (pct >= 80) return { bg: '#DCFCE7', fg: '#166534' }
  if (pct >= 50) return { bg: '#FEF3C7', fg: '#92400E' }
  return { bg: '#FEE2E2', fg: '#991B1B' }
}

export function UploadDocumentForm({ projectId, onSaved, onCancel }: Props) {
  const qc = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const [file,      setFile]      = useState<File | null>(null)
  const [progress,  setProgress]  = useState(0)
  const [upload,    setUpload]    = useState<UploadResponse | null>(null)
  const [uploadErr, setUploadErr] = useState<string | null>(null)
  const [isDragging,setIsDragging]= useState(false)

  // Review-state form fields. Initialised when upload resolves.
  const [category,  setCategory]  = useState('other')
  const [title,     setTitle]     = useState('')
  const [origin,    setOrigin]    = useState('')
  const [version,   setVersion]   = useState('')
  const [touched,   setTouched]   = useState<Set<string>>(new Set())

  const markTouched = (field: string) => setTouched(s => (s.has(field) ? s : new Set(s).add(field)))

  const beginUpload = (f: File) => {
    if (!(ACCEPT_EXT_RE.test(f.name))) {
      setUploadErr(SOURCE_FILE_ERROR)
      return
    }
    if (f.size > MAX_BYTES) {
      setUploadErr(`File is too large (${(f.size / 1024 / 1024).toFixed(1)} MB). Maximum is 50 MB.`)
      return
    }
    setUploadErr(null)
    setFile(f)
    setProgress(0)

    // XHR for progress events — fetch() doesn't surface upload progress.
    const xhr = new XMLHttpRequest()
    const url = `${import.meta.env.VITE_API_URL}/projects/${projectId}/documents/upload`
    xhr.open('POST', url)
    xhr.withCredentials = true
    xhr.upload.addEventListener('progress', e => {
      if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100))
    })
    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const resp = JSON.parse(xhr.responseText) as UploadResponse
          setUpload(resp)
          // Pre-fill review state from the suggestion
          const c = resp.classification
          setCategory(SOURCE_CATEGORIES.some(o => o.value === c.sourceCategory) ? c.sourceCategory : 'other')
          setTitle(f.name.replace(/\.[^.]+$/, ''))
          setVersion(c.versionConfidence >= 50 ? c.version : '')
          setOrigin('')
          setTouched(new Set())
        } catch {
          setUploadErr('Unexpected response from upload endpoint.')
          setFile(null)
        }
      } else {
        let msg: string
        try {
          const j = JSON.parse(xhr.responseText) as { error?: string; message?: string }
          msg = j.message || j.error || `Upload failed (HTTP ${xhr.status})`
        } catch {
          msg = `Upload failed (HTTP ${xhr.status})`
        }
        setUploadErr(msg)
        setFile(null)
      }
    })
    xhr.addEventListener('error', () => {
      setUploadErr('Network error during upload.')
      setFile(null)
    })

    const form = new FormData()
    form.append('file', f, f.name)
    xhr.send(form)
  }

  const save = useMutation({
    mutationFn: () => {
      if (!upload) throw new Error('no_upload')
      return documentsApi.saveSource(projectId, upload.uploadId, {
        title:     title.trim(),
        category,
        origin:    origin.trim() || undefined,
        version:   version.trim() || undefined,
        overrides: Array.from(touched),
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['source-documents', projectId] })
      onSaved?.(upload!.uploadId)
    },
  })

  const saveError = save.isError
    ? save.error instanceof ApiError
      ? save.error.status === 503 ? 'Clinical Writing (Module A) is not enabled on this deployment.'
      : save.error.status === 403 ? 'You do not have permission to add source documents to this project.'
      : `Could not save (HTTP ${save.error.status}).`
      : 'Could not save — see console for details.'
    : null

  const canSave = !!upload && title.trim().length > 0 && !save.isPending

  // State 1 — nothing uploaded yet
  if (!file) {
    return (
      <div className="flex flex-col gap-4 p-5" data-form="upload-document">
        <section className="rounded-lg border border-slate-200 bg-slate-50 p-5">
          <h3 className="text-[13px] font-semibold text-slate-900">Upload source document</h3>
          <p className="mt-0.5 text-[12px] text-slate-500">
            Add evidence to this project's source library — a protocol, SAP, TLF output, lab export, or a file from another system.
            Documents are written from these later; uploading does not create a document.
          </p>
        </section>

        <div
          role="button"
          tabIndex={0}
          onDragOver={e => { e.preventDefault(); setIsDragging(true) }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={e => {
            e.preventDefault()
            setIsDragging(false)
            const f = e.dataTransfer.files?.[0]
            if (f) beginUpload(f)
          }}
          onClick={() => fileInputRef.current?.click()}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInputRef.current?.click() }
          }}
          className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-10 transition-colors"
          style={{
            borderColor:     isDragging ? '#2563EB' : '#CBD5E1',
            backgroundColor: isDragging ? '#EFF6FF' : '#FFFFFF',
          }}
        >
          <UploadIcon />
          <div className="text-center">
            <p className="text-[14px] font-semibold text-slate-900">Drop a file here</p>
            <p className="mt-1 text-[12px] text-slate-500">or click to browse — {SOURCE_FILE_HINT} · up to 50 MB</p>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPT_MIME}
            onChange={e => {
              const f = e.currentTarget.files?.[0]
              if (f) beginUpload(f)
              e.currentTarget.value = ''
            }}
            className="hidden"
          />
        </div>

        {uploadErr && (
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700" role="alert">
            {uploadErr}
          </div>
        )}

        <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-slate-200 bg-white px-5 py-3 -mx-5 -mb-5">
          <button type="button" onClick={onCancel}
            className="rounded-md border border-slate-300 bg-white px-4 py-2 text-[13px] font-semibold text-slate-700 hover:bg-slate-50">
            Cancel
          </button>
        </div>
      </div>
    )
  }

  // State 2 — uploading / classifying
  if (!upload) {
    return (
      <div className="flex flex-col gap-4 p-5" data-form="upload-document">
        <section className="rounded-lg border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <p className="truncate text-[13px] font-semibold text-slate-900">{file.name}</p>
              <p className="text-[11px] text-slate-500">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
            </div>
            <span className="rounded-full px-2 py-0.5 font-mono text-[11px] font-semibold text-blue-700" style={{ backgroundColor: '#EFF6FF' }}>
              {progress < 100 ? 'Uploading…' : 'Classifying…'}
            </span>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full transition-all duration-200"
              style={{ width: `${progress}%`, backgroundColor: '#2563EB' }}
            />
          </div>
          <p className="mt-2 text-[11px] text-slate-500">{progress}% · do not close this panel</p>
        </section>

        <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-slate-200 bg-white px-5 py-3 -mx-5 -mb-5">
          <button type="button" onClick={onCancel}
            className="rounded-md border border-slate-300 bg-white px-4 py-2 text-[13px] font-semibold text-slate-700 hover:bg-slate-50">
            Cancel
          </button>
        </div>
      </div>
    )
  }

  // State 3 — review + save to library
  const catConf = upload.classification.sourceCategoryConfidence
  const versionConf = upload.classification.versionConfidence

  return (
    <form
      onSubmit={e => {
        e.preventDefault()
        if (!canSave) return
        save.mutate()
      }}
      className="flex flex-col gap-4 p-5"
      data-form="upload-document-review"
    >
      {upload.classification.stub && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] text-amber-800" role="status">
          <strong>Suggestions are filename-based guesses.</strong> Review the category before saving.
        </div>
      )}

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <p className="truncate text-[13px] font-semibold text-slate-900">{upload.fileName}</p>
        <p className="text-[11px] text-slate-500">
          {upload.fileSizeMB} MB · virus scan {upload.virusScanStatus}
        </p>
      </section>

      <section className="rounded-lg border border-slate-200 bg-slate-50 p-4">
        <h3 className="text-[13px] font-semibold text-slate-900">Source details</h3>
        <div className="mt-3 flex flex-col gap-3">
          <FieldLabel label="Category *" conf={catConf} touched={touched.has('category')}>
            <select
              value={category}
              onChange={e => { setCategory(e.currentTarget.value); markTouched('category') }}
              required
              data-source-category
              className="h-9 w-full rounded-md border border-slate-300 px-3 text-[13px]"
            >
              {SOURCE_CATEGORIES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </FieldLabel>

          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Title *</span>
            <input
              value={title}
              onChange={e => { setTitle(e.currentTarget.value); markTouched('title') }}
              required
              className="h-9 w-full rounded-md border border-slate-300 px-3 text-[13px]"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Origin / system</span>
            <input
              value={origin}
              onChange={e => { setOrigin(e.currentTarget.value); markTouched('origin') }}
              placeholder="e.g. Sponsor, EDC, SAS output, CRO"
              className="h-9 w-full rounded-md border border-slate-300 px-3 text-[13px]"
            />
          </label>

          <FieldLabel label="Version" conf={versionConf} touched={touched.has('version')}>
            <input
              value={version}
              onChange={e => { setVersion(e.currentTarget.value); markTouched('version') }}
              placeholder="v1.0 (optional)"
              className="h-9 w-full rounded-md border border-slate-300 px-3 text-[13px]"
            />
          </FieldLabel>
        </div>
      </section>

      {saveError && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700" role="alert">
          {saveError}
        </div>
      )}

      <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-slate-200 bg-white px-5 py-3 -mx-5 -mb-5">
        <button type="button" onClick={onCancel}
          className="rounded-md border border-slate-300 bg-white px-4 py-2 text-[13px] font-semibold text-slate-700 hover:bg-slate-50">
          Cancel upload
        </button>
        <button type="submit" disabled={!canSave}
          className="rounded-md bg-blue-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300">
          {save.isPending ? 'Saving…' : 'Save to library'}
        </button>
      </div>
    </form>
  )
}

// ---- Small presentational helpers ----

function FieldLabel({ label, conf, touched, children }: {
  label:   string
  conf:    number
  touched: boolean
  children: React.ReactNode
}) {
  return (
    <label className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</span>
        <div className="flex items-center gap-1.5">
          <AiChip touched={touched} />
          {conf > 0 && <ConfidenceBadge pct={conf} />}
        </div>
      </div>
      {children}
    </label>
  )
}

function ConfidenceBadge({ pct, label }: { pct: number; label?: string }) {
  const { bg, fg } = confidenceColour(pct)
  return (
    <span className="rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold" style={{ backgroundColor: bg, color: fg }}>
      {label ?? `${pct}%`}
    </span>
  )
}

function AiChip({ touched }: { touched: boolean }) {
  if (touched) {
    return (
      <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: '#F1F5F9', color: '#475569' }}>
        edited
      </span>
    )
  }
  return (
    <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: '#EFF6FF', color: '#2563EB' }}>
      AI pick
    </span>
  )
}

function UploadIcon() {
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-slate-400">
      <path d="M20 26V8M20 8l-6 6M20 8l6 6" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M6 24v6a2 2 0 0 0 2 2h24a2 2 0 0 0 2-2v-6" strokeLinecap="round"/>
    </svg>
  )
}
