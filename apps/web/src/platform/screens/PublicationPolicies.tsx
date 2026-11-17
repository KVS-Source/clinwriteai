// Publication Policies — associations dashboard for Module B.
//
// Mirror of DocumentTypePolicies scoped to publication doctypes
// (manuscript_full_research, manuscript_review_systematic,
// manuscript_review_narrative, manuscript_case_report, abstract,
// poster, letter, pls). One row per docType with chips for each
// associated asset — AI prompt, BP digest, template, checklist,
// guideline (CONSORT/STROBE/PRISMA/MOOSE/ICMJE). Click a row to
// open a slide panel with details + per-asset management.
//
// Editor surfaces for AI prompts / BP digests / templates land in
// follow-up tabs under Master Library in Phase M-B.1 polish. For now,
// this screen is enough to anchor a doctype policy and see what's wired.

import { MasterLibraryHeading } from '../components/MasterLibraryHeading'
import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError } from '../../api/client'
import {
  platformApi,
  type PublicationTypePolicy,
  type PublicationAiPromptRecord,
  type PublicationBestPracticeRecord,
} from '../api/platformApi'
import { useAiReadiness, isAiReady, AiReadinessBanner } from '../ai-readiness'
import { SlidePanel } from '../../components/ui/SlidePanel'

// Canonical doc-type slugs for the New Policy picker. Flat per the
// subtype decision (2026-11-17). Admins anchor one policy per slug;
// each slug maps to a wizard + template + AI prompt + BP + checklist.
const PUBLICATION_DOC_TYPES: Array<{ value: string; label: string }> = [
  { value: 'manuscript_full_research',       label: 'Manuscript — Full research' },
  { value: 'manuscript_review_systematic',   label: 'Manuscript — Systematic review' },
  { value: 'manuscript_review_narrative',    label: 'Manuscript — Narrative review' },
  { value: 'manuscript_case_report',         label: 'Manuscript — Case report' },
  { value: 'abstract',                       label: 'Congress abstract' },
  { value: 'poster',                         label: 'Congress poster' },
  { value: 'letter',                         label: 'Letter / editorial' },
  { value: 'pls',                            label: 'Plain-language summary' },
]

// Reporting guidelines — the "which checklist does the manuscript need
// to answer to" dimension. Picked once per policy.
const GUIDELINE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'CONSORT',   label: 'CONSORT — Randomised trials' },
  { value: 'STROBE',    label: 'STROBE — Observational studies' },
  { value: 'PRISMA',    label: 'PRISMA — Systematic reviews / meta-analyses' },
  { value: 'MOOSE',     label: 'MOOSE — Observational meta-analyses' },
  { value: 'ICMJE',     label: 'ICMJE recommendations (generic)' },
  { value: 'CARE',      label: 'CARE — Case reports' },
  { value: 'SPIRIT',    label: 'SPIRIT — Trial protocols' },
  { value: 'ARRIVE',    label: 'ARRIVE — Animal studies' },
]

function errMessage(err: unknown, fallback = 'Request failed'): string {
  if (err instanceof ApiError) {
    const body = err.body as { message?: string; error?: string } | null
    if (body?.message) return body.message
    if (body?.error)   return body.error
    return `${err.status}`
  }
  return err instanceof Error ? err.message : fallback
}

type PolicyEnriched = PublicationTypePolicy & {
  aiPrompt:     PublicationAiPromptRecord | null
  bestPractice: PublicationBestPracticeRecord | null
}

