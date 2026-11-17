// AI Prompts — admin screen (Phase-1 pointer refactor, migration 73).
//
// Prompts are their own entity (AiPromptRecord) with an explicit
// draft → approved → retired workflow. Admins:
//   - Start a new draft (either net-new docType or new version of existing).
//   - Edit drafts in place.
//   - Approve a draft: the previous approved row flips to retired +
//     supersededBy = this row id, atomically server-side.
//   - Retire a row (operator cleanup).
//
// The screen reads the list of latest-approved rows, lets admins open a
// row to see its current approved content side-by-side with any live
// draft for the same docType, and keeps the BP digest + section rules
// render preview wired to the policy row (BP is still policy-scoped
// until Phase 2 promotes it).

import { MasterLibraryHeading } from '../components/MasterLibraryHeading'
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError } from '../../api/client'
import {
  platformApi,
  type AiPromptRecord,
  type AiPromptSectionRules,
  type BestPracticeDigest,
  type DocumentTypePolicy,
} from '../api/platformApi'
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
  rules:  AiPromptSectionRules | null | undefined,
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
  rules:    AiPromptSectionRules | null | undefined
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

// Fixed product-level grounding rules — mirror of
// apps/api/src/modules/platform/document-type-policy/resolve.ts
// SECTION_GROUNDING_RULES. Keep character-identical.
const SECTION_GROUNDING_RULES_WEB = [
  'SECTION GROUNDING RULES (product guardrails — always applied)',
  '- The attached source documents are the authoritative primary references for every fact, figure, date, numeric value, name, and citation in this section. Prefer verbatim quote or close paraphrase from the attachments over anything you can derive on your own.',
  '- When the attached sources genuinely do not contain information the section needs, insert a bracketed placeholder — [TBD: what is needed] — rather than fabricating. Never invent numbers, patient counts, dates, trial identifiers, or citations.',
  '- You are rewriting a single section only. Do not rewrite other sections or expand this one beyond its scope. Any "Additional context" below is reference material, not an edit target.',
  '- Preserve existing reference markers (superscripts, [1], §9.4 Table 3, etc.) unless the instruction says otherwise. A new claim that cites an attached source needs a visible reference.',
].join('\n')

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
    '',
    SECTION_GROUNDING_RULES_WEB,
  ].join('\n')
}

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

type AiPromptRow = AiPromptRecord & { rules: AiPromptSectionRules }

function toRow(r: AiPromptRecord): AiPromptRow {
  return { ...r, rules: (r.sectionRules as AiPromptSectionRules | null) ?? {} }
}

/** JSON → AiPromptSectionRules with light validation. Used by the Edit JSON
 *  toggle on the parsed-rules panel so admins can tweak severity/text
 *  without losing the structured view. */
function parseRulesJson(text: string): { ok: AiPromptSectionRules } | { err: string } {
  const trimmed = text.trim()
  if (trimmed.length === 0) return { ok: {} }
  let parsed: unknown
  try { parsed = JSON.parse(trimmed) }
  catch (err) { return { err: `JSON parse: ${err instanceof Error ? err.message : String(err)}` } }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { err: 'Must be a JSON object keyed by section id.' }
  }
  const out: AiPromptSectionRules = {}
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!Array.isArray(value)) return { err: `${key}: value must be an array` }
    const bucket: Array<{ severity: 'must' | 'should' | 'nice'; text: string }> = []
    for (const [i, v] of value.entries()) {
      if (!v || typeof v !== 'object') return { err: `${key}[${i}]: must be an object` }
      const rule = v as Record<string, unknown>
      if (rule.severity !== 'must' && rule.severity !== 'should' && rule.severity !== 'nice') {
        return { err: `${key}[${i}].severity must be must/should/nice` }
      }
      if (typeof rule.text !== 'string' || rule.text.trim().length === 0) {
        return { err: `${key}[${i}].text must be a non-empty string` }
      }
      bucket.push({ severity: rule.severity, text: rule.text })
    }
    out[key] = bucket
  }
  return { ok: out }
}

