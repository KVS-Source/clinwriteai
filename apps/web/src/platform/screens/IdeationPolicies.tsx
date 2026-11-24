// Ideation & KOL Engagement Policies — associations dashboard for Module E.
//
// Mirror of MedContentPolicies / PublicationPolicies scoped to the
// ideation artefacts authored inside a KOL engagement /
// publishing project (KOL briefs, patient stories, HCP insight reports,
// narratives, etc.). One row per docType with chips for each
// associated asset — AI prompt, BP digest, template, checklist,
// channel hint. Click a row to open a slide panel with details +
// per-asset management (AI prompt draft/approve, BP PDF upload +
// approve, pin editing).

import { MasterLibraryHeading } from '../components/MasterLibraryHeading'
import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError } from '../../api/client'
import {
  platformApi,
  type IdeationTypePolicy,
  type IdeationAiPromptRecord,
  type IdeationBestPracticeRecord,
  type IdeationChannelHint,
  type PolicyRequirements,
  DEFAULT_POLICY_REQUIREMENTS,
} from '../api/platformApi'
import { useAiReadiness, isAiReady, AiReadinessBanner } from '../ai-readiness'
import { SlidePanel } from '../../components/ui/SlidePanel'
import { PolicyRequirementsToggles } from '../components/PolicyRequirementsToggles'

const IDEATION_DOC_TYPES: Array<{ value: string; label: string }> = [
  { value: 'kol_engagement_brief',       label: 'KOL engagement brief' },
  { value: 'patient_story',              label: 'Patient story / testimonial' },
  { value: 'hcp_insight_report',         label: 'HCP insight report' },
  { value: 'medical_affairs_narrative',  label: 'Medical affairs narrative' },
  { value: 'disease_awareness_brief',    label: 'Disease awareness brief' },
  { value: 'press_release',              label: 'Press release' },
  { value: 'scientific_exchange_note',   label: 'Scientific exchange note' },
  { value: 'congress_summary',           label: 'Congress summary' },
]

