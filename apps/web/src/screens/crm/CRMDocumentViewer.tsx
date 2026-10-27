// Read-only document viewer overlay for the CRM meeting screen.
//
// When the chair clicks "View document →" during a Comments Resolution
// Meeting, they want to glance at the section a comment cites — not fall
// into the full editor and risk editing / touching AI Chat / switching
// versions mid-meeting. This overlay serves the document bytes as plain
// HTML, panel-sized, dismissible on X / Esc / backdrop click.
//
// Section auto-scroll: when the viewer opens (or the chair picks a
// different comment from the queue) we scroll the section matching
// `jumpToSectionRef` into view and briefly highlight it so the chair's
// eye lands on the right block without manual scrolling.

import { useEffect, useMemo, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { documentsApi } from '../../api'
import type { Document } from '@platform/types'

interface Props {
  documentId: string
  /** Section the overlay should scroll into view on open / on prop change.
   *  Accepts "§15", "15", "§11.4.1" — the match is on normalized `section.id`. */
  jumpToSectionRef?: string | null
  /** 1-based position of the active comment in the queue, for the "Comment N of M" chip. */
  commentIndex?: number | null
  commentTotal?: number | null
  /** Short label for the active comment ("§15 · Minor") rendered next to the chip. */
  commentLabel?: string | null
  onClose: () => void
}

/** "§15" | "15" | "§11.4.1" → "15" | "11.4.1" so matching against
 *  section.id (which also normalizes without the §) works both ways. */
function normalizeRef(ref: string | null | undefined): string {
  return (ref ?? '').replace(/^§/, '').trim()
}

export function CRMDocumentViewer({ documentId, jumpToSectionRef, commentIndex, commentTotal, commentLabel, onClose }: Props) {
  const { data: document } = useQuery<Document>({
    queryKey: ['document', documentId],
    queryFn:  () => documentsApi.get(documentId),
    enabled:  !!documentId,
  })

  const containerRef = useRef<HTMLDivElement>(null)

  // Dismiss on Esc + lock body scroll while open. The CRM screen behind us
  // stays rendered but non-interactive thanks to the dimmed backdrop.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose() }
    }
    window.document.addEventListener('keydown', onKey)
    const prevOverflow = window.document.body.style.overflow
    window.document.body.style.overflow = 'hidden'
    return () => {
      window.document.removeEventListener('keydown', onKey)
      window.document.body.style.overflow = prevOverflow
    }
  }, [onClose])

  // Scroll the targeted section into view when the viewer opens or the
  // caller passes a different section ref. The section must have already
  // rendered — rAF defers to the next paint so the DOM is ready.
  const target = normalizeRef(jumpToSectionRef)
  useEffect(() => {
    if (!target || !containerRef.current || !document) return
    const raf = window.requestAnimationFrame(() => {
      const el = containerRef.current?.querySelector<HTMLElement>(`[data-section-id="${CSS.escape(target)}"]`)
      if (!el) return
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      // Flash a brief highlight so the chair's eye lands here.
      el.classList.add('crm-doc-flash')
      window.setTimeout(() => el.classList.remove('crm-doc-flash'), 1600)
    })
    return () => window.cancelAnimationFrame(raf)
  }, [target, document])

  const sections = useMemo(() => document?.sections ?? [], [document])

  return (
    <div
      className="fixed inset-0 z-40 flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-label="Document viewer (read-only)"
      data-crm-doc-viewer
    >
      {/* Backdrop — dims the CRM screen; click dismisses. */}
      <div
        className="absolute inset-0 bg-slate-900/40 transition-opacity"
        onClick={onClose}
      />

      {/* Panel — fixed-width slide-in from the right. */}
      <div
        className="relative flex h-full w-[60vw] min-w-[560px] max-w-[1100px] flex-col border-l border-slate-200 bg-white shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex flex-none items-center justify-between gap-4 border-b border-slate-200 px-6 py-3.5">
          <div className="flex min-w-0 items-center gap-3">
            <span className="rounded-full bg-blue-50 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-blue-700">
              Read-only
            </span>
            <h2 className="truncate text-base font-bold text-slate-900">
              {document?.title ?? 'Loading…'}
            </h2>
            {document?.version && (
              <span className="flex-none font-mono text-[11px] font-medium text-slate-500">
                {document.version}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close viewer"
            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <line x1="4" y1="4" x2="12" y2="12" />
              <line x1="12" y1="4" x2="4" y2="12" />
            </svg>
          </button>
        </div>

        {/* Sticky "Comment N of M" chrome — tells the chair which comment
            drove the current auto-scroll + which section is highlighted.
            Only renders when the caller passes commentIndex/Total, so the
            viewer still works standalone (e.g. opened without any queue
            selection) without a dead ribbon. */}
        {commentIndex != null && commentTotal != null && commentTotal > 0 && (
          <div
            className="flex flex-none items-center gap-2 border-b border-amber-200 bg-amber-50/80 px-6 py-1.5 text-[11px] text-amber-900"
            data-crm-viewer-chrome
          >
            <span className="font-mono font-semibold">Comment {commentIndex} of {commentTotal}</span>
            {commentLabel && (
              <>
                <span className="text-amber-400">·</span>
                <span className="truncate">{commentLabel}</span>
              </>
            )}
            <span className="ml-auto text-amber-700/70">Scrolled to the cited section</span>
          </div>
        )}

        {/* Body — scrollable section list. No TipTap, no toolbar, no AI,
            no version switcher, no section lock. Pure HTML preview. */}
        <div
          ref={containerRef}
          className="flex-1 overflow-y-auto px-10 py-6"
        >
          {!document && (
            <p className="text-sm text-slate-400">Loading document…</p>
          )}
          {document && sections.length === 0 && (
            <p className="text-sm italic text-slate-400">This document has no sections.</p>
          )}
          {sections.map(s => (
            <section
              key={s.id}
              data-section-id={s.id}
              className="mb-10 scroll-mt-6 rounded-md border border-transparent px-2 py-1 transition-colors"
            >
              <h3 className="mb-3 font-mono text-[11px] font-semibold uppercase tracking-widest text-slate-500">
                §{s.number} {s.title}
              </h3>
              {s.contentHtml
                ? (
                  <div
                    className="prose prose-sm max-w-none font-serif text-[14px] leading-[1.75] text-slate-900"
                    dangerouslySetInnerHTML={{ __html: s.contentHtml }}
                  />
                )
                : (
                  <p className="text-[13px] italic text-slate-400">(Empty section)</p>
                )}
            </section>
          ))}
        </div>

        {/* Footer — compact reminder of why they can't edit here. */}
        <div className="flex flex-none items-center justify-between gap-4 border-t border-slate-200 bg-slate-50 px-6 py-2 text-[11px] text-slate-500">
          <span>Read-only during meeting · edits go through the Editor tab after resolution</span>
          <span className="font-mono">Esc to close</span>
        </div>
      </div>

      {/* Scoped flash animation for the auto-scroll target. */}
      <style>{`
        .crm-doc-flash {
          background-color: #FEF3C7;
          border-color: #FDE68A !important;
          box-shadow: 0 0 0 3px rgba(253,224,71,0.25);
        }
      `}</style>
    </div>
  )
}
