// AI Prompts — admin screen.
//
// Lightweight companion to DocumentTypePolicies: lets admins maintain
// the SME prompt per doc type without wading through the full policy
// editor (BP digest, section rules, template pins, version bumping).
// Mental model: one prompt per doc type. Behind the scenes the DB still
// versions — if the admin edits a prompt whose current version has been
// pinned by any Document, Save transparently bumps a new version with a
// change reason so the audit trail stays intact. From the admin's POV
// it's still "one textarea, one Save button" per doc type.
//
// Why a second screen for the same field? Day-to-day prompt tuning is
// most of the admin's time; forcing them through a 5-section editor for
// a one-line fix is friction. /admin/document-type-policies remains the
// place to edit everything else.

import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError } from '../../api/client'
import { platformApi, type DocumentTypePolicy } from '../api/platformApi'

function errMessage(err: unknown, fallback = 'Request failed'): string {
  if (err instanceof ApiError) {
    const body = err.body as { message?: string; error?: string } | null
    if (body?.message) return body.message
    if (body?.error)   return body.error
    return `${err.status}`
  }
  return err instanceof Error ? err.message : fallback
}

function isVersionInUse(err: unknown): boolean {
  if (!(err instanceof ApiError) || err.status !== 409) return false
  const body = err.body as { error?: string } | null
  return body?.error === 'version_in_use'
}

export function AiPrompts() {
  const qc = useQueryClient()
  const { data, isLoading, error } = useQuery({
    queryKey: ['document-type-policies'],
    queryFn:  () => platformApi.listDocumentTypePolicies(),
  })
  const policies = useMemo(() => data?.policies ?? [], [data])

  const [selectedDocType, setSelectedDocType] = useState<string | null>(null)
  useEffect(() => {
    if (!selectedDocType && policies.length > 0) setSelectedDocType(policies[0]!.docType)
  }, [policies, selectedDocType])

  const selected = policies.find(p => p.docType === selectedDocType) ?? null

  const invalidate = () => qc.invalidateQueries({ queryKey: ['document-type-policies'] })

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-5" data-screen="ai-prompts">
      <header>
        <h1 className="text-[20px] font-semibold text-slate-900">AI Prompts</h1>
        <p className="mt-0.5 text-[13px] text-slate-500">
          The SME prompt AI sees on every draft + rewrite. One per doc type — editing here updates
          the same row the full Doc Type Policies screen edits. Everything else (Best-Practice
          digest, section rules, template pins) is managed over there.
        </p>
      </header>

      {isLoading && <p className="text-[13px] text-slate-500">Loading prompts…</p>}
      {error && <p className="text-[13px] text-rose-700">{errMessage(error, 'Could not load prompts')}</p>}

      {!isLoading && !error && (
        <div className="flex min-h-0 flex-1 gap-4">
          <DocTypeList policies={policies} selected={selectedDocType} onSelect={setSelectedDocType} />
          <div className="flex-1 overflow-y-auto">
            {selected
              ? <PromptEditor key={selected.id} policy={selected} onSaved={invalidate} />
              : <NewPromptForm onCreated={(docType) => { invalidate(); setSelectedDocType(docType) }} />}
          </div>
        </div>
      )}
    </div>
  )
}

// ---- list ---------------------------------------------------------------

