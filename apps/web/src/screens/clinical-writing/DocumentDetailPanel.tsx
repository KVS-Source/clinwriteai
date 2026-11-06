// Right-hand detail panel for a document in the All Stages list: metadata, the source
// documents it is based on (with the sections that cite each), and an Open button. A signed
// document's Author (R) can also push it, or one section, to the Master Library from here with
// the four mandatory tags (FR-A-080) — the same push as on the Final Document screen.

import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import type { Document } from '@platform/types'
import { SlidePanel, StatusPill } from '../../components/ui'
import { documentsApi, type DocumentSourceLink } from '../../api/documents'
import { ApiError } from '../../api/client'
import { sourceCategoryLabel } from '../../utils/sourceCategories'
import { documentStageLabel } from '../../utils/documentLabels'
import { downloadSourceFile, sourceErrorMessage } from '../../utils/openSource'
import { SourceViewer } from '../../panels/SourceReferencesPanel'
import { EyeIcon, MetaRow, MetaSection, fmtDate } from './detailPanelParts'
import { PendingReminder } from './PendingReminder'
import { DeadlineField } from './DeadlineField'
import { useSourceAccess } from '../../hooks/useSourceAccess'
import { useCanEditDocument } from '../../hooks/useCanEditDocument'
import { LibraryPushedBadge, PushToLibraryButton } from '../../components/library/PushToLibraryButton'

interface Props {
  projectId: string
  doc: Document | null
  typeLabel: string
  stageLabel: string
  assigneeName: string
  onClose: () => void
  // Open the full Document Editor for this document.
  onOpen: (documentId: string) => void
  // Open the RACI matrix for this document as a focused drawer, with no
  // Document Editor behind it. Parent owns the drawer state. Omit this
  // prop to hide the RACI button entirely.
  onOpenRaci?: (documentId: string) => void
}

