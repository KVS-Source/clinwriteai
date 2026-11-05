import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
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
const fieldClass = 'h-8 w-full rounded-md border border-slate-300 bg-white px-2 text-[12px]'

export function PushToLibraryButton({ document, sections }: { document: Document; sections: Section[] }) {
  const { t } = useTranslation()
  const isSigned = document.status === 'signed'
  const rights = useQuery({
    queryKey: ['library-push', 'can-edit', document.id],
    queryFn: () => raciApi.canEdit(document.id),
    enabled: isSigned,
  })

  const [open,      setOpen]      = useState(false)
  const [scope,     setScope]     = useState<'document' | 'section'>('document')
  const [sectionId, setSectionId] = useState('')
  const [module,    setModule]    = useState<(typeof MODULES)[number]>('A')
  const [docType,   setDocType]   = useState(() => guessDocType(document.type))
  const [busy,      setBusy]      = useState(false)
  const [failure,   setFailure]   = useState<string | null>(null)
  const [done,      setDone]      = useState<string | null>(null)

  if (!isSigned || rights.data?.canEdit !== true) return null

  const canSubmit = !!docType && (scope === 'document' || !!sectionId) && !busy

  async function submit() {
    setBusy(true); setFailure(null)
    try {
      const item = await platformApi.pushToLibrary({
        documentId: document.id,
        ...(scope === 'section' ? { sectionId } : {}),
        taTag: document.therapeuticArea, module, docType, version: document.version,
      })
      setDone(t('page.library_push.success', { name: item.name, version: item.version }))
      setOpen(false)
    } catch (err) {
      setFailure(describeApiError(err).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button type="button" onClick={() => { setOpen(true); setDone(null); setFailure(null) }} data-action="push-to-library"
        title={t('page.library_push.button_hint')}
        className="rounded-md border border-slate-300 bg-white px-4 py-2 text-[13px] font-semibold text-slate-700 transition-colors hover:bg-slate-50">
        {t('page.library_push.button')}
      </button>
      {done && <span role="status" className="text-xs font-medium text-green-700" data-push-done>{done}</span>}

      <SlidePanel open={open} onClose={() => setOpen(false)} title={t('page.library_push.title')} subtitle={document.title} storageKey="library-push" defaultWidth={420}>
        <div className="flex flex-col gap-3 p-1" data-push-panel>
          <p className="text-[12px] text-slate-600">{t('page.library_push.hint')}</p>

          <fieldset className="flex flex-col gap-1">
            <legend className={labelClass}>{t('page.library_push.scope')}</legend>
            <label className="flex items-center gap-2 text-[12px] text-slate-800">
              <input type="radio" name="push-scope" checked={scope === 'document'} onChange={() => setScope('document')} style={{ accentColor: PLATFORM_ACCENT.primary }} />
              {t('page.library_push.scope_document')}
            </label>
            <label className="flex items-center gap-2 text-[12px] text-slate-800">
              <input type="radio" name="push-scope" checked={scope === 'section'} onChange={() => setScope('section')} style={{ accentColor: PLATFORM_ACCENT.primary }} />
              {t('page.library_push.scope_section')}
            </label>
          </fieldset>

          {scope === 'section' && (
            <label className="flex flex-col gap-1">
              <span className={labelClass}>{t('page.library_push.section')}</span>
              <select className={fieldClass} value={sectionId} onChange={e => setSectionId(e.currentTarget.value)} data-push-section>
                <option value="">{t('page.library_push.choose_section')}</option>
                {sections.map(s => <option key={s.id} value={s.id}>{s.number} {s.title}</option>)}
              </select>
            </label>
          )}

          <p className={labelClass}>{t('page.library_push.mandatory_tags')}</p>
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1">
              <span className={labelClass}>{THERAPEUTIC_AREA_LABEL}</span>
              <span className="flex h-8 items-center rounded-md border border-slate-200 bg-slate-50 px-2 text-[12px] text-slate-700" data-push-ta>{document.therapeuticArea}</span>
            </div>
            <div className="flex flex-col gap-1">
              <span className={labelClass}>{t('page.library_push.tag_version')}</span>
              <span className="flex h-8 items-center rounded-md border border-slate-200 bg-slate-50 px-2 text-[12px] text-slate-700" data-push-version>{document.version}</span>
            </div>
            <label className="flex flex-col gap-1">
              <span className={labelClass}>{t('page.library_push.tag_module')}</span>
              <select className={fieldClass} value={module} onChange={e => setModule(e.currentTarget.value as (typeof MODULES)[number])} data-push-module>
                {MODULES.map(m => <option key={m} value={m}>{t(`page.master_library.discipline_${m.toLowerCase()}`)}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className={labelClass}>{t('page.library_push.tag_doc_type')}</span>
              <select className={fieldClass} value={docType} onChange={e => setDocType(e.currentTarget.value)} data-push-doctype>
                <option value="">{t('page.library_push.choose_doc_type')}</option>
                {DOC_TYPES.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </label>
          </div>

          {failure && <p className="rounded-md bg-red-50 p-2 text-[12px] text-red-800" role="alert">{t('page.library_push.failure', { message: failure })}</p>}

          <div className="mt-1 flex items-center gap-2">
            <button type="button" onClick={submit} disabled={!canSubmit} data-action="confirm-push"
              className="h-9 rounded-md px-4 text-[13px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
              style={{ backgroundColor: PLATFORM_ACCENT.primary }}>
              {busy ? t('page.library_push.pushing') : t('page.library_push.submit')}
            </button>
            <button type="button" onClick={() => setOpen(false)} className="h-9 rounded-md px-3 text-[13px] text-slate-600 hover:bg-slate-100">{t('button.cancel')}</button>
          </div>
        </div>
      </SlidePanel>
    </>
  )
}
