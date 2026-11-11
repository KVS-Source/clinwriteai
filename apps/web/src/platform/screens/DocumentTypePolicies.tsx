// Document Type Policies — admin screen (step 7 of the policy wiring).
//
// One row per doc type. Admin picks one from the left list and edits the
// current version in the right pane: SME prompt, section rules (JSON),
// template / checklist / ICH pins, and — read-only — the latest BP digest
// distilled from the uploaded Best-Practice PDF. Actions: Save (PATCH),
// Bump new version (POST .../bump) once the current version is pinned by
// any document, Retire (POST .../retire), and Distill (POST .../distill
// -best-practice) for a known DocumentUpload id.
//
// English-only copy for now — this screen is super-admin facing and not
// in the i18n Phase 1 "UI chrome" scope. Keys can be back-filled once
// the admin surface rolls into Phase 2.
//
// Scope deferrals:
//   - BP PDF upload is still an admin-side operation; this screen takes a
//     DocumentUpload id and triggers distillation on an already-uploaded
//     PDF. Adding a native file picker + upload flow lands next.
//   - Version-history browser (read earlier bumps) is deferred; the
//     current version is the only one editable anyway.

import { MasterLibraryHeading } from '../components/MasterLibraryHeading'
import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError } from '../../api/client'
import {
  platformApi,
  type DocumentTypePolicy,
  type BestPracticeDigest,
} from '../api/platformApi'
import { useAiReadiness, isAiReady, AiReadinessBanner } from '../ai-readiness'

type SectionRulesMap = Record<string, Array<{ severity: 'must' | 'should' | 'nice'; text: string }>>

function parseSectionRules(text: string): { ok: SectionRulesMap } | { err: string } {
  const trimmed = text.trim()
  if (trimmed.length === 0) return { ok: {} }
  let parsed: unknown
  try { parsed = JSON.parse(trimmed) }
  catch (err) { return { err: `JSON parse: ${err instanceof Error ? err.message : String(err)}` } }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { err: 'Must be a JSON object keyed by section id.' }
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!Array.isArray(value)) return { err: `${key}: value must be an array` }
    for (const [i, v] of value.entries()) {
      if (!v || typeof v !== 'object') return { err: `${key}[${i}]: must be an object` }
      const rule = v as Record<string, unknown>
      if (rule.severity !== 'must' && rule.severity !== 'should' && rule.severity !== 'nice') {
        return { err: `${key}[${i}].severity must be must/should/nice` }
      }
      if (typeof rule.text !== 'string' || rule.text.trim().length === 0) {
        return { err: `${key}[${i}].text must be a non-empty string` }
      }
    }
  }
  return { ok: parsed as SectionRulesMap }
}

function errMessage(err: unknown, fallback = 'Request failed'): string {
  if (err instanceof ApiError) {
    const body = err.body as { message?: string; error?: string } | null
    if (body?.message) return body.message
    if (body?.error)   return body.error
    return `${err.status}`
  }
  return err instanceof Error ? err.message : fallback
}

export function DocumentTypePolicies() {
  const qc = useQueryClient()
  const { data, isLoading, error } = useQuery({
    queryKey: ['document-type-policies'],
    queryFn:  () => platformApi.listDocumentTypePolicies(),
  })
  const policies = useMemo(() => data?.policies ?? [], [data])
  const { data: readiness } = useAiReadiness()
  const aiReady = isAiReady(readiness)

  const [selectedDocType, setSelectedDocType] = useState<string | null>(null)
  useEffect(() => {
    if (!selectedDocType && policies.length > 0) setSelectedDocType(policies[0]!.docType)
  }, [policies, selectedDocType])

  const selected = policies.find(p => p.docType === selectedDocType) ?? null

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-5" data-screen="document-type-policies">
      <MasterLibraryHeading>
        <h1 className="text-[20px] font-semibold text-slate-900">Document Type Policies</h1>
        <p className="mt-0.5 text-[13px] text-slate-500">
          Per doc-type SME prompt, Best-Practice digest, section rules, and template / checklist / ICH pins.
          The AI drafter and <code>/ai-suggest</code> inject these into every call.
        </p>
      </MasterLibraryHeading>

      <AiReadinessBanner
        readiness={readiness}
        context="Editing policies or parsing a Best-Practice PDF is blocked until an AI engine is configured — the policies here only matter when AI is live."
      />

      {isLoading && <p className="text-[13px] text-slate-500">Loading policies…</p>}
      {error && <p className="text-[13px] text-rose-700">{errMessage(error, 'Could not load policies')}</p>}

      {!isLoading && !error && (
        <div className="flex min-h-0 flex-1 gap-4">
          <PolicyList policies={policies} selected={selectedDocType} onSelect={setSelectedDocType} />
          <div className="flex-1 overflow-y-auto">
            {selected
              ? <PolicyEditor key={selected.id} policy={selected} aiReady={aiReady} onChanged={() => qc.invalidateQueries({ queryKey: ['document-type-policies'] })} />
              : <CreatePolicyPrompt aiReady={aiReady} onCreated={(docType) => { qc.invalidateQueries({ queryKey: ['document-type-policies'] }); setSelectedDocType(docType) }} />}
          </div>
        </div>
      )}
    </div>
  )
}