export function PublicationPolicies() {
  const qc = useQueryClient()
  const policiesQ = useQuery({
    queryKey: ['publication-type-policies'],
    queryFn:  () => platformApi.listPublicationTypePolicies(),
  })
  const promptsQ = useQuery({
    queryKey: ['publication-ai-prompts-approved'],
    queryFn:  () => platformApi.listPublicationAiPrompts(),
  })
  const bpQ = useQuery({
    queryKey: ['publication-best-practice-records-approved'],
    queryFn:  () => platformApi.listPublicationBestPracticeRecords(),
  })
  const { data: readiness } = useAiReadiness()
  const aiReady = isAiReady(readiness)

  const enriched: PolicyEnriched[] = useMemo(() => {
    const byPrompt = new Map<string, PublicationAiPromptRecord>()
    for (const p of promptsQ.data?.prompts ?? []) byPrompt.set(p.docType, p)
    const byBp = new Map<string, PublicationBestPracticeRecord>()
    for (const b of bpQ.data?.records ?? []) byBp.set(b.docType, b)
    return (policiesQ.data?.policies ?? []).map(p => ({
      ...p,
      aiPrompt:     byPrompt.get(p.docType) ?? null,
      bestPractice: byBp.get(p.docType)     ?? null,
    }))
  }, [policiesQ.data, promptsQ.data, bpQ.data])

  const [selectedDocType, setSelectedDocType] = useState<string | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [newOpen,    setNewOpen]    = useState(false)
  const [search,     setSearch]     = useState('')

  useEffect(() => {
    if (selectedDocType && !enriched.find(p => p.docType === selectedDocType)) {
      setSelectedDocType(null)
      setDetailOpen(false)
    }
  }, [enriched, selectedDocType])

  const openDetail = (docType: string) => { setSelectedDocType(docType); setDetailOpen(true) }
  const selected = enriched.find(p => p.docType === selectedDocType) ?? null

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ['publication-type-policies'] })
    qc.invalidateQueries({ queryKey: ['publication-ai-prompts-approved'] })
    qc.invalidateQueries({ queryKey: ['publication-best-practice-records-approved'] })
    qc.invalidateQueries({ queryKey: ['publication-ai-prompt-versions'] })
    qc.invalidateQueries({ queryKey: ['publication-bp-versions'] })
  }

  const loading = policiesQ.isLoading || promptsQ.isLoading || bpQ.isLoading

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-5" data-screen="publication-policies">
      <MasterLibraryHeading>
        <h1 className="text-[20px] font-semibold text-slate-900">Publication Policies</h1>
        <p className="mt-0.5 text-[13px] text-slate-500">
          What each publication type is wired up with — SME prompt, best-practice digest, section
          rules, template, checklist, reporting guideline. The scientific-writing drafter and
          section rewrite use these on every AI call. Edits for each asset happen in its own tab.
        </p>
      </MasterLibraryHeading>

      <AiReadinessBanner
        readiness={readiness}
        context="Approving a publication AI prompt / BP digest or creating a new policy is blocked until an AI engine is configured."
      />

      {loading && <p className="text-[13px] text-slate-500">Loading policies…</p>}
      {policiesQ.error && <p className="text-[13px] text-rose-700">{errMessage(policiesQ.error, 'Could not load policies')}</p>}

      {!loading && !policiesQ.error && (
        <AssociationsTable
          policies={enriched}
          search={search}
          onSearch={setSearch}
          onOpen={openDetail}
          onNew={() => setNewOpen(true)}
        />
      )}

      <SlidePanel
        open={detailOpen && !!selected}
        onClose={() => setDetailOpen(false)}
        title={selected ? `Policy — ${docTypeLabel(selected.docType)}` : 'Policy'}
        subtitle={selected
          ? <span className="font-mono text-[11px]">{selected.docType} · v{selected.version}</span>
          : undefined}
        storageKey="clinwrite.pubPolicies.detail.width"
        defaultWidth={720}
        minWidth={520}
        maxWidth={1100}
        expandable
      >
        {selected && (
          <AssociationsPanel
            key={selected.id}
            policy={selected}
            aiReady={aiReady}
            onChanged={invalidateAll}
          />
        )}
      </SlidePanel>

      <SlidePanel
        open={newOpen}
        onClose={() => setNewOpen(false)}
        title="New publication policy"
        subtitle="Anchor a new publication doc type."
        storageKey="clinwrite.pubPolicies.new.width"
        defaultWidth={520}
        minWidth={420}
        maxWidth={800}
      >
        <CreatePolicyForm
          aiReady={aiReady}
          taken={enriched.map(p => p.docType)}
          onCreated={(docType) => { invalidateAll(); setNewOpen(false); openDetail(docType) }}
          onCancel={() => setNewOpen(false)}
        />
      </SlidePanel>
    </div>
  )
}

function docTypeLabel(slug: string): string {
  return PUBLICATION_DOC_TYPES.find(t => t.value === slug)?.label ?? slug
}

// ---- table --------------------------------------------------------------

