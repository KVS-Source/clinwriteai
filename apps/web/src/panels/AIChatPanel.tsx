// AI Chat panel (sPM-ai-chat) — Claude.ai-style per-section conversation.
//
// Replaces the preset-button AIAssistPanel. Shows the current user's full
// conversation thread for the active section (private per user; team edit
// history remains the team-wide audit surface).
//
// Interactions:
//   - Type a prompt + hit Send (or Enter). Prompt + response land in the
//     thread. If the response is "suggested text" (intent != explain), an
//     Accept button on the assistant message copies it into the section
//     via the parent's onAcceptSuggestion callback.
//   - Scope selector chip above the input picks what context the LLM gets:
//     Section (default) · Document · Source documents.
//   - Prompts fired from the bottom SectionAIPrompt dock also land here —
//     this panel is the canonical conversation view.
//
// Design decisions:
//   - Pure chat (no preset-button quick-shortcuts); the Help panel already
//     surfaces suggested prompts in the dock.
//   - Each prompt is single-shot — the LLM only sees the content the scope
//     chip said to attach. Thread persists for VIEWING only.

import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Editor } from '@tiptap/react'
import { api, ApiError } from '../api/client'
import { documentsApi } from '../api'
import { sanitizeAiHtml } from '../screens/clinical-writing/SectionAIPrompt'

interface Props {
  documentId: string
  sectionId: string | null
  sectionLabel?: string
  /** TipTap editor instance — needed to read the selection on mouseDown
   *  so a highlight isn't lost the moment the user clicks the chat input. */
  editor: Editor | null
  /** Called when the user clicks Accept on an assistant message that
   *  carried replacement text. If `range` is provided, the parent should
   *  replace just that editor range; otherwise swap the whole section. */
  onAcceptSuggestion: (html: string, model: string, range?: { from: number; to: number }) => void
}

type Scope = 'section' | 'document' | 'source'

interface AiResult {
  responseText: string
  model: string
  recordId: string
  scope?: 'section' | 'selection'
}

const SCOPE_LABEL: Record<Scope, string> = {
  section:  'Section',
  document: 'Document',
  source:   'Source docs',
}

const SCOPE_TITLE: Record<Scope, string> = {
  section:  'Only this section is sent to the AI (default)',
  document: 'All sections of this document are sent to the AI',
  source:   'Linked source documents (titles only for now; full-text attachment lands later)',
}

