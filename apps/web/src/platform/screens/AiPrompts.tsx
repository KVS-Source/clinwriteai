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

import { MasterLibraryHeading } from '../components/MasterLibraryHeading'
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError } from '../../api/client'
import { platformApi, type BestPracticeDigest, type DocumentTypePolicy } from '../api/platformApi'
import { useAiReadiness, isAiReady, AiReadinessBanner } from '../ai-readiness'
import { DOCUMENT_TYPE_KEY, documentTypeLabel } from '../../utils/documentLabels'
import { SlidePanel } from '../../components/ui/SlidePanel'

// --- Preview helpers (mirror of apps/api .../document-type-policy/resolve.ts
// + schema.ts — kept in lock-step so the "AI sees it as…" panel shows
// character-identical output to what Claude actually receives on every
// draft + rewrite call. Pure functions; no DB, no clock. If the API's
// render ever changes, update both — the parity-test on the worker side
// (policy-prompt-parity.test.ts) already guards the server copy.)
function sevOrder(s: 'must' | 'should' | 'nice'): number {
  return s === 'must' ? 0 : s === 'should' ? 1 : 2
}
function renderWholeDocPrinciples(digest: BestPracticeDigest | null | undefined): string {
  const whole = (digest?.principles ?? []).filter(p => p.scope === 'whole-doc')
  if (whole.length === 0) return ''
  const ordered = [...whole].sort((a, b) => sevOrder(a.severity) - sevOrder(b.severity))
  return ordered.map(p => `[${p.severity.toUpperCase()}] ${p.text}`).join('\n')
}
function renderAllSectionRules(
  digest: BestPracticeDigest | null | undefined,
  rules:  Record<string, Array<{ severity: 'must' | 'should' | 'nice'; text: string }>> | null | undefined,
): Array<{ sectionKey: string; block: string }> {
  const sectionKeys = new Set<string>()
  for (const p of (digest?.principles ?? [])) {
    const m = /^section:(.+)$/.exec(p.scope)
    if (m) sectionKeys.add(m[1]!)
  }
  if (rules) for (const k of Object.keys(rules)) sectionKeys.add(k)
  return Array.from(sectionKeys).sort().map(sectionKey => {
    const fromDigest = (digest?.principles ?? [])
      .filter(p => p.scope === `section:${sectionKey}`)
      .map(p => ({ severity: p.severity, text: p.text }))
    const fromRules = rules?.[sectionKey] ?? []
    const all = [...fromDigest, ...fromRules]
    const ordered = [...all].sort((a, b) => sevOrder(a.severity) - sevOrder(b.severity))
    return { sectionKey, block: ordered.map(r => `[${r.severity.toUpperCase()}] ${r.text}`).join('\n') }
  })
}
/** The policy block proper — character-identical to what the API's
 *  renderPolicyPromptBlock produces. Returns '' when the policy adds
 *  nothing (no SME prompt, no principles, no rules). */
function renderPolicyBlock(args: {
  draft:    string
  version:  number
  digest:   BestPracticeDigest | null | undefined
  rules:    Record<string, Array<{ severity: 'must' | 'should' | 'nice'; text: string }>> | null | undefined
}): string {
  const parts: string[] = []
  const prompt = args.draft.trim()
  if (prompt.length > 0) {
    parts.push(`SME PROMPT (policy v${args.version})`, prompt)
  }
  const whole = renderWholeDocPrinciples(args.digest)
  if (whole) parts.push('', 'DOCUMENT-WIDE PRINCIPLES', whole)
  const sectionBlocks = renderAllSectionRules(args.digest, args.rules)
  for (const { sectionKey, block } of sectionBlocks) {
    parts.push('', `SECTION RULES (${sectionKey})`, block)
  }
  return parts.join('\n')
}

