// Upload Med-Content form — rendered inside a SlidePanel from
// MedicalWritingHome. Three progressive states (dropzone → uploading →
// review+confirm), mirroring the Clinical Writing UploadDocument shape.
//
// API: POST /projects/:id/med-content/upload          (multipart)
//      POST /projects/:id/med-content/confirm-classification
// Both live in apps/api/src/modules/medical-writing/content/upload-routes.ts.
//
// Classifier is a filename-heuristic stub in dev; `stub: true` surfaces an
// amber banner so reviewers know to double-check every field.

import { THERAPEUTIC_AREA_LABEL } from '../../utils/labels'
import { SOURCE_FILE_ACCEPT, SOURCE_FILE_ERROR, SOURCE_FILE_EXT_RE, SOURCE_FILE_HINT } from '../../utils/sourceFileTypes'
import { useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { MedContentType, PlatformUser } from '@platform/types'
import { ApiError } from '../../api/client'
import { medContentApi } from '../../modules/medical-writing/api/medContent'
import { platformApi } from '../../platform/api/platformApi'

interface Props {
  projectId:  string
  projectTA?: string
  onCreated?: (contentId: string) => void
  onCancel?:  () => void
}

// Classifier returns snake_case; UI uses hyphen-case for MedContentType.
const CLASSIFIER_TO_UI: Record<string, MedContentType> = {
  hcp_slide_deck:  'hcp-slide-deck',
  mi_letter:       'mi-letter',
  pil:             'pil',
  cme_module:      'cme-module',
  disease_dossier: 'disease-dossier',
  eu_ctr_pls:      'eu-ctr-pls',
  advisory_report: 'advisory-report',
}

const TYPE_OPTIONS: { value: MedContentType; label: string }[] = [
  { value: 'hcp-slide-deck',  label: 'HCP Slide Deck' },
  { value: 'mi-letter',       label: 'MI Letter' },
  { value: 'pil',             label: 'PIL' },
  { value: 'cme-module',      label: 'CME Module' },
  { value: 'disease-dossier', label: 'Disease Dossier' },
  { value: 'eu-ctr-pls',      label: 'EU CTR PLS' },
  { value: 'advisory-report', label: 'Advisory Report' },
]

const TRACK_OPTIONS: { value: string; label: string }[] = [
  { value: 'promotional',     label: 'MLR Track (Promotional)' },
  { value: 'non_promotional', label: 'MLR Track (Non-Promotional)' },
  { value: 'cme',             label: 'ACCME / CME Track' },
  { value: 'advisory',        label: 'Advisory Track' },
]

const MAX_BYTES = 50 * 1024 * 1024
const ACCEPT_MIME = SOURCE_FILE_ACCEPT
const ACCEPT_EXT_RE = SOURCE_FILE_EXT_RE

interface Classification {
  documentType:       string
  typeConfidence:     number
  studyTitle:         string
  studyConfidence:    number
  version:            string
  versionConfidence:  number
  therapeuticArea:    string
  taConfidence:       number
  frameworks:         string[]
  stub:               boolean
}

interface UploadResponse {
  uploadId:        string
  fileName:        string
  fileSizeMB:      number
  virusScanStatus: string
  classification:  Classification
}

function confidenceColour(pct: number) {
  if (pct >= 80) return { bg: '#DCFCE7', fg: '#166534' }
  if (pct >= 50) return { bg: '#FEF3C7', fg: '#92400E' }
  return { bg: '#FEE2E2', fg: '#991B1B' }
}

export function UploadMedContent({ projectId, projectTA, onCreated, onCancel }: Props) {
  const qc = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const [file,       setFile]       = useState<File | null>(null)
  const [progress,   setProgress]   = useState(0)
  const [upload,     setUpload]     = useState<UploadResponse | null>(null)
  const [uploadErr,  setUploadErr]  = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)

  const [docType,  setDocType]  = useState<MedContentType>('hcp-slide-deck')
  const [title,    setTitle]    = useState('')
  const [version,  setVersion]  = useState('v0.1')
  const [ta,       setTa]       = useState('')
  const [track,    setTrack]    = useState<string>('promotional')
  const [owner,    setOwner]    = useState('')
  const [touched,  setTouched]  = useState<Set<string>>(new Set())

  const { data: users = [] } = useQuery<PlatformUser[]>({
    queryKey: ['platform-users'],
    queryFn:  () => platformApi.listUsers(),
    enabled:  !!upload,
  })

  const ownerOptions = useMemo(
    () => users.filter(u => ['medical-writer', 'scientific-writer', 'clinical-writer', 'admin'].includes(u.role)),
    [users],
  )

  const markTouched = (f: string) => setTouched(s => (s.has(f) ? s : new Set(s).add(f)))

  const beginUpload = (f: File) => {
    if (!ACCEPT_EXT_RE.test(f.name)) {
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

    const xhr = new XMLHttpRequest()
    const url = `${import.meta.env.VITE_API_URL}/projects/${projectId}/med-content/upload`
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
          const uiType = CLASSIFIER_TO_UI[resp.classification.documentType] ?? 'hcp-slide-deck'
          setDocType(uiType)
          setTitle(resp.classification.studyTitle === '(unidentified — human review)' ? '' : resp.classification.studyTitle)
          setVersion(resp.classification.version)
          setTa(resp.classification.therapeuticArea === '(inherit from project)' ? (projectTA ?? '') : resp.classification.therapeuticArea)
          // CME-detected files default to ACCME track; everything else MLR promotional.
          setTrack(uiType === 'cme-module' ? 'cme' : 'promotional')
          setOwner('')
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

  const confirm = useMutation({
    mutationFn: () => {
      if (!upload) throw new Error('no_upload')
      return medContentApi.confirmClassification(projectId, {
        uploadId:        upload.uploadId,
        documentType:    docType,
        title:           title.trim(),
        version:         version.trim(),
        therapeuticArea: ta.trim(),
        complianceTrack: track,
        ownerId:         owner || undefined,
        channels:        [],
        targetAudience:  [],
        overrides:       Array.from(touched),
      })
    },
    onSuccess: (item) => {
      qc.invalidateQueries({ queryKey: ['medContent', projectId] })
      onCreated?.((item as { id: string }).id)
    },
  })

  const confirmError = confirm.isError
    ? confirm.error instanceof ApiError
      ? confirm.error.status === 503 ? 'Medical Writing (Module C) is not enabled on this deployment.'
      : confirm.error.status === 403 ? 'You do not have permission to create content in this project.'
      : `Could not confirm (HTTP ${confirm.error.status}).`
      : 'Could not confirm — see console for details.'
    : null

  const canConfirm = !!upload
    && title.trim().length > 0
    && version.trim().length > 0
    && ta.trim().length > 0
    && !confirm.isPending

  if (!file) {
    return (
      <div className="flex flex-col gap-4 p-5" data-form="upload-med-content">
        <section className="rounded-lg border border-slate-200 bg-slate-50 p-5">
          <h3 className="text-[13px] font-semibold text-slate-900">Upload existing content</h3>
          <p className="mt-0.5 text-[12px] text-slate-500">
            Drop a PDF, Word, PowerPoint, Excel, or image file. We&rsquo;ll auto-classify the content type, version, and compliance track so you only need to confirm.
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
            borderColor:     isDragging ? '#7C3AED' : '#CBD5E1',
            backgroundColor: isDragging ? '#F5F3FF' : '#FFFFFF',
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

  if (!upload) {
    return (
      <div className="flex flex-col gap-4 p-5" data-form="upload-med-content">
        <section className="rounded-lg border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <p className="truncate text-[13px] font-semibold text-slate-900">{file.name}</p>
              <p className="text-[11px] text-slate-500">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
            </div>
            <span className="rounded-full px-2 py-0.5 font-mono text-[11px] font-semibold"
              style={{ backgroundColor: '#F5F3FF', color: '#6D28D9' }}>
              {progress < 100 ? 'Uploading…' : 'Classifying…'}
            </span>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full transition-all duration-200"
              style={{ width: `${progress}%`, backgroundColor: '#7C3AED' }} />
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

  const typeConf    = upload.classification.typeConfidence
  const titleConf   = upload.classification.studyConfidence
  const versionConf = upload.classification.versionConfidence
  const taConf      = upload.classification.taConfidence

  return (
    <form
      onSubmit={e => {
        e.preventDefault()
        if (!canConfirm) return
        confirm.mutate()
      }}
      className="flex flex-col gap-4 p-5"
      data-form="upload-med-content-review"
    >
      {upload.classification.stub && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] text-amber-800" role="status">
          <strong>Classifier is in stub mode.</strong> Fields below are filename-based guesses — review each before confirming.
        </div>
      )}

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-[13px] font-semibold text-slate-900">{upload.fileName}</p>
            <p className="text-[11px] text-slate-500">
              {upload.fileSizeMB} MB · virus scan {upload.virusScanStatus}
            </p>
          </div>
          <ConfidenceBadge pct={typeConf} label={`type ${typeConf}%`} />
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-slate-50 p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-[13px] font-semibold text-slate-900">Content type</h3>
          <AiChip touched={touched.has('documentType')} />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {TYPE_OPTIONS.map(t => (
            <label key={t.value}
              className={`flex cursor-pointer items-center gap-2 rounded-md border p-2.5 ${
                docType === t.value ? 'border-violet-500 bg-violet-50' : 'border-slate-200 bg-white hover:border-slate-300'
              }`}>
              <input type="radio" name="docType" value={t.value} checked={docType === t.value}
                onChange={() => { setDocType(t.value); markTouched('documentType') }} />
              <span className="text-[12px] font-semibold text-slate-900">{t.label}</span>
            </label>
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-slate-50 p-4">
        <h3 className="text-[13px] font-semibold text-slate-900">Details</h3>
        <div className="mt-3 flex flex-col gap-3">
          <FieldLabel label="Title *" conf={titleConf} touched={touched.has('title')}>
            <input value={title} onChange={e => { setTitle(e.currentTarget.value); markTouched('title') }} required
              placeholder="Veloricept HCP Slide Deck v0.3"
              className="h-9 w-full rounded-md border border-slate-300 px-3 text-[13px]" />
          </FieldLabel>

          <FieldLabel label="Version *" conf={versionConf} touched={touched.has('version')}>
            <input value={version} onChange={e => { setVersion(e.currentTarget.value); markTouched('version') }} required
              placeholder="v0.1"
              className="h-9 w-full rounded-md border border-slate-300 px-3 text-[13px]" />
          </FieldLabel>

          <FieldLabel label={`${THERAPEUTIC_AREA_LABEL} *`} conf={taConf} touched={touched.has('therapeuticArea')}>
            <input value={ta} onChange={e => { setTa(e.currentTarget.value); markTouched('therapeuticArea') }} required
              placeholder="Oncology"
              className="h-9 w-full rounded-md border border-slate-300 px-3 text-[13px]" />
          </FieldLabel>

          <label className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Compliance track</span>
              <AiChip touched={touched.has('complianceTrack')} />
            </div>
            <select value={track}
              onChange={e => { setTrack(e.currentTarget.value); markTouched('complianceTrack') }}
              className="h-9 rounded-md border border-slate-300 px-3 text-[13px]">
              {TRACK_OPTIONS.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Owner (writer)</span>
            <select value={owner}
              onChange={e => { setOwner(e.currentTarget.value); markTouched('ownerId') }}
              className="h-9 rounded-md border border-slate-300 px-3 text-[13px]">
              <option value="">You (default — reassign later)</option>
              {ownerOptions.map(u => (
                <option key={u.id} value={u.id}>{u.name} ({u.role})</option>
              ))}
            </select>
          </label>

          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Frameworks applied</span>
            <div className="flex flex-wrap gap-1.5">
              {upload.classification.frameworks.map(f => (
                <span key={f} className="rounded-full px-2.5 py-0.5 font-mono text-[11px] text-slate-700"
                  style={{ backgroundColor: '#F1F5F9' }}>
                  {f}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {confirmError && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700" role="alert">
          {confirmError}
        </div>
      )}

      <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-slate-200 bg-white px-5 py-3 -mx-5 -mb-5">
        <button type="button" onClick={onCancel}
          className="rounded-md border border-slate-300 bg-white px-4 py-2 text-[13px] font-semibold text-slate-700 hover:bg-slate-50">
          Cancel upload
        </button>
        <button type="submit" disabled={!canConfirm}
          className="rounded-md px-4 py-2 text-[13px] font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
          style={{ backgroundColor: canConfirm ? '#7C3AED' : undefined }}>
          {confirm.isPending ? 'Creating…' : 'Confirm & create content item'}
        </button>
      </div>
    </form>
  )
}

// ---- Small presentational helpers ----

function FieldLabel({ label, conf, touched, children }: {
  label: string; conf: number; touched: boolean; children: React.ReactNode
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
    <span className="rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold"
      style={{ backgroundColor: bg, color: fg }}>
      {label ?? `${pct}%`}
    </span>
  )
}

function AiChip({ touched }: { touched: boolean }) {
  if (touched) {
    return (
      <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
        style={{ backgroundColor: '#F1F5F9', color: '#475569' }}>
        edited
      </span>
    )
  }
  return (
    <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
      style={{ backgroundColor: '#F5F3FF', color: '#7C3AED' }}>
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