export function DocumentDetailPanel({ projectId, doc, typeLabel, stageLabel, assigneeName, onClose, onOpen, onOpenRaci }: Props) {
  const { t } = useTranslation()
  const [viewError, setViewError] = useState<string | null>(null)
  const [downloading, setDownloading] = useState<string | null>(null)
  // The source shown inside the panel (PDF / image) instead of the document's details
  const [viewing, setViewing] = useState<DocumentSourceLink | null>(null)
  const [stageError, setStageError] = useState<string | null>(null)
  useEffect(() => { setViewing(null); setViewError(null); setStageError(null) }, [doc?.id])

  const canViewSources = useSourceAccess(projectId)?.canView === true
  // Moving the stepper forward is the Author's (R); everyone else reads (CW-006).
  const canAdvance = useCanEditDocument(doc?.id) === true
  const sources = useQuery({
    queryKey: ['document-sources', doc?.id],
    queryFn: () => documentsApi.listDocumentSources(doc!.id),
    enabled: !!doc && canViewSources,
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

  // Who may change this document's dates; the status it's in decides too, so it follows the document.
  const deadlineAccess = useQuery({
    queryKey: ['document-deadline-access', doc?.id, doc?.status],
    queryFn: () => documentsApi.getDeadlineAccess(doc!.id),
    enabled: !!doc,
    retry: false,
  })

  // Master Library push: only a signed document can go in. The list row lacks some fields
  // the push drawer needs (version, therapeutic area), so the full document is read.
  const isSigned = doc?.status === 'signed'
  const fullDoc = useQuery({
    queryKey: ['document', doc?.id],
    queryFn: () => documentsApi.get(doc!.id),
    enabled: !!doc && isSigned,
    retry: false,
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
        const body = err.body as {
          error?: string
          message?: string
          blocking?: Array<{ text: string; framework: string }>
          blockingCount?: number
        } | null
        if (err.status === 422 && body?.error === 'terminal') {
          setStageError(t('page.document_detail_panel.err_terminal'))
          return
        }
        // Phase 2 checklist gate — Gate B. Enumerate blockers so the writer
        // knows what to tick before trying again.
        if (err.status === 409 && body?.error === 'checklist_blocked' && Array.isArray(body.blocking)) {
          const bullets = body.blocking.slice(0, 4).map(b => `• ${b.text} (${b.framework})`).join('\n')
          const extra = (body.blockingCount ?? body.blocking.length) > 4 ? t('page.document_detail_panel.err_checklist_more', { count: (body.blockingCount ?? body.blocking.length) - 4 }) : ''
          setStageError(t('page.document_detail_panel.err_checklist_blocked', { count: body.blockingCount ?? body.blocking.length, bullets }) + extra)
          return
        }
        setStageError(body?.message ?? t('page.document_detail_panel.err_advance_http', { status: err.status }))
        return
      }
      setStageError(t('page.document_detail_panel.err_advance_generic'))
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
            backLabel={t('page.document_detail_panel.back_document')}
            onBack={() => setViewing(null)}
          />
        </div>
      )}
      {doc && !viewing && (
        <div className="flex min-h-full flex-col" data-panel="document-detail">
          <div className="flex-1">
            <MetaSection label={t('page.document_detail_panel.status')}>
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill status={doc.status} />
                {isSigned && <LibraryPushedBadge document={doc} />}
              </div>
            </MetaSection>

            <MetaSection label={t('page.document_detail_panel.document')}>
              <MetaRow label={t('page.document_detail_panel.type_label')}>{typeLabel}</MetaRow>
              <MetaRow label={t('page.document_detail_panel.stage_label')}>{stageLabel}</MetaRow>
              <MetaRow label={t('page.document_detail_panel.version_label')}>{doc.version}</MetaRow>
              <MetaRow label={t('page.document_detail_panel.therapeutic_area')}>{doc.therapeuticArea || t('page.detail_panel_parts.em_dash')}</MetaRow>
              <MetaRow label={t('page.document_detail_panel.assigned_to')}>{assigneeName}</MetaRow>
            </MetaSection>

            <MetaSection label={t('page.document_detail_panel.dates')}>
              <MetaRow label={t('page.document_detail_panel.created')}>{fmtDate(doc.createdAt)}</MetaRow>
              <MetaRow label={t('page.document_detail_panel.last_updated')}>{fmtDate(doc.updatedAt)}</MetaRow>
              <MetaRow label={t('page.document_detail_panel.target_date')}>
                <DeadlineField
                  key={`target-${doc.id}`}
                  field="target-date"
                  value={doc.targetCompletionDate}
                  canEdit={deadlineAccess.data?.canEditTarget === true}
                  canClear
                  projectId={projectId}
                  documentId={doc.id}
                  onSave={date => documentsApi.setTargetDate(doc.id, date)}
                />
              </MetaRow>
              <MetaRow label={t('component.deadlines.review_due')}>
                <DeadlineField
                  key={`review-${doc.id}`}
                  field="review-due"
                  value={doc.reviewDueAt}
                  canEdit={deadlineAccess.data?.canEditReviewDue === true}
                  projectId={projectId}
                  documentId={doc.id}
                  onSave={date => documentsApi.setReviewDueDate(doc.id, date!)}
                />
              </MetaRow>
            </MetaSection>

            <PendingReminder documentId={doc.id} status={doc.status} />

            {canViewSources && (
            <MetaSection label={sources.data ? t('page.document_detail_panel.source_documents_with_count', { count: items.length }) : t('page.document_detail_panel.source_documents')}>
              {sources.isLoading && <p className="text-[13px] text-slate-400">{t('page.document_detail_panel.loading')}</p>}
              {sources.isError && <p className="text-[13px] text-red-700" role="alert">{t('page.document_detail_panel.sources_load_failed')}</p>}
              {sources.data && items.length === 0 && (
                <p className="text-[13px] text-slate-400" data-empty-sources>{t('page.document_detail_panel.no_sources_linked')}</p>
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
                        title={s.previewable ? t('page.document_detail_panel.view_source_tooltip') : t('page.document_detail_panel.download_source_tooltip')}
                      >
                        {downloading === s.uploadId ? '…' : s.previewable ? t('page.document_detail_panel.action_view') : t('page.document_detail_panel.action_download')}
                      </button>
                    </div>
                    <div className="mt-2">
                      <p className="mb-1 font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-400">{t('page.document_detail_panel.cited_in_sections')}</p>
                      {s.sections.length === 0 ? (
                        <p className="text-[12px] text-slate-400">{t('page.document_detail_panel.not_cited_yet')}</p>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {s.sections.map(sec => (
                            <span key={sec.sectionId} className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] text-slate-700" title={t('page.document_detail_panel.section_tooltip', { count: sec.references })}>
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
            )}
          </div>

          <div className="sticky bottom-0 flex flex-col gap-2 border-t border-slate-200 bg-white px-5 py-3">
            {stageError && (
              <div className="whitespace-pre-line rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-800" role="alert">
                {stageError}
              </div>
            )}
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onOpen(doc.id)}
                  className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-[13px] font-semibold text-slate-900 hover:bg-slate-50"
                  data-action="open-document"
                >
                  <EyeIcon /> {t('page.document_detail_panel.action_open')}
                </button>
                {/* R-only RACI shortcut per the role shift (docs/roles-and-permissions.md §5a).
                    Opens the RACI matrix in a focused drawer owned by the parent screen —
                    no Document Editor loaded behind it. Hidden on signed docs since the
                    matrix is read-only once the chain closes. */}
                {doc.status !== 'signed' && onOpenRaci && (
                  <button
                    type="button"
                    onClick={() => onOpenRaci(doc.id)}
                    className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-[13px] font-semibold text-slate-700 hover:bg-slate-50"
                    data-action="open-raci"
                    title={t('page.document_detail_panel.raci_tooltip')}
                  >
                    {t('page.document_detail_panel.raci_action')}
                  </button>
                )}
                {/* Shows itself only to the Author (R) of a signed document not yet in the library. */}
                {isSigned && fullDoc.data && <PushToLibraryButton document={fullDoc.data} />}
              </div>
              {stage.data && !stage.data.terminal && canAdvance && (
                <button
                  type="button"
                  onClick={() => advance.mutate()}
                  disabled={advance.isPending}
                  className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-blue-700 disabled:bg-slate-300"
                  data-action="advance-stage"
                  title={t('page.document_detail_panel.advance_tooltip', { currentLabel: documentStageLabel(stage.data.current, stage.data.currentLabel), nextLabel: documentStageLabel(stage.data.next, stage.data.nextLabel) })}
                >
                  {advance.isPending ? t('page.document_detail_panel.advancing') : t('page.document_detail_panel.advance_to', { nextLabel: documentStageLabel(stage.data.next, stage.data.nextLabel) })}
                </button>
              )}
              {stage.data?.terminal && (
                <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-400" data-stage-terminal>
                  {t('page.document_detail_panel.final_output')}
                </span>
              )}
            </div>
          </div>
        </div>
      )}
    </SlidePanel>
  )
}