const CHANNEL_HINTS: Array<{ value: IdeationChannelHint; label: string }> = [
  { value: 'kol',     label: 'KOL engagement' },
  { value: 'hcp',     label: 'HCP communication' },
  { value: 'patient', label: 'Patient-facing' },
  { value: 'press',   label: 'Press / public comms' },
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

function docTypeLabel(slug: string): string {
  return IDEATION_DOC_TYPES.find(t => t.value === slug)?.label ?? slug
}

type PolicyEnriched = IdeationTypePolicy & {
  aiPrompt:     IdeationAiPromptRecord | null
  bestPractice: IdeationBestPracticeRecord | null
}

export function IdeationPolicies() {
  const qc = useQueryClient()
  const policiesQ = useQuery({
    queryKey: ['ideation-type-policies'],
    queryFn:  () => platformApi.listIdeationTypePolicies(),
  })
  const promptsQ = useQuery({
    queryKey: ['ideation-ai-prompts-approved'],
    queryFn:  () => platformApi.listIdeationAiPrompts(),
  })
  const bpQ = useQuery({
    queryKey: ['ideation-best-practice-records-approved'],
    queryFn:  () => platformApi.listIdeationBestPracticeRecords(),
  })
  const { data: readiness } = useAiReadiness()
  const aiReady = isAiReady(readiness)

  const enriched: PolicyEnriched[] = useMemo(() => {
    const byPrompt = new Map<string, IdeationAiPromptRecord>()
    for (const p of promptsQ.data?.prompts ?? []) byPrompt.set(p.docType, p)
    const byBp = new Map<string, IdeationBestPracticeRecord>()
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
      setSelectedDocType(null); setDetailOpen(false)
    }
  }, [enriched, selectedDocType])

  const openDetail = (docType: string) => { setSelectedDocType(docType); setDetailOpen(true) }
  const selected = enriched.find(p => p.docType === selectedDocType) ?? null

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ['ideation-type-policies'] })
    qc.invalidateQueries({ queryKey: ['ideation-ai-prompts-approved'] })
    qc.invalidateQueries({ queryKey: ['ideation-best-practice-records-approved'] })
    qc.invalidateQueries({ queryKey: ['ideation-ai-prompt-versions'] })
    qc.invalidateQueries({ queryKey: ['ideation-bp-versions'] })
  }

  const loading = policiesQ.isLoading || promptsQ.isLoading || bpQ.isLoading

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-5" data-screen="ideation-policies">
      <MasterLibraryHeading>
        <h1 className="text-[20px] font-semibold text-slate-900">Ideation & KOL Engagement Policies</h1>
        <p className="mt-0.5 text-[13px] text-slate-500">
          What each ideation artefact type (KOL engagement brief, patient story, HCP insight report,
          medical affairs narrative, press release, congress summary) is wired up with. The AI
          drafter + validation loop + publishing review gate read these on every call.
        </p>
      </MasterLibraryHeading>

      <AiReadinessBanner
        readiness={readiness}
        context="Approving an ideation AI prompt / BP digest or creating a new policy is blocked until an AI engine is configured."
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
        storageKey="clinwrite.ideationPolicies.detail.width"
        defaultWidth={720}
        minWidth={520}
        maxWidth={1100}
        expandable
      >
        {selected && (
          <AssociationsPanel key={selected.id} policy={selected} aiReady={aiReady} onChanged={invalidateAll} />
        )}
      </SlidePanel>

      <SlidePanel
        open={newOpen}
        onClose={() => setNewOpen(false)}
        title="New ideation policy"
        subtitle="Anchor a new ideation artefact type."
        storageKey="clinwrite.ideationPolicies.new.width"
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
    <div className="flex min-h-0 flex-1 flex-col gap-3" data-med-policies-table>
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
            placeholder="Search by content type (e.g. slide deck, PIL, CME)…"
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-[12px] placeholder:text-slate-400"
            data-field="search-ideation-policies"
          />
        </div>
        <div className="flex-1" />
        <button
          type="button"
          onClick={onNew}
          className="rounded-md border border-blue-600 bg-blue-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-blue-700"
          data-action="new-regulatory-policy"
        >
          + New policy
        </button>
      </header>

      {policies.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed border-slate-300 bg-white p-8 text-center" data-empty>
          <p className="text-[13px] font-semibold text-slate-800">No ideation policies yet</p>
          <p className="max-w-md text-[12px] text-slate-500">
            Anchor an ideation artefact type so authors can create works of that kind. AI prompts /
            BP digests / templates / checklists wire up afterwards.
          </p>
          <button
            type="button"
            onClick={onNew}
            className="rounded-md border border-blue-600 bg-blue-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-blue-700"
            data-action="empty-new-regulatory-policy"
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
                <th className="px-3 py-2 font-semibold">Template</th>
                <th className="px-3 py-2 font-semibold">Checklist</th>
                <th className="px-3 py-2 font-semibold">Regulatory</th>
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
                  <td className="px-3 py-2 align-top"><ChipPin value={p.templateId} /></td>
                  <td className="px-3 py-2 align-top"><ChipPin value={p.checklistTemplateId} /></td>
                  <td className="px-3 py-2 align-top"><ChipRegulatory value={p.channelHint} /></td>
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

type ChipState = 'approved' | 'legacy' | 'pinned' | 'missing'

function Chip({ state, label, hint }: { state: ChipState; label: string; hint?: string }) {
  const palette: Record<ChipState, string> = {
    approved: 'bg-emerald-100 text-emerald-800',
    legacy:   'bg-amber-100 text-amber-800',
    pinned:   'bg-indigo-100 text-indigo-800',
    missing:  'bg-slate-100 text-slate-500 italic',
  }
  return <span className={`inline-flex rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold ${palette[state]}`} title={hint} data-chip-state={state}>{label}</span>
}

function ChipAiPrompt({ row, legacy }: { row: IdeationAiPromptRecord | null; legacy: string }) {
  if (row) {
    const rules = (row.sectionRules as Record<string, unknown> | null) ?? {}
    return <Chip state="approved" label={`v${row.version}`} hint={`Approved · ${row.smePrompt.length} chars · ${Object.keys(rules).length} section rule groups`} />
  }
  if (legacy?.trim().length) {
    return <Chip state="legacy" label="legacy" hint="Falling back to policy.smePrompt — approve a IdeationAiPromptRecord to migrate." />
  }
  return <Chip state="missing" label="none" hint="No SME prompt." />
}

function ChipBp({ row, legacy }: { row: IdeationBestPracticeRecord | null; legacy: { principles?: unknown[] } | null }) {
  if (row) {
    const count = row.digest?.principles?.length ?? 0
    return <Chip state="approved" label={`v${row.version} · ${count}p`} hint={`Approved BP digest · ${count} principles`} />
  }
  if (legacy?.principles?.length) {
    return <Chip state="legacy" label={`legacy · ${legacy.principles.length}p`} hint="Falling back to policy.bestPracticeDigest." />
  }
  return <Chip state="missing" label="none" hint="No BP digest." />
}

function ChipPin({ value }: { value: string | null }) {
  if (value) return <Chip state="pinned" label="pinned" hint={value} />
  return <Chip state="missing" label="none" />
}

function ChipRegulatory({ value }: { value: IdeationChannelHint | null }) {
  if (!value) return <Chip state="missing" label="none" />
  return <Chip state="pinned" label={value} hint={CHANNEL_HINTS.find(t => t.value === value)?.label ?? value} />
}

// ---- side panel ---------------------------------------------------------

function AssociationsPanel({ policy, aiReady, onChanged }: { policy: PolicyEnriched; aiReady: boolean; onChanged: () => void }) {
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionInfo,  setActionInfo]  = useState<string | null>(null)

  const [templateId,          setTemplateId]          = useState(policy.templateId ?? '')
  const [checklistTemplateId, setChecklistTemplateId] = useState(policy.checklistTemplateId ?? '')
  const [channelHint,     setComplianceTrack]     = useState<IdeationChannelHint | ''>(policy.channelHint ?? '')

  const dirty = templateId !== (policy.templateId ?? '')
            || checklistTemplateId !== (policy.checklistTemplateId ?? '')
            || channelHint !== (policy.channelHint ?? '')

  const savePins = useMutation({
    mutationFn: () => platformApi.updateIdeationTypePolicy(policy.docType, {
      templateId:          templateId.trim() || null,
      checklistTemplateId: checklistTemplateId.trim() || null,
      channelHint:     (channelHint as IdeationChannelHint) || null,
    }),
    onSuccess:  () => { setActionInfo('Pins saved.'); setActionError(null); onChanged() },
    onError:    (err: unknown) => { setActionError(errMessage(err, 'Save failed')); setActionInfo(null) },
  })

  const retire = useMutation({
    mutationFn: (reason: string) => platformApi.retireIdeationTypePolicy(policy.docType, reason),
    onSuccess:  () => { setActionInfo('Policy retired.'); setActionError(null); onChanged() },
    onError:    (err: unknown) => { setActionError(errMessage(err, 'Retire failed')); setActionInfo(null) },
  })

  const saveRequirements = useMutation({
    mutationFn: (next: PolicyRequirements) =>
      platformApi.updateIdeationTypePolicy(policy.docType, { requirements: next }),
    onSuccess: () => { setActionInfo('Requirements saved.'); setActionError(null); onChanged() },
    onError:   (err: unknown) => { setActionError(errMessage(err, 'Save failed')); setActionInfo(null) },
  })

  const onRetire = () => {
    const reason = window.prompt('Reason for retiring this policy:', '')
    if (!reason || !reason.trim()) return
    retire.mutate(reason.trim())
  }

  return (
    <div className="flex flex-col gap-4 p-4" data-regulatory-panel={policy.docType}>
      {actionError && <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700">{actionError}</p>}
      {actionInfo  && <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] text-emerald-800">{actionInfo}</p>}

      <AiPromptSection docType={policy.docType} approved={policy.aiPrompt} legacySme={policy.smePrompt} aiReady={aiReady} onChanged={onChanged} />
      {/* BP removed per product decision — BP is author guidance, not AI steering. */}

      <section className="rounded-md border border-slate-200 bg-slate-50 p-3" data-pins>
        <p className="mb-2 text-[12px] font-semibold text-slate-800">Policy pins</p>
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Template id</span>
            <input type="text" value={templateId} onChange={e => setTemplateId(e.currentTarget.value)}
              placeholder="regulatory_document_templates.id or blank"
              className="h-9 rounded-md border border-slate-300 bg-white px-3 text-[13px]" data-field="template-id" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Checklist template id</span>
            <input type="text" value={checklistTemplateId} onChange={e => setChecklistTemplateId(e.currentTarget.value)}
              placeholder="regulatory_document_checklist_templates.id or blank"
              className="h-9 rounded-md border border-slate-300 bg-white px-3 text-[13px]" data-field="checklist-template-id" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Channel hint</span>
            <select value={channelHint} onChange={e => setComplianceTrack(e.currentTarget.value as IdeationChannelHint | '')}
              className="h-9 rounded-md border border-slate-300 bg-white px-3 text-[13px]" data-field="channel-hint">
              <option value="">— none —</option>
              {CHANNEL_HINTS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </label>
          <div className="flex justify-end">
            <button type="button" onClick={() => savePins.mutate()} disabled={!dirty || savePins.isPending}
              className="rounded-md border border-blue-600 bg-blue-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              data-action="save-pins">
              {savePins.isPending ? 'Saving…' : 'Save pins'}
            </button>
          </div>
        </div>
      </section>

      <PolicyRequirementsToggles
        value={policy.requirements ?? DEFAULT_POLICY_REQUIREMENTS}
        disabled={saveRequirements.isPending}
        onChange={next => saveRequirements.mutate(next)}
      />

      <footer className="mt-2 flex items-center justify-between border-t border-slate-200 pt-3">
        <p className="font-mono text-[10px] text-slate-400">
          Policy created {new Date(policy.createdAt).toLocaleDateString()} · last updated {new Date(policy.updatedAt).toLocaleDateString()} by {policy.updatedBy}
        </p>
        <button type="button" onClick={onRetire} disabled={retire.isPending}
          className="rounded-md border border-rose-300 bg-white px-3 py-1.5 text-[12px] font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
          data-action="retire-regulatory-policy">
          {retire.isPending ? 'Retiring…' : 'Retire policy'}
        </button>
      </footer>
    </div>
  )
}

function AiPromptSection({ docType, approved, legacySme, aiReady, onChanged }: {
  docType: string; approved: IdeationAiPromptRecord | null
  legacySme: string | null | undefined; aiReady: boolean; onChanged: () => void
}) {
  const qc = useQueryClient()
  const versionsQ = useQuery({
    queryKey: ['ideation-ai-prompt-versions', docType],
    queryFn:  () => platformApi.listIdeationAiPromptVersions(docType),
  })
  const draft = versionsQ.data?.versions.find(v => v.status === 'draft') ?? null

  const [promptText, setPromptText] = useState('')
  const [editing, setEditing] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const [localInfo,  setLocalInfo]  = useState<string | null>(null)

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['ideation-ai-prompt-versions', docType] })
    qc.invalidateQueries({ queryKey: ['ideation-ai-prompts-approved'] })
    onChanged()
  }

  const startDraft = useMutation({
    mutationFn: () => platformApi.createIdeationAiPromptDraft({
      docType, smePrompt: promptText.trim() || (approved?.smePrompt ?? legacySme ?? ''),
    }),
    onSuccess: () => { setEditing(false); setLocalInfo('Draft created.'); setLocalError(null); invalidate() },
    onError:   (err: unknown) => { setLocalError(errMessage(err, 'Draft create failed')); setLocalInfo(null) },
  })
  const saveDraft = useMutation({
    mutationFn: () => platformApi.updateIdeationAiPromptDraft(draft!.id, { smePrompt: promptText }),
    onSuccess: () => { setEditing(false); setLocalInfo('Draft saved.'); setLocalError(null); invalidate() },
    onError:   (err: unknown) => { setLocalError(errMessage(err, 'Save failed')); setLocalInfo(null) },
  })
  const approve = useMutation({
    mutationFn: () => platformApi.approveIdeationAiPrompt(draft!.id),
    onSuccess: () => { setLocalInfo('Draft approved.'); setLocalError(null); invalidate() },
    onError:   (err: unknown) => { setLocalError(errMessage(err, 'Approve failed')); setLocalInfo(null) },
  })
  const discard = useMutation({
    mutationFn: () => platformApi.retireIdeationAiPrompt(draft!.id, 'Draft discarded by admin'),
    onSuccess: () => { setLocalInfo('Draft discarded.'); setLocalError(null); invalidate() },
    onError:   (err: unknown) => { setLocalError(errMessage(err, 'Discard failed')); setLocalInfo(null) },
  })

  const state: ChipState = approved ? 'approved' : (legacySme?.trim() ? 'legacy' : 'missing')
  const summary = approved
    ? `Approved v${approved.version} · ${approved.smePrompt.length.toLocaleString()} chars`
    : legacySme?.trim() ? `Legacy prompt in use · ${legacySme.length.toLocaleString()} chars` : 'No prompt yet'

  const palette: Record<ChipState, string> = {
    approved: 'border-emerald-200 bg-emerald-50/40',
    legacy:   'border-amber-200 bg-amber-50/40',
    pinned:   'border-indigo-200 bg-indigo-50/40',
    missing:  'border-slate-200 bg-white',
  }

  return (
    <section className={`rounded-md border ${palette[state]} p-3`} data-assoc="AI prompt">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-600">AI prompt</p>
          <Chip state={state} label={state} />
        </div>
      </header>
      <p className="mt-1 text-[12px] text-slate-700">{summary}</p>

      {approved && (
        <details className="mt-2">
          <summary className="cursor-pointer text-[11px] font-semibold text-slate-700">Show approved SME prompt</summary>
          <pre className="mt-1 max-h-40 overflow-auto rounded border border-slate-200 bg-white p-2 font-mono text-[11px] leading-relaxed text-slate-800">{approved.smePrompt}</pre>
        </details>
      )}

      {draft && !editing && (
        <div className="mt-2 flex flex-col gap-2 rounded-md border border-amber-300 bg-amber-50 p-2" data-draft={draft.id}>
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] font-semibold uppercase text-amber-900">Pending draft v{draft.version}</span>
            <div className="flex gap-2">
              <button type="button" onClick={() => { setPromptText(draft.smePrompt); setEditing(true) }}
                className="rounded-md border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                data-action="edit-regulatory-ai-prompt-draft">Edit</button>
              <button type="button" onClick={() => { if (confirm('Discard draft?')) discard.mutate() }} disabled={discard.isPending}
                className="rounded-md border border-rose-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                data-action="discard-regulatory-ai-prompt-draft">{discard.isPending ? 'Discarding…' : 'Discard'}</button>
              <button type="button" onClick={() => approve.mutate()} disabled={approve.isPending || !aiReady}
                title={!aiReady ? 'AI is not set up.' : undefined}
                className="rounded-md border border-emerald-600 bg-emerald-600 px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                data-action="approve-regulatory-ai-prompt-draft">{approve.isPending ? 'Approving…' : (approved ? `Approve (retires v${approved.version})` : 'Approve')}</button>
            </div>
          </div>
          <pre className="max-h-40 overflow-auto rounded border border-amber-200 bg-white p-2 font-mono text-[11px] text-slate-800">{draft.smePrompt}</pre>
        </div>
      )}

      {editing && (
        <div className="mt-2 flex flex-col gap-2 rounded-md border border-blue-200 bg-blue-50/40 p-2" data-editing>
          <textarea value={promptText} onChange={e => setPromptText(e.currentTarget.value)} rows={10}
            className="w-full resize-y rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-[12px] leading-relaxed"
            data-field="regulatory-ai-prompt-editor" />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setEditing(false)}
              className="rounded-md border border-slate-300 bg-white px-3 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50">Cancel</button>
            <button type="button" onClick={() => draft ? saveDraft.mutate() : startDraft.mutate()}
              disabled={saveDraft.isPending || startDraft.isPending || !aiReady || !promptText.trim()}
              title={!aiReady ? 'AI is not set up.' : undefined}
              className="rounded-md border border-blue-600 bg-blue-600 px-3 py-1 text-[11px] font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              data-action="save-med-ai-prompt-draft">
              {saveDraft.isPending || startDraft.isPending ? 'Saving…' : (draft ? 'Save draft' : 'Create draft')}
            </button>
          </div>
        </div>
      )}

      {!draft && !editing && (
        <div className="mt-2 flex justify-end">
          <button type="button" onClick={() => { setPromptText(approved?.smePrompt ?? legacySme ?? ''); setEditing(true) }}
            disabled={!aiReady} title={!aiReady ? 'AI is not set up.' : undefined}
            className="rounded-md border border-blue-600 bg-white px-2 py-0.5 text-[11px] font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-50"
            data-action="start-regulatory-ai-prompt-draft">{approved ? 'Start new version' : 'Author prompt'}</button>
        </div>
      )}

      {localInfo  && <p className="mt-2 text-[11px] text-emerald-700">{localInfo}</p>}
      {localError && <p className="mt-2 text-[11px] text-rose-700">{localError}</p>}
    </section>
  )
}

