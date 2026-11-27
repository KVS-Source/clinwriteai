// Upload source document form — rendered inside a SlidePanel from
// ClinicalWritingHome. A source document is evidence (protocol, SAP, TLF, lab
// export, anything from another system), NOT an authored document: this flow
// only stores the file in the project's source library. Documents are written
// from sources later, via New Document → "Based on source documents".
//
// Three progressive states:
//   1. dropzone  — before any file is selected (one or several at once)
//   2. uploading — bytes transferring + category suggestion running
//   3. review    — suggestion shown; user can edit and "Save to library"
//
// Several files become one card each, uploaded one after another, and are saved together.
//
// API: POST /projects/:id/documents/upload                  (multipart, one file per call)
//      POST /projects/:id/source-documents/:uploadId/save
//
// The API suggests the category and version with AI from the file's contents, and
// nothing is kept until the user confirms with "Save to library". When the AI can't
// answer the suggestion is a filename guess (`stub: true`), and the panel says so.

import { SOURCE_FILE_ACCEPT, SOURCE_FILE_ERROR, SOURCE_FILE_EXT_RE, SOURCE_FILE_HINT } from '../../utils/sourceFileTypes'
import { SOURCE_CATEGORIES } from '../../utils/sourceCategories'
import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { documentsApi } from '../../api'
import { ApiError, identityHeaders } from '../../api/client'

interface Props {
  projectId:   string
  /** Every file was saved: their upload ids. */
  onSaved?:    (uploadIds: string[]) => void
  onCancel?:   () => void
  // The uploads that are stored but not yet saved to the library.
  // The parent discards them if the panel is closed without "Save to library".
  onPendingChange?: (uploadIds: string[]) => void
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
  /** Can the AI drafter read the file (API source-inspect.ts). */
  inspection?:              { usable: boolean; problem: string | null }
  /** Looks like a sample, template or mock-up, not a real study document. */
  looksLikeExample?:        boolean
  exampleReason?:           string | null
  /** The same file is already in the library. */
  duplicateOf?:             { id: string; title: string } | null
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

type ItemStatus = 'queued' | 'uploading' | 'ready' | 'saving' | 'saved' | 'failed'

/** One chosen file: its upload, then the details the user reviews before it is saved. */
interface Item {
  key:      number
  file:     File
  status:   ItemStatus
  progress: number
  error:    string | null            // why the upload failed, or why the last save did
  upload:   UploadResponse | null
  category: string
  title:    string
  origin:   string
  version:  string
  touched:  ReadonlySet<string>
}

/** A truly empty file (0 bytes) can't be saved to the library. The size shown in MB is rounded, so it isn't used. */
const isZeroSize = (item: Item) => item.file.size === 0

const newItem = (key: number, file: File): Item => ({
  key, file, status: 'queued', progress: 0, error: null, upload: null,
  category: 'other', title: '', origin: '', version: '', touched: new Set(),
})

export function UploadDocumentForm({ projectId, onSaved, onCancel, onPendingChange }: Props) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  // The one transfer in progress: files go up one after another, as each is also read by the AI.
  const xhrRef = useRef<XMLHttpRequest | null>(null)
  const nextKey = useRef(0)
  // Closing the panel mid-transfer stops the upload
  useEffect(() => () => { const xhr = xhrRef.current; xhrRef.current = null; xhr?.abort() }, [])