// ---- list ---------------------------------------------------------------

function PolicyList({
  policies, selected, onSelect,
}: {
  policies: DocumentTypePolicy[]
  selected: string | null
  onSelect: (docType: string) => void
}) {
  const [showCreate, setShowCreate] = useState(false)
  return (
    <aside className="w-64 shrink-0 overflow-y-auto rounded-md border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
        <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">
          Doc types ({policies.length})
        </p>
        <button
          type="button"
          onClick={() => { setShowCreate(true); onSelect('__new__') }}
          className="rounded-md border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
          data-action="new-policy"
        >
          + New
        </button>
      </div>
      {policies.length === 0 && !showCreate && (
        <p className="p-3 text-[12px] text-slate-500">
          No policies authored yet. Use the <strong>+ New</strong> button to add one.
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
                <span className="font-mono text-[10px] text-slate-500">v{p.version}</span>
              </div>
              <PolicyChips policy={p} />
            </button>
          </li>
        ))}
      </ul>
    </aside>
  )
}

function PolicyChips({ policy }: { policy: DocumentTypePolicy }) {
  const digest = (policy.bestPracticeDigest ?? { principles: [] }) as BestPracticeDigest
  const ruleCount = policy.sectionRules ? Object.keys(policy.sectionRules).length : 0
  return (
    <div className="mt-1 flex flex-wrap gap-1 text-[10px] text-slate-500">
      <span className="rounded bg-slate-100 px-1.5">{digest.principles.length} BP</span>
      <span className="rounded bg-slate-100 px-1.5">{ruleCount} rules</span>
      {policy.ichFramework && <span className="rounded bg-slate-100 px-1.5">{policy.ichFramework}</span>}
      {policy.templateId && <span className="rounded bg-slate-100 px-1.5">tmpl</span>}
      {policy.checklistTemplateId && <span className="rounded bg-slate-100 px-1.5">chk</span>}
    </div>
  )
}

// ---- editor -------------------------------------------------------------