export function AiPrompts() {
  const qc = useQueryClient()
  // List of latest-approved rows (list screen). Drafts live per-docType and
  // are fetched on-demand when a row is opened — avoids double-listing
  // drafts next to approved rows at the top level.
  const approvedQ = useQuery({
    queryKey: ['ai-prompts-approved'],
    queryFn:  () => platformApi.listAiPrompts(),
  })
  // Policy rows power the BP digest + preview block. Section rules on the
  // policy still contribute to the preview until an approved AiPromptRecord
  // carries them; after that the AiPromptRecord.sectionRules wins.
  const policiesQ = useQuery({
    queryKey: ['document-type-policies'],
    queryFn:  () => platformApi.listDocumentTypePolicies(),
  })
  const approved = useMemo(
    () => (approvedQ.data?.prompts ?? []).map(toRow),
    [approvedQ.data],
  )
  const policies = useMemo(() => policiesQ.data?.policies ?? [], [policiesQ.data])
  const { data: readiness } = useAiReadiness()
  const aiReady = isAiReady(readiness)

  const [selectedDocType, setSelectedDocType] = useState<string | null>(null)
  const [newPanelOpen,  setNewPanelOpen]  = useState(false)
  const [editPanelOpen, setEditPanelOpen] = useState(false)
  const openEditor = (docType: string) => { setSelectedDocType(docType); setEditPanelOpen(true) }

  const [search, setSearch] = useState('')

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ['ai-prompts-approved'] })
    qc.invalidateQueries({ queryKey: ['ai-prompt-versions'] })
  }

  const policyFor = (docType: string) =>
    policies.find(p => p.docType === docType) ?? null

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-5" data-screen="ai-prompts">
      <MasterLibraryHeading>
        <h1 className="text-[20px] font-semibold text-slate-900">AI Prompts</h1>
        <p className="mt-0.5 text-[13px] text-slate-500">
          The SME prompt + section rules AI sees on every draft + rewrite. Drafts are editable in
          place; Approve flips the previously-approved row to retired and starts a new version
          — documents created before that keep using the version they were pinned to.
        </p>
      </MasterLibraryHeading>

      <AiReadinessBanner
        readiness={readiness}
        context="Editing, creating, or approving prompts is blocked until an AI engine is configured — a prompt that never reaches a model is a trap for authors."
      />

      {approvedQ.isLoading && <p className="text-[13px] text-slate-500">Loading prompts…</p>}
      {approvedQ.error && <p className="text-[13px] text-rose-700">{errMessage(approvedQ.error, 'Could not load prompts')}</p>}

      {!approvedQ.isLoading && !approvedQ.error && (
        <PromptList
          approved={approved}
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
        subtitle="Start a draft for a doc type that doesn't have an approved prompt yet."
        storageKey="clinwrite.aiPrompts.newPanel.width"
        defaultWidth={560}
        minWidth={420}
        maxWidth={900}
        expandable
      >
        <NewPromptForm
          aiReady={aiReady}
          takenApproved={approved.map(r => r.docType)}
          onCreated={(docType) => {
            invalidateAll()
            setSelectedDocType(docType)
            setNewPanelOpen(false)
            setEditPanelOpen(true)
          }}
          onCancel={() => setNewPanelOpen(false)}
        />
      </SlidePanel>

      <SlidePanel
        open={editPanelOpen && !!selectedDocType}
        onClose={() => setEditPanelOpen(false)}
        title={selectedDocType ? `Prompt — ${documentTypeLabel(selectedDocType)}` : 'Prompt'}
        subtitle={selectedDocType ? <span className="font-mono text-[11px]">{selectedDocType}</span> : undefined}
        storageKey="clinwrite.aiPrompts.editPanel.width"
        defaultWidth={760}
        minWidth={520}
        maxWidth={1200}
        expandable
      >
        {selectedDocType && (
          <PromptPanel
            key={selectedDocType}
            docType={selectedDocType}
            policy={policyFor(selectedDocType)}
            aiReady={aiReady}
            onChanged={invalidateAll}
          />
        )}
      </SlidePanel>
    </div>
  )
}

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
  approved, search, onSearch, onOpen, onNew,
}: {
  approved: AiPromptRow[]
  search:   string
  onSearch: (q: string) => void
  onOpen:   (docType: string) => void
  onNew:    () => void
}) {
  const q = search.trim().toLowerCase()
  const visible = approved
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
          {approved.length} approved prompt{approved.length === 1 ? '' : 's'}
          {q && visible.length !== approved.length && (
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

      {approved.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed border-slate-300 bg-white p-8 text-center" data-empty>
          <p className="text-[13px] font-semibold text-slate-800">No approved prompts yet</p>
          <p className="max-w-md text-[12px] text-slate-500">
            Draft and approve a prompt for a doc type to steer every draft + rewrite call.
            Drafts don't reach AI until they're approved.
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

      {approved.length > 0 && visible.length === 0 && (
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
                <th className="w-[20%] px-3 py-2 font-semibold">Approved</th>
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
                  <td className="px-3 py-2 font-mono text-[12px] text-slate-700">
                    v{p.version} <span className="ml-1 rounded bg-emerald-100 px-1 py-0.5 text-[9px] font-semibold uppercase text-emerald-800">approved</span>
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-[12px] text-slate-700">
                    {p.smePrompt.length.toLocaleString()}<span className="ml-1 text-slate-400">ch</span>
                  </td>
                  <td className="px-3 py-2 text-slate-700" title={p.approvedAt ? new Date(p.approvedAt).toLocaleString() : ''}>
                    {p.approvedAt ? formatRelativeShort(p.approvedAt) : '—'}
                  </td>
                  <td className="truncate px-3 py-2 font-mono text-[11px] text-slate-500" title={p.approvedBy ?? p.updatedBy}>
                    {p.approvedBy ?? p.updatedBy}
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

// ---- panel: approved summary + draft editor -----------------------------

function PromptPanel({
  docType, policy, aiReady, onChanged,
}: {
  docType:   string
  policy:    DocumentTypePolicy | null
  aiReady:   boolean
  onChanged: () => void
}) {
  // Version history: draft (if any) + the approved row + retired. The
  // panel shows the approved row as read-only (that's what AI uses) and
  // the draft inline for editing / approval.
  const versionsQ = useQuery({
    queryKey: ['ai-prompt-versions', docType],
    queryFn:  () => platformApi.listAiPromptVersions(docType),
  })
  const versions = useMemo(() => (versionsQ.data?.versions ?? []).map(toRow), [versionsQ.data])
  const approved = versions.find(v => v.status === 'approved') ?? null
  const draft    = versions.find(v => v.status === 'draft')    ?? null

  if (versionsQ.isLoading) {
    return <div className="p-4 text-[12px] text-slate-500">Loading versions…</div>
  }

  return (
    <div className="flex flex-col gap-4 p-4" data-panel={docType}>
      {approved ? (
        <ApprovedSummary row={approved} />
      ) : (
        <div className="rounded-md border border-dashed border-amber-300 bg-amber-50 p-3 text-[12px] text-amber-900" data-no-approved>
          No approved prompt for this doc type yet. The AI drafter falls back to the policy's
          legacy <code className="rounded bg-amber-100 px-1 font-mono text-[10px]">smePrompt</code> until a draft here is approved.
        </div>
      )}

      {draft ? (
        <DraftEditor
          key={draft.id}
          draft={draft}
          approved={approved}
          policy={policy}
          aiReady={aiReady}
          onChanged={onChanged}
        />
      ) : (
        <StartDraftFromApproved
          docType={docType}
          approved={approved}
          aiReady={aiReady}
          onStarted={onChanged}
        />
      )}
    </div>
  )
}

function ApprovedSummary({ row }: { row: AiPromptRow }) {
  const ruleSections = Object.keys(row.rules).length
  const ruleTotal    = Object.values(row.rules).reduce((n, arr) => n + arr.length, 0)
  return (
    <section className="rounded-md border border-emerald-200 bg-emerald-50/40 p-3" data-approved>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-emerald-800">Approved v{row.version}</span>
          <span className="font-mono text-[10px] text-slate-500">
            {row.approvedAt ? `approved ${formatRelativeShort(row.approvedAt)}` : ''}
          </span>
        </div>
        <span className="font-mono text-[10px] text-slate-500">
          {row.smePrompt.length.toLocaleString()} chars · {ruleSections} section{ruleSections === 1 ? '' : 's'} / {ruleTotal} rule{ruleTotal === 1 ? '' : 's'}
        </span>
      </div>
      <details className="mt-2">
        <summary className="cursor-pointer text-[11px] font-semibold text-emerald-900">Show approved SME prompt (read-only)</summary>
        <pre className="mt-2 max-h-56 overflow-auto rounded border border-emerald-200 bg-white p-2 font-mono text-[11px] leading-relaxed text-slate-800">
          {row.smePrompt}
        </pre>
      </details>
      <details className="mt-2" open={ruleTotal > 0 && ruleTotal <= 10}>
        <summary className="cursor-pointer text-[11px] font-semibold text-emerald-900">
          Show parsed section rules{ruleTotal === 0 ? ' — none' : ` (${ruleTotal})`}
        </summary>
        <div className="mt-2">
          <ParsedRulesView rules={row.rules} tone="approved" />
        </div>
      </details>
    </section>
  )
}

// Readable, non-JSON rendering of section rules. Grouped by section with
// severity chips. Used by both the approved summary (read-only) + the
// draft editor (where it sits alongside the Parse button).
function ParsedRulesView({
  rules, tone,
}: {
  rules: AiPromptSectionRules
  tone:  'approved' | 'draft'
}) {
  const sectionKeys = Object.keys(rules).sort()
  if (sectionKeys.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-3 text-center text-[12px] italic text-slate-500" data-empty-rules>
        No per-section rules parsed yet. Click <strong>Parse SME prompt</strong> to let AI surface
        per-section guidance from the prompt text — or author rules by hand with Edit JSON.
      </p>
    )
  }
  const frame = tone === 'approved'
    ? 'border-emerald-200 bg-white/70'
    : 'border-blue-200 bg-white'
  const key = tone === 'approved' ? 'text-emerald-900' : 'text-blue-900'
  return (
    <ul className="flex flex-col gap-2" data-parsed-rules-view={tone}>
      {sectionKeys.map(sectionKey => {
        const items = rules[sectionKey] ?? []
        return (
          <li key={sectionKey} className={`rounded-md border ${frame} p-2`} data-parsed-section={sectionKey}>
            <p className={`font-mono text-[10px] font-semibold ${key}`}>{sectionKey}</p>
            <ul className="mt-1.5 space-y-1 text-[12px]">
              {items.map((r, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[9px] uppercase ${
                    r.severity === 'must'   ? 'bg-rose-100 text-rose-800' :
                    r.severity === 'should' ? 'bg-amber-100 text-amber-800' :
                                               'bg-slate-100 text-slate-700'
                  }`}>{r.severity}</span>
                  <span className="text-slate-800">{r.text}</span>
                </li>
              ))}
            </ul>
          </li>
        )
      })}
    </ul>
  )
}

function StartDraftFromApproved({
  docType, approved, aiReady, onStarted,
}: {
  docType:   string
  approved:  AiPromptRow | null
  aiReady:   boolean
  onStarted: () => void
}) {
  const [error, setError] = useState<string | null>(null)
  const start = useMutation({
    mutationFn: () => platformApi.createAiPromptDraft({
      docType,
      smePrompt:    approved?.smePrompt ?? '(write the SME prompt here)',
      sectionRules: approved?.rules    ?? {},
    }),
    onSuccess: () => { setError(null); onStarted() },
    onError:   (err: unknown) => setError(errMessage(err, 'Could not start a draft')),
  })
  return (
    <section className="rounded-md border border-slate-200 bg-white p-3" data-no-draft>
      <p className="text-[12px] text-slate-700">
        No draft in progress for this doc type.{' '}
        {approved
          ? 'Start a new draft from the approved version — admins can edit it freely until the next Approve.'
          : 'Start a blank draft to begin authoring.'}
      </p>
      {error && <p className="mt-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700">{error}</p>}
      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={() => start.mutate()}
          disabled={start.isPending || !aiReady}
          title={!aiReady ? 'AI is not set up — configure an AI engine first.' : undefined}
          className="rounded-md border border-blue-600 bg-blue-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          data-action="start-draft"
        >
          {start.isPending ? 'Starting…' : approved ? 'Start a new draft' : 'Start the first draft'}
        </button>
      </div>
    </section>
  )
}

// ---- draft editor -------------------------------------------------------

function DraftEditor({
  draft, approved, policy, aiReady, onChanged,
}: {
  draft:     AiPromptRow
  approved:  AiPromptRow | null
  policy:    DocumentTypePolicy | null
  aiReady:   boolean
  onChanged: () => void
}) {
  const [smePrompt, setSmePrompt]    = useState(draft.smePrompt)
  const [rules,     setRules]        = useState<AiPromptSectionRules>(draft.rules)
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionInfo,  setActionInfo]  = useState<string | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [rulesJsonOpen,  setRulesJsonOpen]  = useState(false)
  const [rulesJsonText,  setRulesJsonText]  = useState(() => JSON.stringify(draft.rules, null, 2))
  const [rulesJsonError, setRulesJsonError] = useState<string | null>(null)

  const dirty = smePrompt !== draft.smePrompt || JSON.stringify(rules) !== JSON.stringify(draft.rules)
  const trimmed = smePrompt.trim()

  // BP digest still rides on the policy row (Phase 1). Preview renders
  // the composed prompt: scaffolding + (SME + BP digest + sectionRules).
  // Rules come from the draft, principles from the policy — matches the
  // server-side resolver's mixing rule.
  const preview = useMemo(() => {
    const scaffolding = renderDrafterScaffolding(draft.docType)
    const policyBlock = renderPolicyBlock({
      draft:   smePrompt,
      version: draft.version,
      digest:  policy?.bestPracticeDigest ?? null,
      rules,
    })
    const userTurn = renderUserTurnExample()
    const composed = [scaffolding, policyBlock, userTurn].filter(Boolean).join('\n\n')
    return { scaffolding, policyBlock, userTurn, composed }
  }, [smePrompt, rules, draft.docType, draft.version, policy?.bestPracticeDigest])

  const save = useMutation({
    mutationFn: () => platformApi.updateAiPromptDraft(draft.id, {
      smePrompt,
      sectionRules: rules,
    }),
    onSuccess: () => {
      setActionInfo('Draft saved.')
      setActionError(null)
      onChanged()
    },
    onError: (err: unknown) => { setActionError(errMessage(err, 'Save failed')); setActionInfo(null) },
  })

  const approve = useMutation({
    mutationFn: () => platformApi.approveAiPrompt(draft.id),
    onSuccess: () => {
      setActionInfo(`Draft approved as v${draft.version}. AI starts using it for new documents immediately.`)
      setActionError(null)
      onChanged()
    },
    onError: (err: unknown) => { setActionError(errMessage(err, 'Approve failed')); setActionInfo(null) },
  })

  const retire = useMutation({
    mutationFn: () => platformApi.retireAiPrompt(draft.id, 'Draft discarded by admin'),
    onSuccess: () => {
      setActionInfo('Draft discarded.')
      setActionError(null)
      onChanged()
    },
    onError: (err: unknown) => { setActionError(errMessage(err, 'Discard failed')); setActionInfo(null) },
  })

  const extract = useMutation({
    mutationFn: () => platformApi.extractSectionRulesForPrompt(draft.id),
    onSuccess: (res) => {
      // Non-destructive: we show the parsed rules in a review modal and
      // only persist on Save-rules. Match the Doc Type Policies flow.
      setParsedRules(res.sectionRules)
      setParseReviewOpen(true)
      setActionError(null)
      setActionInfo(
        res.ruleCount === 0
          ? 'AI found no per-section rules in this SME prompt — the parsed structure is empty.'
          : `AI parsed ${res.ruleCount} rule${res.ruleCount === 1 ? '' : 's'} across ${res.sectionCount} section${res.sectionCount === 1 ? '' : 's'}. Review + Save to persist.`,
      )
    },
    onError: (err: unknown) => { setActionError(errMessage(err, 'Parse failed')); setActionInfo(null) },
  })

  const [parsedRules,     setParsedRules]     = useState<AiPromptSectionRules | null>(null)
  const [parseReviewOpen, setParseReviewOpen] = useState(false)

  const applyParsedRules = () => {
    if (parsedRules) setRules(parsedRules)
    setParseReviewOpen(false)
    setParsedRules(null)
    setActionInfo('Parsed rules merged into draft — review the preview, then Save.')
  }

  const ruleSections = Object.keys(rules).length
  const ruleTotal    = Object.values(rules).reduce((n, arr) => n + arr.length, 0)

  return (
    <section className="flex flex-col gap-3 rounded-md border border-blue-200 bg-blue-50/30 p-3" data-draft={draft.id}>
      <header className="sticky top-0 z-10 -mx-3 -mt-3 flex flex-wrap items-center justify-between gap-3 border-b border-blue-200 bg-blue-50/80 px-3 py-2 backdrop-blur">
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-amber-800">
            Draft v{draft.version}
          </span>
          <span className="font-mono text-[10px] text-slate-500">
            {smePrompt.length.toLocaleString()} chars
          </span>
          {dirty && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">unsaved</span>}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => { setSmePrompt(draft.smePrompt); setRules(draft.rules); setActionInfo(null); setActionError(null) }}
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
            {save.isPending ? 'Saving…' : 'Save draft'}
          </button>
          <button
            type="button"
            onClick={() => approve.mutate()}
            disabled={dirty || !trimmed || approve.isPending || !aiReady}
            title={
              dirty    ? 'Save the draft before approving.' :
              !aiReady ? 'AI is not set up — configure an AI engine first.' :
              approved ? `Approve will retire v${approved.version} and make this the new approved prompt.`
                       : 'Approve this draft as the first approved version.'
            }
            className="rounded-md border border-emerald-600 bg-emerald-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
            data-action="approve"
          >
            {approve.isPending ? 'Approving…' : approved ? `Approve v${draft.version} (retires v${approved.version})` : `Approve v${draft.version}`}
          </button>
        </div>
      </header>

      {actionError && <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700">{actionError}</p>}
      {actionInfo  && <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] text-emerald-800">{actionInfo}</p>}

      <textarea
        value={smePrompt}
        onChange={e => { setSmePrompt(e.currentTarget.value); setActionInfo(null) }}
        rows={20}
        className="w-full resize-y rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-[12px] leading-relaxed"
        data-field="sme-prompt"
        placeholder="SME prompt — role-specific preamble the AI reads on every draft + rewrite."
      />

      <section className="rounded-md border border-slate-200 bg-white p-3" data-parsed-structures>
        <header className="mb-2 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">
              Parsed section rules (draft)
            </span>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700" data-chip="section-rules">
              {ruleSections} section{ruleSections === 1 ? '' : 's'} · {ruleTotal} rule{ruleTotal === 1 ? '' : 's'}
            </span>
            {policy?.bestPracticeDigest?.principles?.length ? (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700" data-chip="bp-digest">
                BP digest · {policy.bestPracticeDigest.principles.length} principle{policy.bestPracticeDigest.principles.length === 1 ? '' : 's'}
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setRulesJsonOpen(v => !v)}
              className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
              data-action="edit-rules-json"
              aria-expanded={rulesJsonOpen}
            >
              {rulesJsonOpen ? 'Hide JSON' : 'Edit JSON'}
            </button>
            <button
              type="button"
              onClick={() => extract.mutate()}
              disabled={extract.isPending || !aiReady || !trimmed}
              title={
                !aiReady ? 'AI is not set up — configure an AI engine first.' :
                !trimmed ? 'Write an SME prompt first.' :
                undefined
              }
              className="rounded-md border border-blue-600 bg-blue-600 px-3 py-1 text-[11px] font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              data-action="extract-parse"
            >
              {extract.isPending ? 'Parsing…' : 'Parse SME prompt (AI) ✦'}
            </button>
          </div>
        </header>
        <ParsedRulesView rules={rules} tone="draft" />
        {rulesJsonOpen && (
          <div className="mt-3" data-rules-json-editor>
            <p className="mb-1 font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">
              Rules JSON (editable){rulesJsonError && <span className="ml-2 font-normal text-rose-700">· {rulesJsonError}</span>}
            </p>
            <textarea
              value={rulesJsonText}
              onChange={e => {
                const txt = e.currentTarget.value
                setRulesJsonText(txt)
                const parsed = parseRulesJson(txt)
                if ('ok' in parsed) {
                  setRulesJsonError(null)
                  setRules(parsed.ok)
                  setActionInfo(null)
                } else {
                  setRulesJsonError(parsed.err)
                }
              }}
              rows={10}
              spellCheck={false}
              className="w-full resize-y rounded-md border border-slate-300 px-3 py-2 font-mono text-[11px] leading-relaxed"
              data-field="rules-json"
            />
            <p className="mt-1 text-[10px] text-slate-500">
              Keyed by section id, each a list of <code>{'{ severity, text }'}</code>. Changes merge
              into the draft once the JSON parses cleanly.
            </p>
          </div>
        )}
      </section>

      <section className="rounded-md border border-slate-200 bg-slate-50" data-preview-panel>
        <button
          type="button"
          onClick={() => setPreviewOpen(v => !v)}
          className="flex w-full items-center justify-between px-3 py-2 text-left text-[12px] font-semibold text-slate-800 hover:bg-slate-100"
          data-action="toggle-preview"
          aria-expanded={previewOpen}
        >
          <span>
            Preview — the full system prompt AI will receive{' '}
            <span className="font-mono text-[10px] font-normal text-amber-700">(from unsaved draft)</span>
          </span>
          <span className="font-mono text-[10px] text-slate-500">
            {preview.composed.length.toLocaleString()} chars · {previewOpen ? '▾ hide' : '▸ show'}
          </span>
        </button>
        {previewOpen && (
          <div className="flex flex-col gap-2 border-t border-slate-200 px-3 py-3" data-preview-body>
            <p className="text-[11px] text-slate-500">
              The AI drafter composes every call from three parts.
              Blue is <strong>your policy</strong> (SME prompt + BP digest + section rules).
              Grey is <strong>fixed scaffolding</strong> — product guardrails the admin can't change.
            </p>
            <PreviewBlock tone="scaffolding" label="A · System scaffolding (fixed — product guardrails)" text={preview.scaffolding} />
            <PreviewBlock
              tone="policy"
              label={preview.policyBlock
                ? 'B · Your policy block (SME prompt + BP digest + section rules)'
                : 'B · Your policy block — EMPTY (nothing added to the system prompt yet)'}
              text={preview.policyBlock || '(Add an SME prompt above, parse section rules, or add a BP digest on the Doc Type Policies tab.)'}
              muted={!preview.policyBlock}
            />
            <PreviewBlock tone="scaffolding" label="C · Per-call user turn (filled in by the API at request time)" text={preview.userTurn} />
            <div className="flex items-center justify-end border-t border-slate-200 pt-2">
              <button
                type="button"
                onClick={() => navigator.clipboard?.writeText(preview.composed).then(
                  () => setActionInfo('Full composed prompt copied.'),
                  () => setActionError('Could not copy to clipboard.'),
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

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => { if (confirm('Discard this draft? The approved version is unaffected.')) retire.mutate() }}
          disabled={retire.isPending}
          className="text-[11px] font-semibold text-rose-700 hover:text-rose-900 disabled:opacity-50"
          data-action="discard-draft"
        >
          Discard draft
        </button>
      </div>

      {parseReviewOpen && parsedRules && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          onClick={() => setParseReviewOpen(false)}
          data-modal="parsed-rules-review"
        >
          <div
            className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-lg bg-white shadow-xl"
            onClick={e => e.stopPropagation()}
          >
            <header className="border-b border-slate-200 px-5 py-3">
              <h2 className="text-[16px] font-semibold text-slate-900">AI-parsed section rules</h2>
              <p className="mt-0.5 text-[12px] text-slate-500">
                Review what Claude pulled from the SME prompt. Clicking <strong>Merge into draft</strong> replaces
                the draft's section rules; existing rules for sections not listed below are dropped.
              </p>
            </header>
            <div className="flex-1 overflow-y-auto px-5 py-4">
              {Object.keys(parsedRules).length === 0 ? (
                <p className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-4 text-center text-[13px] italic text-slate-500">
                  AI found no per-section rules in this SME prompt — merging will clear any existing rules.
                </p>
              ) : (
                <ul className="flex flex-col gap-3">
                  {Object.entries(parsedRules).map(([sectionKey, rules]) => (
                    <li key={sectionKey} className="rounded-md border border-slate-200 p-3" data-parsed-section={sectionKey}>
                      <p className="font-mono text-[11px] font-semibold text-slate-700">{sectionKey}</p>
                      <ul className="mt-2 space-y-1.5 text-[12px]">
                        {rules.map((r, i) => (
                          <li key={i} className="flex gap-2">
                            <span className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] uppercase ${
                              r.severity === 'must'   ? 'bg-rose-100 text-rose-800' :
                              r.severity === 'should' ? 'bg-amber-100 text-amber-800' :
                                                         'bg-slate-100 text-slate-700'
                            }`}>{r.severity}</span>
                            <span className="text-slate-700">{r.text}</span>
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <footer className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
              <button
                type="button"
                onClick={() => setParseReviewOpen(false)}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-[12px] font-semibold text-slate-700 hover:bg-slate-50"
                data-action="parsed-rules-cancel"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={applyParsedRules}
                className="rounded-md border border-blue-600 bg-blue-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-blue-700"
                data-action="parsed-rules-merge"
              >
                Merge into draft
              </button>
            </footer>
          </div>
        </div>
      )}
    </section>
  )
}

// ---- new --------------------------------------------------------------

function NewPromptForm({
  aiReady, takenApproved, onCreated, onCancel,
}: {
  aiReady:       boolean
  takenApproved: string[]
  onCreated: (docType: string) => void
  onCancel?: () => void
}) {
  const [docType,   setDocType]   = useState('')
  const [smePrompt, setSmePrompt] = useState('')
  const [error,     setError]     = useState<string | null>(null)
  const create = useMutation({
    mutationFn: () => platformApi.createAiPromptDraft({
      docType:   docType.trim().replace(/-/g, '_'),
      smePrompt: smePrompt.trim(),
    }),
    onSuccess: (row) => { setError(null); onCreated(row.docType) },
    onError:   (err: unknown) => setError(errMessage(err, 'Create failed')),
  })
  return (
    <div className="flex h-full flex-col gap-3 p-4" data-new-prompt>
      <p className="text-[12px] text-slate-500">
        Pick a doc type and paste the SME prompt. Creating here starts a <strong>draft</strong> —
        it won't reach AI until you approve it on the editor panel. Doc types that already have an
        approved prompt are still allowed (the draft becomes the next pending version); types with
        a pending draft are greyed out.
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
          const value   = type.replace(/-/g, '_')
          const hasApproved = takenApproved.includes(value)
          return (
            <option key={value} value={value} className="text-slate-900">
              {documentTypeLabel(type)}{hasApproved ? ' — new version' : ''}
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
          {create.isPending ? 'Starting draft…' : 'Start draft'}
        </button>
      </div>
    </div>
  )
}

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