  const [items,      setItems]      = useState<Item[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const [saving,     setSaving]     = useState(false)
  const savingRef = useRef(false)

  const update = (key: number, patch: Partial<Item>) =>
    setItems(list => list.map(i => (i.key === key ? { ...i, ...patch } : i)))
  const edit = (key: number, field: 'category' | 'title' | 'origin' | 'version', value: string) =>
    setItems(list => list.map(i => (i.key === key ? { ...i, [field]: value, touched: new Set(i.touched).add(field) } : i)))

  // Uploads stored but not in the library. Told to the parent at once (not from an effect): it discards
  // whatever is listed here when the panel closes, so a file just saved must already be off the list.
  const pending = useRef(new Set<string>())
  const setPending = (uploadId: string, isPending: boolean) => {
    if (isPending) pending.current.add(uploadId)
    else pending.current.delete(uploadId)
    onPendingChange?.([...pending.current])
  }

  const addFiles = (files: FileList | null | undefined) => {
    const chosen = Array.from(files ?? []).map(f => {
      const item = newItem(nextKey.current++, f)
      const error = !ACCEPT_EXT_RE.test(f.name) ? SOURCE_FILE_ERROR
        : f.size > MAX_BYTES ? t('page.upload_document.file_too_large', { sizeMB: (f.size / 1024 / 1024).toFixed(1) })
        : null
      return error ? { ...item, status: 'failed' as const, error } : item
    })
    if (chosen.length > 0) setItems(chosen)
  }

  const beginUpload = (item: Item) => {
    const { key, file: f } = item
    update(key, { status: 'uploading', progress: 0 })

    // XHR for progress events — fetch() doesn't surface upload progress.
    const xhr = new XMLHttpRequest()
    xhrRef.current = xhr
    // Ends this transfer; false when it was already stopped (file removed, panel closed).
    const finish = () => {
      if (xhrRef.current !== xhr) return false
      xhrRef.current = null
      return true
    }
    const url = `${import.meta.env.VITE_API_URL}/projects/${projectId}/documents/upload`
    xhr.open('POST', url)
    xhr.withCredentials = true
    for (const [name, value] of Object.entries(identityHeaders())) xhr.setRequestHeader(name, value)
    xhr.upload.addEventListener('progress', e => {
      if (e.lengthComputable && xhrRef.current === xhr) update(key, { progress: Math.round((e.loaded / e.total) * 100) })
    })
    xhr.addEventListener('load', () => {
      if (!finish()) return
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const resp = JSON.parse(xhr.responseText) as UploadResponse
          // Pre-fill review state from the suggestion
          const c = resp.classification
          update(key, {
            status:   'ready',
            upload:   resp,
            category: SOURCE_CATEGORIES.some(o => o.value === c.sourceCategory) ? c.sourceCategory : 'other',
            title:    f.name.replace(/\.[^.]+$/, ''),
            version:  c.versionConfidence >= 50 ? c.version : '',
          })
          setPending(resp.uploadId, true)
        } catch {
          update(key, { status: 'failed', error: t('page.upload_document.unexpected_response') })
        }
      } else {
        let msg: string
        try {
          const j = JSON.parse(xhr.responseText) as { error?: string; message?: string }
          msg = j.message || j.error || t('page.upload_document.upload_failed_http', { status: xhr.status })
        } catch {
          msg = t('page.upload_document.upload_failed_http', { status: xhr.status })
        }
        update(key, { status: 'failed', error: msg })
      }
    })
    xhr.addEventListener('error', () => {
      if (finish()) update(key, { status: 'failed', error: t('page.upload_document.network_error') })
    })

