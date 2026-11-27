// Section introductions — the right panel opened from a heading's flag in the section list.
//
// A main heading (a number with sub-sections) gets an introduction written from its sub-sections. It is flagged
// when it has none though its sub-sections do (missing), or when a sub-section changed after it was written
// (stale). One heading at a time: Redraft with AI shows a preview to Accept or Discard; Keep as it is clears the
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
  applyInEditor: (sectionId: string, html: string, model: string, aiCallRecordId: string | null) => boolean
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

const messageOf = (err: unknown, fallback: string) =>
  err instanceof ApiError && err.body && typeof (err.body as { message?: unknown }).message === 'string'
    ? (err.body as { message: string }).message
    : fallback

export function HeadingRedraftPanel({ documentId, sectionId, flags, currentHtml, onSelect, onClose, applyInEditor, onSaved }: Props) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const list = flags?.flags ?? []
  const flag: HeadingFlag | undefined = list.find(f => f.sectionId === sectionId) ?? (sectionId ? undefined : list[0])
  const [preview, setPreview] = useState<{ sectionId: string; html: string; model: string; aiCallRecordId: string | null } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const shown = preview && flag && preview.sectionId === flag.sectionId ? preview : null

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
    onError: (err) => setError(messageOf(err, t('component.heading_redraft.error_redraft'))),
  })
  const accept = useMutation({
    mutationFn: async (p: NonNullable<typeof preview>) => {
      if (applyInEditor(p.sectionId, p.html, p.model, p.aiCallRecordId)) return
      await documentsApi.acceptHeading(documentId, p.sectionId, { html: p.html, model: p.model, ...(p.aiCallRecordId ? { aiCallRecordId: p.aiCallRecordId } : {}) })
      onSaved?.(p.sectionId, p.html)
    },
    onMutate: () => setError(null),
    onSuccess: () => { setPreview(null); refresh() },
    onError: (err) => setError(messageOf(err, t('component.heading_redraft.error_accept'))),
  })
  const keep = useMutation({
    mutationFn: (id: string) => documentsApi.keepHeading(documentId, id),
    onMutate: () => setError(null),
    onSuccess: () => { setPreview(null); refresh() },
    onError: (err) => setError(messageOf(err, t('component.heading_redraft.error_keep'))),
  })
  const busy = redraft.isPending || accept.isPending || keep.isPending

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

      {!shown && (
        <div className="mt-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{t('component.heading_redraft.current')}</p>
          <div className="mt-1 rounded border border-slate-200 bg-white p-3">
            {currentHtml.replace(/<[^>]*>/g, '').trim()
              ? <SafeHtml html={currentHtml} />
              : <p className="text-[13px] italic text-slate-400">{t('component.heading_redraft.no_text')}</p>}
          </div>
        </div>
      )}

      {shown && (
        <div className="mt-3" data-heading-preview>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{t('component.heading_redraft.preview')}</p>
          <div className="mt-1 rounded border border-blue-200 bg-blue-50/40 p-3"><SafeHtml html={shown.html} /></div>
        </div>
      )}

      {error && <p role="alert" className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-800">{error}</p>}

      {flags.canAct ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {shown ? (
            <>
              <button type="button" disabled={busy} onClick={() => accept.mutate(shown)} data-heading-accept
                className="rounded bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
                {accept.isPending ? t('component.heading_redraft.saving') : t('component.heading_redraft.accept')}
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
        <button type="button" disabled={busy} onClick={() => { setPreview(null); setError(null); onSelect(next.sectionId) }} data-heading-next
          className="mt-6 text-xs font-medium text-blue-700 hover:underline disabled:opacity-50">
          {t('component.heading_redraft.next', { section: `${next.number} ${next.title}` })} →
        </button>
      )}
    </div>
  )
}
