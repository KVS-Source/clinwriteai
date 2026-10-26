// AI prompt box under the section editor (edit mode). The user describes a change ("tighten to
// three sentences", "fix tense"), the AI returns the whole revised section, and it is shown as a
// preview. Nothing changes until Accept — which puts the text into the editor; Save Section then
// commits it as AI-drafted with the model recorded (FR-A-020 human review, FR-A-021 provenance).
//
// API: POST /documents/:id/sections/:sectionId/ai-suggest { intent: 'edit', customPrompt, currentContent }

import { useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { api, ApiError } from '../../api/client'

interface AiEditResult { responseText: string; model: string; recordId: string }

const ALLOWED_TAGS = new Set(['P', 'H3', 'H4', 'STRONG', 'B', 'EM', 'I', 'U', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD', 'BR'])

/** Keep only plain formatting tags, with no attributes — the preview renders model output as HTML. */
export function sanitizeAiHtml(html: string): string {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html')
  const clean = (node: Node, out: Node) => {
    node.childNodes.forEach(child => {
      if (child.nodeType === Node.TEXT_NODE) { out.appendChild(document.createTextNode(child.textContent ?? '')); return }
      if (child.nodeType !== Node.ELEMENT_NODE) return
      const el = child as Element
      if (['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'TEMPLATE'].includes(el.tagName)) return
      if (ALLOWED_TAGS.has(el.tagName)) {
        const copy = document.createElement(el.tagName.toLowerCase())
        clean(el, copy)
        out.appendChild(copy)
      } else {
        clean(el, out)   // unknown wrapper (div, span, …): keep its contents
      }
    })
  }
  const container = document.createElement('div')
  clean(doc.body.firstElementChild ?? doc.body, container)
  return container.innerHTML.trim()
}

interface Props {
  documentId: string
  sectionId: string
  /** the section as it is in the editor right now, unsaved changes included */
  currentHtml: string
  onAccept: (html: string, model: string) => void
}

export function SectionAIPrompt({ documentId, sectionId, currentHtml, onAccept }: Props) {
  const [prompt, setPrompt] = useState('')
  const [result, setResult] = useState<{ html: string; model: string; instruction: string } | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const ask = useMutation({
    mutationFn: (instruction: string) => api.post<AiEditResult>(
      `/documents/${documentId}/sections/${encodeURIComponent(sectionId)}/ai-suggest`,
      { intent: 'edit', customPrompt: instruction, currentContent: currentHtml },
    ),
    onSuccess: (data, instruction) => {
      setResult({ html: sanitizeAiHtml(data.responseText), model: data.model, instruction })
      setPrompt('')
    },
  })

  const send = () => {
    const instruction = prompt.trim()
    if (!instruction || ask.isPending) return
    setResult(null)
    ask.mutate(instruction)
  }

  const error = ask.isError
    ? ask.error instanceof ApiError
      ? ask.error.status === 429 ? 'This tenant has reached its monthly AI budget. Ask an admin to raise the cap.'
        : ask.error.status === 503 ? 'The AI service is temporarily unavailable. Try again shortly.'
          : `The AI request failed (HTTP ${ask.error.status}). Try again.`
      : 'The AI request failed. Try again.'
    : null

  return (
    <div className="mt-4" data-section-ai-prompt>
      {result && (
        <div className="mb-3 rounded-lg border border-blue-200 bg-blue-50/40" data-ai-edit-preview>
          <div className="flex items-center justify-between gap-2 border-b border-blue-100 px-4 py-2">
            <p className="min-w-0 truncate text-[11px] text-slate-600">
              <span className="font-semibold text-blue-800">AI suggestion</span> · {result.model} · “{result.instruction}”
            </p>
            <span className="flex-none rounded bg-blue-100 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-blue-700">PREVIEW</span>
          </div>
          {result.html
            ? <div className="max-h-80 overflow-y-auto px-4 py-3 text-[14px] leading-relaxed text-slate-800 [&_li]:ml-5 [&_ol]:list-decimal [&_p]:mb-2 [&_ul]:list-disc"
                dangerouslySetInnerHTML={{ __html: result.html }} data-ai-edit-html />
            : <p className="px-4 py-3 text-[13px] italic text-slate-500">The AI returned no content.</p>}
          <div className="flex items-center justify-end gap-2 border-t border-blue-100 px-4 py-2">
            <button type="button" onClick={() => { setResult(null); inputRef.current?.focus() }} data-action="ai-edit-discard"
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
              Discard
            </button>
            <button type="button" disabled={!result.html} onClick={() => { onAccept(result.html, result.model); setResult(null) }} data-action="ai-edit-accept"
              className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300">
              Accept into editor
            </button>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-slate-300 bg-white shadow-sm focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-100">
        <textarea
          ref={inputRef}
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send() } }}
          rows={2}
          maxLength={2000}
          disabled={ask.isPending}
          placeholder="Ask AI to edit this section — e.g. “tighten to three sentences” or “fix grammar and tense”"
          aria-label="Ask AI to edit this section"
          data-field="ai-edit-prompt"
          className="block max-h-40 min-h-[56px] w-full resize-y rounded-t-xl border-0 bg-transparent px-4 pt-3 text-[13px] text-slate-800 outline-none placeholder:text-slate-400 disabled:opacity-60"
        />
        <div className="flex items-center justify-between gap-2 px-3 pb-2">
          <p className="text-[11px] text-slate-400">
            {ask.isPending ? 'Editing the section…' : 'Enter to send · Shift+Enter for a new line · you review the change before it’s applied'}
          </p>
          <button type="button" onClick={send} disabled={!prompt.trim() || ask.isPending} aria-label="Send to AI" data-action="ai-edit-send"
            className="flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-blue-600 text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300">
            {ask.isPending
              ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden="true" />
              : <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" /></svg>}
          </button>
        </div>
      </div>
      {error && <p role="alert" className="mt-2 text-xs text-red-700" data-ai-edit-error>{error}</p>}
    </div>
  )
}
