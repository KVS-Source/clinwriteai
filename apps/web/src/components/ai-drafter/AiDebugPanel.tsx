// Verbose AI debug panel — opened from the document editor header.
//
// Renders the GET /documents/:id/ai-debug response as formatted JSON in a
// scrollable pre block with a "Copy to clipboard" button. Intended for
// support + bug-triage: authors can paste the whole blob into a ticket
// to show exactly which policy / AI prompt / BP record was pinned at
// create time, which source uploads the worker attached vs dropped +
// why, the per-section confidence + flags, and the recent AI audit
// events. No mutations — read-only.

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { aiDrafterApi } from '../../api/ai-drafter'
import { ApiError } from '../../api/client'

interface Props {
  documentId: string
  open:       boolean
  onClose:    () => void
}

function errMessage(err: unknown, fallback = 'Request failed'): string {
  if (err instanceof ApiError) {
    const body = err.body as { message?: string; error?: string } | null
    if (body?.message) return body.message
    if (body?.error)   return body.error
    return String(err.status)
  }
  return err instanceof Error ? err.message : fallback
}

export function AiDebugPanel({ documentId, open, onClose }: Props) {
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['ai-debug', documentId],
    queryFn:  () => aiDrafterApi.debug(documentId),
    enabled:  open,
  })
  const [copied, setCopied] = useState(false)

  const prettyJson = data ? JSON.stringify(data, null, 2) : ''

  const onCopy = async () => {
    if (!prettyJson) return
    try {
      await navigator.clipboard.writeText(prettyJson)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      // clipboard denied — fall back to the textarea select approach so the
      // user can still Ctrl+C manually from inside the panel.
      const el = document.querySelector<HTMLTextAreaElement>('[data-ai-debug-json]')
      el?.focus()
      el?.select()
    }
  }

  if (!open) return null

  // Headline summary when data is present — gives the author a one-line
  // read of the most common support scenarios without scrolling the JSON.
  const summary = (() => {
    if (!data) return null
    const d = data as {
      document?:  { aiDraftState?: string | null; aiConfidenceOverall?: number | null }
      sources?:   { totalLinked?: number; usableByDrafter?: number; droppedByDrafter?: number; nonPdfDropped?: number }
      policy?:    { current?: { version?: number } | null; pinnedVersionAtCreate?: number | null }
      sections?:  Array<{ aiSuggestCount?: number }>
      aiStubMode?: boolean
    }
    const parts: string[] = []
    parts.push(`aiDraftState=${d.document?.aiDraftState ?? '—'}`)
    if (typeof d.document?.aiConfidenceOverall === 'number') {
      parts.push(`overall=${d.document.aiConfidenceOverall}%`)
    }
    if (d.sources) {
      const total   = d.sources.totalLinked    ?? 0
      const usable  = d.sources.usableByDrafter ?? 0
      const dropped = d.sources.droppedByDrafter ?? 0
      parts.push(`sources=${total} (${usable} usable, ${dropped} dropped)`)
      if (d.sources.nonPdfDropped) parts.push(`non-PDF=${d.sources.nonPdfDropped}`)
    }
    if (d.policy?.pinnedVersionAtCreate != null) parts.push(`policy=v${d.policy.pinnedVersionAtCreate}`)
    if (Array.isArray(d.sections)) {
      const totalSuggests = d.sections.reduce((s, sec) => s + (sec.aiSuggestCount ?? 0), 0)
      if (totalSuggests > 0) parts.push(`AI rewrites=${totalSuggests}`)
    }
    if (d.aiStubMode) parts.push('stub-mode')
    return parts.join(' · ')
  })()

  // Compact table showing per-section AI usage. Renders above the JSON
  // so the author sees the signal without scrolling.
  type SectionRow = {
    sectionId: string; sectionNumber: string; sectionTitle: string
    aiConfidence: number | null; aiSpanCount: number; humanSpanCount: number
    aiSuggestCount: number
    lastAiAt: string | null; lastAiModel: string | null; lastAiIntent: string | null
    lastEditedAt: string | null
  }
  const sections: SectionRow[] = Array.isArray((data as { sections?: unknown })?.sections)
    ? ((data as { sections: SectionRow[] }).sections)
    : []

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end"
      role="dialog"
      aria-label="AI debug panel"
      data-ai-debug-panel
    >
      {/* Backdrop — click to close. */}
      <div
        className="absolute inset-0 bg-slate-900/40"
        onClick={onClose}
        data-ai-debug-backdrop
      />
      <aside
        className="relative flex h-full w-[640px] max-w-[95vw] flex-col bg-white shadow-2xl"
        style={{ borderLeft: '1px solid #E2E8F0' }}
      >
        <header className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div className="min-w-0">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">
              AI draft debug
            </p>
            <h2 className="mt-1 truncate text-[16px] font-semibold text-slate-900">
              Provenance for document {documentId.slice(0, 10)}…
            </h2>
            {summary && (
              <p className="mt-1 truncate font-mono text-[11px] text-slate-600" data-ai-debug-summary>
                {summary}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex-none rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
            data-action="close-ai-debug"
            aria-label="Close debug panel"
          >
            ✕
          </button>
        </header>

        <div className="flex items-center gap-2 border-b border-slate-200 px-5 py-2">
          <button
            type="button"
            onClick={onCopy}
            disabled={!data}
            className="inline-flex items-center gap-1.5 rounded-md border border-blue-600 bg-blue-600 px-3 py-1 text-[11px] font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:border-slate-300 disabled:bg-slate-300"
            data-action="copy-ai-debug"
            title="Copy the full JSON to your clipboard."
          >
            {/* Copy glyph (SVG so no icon-font dependency). */}
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden>
              <rect x="4" y="4" width="9" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
              <rect x="2" y="2" width="9" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.3" fill="none" />
            </svg>
            {copied ? 'Copied!' : 'Copy JSON'}
          </button>
          <button
            type="button"
            onClick={() => refetch()}
            disabled={isFetching}
            className="rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            data-action="refresh-ai-debug"
            title="Re-fetch the debug snapshot."
          >
            {isFetching ? 'Refreshing…' : 'Refresh'}
          </button>
          <span className="ml-auto font-mono text-[10px] text-slate-400">
            Share with support when a draft didn&apos;t fill as expected.
          </span>
        </div>

        <div className="min-h-0 flex-1 overflow-auto bg-slate-900">
          {isLoading && <p className="p-5 font-mono text-[12px] text-slate-200">Loading snapshot…</p>}
          {error && (
            <p className="p-5 font-mono text-[12px] text-rose-200">
              Could not load debug snapshot: {errMessage(error, 'request failed')}
            </p>
          )}
          {data && sections.length > 0 && (
            <div className="border-b border-slate-700 bg-slate-800 px-5 py-3 text-slate-100" data-ai-debug-sections>
              <p className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-400">
                Per-section AI activity
              </p>
              <table className="w-full font-mono text-[11px] leading-tight">
                <thead className="text-slate-400">
                  <tr>
                    <th className="pr-2 py-0.5 text-left">§</th>
                    <th className="pr-2 py-0.5 text-left">Title</th>
                    <th className="pr-2 py-0.5 text-right">Conf</th>
                    <th className="pr-2 py-0.5 text-right">Suggests</th>
                    <th className="pr-2 py-0.5 text-left">Last AI</th>
                    <th className="pr-2 py-0.5 text-left">Model</th>
                    <th className="py-0.5 text-left">Intent</th>
                  </tr>
                </thead>
                <tbody>
                  {sections.map(s => (
                    <tr key={s.sectionId} className="border-t border-slate-700/50">
                      <td className="pr-2 py-0.5">{s.sectionNumber}</td>
                      <td className="pr-2 py-0.5 truncate max-w-[140px]" title={s.sectionTitle}>{s.sectionTitle}</td>
                      <td className="pr-2 py-0.5 text-right">{s.aiConfidence == null ? '—' : `${s.aiConfidence}%`}</td>
                      <td className="pr-2 py-0.5 text-right">{s.aiSuggestCount || '—'}</td>
                      <td className="pr-2 py-0.5">{s.lastAiAt ? new Date(s.lastAiAt).toLocaleString() : '—'}</td>
                      <td className="pr-2 py-0.5 truncate max-w-[140px]" title={s.lastAiModel ?? ''}>{s.lastAiModel ?? '—'}</td>
                      <td className="py-0.5">{s.lastAiIntent ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {data && (
            <pre
              className="whitespace-pre-wrap break-words px-5 py-4 font-mono text-[11px] leading-relaxed text-slate-100"
              data-ai-debug-json
            >
              {prettyJson}
            </pre>
          )}
        </div>
      </aside>
    </div>
  )
}