function DocTypeList({
  policies, selected, onSelect,
}: {
  policies: DocumentTypePolicy[]
  selected: string | null
  onSelect: (docType: string | null) => void
}) {
  return (
    <aside className="w-64 shrink-0 overflow-y-auto rounded-md border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
        <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">
          Doc types ({policies.length})
        </p>
        <button
          type="button"
          onClick={() => onSelect(null)}
          className="rounded-md border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
          data-action="new-prompt"
        >
          + New
        </button>
      </div>
      {policies.length === 0 && (
        <p className="p-3 text-[12px] text-slate-500">
          No prompts authored yet. Use <strong>+ New</strong> to add one.
        </p>
      )}
      <ul>
        {policies.map(p => (
          <li key={p.id}>
            <button
              type="button"
              onClick={() => onSelect(p.docType)}
              className={`w-full border-b border-slate-100 px-3 py-2 text-left text-[13px] hover:bg-slate-50 ${
                selected === p.docType ? 'bg-blue-50/60 font-semibold text-blue-800' : 'text-slate-800'
              }`}
              data-doc-type={p.docType}
            >
              <div className="flex items-baseline justify-between">
                <span>{p.docType}</span>
                <span className="font-mono text-[10px] text-slate-500">
                  {p.smePrompt.length.toLocaleString()} ch
                </span>
              </div>
            </button>
          </li>
        ))}
      </ul>
    </aside>
  )
}

// ---- editor -------------------------------------------------------------