function BpSection({ docType, approved, legacyDigest, aiReady, onChanged }: {
  docType: string; approved: IdeationBestPracticeRecord | null
  legacyDigest: { principles?: unknown[] } | null; aiReady: boolean; onChanged: () => void
}) {
  const qc = useQueryClient()
  const versionsQ = useQuery({
    queryKey: ['ideation-bp-versions', docType],
    queryFn:  () => platformApi.listIdeationBestPracticeVersions(docType),
    refetchInterval: 5_000,
  })
  const draft = versionsQ.data?.versions.find(v => v.status === 'draft') ?? null

  const [previewOpen, setPreviewOpen] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const [localInfo,  setLocalInfo]  = useState<string | null>(null)

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['ideation-bp-versions', docType] })
    qc.invalidateQueries({ queryKey: ['ideation-best-practice-records-approved'] })
    onChanged()
  }
  // BP distillation retired (M-F.1) — Section Templates now carry the AI
  // formatting rules.
  void platformApi.distillIdeationBestPracticeFile

  const approve = useMutation({
    mutationFn: () => platformApi.approveIdeationBestPractice(draft!.id),
    onSuccess: () => { setLocalInfo('Draft approved.'); setLocalError(null); invalidate() },
    onError:   (err: unknown) => { setLocalError(errMessage(err, 'Approve failed')); setLocalInfo(null) },
  })
  const discard = useMutation({
    mutationFn: () => platformApi.retireIdeationBestPractice(draft!.id, 'Draft discarded by admin'),
    onSuccess: () => { setLocalInfo('Draft discarded.'); setLocalError(null); invalidate() },
    onError:   (err: unknown) => { setLocalError(errMessage(err, 'Discard failed')); setLocalInfo(null) },
  })

  const state: ChipState = approved ? 'approved' : (legacyDigest?.principles?.length ? 'legacy' : 'missing')
  const summary = approved
    ? `Approved v${approved.version} · ${approved.digest?.principles?.length ?? 0} principles`
    : legacyDigest?.principles?.length ? `Legacy digest in use · ${legacyDigest.principles.length} principles` : 'No digest yet'

  const palette: Record<ChipState, string> = {
    approved: 'border-emerald-200 bg-emerald-50/40',
    legacy:   'border-amber-200 bg-amber-50/40',
    pinned:   'border-indigo-200 bg-indigo-50/40',
    missing:  'border-slate-200 bg-white',
  }

  return (
    <section className={`rounded-md border ${palette[state]} p-3`} data-assoc="Best-practice digest">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-600">Best-practice digest</p>
          <Chip state={state} label={state} />
        </div>
      </header>
      <p className="mt-1 text-[12px] text-slate-700">{summary}</p>

      <div className="mt-2 flex flex-col gap-1 rounded-md border border-slate-200 bg-slate-50 p-2 text-[11px] text-slate-600" data-bp-upload="retired">
        <p className="font-medium text-slate-700">BP distillation retired</p>
        <p>BP is author guidance now. Formatting hints flow through Master Library &rarr; Section Templates.</p>
      </div>

      {draft && (
        <div className="mt-2 flex flex-col gap-2 rounded-md border border-amber-300 bg-amber-50 p-2" data-bp-draft={draft.id}>
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] font-semibold uppercase text-amber-900">
              Pending draft v{draft.version} · {draft.digest?.principles?.length ?? 0} principles
            </span>
            <div className="flex gap-2">
              <button type="button" onClick={() => setPreviewOpen(v => !v)}
                className="rounded-md border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50">
                {previewOpen ? 'Hide' : 'Preview'}
              </button>
              <button type="button" onClick={() => { if (confirm(`Discard draft v${draft.version}?`)) discard.mutate() }} disabled={discard.isPending}
                className="rounded-md border border-rose-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                data-action="discard-regulatory-bp-draft">{discard.isPending ? 'Discarding…' : 'Discard'}</button>
              <button type="button" onClick={() => approve.mutate()} disabled={approve.isPending || !aiReady}
                title={!aiReady ? 'AI is not set up.' : undefined}
                className="rounded-md border border-emerald-600 bg-emerald-600 px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                data-action="approve-regulatory-bp-draft">{approve.isPending ? 'Approving…' : (approved ? `Approve (retires v${approved.version})` : 'Approve')}</button>
            </div>
          </div>
          {previewOpen && (
            <pre className="max-h-56 overflow-auto rounded border border-amber-200 bg-white p-2 font-mono text-[11px] text-slate-800">
              {JSON.stringify(draft.digest, null, 2)}
            </pre>
          )}
        </div>
      )}

      {localInfo  && <p className="mt-2 text-[11px] text-emerald-700">{localInfo}</p>}
      {localError && <p className="mt-2 text-[11px] text-rose-700">{localError}</p>}
    </section>
  )
}

