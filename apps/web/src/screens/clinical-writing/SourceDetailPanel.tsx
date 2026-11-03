// Right-hand detail panel for a source document: metadata, chain of custody, the
// documents written from it, and an Open button to view the file.

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SlidePanel } from '../../components/ui'
import type { SourceDocument } from '../../api/documents'
import { sourceCategoryLabel } from '../../utils/sourceCategories'
import { downloadSourceFile, sourceErrorMessage } from '../../utils/openSource'
import { SourceViewer } from '../../panels/SourceReferencesPanel'
import { EyeIcon, MetaRow, MetaSection, fmtDateTime, fmtSize } from './detailPanelParts'

const STATE_KEY: Record<SourceDocument['state'], { labelKey: string; bg: string; fg: string }> = {
  saved:    { labelKey: 'state_saved',    bg: '#F0FDF4', fg: '#166534' },
  rejected: { labelKey: 'state_rejected', bg: '#FEF2F2', fg: '#B91C1C' },
}
const SCAN_KEY: Record<string, string> = { passed: 'scan_passed', pending: 'scan_pending', failed: 'scan_failed' }

interface Props {
  projectId: string
  source: SourceDocument | null
  onClose: () => void
  onOpenDoc: (documentId: string) => void
}

export function SourceDetailPanel({ projectId, source, onClose, onOpenDoc }: Props) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // true = the file is shown inside the panel (PDF / image) instead of the metadata
  const [viewing, setViewing] = useState(false)
  useEffect(() => { setViewing(false); setError(null) }, [source?.id])

  const download = async () => {
    if (!source) return
    setBusy(true); setError(null)
    try { await downloadSourceFile(projectId, source) }
    catch (e) { setError(sourceErrorMessage(e, source.fileName)) }
    finally { setBusy(false) }
  }
  // Open shows the file in the panel; types the viewer can't render are downloaded instead.
  const open = async () => {
    if (!source) return
    if (source.previewable) { setViewing(true); return }
    await download()
  }

  const blocked = source?.virusScanStatus === 'failed'
  const st = source ? STATE_KEY[source.state] : null
  const ext = source?.fileName.includes('.') ? source.fileName.split('.').pop()!.toUpperCase() : t('page.detail_panel_parts.em_dash')

  return (
    <SlidePanel
      open={!!source}
      onClose={() => { setError(null); onClose() }}
      title={source?.title ?? ''}
      storageKey="panel-width-source-detail"
      defaultWidth={420}
      closeOnOutsideClick
      expandedWidth={viewing ? 720 : undefined}
    >
      {source && viewing && (
        <div className="flex h-full flex-col" data-panel="source-viewer">
          <SourceViewer
            projectId={projectId}
            source={source}
            page={null}
            backLabel={t('page.source_detail_panel.back_details')}
            onBack={() => setViewing(false)}
          />
        </div>
      )}
      {source && st && !viewing && (
        <div className="flex min-h-full flex-col" data-panel="source-detail">
          <div className="flex-1">
            <MetaSection label={t('page.source_detail_panel.source')}>
              <span className="inline-flex items-center rounded-full px-3 py-1 font-mono text-[12px] font-semibold" style={{ backgroundColor: st.bg, color: st.fg }}>
                {t(`page.source_detail_panel.${st.labelKey}`)}
              </span>
            </MetaSection>

            <MetaSection label={t('page.source_detail_panel.file')}>
              <MetaRow label={t('page.source_detail_panel.name')}><span className="font-mono text-[12px]">{source.fileName}</span></MetaRow>
              <MetaRow label={t('page.source_detail_panel.type')}>{ext}</MetaRow>
              <MetaRow label={t('page.source_detail_panel.size')}>{fmtSize(source.fileSizeBytes)}</MetaRow>
              <MetaRow label={t('page.source_detail_panel.virus_scan')}>{SCAN_KEY[source.virusScanStatus] ? t(`page.source_detail_panel.${SCAN_KEY[source.virusScanStatus]}`) : source.virusScanStatus}</MetaRow>
            </MetaSection>

            <MetaSection label={t('page.source_detail_panel.details')}>
              <MetaRow label={t('page.source_detail_panel.category')}>
                {sourceCategoryLabel(source.category)}
                {source.categorySource === 'detected' && <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400" title={t('page.source_detail_panel.auto_tooltip')}>{t('page.source_detail_panel.auto_badge')}</span>}
              </MetaRow>
              <MetaRow label={t('page.source_detail_panel.origin')}>{source.origin ?? t('page.detail_panel_parts.em_dash')}</MetaRow>
              <MetaRow label={t('page.source_detail_panel.version')}>{source.version ?? t('page.detail_panel_parts.em_dash')}</MetaRow>
            </MetaSection>

            <MetaSection label={t('page.source_detail_panel.chain_of_custody')}>
              <MetaRow label={t('page.source_detail_panel.uploaded_at')}>{fmtDateTime(source.uploadedAt)}</MetaRow>
              <MetaRow label={t('page.source_detail_panel.uploaded_by')}>{source.uploadedBy.name ?? source.uploadedBy.email ?? source.uploadedBy.id}</MetaRow>
            </MetaSection>

            <MetaSection label={t('page.source_detail_panel.used_in')}>
              {source.usedIn.length === 0 ? (
                <p className="text-[13px] text-slate-400">{t('page.source_detail_panel.not_used')}</p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {source.usedIn.map(d => (
                    <li key={d.id}>
                      <button type="button" onClick={() => onOpenDoc(d.id)} className="text-left text-[13px] font-semibold text-blue-600 hover:text-blue-700 hover:underline">
                        {d.title}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </MetaSection>

            {error && <div className="mx-5 mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900" role="alert">{error}</div>}
          </div>

          <div className="sticky bottom-0 flex flex-col gap-2 border-t border-slate-200 bg-white px-5 py-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void open()}
                disabled={busy || blocked}
                title={blocked ? t('page.source_detail_panel.blocked_open_tooltip') : source.previewable ? undefined : t('page.source_detail_panel.non_previewable_tooltip')}
                className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-[13px] font-semibold text-slate-900 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
                data-action="open-source"
              >
                <EyeIcon /> {t('page.source_detail_panel.open')}
              </button>
              <button
                type="button"
                onClick={() => void download()}
                disabled={busy || blocked}
                title={blocked ? t('page.source_detail_panel.blocked_download_tooltip') : undefined}
                className="rounded-md border border-slate-300 bg-white px-4 py-2 text-[13px] font-semibold text-slate-900 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
                data-action="download-source"
              >
                {busy ? t('page.source_detail_panel.downloading') : t('page.source_detail_panel.download')}
              </button>
            </div>
          </div>
        </div>
      )}
    </SlidePanel>
  )
}