function AssociationsTable({
  policies, search, onSearch, onOpen, onNew,
}: {
  policies: PolicyEnriched[]
  search:   string
  onSearch: (q: string) => void
  onOpen:   (docType: string) => void
  onNew:    () => void
}) {
  const q = search.trim().toLowerCase()
  const visible = policies
    .filter(p => !q || p.docType.toLowerCase().includes(q) || docTypeLabel(p.docType).toLowerCase().includes(q))
    .sort((a, b) => a.docType.localeCompare(b.docType))

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3" data-pub-policies-table>
      <header className="flex flex-wrap items-center gap-3">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-widest text-slate-500">
          {policies.length} polic{policies.length === 1 ? 'y' : 'ies'}
          {q && visible.length !== policies.length && (
            <span className="ml-2 text-slate-400">· {visible.length} match{visible.length === 1 ? '' : 'es'}</span>
          )}
        </p>
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <input
            type="search"
            value={search}
            onChange={e => onSearch(e.currentTarget.value)}
            placeholder="Search by doc type (e.g. manuscript, abstract, PRISMA)…"
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-[12px] placeholder:text-slate-400"
            data-field="search-pub-policies"
          />
        </div>
        <div className="flex-1" />
        <button
          type="button"
          onClick={onNew}
          className="rounded-md border border-blue-600 bg-blue-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-blue-700"
          data-action="new-pub-policy"
        >
          + New policy
        </button>
      </header>

      {policies.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed border-slate-300 bg-white p-8 text-center" data-empty>
          <p className="text-[13px] font-semibold text-slate-800">No publication policies yet</p>
          <p className="max-w-md text-[12px] text-slate-500">
            Anchor a publication doc type (manuscript, abstract, poster, review, letter, PLS) so
            authors can create publications of that kind. Templates / AI prompts / BP digests /
            checklists wire up afterwards from their own tabs.
          </p>
          <button
            type="button"
            onClick={onNew}
            className="rounded-md border border-blue-600 bg-blue-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-blue-700"
            data-action="empty-new-pub-policy"
          >
            + New policy
          </button>
        </div>
      )}

      {policies.length > 0 && visible.length === 0 && (
        <p className="rounded-md border border-dashed border-slate-300 bg-white p-4 text-center text-[13px] text-slate-500" data-no-matches>
          No policies match "{search}".
        </p>
      )}

      {visible.length > 0 && (
        <div className="overflow-hidden rounded-md border border-slate-200 bg-white" data-table>
          <table className="w-full text-[13px]">
            <thead className="bg-slate-50 text-left font-mono text-[10px] uppercase tracking-widest text-slate-500">
              <tr>
                <th className="px-3 py-2 font-semibold">Doc type</th>
                <th className="px-3 py-2 font-semibold">AI prompt</th>
                <th className="px-3 py-2 font-semibold">BP digest</th>
                <th className="px-3 py-2 font-semibold">Template</th>
                <th className="px-3 py-2 font-semibold">Checklist</th>
                <th className="px-3 py-2 font-semibold">Guideline</th>
              </tr>
            </thead>
            <tbody>
              {visible.map(p => (
                <tr
                  key={p.id}
                  onClick={() => onOpen(p.docType)}
                  tabIndex={0}
                  onKeyDown={e => { if (e.key === 'Enter') onOpen(p.docType) }}
                  className="cursor-pointer border-t border-slate-100 hover:bg-blue-50/60"
                  data-row={p.docType}
                >
                  <td className="px-3 py-2 align-top">
                    <div className="flex flex-col">
                      <span className="font-semibold text-slate-900">{docTypeLabel(p.docType)}</span>
                      <span className="font-mono text-[10px] text-slate-500">policy v{p.version}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2 align-top"><ChipAiPrompt row={p.aiPrompt} legacy={p.smePrompt} /></td>
                  <td className="px-3 py-2 align-top"><ChipBp row={p.bestPractice} legacy={p.bestPracticeDigest} /></td>
                  <td className="px-3 py-2 align-top"><ChipPin value={p.templateId} missingLabel="none" hint={p.templateId ?? 'No template'} /></td>
                  <td className="px-3 py-2 align-top"><ChipPin value={p.checklistTemplateId} missingLabel="none" hint={p.checklistTemplateId ?? 'No checklist'} /></td>
                  <td className="px-3 py-2 align-top"><ChipGuideline value={p.guidelineKey} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ---- chips --------------------------------------------------------------

type ChipState = 'approved' | 'legacy' | 'auto' | 'pinned' | 'missing'

function Chip({ state, label, hint }: { state: ChipState; label: string; hint?: string }) {
  const palette: Record<ChipState, string> = {
    approved: 'bg-emerald-100 text-emerald-800',
    legacy:   'bg-amber-100 text-amber-800',
    auto:     'bg-sky-100 text-sky-800',
    pinned:   'bg-indigo-100 text-indigo-800',
    missing:  'bg-slate-100 text-slate-500 italic',
  }
  return (
    <span
      className={`inline-flex rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold ${palette[state]}`}
      title={hint}
      data-chip-state={state}
    >
      {label}
    </span>
  )
}

function ChipAiPrompt({ row, legacy }: { row: PublicationAiPromptRecord | null; legacy: string }) {
  if (row) {
    const rules = (row.sectionRules as Record<string, unknown> | null) ?? {}
    const sections = Object.keys(rules).length
    return <Chip state="approved" label={`v${row.version}`} hint={`Approved · ${row.smePrompt.length} chars · ${sections} section rule groups`} />
  }
  if (legacy && legacy.trim().length > 0) {
    return <Chip state="legacy" label="legacy" hint="Falling back to policy.smePrompt — approve a PublicationAiPromptRecord to migrate." />
  }
  return <Chip state="missing" label="none" hint="No SME prompt." />
}

function ChipBp({ row, legacy }: {
  row:    PublicationBestPracticeRecord | null
  legacy: unknown
}) {
  if (row) {
    const count = row.digest?.principles?.length ?? 0
    return <Chip state="approved" label={`v${row.version} · ${count}p`} hint={`Approved BP digest · ${count} principles`} />
  }
  const legacyDigest = legacy as { principles?: unknown[] } | null
  if (legacyDigest?.principles?.length) {
    return <Chip state="legacy" label={`legacy · ${legacyDigest.principles.length}p`} hint="Falling back to policy.bestPracticeDigest — approve a PublicationBestPracticeRecord to migrate." />
  }
  return <Chip state="missing" label="none" hint="No BP digest. Upload a BP PDF in Phase M-B.3+ to distill principles." />
}

function ChipPin({ value, missingLabel, hint }: { value: string | null; missingLabel: string; hint?: string }) {
  if (value) return <Chip state="pinned" label="pinned" hint={hint} />
  return <Chip state="missing" label={missingLabel} hint={hint} />
}

function ChipGuideline({ value }: { value: string | null }) {
  if (!value) return <Chip state="missing" label="none" hint="No reporting guideline selected." />
  return <Chip state="pinned" label={value} hint={GUIDELINE_OPTIONS.find(g => g.value === value)?.label ?? value} />
}

// ---- side panel ---------------------------------------------------------

function AssociationsPanel({
  policy, aiReady, onChanged,
}: {
  policy:    PolicyEnriched
  aiReady:   boolean
  onChanged: () => void
}) {
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionInfo,  setActionInfo]  = useState<string | null>(null)

  const [templateId,          setTemplateId]          = useState(policy.templateId ?? '')
  const [checklistTemplateId, setChecklistTemplateId] = useState(policy.checklistTemplateId ?? '')
  const [guidelineKey,        setGuidelineKey]        = useState(policy.guidelineKey ?? '')

  const dirty = templateId         !== (policy.templateId ?? '')
            || checklistTemplateId !== (policy.checklistTemplateId ?? '')
            || guidelineKey        !== (policy.guidelineKey ?? '')

  const savePins = useMutation({
    mutationFn: () => platformApi.updatePublicationTypePolicy(policy.docType, {
      templateId:          templateId.trim() || null,
      checklistTemplateId: checklistTemplateId.trim() || null,
      guidelineKey:        guidelineKey || null,
    }),
    onSuccess:  () => { setActionInfo('Pins saved.'); setActionError(null); onChanged() },
    onError:    (err: unknown) => { setActionError(errMessage(err, 'Save failed')); setActionInfo(null) },
  })

  const retire = useMutation({
    mutationFn: (reason: string) => platformApi.retirePublicationTypePolicy(policy.docType, reason),
    onSuccess:  () => { setActionInfo('Policy retired.'); setActionError(null); onChanged() },
    onError:    (err: unknown) => { setActionError(errMessage(err, 'Retire failed')); setActionInfo(null) },
  })

  const onRetire = () => {
    const reason = window.prompt('Reason for retiring this policy (goes on the audit trail):', '')
    if (!reason || !reason.trim()) return
    retire.mutate(reason.trim())
  }

  return (
    <div className="flex flex-col gap-4 p-4" data-pub-panel={policy.docType}>
      {actionError && <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700">{actionError}</p>}
      {actionInfo  && <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] text-emerald-800">{actionInfo}</p>}

      <AssociationRow
        label="AI prompt"
        state={policy.aiPrompt ? 'approved' : (policy.smePrompt?.trim() ? 'legacy' : 'missing')}
        summary={policy.aiPrompt
          ? `Approved v${policy.aiPrompt.version} · ${policy.aiPrompt.smePrompt.length.toLocaleString()} chars`
          : policy.smePrompt?.trim()
            ? `Legacy prompt in use · ${policy.smePrompt.length.toLocaleString()} chars`
            : 'No prompt'}
      />

      <AssociationRow
        label="Best-practice digest"
        state={policy.bestPractice ? 'approved' : ((policy.bestPracticeDigest as { principles?: unknown[] } | null)?.principles?.length ? 'legacy' : 'missing')}
        summary={policy.bestPractice
          ? `Approved v${policy.bestPractice.version} · ${policy.bestPractice.digest?.principles?.length ?? 0} principles`
          : (policy.bestPracticeDigest as { principles?: unknown[] } | null)?.principles?.length
            ? `Legacy digest in use · ${(policy.bestPracticeDigest as { principles?: unknown[] }).principles!.length} principles`
            : 'No digest'}
      />

      <section className="rounded-md border border-slate-200 bg-slate-50 p-3" data-pins>
        <p className="mb-2 text-[12px] font-semibold text-slate-800">Policy pins</p>
        <p className="mb-3 text-[11px] text-slate-500">
          Template + Checklist IDs point to records authored in their own tabs (Templates,
          Checklists). Guideline is the reporting standard this manuscript type answers to.
        </p>
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Template id</span>
            <input
              type="text"
              value={templateId}
              onChange={e => setTemplateId(e.currentTarget.value)}
              placeholder="publication_templates.id or blank for none"
              className="h-9 rounded-md border border-slate-300 bg-white px-3 text-[13px]"
              data-field="template-id"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Checklist template id</span>
            <input
              type="text"
              value={checklistTemplateId}
              onChange={e => setChecklistTemplateId(e.currentTarget.value)}
              placeholder="publication_checklist_templates.id or blank for none"
              className="h-9 rounded-md border border-slate-300 bg-white px-3 text-[13px]"
              data-field="checklist-template-id"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Reporting guideline</span>
            <select
              value={guidelineKey}
              onChange={e => setGuidelineKey(e.currentTarget.value)}
              className="h-9 rounded-md border border-slate-300 bg-white px-3 text-[13px]"
              data-field="guideline-key"
            >
              <option value="">— none —</option>
              {GUIDELINE_OPTIONS.map(g => (
                <option key={g.value} value={g.value}>{g.label}</option>
              ))}
            </select>
          </label>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => savePins.mutate()}
              disabled={!dirty || savePins.isPending}
              className="rounded-md border border-blue-600 bg-blue-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              data-action="save-pins"
            >
              {savePins.isPending ? 'Saving…' : 'Save pins'}
            </button>
          </div>
        </div>
      </section>

      <footer className="mt-2 flex items-center justify-between border-t border-slate-200 pt-3">
        <p className="font-mono text-[10px] text-slate-400">
          Policy created {new Date(policy.createdAt).toLocaleDateString()} · last updated {new Date(policy.updatedAt).toLocaleDateString()} by {policy.updatedBy}
        </p>
        <button
          type="button"
          onClick={onRetire}
          disabled={retire.isPending}
          className="rounded-md border border-rose-300 bg-white px-3 py-1.5 text-[12px] font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
          data-action="retire-pub-policy"
        >
          {retire.isPending ? 'Retiring…' : 'Retire policy'}
        </button>
      </footer>

      {/* AI prompt + BP editor UIs for Module B land in follow-up Phase
          M-B.1 polish. For now, use the API routes directly or wait for
          the dedicated tabs. */}
      <p className="text-[11px] text-slate-500" data-manage-hint>
        AI prompt draft/approve + BP digest draft/approve for publications land in follow-up
        iterations of this phase. The API routes (`/publication-ai-prompts`,
        `/publication-best-practice-records`) are already live.
      </p>

      {!aiReady && (
        <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-[11px] text-amber-900">
          AI isn't configured — approving a draft / running the distiller will 503 until an engine
          is set up in /admin.
        </p>
      )}
    </div>
  )
}

function AssociationRow({
  label, state, summary,
}: {
  label:   string
  state:   ChipState
  summary: string
}) {
  const palette: Record<ChipState, string> = {
    approved: 'border-emerald-200 bg-emerald-50/40',
    legacy:   'border-amber-200 bg-amber-50/40',
    auto:     'border-sky-200 bg-sky-50/40',
    pinned:   'border-indigo-200 bg-indigo-50/40',
    missing:  'border-slate-200 bg-white',
  }
  return (
    <section className={`rounded-md border ${palette[state]} p-3`} data-assoc={label}>
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-600">{label}</p>
          <Chip state={state} label={state} />
        </div>
      </header>
      <p className="mt-1 text-[12px] text-slate-700">{summary}</p>
    </section>
  )
}

// ---- new-policy form ----------------------------------------------------

function CreatePolicyForm({
  aiReady, taken, onCreated, onCancel,
}: {
  aiReady:   boolean
  taken:     string[]
  onCreated: (docType: string) => void
  onCancel?: () => void
}) {
  const [docType, setDocType]         = useState('')
  const [smePrompt, setSmePrompt]     = useState('')
  const [guidelineKey, setGuidelineKey] = useState('')
  const [error, setError]             = useState<string | null>(null)
  const duplicate = taken.includes(docType)

  const create = useMutation({
    mutationFn: () => platformApi.createPublicationTypePolicy({
      docType,
      smePrompt: smePrompt.trim() || `SME prompt for ${docTypeLabel(docType)} — configure in AI Prompts.`,
      guidelineKey: guidelineKey || null,
    }),
    onSuccess: (row) => { setError(null); onCreated(row.docType) },
    onError:   (err: unknown) => setError(errMessage(err, 'Create failed')),
  })

  const availableTypes = PUBLICATION_DOC_TYPES.filter(t => !taken.includes(t.value))

  return (
    <div className="flex h-full flex-col gap-3 p-4" data-new-pub-policy>
      <p className="text-[12px] text-slate-500">
        Anchor a publication doc type so authors can create works of that kind. After creation,
        wire up the AI prompt, BP digest, template, and checklist from their own tabs.
      </p>
      {error && <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700">{error}</p>}
      <label className="flex flex-col gap-1">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Doc type</span>
        <select
          value={docType}
          onChange={e => setDocType(e.currentTarget.value)}
          className={`h-9 rounded-md border border-slate-300 bg-white px-3 text-[13px] ${docType ? 'text-slate-900' : 'text-slate-400'}`}
          data-field="create-pub-doc-type"
        >
          <option value="" disabled>Select a doc type</option>
          {availableTypes.map(t => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
        {duplicate && (
          <p className="text-[11px] font-semibold text-rose-700" role="alert">A policy for this doc type already exists.</p>
        )}
      </label>
      <label className="flex flex-col gap-1">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Reporting guideline (optional)</span>
        <select
          value={guidelineKey}
          onChange={e => setGuidelineKey(e.currentTarget.value)}
          className="h-9 rounded-md border border-slate-300 bg-white px-3 text-[13px]"
          data-field="create-guideline-key"
        >
          <option value="">— none —</option>
          {GUIDELINE_OPTIONS.map(g => (
            <option key={g.value} value={g.value}>{g.label}</option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Starter SME prompt (optional)</span>
        <textarea
          value={smePrompt}
          onChange={e => setSmePrompt(e.currentTarget.value)}
          rows={8}
          placeholder="Leave blank to ship a placeholder — you'll author the real prompt in Publication AI Prompts."
          className="resize-y rounded-md border border-slate-300 px-3 py-2 font-mono text-[12px] leading-relaxed"
          data-field="create-pub-sme-prompt"
        />
      </label>
      <div className="flex items-center justify-end gap-2 border-t border-slate-200 pt-3">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={create.isPending}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-[12px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            data-action="pub-create-cancel"
          >
            Cancel
          </button>
        )}
        <button
          type="button"
          onClick={() => create.mutate()}
          disabled={create.isPending || !docType || duplicate || !aiReady}
          title={!aiReady ? 'AI is not set up — configure an AI engine first.' : undefined}
          className="rounded-md border border-blue-600 bg-blue-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          data-action="pub-create-policy"
        >
          {create.isPending ? 'Creating…' : 'Create policy'}
        </button>
      </div>
    </div>
  )
}