function CreatePolicyForm({ aiReady, taken, onCreated, onCancel }: {
  aiReady: boolean; taken: string[]
  onCreated: (docType: string) => void; onCancel?: () => void
}) {
  const [docType, setDocType] = useState('')
  const [smePrompt, setSmePrompt] = useState('')
  const [channelHint, setComplianceTrack] = useState<IdeationChannelHint | ''>('')
  const [error, setError] = useState<string | null>(null)
  const duplicate = taken.includes(docType)

  const create = useMutation({
    mutationFn: () => platformApi.createIdeationTypePolicy({
      docType,
      smePrompt: smePrompt.trim() || `SME prompt for ${docTypeLabel(docType)} — configure in Regulatory AI Prompts.`,
      channelHint: (channelHint as IdeationChannelHint) || null,
    }),
    onSuccess: (row) => { setError(null); onCreated(row.docType) },
    onError:   (err: unknown) => setError(errMessage(err, 'Create failed')),
  })

  const availableTypes = IDEATION_DOC_TYPES.filter(t => !taken.includes(t.value))

  return (
    <div className="flex h-full flex-col gap-3 p-4" data-new-regulatory-policy>
      <p className="text-[12px] text-slate-500">
        Anchor an ideation artefact type. After creation, wire up the AI prompt, BP digest,
        template, and checklist from this same panel.
      </p>
      {error && <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700">{error}</p>}
      <label className="flex flex-col gap-1">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Doc type</span>
        <select value={docType} onChange={e => setDocType(e.currentTarget.value)}
          className={`h-9 rounded-md border border-slate-300 bg-white px-3 text-[13px] ${docType ? 'text-slate-900' : 'text-slate-400'}`}
          data-field="create-regulatory-doc-type">
          <option value="" disabled>Select a doc type</option>
          {availableTypes.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        {duplicate && <p className="text-[11px] font-semibold text-rose-700" role="alert">A policy for this doc type already exists.</p>}
      </label>
      <label className="flex flex-col gap-1">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Channel hint (optional)</span>
        <select value={channelHint} onChange={e => setComplianceTrack(e.currentTarget.value as IdeationChannelHint | '')}
          className="h-9 rounded-md border border-slate-300 bg-white px-3 text-[13px]" data-field="create-channel-hint">
          <option value="">— none —</option>
          {CHANNEL_HINTS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Starter SME prompt (optional)</span>
        <textarea value={smePrompt} onChange={e => setSmePrompt(e.currentTarget.value)} rows={8}
          placeholder="Leave blank to ship a placeholder."
          className="resize-y rounded-md border border-slate-300 px-3 py-2 font-mono text-[12px] leading-relaxed"
          data-field="create-regulatory-sme-prompt" />
      </label>
      <div className="flex items-center justify-end gap-2 border-t border-slate-200 pt-3">
        {onCancel && (
          <button type="button" onClick={onCancel} disabled={create.isPending}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-[12px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            data-action="regulatory-create-cancel">Cancel</button>
        )}
        <button type="button" onClick={() => create.mutate()} disabled={create.isPending || !docType || duplicate || !aiReady}
          title={!aiReady ? 'AI is not set up.' : undefined}
          className="rounded-md border border-blue-600 bg-blue-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          data-action="regulatory-create-policy">{create.isPending ? 'Creating…' : 'Create policy'}</button>
      </div>
    </div>
  )
}

// BP removed from the admin UI — functions retained as read-only legacy for a potential future re-introduction.
void ChipBp; void BpSection;