// Fixed scaffolding the AI drafter (apps/worker/src/jobs/ai-initial-draft.ts)
// prepends to every call. Admins can't change these — they're the
// product-level guardrails (HTML output, no-fabrication, doc type +
// section identity). We show them here so the policy block's role in
// the full system prompt is honest + visible: "your prompt sits HERE,
// after this scaffolding, before the per-call ask."
function renderDrafterScaffolding(docType: string): string {
  return [
    `You are drafting a single section of a regulatory clinical writing deliverable.`,
    `Document type: ${docType}.`,
    `Section number: {will be filled in per section at call time}`,
    `Section title: {will be filled in per section at call time}`,
    `Write a thorough first-pass draft of this section ONLY (not the surrounding document) based strictly on the attached source documents.`,
    `Return clean HTML with <p>, <ul>/<li>, and <table> as appropriate — no Markdown, no code fences, no commentary before or after the HTML.`,
    `If the sources genuinely do not contain the information needed for this section, write a short <p>stating what is missing and what the writer should supply.</p>`,
    `Do not invent numeric values, patient counts, dates, or citations. Quote figures only when they appear in the sources.`,
  ].join('\n')
}

// What the /ai-suggest route adds after the policy block when a writer
// hits "AI Suggest" on a section. The exact intent prompt varies
// ('tighten', 'explain', 'edit', 'custom'); we show a representative one.
function renderUserTurnExample(): string {
  return [
    `--- (per-call user turn, rendered by /ai-suggest) ---`,
    `Rewrite section §<N> "<section title>" of the above document.`,
    `Current content: <existing HTML>`,
    `Instruction: <author's 'tighten' / 'explain' / custom prompt>`,
    `Any attached scope context or source excerpts follow here.`,
  ].join('\n')
}

// Every document type, in the underscored form prompts are stored under (csr-full → csr_full).
// Labels are looked up at render time — translations aren't loaded yet when this module is first imported.
const DOC_TYPES = Object.keys(DOCUMENT_TYPE_KEY)

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
  const { data: readiness } = useAiReadiness()
  const aiReady = isAiReady(readiness)

  // Row click sets selectedDocType AND opens the edit panel (openEditor
  // below). No auto-pick on first load anymore — the list is the primary
  // view, admins choose what they open explicitly.
  const [selectedDocType, setSelectedDocType] = useState<string | null>(null)
  const selected = policies.find(p => p.docType === selectedDocType) ?? null
  // Both the create flow and the edit flow use non-modal right-edge slide
  // panels so the list stays visible underneath. Width persists per-user in
  // localStorage; the edit panel is wider by default because it holds a
  // 24-row textarea + a preview block.
  const [newPanelOpen,  setNewPanelOpen]  = useState(false)
  const [editPanelOpen, setEditPanelOpen] = useState(false)
  // Row click behaviour: set the selection + open the edit panel.
  const openEditor = (docType: string) => { setSelectedDocType(docType); setEditPanelOpen(true) }

  const [search, setSearch] = useState('')

  const invalidate = () => qc.invalidateQueries({ queryKey: ['document-type-policies'] })

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-5" data-screen="ai-prompts">
      <MasterLibraryHeading>
        <h1 className="text-[20px] font-semibold text-slate-900">AI Prompts</h1>
        <p className="mt-0.5 text-[13px] text-slate-500">
          The SME prompt AI sees on every draft + rewrite. One per doc type — editing here updates
          the same row the full Doc Type Policies screen edits. Everything else (Best-Practice
          digest, section rules, template pins) is managed over there.
        </p>
      </MasterLibraryHeading>

      <AiReadinessBanner
        readiness={readiness}
        context="Editing or creating prompts is blocked until an AI engine is configured — a prompt that never reaches a model is a trap for authors."
      />

      {isLoading && <p className="text-[13px] text-slate-500">Loading prompts…</p>}
      {error && <p className="text-[13px] text-rose-700">{errMessage(error, 'Could not load prompts')}</p>}

      {!isLoading && !error && (
        <PromptList
          policies={policies}
          search={search}
          onSearch={setSearch}
          onOpen={openEditor}
          onNew={() => setNewPanelOpen(true)}
        />
      )}

      <SlidePanel
        open={newPanelOpen}
        onClose={() => setNewPanelOpen(false)}
        title="New AI prompt"
        subtitle="Create a prompt for a doc type that doesn't have one yet."
        storageKey="clinwrite.aiPrompts.newPanel.width"
        defaultWidth={560}
        minWidth={420}
        maxWidth={900}
        expandable
      >
        <NewPromptForm
          aiReady={aiReady}
          taken={policies.map(p => p.docType)}
          onCreated={(docType) => {
            invalidate()
            setSelectedDocType(docType)
            setNewPanelOpen(false)
            setEditPanelOpen(true)
          }}
          onCancel={() => setNewPanelOpen(false)}
        />
      </SlidePanel>

      <SlidePanel
        open={editPanelOpen && !!selected}
        onClose={() => setEditPanelOpen(false)}
        title={selected ? `Edit prompt — ${documentTypeLabel(selected.docType)}` : 'Edit prompt'}
        subtitle={selected
          ? <span className="font-mono text-[11px]">{selected.docType} · v{selected.version} · updated {formatRelativeShort(selected.updatedAt)}</span>
          : undefined}
        storageKey="clinwrite.aiPrompts.editPanel.width"
        defaultWidth={720}
        minWidth={480}
        maxWidth={1200}
        expandable
      >
        {selected && (
          <PromptEditor
            key={selected.id}
            policy={selected}
            aiReady={aiReady}
            onSaved={invalidate}
          />
        )}
      </SlidePanel>
    </div>
  )
}

