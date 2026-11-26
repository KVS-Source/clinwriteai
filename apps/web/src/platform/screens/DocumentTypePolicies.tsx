// Document Type Policies — associations dashboard.
//
// After the pointer refactor (migrations 73 + 74), SME prompt / section
// rules / BP digest all live on their own versioned entities (AiPromptRecord,
// BestPracticeRecord). This screen is now a read-mostly map of what's
// wired up per doc type — one row per policy, chips for each associated
// asset, "Manage in <tab>" links out to the dedicated admin surface.
//
// Asset edits happen in their own tabs:
//   - SME prompt + section rules → /master-library/ai-prompts
//   - BP digest (approval only; upload trigger stays here)
//   - Template pin  → /master-library/templates
//   - Checklist     → /master-library/checklists
//   - ICH framework → /master-library/ich-frameworks
//
// What stays here:
//   - New policy (anchor a new docType in the system)
//   - Retire policy
//   - BP PDF upload (the parser's entry point)
//   - BP draft review + Approve (until a dedicated BP admin tab lands)

import { MasterLibraryHeading } from '../components/MasterLibraryHeading'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError } from '../../api/client'
import {
  platformApi,
  type BuildPlanView,
  type BuildPlanSourceView,
  type ReferenceStyle,
  type DocumentTypePolicy,
  type BestPracticeDigest,
  type AiPromptRecord,
  type BestPracticeRecord,
  type PolicyRequirements,
  DEFAULT_POLICY_REQUIREMENTS,
} from '../api/platformApi'
import { documentsApi, type DocumentTemplate } from '../../api/documents'
import { PolicyRequirementsToggles } from '../components/PolicyRequirementsToggles'
import { useAiReadiness, isAiReady, AiReadinessBanner } from '../ai-readiness'
import { SlidePanel } from '../../components/ui/SlidePanel'

function errMessage(err: unknown, fallback = 'Request failed'): string {
  if (err instanceof ApiError) {
    const body = err.body as { message?: string; error?: string } | null
    if (body?.message) return body.message
    if (body?.error)   return body.error
    return `${err.status}`
  }
  return err instanceof Error ? err.message : fallback
}

type PolicyEnriched = DocumentTypePolicy & {
  aiPrompt:     AiPromptRecord | null
  bestPractice: BestPracticeRecord | null
}