export function AIChatPanel({ documentId, sectionId, sectionLabel, editor, onAcceptSuggestion }: Props) {
  const qc = useQueryClient()
  const [prompt, setPrompt] = useState('')
  const [scope, setScope]   = useState<Scope>('section')
  // 'edit' = the backend's HTML-returning path (same as the bottom dock).
  // 'explain' = plain-prose answer, no Accept button.
  const [intent, setIntent] = useState<'edit' | 'explain'>('edit')
  const inputRef    = useRef<HTMLTextAreaElement>(null)
  const bottomRef   = useRef<HTMLDivElement>(null)
  // Captured editor selection — stored on mousedown of the panel's input
  // wrapper so it survives focus moving from the editor to the chat input.
  // Same pattern as SectionAIPrompt.
  const [savedSel, setSavedSel] = useState<{ from: number; to: number; text: string } | null>(null)
  // Range tracked per-assistant-message so Accept can swap just the right
  // span even after other turns have landed. Populated on send-success.
  const [rangesByMessageId, setRangesByMessageId] = useState<Record<string, { from: number; to: number }>>({})

  // mousedown fires before focus moves. Click on the textarea, scope chip,
  // intent chip, or send button — all catch here so the editor selection
  // doesn't collapse before we read it.
  const captureSelectionFromEditor = () => {
    if (!editor) return
    const { from, to } = editor.state.selection
    if (from === to) return
    const text = editor.state.doc.textBetween(from, to, ' ', ' ').trim()
    if (text.length === 0) return
    setSavedSel({ from, to, text })
  }

  const chatQ = useQuery({
    queryKey: ['ai-chat', documentId, sectionId],
    queryFn:  () => documentsApi.getAiChat(documentId, sectionId!),
    enabled:  !!sectionId,
  })

  // Auto-scroll to the newest message on each refresh.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [chatQ.data?.messages.length])

  // Textarea auto-grow (max ~6 lines).
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }, [prompt])

  const send = useMutation({
    mutationFn: (vars: { instruction: string; intentValue: 'edit' | 'explain'; scopeValue: Scope; selectionText?: string }) => {
      if (!sectionId) throw new Error('no_active_section')
      return api.post<AiResult>(
        `/documents/${documentId}/sections/${encodeURIComponent(sectionId)}/ai-suggest`,
        {
          intent:       vars.intentValue,
          customPrompt: vars.instruction,
          scope:        vars.scopeValue,
          ...(vars.selectionText ? { selectionText: vars.selectionText } : {}),
        },
      )
    },
    onSuccess: async (_data, vars) => {
      setPrompt('')
      // Refresh the thread, then if this prompt had a selection, map the
      // newest assistant message id to the captured range so Accept can
      // replace just that span.
      await qc.invalidateQueries({ queryKey: ['ai-chat', documentId, sectionId] })
      if (vars.selectionText && savedSel) {
        const latest = await documentsApi.getAiChat(documentId, sectionId!)
        const assistant = [...latest.messages].reverse().find(m => m.role === 'assistant')
        if (assistant) {
          setRangesByMessageId(prev => ({ ...prev, [assistant.id]: { from: savedSel.from, to: savedSel.to } }))
        }
      }
      // Clear captured selection so stale ranges don't leak into the next prompt.
      setSavedSel(null)
    },
  })

  const accept = useMutation({
    mutationFn: ({ messageId }: { messageId: string; html: string; model: string }) =>
      documentsApi.acceptAiChatMessage(messageId),
    onSuccess: (_data, vars) => {
      const range = rangesByMessageId[vars.messageId]
      onAcceptSuggestion(vars.html, vars.model, range)
      qc.invalidateQueries({ queryKey: ['ai-chat', documentId, sectionId] })
    },
  })

  const handleSend = () => {
    const text = prompt.trim()
    if (!text || send.isPending) return
    send.mutate({
      instruction:   text,
      intentValue:   intent,
      scopeValue:    scope,
      selectionText: savedSel?.text,
    })
  }

  if (!sectionId) {
    return (
      <div className="flex-1 overflow-y-auto p-4">
        <p className="text-[13px] text-slate-500">Select a section first — the chat is per-section.</p>
      </div>
    )
  }

  const messages = chatQ.data?.messages ?? []
  const errorText = send.isError
    ? send.error instanceof ApiError
      ? send.error.status === 429 ? 'This tenant has reached its monthly AI budget. Ask an admin to raise the cap.'
        : send.error.status === 503 ? 'The AI service is temporarily unavailable. Try again shortly.'
          : `AI call failed (HTTP ${send.error.status}).`
      : 'AI call failed.'
    : null

  return (
    <div className="flex flex-1 flex-col overflow-hidden" data-panel="ai-chat">
      {/* Header */}
      <div className="flex-none border-b border-slate-200 px-4 py-3">
        <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">
          {sectionLabel ?? 'Current section'}
        </p>
        <p className="mt-0.5 text-[11px] text-slate-500">
          Your conversation on this section — private to you. The team-wide
          Section History panel shows what actually landed in the document.
        </p>
      </div>

      {/* Thread */}
      <div className="flex-1 overflow-y-auto px-4 py-3" data-chat-thread>
        {messages.length === 0 && !send.isPending && (
          <p className="mt-6 rounded-md border border-dashed border-slate-300 bg-slate-50 p-4 text-center text-[12px] text-slate-500">
            No conversation yet. Type a prompt below to get started.
          </p>
        )}
        <ul className="flex flex-col gap-3">
          {messages.map(m => (
            <li
              key={m.id}
              className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
              data-chat-message
              data-role={m.role}
            >
              <div
                className={`max-w-[85%] rounded-lg px-3 py-2 text-[13px] leading-relaxed ${
                  m.role === 'user'
                    ? 'bg-blue-600 text-white'
                    : 'border border-slate-200 bg-white text-slate-800'
                }`}
              >
                {m.role === 'user' && m.scope && m.scope !== 'section' && (
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider opacity-80">
                    Scope: {SCOPE_LABEL[m.scope as Scope]}
                  </p>
                )}
                {/* Suggest responses come back as HTML (intent='edit'). Render
                    them sanitised so the user sees proper paragraphs/lists.
                    Everything else (user turns, explain responses) renders
                    as pre-wrapped text. */}
                {m.role === 'assistant' && m.kind === 'suggest' ? (
                  <div
                    className="prose prose-sm max-w-none text-[13px] leading-relaxed [&_h3]:mt-2 [&_h3]:text-[14px] [&_h3]:font-semibold [&_li]:ml-5 [&_ol]:list-decimal [&_p]:mb-2 [&_ul]:list-disc"
                    dangerouslySetInnerHTML={{ __html: sanitizeAiHtml(m.content) }}
                  />
                ) : (
                  <p className="whitespace-pre-wrap">{m.content}</p>
                )}
                {m.role === 'assistant' && (
                  <div className="mt-2 flex items-center justify-between gap-2 border-t border-slate-100 pt-1.5 text-[10px] text-slate-500">
                    <span>
                      {m.aiModel ?? 'ai'}
                      {m.appliedToSection ? ' · ✓ Applied' : ''}
                    </span>
                    {m.kind === 'suggest' && !m.appliedToSection && (
                      <button
                        type="button"
                        onClick={() => accept.mutate({ messageId: m.id, html: sanitizeAiHtml(m.content), model: m.aiModel ?? 'ai' })}
                        disabled={accept.isPending}
                        className="rounded-md bg-emerald-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-emerald-700 disabled:bg-slate-300"
                      >
                        {accept.isPending ? 'Applying…' : 'Accept into section'}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </li>
          ))}
          {send.isPending && (
            <li className="flex justify-start">
              <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-[12px] text-slate-500">
                Thinking…
              </div>
            </li>
          )}
        </ul>
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="flex-none border-t border-slate-200 px-4 py-3">
        {errorText && (
          <p role="alert" className="mb-2 text-[11px] text-rose-700">{errorText}</p>
        )}
        {savedSel && (
          <div className="mb-2 flex items-center justify-between gap-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-800" data-selection-badge>
            <span className="truncate">
              <strong>Selected:</strong> "{savedSel.text.length > 60 ? `${savedSel.text.slice(0, 60)}…` : savedSel.text}"
            </span>
            <button
              type="button"
              onClick={() => setSavedSel(null)}
              className="rounded px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 hover:bg-amber-100"
              aria-label="Clear selection"
            >Clear</button>
          </div>
        )}
        <div
          onMouseDown={captureSelectionFromEditor}
          className="rounded-xl border border-slate-300 bg-white shadow-sm focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-100"
        >
          <textarea
            ref={inputRef}
            value={prompt}
            onChange={e => setPrompt(e.currentTarget.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                handleSend()
              }
            }}
            rows={1}
            maxLength={2000}
            disabled={send.isPending}
            placeholder="Ask about this section, or request a rewrite…"
            aria-label="Ask the AI"
            className="block max-h-40 min-h-[36px] w-full resize-none rounded-t-xl border-0 bg-transparent px-3 pt-2 text-[13px] text-slate-800 outline-none placeholder:text-slate-400 disabled:opacity-60"
          />
          <div className="flex items-center justify-between gap-2 px-2 pb-2">
            <div className="flex items-center gap-1.5" data-chat-scope>
              {(['section', 'document', 'source'] as Scope[]).map(s => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setScope(s)}
                  title={SCOPE_TITLE[s]}
                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold transition-colors ${scope === s ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                >{SCOPE_LABEL[s]}</button>
              ))}
              <span className="mx-1 h-3 w-px bg-slate-200" />
              {(['edit', 'explain'] as const).map(k => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setIntent(k)}
                  title={k === 'edit' ? 'Ask for a change — produces replacement text with an Accept button' : 'Ask a question — gets a plain-English answer in the chat'}
                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold transition-colors ${intent === k ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                >{k === 'edit' ? 'Edit' : 'Explain'}</button>
              ))}
            </div>
            <button
              type="button"
              onClick={handleSend}
              disabled={!prompt.trim() || send.isPending}
              aria-label="Send to AI"
              className="flex h-7 w-7 flex-none items-center justify-center rounded-lg bg-blue-600 text-white transition-colors hover:bg-blue-700 disabled:bg-slate-300"
            >
              {send.isPending
                ? <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden="true" />
                : <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" /></svg>}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