// Relative short-time formatter — "2d ago", "3h ago", "just now". Used in
// the list row and the edit panel subtitle. Falls back to the ISO date for
// anything older than ~30 days.
function formatRelativeShort(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return iso
  const ms = Date.now() - then
  const sec = Math.round(ms / 1000)
  if (sec < 60)         return 'just now'
  const min = Math.round(sec / 60)
  if (min < 60)         return `${min}m ago`
  const hr = Math.round(min / 60)
  if (hr < 24)          return `${hr}h ago`
  const d = Math.round(hr / 24)
  if (d < 30)           return `${d}d ago`
  return new Date(iso).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })
}

// ---- list ---------------------------------------------------------------

function PromptList({
  policies, search, onSearch, onOpen, onNew,
}: {
  policies: DocumentTypePolicy[]
  search:   string
  onSearch: (q: string) => void
  onOpen:   (docType: string) => void
  onNew:    () => void
}) {
  // Filter + sort client-side. Search matches both the slug and the
  // human-readable label so admins can type either "protocol" or
  // "Protocol Amendment".
  const q = search.trim().toLowerCase()
  const visible = policies
    .filter(p => {
      if (!q) return true
      const label = documentTypeLabel(p.docType).toLowerCase()
      return p.docType.toLowerCase().includes(q) || label.includes(q)
    })
    .sort((a, b) => a.docType.localeCompare(b.docType))

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3" data-prompt-list>
      <header className="flex flex-wrap items-center gap-3">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-widest text-slate-500">
          {policies.length} prompt{policies.length === 1 ? '' : 's'}
          {q && visible.length !== policies.length && (
            <span className="ml-2 text-slate-400">· {visible.length} match{visible.length === 1 ? '' : 'es'}</span>
          )}
        </p>
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <input
            type="search"
            value={search}
            onChange={e => onSearch(e.currentTarget.value)}
            placeholder="Search by doc type (e.g. protocol, CSR)…"
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-[12px] placeholder:text-slate-400"
            data-field="search-prompts"
          />
        </div>
        <div className="flex-1" />
        <button
          type="button"
          onClick={onNew}
          className="rounded-md border border-blue-600 bg-blue-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-blue-700"
          data-action="new-prompt"
        >
          + New prompt
        </button>
      </header>

      {policies.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed border-slate-300 bg-white p-8 text-center" data-empty>
          <p className="text-[13px] font-semibold text-slate-800">No prompts authored yet</p>
          <p className="max-w-md text-[12px] text-slate-500">
            Create the first AI prompt for a doc type to steer every draft + rewrite call.
          </p>
          <button
            type="button"
            onClick={onNew}
            className="rounded-md border border-blue-600 bg-blue-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-blue-700"
            data-action="empty-new"
          >
            + New prompt
          </button>
        </div>
      )}

      {policies.length > 0 && visible.length === 0 && (
        <p className="rounded-md border border-dashed border-slate-300 bg-white p-4 text-center text-[13px] text-slate-500" data-no-matches>
          No prompts match "{search}".
        </p>
      )}

      {visible.length > 0 && (
        <div className="overflow-hidden rounded-md border border-slate-200 bg-white" data-table>
          <table className="w-full table-fixed text-[13px]">
            <thead className="bg-slate-50 text-left font-mono text-[10px] uppercase tracking-widest text-slate-500">
              <tr>
                <th className="w-[36%] px-3 py-2 font-semibold">Doc type</th>
                <th className="w-[14%] px-3 py-2 font-semibold">Version</th>
                <th className="w-[14%] px-3 py-2 font-semibold text-right">Prompt size</th>
                <th className="w-[20%] px-3 py-2 font-semibold">Last updated</th>
                <th className="w-[16%] px-3 py-2 font-semibold">By</th>
              </tr>
            </thead>
            <tbody>
              {visible.map(p => (
                <tr
                  key={p.id}
                  onClick={() => onOpen(p.docType)}
                  className="cursor-pointer border-t border-slate-100 hover:bg-blue-50/60"
                  data-row={p.docType}
                  tabIndex={0}
                  onKeyDown={e => { if (e.key === 'Enter') onOpen(p.docType) }}
                >
                  <td className="px-3 py-2">
                    <div className="flex flex-col">
                      <span className="font-semibold text-slate-900">{documentTypeLabel(p.docType)}</span>
                      <span className="font-mono text-[10px] text-slate-500">{p.docType}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2 font-mono text-[12px] text-slate-700">v{p.version}</td>
                  <td className="px-3 py-2 text-right font-mono text-[12px] text-slate-700">
                    {p.smePrompt.length.toLocaleString()}<span className="ml-1 text-slate-400">ch</span>
                  </td>
                  <td className="px-3 py-2 text-slate-700" title={new Date(p.updatedAt).toLocaleString()}>
                    {formatRelativeShort(p.updatedAt)}
                  </td>
                  <td className="truncate px-3 py-2 font-mono text-[11px] text-slate-500" title={p.updatedBy}>
                    {p.updatedBy}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ---- editor -------------------------------------------------------------

function PromptEditor({ policy, aiReady, onSaved }: { policy: DocumentTypePolicy; aiReady: boolean; onSaved: () => void }) {
  const [draft,       setDraft]       = useState(policy.smePrompt)
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionInfo,  setActionInfo]  = useState<string | null>(null)
  // When the current version is already pinned by any document, the API
  // rejects PATCH with 409 version_in_use and expects a bump instead. We
  // surface a change-reason prompt inline rather than looping the admin
  // through the full policy editor.
  const [needsBump,   setNeedsBump]   = useState(false)
  const [bumpReason,  setBumpReason]  = useState('')
  const [previewOpen, setPreviewOpen] = useState(false)
  const preview = useMemo(() => {
    const scaffolding = renderDrafterScaffolding(policy.docType)
    const policyBlock = renderPolicyBlock({
      draft,
      version: policy.version,
      digest:  policy.bestPracticeDigest,
      rules:   policy.sectionRules as Record<string, Array<{ severity: 'must' | 'should' | 'nice'; text: string }>> | null,
    })
    const userTurn = renderUserTurnExample()
    const composed = [scaffolding, policyBlock, userTurn].filter(Boolean).join('\n\n')
    return { scaffolding, policyBlock, userTurn, composed }
  }, [draft, policy.docType, policy.version, policy.bestPracticeDigest, policy.sectionRules])

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

  // Reset + Save actions get rendered in two spots — pinned in the sticky
  // header row so admins editing a 7k-char prompt never scroll past the
  // Save button, and repeated under the textarea for muscle-memory reach.
  // Both call the same handlers; the UI treats them as one logical pair.
  const actionButtons = !needsBump && (
    <>
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
        disabled={!dirty || !trimmed || save.isPending || !aiReady}
        title={!aiReady ? 'AI is not set up — configure an AI engine first.' : undefined}
        className="rounded-md border border-blue-600 bg-blue-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        data-action="save"
      >
        {save.isPending ? 'Saving…' : 'Save prompt'}
      </button>
    </>
  )

  return (
    // p-4 so editor content doesn't hug the SlidePanel's edges. The
    // SlidePanel already renders the title + docType/version/updated
    // subtitle, so the inner header here only shows transient state
    // (char count, unsaved chip) + the action buttons.
    <div className="flex flex-col gap-3 p-4" data-editor={policy.docType}>
      <header className="sticky top-0 z-10 -mx-4 -mt-4 flex flex-wrap items-center justify-end gap-3 border-b border-slate-200 bg-white px-4 py-2">
        <div className="flex items-center gap-2 text-[11px] text-slate-500">
          <span>{draft.length.toLocaleString()} chars</span>
          {dirty && <span className="rounded bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-800">unsaved</span>}
        </div>
        <div className="flex items-center gap-2" data-header-actions>
          {actionButtons}
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

      {/* "What AI actually sees" preview — composed exactly like the API's
          renderPolicyPromptBlock: SME prompt + document-wide principles
          (ordered must → should → nice) + per-section rules. Uses the
          CURRENT draft so unsaved edits are reflected before Save. */}
      <section className="rounded-md border border-slate-200 bg-slate-50" data-preview-panel>
        <button
          type="button"
          onClick={() => setPreviewOpen(v => !v)}
          className="flex w-full items-center justify-between px-3 py-2 text-left text-[12px] font-semibold text-slate-800 hover:bg-slate-100"
          data-action="toggle-preview"
          aria-expanded={previewOpen}
        >
          <span>
            Preview — the full system prompt AI receives
            {dirty && <span className="ml-2 font-mono text-[10px] font-normal text-amber-700">(from unsaved draft)</span>}
          </span>
          <span className="font-mono text-[10px] text-slate-500">
            {preview.composed.length.toLocaleString()} chars · {previewOpen ? '▾ hide' : '▸ show'}
          </span>
        </button>
        {previewOpen && (
          <div className="flex flex-col gap-2 border-t border-slate-200 px-3 py-3" data-preview-body>
            <p className="text-[11px] text-slate-500">
              The AI drafter composes every call from three parts.
              Blue is <strong>your policy</strong> — what you edit here (plus the BP digest + section rules from the Doc Type Policies tab).
              Grey is <strong>fixed scaffolding</strong> — product guardrails the admin can't change.
            </p>

            {/* A — fixed scaffolding (grey) */}
            <PreviewBlock
              tone="scaffolding"
              label="A · System scaffolding (fixed — product guardrails)"
              text={preview.scaffolding}
            />

            {/* B — the policy block (blue). Empty state when the policy
                has no SME prompt / digest / rules. */}
            <PreviewBlock
              tone="policy"
              label={preview.policyBlock
                ? 'B · Your policy block (SME prompt + BP digest + section rules)'
                : 'B · Your policy block — EMPTY (nothing added to the system prompt yet)'}
              text={preview.policyBlock || '(Add an SME prompt above, or add a BP digest / section rules on the Doc Type Policies tab, for this block to carry anything.)'}
              muted={!preview.policyBlock}
            />

            {/* C — per-call user turn (grey, representative) */}
            <PreviewBlock
              tone="scaffolding"
              label="C · Per-call user turn (filled in by the API at request time)"
              text={preview.userTurn}
            />

            <div className="flex items-center justify-between border-t border-slate-200 pt-2">
              <p className="text-[11px] text-slate-500">
                Policy block render mirrors the API&apos;s <code>renderPolicyPromptBlock</code> character-for-character
                (parity-tested on the worker side).
              </p>
              <button
                type="button"
                onClick={() => navigator.clipboard?.writeText(preview.composed).then(
                  () => setActionInfo('Full composed prompt copied.'),
                  ()  => setActionError('Could not copy to clipboard.'),
                )}
                className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                data-action="copy-preview"
              >
                Copy all
              </button>
            </div>
          </div>
        )}
      </section>

      {!needsBump && (
        <div className="flex items-center justify-end gap-2" data-footer-actions>
          {actionButtons}
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
              disabled={bump.isPending || !bumpReason.trim() || !trimmed || !aiReady}
              title={!aiReady ? 'AI is not set up — configure an AI engine first.' : undefined}
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

function NewPromptForm({
  aiReady, taken, onCreated, onCancel,
}: {
  aiReady:  boolean
  taken:    string[]
  onCreated: (docType: string) => void
  onCancel?: () => void
}) {
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
    <div className="flex h-full flex-col gap-3 p-4" data-new-prompt>
      <p className="text-[12px] text-slate-500">
        Pick a doc type and paste the SME prompt. Doc types that already have a prompt are greyed out; edit those from the list.
      </p>
      {error && <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700">{error}</p>}
      <select
        value={docType}
        onChange={e => setDocType(e.currentTarget.value)}
        aria-label="Doc type"
        className={`rounded-md border border-slate-300 bg-white px-3 py-1.5 text-[12px] ${docType ? 'text-slate-900' : 'text-slate-400'}`}
        data-field="create-doc-type"
      >
        <option value="" disabled>Select a doc type</option>
        {DOC_TYPES.map(type => {
          const value  = type.replace(/-/g, '_')
          const exists = taken.includes(value)
          return (
            <option key={value} value={value} disabled={exists} className="text-slate-900">
              {documentTypeLabel(type)}{exists ? ' — prompt exists' : ''}
            </option>
          )
        })}
      </select>
      <textarea
        value={smePrompt}
        onChange={e => setSmePrompt(e.currentTarget.value)}
        rows={16}
        placeholder="SME prompt — the role-specific preamble the AI reads on every call."
        className="flex-1 resize-y rounded-md border border-slate-300 px-3 py-2 font-mono text-[12px] leading-relaxed"
        data-field="create-sme-prompt"
      />
      <div className="flex items-center justify-end gap-2 border-t border-slate-200 pt-3">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={create.isPending}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-[12px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            data-action="create-cancel"
          >
            Cancel
          </button>
        )}
        <button
          type="button"
          onClick={() => create.mutate()}
          disabled={create.isPending || !docType.trim() || !smePrompt.trim() || !aiReady}
          title={!aiReady ? 'AI is not set up — configure an AI engine first.' : undefined}
          className="rounded-md border border-blue-600 bg-blue-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          data-action="create-prompt"
        >
          {create.isPending ? 'Creating…' : 'Create prompt'}
        </button>
      </div>
    </div>
  )
}

// One section of the composed-prompt preview. Blue background = policy
// (user-owned); grey = system scaffolding (admin can't change). `muted`
// greys out the text itself when the block is an empty-state hint.
function PreviewBlock({
  tone, label, text, muted = false,
}: {
  tone:  'scaffolding' | 'policy'
  label: string
  text:  string
  muted?: boolean
}) {
  const classes =
    tone === 'policy'
      ? { frame: 'border-blue-200 bg-blue-50/40', label: 'text-blue-900', pre: 'bg-white text-slate-800 border-blue-200' }
      : { frame: 'border-slate-200 bg-white',    label: 'text-slate-700', pre: 'bg-slate-50 text-slate-700 border-slate-200' }
  return (
    <div className={`rounded-md border ${classes.frame} p-2`} data-preview-section={tone}>
      <p className={`mb-1 font-mono text-[10px] font-semibold uppercase tracking-widest ${classes.label}`}>{label}</p>
      <pre className={`max-h-56 overflow-auto rounded-md border ${classes.pre} p-2 font-mono text-[11px] leading-relaxed ${muted ? 'italic text-slate-400' : ''}`}>
        {text}
      </pre>
    </div>
  )
}