function PolicyEditor({ policy, aiReady, onChanged }: { policy: DocumentTypePolicy; aiReady: boolean; onChanged: () => void }) {
  const [smePrompt,           setSmePrompt]           = useState(policy.smePrompt)
  const [templateId,          setTemplateId]          = useState(policy.templateId ?? '')
  const [checklistTemplateId, setChecklistTemplateId] = useState(policy.checklistTemplateId ?? '')
  const [ichFramework,        setIchFramework]        = useState(policy.ichFramework ?? '')
  const [sectionRulesText,    setSectionRulesText]    = useState(JSON.stringify(policy.sectionRules ?? {}, null, 2))
  const [bpFile,              setBpFile]              = useState<File | null>(null)
  const [actionError,         setActionError]         = useState<string | null>(null)
  const [actionInfo,          setActionInfo]          = useState<string | null>(null)
  const [bumpReason,          setBumpReason]          = useState('')
  const [bumpOpen,            setBumpOpen]            = useState(false)

  const rulesParse = useMemo(() => parseSectionRules(sectionRulesText), [sectionRulesText])
  const rulesOk    = 'ok' in rulesParse

  const digest = (policy.bestPracticeDigest ?? { principles: [] }) as BestPracticeDigest

  const save = useMutation({
    mutationFn: () => platformApi.updateDocumentTypePolicy(policy.docType, {
      smePrompt,
      sectionRules:        rulesOk ? (rulesParse as { ok: SectionRulesMap }).ok : {},
      templateId:          templateId.trim() || null,
      checklistTemplateId: checklistTemplateId.trim() || null,
      ichFramework:        ichFramework.trim() || null,
    }),
    onSuccess: () => { setActionInfo('Saved.'); setActionError(null); onChanged() },
    onError:   (err: unknown) => { setActionError(errMessage(err, 'Save failed')); setActionInfo(null) },
  })

  const bump = useMutation({
    mutationFn: () => platformApi.bumpDocumentTypePolicy(policy.docType, {
      smePrompt,
      sectionRules:        rulesOk ? (rulesParse as { ok: SectionRulesMap }).ok : {},
      templateId:          templateId.trim() || null,
      checklistTemplateId: checklistTemplateId.trim() || null,
      ichFramework:        ichFramework.trim() || null,
      changeReason:        bumpReason.trim(),
    }),
    onSuccess: () => { setActionInfo('New version created.'); setActionError(null); setBumpOpen(false); setBumpReason(''); onChanged() },
    onError:   (err: unknown) => { setActionError(errMessage(err, 'Bump failed')); setActionInfo(null) },
  })

  const retire = useMutation({
    mutationFn: (reason: string) => platformApi.retireDocumentTypePolicy(policy.docType, reason),
    onSuccess: () => { setActionInfo('Policy retired.'); setActionError(null); onChanged() },
    onError:   (err: unknown) => { setActionError(errMessage(err, 'Retire failed')); setActionInfo(null) },
  })

  const distill = useMutation({
    mutationFn: () => {
      if (!bpFile) throw new Error('Pick a PDF first')
      return platformApi.distillBestPracticeFile(policy.docType, bpFile)
    },
    onSuccess: (res) => {
      setActionInfo(`Parser enqueued for ${res.fileName} — the digest will populate in a few moments. (job ${res.jobId})`)
      setActionError(null)
      setBpFile(null)
    },
    onError:   (err: unknown) => { setActionError(errMessage(err, 'Parser enqueue failed')); setActionInfo(null) },
  })

  const onRetire = () => {
    const reason = window.prompt('Reason for retiring this policy (required):', '')
    if (!reason || !reason.trim()) return
    retire.mutate(reason.trim())
  }

  return (
    <div className="flex flex-col gap-4" data-editor={policy.docType}>
      <header className="flex items-baseline justify-between border-b border-slate-200 pb-2">
        <div>
          <h2 className="text-[16px] font-semibold text-slate-900">
            {policy.docType} <span className="ml-2 font-mono text-[11px] text-slate-500">v{policy.version}</span>
          </h2>
          <p className="text-[12px] text-slate-500">
            Current · updated {new Date(policy.updatedAt).toLocaleString()} by {policy.updatedBy}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => save.mutate()}
            disabled={save.isPending || !rulesOk || !aiReady}
            title={!aiReady ? 'AI is not set up — configure an AI engine first.' : undefined}
            className="rounded-md border border-blue-600 bg-blue-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            data-action="save"
          >
            {save.isPending ? 'Saving…' : 'Save changes'}
          </button>
          <button
            type="button"
            onClick={() => setBumpOpen(v => !v)}
            disabled={!aiReady}
            title={!aiReady ? 'AI is not set up — configure an AI engine first.' : undefined}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-[12px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            data-action="bump-toggle"
          >
            Bump new version
          </button>
          <button
            type="button"
            onClick={onRetire}
            disabled={retire.isPending}
            className="rounded-md border border-rose-300 bg-white px-3 py-1.5 text-[12px] font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
            data-action="retire"
          >
            Retire
          </button>
        </div>
      </header>

      {actionError && <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700">{actionError}</p>}
      {actionInfo  && <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] text-emerald-800">{actionInfo}</p>}

      {bumpOpen && (
        <div className="rounded-md border border-slate-200 bg-slate-50 p-3" data-bump-form>
          <p className="text-[12px] text-slate-700">
            Bumping creates a new version with the fields above. The old
            version stays on every document already pinned to it. Reason
            goes on the audit trail — be specific.
          </p>
          <textarea
            value={bumpReason}
            onChange={e => setBumpReason(e.currentTarget.value)}
            rows={2}
            placeholder="e.g. Updated section 6.2 inclusion criteria after sponsor review."
            className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 text-[13px]"
            data-field="bump-reason"
          />
          <div className="mt-2 flex justify-end gap-2">
            <button type="button" onClick={() => setBumpOpen(false)} className="rounded-md border border-slate-300 bg-white px-3 py-1 text-[12px] text-slate-700">Cancel</button>
            <button
              type="button"
              onClick={() => bump.mutate()}
              disabled={bump.isPending || !bumpReason.trim() || !rulesOk || !aiReady}
              title={!aiReady ? 'AI is not set up — configure an AI engine first.' : undefined}
              className="rounded-md border border-blue-600 bg-blue-600 px-3 py-1 text-[12px] font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              data-action="bump-confirm"
            >
              {bump.isPending ? 'Bumping…' : 'Create new version'}
            </button>
          </div>
        </div>
      )}

      <Field label="SME prompt" help="The role-specific preamble injected into every AI call. Long-form OK.">
        <textarea
          value={smePrompt}
          onChange={e => setSmePrompt(e.currentTarget.value)}
          rows={10}
          className="w-full resize-y rounded-md border border-slate-300 px-3 py-2 font-mono text-[12px]"
          data-field="sme-prompt"
        />
      </Field>

      <Field
        label={`Best-Practice digest (${digest.principles.length} principles)`}
        help={digest.distilledAt
          ? `Parsed ${new Date(digest.distilledAt).toLocaleString()} by ${digest.distilledModel ?? 'unknown model'}.`
          : 'No digest yet — upload a Best-Practice PDF and the parser will convert it to structured principles.'}
      >
        <DigestPreview digest={digest} />
        <div className="mt-2 flex flex-col gap-2 rounded-md border border-slate-200 bg-slate-50 p-3" data-bp-upload>
          <div className="flex items-center gap-2">
            <input
              type="file"
              accept="application/pdf,.pdf"
              onChange={e => setBpFile(e.currentTarget.files?.[0] ?? null)}
              className="flex-1 text-[12px]"
              data-field="bp-pdf-file"
            />
            <button
              type="button"
              onClick={() => distill.mutate()}
              disabled={distill.isPending || !bpFile || !aiReady}
              title={!aiReady ? 'AI is not set up — the parser needs an AI engine.' : undefined}
              className="rounded-md border border-blue-600 bg-blue-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              data-action="distill-file"
            >
              {distill.isPending ? 'Uploading + parsing…' : 'Upload + parse'}
            </button>
          </div>
          {bpFile && (
            <p className="text-[11px] text-slate-600">
              Selected <span className="font-mono">{bpFile.name}</span>
              {' · '}
              {(bpFile.size / (1024 * 1024)).toFixed(2)} MB
            </p>
          )}
          <p className="text-[11px] text-slate-500">
            PDF only, up to 50&nbsp;MB. The parser extracts principles into
            JSON — severity (<code>must</code>/<code>should</code>/<code>nice</code>) and scope
            (<code>whole-doc</code> or <code>section:&lt;key&gt;</code>) — and overwrites the
            digest on this policy once done.
          </p>
        </div>
      </Field>

      <Field label="Section rules (JSON)" help={`Keyed by section id, each a list of { severity, text }. ${rulesOk ? 'Valid.' : (rulesParse as { err: string }).err}`}>
        <textarea
          value={sectionRulesText}
          onChange={e => setSectionRulesText(e.currentTarget.value)}
          rows={10}
          className={`w-full resize-y rounded-md border px-3 py-2 font-mono text-[12px] ${rulesOk ? 'border-slate-300' : 'border-rose-400 bg-rose-50'}`}
          data-field="section-rules"
        />
      </Field>

      <div className="grid grid-cols-3 gap-3">
        <Field label="Template id" help="Default template pinned on new docs of this type.">
          <input
            type="text"
            value={templateId}
            onChange={e => setTemplateId(e.currentTarget.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-1.5 font-mono text-[12px]"
            data-field="template-id"
          />
        </Field>
        <Field label="Checklist template id" help="Default checklist pinned on new docs.">
          <input
            type="text"
            value={checklistTemplateId}
            onChange={e => setChecklistTemplateId(e.currentTarget.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-1.5 font-mono text-[12px]"
            data-field="checklist-template-id"
          />
        </Field>
        <Field label="ICH framework" help="e.g. 'ICH E3', 'ICH E6(R3)'.">
          <input
            type="text"
            value={ichFramework}
            onChange={e => setIchFramework(e.currentTarget.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-[13px]"
            data-field="ich-framework"
          />
        </Field>
      </div>
    </div>
  )
}

function Field({ label, help, children }: { label: string; help?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[12px] font-semibold text-slate-800">{label}</span>
      {help && <span className="text-[11px] text-slate-500">{help}</span>}
      {children}
    </label>
  )
}

function DigestPreview({ digest }: { digest: BestPracticeDigest }) {
  if (digest.principles.length === 0) {
    return <p className="rounded-md border border-dashed border-slate-200 bg-white p-3 text-[12px] text-slate-500">No principles. Distil a Best-Practice PDF to populate this.</p>
  }
  const SEV_ORDER = { must: 0, should: 1, nice: 2 } as const
  const sorted = [...digest.principles].sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity])
  return (
    <ul className="max-h-60 space-y-1 overflow-y-auto rounded-md border border-slate-200 bg-white p-2 text-[12px]" data-bp-principles>
      {sorted.map((p, i) => (
        <li key={i} className="flex gap-2">
          <span className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] uppercase ${
            p.severity === 'must' ? 'bg-rose-100 text-rose-800' :
            p.severity === 'should' ? 'bg-amber-100 text-amber-800' :
            'bg-slate-100 text-slate-700'
          }`}>{p.severity}</span>
          <span className="shrink-0 font-mono text-[10px] text-slate-500">{p.scope}</span>
          <span className="text-slate-700">{p.text}</span>
        </li>
      ))}
    </ul>
  )
}

// ---- create -------------------------------------------------------------

function CreatePolicyPrompt({ aiReady, onCreated }: { aiReady: boolean; onCreated: (docType: string) => void }) {
  const [docType,   setDocType]   = useState('')
  const [smePrompt, setSmePrompt] = useState('')
  const [error, setError] = useState<string | null>(null)
  const create = useMutation({
    mutationFn: () => platformApi.createDocumentTypePolicy({
      docType:   docType.trim().replace(/-/g, '_'),
      smePrompt: smePrompt.trim(),
    }),
    onSuccess: (row) => { setError(null); onCreated(row.docType) },
    onError:   (err: unknown) => setError(errMessage(err, 'Create failed')),
  })
  return (
    <div className="rounded-md border border-dashed border-slate-300 bg-white p-4" data-create-prompt>
      <h2 className="text-[14px] font-semibold text-slate-900">New policy</h2>
      <p className="mt-0.5 text-[12px] text-slate-500">
        Pick a doc type (underscored canonical form: <code>csr_full</code>, <code>protocol</code>, …)
        and paste its SME prompt. You can edit everything else after.
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
          rows={8}
          placeholder="SME prompt — the role-specific preamble the AI reads on every call."
          className="rounded-md border border-slate-300 px-3 py-2 font-mono text-[12px]"
          data-field="create-sme-prompt"
        />
        <div>
          <button
            type="button"
            onClick={() => create.mutate()}
            disabled={create.isPending || !docType.trim() || !smePrompt.trim() || !aiReady}
            title={!aiReady ? 'AI is not set up — configure an AI engine first.' : undefined}
            className="rounded-md border border-blue-600 bg-blue-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            data-action="create-policy"
          >
            {create.isPending ? 'Creating…' : 'Create policy'}
          </button>
        </div>
      </div>
    </div>
  )
}