function PromptEditor({ policy, onSaved }: { policy: DocumentTypePolicy; onSaved: () => void }) {
  const [draft,       setDraft]       = useState(policy.smePrompt)
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionInfo,  setActionInfo]  = useState<string | null>(null)
  // When the current version is already pinned by any document, the API
  // rejects PATCH with 409 version_in_use and expects a bump instead. We
  // surface a change-reason prompt inline rather than looping the admin
  // through the full policy editor.
  const [needsBump,   setNeedsBump]   = useState(false)
  const [bumpReason,  setBumpReason]  = useState('')

  const dirty    = draft !== policy.smePrompt
  const trimmed  = draft.trim()

  const save = useMutation({
    mutationFn: () => platformApi.updateDocumentTypePolicy(policy.docType, { smePrompt: draft }),
    onSuccess: () => {
      setActionInfo('Prompt saved.')
      setActionError(null)
      setNeedsBump(false)
      onSaved()
    },
    onError: (err: unknown) => {
      if (isVersionInUse(err)) {
        setNeedsBump(true)
        setActionError(null)
        setActionInfo(null)
      } else {
        setActionError(errMessage(err, 'Save failed'))
        setActionInfo(null)
      }
    },
  })

  const bump = useMutation({
    mutationFn: () => platformApi.bumpDocumentTypePolicy(policy.docType, {
      smePrompt:           draft,
      bestPracticeDigest:  policy.bestPracticeDigest ?? undefined,
      sectionRules:        (policy.sectionRules as Parameters<typeof platformApi.bumpDocumentTypePolicy>[1]['sectionRules']) ?? undefined,
      templateId:          policy.templateId,
      checklistTemplateId: policy.checklistTemplateId,
      ichFramework:        policy.ichFramework,
      changeReason:        bumpReason.trim(),
    }),
    onSuccess: () => {
      setActionInfo('Prompt saved as a new version — older documents keep using the previous one.')
      setActionError(null)
      setNeedsBump(false)
      setBumpReason('')
      onSaved()
    },
    onError: (err: unknown) => {
      setActionError(errMessage(err, 'Bump failed'))
      setActionInfo(null)
    },
  })

  return (
    <div className="flex flex-col gap-3" data-editor={policy.docType}>
      <header className="flex items-baseline justify-between border-b border-slate-200 pb-2">
        <div>
          <h2 className="text-[16px] font-semibold text-slate-900">{policy.docType}</h2>
          <p className="text-[12px] text-slate-500">
            Updated {new Date(policy.updatedAt).toLocaleString()} by {policy.updatedBy}
          </p>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-slate-500">
          <span>{draft.length.toLocaleString()} chars</span>
          {dirty && <span className="rounded bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-800">unsaved</span>}
        </div>
      </header>

      {actionError && <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700">{actionError}</p>}
      {actionInfo  && <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] text-emerald-800">{actionInfo}</p>}

      <textarea
        value={draft}
        onChange={e => { setDraft(e.currentTarget.value); setActionInfo(null) }}
        rows={24}
        className="w-full resize-y rounded-md border border-slate-300 px-3 py-2 font-mono text-[12px] leading-relaxed"
        data-field="sme-prompt"
        placeholder="SME prompt for this document type — the role-specific preamble AI reads on every draft + rewrite."
      />

      {!needsBump && (
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => { setDraft(policy.smePrompt); setActionInfo(null); setActionError(null) }}
            disabled={!dirty || save.isPending}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-[12px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            data-action="reset"
          >
            Reset
          </button>
          <button
            type="button"
            onClick={() => save.mutate()}
            disabled={!dirty || !trimmed || save.isPending}
            className="rounded-md border border-blue-600 bg-blue-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            data-action="save"
          >
            {save.isPending ? 'Saving…' : 'Save prompt'}
          </button>
        </div>
      )}

      {needsBump && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3" data-bump-form>
          <p className="text-[12px] text-amber-900">
            This prompt is already used by at least one document, so saving it as an edit would
            change what AI sees for documents that were drafted against the current version.
            Save your change as a <strong>new version</strong> — older documents keep using the
            prompt they were drafted with. Add a short reason (goes on the audit trail):
          </p>
          <textarea
            value={bumpReason}
            onChange={e => setBumpReason(e.currentTarget.value)}
            rows={2}
            placeholder="e.g. Updated endpoint wording after sponsor review."
            className="mt-2 w-full rounded-md border border-amber-300 px-3 py-2 text-[13px]"
            data-field="bump-reason"
          />
          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => { setNeedsBump(false); setBumpReason('') }}
              className="rounded-md border border-slate-300 bg-white px-3 py-1 text-[12px] text-slate-700"
              data-action="bump-cancel"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => bump.mutate()}
              disabled={bump.isPending || !bumpReason.trim() || !trimmed}
              className="rounded-md border border-blue-600 bg-blue-600 px-3 py-1 text-[12px] font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              data-action="bump-confirm"
            >
              {bump.isPending ? 'Saving new version…' : 'Save as new version'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ---- new --------------------------------------------------------------

function NewPromptForm({ onCreated }: { onCreated: (docType: string) => void }) {
  const [docType,   setDocType]   = useState('')
  const [smePrompt, setSmePrompt] = useState('')
  const [error,     setError]     = useState<string | null>(null)
  const create = useMutation({
    mutationFn: () => platformApi.createDocumentTypePolicy({
      docType:   docType.trim().replace(/-/g, '_'),
      smePrompt: smePrompt.trim(),
    }),
    onSuccess: (row) => { setError(null); onCreated(row.docType) },
    onError:   (err: unknown) => setError(errMessage(err, 'Create failed')),
  })
  return (
    <div className="rounded-md border border-dashed border-slate-300 bg-white p-4" data-new-prompt>
      <h2 className="text-[14px] font-semibold text-slate-900">New prompt</h2>
      <p className="mt-0.5 text-[12px] text-slate-500">
        Pick a doc type (underscored canonical form: <code>csr_full</code>, <code>protocol</code>, …)
        and paste the SME prompt.
      </p>
      {error && <p className="mt-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700">{error}</p>}
      <div className="mt-3 flex flex-col gap-2">
        <input
          type="text"
          value={docType}
          onChange={e => setDocType(e.currentTarget.value)}
          placeholder="doc type (e.g. protocol)"
          className="rounded-md border border-slate-300 px-3 py-1.5 font-mono text-[12px]"
          data-field="create-doc-type"
        />
        <textarea
          value={smePrompt}
          onChange={e => setSmePrompt(e.currentTarget.value)}
          rows={16}
          placeholder="SME prompt — the role-specific preamble the AI reads on every call."
          className="rounded-md border border-slate-300 px-3 py-2 font-mono text-[12px]"
          data-field="create-sme-prompt"
        />
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => create.mutate()}
            disabled={create.isPending || !docType.trim() || !smePrompt.trim()}
            className="rounded-md border border-blue-600 bg-blue-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            data-action="create-prompt"
          >
            {create.isPending ? 'Creating…' : 'Create prompt'}
          </button>
        </div>
      </div>
    </div>
  )
}