    const form = new FormData()
    form.append('file', f, f.name)
    xhr.send(form)
  }

  // Start the next file once nothing is transferring.
  useEffect(() => {
    if (xhrRef.current) return
    const next = items.find(i => i.status === 'queued')
    if (next) beginUpload(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items])

  const remove = (item: Item) => {
    if (item.status === 'uploading') { const xhr = xhrRef.current; xhrRef.current = null; xhr?.abort() }
    if (item.upload) {
      setPending(item.upload.uploadId, false)
      void documentsApi.discardSource(projectId, item.upload.uploadId).catch(() => undefined)
    }
    setItems(list => list.filter(i => i.key !== item.key))
  }

  const saveErrorText = (err: unknown) =>
    err instanceof ApiError
      ? err.status === 503 ? t('page.upload_document.save_err_disabled')
      : err.status === 403 ? t('page.upload_document.save_err_forbidden')
      : t('page.upload_document.save_err_http', { status: err.status })
      : t('page.upload_document.save_err_generic')

  // Saves every reviewed file. One that can't be saved keeps its form and says why; the others are kept.
  const saveAll = async () => {
    if (savingRef.current) return
    savingRef.current = true
    setSaving(true)
    const savedIds = items.filter(i => i.status === 'saved').map(i => i.upload!.uploadId)
    let failed = false
    for (const item of items.filter(i => i.status === 'ready')) {
      const uploadId = item.upload!.uploadId
      update(item.key, { status: 'saving', error: null })
      setPending(uploadId, false)
      try {
        await documentsApi.saveSource(projectId, uploadId, {
          title:     item.title.trim(),
          category:  item.category,
          origin:    item.origin.trim() || undefined,
          version:   item.version.trim() || undefined,
          overrides: Array.from(item.touched),
        })
        savedIds.push(uploadId)
        update(item.key, { status: 'saved' })
      } catch (err) {
        failed = true
        setPending(uploadId, true)
        update(item.key, { status: 'ready', error: saveErrorText(err) })
      }
    }
    savingRef.current = false
    setSaving(false)
    if (savedIds.length > 0) void qc.invalidateQueries({ queryKey: ['source-documents', projectId] })
    if (!failed) onSaved?.(savedIds)
  }

  const usable  = items.filter(i => i.status !== 'failed')
  const ready   = items.filter(i => i.status === 'ready')
  const busy    = items.some(i => i.status === 'queued' || i.status === 'uploading')
  const canSave = !busy && !saving && ready.length > 0 && ready.every(i => i.title.trim().length > 0 && !isZeroSize(i))

  // State 1 — nothing uploaded yet (or nothing that was chosen could be)
  if (usable.length === 0) {
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
            addFiles(e.dataTransfer.files)
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
            multiple
            accept={ACCEPT_MIME}
            onChange={e => {
              addFiles(e.currentTarget.files)
              e.currentTarget.value = ''
            }}
            className="hidden"
          />
        </div>

        {items.length > 0 && (
          <div className="flex flex-col gap-1 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700" role="alert">
            {items.map(i => <p key={i.key}>{items.length > 1 && <strong>{i.file.name}: </strong>}{i.error}</p>)}
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

  // States 2 + 3 — a card per file: transferring, then its details to review. Saved together.
  const reviewing = items.some(i => i.upload)
  return (
    <form
      onSubmit={e => {
        e.preventDefault()
        if (canSave) void saveAll()
      }}
      className="flex flex-col gap-4 p-5"
      data-form={reviewing ? 'upload-document-review' : 'upload-document'}
    >
      {items.length > 1 && (
        <p className="text-[12px] font-semibold text-slate-600" data-upload-count>
          {t('page.upload_document.files_progress', { done: items.length - items.filter(i => i.status === 'queued' || i.status === 'uploading').length, total: items.length })}
        </p>
      )}

      {items.map(item => (
        <FileCard
          key={item.key}
          item={item}
          alone={items.length === 1}
          locked={saving}
          onEdit={(field, value) => edit(item.key, field, value)}
          onRemove={() => remove(item)}
        />
      ))}

      <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-slate-200 bg-white px-5 py-3 -mx-5 -mb-5">
        <button type="button" onClick={onCancel}
          className="rounded-md border border-slate-300 bg-white px-4 py-2 text-[13px] font-semibold text-slate-700 hover:bg-slate-50">
          {reviewing ? t('page.upload_document.cancel_upload') : t('page.upload_document.cancel')}
        </button>
        {reviewing && (
          <button type="submit" disabled={!canSave}
            className="rounded-md bg-blue-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300">
            {saving ? t('page.upload_document.saving')
              : ready.length > 1 ? t('page.upload_document.save_all_to_library', { count: ready.length })
              : t('page.upload_document.save_to_library')}
          </button>
        )}
      </div>
    </form>
  )
}

// ---- One file ----

function FileCard({ item, alone, locked, onEdit, onRemove }: {
  item:     Item
  alone:    boolean
  locked:   boolean
  onEdit:   (field: 'category' | 'title' | 'origin' | 'version', value: string) => void
  onRemove: () => void
}) {
  const { t } = useTranslation()
  const { file, status, progress, error, upload, touched } = item
  const name = upload?.fileName ?? file.name

  const removeButton = !alone && status !== 'saved' && (
    <button type="button" onClick={onRemove} disabled={locked} data-action="remove-file"
      aria-label={t('page.upload_document.remove_file', { name })} title={t('page.upload_document.remove_file', { name })}
      className="flex-none rounded px-1.5 text-[14px] leading-none text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40">
      ✕
    </button>
  )

  // Waiting, transferring, refused or already saved: one line, no fields.
  if (!upload || status === 'saved') {
    const badge = status === 'queued' ? t('page.upload_document.waiting')
      : status === 'saved' ? t('page.upload_document.saved')
      : status === 'failed' ? t('page.upload_document.not_uploaded')
      : progress < 100 ? t('page.upload_document.uploading') : t('page.upload_document.classifying')
    const tone = status === 'failed' ? { backgroundColor: '#FEE2E2', color: '#991B1B' }
      : status === 'saved' ? { backgroundColor: '#DCFCE7', color: '#166534' }
      : status === 'queued' ? { backgroundColor: '#F1F5F9', color: '#475569' }
      : { backgroundColor: '#EFF6FF', color: '#1D4ED8' }
    return (
      <section className="rounded-lg border border-slate-200 bg-white p-5" data-upload-file={file.name} data-upload-status={status}>
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold text-slate-900">{file.name}</p>
            <p className="text-[11px] text-slate-500">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
          </div>
          <span className="flex-none rounded-full px-2 py-0.5 font-mono text-[11px] font-semibold" style={tone}>{badge}</span>
          {removeButton}
        </div>
        {status === 'uploading' && (
          <>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full transition-all duration-200"
                style={{ width: `${progress}%`, backgroundColor: '#2563EB' }}
              />
            </div>
            <p className="mt-2 text-[11px] text-slate-500">{t('page.upload_document.progress_hint', { pct: progress })}</p>
          </>
        )}
        {error && <p className="mt-2 text-[12px] text-red-700" role="alert">{error}</p>}
      </section>
    )
  }

  // Review
  const { stub, reason, fallbackReason } = upload.classification
  const versionByAi = !stub && upload.classification.versionSource !== 'filename'
  // A filename guess has no real confidence, so it shows none.
  const catConf = stub ? 0 : upload.classification.sourceCategoryConfidence
  const versionConf = versionByAi ? upload.classification.versionConfidence : 0

  return (
    <div
      className={`flex flex-col gap-4 ${alone ? '' : 'rounded-lg border border-slate-300 p-4'}`}
      data-upload-file={file.name}
      data-upload-status={status}
    >
      <section className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white p-4">
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold text-slate-900">{name}</p>
          <p className="text-[11px] text-slate-500">
            {t('page.upload_document.file_meta', { sizeMB: upload.fileSizeMB, scan: upload.virusScanStatus })}
          </p>
        </div>
        {removeButton}
      </section>

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

      <SourceFileNotes classification={upload.classification} />

      {isZeroSize(item) && (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-800" role="alert" data-zero-size>
          {t('page.upload_document.zero_size')}
        </div>
      )}

      <fieldset disabled={locked} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
        <h3 className="text-[13px] font-semibold text-slate-900">{t('page.upload_document.source_details')}</h3>
        <div className="mt-3 flex flex-col gap-3">
          <FieldLabel label={t('page.upload_document.category_label')} conf={catConf} touched={touched.has('category')} byAi={!stub}>
            <select
              value={item.category}
              onChange={e => onEdit('category', e.currentTarget.value)}
              required
              data-source-category
              className="h-9 w-full rounded-md border border-slate-300 px-3 text-[13px]"
            >
              {SOURCE_CATEGORIES.map(o => <option key={o.value} value={o.value}>{t(o.labelKey)}</option>)}
            </select>
            {!stub && reason && !touched.has('category') && (
              <span className="text-[11px] text-slate-500" data-classification-reason>{reason}</span>
            )}
          </FieldLabel>

          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{t('page.upload_document.title_label')}</span>
            <input
              value={item.title}
              onChange={e => onEdit('title', e.currentTarget.value)}
              required
              className="h-9 w-full rounded-md border border-slate-300 px-3 text-[13px]"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{t('page.upload_document.origin_label')}</span>
            <input
              value={item.origin}
              onChange={e => onEdit('origin', e.currentTarget.value)}
              placeholder={t('page.upload_document.origin_placeholder')}
              className="h-9 w-full rounded-md border border-slate-300 px-3 text-[13px]"
            />
          </label>

          <FieldLabel label={t('page.upload_document.version_label')} conf={versionConf} touched={touched.has('version')} byAi={versionByAi}>
            <input
              value={item.version}
              onChange={e => onEdit('version', e.currentTarget.value)}
              placeholder={t('page.upload_document.version_placeholder')}
              className="h-9 w-full rounded-md border border-slate-300 px-3 text-[13px]"
            />
          </FieldLabel>
        </div>
      </fieldset>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700" role="alert">
          {error}
        </div>
      )}
    </div>
  )
}

/** What the upload-time checks found: unreadable by the AI, a duplicate, or looks like a sample. */
function SourceFileNotes({ classification: c }: { classification: Classification }) {
  const { t } = useTranslation()
  const notes: Array<{ tone: 'red' | 'amber'; key: string; text: string }> = []
  if (c.inspection && !c.inspection.usable) {
    notes.push({ tone: 'red', key: 'unreadable', text: t('page.upload_document.check_unreadable', { problem: c.inspection.problem ?? '' }) })
  } else if (c.inspection?.problem) {
    notes.push({ tone: 'amber', key: 'limited', text: c.inspection.problem })
  }
  if (c.duplicateOf) notes.push({ tone: 'amber', key: 'duplicate', text: t('page.upload_document.check_duplicate', { title: c.duplicateOf.title }) })
  if (c.looksLikeExample) {
    notes.push({ tone: 'amber', key: 'example', text: t('page.upload_document.check_example', { reason: c.exampleReason ?? '' }).trim() })
  }
  if (notes.length === 0) return null
  return (
    <ul className="flex flex-col gap-1.5" data-source-checks>
      {notes.map(n => (
        <li
          key={n.key}
          data-source-check={n.key}
          className={`rounded-md border px-3 py-2 text-[12px] ${n.tone === 'red' ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`}
        >
          {n.text}
        </li>
      ))}
    </ul>
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
