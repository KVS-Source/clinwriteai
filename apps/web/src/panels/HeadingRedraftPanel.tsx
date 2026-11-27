// Section introductions — the right panel opened from a heading's flag in the section list.
//
// A main heading (a number with sub-sections) gets an introduction written from its sub-sections. It is flagged
// when it has none though its sub-sections do (missing), or when a sub-section changed after it was written
// (stale). One heading at a time: Redraft with AI shows a preview to Accept, Edit or Discard; Write it myself opens
// a text box (saved as a manual edit, not AI-drafted); Keep as it is clears the
// flag until a sub-section changes again; Not now closes the panel. Only the document's authors and its creator
// can act (API documents/heading-intro.ts); everyone else sees why the heading is flagged.

import { createElement, Fragment, useMemo, useState, type ReactNode } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { documentsApi, type HeadingFlag, type HeadingFlagsResult } from '../api/documents'
import { ApiError } from '../api/client'

interface Props {
  documentId:  string
  /** The heading shown; null = the first flagged one. */
  sectionId:   string | null
  flags:       HeadingFlagsResult | undefined
  /** The heading's current text. */
  currentHtml: string
  onSelect:    (sectionId: string) => void
  onClose:     () => void
  /**
   * Saves the accepted introduction. The editor applies it itself when the heading is open and held by this user
   * (so live collaboration keeps it) and returns true; otherwise the API saves it.
   */
  applyInEditor: (sectionId: string, html: string, model: string | null, aiCallRecordId: string | null) => boolean
  /** After the API saved it: the editor shows the new text if that section is open. */
  onSaved?: (sectionId: string, html: string) => void
}

const ALLOWED = new Set(['p', 'ul', 'ol', 'li', 'strong', 'em', 'b', 'i', 'br', 'sup', 'sub'])

/** The AI's HTML as React elements, keeping only plain text formatting. */
function SafeHtml({ html }: { html: string }) {
  const nodes = useMemo(() => {
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const walk = (n: Node, key: number): ReactNode => {
      if (n.nodeType === Node.TEXT_NODE) return n.textContent
      if (n.nodeType !== Node.ELEMENT_NODE) return null
      const tag = (n as Element).tagName.toLowerCase()
      const children = [...n.childNodes].map((c, i) => walk(c, i))
      return ALLOWED.has(tag) ? createElement(tag, { key }, ...(tag === 'br' ? [] : children)) : createElement(Fragment, { key }, ...children)
    }
    return [...doc.body.childNodes].map((c, i) => walk(c, i))
  }, [html])
  return <div className="prose prose-sm max-w-none text-[13px] leading-relaxed text-slate-800 [&_li]:ml-4 [&_li]:list-disc [&_p]:mb-2">{nodes}</div>
}

/** Section HTML as editable plain text: one paragraph per block, list items as "- ". */
export function htmlToText(html: string): string {
  const marked = html
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|li|h[1-6]|div|tr|blockquote)>/gi, '\n\n')
  const text = new DOMParser().parseFromString(marked, 'text/html').body.textContent ?? ''
  return text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Plain text back to section HTML: blank lines split paragraphs; a block of "- " lines becomes a list. */
export function textToHtml(text: string): string {
  return text.trim().split(/\n\s*\n/).map(block => {
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean)
    if (lines.length && lines.every(l => /^[-•*]\s+/.test(l))) {
      return `<ul>${lines.map(l => `<li>${escapeHtml(l.replace(/^[-•*]\s+/, ''))}</li>`).join('')}</ul>`
    }
    return `<p>${lines.map(escapeHtml).join('<br>')}</p>`
  }).filter(b => b !== '<p></p>').join('')
}

// AI provider failures the API classifies (ai-gateway/ai-error.ts); each has its own title and next step here.
const AI_ERROR_CODES = ['ai_out_of_credit', 'ai_key_invalid', 'ai_rate_limited', 'ai_busy', 'ai_failed'] as const
type AiErrorCode = typeof AI_ERROR_CODES[number]

interface PanelError {
  /** A known AI failure (translated title + text), or null for any other refusal (the API's own message). */
  code:    AiErrorCode | null
  message: string
  /** Who can fix it: an admin (credit, key) or the writer by trying again. */
  fix:     'admin' | 'retry'
}

