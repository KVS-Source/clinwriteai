// AI Assist panel — Arc A4.
//
// Right-rail panel. Opens when panelMode='ai'. Three preset intents +
// a free-text input; backend call goes to the AI Gateway via a thin
// Module A wrapper at POST /documents/:id/sections/:id/ai-suggest.
//
// StubLlmClient today (deterministic placeholder); real Anthropic the
// moment ANTHROPIC_API_KEY is set (Arc 8.1 scaffold already in place).
//
// Accept action calls documentsApi.updateSection with aiDrafted=true +
// aiModel set, which the server requires for Part 11 §11.70 provenance.

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { documentsApi } from '../api'
import { api } from '../api/client'
import { ApiError } from '../api/client'

interface Props {
  documentId: string
  sectionId: string | null
  sectionLabel?: string
  onAccepted?: () => void
}

type Intent = 'draft_from_source' | 'tighten' | 'explain' | 'custom'

interface AiResult {
  responseText: string
  model: string
  inputTokens: number
  outputTokens: number
  costUsd: number
  limitDecision: 'allowed' | 'allowed_approaching_cap' | 'rejected_cap'
  piiScrubbed: boolean
  piiCategories: string[]
  recordId: string
}

const PRESETS: Array<{ intent: Intent; label: string; blurb: string }> = [
  { intent: 'draft_from_source', label: 'Draft from source',   blurb: 'Generate a draft from CSR, Protocol, IB.' },
  { intent: 'tighten',           label: 'Tighten this section', blurb: 'Rewrite for clarity, keep every data point.' },
  { intent: 'explain',           label: 'Explain in plain English', blurb: 'Summarise for a non-statistician reviewer.' },
]

export function AIAssistPanel({ documentId, sectionId, sectionLabel, onAccepted }: Props) {
  const qc = useQueryClient()
  const [customPrompt, setCustomPrompt] = useState('')
  const [result, setResult] = useState<AiResult | null>(null)
  const [edited, setEdited] = useState<string>('')
  const [isEditing, setIsEditing] = useState(false)

  const suggest = useMutation({
    mutationFn: async (intent: Intent) => {
      if (!sectionId) throw new Error('no_active_section')
      const body: Record<string, unknown> = { intent }
      if (intent === 'custom') body.customPrompt = customPrompt
      return api.post<AiResult>(`/documents/${documentId}/sections/${sectionId}/ai-suggest`, body)
    },
    onSuccess: (data) => {
      setResult(data)
      setEdited(data.responseText)
      setIsEditing(false)
    },
  })

  const accept = useMutation({
    mutationFn: async () => {
      if (!sectionId || !result) throw new Error('no_result')
      return documentsApi.updateSection(documentId, sectionId, {
        contentHtml: isEditing ? edited : result.responseText,
        aiDrafted: true,
        aiModel: result.model,
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['document', documentId] })
      qc.invalidateQueries({ queryKey: ['versions', documentId] })
      setResult(null)
      setEdited('')
      onAccepted?.()
    },
  })

  const errorMessage = (() => {
    if (suggest.isError && suggest.error instanceof ApiError) {
      if (suggest.error.status === 429) return 'This tenant has reached its monthly AI budget. Reach out to admin to raise the cap.'
      if (suggest.error.status === 503) return 'AI module is temporarily unavailable.'
      return `AI call failed (HTTP ${suggest.error.status}).`
    }
    if (suggest.isError) return 'AI call failed — see console.'
    return null
  })()

  if (!sectionId) {
    return (
      <div className="flex-1 overflow-y-auto p-4">
        <p className="text-[13px] text-slate-500">Select a section first — AI needs a section to draft or improve.</p>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto p-4" data-panel="ai">
      <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">
        {sectionLabel ?? 'Current section'}
      </p>
      <p className="mt-1 text-[13px] text-slate-700">
        Ask AI to draft or improve this section. The AI's response is a suggestion — accept to commit as the new section content with full Part 11 provenance (model, timestamp, caller).
      </p>

      {!result && !suggest.isPending && (
        <>
          <div className="mt-4 flex flex-col gap-2">
            {PRESETS.map(p => (
              <button key={p.intent}
                type="button"
                onClick={() => suggest.mutate(p.intent)}
                className="flex flex-col items-start gap-0.5 rounded-md border border-slate-200 bg-white p-3 text-left hover:border-blue-400 hover:bg-blue-50"
              >
                <span className="text-[13px] font-semibold text-slate-900">{p.label}</span>
                <span className="text-[11px] text-slate-500">{p.blurb}</span>
              </button>
            ))}
          </div>

          <div className="mt-4">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Or describe what you need…</span>
              <textarea
                value={customPrompt}
                onChange={e => setCustomPrompt(e.currentTarget.value)}
                rows={3}
                placeholder="e.g. Add a sensitivity analysis paragraph using the subgroup data"
                className="rounded-md border border-slate-300 p-2 text-[13px]"
              />
            </label>
            <button type="button"
              onClick={() => suggest.mutate('custom')}
              disabled={customPrompt.trim().length < 5}
              className="mt-2 w-full rounded-md bg-blue-600 py-2 text-[13px] font-semibold text-white hover:bg-blue-700 disabled:bg-slate-300"
            >
              Send
            </button>
          </div>
        </>
      )}

      {suggest.isPending && (
        <div className="mt-6 flex flex-col items-center gap-2">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-300 border-t-blue-600" />
          <p className="text-[12px] text-slate-500">Generating…</p>
        </div>
      )}

      {errorMessage && (
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-[12px] text-red-700" role="alert">
          {errorMessage}
        </div>
      )}

      {result && (
        <div className="mt-4 flex flex-col gap-3">
          {result.limitDecision === 'allowed_approaching_cap' && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
              Approaching the monthly AI budget cap.
            </div>
          )}
          {result.piiScrubbed && (
            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
              {result.piiCategories.length} PII categor{result.piiCategories.length === 1 ? 'y' : 'ies'} scrubbed before sending to AI: {result.piiCategories.join(', ')}
            </div>
          )}

          <div className="rounded-md border border-blue-200 bg-blue-50 p-3">
            {isEditing ? (
              <textarea
                value={edited}
                onChange={e => setEdited(e.currentTarget.value)}
                rows={10}
                className="w-full rounded-md border border-slate-300 bg-white p-2 font-serif text-[13px] leading-[1.6]"
              />
            ) : (
              <p className="whitespace-pre-wrap font-serif text-[13px] leading-[1.6] text-slate-900">
                {result.responseText}
              </p>
            )}
            <p className="mt-2 text-[10px] text-slate-500 font-mono">
              {result.model} · {result.inputTokens + result.outputTokens} tokens · ${result.costUsd.toFixed(4)}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button type="button" onClick={() => accept.mutate()} disabled={accept.isPending}
              className="flex-1 rounded-md bg-blue-600 py-2 text-[13px] font-semibold text-white hover:bg-blue-700 disabled:bg-slate-300">
              {accept.isPending ? 'Accepting…' : isEditing ? 'Accept edited' : 'Accept'}
            </button>
            <button type="button" onClick={() => setIsEditing(e => !e)}
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-[12px] font-semibold text-slate-700 hover:bg-slate-50">
              {isEditing ? 'Preview' : 'Edit'}
            </button>
            <button type="button" onClick={() => { setResult(null); setEdited('') }}
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-[12px] font-semibold text-slate-700 hover:bg-slate-50">
              Reject
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
