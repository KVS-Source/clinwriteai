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
// The API suggests the category and version with AI from the file's contents, and
// nothing is kept until the user confirms with "Save to library". When the AI can't
// answer the suggestion is a filename guess (`stub: true`), and the panel says so.

import { SOURCE_FILE_ACCEPT, SOURCE_FILE_ERROR, SOURCE_FILE_EXT_RE, SOURCE_FILE_HINT } from '../../utils/sourceFileTypes'
import { SOURCE_CATEGORIES } from '../../utils/sourceCategories'
import { useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { documentsApi } from '../../api'
import { ApiError } from '../../api/client'

interface Props {
  projectId:   string
  onSaved?:    (uploadId: string) => void
  onCancel?:   () => void
  // The upload that is stored but not yet saved to the library (null once saved / none).
  // The parent discards it if the panel is closed without "Save to library".
  onPendingChange?: (uploadId: string | null) => void
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
  versionSource?:           'ai' | 'filename'
  /** What in the file led the AI to this category. */
  reason?:                  string
  /** Why the suggestion is a filename guess. */
  fallbackReason?:          'unreadable' | 'ai_unavailable'
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

export function UploadDocumentForm({ projectId, onSaved, onCancel, onPendingChange }: Props) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const xhrRef = useRef<XMLHttpRequest | null>(null)
  // Closing the panel mid-transfer stops the upload
  useEffect(() => () => xhrRef.current?.abort(), [])

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
      setUploadErr(t('page.upload_document.file_too_large', { sizeMB: (f.size / 1024 / 1024).toFixed(1) }))
      return
    }
    setUploadErr(null)
    setFile(f)
    setProgress(0)

    // XHR for progress events — fetch() doesn't surface upload progress.
    const xhr = new XMLHttpRequest()
    xhrRef.current = xhr
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
          onPendingChange?.(resp.uploadId)
          // Pre-fill review state from the suggestion
          const c = resp.classification
          setCategory(SOURCE_CATEGORIES.some(o => o.value === c.sourceCategory) ? c.sourceCategory : 'other')
          setTitle(f.name.replace(/\.[^.]+$/, ''))
          setVersion(c.versionConfidence >= 50 ? c.version : '')
          setOrigin('')
          setTouched(new Set())
        } catch {
          setUploadErr(t('page.upload_document.unexpected_response'))
          setFile(null)
        }
      } else {
        let msg: string
        try {
          const j = JSON.parse(xhr.responseText) as { error?: string; message?: string }
          msg = j.message || j.error || t('page.upload_document.upload_failed_http', { status: xhr.status })
        } catch {
          msg = t('page.upload_document.upload_failed_http', { status: xhr.status })
        }
        setUploadErr(msg)
        setFile(null)
      }
    })
    xhr.addEventListener('error', () => {
      setUploadErr(t('page.upload_document.network_error'))
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
      onPendingChange?.(null)
      qc.invalidateQueries({ queryKey: ['source-documents', projectId] })
      onSaved?.(upload!.uploadId)
    },
  })

  const saveError = save.isError
    ? save.error instanceof ApiError
      ? save.error.status === 503 ? t('page.upload_document.save_err_disabled')
      : save.error.status === 403 ? t('page.upload_document.save_err_forbidden')
      : t('page.upload_document.save_err_http', { status: save.error.status })
      : t('page.upload_document.save_err_generic')
    : null

  const canSave = !!upload && title.trim().length > 0 && !save.isPending

  // State 1 — nothing uploaded yet
  if (!file) {
    return (
      <div className="flex flex-col gap-4 p-5" data-form="upload-document">
        <section className="rounded-lg border border-slate-200 bg-slate-50 p-5">
          <h3 className="text-[13px] font-semibold text-slate-900">{t('page.upload_document.heading')}</h3>
          <p className="mt-0.5 text-[12px] text-slate-500">
            {t('page.upload_document.intro')}
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
            <p className="text-[14px] font-semibold text-slate-900">{t('page.upload_document.drop_file')}</p>
            <p className="mt-1 text-[12px] text-slate-500">{t('page.upload_document.or_click_to_browse', { hint: SOURCE_FILE_HINT })}</p>
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
            {t('page.upload_document.cancel')}
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
              {progress < 100 ? t('page.upload_document.uploading') : t('page.upload_document.classifying')}
            </span>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full transition-all duration-200"
              style={{ width: `${progress}%`, backgroundColor: '#2563EB' }}
            />
          </div>
          <p className="mt-2 text-[11px] text-slate-500">{t('page.upload_document.progress_hint', { pct: progress })}</p>
        </section>

        <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-slate-200 bg-white px-5 py-3 -mx-5 -mb-5">
          <button type="button" onClick={onCancel}
            className="rounded-md border border-slate-300 bg-white px-4 py-2 text-[13px] font-semibold text-slate-700 hover:bg-slate-50">
            {t('page.upload_document.cancel')}
          </button>
        </div>
      </div>
    )
  }

  // State 3 — review + save to library
  const { stub, reason, fallbackReason } = upload.classification
  const versionByAi = !stub && upload.classification.versionSource !== 'filename'
  // A filename guess has no real confidence, so it shows none.
  const catConf = stub ? 0 : upload.classification.sourceCategoryConfidence
  const versionConf = versionByAi ? upload.classification.versionConfidence : 0

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
      {stub ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] text-amber-800" role="status" data-classification-note="filename">
          <strong>{t('page.upload_document.stub_warning_bold')}</strong>{' '}
          {fallbackReason === 'unreadable' ? t('page.upload_document.stub_unreadable') : t('page.upload_document.stub_ai_unavailable')}
        </div>
      ) : (
        <div className="rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-[12px] text-blue-900" role="status" data-classification-note="ai">
          {t('page.upload_document.ai_suggestion_note')}
        </div>
      )}

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <p className="truncate text-[13px] font-semibold text-slate-900">{upload.fileName}</p>
        <p className="text-[11px] text-slate-500">
          {t('page.upload_document.file_meta', { sizeMB: upload.fileSizeMB, scan: upload.virusScanStatus })}
        </p>
      </section>

      <section className="rounded-lg border border-slate-200 bg-slate-50 p-4">
        <h3 className="text-[13px] font-semibold text-slate-900">{t('page.upload_document.source_details')}</h3>
        <div className="mt-3 flex flex-col gap-3">
          <FieldLabel label={t('page.upload_document.category_label')} conf={catConf} touched={touched.has('category')} byAi={!stub}>
            <select
              value={category}
              onChange={e => { setCategory(e.currentTarget.value); markTouched('category') }}
              required
              data-source-category
              className="h-9 w-full rounded-md border border-slate-300 px-3 text-[13px]"
            >
              {SOURCE_CATEGORIES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            {!stub && reason && !touched.has('category') && (
              <span className="text-[11px] text-slate-500" data-classification-reason>{reason}</span>
            )}
          </FieldLabel>

          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{t('page.upload_document.title_label')}</span>
            <input
              value={title}
              onChange={e => { setTitle(e.currentTarget.value); markTouched('title') }}
              required
              className="h-9 w-full rounded-md border border-slate-300 px-3 text-[13px]"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{t('page.upload_document.origin_label')}</span>
            <input
              value={origin}
              onChange={e => { setOrigin(e.currentTarget.value); markTouched('origin') }}
              placeholder={t('page.upload_document.origin_placeholder')}
              className="h-9 w-full rounded-md border border-slate-300 px-3 text-[13px]"
            />
          </label>

          <FieldLabel label={t('page.upload_document.version_label')} conf={versionConf} touched={touched.has('version')} byAi={versionByAi}>
            <input
              value={version}
              onChange={e => { setVersion(e.currentTarget.value); markTouched('version') }}
              placeholder={t('page.upload_document.version_placeholder')}
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
          {t('page.upload_document.cancel_upload')}
        </button>
        <button type="submit" disabled={!canSave}
          className="rounded-md bg-blue-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300">
          {save.isPending ? t('page.upload_document.saving') : t('page.upload_document.save_to_library')}
        </button>
      </div>
    </form>
  )
}

// ---- Small presentational helpers ----

function FieldLabel({ label, conf, touched, byAi, children }: {
  label:   string
  conf:    number
  touched: boolean
  byAi:    boolean
  children: React.ReactNode
}) {
  return (
    <label className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</span>
        <div className="flex items-center gap-1.5">
          <AiChip touched={touched} byAi={byAi} />
          {conf > 0 && !touched && <ConfidenceBadge pct={conf} />}
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

function AiChip({ touched, byAi }: { touched: boolean; byAi: boolean }) {
  const { t } = useTranslation()
  if (touched || !byAi) {
    return (
      <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: '#F1F5F9', color: '#475569' }}>
        {touched ? t('page.upload_document.edited_chip') : t('page.upload_document.from_filename_chip')}
      </span>
    )
  }
  return (
    <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: '#EFF6FF', color: '#2563EB' }}>
      {t('page.upload_document.ai_pick_chip')}
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
