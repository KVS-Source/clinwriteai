import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { documentsApi, type SourceDocument, type SourceReference } from '../api/documents'
import { ApiError } from '../api/client'
import type { DocumentStatus } from '@platform/types'
import { useEditorStore } from '../store'
import { normalizeSpan, spansOverlap } from '../screens/clinical-writing/referenceHighlights'

// Source references panel (FR-A-022). Two views in the right-hand panel:
//   list   — reference links for the active section + "add a reference" from selected text
//   viewer — the linked source document (PDF / image), opened at the cited page
// "Already linked" is per text range, not per section: when the selected text overlaps a
// linked range the panel points at that reference (View source / Remove) instead of the add
// form; any other selection can be linked, so a section can hold many references. Removing
// keeps the original record (the API appends a removal and audits it).

interface Props {
  documentId: string
  projectId: string
  sectionId: string | null
  sectionLabel?: string
  /** document status — references can't change while it's in review, awaiting signature or signed */
  documentStatus?: DocumentStatus
  /** a closed project is read-only whatever the document's status */
  projectClosed?: boolean
}

const LOCKED_NOTE: Partial<Record<DocumentStatus, string>> = {
  'in-review':         'The document is in review and locked for authoring, so references can’t be added or removed.',
  'pending-signature': 'The document is awaiting signature, so references can’t be added or removed.',
  'signed':            'The document is signed, so references can’t be added or removed.',
}

const excerpt = (s: string, n = 90) => (s.length > n ? `${s.slice(0, n).trimEnd()}…` : s)

function reason(err: unknown): string {
  if (err instanceof ApiError) {
    const body = err.body as { message?: string; error?: string } | null
    if (body?.message) return body.message
    if (err.status === 404) return 'The stored file could not be found.'
  }
  return 'Something went wrong. Please try again.'
}

// ---------------------------------------------------------------- viewer

export function SourceViewer({ projectId, documentId, source, page, quote, onBack, backLabel = '← References' }: {
  projectId: string
  /** opened from this document — the view/download is logged on its audit trail */
  documentId?: string
  source: Pick<SourceDocument, 'id' | 'fileName' | 'contentType' | 'previewable'> | null
  page: number | null
  quote?: string
  onBack: () => void
  backLabel?: string
}) {
  const uploadId = source?.id ?? ''
  const previewable = source?.previewable ?? false
  const [pageJump, setPageJump] = useState<number | null>(page)
  useEffect(() => setPageJump(page), [page, uploadId])

  const file = useQuery({
    queryKey: ['source-preview', projectId, uploadId, documentId ?? null],
    queryFn: () => documentsApi.previewSource(projectId, uploadId, documentId),
    enabled: !!uploadId && previewable,
    staleTime: 5 * 60_000,
    retry: false,
  })

  // Object URL tied to the fetched blob; revoked when it changes or the viewer closes.
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!file.data) { setUrl(null); return }
    const u = URL.createObjectURL(file.data.blob)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [file.data])

  const isPdf = (source?.contentType ?? '').toLowerCase().startsWith('application/pdf')
  // The API converts docx to HTML and serves text files as text/plain; the returned type tells us which.
  const servedType = file.data?.blob.type ?? ''
  const isFramed = servedType.startsWith('text/')
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const download = async () => {
    setDownloadError(null)
    try {
      const { blob, filename } = await documentsApi.downloadSource(projectId, uploadId, documentId)
      const a = window.document.createElement('a')
      const href = URL.createObjectURL(blob)
      a.href = href
      a.download = filename ?? source?.fileName ?? 'source-document'
      window.document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(href), 1000)
    } catch (e) { setDownloadError(reason(e)) }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-source-viewer>
      <div className="flex flex-none items-center gap-2 border-b border-slate-200 px-4 py-2">
        <button type="button" onClick={onBack} data-action="viewer-back"
          className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50">
          {backLabel}
        </button>
        <p className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-800" title={source?.fileName}>{source?.fileName ?? 'Source document'}</p>
        <button type="button" onClick={download} data-action="viewer-download"
          className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50">
          Download
        </button>
      </div>

      {quote && (
        <p className="flex-none border-b border-blue-100 bg-blue-50 px-4 py-2 text-xs text-blue-900" data-viewer-quote>
          <span className="font-semibold">Cited text: </span>“{excerpt(quote, 160)}”
        </p>
      )}
      {isPdf && previewable && (
        <div className="flex flex-none items-center gap-2 border-b border-slate-200 px-4 py-1.5 text-xs text-slate-600">
          <label htmlFor="viewer-page">Go to page</label>
          <input id="viewer-page" type="number" min={1} value={pageJump ?? ''} data-viewer-page
            onChange={e => setPageJump(e.target.value ? Math.max(1, Number(e.target.value)) : null)}
            className="w-16 rounded border border-slate-300 px-1.5 py-0.5 text-xs" />
        </div>
      )}
      {downloadError && <p role="alert" className="flex-none bg-red-50 px-4 py-2 text-xs text-red-700">{downloadError}</p>}

      <div className="min-h-0 flex-1 overflow-auto bg-slate-100">
        {!source && <p className="p-4 text-sm text-slate-500" data-viewer-state="unknown">This source document is no longer available in the project.</p>}
        {source && !previewable && (
          <p className="p-4 text-sm text-slate-600" data-viewer-state="not-previewable">
            This file type can’t be shown here — PDF, image, Word (.docx) and text/CSV files can. Use Download to open it.
          </p>
        )}
        {source && previewable && file.isLoading && <p className="p-4 text-sm text-slate-500" data-viewer-state="loading">Loading…</p>}
        {source && previewable && file.isError && (
          <p className="p-4 text-sm text-red-700" role="alert" data-viewer-state="error">{reason(file.error)}</p>
        )}
        {url && isPdf && (
          <iframe key={`${url}#${pageJump ?? ''}`} title={source?.fileName ?? 'Source document'} src={pageJump ? `${url}#page=${pageJump}` : url}
            className="h-full w-full border-0 bg-white" data-viewer-frame />
        )}
        {url && isFramed && (
          // docx (converted to HTML) and text files: sandboxed with no permissions, so nothing in the file can run.
          <iframe key={url} title={source?.fileName ?? 'Source document'} src={url} sandbox=""
            className="h-full w-full border-0 bg-white" data-viewer-frame data-viewer-converted />
        )}
        {url && !isPdf && !isFramed && (
          <img src={url} alt={source?.fileName ?? 'Source document'} className="mx-auto max-w-full p-3" data-viewer-image />
        )}
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ list