export function DocumentTypePolicies() {
  const qc = useQueryClient()
  const policiesQ = useQuery({
    queryKey: ['document-type-policies'],
    queryFn:  () => platformApi.listDocumentTypePolicies(),
  })
  const promptsQ = useQuery({
    queryKey: ['ai-prompts-approved'],
    queryFn:  () => platformApi.listAiPrompts(),
  })
  const bpQ = useQuery({
    queryKey: ['best-practice-records-approved'],
    queryFn:  () => platformApi.listBestPracticeRecords(),
  })
  const { data: readiness } = useAiReadiness()
  const aiReady = isAiReady(readiness)

  // Index AI Prompt + BP approved rows by docType so each policy row can
  // paint its chips in O(1).
  const enriched: PolicyEnriched[] = useMemo(() => {
    const byPrompt = new Map<string, AiPromptRecord>()
    for (const p of promptsQ.data?.prompts ?? []) byPrompt.set(p.docType, p)
    const byBp = new Map<string, BestPracticeRecord>()
    for (const b of bpQ.data?.records ?? []) byBp.set(b.docType, b)
    return (policiesQ.data?.policies ?? []).map(p => ({
      ...p,
      aiPrompt:     byPrompt.get(p.docType) ?? null,
      bestPractice: byBp.get(p.docType)     ?? null,
    }))
  }, [policiesQ.data, promptsQ.data, bpQ.data])

  const [selectedDocType, setSelectedDocType] = useState<string | null>(null)
  const [detailOpen,  setDetailOpen]  = useState(false)
  const [newOpen,     setNewOpen]     = useState(false)
  const [search,      setSearch]      = useState('')

  useEffect(() => {
    if (selectedDocType && !enriched.find(p => p.docType === selectedDocType)) {
      setSelectedDocType(null)
      setDetailOpen(false)
    }
  }, [enriched, selectedDocType])

  const openDetail = (docType: string) => { setSelectedDocType(docType); setDetailOpen(true) }
  const selected = enriched.find(p => p.docType === selectedDocType) ?? null

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ['document-type-policies'] })
    qc.invalidateQueries({ queryKey: ['ai-prompts-approved'] })
    qc.invalidateQueries({ queryKey: ['best-practice-records-approved'] })
    qc.invalidateQueries({ queryKey: ['bp-versions'] })
  }

  const loading = policiesQ.isLoading || promptsQ.isLoading || bpQ.isLoading

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-5" data-screen="document-type-policies">
      <MasterLibraryHeading>
        <h1 className="text-[20px] font-semibold text-slate-900">Doc Type Policies</h1>
        <p className="mt-0.5 text-[13px] text-slate-500">
          What each doc type is wired up with. The SME prompt, best-practice digest, section rules,
          template, checklist, and ICH framework for a given doc type at a glance. Edits for each
          asset happen in its own tab.
        </p>
      </MasterLibraryHeading>

      <AiReadinessBanner
        readiness={readiness}
        context="Approving a BP digest or creating a new policy is blocked until an AI engine is configured."
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
        title={selected ? `Policy — ${selected.docType}` : 'Policy'}
        subtitle={selected
          ? <span className="font-mono text-[11px]">{selected.docType} · v{selected.version}</span>
          : undefined}
        storageKey="clinwrite.policies.detail.width"
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
        title="New policy"
        subtitle="Anchor a new doc type in the system."
        storageKey="clinwrite.policies.new.width"
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
    .filter(p => !q || p.docType.toLowerCase().includes(q))
    .sort((a, b) => a.docType.localeCompare(b.docType))

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3" data-policies-table>
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
            placeholder="Search by doc type (e.g. protocol, CSR)…"
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-[12px] placeholder:text-slate-400"
            data-field="search-policies"
          />
        </div>
        <div className="flex-1" />
        <button
          type="button"
          onClick={onNew}
          className="rounded-md border border-blue-600 bg-blue-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-blue-700"
          data-action="new-policy"
        >
          + New policy
        </button>
      </header>

      {policies.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed border-slate-300 bg-white p-8 text-center" data-empty>
          <p className="text-[13px] font-semibold text-slate-800">No policies yet</p>
          <p className="max-w-md text-[12px] text-slate-500">
            Anchor a doc type here, then wire up its AI prompt, BP digest, template, checklist, and
            ICH framework from their own tabs.
          </p>
          <button
            type="button"
            onClick={onNew}
            className="rounded-md border border-blue-600 bg-blue-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-blue-700"
            data-action="empty-new-policy"
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
                <th className="px-3 py-2 font-semibold">ICH</th>
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
                      <span className="font-semibold text-slate-900">{p.docType}</span>
                      <span className="font-mono text-[10px] text-slate-500">policy v{p.version}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2 align-top"><ChipAiPrompt row={p.aiPrompt} legacy={p.smePrompt} /></td>
                  <td className="px-3 py-2 align-top"><ChipTemplate policy={p} /></td>
                  <td className="px-3 py-2 align-top"><ChipChecklist policy={p} /></td>
                  <td className="px-3 py-2 align-top"><ChipFramework policy={p} /></td>
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

function Chip({
  state, label, hint,
}: {
  state: 'approved' | 'legacy' | 'auto' | 'pinned' | 'missing'
  label: string
  hint?: string
}) {
  const palette: Record<typeof state, string> = {
    approved: 'bg-emerald-100 text-emerald-800',
    legacy:   'bg-amber-100 text-amber-800',
    auto:     'bg-sky-100 text-sky-800',
    pinned:   'bg-indigo-100 text-indigo-800',
    missing:  'bg-slate-100 text-slate-500 italic',
  } as const
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

function ChipAiPrompt({ row, legacy }: { row: AiPromptRecord | null; legacy: string }) {
  if (row) {
    const rules = (row.sectionRules as Record<string, unknown> | null) ?? {}
    const sections = Object.keys(rules).length
    return <Chip state="approved" label={`v${row.version}`} hint={`Approved · ${row.smePrompt.length} chars · ${sections} section rule groups`} />
  }
  if (legacy && legacy.trim().length > 0) {
    return <Chip state="legacy" label="legacy" hint="Falling back to policy.smePrompt — approve an AiPromptRecord to migrate." />
  }
  return <Chip state="missing" label="none" hint="No SME prompt. AI drafter uses built-in defaults for this doc type." />
}

function ChipBp({ row, legacy }: { row: BestPracticeRecord | null; legacy: BestPracticeDigest | null }) {
  if (row) {
    const count = row.digest?.principles?.length ?? 0
    return <Chip state="approved" label={`v${row.version} · ${count}p`} hint={`Approved BP digest · ${count} principles`} />
  }
  if (legacy?.principles?.length) {
    return <Chip state="legacy" label={`legacy · ${legacy.principles.length}p`} hint="Falling back to policy.bestPracticeDigest — approve a BestPracticeRecord to migrate." />
  }
  return <Chip state="missing" label="none" hint="No BP digest. Upload a BP PDF to distill principles." />
}

function ChipTemplate({ policy }: { policy: DocumentTypePolicy }) {
  const eff = policy.resolved?.template.effective
  if (eff === 'pinned' && policy.resolved!.template.pinned) {
    return <Chip state="pinned" label={`v${policy.resolved!.template.pinned.version}`} hint={`Pinned: ${policy.resolved!.template.pinned.label}`} />
  }
  if (eff === 'auto' && policy.resolved!.template.auto) {
    return <Chip state="auto" label={`auto v${policy.resolved!.template.auto.version}`} hint={`Auto-matched: ${policy.resolved!.template.auto.label}`} />
  }
  return <Chip state="missing" label="none" hint="No template for this doc type." />
}

function ChipChecklist({ policy }: { policy: DocumentTypePolicy }) {
  const eff = policy.resolved?.checklist.effective
  if (eff === 'pinned' && policy.resolved!.checklist.pinned) {
    return <Chip state="pinned" label={`v${policy.resolved!.checklist.pinned.version}`} hint="Pinned checklist" />
  }
  if (eff === 'auto' && policy.resolved!.checklist.auto) {
    return <Chip state="auto" label={`auto v${policy.resolved!.checklist.auto.version}`} hint="Auto-matched checklist" />
  }
  return <Chip state="missing" label="none" hint="No checklist for this doc type." />
}

function ChipFramework({ policy }: { policy: DocumentTypePolicy }) {
  if (policy.ichFramework) {
    return <Chip state="pinned" label={policy.ichFramework} hint={`ICH framework pin: ${policy.ichFramework}`} />
  }
  return <Chip state="missing" label="none" />
}

// ---- side panel: details + minimal edits -------------------------------

function AssociationsPanel({
  policy, aiReady: _aiReady, onChanged,
}: {
  policy:    PolicyEnriched
  aiReady:   boolean
  onChanged: () => void
}) {
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionInfo,  setActionInfo]  = useState<string | null>(null)

  const retire = useMutation({
    mutationFn: (reason: string) => platformApi.retireDocumentTypePolicy(policy.docType, reason),
    onSuccess:  () => { setActionInfo('Policy retired.'); setActionError(null); onChanged() },
    onError:    (err: unknown) => { setActionError(errMessage(err, 'Retire failed')); setActionInfo(null) },
  })

  // Requirements PATCH — in-place update on the current policy. The
  // service rejects edits of a used-by-documents version with 409, in
  // which case the PM has to bump a new version; we surface that message
  // verbatim so the admin knows which action to take next.
  const saveRequirements = useMutation({
    mutationFn: (next: PolicyRequirements) =>
      platformApi.updateDocumentTypePolicy(policy.docType, { requirements: next }),
    onSuccess: () => { setActionInfo('Requirements saved.'); setActionError(null); onChanged() },
    onError:   (err: unknown) => { setActionError(errMessage(err, 'Save failed')); setActionInfo(null) },
  })

  const saveReferenceStyle = useMutation({
    mutationFn: (referenceStyle: ReferenceStyle) =>
      platformApi.updateDocumentTypePolicy(policy.docType, { referenceStyle }),
    onSuccess: () => { setActionInfo('Reference style saved.'); setActionError(null); onChanged() },
    onError:   (err: unknown) => { setActionError(errMessage(err, 'Save failed')); setActionInfo(null) },
  })

  const saveIchPins = useMutation({
    mutationFn: (names: string[]) =>
      platformApi.updateDocumentTypePolicy(policy.docType, { ichFrameworkNames: names }),
    onSuccess: () => { setActionInfo('ICH framework pins saved.'); setActionError(null); onChanged() },
    onError:   (err: unknown) => { setActionError(errMessage(err, 'Save failed')); setActionInfo(null) },
  })

  const onRetire = () => {
    const reason = window.prompt('Reason for retiring this policy (goes on the audit trail):', '')
    if (!reason || !reason.trim()) return
    retire.mutate(reason.trim())
  }

  return (
    <div className="flex flex-col gap-4 p-4" data-panel={policy.docType}>
      {actionError && <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700">{actionError}</p>}
      {actionInfo  && <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] text-emerald-800">{actionInfo}</p>}

      <AssociationRow
        label="AI prompt"
        state={policy.aiPrompt ? 'approved' : (policy.smePrompt?.trim() ? 'legacy' : 'missing')}
        summary={policy.aiPrompt
          ? `Approved v${policy.aiPrompt.version} · ${policy.aiPrompt.smePrompt.length.toLocaleString()} chars`
          : policy.smePrompt?.trim()
            ? `Legacy prompt still in use · ${policy.smePrompt.length.toLocaleString()} chars`
            : 'No prompt'}
        detail={policy.aiPrompt?.smePrompt ?? policy.smePrompt ?? ''}
        manageTo="/master-library/ai-prompts"
        manageLabel="Manage in AI Prompts"
      />

      {/* BP removed per product decision — BP is author guidance, not AI
          steering. The drafter no longer composes BP principles into its
          system prompt. Tables + routes retained as read-only legacy. */}

      <AssociationRow
        label="Template"
        state={policy.resolved?.template.effective === 'none' ? 'missing' : (policy.resolved?.template.effective ?? 'missing')}
        summary={
          policy.resolved?.template.effective === 'pinned' && policy.resolved.template.pinned
            ? `Pinned: ${policy.resolved.template.pinned.label} · v${policy.resolved.template.pinned.version}`
            : policy.resolved?.template.effective === 'auto' && policy.resolved.template.auto
              ? `Auto-matched: ${policy.resolved.template.auto.label} · v${policy.resolved.template.auto.version}`
              : 'No template'
        }
        detail={null}
        manageTo="/master-library/templates"
        manageLabel="Manage in Templates"
      />

      <AssociationRow
        label="Checklist"
        state={policy.resolved?.checklist.effective === 'none' ? 'missing' : (policy.resolved?.checklist.effective ?? 'missing')}
        summary={
          policy.resolved?.checklist.effective === 'pinned' && policy.resolved.checklist.pinned
            ? `Pinned v${policy.resolved.checklist.pinned.version}`
            : policy.resolved?.checklist.effective === 'auto' && policy.resolved.checklist.auto
              ? `Auto-matched v${policy.resolved.checklist.auto.version}`
              : 'No checklist'
        }
        detail={null}
        manageTo="/master-library/checklists"
        manageLabel="Manage in Checklists"
      />

      <IchFrameworksPicker
        policy={policy}
        onSave={names => saveIchPins.mutate(names)}
        saving={saveIchPins.isPending}
      />

      <PolicyRequirementsToggles
        value={policy.requirements ?? DEFAULT_POLICY_REQUIREMENTS}
        disabled={saveRequirements.isPending}
        onChange={next => saveRequirements.mutate(next)}
      />

      <section className="rounded-md border border-slate-200 bg-white p-3" data-section="reference-style">
        <h3 className="text-[13px] font-semibold text-slate-900">Reference style</h3>
        <p className="mt-1 text-[12px] text-slate-500">
          How the AI drafter&rsquo;s references are cited when the References section is built. Only references found in the evidence sources are listed.
        </p>
        <div className="mt-2 flex gap-4 text-[12px] text-slate-800" role="radiogroup" aria-label="Reference style">
          {([['numbered', 'Numbered: [1], listed in order of first use'], ['author_year', 'Author-year: (Smith 2021), listed alphabetically']] as const).map(([value, label]) => (
            <label key={value} className="flex items-center gap-1.5">
              <input
                type="radio"
                name={`reference-style-${policy.docType}`}
                checked={(policy.referenceStyle ?? 'numbered') === value}
                disabled={saveReferenceStyle.isPending}
                onChange={() => saveReferenceStyle.mutate(value)}
                data-reference-style={value}
              />
              {label}
            </label>
          ))}
        </div>
      </section>

      <BuildPlanCard plan={policy.buildPlan ?? null} source={policy.buildPlanSource ?? null} />

      <footer className="mt-2 flex items-center justify-between border-t border-slate-200 pt-3">
        <p className="font-mono text-[10px] text-slate-400">
          Policy created {new Date(policy.createdAt).toLocaleDateString()} · last updated {new Date(policy.updatedAt).toLocaleDateString()} by {policy.updatedBy}
        </p>
        <button
          type="button"
          onClick={onRetire}
          disabled={retire.isPending}
          className="rounded-md border border-rose-300 bg-white px-3 py-1.5 text-[12px] font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
          data-action="retire"
        >
          {retire.isPending ? 'Retiring…' : 'Retire policy'}
        </button>
      </footer>
    </div>
  )
}

/**
 * The AI build plan of this document type: the order its sections are drafted in. Read-only: it comes from a
 * policy package signed by GenBioCa and imported by the admin under Admin → Licensing (docs/policy-packages.md).
 */
function BuildPlanCard({ plan, source }: { plan: BuildPlanView | null; source: BuildPlanSourceView | null }) {
  return (
    <section className="rounded-md border border-slate-200 bg-white p-3" data-section="build-plan">
      <h3 className="text-[13px] font-semibold text-slate-900">AI build plan</h3>
      {!plan ? (
        <p className="mt-1 text-[12px] text-slate-500">
          No build plan: the AI drafts every section in the template’s order. A plan arrives in a policy package from GenBioCa.
        </p>
      ) : (
        <>
          <p className="mt-1 text-[12px] text-slate-600">
            {plan.label}. Set by GenBioCa{source ? ` (package ${source.packageId} v${source.packageVersion}, imported ${new Date(source.importedAt).toLocaleDateString()})` : ''}; it can’t be edited here.
            Main headings keep the template heading and are not drafted.
          </p>
          <ol className="mt-2 flex flex-col gap-1.5 text-[12px]">
            {plan.stages.map((stage, i) => (
              <li key={stage.key} data-plan-stage={stage.key}>
                <span className="font-medium text-slate-900">{i + 1}. {stage.label}</span>
                {stage.rules?.noNewFacts && <span className="ml-1 text-[11px] text-slate-500">(only facts from earlier sections)</span>}
                {stage.rules?.exampleWording && <span className="ml-1 text-[11px] text-slate-500">(standard wording from examples allowed)</span>}
                <span className="block text-[11px] text-slate-500">{stage.sections.map(s => `${s.number} ${s.title}`).join(' · ')}</span>
              </li>
            ))}
            {plan.builtByCode.length > 0 && (
              <li data-plan-stage="built-by-code">
                <span className="font-medium text-slate-900">{plan.stages.length + 1}. Built by code after drafting</span>
                <span className="block text-[11px] text-slate-500">{plan.builtByCode.map(s => `${s.number} ${s.title}`).join(' · ')}</span>
              </li>
            )}
          </ol>
        </>
      )}
    </section>
  )
}

// ICH framework multi-select — swaps the generic AssociationRow for an
// inline picker populated from GET /admin/frameworks. Each row has a
// checkbox + the framework name + its version/jurisdiction. Chips at
// the top show the resolver's current view (auto-matched default +
// pinned list). Dirty state enables Save; "Manage in ICH Frameworks"
// stays as a secondary action for catalogue CRUD.
function IchFrameworksPicker({
  policy, onSave, saving,
}: {
  policy:  PolicyEnriched
  onSave:  (names: string[]) => void
  saving:  boolean
}) {
  const current = useMemo(
    () => (policy.ichFrameworkNames && policy.ichFrameworkNames.length > 0
            ? policy.ichFrameworkNames
            : (policy.ichFramework ? [policy.ichFramework] : [])),
    [policy.ichFrameworkNames, policy.ichFramework],
  )
  const [picked, setPicked] = useState<string[]>(current)
  useEffect(() => { setPicked(current) }, [current])

  const frameworksQ = useQuery({
    queryKey: ['regulatory-frameworks'],
    queryFn:  () => platformApi.listFrameworks(),
    staleTime: 5 * 60_000,
    retry: false,
  })
  // Hide retired entries from the picker; keep already-pinned-retired
  // names visible as chips so the admin knows what was previously set.
  const options = useMemo(() => {
    const rows = frameworksQ.data ?? []
    return rows.filter(r => r.status === 'Current')
  }, [frameworksQ.data])

  const toggle = (name: string, checked: boolean) => {
    setPicked(prev => checked
      ? (prev.includes(name) ? prev : [...prev, name])
      : prev.filter(n => n !== name))
  }

  const dirty = picked.length !== current.length
             || picked.some((n, i) => n !== current[i])

  const resolved = policy.resolved?.ich
  const effective = resolved?.effective ?? 'none'
  const toneClass =
    effective === 'pinned' ? 'border-indigo-200 bg-indigo-50/40' :
    effective === 'auto'   ? 'border-sky-200 bg-sky-50/40' :
                             'border-slate-200 bg-white'

  return (
    <section className={`rounded-md border ${toneClass} p-3`} data-assoc="ICH framework">
      <header className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-600">
            ICH framework
          </p>
          <span className="rounded-full border border-slate-300 bg-white px-1.5 py-0.5 text-[10px] font-mono text-slate-600">
            {effective === 'pinned' ? `${resolved?.pinned.length ?? 0} pinned`
             : effective === 'auto' ? 'auto-matched'
             : 'none'}
          </span>
        </div>
        <Link
          to="/master-library/ich-frameworks"
          className="text-[11px] font-semibold text-blue-700 hover:underline"
        >
          Manage in ICH Frameworks →
        </Link>
      </header>

      {/* Current resolver view — what the drafter sees right now. */}
      <div className="mb-2 flex flex-wrap gap-1.5 text-[11px]">
        {(resolved?.pinned ?? []).map(f => (
          <span key={`p-${f.name}`} className="rounded border border-indigo-300 bg-indigo-50 px-2 py-0.5 text-indigo-800">
            Pinned · {f.name} <span className="font-mono text-slate-500">{f.version}</span>
          </span>
        ))}
        {(resolved?.auto ?? []).map(f => (
          <span key={`a-${f.name}`} className="rounded border border-sky-300 bg-sky-50 px-2 py-0.5 text-sky-800">
            Auto · {f.name} <span className="font-mono text-slate-500">{f.version}</span>
          </span>
        ))}
        {effective === 'none' && (
          <span className="text-slate-500 italic">No framework resolves yet.</span>
        )}
      </div>

      <div className="mb-2 flex items-center justify-between">
        <p className="text-[12px] font-semibold text-slate-800">Pin frameworks</p>
        <p className="text-[11px] text-slate-500">
          Select every ICH guideline that applies — the drafter cites all of them.
        </p>
      </div>
      {frameworksQ.isLoading && (
        <p className="text-[11px] italic text-slate-500">Loading frameworks…</p>
      )}
      {frameworksQ.isError && (
        <p className="text-[11px] text-rose-700">Could not load frameworks — try refreshing.</p>
      )}
      {!frameworksQ.isLoading && options.length === 0 && (
        <p className="text-[11px] text-slate-500">
          No ICH frameworks exist yet. Use <Link to="/master-library/ich-frameworks" className="font-semibold text-blue-700 hover:underline">Manage in ICH Frameworks</Link> to add one.
        </p>
      )}
      {options.length > 0 && (
        <ul className="max-h-48 overflow-y-auto rounded border border-slate-200 bg-white">
          {options.map(f => {
            const checked = picked.includes(f.code)
            return (
              <li key={f.id} className="flex items-start gap-2 border-b border-slate-100 px-3 py-1.5 last:border-b-0 text-[12px]">
                <input
                  type="checkbox"
                  className="mt-0.5 h-3.5 w-3.5 flex-none cursor-pointer accent-blue-600"
                  checked={checked}
                  onChange={e => toggle(f.code, e.currentTarget.checked)}
                  data-ich-option={f.code}
                />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-slate-800">{f.code}</p>
                  <p className="text-[11px] text-slate-500">
                    {f.name !== f.code && <>{f.name} · </>}
                    {f.issuer} · v{f.version}
                  </p>
                </div>
              </li>
            )
          })}
        </ul>
      )}
      <div className="mt-2 flex items-center justify-end gap-2">
        {dirty && (
          <button
            type="button"
            onClick={() => setPicked(current)}
            disabled={saving}
            className="rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            data-action="reset-ich"
          >
            Reset
          </button>
        )}
        <button
          type="button"
          onClick={() => onSave(picked)}
          disabled={!dirty || saving}
          className="rounded-md border border-blue-600 bg-blue-600 px-3 py-1 text-[11px] font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          data-action="save-ich-pins"
        >
          {saving ? 'Saving…' : 'Save pins'}
        </button>
      </div>
    </section>
  )
}

function AssociationRow({
  label, state, summary, detail, manageTo, manageLabel, children,
}: {
  label:       string
  state:       'approved' | 'legacy' | 'auto' | 'pinned' | 'missing'
  summary:     string
  detail:      string | null
  manageTo:    string | null
  manageLabel: string | null
  children?:   React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const palette: Record<typeof state, string> = {
    approved: 'border-emerald-200 bg-emerald-50/40',
    legacy:   'border-amber-200 bg-amber-50/40',
    auto:     'border-sky-200 bg-sky-50/40',
    pinned:   'border-indigo-200 bg-indigo-50/40',
    missing:  'border-slate-200 bg-white',
  } as const
  return (
    <section className={`rounded-md border ${palette[state]} p-3`} data-assoc={label}>
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-600">
            {label}
          </p>
          <Chip state={state} label={state} />
        </div>
        <div className="flex items-center gap-2">
          {detail && (
            <button
              type="button"
              onClick={() => setOpen(v => !v)}
              className="rounded-md border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
              data-action={`toggle-${label}`}
              aria-expanded={open}
            >
              {open ? 'Hide' : 'Show'}
            </button>
          )}
          {manageTo && manageLabel && (
            <Link
              to={manageTo}
              className="rounded-md border border-blue-600 bg-white px-2 py-0.5 text-[11px] font-semibold text-blue-700 hover:bg-blue-50"
              data-action={`manage-${label}`}
            >
              {manageLabel} →
            </Link>
          )}
        </div>
      </header>
      <p className="mt-1 text-[12px] text-slate-700">{summary}</p>
      {open && detail && (
        <pre className="mt-2 max-h-56 overflow-auto rounded border border-slate-200 bg-white p-2 font-mono text-[11px] leading-relaxed text-slate-800">
          {detail}
        </pre>
      )}
      {children}
    </section>
  )
}

// ---- BP section (upload + draft approval) -------------------------------
// BP digests don't have their own admin tab yet — upload + draft approval
// still live inside the Policy slide panel. Previously this block + the
// giant SME-prompt / section-rules editor crowded the main policy screen;
// confining it to the detail panel is the point of the redesign.

function BpSection({
  docType, aiReady, onChanged,
}: {
  docType:   string
  aiReady:   boolean
  onChanged: () => void
}) {
  const qc = useQueryClient()
  const versionsQ = useQuery({
    queryKey: ['bp-versions', docType],
    queryFn:  () => platformApi.listBestPracticeVersions(docType),
    refetchInterval: 5_000,
  })
  const versions = versionsQ.data?.versions ?? []
  const draft    = versions.find(v => v.status === 'draft')
  const approved = versions.find(v => v.status === 'approved')

  const [previewOpen, setPreviewOpen] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const [localInfo,  setLocalInfo]  = useState<string | null>(null)

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['bp-versions', docType] })
    onChanged()
  }
  // BP distillation retired (M-F.1) — Section Templates now carry the AI
  // formatting rules.
  void platformApi.distillBestPracticeFile

  const approve = useMutation({
    mutationFn: () => platformApi.approveBestPractice(draft!.id),
    onSuccess:  () => { setLocalInfo('Draft approved — AI starts using it for new documents immediately.'); setLocalError(null); invalidate() },
    onError:    (err: unknown) => { setLocalError(errMessage(err, 'Approve failed')); setLocalInfo(null) },
  })

  const discard = useMutation({
    mutationFn: () => platformApi.retireBestPractice(draft!.id, 'Draft discarded by admin'),
    onSuccess:  () => { setLocalInfo('Draft discarded. The approved version is unaffected.'); setLocalError(null); invalidate() },
    onError:    (err: unknown) => { setLocalError(errMessage(err, 'Discard failed')); setLocalInfo(null) },
  })

  return (
    <div className="mt-2 flex flex-col gap-2" data-bp-section>
      <div className="flex flex-col gap-1 rounded-md border border-slate-200 bg-slate-50 p-3 text-[11px] text-slate-600" data-bp-upload="retired">
        <p className="font-medium text-slate-700">BP distillation retired</p>
        <p>
          BP is author guidance now, not AI steering. Formatting hints flow through
          Master Library &rarr; <strong>Section Templates</strong> instead. Existing approved digests
          stay available for authors; new BP distillations are no longer enqueued.
        </p>
      </div>

      {draft && (
        <div className="flex flex-col gap-2 rounded-md border border-amber-300 bg-amber-50 p-3" data-bp-draft={draft.id}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="rounded bg-amber-100 px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase text-amber-900">
                Pending draft v{draft.version}
              </span>
              <span className="font-mono text-[10px] text-slate-600">
                {draft.digest?.principles?.length ?? 0} principle{(draft.digest?.principles?.length ?? 0) === 1 ? '' : 's'}
                {draft.distilledAt ? ` · parsed ${new Date(draft.distilledAt).toLocaleString()}` : ''}
                {draft.distilledModel ? ` · model ${draft.distilledModel}` : ''}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPreviewOpen(v => !v)}
                className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                data-action="toggle-bp-draft-preview"
              >
                {previewOpen ? 'Hide draft' : 'Preview draft'}
              </button>
              <button
                type="button"
                onClick={() => { if (confirm(`Discard draft v${draft.version}? The approved version is unaffected.`)) discard.mutate() }}
                disabled={discard.isPending}
                className="rounded-md border border-rose-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                data-action="discard-bp-draft"
              >
                {discard.isPending ? 'Discarding…' : 'Discard'}
              </button>
              <button
                type="button"
                onClick={() => approve.mutate()}
                disabled={approve.isPending || !aiReady}
                title={!aiReady ? 'AI is not set up — configure an AI engine first.' : undefined}
                className="rounded-md border border-emerald-600 bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                data-action="approve-bp-draft"
              >
                {approve.isPending
                  ? 'Approving…'
                  : approved ? `Approve (retires v${approved.version})` : 'Approve'}
              </button>
            </div>
          </div>
          <p className="text-[11px] text-amber-900">
            AI still reads the approved version
            {approved ? ` (v${approved.version})` : ' (legacy policy field)'} until you approve this draft.
          </p>
          {previewOpen && <DigestPreview digest={draft.digest as unknown as BestPracticeDigest} />}
        </div>
      )}

      {localError && <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700">{localError}</p>}
      {localInfo  && <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] text-emerald-800">{localInfo}</p>}
    </div>
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
  const [docType, setDocType] = useState('')
  const [error,   setError]   = useState<string | null>(null)

  // Doc-type catalogue — the same source the New Document wizard uses so
  // the two surfaces can never drift. Filter out doc types that already
  // have a policy.
  const templatesQ = useQuery<DocumentTemplate[]>({
    queryKey: ['document-templates'],
    queryFn:  () => documentsApi.listTemplates(),
    staleTime: 5 * 60_000,
    retry: false,
  })
  const takenSet = useMemo(() => new Set(taken), [taken])
  const options  = useMemo(
    () => (templatesQ.data ?? []).filter(t => !takenSet.has(t.type)),
    [templatesQ.data, takenSet],
  )

  const create = useMutation({
    mutationFn: () => platformApi.createDocumentTypePolicy({ docType }),
    onSuccess: (row) => { setError(null); onCreated(row.docType) },
    onError:   (err: unknown) => setError(errMessage(err, 'Create failed')),
  })

  return (
    <div className="flex h-full flex-col gap-3 p-4" data-new-policy>
      <p className="text-[12px] text-slate-500">
        Anchor a doc type in the system so authors can create documents of that kind. The policy
        auto-links to the latest approved AI prompt, template, and checklist for this doc type —
        no manual wiring needed. Manage those assets from their own tabs.
      </p>
      {error && <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700">{error}</p>}
      <label className="flex flex-col gap-1">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Doc type</span>
        <select
          value={docType}
          onChange={e => setDocType(e.currentTarget.value)}
          className="h-9 rounded-md border border-slate-300 bg-white px-3 text-[13px]"
          data-field="create-doc-type"
          disabled={templatesQ.isLoading}
        >
          <option value="">{templatesQ.isLoading ? 'Loading doc types…' : 'Select a doc type…'}</option>
          {options.map(t => (
            <option key={t.type} value={t.type}>{t.label}</option>
          ))}
        </select>
        {!templatesQ.isLoading && options.length === 0 && (
          <p className="text-[11px] text-slate-500">Every doc type already has a policy. Retire one first to re-anchor it.</p>
        )}
      </label>
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
          disabled={create.isPending || !docType || !aiReady}
          title={!aiReady ? 'AI is not set up — configure an AI engine first.' : undefined}
          className="rounded-md border border-blue-600 bg-blue-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          data-action="create-policy"
        >
          {create.isPending ? 'Creating…' : 'Create policy'}
        </button>
      </div>
    </div>
  )
}

// ---- BP preview helper (re-used) ---------------------------------------
// Compact render of a BestPracticeDigest. The admin reviews the parsed
// principles grouped by scope before clicking Approve.

function DigestPreview({ digest }: { digest: BestPracticeDigest }) {
  const principles = digest.principles ?? []
  if (principles.length === 0) {
    return <p className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-3 text-center text-[12px] italic text-slate-500">No principles in this digest.</p>
  }
  const bySection = new Map<string, typeof principles>()
  for (const p of principles) {
    const key = p.scope || 'whole-doc'
    const bucket = bySection.get(key) ?? []
    bucket.push(p)
    bySection.set(key, bucket)
  }
  const keys = Array.from(bySection.keys()).sort((a, b) => {
    if (a === 'whole-doc') return -1
    if (b === 'whole-doc') return 1
    return a.localeCompare(b)
  })
  return (
    <ul className="flex flex-col gap-2" data-digest-preview>
      {keys.map(key => (
        <li key={key} className="rounded-md border border-slate-200 bg-white p-2">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-600">{key}</p>
          <ul className="mt-1 space-y-1 text-[12px]">
            {bySection.get(key)!.map((p, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[9px] uppercase ${
                  p.severity === 'must'   ? 'bg-rose-100 text-rose-800' :
                  p.severity === 'should' ? 'bg-amber-100 text-amber-800' :
                                             'bg-slate-100 text-slate-700'
                }`}>{p.severity}</span>
                <span className="text-slate-800">{p.text}</span>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  )
}

// BP removed from the admin UI — functions retained as read-only legacy for a potential future re-introduction.
void ChipBp; void BpSection;
