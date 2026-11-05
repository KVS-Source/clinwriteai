import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import type { Document, Section } from '@platform/types'
import { PLATFORM_ACCENT } from '@platform/types'
import { platformApi } from '../../platform/api/platformApi'
import { describeApiError } from '../../api'
import { raciApi } from '../../api/raci'
import { SlidePanel } from '../ui/SlidePanel'
import { THERAPEUTIC_AREA_LABEL } from '../../utils/labels'

// FR-A-080 / AC-A-054: push a signed, final document — or one of its sections — into
// the Master Library with the four mandatory tags (therapeutic area, module,
// document type, version). Shown only on a signed document, and only to its Author
// (R): admins, PMs and every other letter only read (action table row 6). The API
// makes the same checks, so a hidden button is a courtesy, not the control.
//
// Once the whole document is in the library at this version the button goes away and a
// "In Master Library" badge (LibraryPushedBadge, next to the Signed badge) says so.

const DOC_TYPES = ['Protocol', 'CSR', 'NDA', 'IND', 'SmPC', 'RMP', 'Clinical Brief', 'HA Response', 'Manuscript', 'KOL Summary', 'Blog Post']
const MODULES = ['A', 'B', 'C', 'D', 'E'] as const

// A starting point for the document-type tag from the document's own type, e.g. csr_full -> CSR.
function guessDocType(type: string): string {
  const t = type.toLowerCase()
  if (t.includes('csr')) return 'CSR'
  if (t.includes('protocol')) return 'Protocol'
  if (t.includes('smpc')) return 'SmPC'
  if (t.includes('rmp')) return 'RMP'
  if (t.includes('nda')) return 'NDA'
  if (t.includes('ind')) return 'IND'
  return ''
}

const labelClass = 'font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500'
const fieldClass = 'h-9 w-full rounded-md border border-slate-300 bg-white px-2.5 text-[13px]'
const readonlyClass = 'flex h-9 items-center rounded-md border border-slate-200 bg-slate-50 px-2.5 text-[13px] text-slate-700'

// What of this document is already in the library. Shared by the badge and the button
// (React Query de-duplicates the request).
function useLibraryEntries(document: Document) {
  const signed = document.status === 'signed'
  const query = useQuery({
    queryKey: ['library-push', 'entries', document.id],
    queryFn: () => platformApi.libraryEntriesForDocument(document.id),
    enabled: signed,
    retry: false,
  })
  const entries = query.data ?? []
  return {
    entries,
    wholePushed: entries.some(e => e.sectionId === null && e.documentVersion === document.version),
    pushedSectionIds: new Set(entries.filter(e => e.sectionId !== null && e.documentVersion === document.version).map(e => e.sectionId as string)),
  }
}

// Green pill for the title row, next to the Signed badge.
export function LibraryPushedBadge({ document }: { document: Document }) {
  const { t } = useTranslation()
  const { wholePushed, pushedSectionIds } = useLibraryEntries(document)
  if (document.status !== 'signed') return null
  if (!wholePushed && pushedSectionIds.size === 0) return null
  return (
    <span
      className="flex-none rounded-full px-2.5 py-1 text-xs font-semibold"
      style={{ backgroundColor: '#EFF6FF', color: '#1D4ED8', border: '1px solid #BFDBFE' }}
      title={t('page.library_push.badge_hint')}
      data-library-badge
    >
      {wholePushed ? t('page.library_push.badge_document') : t('page.library_push.badge_sections', { count: pushedSectionIds.size })}
    </span>
  )
}