export function SourceReferencesPanel({ documentId, projectId, sectionId, sectionLabel, documentStatus, projectClosed }: Props) {
  const qc = useQueryClient()
  const selected = useEditorStore(s => s.traceabilityTarget)
  const setSelected = useEditorStore(s => s.setTraceabilityTarget)
  const selectedSpan = useEditorStore(s => s.traceabilityRange)
  const linkedSpans = useEditorStore(s => s.linkedSpans)
  const viewer = useEditorStore(s => s.sourceViewer)
  const setViewer = useEditorStore(s => s.setSourceViewer)

  const refsQ = useQuery({
    queryKey: ['references', documentId],
    queryFn: () => documentsApi.listReferences(documentId),
    enabled: !!documentId,
  })
  const sourcesQ = useQuery({
    queryKey: ['source-picker', projectId],
    queryFn: () => documentsApi.listSources(projectId, { pageSize: 100, sort: 'title', dir: 'asc' }),
    enabled: !!projectId,
    staleTime: 30_000,
  })
  const sources = useMemo(() => (sourcesQ.data?.items ?? []).filter(s => s.state !== 'rejected' && s.virusScanStatus !== 'failed'), [sourcesQ.data])
  const sourceById = useMemo(() => new Map((sourcesQ.data?.items ?? []).map(s => [s.id, s])), [sourcesQ.data])

  const inSection = (refsQ.data?.items ?? []).filter(r => r.sectionId === sectionId)
  const otherCount = (refsQ.data?.items.length ?? 0) - inSection.length

  const [uploadId, setUploadId] = useState('')
  const [page, setPage] = useState('')
  const [locator, setLocator] = useState('')

  const create = useMutation({
    mutationFn: () => documentsApi.createReference(documentId, {
      sectionId: sectionId!,
      spanText: normalizeSpan(selected ?? ''),
      uploadId,
      ...(selectedSpan ? { startOffset: selectedSpan.start, endOffset: selectedSpan.end } : {}),
      ...(page ? { page: Number(page) } : {}),
      ...(locator.trim() ? { locator: locator.trim() } : {}),
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['references', documentId] })
      setSelected(null); setPage(''); setLocator('')
    },
  })

  const canAdd = !!sectionId && !!selected && !!uploadId && (page === '' || Number(page) >= 1)

  // Remove: inline confirm with an optional reason (kept on the audit trail).
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [removeReason, setRemoveReason] = useState('')
  useEffect(() => { setConfirmingId(null); setRemoveReason('') }, [sectionId])
  const remove = useMutation({
    mutationFn: (referenceId: string) => documentsApi.removeReference(documentId, referenceId, removeReason.trim() || undefined),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['references', documentId] })
      void qc.invalidateQueries({ queryKey: ['document-sources', documentId] })
      setConfirmingId(null); setRemoveReason(''); setUploadId(''); setPage(''); setLocator('')
    },
  })
  // references whose marked text the current selection overlaps
  const selectionRefIds = new Set(selected && selectedSpan
    ? inSection.filter(r => linkedSpans[r.id] && spansOverlap(selectedSpan, linkedSpans[r.id]!)).map(r => r.id)
    : [])
  const linked = selectionRefIds.size > 0
  const lockedNote = projectClosed
    ? 'The project is closed and read-only, so references can’t be added or removed.'
    : documentStatus ? LOCKED_NOTE[documentStatus] : undefined

  if (viewer) {
    const src = sourceById.get(viewer.uploadId) ?? null
    return (
      <SourceViewer projectId={projectId} documentId={documentId} source={src} page={viewer.page ?? null} quote={viewer.spanText} onBack={() => setViewer(null)} />
    )
  }

  const open = (r: SourceReference) => setViewer({ uploadId: r.uploadId, page: r.page, spanText: r.spanText })

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto" data-panel="source-references">
      {lockedNote ? (
        <section className="border-b border-slate-200 p-4" data-reference-locked>
          <h4 className="text-xs font-bold uppercase tracking-wide text-slate-500">References locked{sectionLabel ? ` · ${sectionLabel}` : ''}</h4>
          <p className="mt-1 text-xs text-slate-500">{lockedNote}</p>
        </section>
      ) : linked ? (
        <section className="border-b border-slate-200 p-4" data-reference-linked>
          <h4 className="text-xs font-bold uppercase tracking-wide text-slate-500">Source linked{sectionLabel ? ` · ${sectionLabel}` : ''}</h4>
          <p className="mt-1 text-xs text-slate-500">The selected text is already linked to a source document (highlighted below). Remove that reference to link it to a different one, or select other text.</p>
          <button type="button" onClick={() => setSelected(null)} data-action="clear-selection" className="mt-1 text-[11px] font-semibold text-blue-700 hover:underline">Clear selection</button>
        </section>
      ) : (
      <section className="border-b border-slate-200 p-4" data-reference-form>
        <h4 className="text-xs font-bold uppercase tracking-wide text-slate-500">Add a reference{sectionLabel ? ` · ${sectionLabel}` : ''}</h4>
        <p className="mt-1 text-xs text-slate-500">Select text in the section, then choose the source it comes from.</p>

        <div className="mt-3 rounded-md border border-slate-200 bg-white p-2 text-xs" data-selected-text>
          {selected
            ? <><p className="text-slate-800">“{excerpt(selected, 220)}”</p>
                <button type="button" onClick={() => setSelected(null)} data-action="clear-selection" className="mt-1 text-[11px] font-semibold text-blue-700 hover:underline">Clear</button></>
            : <p className="italic text-slate-400" data-selected-empty>No text selected</p>}
        </div>

        <label className="mt-3 block text-xs font-semibold text-slate-700" htmlFor="ref-source">Source document</label>
        <select id="ref-source" value={uploadId} onChange={e => setUploadId(e.target.value)} data-field="source"
          className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs">
          <option value="">{sourcesQ.isLoading ? 'Loading…' : sources.length ? 'Select a source document' : 'No source documents in this project'}</option>
          {sources.map(s => <option key={s.id} value={s.id}>{s.fileName}</option>)}
        </select>

        <div className="mt-3 flex gap-2">
          <div className="w-20">
            <label className="block text-xs font-semibold text-slate-700" htmlFor="ref-page">Page</label>
            <input id="ref-page" type="number" min={1} value={page} onChange={e => setPage(e.target.value)} data-field="page"
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-xs" />
          </div>
          <div className="flex-1">
            <label className="block text-xs font-semibold text-slate-700" htmlFor="ref-locator">Section / table <span className="font-normal text-slate-400">(optional)</span></label>
            <input id="ref-locator" maxLength={200} value={locator} onChange={e => setLocator(e.target.value)} placeholder="e.g. §9.4 Table 3" data-field="locator"
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-xs" />
          </div>
        </div>

        <button type="button" disabled={!canAdd || create.isPending} onClick={() => create.mutate()} data-action="add-reference"
          className="mt-3 w-full rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300">
          {create.isPending ? 'Adding…' : 'Add reference'}
        </button>
        {create.isError && <p role="alert" className="mt-2 text-xs text-red-700" data-reference-error>{reason(create.error)}</p>}
        <p className="mt-2 text-[11px] text-slate-400">Every reference you add or remove is recorded in the document’s audit trail.</p>
      </section>
      )}

      <section className="p-4">
        <h4 className="text-xs font-bold uppercase tracking-wide text-slate-500">
          References in this section <span data-reference-count>{inSection.length}</span>
        </h4>
        {refsQ.isLoading && <p className="mt-2 text-xs text-slate-500">Loading…</p>}
        {refsQ.isError && <p role="alert" className="mt-2 text-xs text-red-700">Couldn’t load references.</p>}
        {!refsQ.isLoading && !refsQ.isError && inSection.length === 0 && (
          <p className="mt-2 text-xs text-slate-500" data-reference-empty>No references yet for this section.</p>
        )}
        <ul className="mt-2 space-y-2">
          {inSection.map(r => (
            <li key={r.id} data-reference={r.id} data-selected={selectionRefIds.has(r.id) || undefined}
              className={`rounded-md border bg-white p-3 ${selectionRefIds.has(r.id) ? 'border-blue-400 ring-2 ring-blue-100' : 'border-slate-200'}`}>
              <p className="text-xs italic text-slate-700">“{excerpt(r.spanText)}”</p>
              <p className="mt-1.5 text-xs font-semibold text-slate-900">{r.fileName ?? 'Source no longer available'}</p>
              <p className="text-[11px] text-slate-500">
                {[r.page ? `p. ${r.page}` : null, r.locator].filter(Boolean).join(' · ') || 'No page or section noted'}
                {' · '}{r.createdBy.name ?? 'Unknown'} · {new Date(r.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
              </p>
              {confirmingId === r.id ? (
                <div className="mt-2 rounded-md border border-red-200 bg-red-50 p-2" data-remove-confirm>
                  <p className="text-xs font-semibold text-red-800">Remove this reference?</p>
                  <input value={removeReason} onChange={e => setRemoveReason(e.target.value)} maxLength={500} placeholder="Reason (optional)" data-field="remove-reason"
                    className="mt-1.5 w-full rounded border border-red-200 bg-white px-2 py-1 text-xs" />
                  <div className="mt-2 flex gap-2">
                    <button type="button" disabled={remove.isPending} onClick={() => remove.mutate(r.id)} data-action="confirm-remove-reference"
                      className="rounded-md bg-red-600 px-2 py-1 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-60">
                      {remove.isPending ? 'Removing…' : 'Remove'}
                    </button>
                    <button type="button" disabled={remove.isPending} onClick={() => { setConfirmingId(null); setRemoveReason(''); remove.reset() }} data-action="cancel-remove-reference"
                      className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                      Cancel
                    </button>
                  </div>
                  {remove.isError && <p role="alert" className="mt-1.5 text-xs text-red-700" data-remove-error>{reason(remove.error)}</p>}
                </div>
              ) : (
                <div className="mt-2 flex gap-2">
                  <button type="button" onClick={() => open(r)} data-action="open-source"
                    className="rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-100">
                    View source
                  </button>
                  {!lockedNote && (
                    <button type="button" onClick={() => { setConfirmingId(r.id); setRemoveReason(''); remove.reset() }} data-action="remove-reference"
                      className="rounded-md border border-red-200 bg-white px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-50">
                      Remove
                    </button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
        {otherCount > 0 && <p className="mt-3 text-[11px] text-slate-400">{otherCount} more in other sections of this document.</p>}
      </section>

      {sources.length > 0 && (
        <section className="border-t border-slate-200 p-4">
          <h4 className="text-xs font-bold uppercase tracking-wide text-slate-500">Project source documents</h4>
          <ul className="mt-2 space-y-1">
            {sources.map(s => (
              <li key={s.id} className="flex items-center gap-2 text-xs" data-source-item={s.id}>
                <span className="min-w-0 flex-1 truncate text-slate-700" title={s.fileName}>{s.fileName}</span>
                <button type="button" onClick={() => setViewer({ uploadId: s.id })} data-action="open-project-source"
                  className="flex-none rounded border border-slate-300 bg-white px-2 py-0.5 font-semibold text-slate-700 hover:bg-slate-50">
                  Open
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
