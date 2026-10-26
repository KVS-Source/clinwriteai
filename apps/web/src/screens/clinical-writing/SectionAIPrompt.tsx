// AI prompt box pinned to the bottom of the section editor.
//
// Design (2026-10-21 iteration):
//   - Always visible — not gated to edit mode. If the user prompts while
//     viewing, we auto-enter edit mode so the output has somewhere to land.
//   - Single-line textarea that grows as the user types (max ~6 lines)
//   - Enter sends, Shift+Enter inserts a new line
//   - Selection-aware: if the user has highlighted text in the editor,
//     the AI edits ONLY that selection and the UI swaps it in place.
//     Otherwise the AI returns a revised whole section.
//   - Help button next to Send opens the AIPromptHelpPanel (right-rail,
//     doc-type-aware suggestions) which fills the prompt box on pick.
//
// API: POST /documents/:id/sections/:sectionId/ai-suggest
//   { intent: 'edit', customPrompt, currentContent, selectionText? }
//   returns { responseText, model, recordId, scope: 'selection' | 'section' }
//
// Selection-swap uses TipTap's command chain: delete the current range,
// then insert the AI HTML. If the AI returns plain text we insert as
// text to avoid wrapping it in a <p> that would break inline edits.

import { useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { Editor } from '@tiptap/react'
import { api, ApiError } from '../../api/client'
import { useDocumentStore } from '../../store'
import type { SuggestedPrompt } from '../../data/aiPromptLibrary'

interface AiEditResult {
  responseText: string
  model: string
  recordId: string
  scope?: 'selection' | 'section'
}

const ALLOWED_TAGS = new Set(['P', 'H3', 'H4', 'STRONG', 'B', 'EM', 'I', 'U', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD', 'BR'])

/** Keep only plain formatting tags, with no attributes. */
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
        clean(el, out)
      }
    })
  }
  const container = document.createElement('div')
  clean(doc.body.firstElementChild ?? doc.body, container)
  return container.innerHTML.trim()
}

interface Props {
  documentId: string
  sectionId:  string
  /** the section as it is in the editor right now, unsaved changes included */
  currentHtml: string
  /** TipTap editor instance — needed to read selection + apply selection-swap. */
  editor: Editor | null
  /** Whether the user is in edit mode. False → ask the caller to enter edit mode first. */
  isEditing: boolean
  /** Caller enters edit mode when the user first prompts in view mode. */
  onRequestEdit: () => void
  /** Caller applies the accepted HTML to the editor + draft content. */
  onAccept: (html: string, model: string) => void
}