export function PushToLibraryButton({ document, sections }: { document: Document; sections: Section[] }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const isSigned = document.status === 'signed'
  const rights = useQuery({
    queryKey: ['library-push', 'can-edit', document.id],
    queryFn: () => raciApi.canEdit(document.id),
    enabled: isSigned,
  })
  const { wholePushed, pushedSectionIds } = useLibraryEntries(document)

  const [open,      setOpen]      = useState(false)
  const [scope,     setScope]     = useState<'document' | 'section'>('document')
  const [sectionId, setSectionId] = useState('')
  const [module,    setModule]    = useState<(typeof MODULES)[number]>('A')
  const [docType,   setDocType]   = useState(() => guessDocType(document.type))
  const [busy,      setBusy]      = useState(false)
  const [failure,   setFailure]   = useState<string | null>(null)

  if (!isSigned || rights.data?.canEdit !== true || wholePushed) return null

  const canSubmit = !!docType && (scope === 'document' || !!sectionId) && !busy

  async function submit() {
    setBusy(true); setFailure(null)
    try {
      await platformApi.pushToLibrary({
        documentId: document.id,
        ...(scope === 'section' ? { sectionId } : {}),
        taTag: document.therapeuticArea, module, docType, version: document.version,
      })
      await queryClient.invalidateQueries({ queryKey: ['library'] })
      await queryClient.invalidateQueries({ queryKey: ['library-push', 'entries', document.id] })
      setSectionId('')
      setOpen(false)   // the button turns into the "In Master Library" badge once the whole document is in
    } catch (err) {
      setFailure(describeApiError(err).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button type="button" onClick={() => { setOpen(true); setFailure(null) }} data-action="push-to-library" data-panel-trigger
        title={t('page.library_push.button_hint')}
        className="rounded-md border border-slate-300 bg-white px-4 py-2 text-[13px] font-semibold text-slate-700 transition-colors hover:bg-slate-50">
        {t('page.library_push.button')}
      </button>

      <SlidePanel open={open} onClose={() => setOpen(false)} title={t('page.library_push.title')} subtitle={document.title}
        storageKey="library-push" defaultWidth={440} belowTopBar closeOnOutsideClick>
        <div className="flex flex-col gap-6 px-6 py-6" data-push-panel>
          <p className="text-[13px] leading-relaxed text-slate-600">{t('page.library_push.hint')}</p>

          <fieldset className="flex flex-col gap-3">
            <legend className={`${labelClass} mb-1`}>{t('page.library_push.scope')}</legend>
            <label className="flex items-center gap-2.5 text-[13px] text-slate-800">
              <input type="radio" name="push-scope" checked={scope === 'document'} onChange={() => setScope('document')} style={{ accentColor: PLATFORM_ACCENT.primary }} />
              {t('page.library_push.scope_document')}
            </label>
            <label className="flex items-center gap-2.5 text-[13px] text-slate-800">
              <input type="radio" name="push-scope" checked={scope === 'section'} onChange={() => setScope('section')} style={{ accentColor: PLATFORM_ACCENT.primary }} />
              {t('page.library_push.scope_section')}
            </label>
          </fieldset>

          {scope === 'section' && (
            <label className="flex flex-col gap-2">
              <span className={labelClass}>{t('page.library_push.section')}</span>
              <select className={fieldClass} value={sectionId} onChange={e => setSectionId(e.currentTarget.value)} data-push-section>
                <option value="">{t('page.library_push.choose_section')}</option>
                {sections.map(s => (
                  <option key={s.id} value={s.id} disabled={pushedSectionIds.has(s.id)}>
                    {s.number} {s.title}{pushedSectionIds.has(s.id) ? t('page.library_push.already_in_library') : ''}
                  </option>
                ))}
              </select>
            </label>
          )}

          <div className="flex flex-col gap-3">
            <p className={labelClass}>{t('page.library_push.mandatory_tags')}</p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-5">
              <div className="flex flex-col gap-2">
                <span className={labelClass}>{THERAPEUTIC_AREA_LABEL}</span>
                <span className={readonlyClass} data-push-ta>{document.therapeuticArea}</span>
              </div>
              <div className="flex flex-col gap-2">
                <span className={labelClass}>{t('page.library_push.tag_version')}</span>
                <span className={readonlyClass} data-push-version>{document.version}</span>
              </div>
              <label className="flex flex-col gap-2">
                <span className={labelClass}>{t('page.library_push.tag_module')}</span>
                <select className={fieldClass} value={module} onChange={e => setModule(e.currentTarget.value as (typeof MODULES)[number])} data-push-module>
                  {MODULES.map(m => <option key={m} value={m}>{t(`page.master_library.discipline_${m.toLowerCase()}`)}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-2">
                <span className={labelClass}>{t('page.library_push.tag_doc_type')}</span>
                <select className={fieldClass} value={docType} onChange={e => setDocType(e.currentTarget.value)} data-push-doctype>
                  <option value="">{t('page.library_push.choose_doc_type')}</option>
                  {DOC_TYPES.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </label>
            </div>
          </div>

          {failure && <p className="rounded-md bg-red-50 px-3 py-2.5 text-[13px] text-red-800" role="alert">{t('page.library_push.failure', { message: failure })}</p>}

          <div className="flex items-center gap-3 border-t border-slate-200 pt-5">
            <button type="button" onClick={submit} disabled={!canSubmit} data-action="confirm-push"
              className="h-10 rounded-md px-5 text-[13px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
              style={{ backgroundColor: PLATFORM_ACCENT.primary }}>
              {busy ? t('page.library_push.pushing') : t('page.library_push.submit')}
            </button>
            <button type="button" onClick={() => setOpen(false)} className="h-10 rounded-md px-4 text-[13px] text-slate-600 hover:bg-slate-100">{t('button.cancel')}</button>
          </div>
        </div>
      </SlidePanel>
    </>
  )
}
