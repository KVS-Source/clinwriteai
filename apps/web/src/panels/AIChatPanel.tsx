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
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Editor } from '@tiptap/react'
import { api, ApiError } from '../api/client'
import { documentsApi } from '../api'
import { sanitizeAiHtml } from '../screens/clinical-writing/SectionAIPrompt'
import { useDocumentStore } from '../store'
import { useAiConfigured } from '../hooks/useAiConfigured'

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
  onAcceptSuggestion: (html: string, model: string, range?: { from: number; to: number }, aiCallRecordId?: string | null) => void
  /** False when the user doesn't hold the SectionLock or the doc is in review.
   *  The Accept button is disabled with an explanatory title. Defaults to true
   *  for callers that haven't adopted the lock-aware signature yet. */
  canEditSection?: boolean
  /** Human reason the section isn't editable — surfaced on the disabled
   *  Accept button's tooltip + inline next to it. */
  cannotEditReason?: string
}

// Scope union preserved for the mutation shape (backend still accepts
// 'section' | 'document' | 'source'). The picker that used to drive it
// is gone — scope is inferred from prompt text via classifyScope now.
// 'source' is unused in v1 UI — it will come back as an explicit
// "attach source" action rather than a scope mode. See follow-up.
type Scope = 'section' | 'document' | 'source'

// The four escape-hatch token types the server-side carry prompt
// trains the model to emit instead of fabricating. Mirrors FlagTokenType
// on the server; the web type package doesn't ship this yet.
type FlagTokenType =
  | 'information_required'
  | 'conflict'
  | 'reference_verification_required'
  | 'missing_cross_ref_target'

interface AiResult {
  responseText: string
  model: string
  recordId: string
  scope?: 'section' | 'selection'
}

// Scope + intent are both inferred from the prompt — the chip rows at
// the bottom of the composer were cognitive overhead. Users type
// naturally; these two classifiers route the request:
//
//   classifyIntent(text)  → 'edit' | 'explain'
//   classifyScope(text)   → 'section' | 'document' | 'source'
//
// Both are pure, cheap, exported so unit tests can pin behaviour (web
// has no vitest yet, so for now they're just here as reference logic).

// --- Intent ---------------------------------------------------------------
//
//   explain / what / why / how / describe / tell / summarise / summarize /
//   who / where / when / which / does / is / can / should / could — or
//   anything ending in '?' → explain
//
// Everything else → edit (the default — users typing a rewrite
// instruction don't start with a question word).
const QUESTION_WORDS = new Set([
  'explain', 'what', 'why', 'how', 'describe', 'tell', 'summarise', 'summarize',
  'who', 'where', 'when', 'which', 'does', 'is', 'can', 'should', 'could', 'would',
])

export function classifyIntent(prompt: string): 'edit' | 'explain' {
  const trimmed = prompt.trim()
  if (trimmed.length === 0) return 'edit'
  if (trimmed.endsWith('?')) return 'explain'
  const firstWord = trimmed.split(/\s+/)[0]?.toLowerCase().replace(/[^a-z]/g, '') ?? ''
  if (QUESTION_WORDS.has(firstWord)) return 'explain'
  return 'edit'
}

// --- Scope ---------------------------------------------------------------
//
// Default is 'section' (current behaviour). Trigger phrases widen to
// 'document' scope so the backend ships every section as context:
//
//   "the entire document"   "whole document"     "across sections"
//   "all sections"          "across the doc"     "every section"
//
// Source scope (attach-source) is not inferred from text — it will
// become an explicit attach action; see follow-up.
const DOCUMENT_SCOPE_PATTERNS: RegExp[] = [
  /\b(entire|whole|full)\s+(document|doc)\b/i,
  /\b(across|through|all)\s+(the\s+)?(sections?|document|doc)\b/i,
  /\b(every|each)\s+section\b/i,
  /\bthroughout\s+(the\s+)?(document|doc)\b/i,
]

export function classifyScope(prompt: string): 'section' | 'document' {
  const trimmed = prompt.trim()
  if (trimmed.length === 0) return 'section'
  for (const pattern of DOCUMENT_SCOPE_PATTERNS) {
    if (pattern.test(trimmed)) return 'document'
  }
  return 'section'
}