export function SectionAIPrompt({ documentId, sectionId, currentHtml, editor, isEditing, onRequestEdit, onAccept }: Props) {
  const [prompt, setPrompt] = useState('')
  const [result, setResult] = useState<{ html: string; model: string; instruction: string; scope: 'selection' | 'section'; from?: number; to?: number } | null>(null)
  // Context scope — user chooses what the AI sees for this prompt.
  // Default 'section' matches the pre-chat behaviour; 'document' and
  // 'source' expand context server-side when the chat endpoint builds
  // the prompt.
  const [promptScope, setPromptScope] = useState<'section' | 'document' | 'source'>('section')
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const activePanel  = useDocumentStore(s => s.activePanel)
  const setActivePanel = useDocumentStore(s => s.setActivePanel)
  const qc = useQueryClient()
  // Captured editor selection — stored on textarea mouseDown so it survives
  // the focus moving away from the editor to the prompt input. TipTap's
  // internal selection state can collapse on blur; this gives us a stable
  // record of what the user had highlighted when they clicked the prompt.
  // Cleared after each successful send so stale ranges don't leak forward.
  const [savedSel, setSavedSel] = useState<{ from: number; to: number; text: string } | null>(null)

  // Capture before focus moves. mousedown fires BEFORE the browser transfers
  // focus to the textarea, so the editor's state.selection still reflects
  // what the user had highlighted. onPointerDown would also work; mousedown
  // is kept for broader browser consistency.
  const captureSelectionFromEditor = () => {
    if (!editor) return
    const { from, to } = editor.state.selection
    if (from === to) return                                             // nothing selected — don't overwrite a prior capture
    const text = editor.state.doc.textBetween(from, to, ' ', ' ').trim()
    if (text.length === 0) return
    setSavedSel({ from, to, text })
  }

  // Listen for pick events fired by AIPromptHelpPanel. CustomEvent payload
  // = the prompt text to pre-fill. We don't auto-submit — give the user a
  // chance to tweak before sending.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ prompt: string }>).detail
      if (detail?.prompt) {
        setPrompt(detail.prompt)
        inputRef.current?.focus()
      }
    }
    document.addEventListener('ai-prompt-pick', handler)
    return () => document.removeEventListener('ai-prompt-pick', handler)
  }, [])

  // Auto-grow textarea: single line → up to ~6 lines of content.
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    const max = 160  // ~6 lines @ ~26px
    el.style.height = `${Math.min(el.scrollHeight, max)}px`
  }, [prompt])

  const ask = useMutation({
    mutationFn: (vars: { instruction: string; selectionText: string | undefined; savedRange?: { from: number; to: number } }) => api.post<AiEditResult>(
      `/documents/${documentId}/sections/${encodeURIComponent(sectionId)}/ai-suggest`,
      {
        intent:         'edit',
        customPrompt:   vars.instruction,
        currentContent: currentHtml,
        scope:          promptScope,
        ...(vars.selectionText ? { selectionText: vars.selectionText } : {}),
      },
    ),
    onSuccess: (data, vars) => {
      const scope = data.scope ?? (vars.selectionText ? 'selection' : 'section')
      // Pull from/to from the saved selection (captured on mouseDown before
      // focus moved) rather than the live editor state, which may have
      // collapsed when the user clicked the textarea.
      const range = vars.savedRange
      setResult({
        html:        sanitizeAiHtml(data.responseText),
        model:       data.model,
        instruction: vars.instruction,
        scope,
        from:        scope === 'selection' && range ? range.from : undefined,
        to:          scope === 'selection' && range ? range.to   : undefined,
      })
      // Server also wrote user+assistant turns to the chat thread for this
      // (user, section). Refresh the AIChatPanel so it reflects the new
      // exchange immediately regardless of which surface the user looks at.
      qc.invalidateQueries({ queryKey: ['ai-chat', documentId, sectionId] })
      setPrompt('')
      // Clear the saved selection so it doesn't leak into the next prompt.
      setSavedSel(null)
    },
  })

  // Prefer the mouseDown-captured range so a selection isn't lost the moment
  // the user clicks the prompt input. Falls back to the live editor state
  // when nothing was captured (e.g. the user used the keyboard to jump
  // straight to the prompt without clicking).
  const readSelection = (): { from: number; to: number; text: string } | null => {
    if (savedSel) return savedSel
    if (!editor) return null
    const { from, to } = editor.state.selection
    if (from === to) return null
    const text = editor.state.doc.textBetween(from, to, ' ', ' ').trim()
    return text.length === 0 ? null : { from, to, text }
  }

  const send = () => {
    const instruction = prompt.trim()
    if (!instruction || ask.isPending) return
    if (!isEditing) onRequestEdit()
    setResult(null)
    const sel = readSelection()
    ask.mutate({ instruction, selectionText: sel?.text, savedRange: sel ? { from: sel.from, to: sel.to } : undefined })
  }

  const applyAccept = () => {
    if (!result) return
    if (result.scope === 'selection' && editor && result.from != null && result.to != null) {
      // Replace just the stored range. If the AI returned pure inline text
      // (no block tags), insert as plain text to avoid wrapping in <p>.
      const html = result.html
      const inline = !/<(p|h3|h4|ul|ol|li|blockquote|table|thead|tbody|tr|th|td)[>\s]/i.test(html)
      editor.chain().focus().setTextSelection({ from: result.from, to: result.to })
        .deleteSelection()
        .insertContent(inline ? stripInlineTags(html) : html)
        .run()
      // Caller tracks AI model for Part 11 provenance on the next Save.
      onAccept(editor.getHTML(), result.model)
    } else {
      onAccept(result.html, result.model)
    }
    setResult(null)
  }

  const error = ask.isError
    ? ask.error instanceof ApiError
      ? ask.error.status === 429 ? 'This tenant has reached its monthly AI budget. Ask an admin to raise the cap.'
        : ask.error.status === 503 ? 'The AI service is temporarily unavailable. Try again shortly.'
          : `The AI request failed (HTTP ${ask.error.status}). Try again.`
      : 'The AI request failed. Try again.'
    : null

  const hasSelection = !!readSelection()
  const placeholder = hasSelection
    ? 'Edit the highlighted selection — e.g. "convert kg to lbs"'
    : 'Select text to edit a passage, or type to edit the entire section'

  return (
    <div data-section-ai-prompt>
      {result && (
        <div className="mb-3 rounded-lg border border-blue-200 bg-blue-50/40" data-ai-edit-preview>
          <div className="flex items-center justify-between gap-2 border-b border-blue-100 px-4 py-2">
            <p className="min-w-0 truncate text-[11px] text-slate-600">
              <span className="font-semibold text-blue-800">AI suggestion</span>
              <span className={`ml-2 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase ${result.scope === 'selection' ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-600'}`}>{result.scope}</span>
              <span className="ml-2 text-slate-500">· {result.model} · "{result.instruction}"</span>
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
            <button type="button" disabled={!result.html} onClick={applyAccept} data-action="ai-edit-accept"
              className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300">
              {result.scope === 'selection' ? 'Replace selection' : 'Accept into editor'}
            </button>
          </div>
        </div>
      )}

      {/* True single-row layout — textarea + buttons share one line. Still
          grows vertically when the user Shift+Enters, but starts at a
          single row's height so the widget's resting state is minimal. */}
      <div
        // mousedown fires before focus moves. Catching it on the wrapper
        // means any click inside the prompt dock (textarea, scope chip,
        // help button, send button) captures the editor selection before
        // it collapses from focus loss.
        onMouseDown={captureSelectionFromEditor}
        className="flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-1.5 shadow-sm focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-100"
      >
        <textarea
          ref={inputRef}
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send() }
            if (e.key === 'Escape' && activePanel === 'ai-help') { e.preventDefault(); setActivePanel(null) }
          }}
          rows={1}
          maxLength={2000}
          disabled={ask.isPending}
          placeholder={ask.isPending ? (hasSelection ? 'Editing the selection…' : 'Editing the section…') : placeholder}
          aria-label="Ask AI to edit this section or selection"
          title="Enter to send · Shift+Enter for new line"
          data-field="ai-edit-prompt"
          className="block max-h-40 min-h-[28px] flex-1 resize-none border-0 bg-transparent py-1 text-[13px] text-slate-800 outline-none placeholder:text-slate-400 disabled:opacity-60"
        />
        {/* Scope chip — picks what context the AI sees for this prompt.
            Default 'section' matches the pre-chat behaviour. */}
        <select
          value={promptScope}
          onChange={e => setPromptScope(e.currentTarget.value as 'section' | 'document' | 'source')}
          disabled={ask.isPending}
          title="Context scope — what content the AI sees for this prompt"
          data-ai-prompt-scope
          className="rounded-md border border-slate-300 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 outline-none hover:bg-slate-50 disabled:opacity-60"
        >
          <option value="section">Section</option>
          <option value="document">Document</option>
          <option value="source">Source docs</option>
        </select>
        <button
          type="button"
          onClick={() => setActivePanel(activePanel === 'ai-help' ? null : 'ai-help')}
          aria-label="Show prompt suggestions"
          title="Prompt suggestions"
          data-ai-help-button
          className={`flex h-7 w-7 flex-none items-center justify-center rounded-lg border transition-colors ${activePanel === 'ai-help' ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-slate-300 bg-white text-slate-500 hover:bg-slate-50'}`}
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="8" cy="8" r="6.4" />
            <path d="M6.2 6.3a1.8 1.8 0 1 1 2.6 1.5c-.5.3-.8.6-.8 1.2" />
            <circle cx="8" cy="11.6" r="0.4" fill="currentColor" />
          </svg>
        </button>
        <button type="button" onClick={send} disabled={!prompt.trim() || ask.isPending} aria-label="Send to AI" title="Enter to send · Shift+Enter for new line" data-action="ai-edit-send"
          className="flex h-7 w-7 flex-none items-center justify-center rounded-lg bg-blue-600 text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300">
          {ask.isPending
            ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden="true" />
            : <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" /></svg>}
        </button>
      </div>
      {error && <p role="alert" className="mt-2 text-xs text-red-700" data-ai-edit-error>{error}</p>}
    </div>
  )
}

// Export a helper the panel calls to pick a prompt — fires a DOM event the
// SectionAIPrompt listens for. Keeps the two components loosely coupled
// (no shared global state needed).
export function pickPrompt(p: SuggestedPrompt): void {
  document.dispatchEvent(new CustomEvent('ai-prompt-pick', { detail: { prompt: p.prompt } }))
}

/** Strip <p>, <br>, etc. wrappers from inline AI text so it inserts clean. */
function stripInlineTags(html: string): string {
  return html.replace(/<\/?(p|br)\s*\/?>/gi, '').trim()
}
