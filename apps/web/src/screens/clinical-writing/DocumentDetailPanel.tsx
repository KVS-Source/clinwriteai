// Right-hand detail panel for a document in the All Stages list: metadata, the source
// documents it is based on (with the sections that cite each), and an Open button.

import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Document } from '@platform/types'
import { SlidePanel, StatusPill } from '../../components/ui'
import { documentsApi, type DocumentSourceLink } from '../../api/documents'
import { ApiError } from '../../api/client'
import { sourceCategoryLabel } from '../../utils/sourceCategories'
import { downloadSourceFile, sourceErrorMessage } from '../../utils/openSource'
import { SourceViewer } from '../../panels/SourceReferencesPanel'
import { EyeIcon, MetaRow, MetaSection, fmtDate } from './detailPanelParts'

interface Props {
  projectId: string
  doc: Document | null
  typeLabel: string
  stageLabel: string
  assigneeName: string
  onClose: () => void
  onOpen: (documentId: string) => void
}

export function DocumentDetailPanel({ projectId, doc, typeLabel, stageLabel, assigneeName, onClose, onOpen }: Props) {
  const [viewError, setViewError] = useState<string | null>(null)
  const [downloading, setDownloading] = useState<string | null>(null)
  // The source shown inside the panel (PDF / image) instead of the document's details
  const [viewing, setViewing] = useState<DocumentSourceLink | null>(null)
  const [stageError, setStageError] = useState<string | null>(null)
  useEffect(() => { setViewing(null); setViewError(null); setStageError(null) }, [doc?.id])

  const sources = useQuery({
    queryKey: ['document-sources', doc?.id],
    queryFn: () => documentsApi.listDocumentSources(doc!.id),
    enabled: !!doc,
  })

  // Stage context — tells us what the next stage would be, so the button
  // can render "Advance to Cross-Functional Review →" or disable itself
  // at Final Output. Cheap read; refetched when the document changes.
  const stage = useQuery({
    queryKey: ['document-stage', doc?.id],
    queryFn: () => documentsApi.getStage(doc!.id),
    enabled: !!doc,
    staleTime: 10_000,
  })

  const qc = useQueryClient()
  const advance = useMutation({
    mutationFn: () => documentsApi.advanceStage(doc!.id),
    onSuccess: () => {
      setStageError(null)
      // Refresh everything that depends on stage: this panel's stage query,
      // the project document list (table + stepper + tabs), and the shaped
      // document used across the editor.
      void qc.invalidateQueries({ queryKey: ['document-stage', doc!.id] })
      void qc.invalidateQueries({ queryKey: ['documents', projectId] })
      void qc.invalidateQueries({ queryKey: ['document', doc!.id] })
    },
    onError: (err: unknown) => {
      if (err instanceof ApiError) {
        const body = err.body as { error?: string; message?: string } | null
        if (err.status === 422 && body?.error === 'terminal') {
          setStageError('This document is already at Final Output.')
          return
        }
        setStageError(body?.message ?? `Could not advance the stage (HTTP ${err.status}).`)
        return
      }
      setStageError('Could not advance the stage. Please try again.')
    },
  })

  const view = async (s: DocumentSourceLink) => {
    setViewError(null)
    if (s.previewable) { setViewing(s); return }
    setDownloading(s.uploadId)
    try { await downloadSourceFile(projectId, { id: s.uploadId, fileName: s.fileName }) }
    catch (e) { setViewError(sourceErrorMessage(e, s.fileName)) }
    finally { setDownloading(null) }
  }

  const items = sources.data?.items ?? []

  return (
    <SlidePanel
      open={!!doc}
      onClose={() => { setViewError(null); onClose() }}
      title={doc?.title ?? ''}
      subtitle={doc ? typeLabel : undefined}
      storageKey="panel-width-document-detail"
      defaultWidth={420}
      closeOnOutsideClick
      expandedWidth={viewing ? 720 : undefined}
    >
      {doc && viewing && (
        <div className="flex h-full flex-col" data-panel="source-viewer">
          <SourceViewer
            projectId={projectId}
            source={{ id: viewing.uploadId, fileName: viewing.fileName, contentType: viewing.contentType, previewable: viewing.previewable }}
            page={null}
            backLabel="← Document"
            onBack={() => setViewing(null)}
          />
        </div>
      )}
      {doc && !viewing && (
        <div className="flex min-h-full flex-col" data-panel="document-detail">
          <div className="flex-1">
            <MetaSection label="Status">
              <StatusPill status={doc.status} />
            </MetaSection>

            <MetaSection label="Document">
              <MetaRow label="Type">{typeLabel}</MetaRow>
              <MetaRow label="Stage">{stageLabel}</MetaRow>
              <MetaRow label="Version">{doc.version}</MetaRow>
              <MetaRow label="Therapeutic area">{doc.therapeuticArea || '—'}</MetaRow>
              <MetaRow label="Assigned to">{assigneeName}</MetaRow>
            </MetaSection>

            <MetaSection label="Dates">
              <MetaRow label="Created">{fmtDate(doc.createdAt)}</MetaRow>
              <MetaRow label="Last updated">{fmtDate(doc.updatedAt)}</MetaRow>
              <MetaRow label="Target date">{fmtDate(doc.targetCompletionDate)}</MetaRow>
            </MetaSection>

            <MetaSection label={`Source documents${sources.data ? ` (${items.length})` : ''}`}>
              {sources.isLoading && <p className="text-[13px] text-slate-400">Loading…</p>}
              {sources.isError && <p className="text-[13px] text-red-700" role="alert">Could not load the linked source documents.</p>}
              {sources.data && items.length === 0 && (
                <p className="text-[13px] text-slate-400" data-empty-sources>No source documents linked.</p>
              )}
              <ul className="flex flex-col gap-2.5">
                {items.map(s => (
                  <li key={s.uploadId} className="rounded-md border border-slate-200 bg-white p-3" data-source-link={s.uploadId}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-[13px] font-semibold text-slate-900" title={s.title}>{s.title}</p>
                        <p className="truncate text-[11px] text-slate-500">
                          {sourceCategoryLabel(s.category)}{s.origin ? ` · ${s.origin}` : ''}{s.version ? ` · ${s.version}` : ''}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void view(s)}
                        disabled={downloading === s.uploadId}
                        className="flex-none rounded-md border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:text-slate-400"
                        title={s.previewable ? 'View the source file' : 'This file type cannot be previewed — it will be downloaded.'}
                      >
                        {downloading === s.uploadId ? '…' : s.previewable ? 'View' : 'Download'}
                      </button>
                    </div>
                    <div className="mt-2">
                      <p className="mb-1 font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-400">Cited in sections</p>
                      {s.sections.length === 0 ? (
                        <p className="text-[12px] text-slate-400">Not cited in any section yet.</p>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {s.sections.map(sec => (
                            <span key={sec.sectionId} className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] text-slate-700" title={`${sec.references} reference${sec.references === 1 ? '' : 's'}`}>
                              {sec.number ? `${sec.number.startsWith('§') ? sec.number : `§${sec.number}`} ` : ''}{sec.title}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
              {viewError && <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900" role="alert">{viewError}</div>}
            </MetaSection>
          </div>

          <div className="sticky bottom-0 flex flex-col gap-2 border-t border-slate-200 bg-white px-5 py-3">
            {stageError && (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-800" role="alert">
                {stageError}
              </div>
            )}
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => onOpen(doc.id)}
                className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-[13px] font-semibold text-slate-900 hover:bg-slate-50"
                data-action="open-document"
              >
                <EyeIcon /> Open
              </button>
              {stage.data && !stage.data.terminal && (
                <button
                  type="button"
                  onClick={() => advance.mutate()}
                  disabled={advance.isPending}
                  className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-blue-700 disabled:bg-slate-300"
                  data-action="advance-stage"
                  title={`Move this document from ${stage.data.currentLabel} to ${stage.data.nextLabel}`}
                >
                  {advance.isPending ? 'Advancing…' : `Advance to ${stage.data.nextLabel} →`}
                </button>
              )}
              {stage.data?.terminal && (
                <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-400" data-stage-terminal>
                  Final Output
                </span>
              )}
            </div>
          </div>
        </div>
      )}
    </SlidePanel>
  )
}