export function AIChatPanel({ documentId, sectionId, sectionLabel, editor, onAcceptSuggestion, canEditSection = true, cannotEditReason }: Props) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  // No AI set up on the server: the composer is disabled with the reason (the thread stays readable).
  const aiOff = !useAiConfigured()
  const [prompt, setPrompt] = useState('')
  // Explicit source attachments (paperclip in composer). When present,
  // the request goes with scope='source' and attachedSourceIds[] so the
  // backend narrows the attached-source context to just these uploads.
  const [attachedSourceIds, setAttachedSourceIds] = useState<string[]>([])
  const [sourcePickerOpen, setSourcePickerOpen] = useState(false)
  // Scope + intent are both inferred from the prompt text — the old
  // chip rows were cognitive overhead. classifyScope() picks 'document'
  // when the user mentions "whole document" / "all sections" / etc.;
  // defaults to 'section'. classifyIntent() picks 'explain' for
  // question-shaped prompts; defaults to 'edit' (HTML returning path
  // with an Accept button). The old chip rows were
  // cognitive overhead; users naturally type "explain …" or "shorten
  // this to one sentence" and the mode falls out.
  const inputRef    = useRef<HTMLTextAreaElement>(null)
  const bottomRef   = useRef<HTMLDivElement>(null)
  // Captured editor selection — stored on mousedown of the panel's input
  // wrapper so it survives focus moving from the editor to the chat input.
  // Same pattern as SectionAIPrompt.
  const [savedSel, setSavedSel] = useState<{ from: number; to: number; text: string } | null>(null)
  // Range tracked per-assistant-message so Accept can swap just the right
  // span even after other turns have landed. Populated on send-success.
  const [rangesByMessageId, setRangesByMessageId] = useState<Record<string, { from: number; to: number }>>({})

  // Prompt-help panel toggle — same control the bottom SectionAIPrompt
  // exposes. Keeps the two composers at feature parity so users don't
  // have to leave the chat to pull in a suggested prompt.
  const activePanel    = useDocumentStore(s => s.activePanel)
  const setActivePanel = useDocumentStore(s => s.setActivePanel)

  // Listen for pick events from AIPromptHelpPanel — same channel as
  // SectionAIPrompt. The picked prompt pre-fills the composer; user
  // can tweak before sending.
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

  // mousedown fires before focus moves. Click on the textarea, scope chip,
  // or send button — all catch here so the editor selection doesn't
  // collapse before we read it.
  const captureSelectionFromEditor = () => {
    if (!editor) return
    const { from, to } = editor.state.selection
    if (from === to) return
    const text = editor.state.doc.textBetween(from, to, ' ', ' ').trim()
    if (text.length === 0) return
    setSavedSel({ from, to, text })
  }

  // Also subscribe to TipTap's selectionUpdate — same reasoning as in
  // SectionAIPrompt. Catches keyboard selections and situations where
  // mousedown fires too late to see the selection. Does NOT clear on
  // collapse; the Clear button on the badge is the explicit drop path.
  useEffect(() => {
    if (!editor) return
    const update = () => {
      const { from, to } = editor.state.selection
      if (from === to) return
      const text = editor.state.doc.textBetween(from, to, ' ', ' ').trim()
      if (text.length === 0) return
      setSavedSel({ from, to, text })
    }
    editor.on('selectionUpdate', update)
    return () => { editor.off('selectionUpdate', update) }
  }, [editor])

  const chatQ = useQuery({
    queryKey: ['ai-chat', documentId, sectionId],
    queryFn:  () => documentsApi.getAiChat(documentId, sectionId!),
    enabled:  !!sectionId,
  })

  // Source documents linked to this document — populates the paperclip
  // picker. Cheap-ish; cached. Falls back to empty when the endpoint
  // 404s (new doc with no sources yet).
  const sourcesQ = useQuery({
    queryKey: ['document-sources', documentId],
    queryFn:  () => documentsApi.listDocumentSources(documentId),
    enabled:  !!documentId,
    staleTime: 30_000,
  })
  const availableSources = sourcesQ.data?.items ?? []
  const attachedSources  = availableSources.filter(s => attachedSourceIds.includes(s.uploadId))

  function toggleSource(uploadId: string) {
    setAttachedSourceIds(prev =>
      prev.includes(uploadId) ? prev.filter(id => id !== uploadId) : [...prev, uploadId],
    )
  }

  function clearAttachments() { setAttachedSourceIds([]) }

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
    mutationFn: (vars: { instruction: string; intentValue: 'edit' | 'explain'; scopeValue: Scope; selectionText?: string; attachedSourceIds?: string[] }) => {
      if (!sectionId) throw new Error('no_active_section')
      return api.post<AiResult>(
        `/documents/${documentId}/sections/${encodeURIComponent(sectionId)}/ai-suggest`,
        {
          intent:       vars.intentValue,
          customPrompt: vars.instruction,
          scope:        vars.scopeValue,
          ...(vars.selectionText ? { selectionText: vars.selectionText } : {}),
          ...(vars.attachedSourceIds && vars.attachedSourceIds.length > 0
            ? { attachedSourceIds: vars.attachedSourceIds }
            : {}),
        },
      )
    },
    onSuccess: async (_data, vars) => {
      setPrompt('')
      // Refresh the thread + the open-findings strip. If this prompt had
      // a selection, map the newest assistant message id to the captured
      // range so Accept can replace just that span. Flags are query-
      // driven via OpenFindingsStrip — invalidating that query is how
      // the AI's just-emitted findings appear in the UI.
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['ai-chat', documentId, sectionId] }),
        qc.invalidateQueries({ queryKey: ['open-flags', documentId] }),
      ])
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
    onSuccess: (data, vars) => {
      const range = rangesByMessageId[vars.messageId]
      // Pass the AI call id on so the save's audit entry links to the prompt / model.
      onAcceptSuggestion(vars.html, vars.model, range, data.aiCallRecordId ?? null)
      qc.invalidateQueries({ queryKey: ['ai-chat', documentId, sectionId] })
    },
  })

  const handleSend = () => {
    const text = prompt.trim()
    // AI follows editing rights: only someone who may edit this section (its
    // author, holding the section lock, document open) can ask. The API refuses
    // anyone else; viewers keep the read-only conversation above.
    if (!text || send.isPending || !canEditSection || aiOff) return
    // When the user has attached source documents, scope is forced to
    // 'source' server-side anyway; passing it here just keeps the wire
    // explicit. Otherwise we fall back to the inferred scope.
    const hasAttachments = attachedSourceIds.length > 0
    send.mutate({
      instruction:   text,
      intentValue:   classifyIntent(text),
      scopeValue:    hasAttachments ? 'source' : classifyScope(text),
      selectionText: savedSel?.text,
      attachedSourceIds: hasAttachments ? attachedSourceIds : undefined,
    })
    // Attachments persist across sends by default (user may want to run
    // several prompts against the same source set); the paperclip
    // popover's "Clear" button is the explicit drop path.
  }

  if (!sectionId) {
    return (
      <div className="flex-1 overflow-y-auto p-4">
        <p className="text-[13px] text-slate-500">{t('page.ai_chat_panel.select_section_first')}</p>
      </div>
    )
  }

  const messages = chatQ.data?.messages ?? []
  const errorText = send.isError
    ? send.error instanceof ApiError
      ? send.error.status === 429 ? t('page.ai_chat_panel.err_quota')
        : send.error.status === 503 ? t('page.ai_chat_panel.err_unavailable')
          : t('page.ai_chat_panel.err_http', { status: send.error.status })
      : t('page.ai_chat_panel.err_generic')
    : null

  return (
    <div className="flex flex-1 flex-col overflow-hidden" data-panel="ai-chat">
      {/* Header */}
      <div className="flex-none border-b border-slate-200 px-4 py-3">
        <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">
          {sectionLabel ?? t('page.ai_chat_panel.current_section')}
        </p>
        <p className="mt-0.5 text-[11px] text-slate-500">
          {t('page.ai_chat_panel.header_subtitle')}
        </p>
      </div>

      {/* Open-findings strip — the AI-emitted escape-hatch tokens the
          server has persisted for this section. Reload-safe, actionable
          (Resolve / Dismiss). Hidden when the section has no open flags. */}
      <OpenFindingsStrip documentId={documentId} sectionId={sectionId} />

      {/* Thread */}
      <div className="flex-1 overflow-y-auto px-4 py-3" data-chat-thread>
        {messages.length === 0 && !send.isPending && (
          <p className="mt-6 rounded-md border border-dashed border-slate-300 bg-slate-50 p-4 text-center text-[12px] text-slate-500">
            {aiOff
              ? t('page.ai_chat_panel.ai_not_configured_empty', { defaultValue: 'AI is not configured for this workspace. Contact your administrator.' })
              : t('page.ai_chat_panel.empty_thread')}
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
                {m.role === 'user' && m.scope === 'document' && (
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider opacity-80">
                    {t('page.ai_chat_panel.scope_document')}
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
                      {m.appliedToSection ? ' · ' + t('page.ai_chat_panel.applied_marker') : ''}
                    </span>
                    {m.kind === 'suggest' && !m.appliedToSection && (
                      <div className="flex items-center gap-2">
                        {!canEditSection && (
                          <span className="text-[10px] italic text-amber-700" title={cannotEditReason}>
                            {cannotEditReason ?? t('page.ai_chat_panel.section_read_only')}
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => accept.mutate({ messageId: m.id, html: sanitizeAiHtml(m.content), model: m.aiModel ?? 'ai' })}
                          disabled={accept.isPending || !canEditSection}
                          title={!canEditSection ? (cannotEditReason ?? t('page.ai_chat_panel.section_read_only')) : undefined}
                          className="rounded-md bg-emerald-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                          data-action="accept-into-section"
                        >
                          {accept.isPending ? t('page.ai_chat_panel.applying') : t('page.ai_chat_panel.accept_into_section')}
                        </button>
                      </div>
                    )}
                    {accept.isError && accept.variables?.messageId === m.id && (
                      <p className="w-full text-[10px] text-rose-600" role="alert">
                        {accept.error instanceof ApiError
                          ? accept.error.status === 423
                            ? t('page.ai_chat_panel.err_accept_locked')
                            : accept.error.status === 403
                              ? t('page.ai_chat_panel.err_accept_403')
                              : accept.error.status === 404
                                ? t('page.ai_chat_panel.err_accept_404')
                                : t('page.ai_chat_panel.err_accept_http', { status: accept.error.status })
                          : t('page.ai_chat_panel.err_accept_network')}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </li>
          ))}
          {send.isPending && (
            <li className="flex justify-start">
              <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-[12px] text-slate-500">
                {t('page.ai_chat_panel.thinking')}
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
              <strong>{t('page.ai_chat_panel.selected_label')}</strong> "{savedSel.text.length > 60 ? `${savedSel.text.slice(0, 60)}…` : savedSel.text}"
            </span>
            <button
              type="button"
              onClick={() => setSavedSel(null)}
              className="rounded px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 hover:bg-amber-100"
              aria-label={t('page.ai_chat_panel.clear_selection_aria')}
            >{t('button.clear')}</button>
          </div>
        )}
        {/* Attached source chips. Each chip is removable; "Clear" drops all. */}
        {attachedSources.length > 0 && (
          <div className="mb-2 flex flex-wrap items-center gap-1" data-chat-attachments>
            {attachedSources.map(s => (
              <span
                key={s.uploadId}
                className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] text-blue-800"
                title={s.fileName}
              >
                <PaperclipIcon />
                <span className="max-w-[160px] truncate">{s.title || s.fileName}</span>
                <button
                  type="button"
                  onClick={() => toggleSource(s.uploadId)}
                  className="ml-0.5 rounded text-blue-600 hover:bg-blue-100"
                  aria-label={t('page.ai_chat_panel.remove_attachment_aria', { name: s.fileName })}
                >×</button>
              </span>
            ))}
            {attachedSources.length > 1 && (
              <button
                type="button"
                onClick={clearAttachments}
                className="ml-1 rounded px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 hover:bg-slate-100"
              >{t('button.clear')}</button>
            )}
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
            disabled={send.isPending || !canEditSection || aiOff}
            placeholder={aiOff ? t('page.ai_chat_panel.ai_not_configured', { defaultValue: 'AI is not configured' }) : canEditSection ? t('page.ai_chat_panel.input_placeholder') : (cannotEditReason ?? t('page.ai_chat_panel.section_read_only'))}
            title={aiOff ? t('page.ai_chat_panel.ai_not_configured_tooltip', { defaultValue: 'AI is not set up for this workspace. Contact your administrator.' }) : canEditSection ? undefined : (cannotEditReason ?? t('page.ai_chat_panel.section_read_only'))}
            data-ai-off={aiOff ? 'true' : undefined}
            data-ai-chat-input
            aria-label={t('page.ai_chat_panel.input_aria')}
            className="block max-h-40 min-h-[36px] w-full resize-none rounded-t-xl border-0 bg-transparent px-3 pt-2 text-[13px] text-slate-800 outline-none placeholder:text-slate-400 disabled:opacity-60"
          />
          <div className="flex items-center justify-between gap-2 px-2 pb-2">
            {/* Paperclip — attach a linked source document. Button is
                disabled when there are no sources on this doc (and
                tooltip explains). Keeps the composer discoverable
                without a chip rail. */}
            <div className="relative" data-chat-attach-wrapper>
              <button
                type="button"
                onClick={() => setSourcePickerOpen(o => !o)}
                disabled={availableSources.length === 0 || send.isPending || !canEditSection || aiOff}
                aria-label={t('page.ai_chat_panel.attach_source_aria')}
                aria-expanded={sourcePickerOpen}
                title={
                  availableSources.length === 0
                    ? t('page.ai_chat_panel.no_sources_linked')
                    : t('page.ai_chat_panel.attach_source_tooltip', { attached: attachedSourceIds.length, available: availableSources.length })
                }
                className={`flex h-7 w-7 flex-none items-center justify-center rounded-lg border transition-colors ${
                  attachedSourceIds.length > 0
                    ? 'border-blue-200 bg-blue-50 text-blue-700'
                    : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
                } disabled:cursor-not-allowed disabled:opacity-50`}
              >
                <PaperclipIcon />
              </button>
              {sourcePickerOpen && availableSources.length > 0 && (
                <div
                  className="absolute bottom-9 left-0 z-20 max-h-64 w-72 overflow-y-auto rounded-md border border-slate-200 bg-white p-2 shadow-lg"
                  data-chat-source-picker
                  onMouseDown={e => e.stopPropagation()}
                >
                  <p className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                    {t('page.ai_chat_panel.attach_source_header')}
                  </p>
                  <ul className="space-y-0.5">
                    {availableSources.map(s => {
                      const checked = attachedSourceIds.includes(s.uploadId)
                      return (
                        <li key={s.uploadId}>
                          <label className={`flex cursor-pointer items-start gap-2 rounded px-2 py-1 text-[12px] ${checked ? 'bg-blue-50' : 'hover:bg-slate-50'}`}>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleSource(s.uploadId)}
                              className="mt-0.5 shrink-0"
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate font-medium text-slate-900">{s.title || s.fileName}</span>
                              {s.category && (
                                <span className="block truncate text-[10px] text-slate-500">
                                  {s.category}{s.version ? ` · v${s.version}` : ''}
                                </span>
                              )}
                            </span>
                          </label>
                        </li>
                      )
                    })}
                  </ul>
                  <div className="mt-1 flex justify-end gap-1 border-t border-slate-100 pt-1">
                    <button
                      type="button"
                      onClick={() => setSourcePickerOpen(false)}
                      className="rounded px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-100"
                    >{t('page.ai_chat_panel.done')}</button>
                  </div>
                </div>
              )}
            </div>
            <div className="flex-1" />
            <button
              type="button"
              onClick={() => setActivePanel(activePanel === 'ai-help' ? null : 'ai-help')}
              aria-label={t('page.ai_chat_panel.show_prompts_aria')}
              title={t('page.ai_chat_panel.prompt_suggestions_title')}
              data-ai-help-button
              className={`flex h-7 w-7 flex-none items-center justify-center rounded-lg border transition-colors ${activePanel === 'ai-help' ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-slate-300 bg-white text-slate-500 hover:bg-slate-50'}`}
            >
              <QuestionIcon />
            </button>
            <button
              type="button"
              onClick={handleSend}
              disabled={!prompt.trim() || send.isPending || !canEditSection || aiOff}
              aria-label={t('page.ai_chat_panel.send_to_ai_aria')}
              data-ai-chat-send
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

// Open-findings strip — the persistent, query-driven view of the AI-
// emitted escape-hatch tokens for the current section. Reload-safe
// (server-persisted in document_brief_open_flags) + actionable (every
// row has a Resolve + Dismiss button). Hidden when the section has no
// open findings so the panel doesn't carry visual weight for nothing.
//
// Row ids are the DB row ids — the Resolve mutation sends them
// straight to POST /documents/:id/brief/open-flags/:flagId/resolve.
// On success the query is invalidated and the resolved row disappears
// from the strip (status filter = 'open'). Dismiss uses the same
// endpoint with status='dismissed'; the Part 11 audit entry
// distinguishes the two for compliance review.
interface OpenFlagRow {
  id:             string
  documentId:     string
  sectionId:      string
  type:           FlagTokenType
  text:           string
  aiCallRecordId: string | null
  status:         'open' | 'resolved' | 'dismissed'
  resolvedBy:     string | null
  resolvedAt:     string | null
  resolutionNote: string | null
  createdAt:      string
  updatedAt:      string
}

function OpenFindingsStrip({ documentId, sectionId }: { documentId: string; sectionId: string }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const flagsQ = useQuery({
    queryKey: ['open-flags', documentId],
    queryFn:  () => documentsApi.listOpenFlags(documentId, 'open'),
  })

  // Filter to the current section — the list endpoint returns the
  // whole document's open flags for the future flags-panel; this strip
  // is per-section.
  const forThisSection = (flagsQ.data?.flags ?? []).filter(f => f.sectionId === sectionId) as OpenFlagRow[]

  const resolve = useMutation({
    mutationFn: ({ flagId, status, note }: { flagId: string; status: 'resolved' | 'dismissed'; note?: string | null }) =>
      documentsApi.resolveOpenFlag(documentId, flagId, { status, resolutionNote: note ?? null }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['open-flags', documentId] }),
  })

  if (forThisSection.length === 0) return null

  const TYPE_LABEL: Record<FlagTokenType, string> = {
    information_required:            t('page.ai_chat_panel.flag_type_information_required'),
    conflict:                        t('page.ai_chat_panel.flag_type_conflict'),
    reference_verification_required: t('page.ai_chat_panel.flag_type_reference_verification_required'),
    missing_cross_ref_target:        t('page.ai_chat_panel.flag_type_missing_cross_ref_target'),
  }
  const headingKey = forThisSection.length === 1
    ? 'page.ai_chat_panel.flags_heading'
    : 'page.ai_chat_panel.flags_heading_plural'

  return (
    <div className="flex-none border-b border-amber-200 bg-amber-50/50 px-4 py-3" data-open-findings>
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-amber-800">
        ⚠ {t(headingKey, { count: forThisSection.length })}
      </p>
      <ul className="flex flex-col gap-1.5">
        {forThisSection.map(f => {
          const busy = resolve.isPending && resolve.variables?.flagId === f.id
          const kind = busy ? resolve.variables?.status : null
          return (
            <li
              key={f.id}
              className="rounded-md border border-amber-200 bg-white px-2.5 py-1.5 text-[11px] text-amber-900"
              data-flag-id={f.id}
              data-flag-type={f.type}
            >
              <div className="mb-1">
                <span className="font-semibold">{TYPE_LABEL[f.type]}:</span>{' '}
                <span className="whitespace-pre-wrap">{f.text || '—'}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    const note = window.prompt(t('page.ai_chat_panel.flag_resolve_prompt'))
                    // Null = user cancelled the browser prompt — bail silently.
                    if (note === null) return
                    resolve.mutate({ flagId: f.id, status: 'resolved', note: note.trim() || null })
                  }}
                  className="rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-800 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
                  data-action="resolve-flag"
                >
                  {busy && kind === 'resolved' ? t('page.ai_chat_panel.flag_resolving') : t('page.ai_chat_panel.flag_resolve')}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => resolve.mutate({ flagId: f.id, status: 'dismissed', note: null })}
                  className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                  data-action="dismiss-flag"
                >
                  {busy && kind === 'dismissed' ? t('page.ai_chat_panel.flag_dismissing') : t('page.ai_chat_panel.flag_dismiss')}
                </button>
                {resolve.isError && resolve.variables?.flagId === f.id && (
                  <span className="text-[10px] italic text-rose-700" role="alert">
                    {t('page.ai_chat_panel.flag_resolve_err')}
                  </span>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

// Small SVG icon for the paperclip (attach source). Inline avoids
// pulling an icon library for a single glyph.
function PaperclipIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
    </svg>
  )
}

// Help/prompt-suggestions icon — same glyph the bottom SectionAIPrompt
// uses so the two surfaces look consistent.
function QuestionIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="8" cy="8" r="6.4" />
      <path d="M6.2 6.3a1.8 1.8 0 1 1 2.6 1.5c-.5.3-.8.6-.8 1.2" />
      <circle cx="8" cy="11.6" r="0.4" fill="currentColor" />
    </svg>
  )
}