function errorOf(err: unknown, fallback: string): PanelError {
  const body = err instanceof ApiError && err.body && typeof err.body === 'object' ? err.body as { error?: unknown; message?: unknown; fix?: unknown } : null
  const code = AI_ERROR_CODES.find(c => c === body?.error) ?? null
  // Never show a raw provider dump ("400 {"type":"error" …"): fall back to the plain message.
  const raw = typeof body?.message === 'string' && !/^\s*\d{3}\s*\{/.test(body.message) ? body.message : fallback
  return { code, message: raw, fix: body?.fix === 'admin' ? 'admin' : 'retry' }
}

function ErrorCard({ error, onRetry, busy }: { error: PanelError; onRetry?: () => void; busy: boolean }) {
  const { t } = useTranslation()
  const title = error.code ? t(`component.heading_redraft.err_${error.code}_title`) : t('component.heading_redraft.err_title')
  const body = error.code ? t(`component.heading_redraft.err_${error.code}_body`) : error.message
  const admin = error.fix === 'admin'
  return (
    <div role="alert" data-heading-error={error.code ?? 'other'}
      className={`mt-3 flex gap-3 rounded-lg border px-3 py-3 ${admin ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-slate-50'}`}>
      <span aria-hidden="true" className={`mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-full ${admin ? 'bg-amber-100 text-amber-700' : 'bg-slate-200 text-slate-600'}`}>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM7.25 4.75a.75.75 0 0 1 1.5 0v3.5a.75.75 0 0 1-1.5 0v-3.5ZM8 11.75a.9.9 0 1 1 0-1.8.9.9 0 0 1 0 1.8Z" />
        </svg>
      </span>
      <div className="min-w-0 flex-1">
        <p className={`text-[13px] font-semibold ${admin ? 'text-amber-900' : 'text-slate-900'}`}>{title}</p>
        <p className={`mt-0.5 text-[13px] leading-relaxed ${admin ? 'text-amber-900/90' : 'text-slate-700'}`}>{body}</p>
        {admin
          ? <p className="mt-1.5 text-[12px] text-amber-800/80">{t('component.heading_redraft.err_admin_hint')}</p>
          : onRetry && (
            <button type="button" disabled={busy} onClick={onRetry} data-heading-error-retry
              className="mt-2 rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
              {t('component.heading_redraft.err_try_again')}
            </button>
          )}
      </div>
    </div>
  )
}

export function HeadingRedraftPanel({ documentId, sectionId, flags, currentHtml, onSelect, onClose, applyInEditor, onSaved }: Props) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const list = flags?.flags ?? []
  const flag: HeadingFlag | undefined = list.find(f => f.sectionId === sectionId) ?? (sectionId ? undefined : list[0])
  const [preview, setPreview] = useState<{ sectionId: string; html: string; model: string; aiCallRecordId: string | null } | null>(null)
  const [error, setError] = useState<PanelError | null>(null)
  const shown = preview && flag && preview.sectionId === flag.sectionId ? preview : null
  // Write it myself: the text being typed for this heading (null = not writing).
  const [draft, setDraft] = useState<{ sectionId: string; text: string } | null>(null)
  const writing = draft && flag && draft.sectionId === flag.sectionId ? draft : null

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['heading-flags', documentId] })
    void qc.invalidateQueries({ queryKey: ['document', documentId] })
    void qc.invalidateQueries({ queryKey: ['versions', documentId] })
  }
  const next = list.find(f => f.sectionId !== flag?.sectionId)

  const redraft = useMutation({
    mutationFn: (id: string) => documentsApi.redraftHeading(documentId, id),
    onMutate: () => setError(null),
    onSuccess: (r, id) => setPreview({ sectionId: id, ...r }),
    onError: (err) => setError(errorOf(err, t('component.heading_redraft.error_redraft'))),
  })
  const accept = useMutation({
    mutationFn: async (p: NonNullable<typeof preview>) => {
      if (applyInEditor(p.sectionId, p.html, p.model, p.aiCallRecordId)) return
      await documentsApi.acceptHeading(documentId, p.sectionId, { html: p.html, model: p.model, ...(p.aiCallRecordId ? { aiCallRecordId: p.aiCallRecordId } : {}) })
      onSaved?.(p.sectionId, p.html)
    },
    onMutate: () => setError(null),
    onSuccess: () => { setPreview(null); refresh() },
    onError: (err) => setError(errorOf(err, t('component.heading_redraft.error_accept'))),
  })
  const saveOwn = useMutation({
    mutationFn: async (d: { sectionId: string; text: string }) => {
      const html = textToHtml(d.text)
      if (applyInEditor(d.sectionId, html, null, null)) return
      await documentsApi.acceptHeading(documentId, d.sectionId, { html, manual: true })
      onSaved?.(d.sectionId, html)
    },
    onMutate: () => setError(null),
    onSuccess: () => { setDraft(null); setPreview(null); refresh() },
    onError: (err) => setError(errorOf(err, t('component.heading_redraft.error_accept'))),
  })
  const keep = useMutation({
    mutationFn: (id: string) => documentsApi.keepHeading(documentId, id),
    onMutate: () => setError(null),
    onSuccess: () => { setPreview(null); refresh() },
    onError: (err) => setError(errorOf(err, t('component.heading_redraft.error_keep'))),
  })
  const busy = redraft.isPending || accept.isPending || keep.isPending || saveOwn.isPending

  if (!flags) {
    return <div className="flex-1 p-4 text-sm text-slate-500">{t('component.heading_redraft.loading')}</div>
  }
  if (!flag) {
    return (
      <div className="flex-1 overflow-y-auto p-4 text-sm text-slate-700" data-heading-redraft-empty>
        <p>{flags.drafting ? t('component.heading_redraft.drafting') : t('component.heading_redraft.none_flagged')}</p>
        <button type="button" onClick={onClose} className="mt-3 rounded border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">
          {t('component.heading_redraft.close')}
        </button>
      </div>
    )
  }

  const changed = flag.changed.map(c => `${c.number} ${c.title}`).join(', ')
  return (
    <div className="flex-1 overflow-y-auto p-4" data-heading-redraft={flag.number}>
      <p className="font-mono text-[10px] uppercase tracking-widest text-slate-400">
        {t('component.heading_redraft.count', { count: list.length })}
      </p>
      <h4 className="mt-1 text-sm font-bold text-slate-900">{flag.number} {flag.title}</h4>
      <p className="mt-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-900" data-heading-reason={flag.reason}>
        {flag.reason === 'missing'
          ? t('component.heading_redraft.reason_missing')
          : t('component.heading_redraft.reason_stale', { sections: changed })}
      </p>

      {writing && (
        <div className="mt-3" data-heading-write>
          <label htmlFor="heading-intro-text" className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            {t('component.heading_redraft.write_label')}
          </label>
          <textarea
            id="heading-intro-text"
            autoFocus
            rows={9}
            value={writing.text}
            onChange={(e) => setDraft({ sectionId: writing.sectionId, text: e.target.value })}
            placeholder={t('component.heading_redraft.write_placeholder')}
            className="mt-1 w-full resize-y rounded border border-slate-300 bg-white p-3 text-[13px] leading-relaxed text-slate-800 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <p className="mt-1 text-[11px] text-slate-500">{t('component.heading_redraft.write_hint')}</p>
        </div>
      )}

      {!shown && !writing && (
        <div className="mt-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{t('component.heading_redraft.current')}</p>
          <div className="mt-1 rounded border border-slate-200 bg-white p-3">
            {currentHtml.replace(/<[^>]*>/g, '').trim()
              ? <SafeHtml html={currentHtml} />
              : <p className="text-[13px] italic text-slate-400">{t('component.heading_redraft.no_text')}</p>}
          </div>
        </div>
      )}

      {shown && !writing && (
        <div className="mt-3" data-heading-preview>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{t('component.heading_redraft.preview')}</p>
          <div className="mt-1 rounded border border-blue-200 bg-blue-50/40 p-3"><SafeHtml html={shown.html} /></div>
        </div>
      )}

      {error && <ErrorCard error={error} busy={busy} onRetry={error.code ? () => redraft.mutate(flag.sectionId) : undefined} />}

      {flags.canAct ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {writing ? (
            <>
              <button type="button" disabled={busy || !writing.text.trim()} onClick={() => saveOwn.mutate(writing)} data-heading-save-own
                className="rounded bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
                {saveOwn.isPending ? t('component.heading_redraft.saving') : t('component.heading_redraft.save')}
              </button>
              <button type="button" disabled={busy} onClick={() => setDraft(null)} data-heading-cancel-write
                className="rounded border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                {t('component.heading_redraft.cancel')}
              </button>
            </>
          ) : shown ? (
            <>
              <button type="button" disabled={busy} onClick={() => accept.mutate(shown)} data-heading-accept
                className="rounded bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
                {accept.isPending ? t('component.heading_redraft.saving') : t('component.heading_redraft.accept')}
              </button>
              <button type="button" disabled={busy} onClick={() => { setError(null); setDraft({ sectionId: shown.sectionId, text: htmlToText(shown.html) }) }} data-heading-edit-preview
                className="rounded border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                {t('component.heading_redraft.edit')}
              </button>
              <button type="button" disabled={busy} onClick={() => setPreview(null)} data-heading-discard
                className="rounded border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                {t('component.heading_redraft.discard')}
              </button>
            </>
          ) : (
            <>
              <button type="button" disabled={busy} onClick={() => redraft.mutate(flag.sectionId)} data-heading-redraft-ai
                className="rounded bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
                {redraft.isPending ? t('component.heading_redraft.drafting_one') : t('component.heading_redraft.redraft')}
              </button>
              <button type="button" disabled={busy} onClick={() => { setError(null); setDraft({ sectionId: flag.sectionId, text: htmlToText(currentHtml) }) }} data-heading-write-own
                className="rounded border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                {t('component.heading_redraft.write_own')}
              </button>
              <button type="button" disabled={busy} onClick={() => keep.mutate(flag.sectionId)} data-heading-keep
                className="rounded border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                {t('component.heading_redraft.keep')}
              </button>
              <button type="button" disabled={busy} onClick={onClose} data-heading-not-now
                className="rounded px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100 disabled:opacity-50">
                {t('component.heading_redraft.not_now')}
              </button>
            </>
          )}
        </div>
      ) : (
        <p className="mt-4 text-[13px] text-slate-500" data-heading-cannot-act>
          {flags.locked ?? t('component.heading_redraft.cannot_act')}
        </p>
      )}

      {next && (
        <button type="button" disabled={busy} onClick={() => { setPreview(null); setDraft(null); setError(null); onSelect(next.sectionId) }} data-heading-next
          className="mt-6 text-xs font-medium text-blue-700 hover:underline disabled:opacity-50">
          {t('component.heading_redraft.next', { section: `${next.number} ${next.title}` })} →
        </button>
      )}
    </div>
  )
}
