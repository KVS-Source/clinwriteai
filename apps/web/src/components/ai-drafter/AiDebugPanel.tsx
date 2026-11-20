// AI draft debug panel — opened from the document editor header.
//
// Renders GET /documents/:id/ai-debug as a verbose natural-language
// narrative: what the AI is working on, what it found, what went wrong,
// in plain English so authors + support can analyse without reading
// raw JSON. The structured snapshot stays reachable under an "Advanced
// — raw JSON" disclosure for bug reports.
//
// Sections (top → bottom):
//   1. Status card — one-line state + confidence
//   2. Setup — what AI is configured with (policy, prompt, sources, template)
//   3. Timeline — audit + pass events as narrative lines, newest first
//   4. Sections below target — flagged rows that still need work
//   5. Issues to investigate — actionable summary
//   6. Advanced: raw JSON — collapsed, Copy-to-clipboard

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { aiDrafterApi } from '../../api/ai-drafter'
import { ApiError } from '../../api/client'

interface Props {
  documentId: string
  open:       boolean
  onClose:    () => void
}

// ---- Loose shape of the /ai-debug response -----------------------------

interface DebugSection {
  sectionId: string; sectionNumber: string; sectionTitle: string
  aiConfidence: number | null; aiFlags?: string[]
  aiSuggestCount?: number
  lastAiAt?: string | null; lastAiModel?: string | null; lastAiIntent?: string | null
  lastEditedAt?: string | null
  wordCount?: number
}

interface DebugSource {
  uploadId: string; title?: string | null; fileName?: string
  contentType?: string | null
  willDrop?: boolean; dropReason?: string | null; dropDetail?: string | null
  linkedAt?: string
}

interface DebugPass {
  passNumber?: number
  startedAt?: string | null
  finishedAt?: string | null
  sectionsFlagged?: number | null
  confidenceAfter?: number | null
  modelUsed?: string | null
}

interface DebugAudit {
  auditId?:  string
  action:    string
  actorId?:  string
  timestamp: string
  details?:  Record<string, unknown>
}

interface DebugData {
  snapshotTakenAt?: string
  aiStubMode?:      boolean
  document?: {
    id?: string; type?: string; title?: string; status?: string
    aiDraftState?: string | null
    aiInstructions?: string | null
    aiConfidenceOverall?: number | null
    aiLastPassNumber?: number | null
    aiLastPassAt?: string | null
    createdAt?: string; updatedAt?: string
  }
  policy?: {
    pinnedVersionAtCreate?: number | null
    current?: {
      version?: number; isCurrent?: boolean
      smePromptChars?: number; sectionRuleGroupCount?: number
      templateId?: string | null; checklistTemplateId?: string | null
      guidelineKey?: string | null
    } | null
  }
  aiPromptRecord?:    { version?: number; status?: string; smePromptChars?: number } | null
  bestPracticeRecord?: { version?: number; status?: string; principleCount?: number } | null
  template?:          { label?: string; type?: string; sectionCount?: number } | null
  // Server wraps the source items inside a sources object with counters —
  // NOT a plain array. The field we want to filter + render is
  // `data.sources.items`.
  sources?: {
    totalLinked?:      number
    usableByDrafter?:  number
    droppedByDrafter?: number
    nonPdfDropped?:    number
    items?:            DebugSource[]
  }
  sections?:          DebugSection[]
  draftingPasses?:    DebugPass[]
  // Per-section AI drafting traces (migration 98) — one entry per commit
  // the drafter made, newest first. Grouped by sectionId in the UI so
  // writers can expand a section and see every source that was in
  // Claude's context when that section was produced.
  sectionDraftTraces?: DebugSectionTrace[]
  auditTail?:         DebugAudit[]
}

interface DebugSectionTrace {
  id:              string
  sectionId:       string
  sectionNumber:   string
  sectionTitle:    string
  model:           string
  sourceIds:       string[]
  sourceTitles:    string[]
  promptCharCount: number
  outputCharCount: number
  draftedAt:       string
}

// ---- Human-readable label tables ---------------------------------------

const ACTION_LABELS: Record<string, string> = {
  ai_initial_draft_enqueued:    'Initial draft enqueued',
  ai_initial_draft_skipped:     'Initial draft skipped',
  ai_initial_draft_completed:   'Initial draft completed',
  ai_validation_pass_completed: 'Validation pass completed',
  ai_validation_pass_skipped:   'Validation pass skipped',
  ai_suggestion_requested:      'Section AI rewrite requested',
  ai_prompt_undone:             'Section AI rewrite reverted',
  section_marked_complete:      'Section marked complete',
  section_reverted:             'Section reverted',
  section_lock_acquired:        'Section opened for editing',
  section_lock_stolen:          'Section lock taken over',
  section_lock_force_released:  'Section lock force-released',
}

const FLAG_LABELS: Record<string, string> = {
  'completeness:too_short':   'Section body is too short',
  'ai:self_critique':         'AI self-critique raised a concern',
  'ai:template_mismatch':     'Does not match the template structure',
  'ai:coherence_issue':       'Internal consistency problem',
  'ai:unsupported_claim':     'Claim not supported by attached sources',
}

const DROP_REASON_LABELS: Record<string, string> = {
  not_pdf:              'Not a PDF (the drafter only reads PDFs)',
  exceeds_cap:          'File too large to attach to the model',
  status_not_confirmed: 'Upload status is not confirmed yet',
  virus_scan_failed:    'Virus scan failed',
  upload_not_found:     'Upload record is missing',
}

const STATE_META: Record<string, { label: string; chip: string; dot: string }> = {
  not_started: { label: 'No draft started yet',  chip: 'bg-slate-50 text-slate-700', dot: 'bg-slate-400' },
  drafting:    { label: 'Drafting in progress',   chip: 'bg-sky-50 text-sky-900',     dot: 'bg-sky-500'  },
  validating:  { label: 'Validating in progress', chip: 'bg-amber-50 text-amber-900', dot: 'bg-amber-500' },
  complete:    { label: 'Draft complete',         chip: 'bg-emerald-50 text-emerald-900', dot: 'bg-emerald-500' },
  failed:      { label: 'Draft failed',           chip: 'bg-rose-50 text-rose-900',   dot: 'bg-rose-500' },
}

// ---- Time helpers -------------------------------------------------------

function relative(iso?: string | null): string {
  if (!iso) return 'unknown'
  const then = new Date(iso).getTime()
  const now  = Date.now()
  const s    = Math.max(0, Math.round((now - then) / 1000))
  if (s < 10)         return 'just now'
  if (s < 60)         return `${s}s ago`
  if (s < 3_600)      return `${Math.round(s / 60)} min ago`
  if (s < 86_400)     return `${Math.round(s / 3_600)} hr ago`
  return `${Math.round(s / 86_400)} day${Math.round(s / 86_400) === 1 ? '' : 's'} ago`
}

function errMessage(err: unknown, fallback = 'Request failed'): string {
  if (err instanceof ApiError) {
    const body = err.body as { message?: string; error?: string } | null
    if (body?.message) return body.message
    if (body?.error)   return body.error
    return String(err.status)
  }
  return err instanceof Error ? err.message : fallback
}

// ---- Narrative line builders -------------------------------------------

/** Turn an audit event's action + details into a 1-2 line narrative. */
function narrateAudit(e: DebugAudit): { line: string; detail?: string } {
  const details = (e.details ?? {}) as Record<string, unknown>
  switch (e.action) {
    case 'ai_initial_draft_completed': {
      const sections = typeof details.sectionsDrafted === 'number' ? details.sectionsDrafted : null
      const engine   = typeof details.engine === 'string' ? details.engine : null
      return {
        line: `Initial draft completed${sections !== null ? ` for ${sections} section${sections === 1 ? '' : 's'}` : ''}.`,
        detail: engine ? `Engine: ${engine}` : undefined,
      }
    }
    case 'ai_initial_draft_enqueued': {
      const target = typeof details.sectionsTarget === 'number' ? details.sectionsTarget : null
      return {
        line: `Initial draft enqueued${target !== null ? ` for ${target} section${target === 1 ? '' : 's'}` : ''}.`,
      }
    }
    case 'ai_initial_draft_skipped': {
      const reason = typeof details.reason === 'string' ? details.reason : 'unknown reason'
      return { line: `Initial draft skipped — ${reason}.` }
    }
    case 'ai_validation_pass_completed': {
      const n           = typeof details.iteration === 'number' ? details.iteration : null
      const confidence  = typeof details.overallConfidence === 'number' ? details.overallConfidence : null
      const failing     = typeof details.sectionsFailing === 'number' ? details.sectionsFailing : null
      const parts: string[] = []
      if (n !== null)           parts.push(`pass ${n}`)
      if (confidence !== null)  parts.push(`${confidence}% overall`)
      if (failing !== null)     parts.push(`${failing} section${failing === 1 ? '' : 's'} still below target`)
      return { line: `Validation pass completed${parts.length ? ` — ${parts.join(' · ')}` : ''}.` }
    }
    case 'ai_suggestion_requested': {
      const intent  = typeof details.intent === 'string' ? details.intent : 'rewrite'
      const section = typeof details.sectionId === 'string' ? details.sectionId : null
      const scope   = typeof details.scope === 'string' ? details.scope : null
      return {
        line: `Section AI ${intent}${section ? ` on §${section}` : ''}${scope ? ` (${scope})` : ''}.`,
      }
    }
    case 'section_lock_stolen': {
      const section = typeof details.sectionId === 'string' ? details.sectionId : null
      return { line: `Section lock taken over${section ? ` on §${section}` : ''}.` }
    }
    case 'section_lock_force_released': {
      const section = typeof details.sectionId === 'string' ? details.sectionId : null
      return { line: `Section lock force-released${section ? ` on §${section}` : ''}.` }
    }
    case 'section_marked_complete':
    case 'section_reverted': {
      const section = typeof details.sectionId === 'string' ? details.sectionId : null
      const label   = e.action === 'section_marked_complete' ? 'Section marked complete' : 'Section reverted'
      return { line: `${label}${section ? ` on §${section}` : ''}.` }
    }
    default: {
      // Generic fallback uses the humanised action name.
      return { line: ACTION_LABELS[e.action] ?? e.action.replace(/_/g, ' ') + '.' }
    }
  }
}

/** Format a flag code to a human sentence. */
function flagLabel(flag: string): string {
  return FLAG_LABELS[flag] ?? flag
}

// ---- Component ----------------------------------------------------------

export function AiDebugPanel({ documentId, open, onClose }: Props) {
  const { data, isLoading, error, refetch, isFetching } = useQuery<DebugData>({
    queryKey: ['ai-debug', documentId],
    queryFn:  () => aiDrafterApi.debug(documentId) as Promise<DebugData>,
    enabled:  open,
  })
  const [copied, setCopied]   = useState(false)
  const [showRaw, setShowRaw] = useState(false)

  const prettyJson = data ? JSON.stringify(data, null, 2) : ''

  const onCopy = async () => {
    if (!prettyJson) return
    try {
      await navigator.clipboard.writeText(prettyJson)
      setCopied(true); setTimeout(() => setCopied(false), 1800)
    } catch {
      const el = document.querySelector<HTMLTextAreaElement>('[data-ai-debug-json]')
      el?.focus(); el?.select()
    }
  }

  // Computed views over the raw data. Array.isArray guards are belt-and-
  // braces: if the server ever reshapes any of these into a non-array
  // (as `sources` is today — it's an object wrapper with items[]), a
  // plain `?? []` fallback does nothing and the first `.filter` throws
  // "h.filter is not a function".
  const sections = useMemo<DebugSection[]>(
    () => (Array.isArray(data?.sections) ? data.sections : []),
    [data],
  )
  const sources = useMemo<DebugSource[]>(
    () => (Array.isArray(data?.sources?.items) ? data.sources.items : []),
    [data],
  )
  // passes (DebugPass[]) is in the response but not rendered yet — the
  // timeline derives everything from auditTail today. Kept as a type
  // for forward compatibility; drop the useMemo until a consumer needs it.
  const audits = useMemo<DebugAudit[]>(
    () => (Array.isArray(data?.auditTail) ? data.auditTail : []),
    [data],
  )

  const sectionsBelow = useMemo(
    () => sections.filter(s => typeof s.aiConfidence === 'number' && s.aiConfidence < 85)
                  .sort((a, b) => (a.aiConfidence ?? 0) - (b.aiConfidence ?? 0)),
    [sections],
  )
  const droppedSources = useMemo(() => sources.filter(s => s.willDrop), [sources])
  const sectionsWithFlags = useMemo(() => sections.filter(s => (s.aiFlags?.length ?? 0) > 0), [sections])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end"
      role="dialog"
      aria-label="AI debug panel"
      data-ai-debug-panel
    >
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} data-ai-debug-backdrop />
      <aside
        className="relative flex h-full w-[720px] max-w-[95vw] flex-col bg-white shadow-2xl"
        style={{ borderLeft: '1px solid #E2E8F0' }}
      >
        {/* Header */}
        <header className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div className="min-w-0">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">
              AI draft debug
            </p>
            <h2 className="mt-1 truncate text-[16px] font-semibold text-slate-900">
              {data?.document?.title ?? `Document ${documentId.slice(0, 10)}…`}
            </h2>
            <p className="mt-0.5 font-mono text-[11px] text-slate-500">
              {documentId}{data?.snapshotTakenAt ? ` · snapshot ${relative(data.snapshotTakenAt)}` : ''}
            </p>
          </div>
          <div className="flex flex-none items-center gap-1.5">
            <button
              type="button"
              onClick={() => refetch()}
              disabled={isFetching}
              className="rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              data-action="refresh-ai-debug"
            >
              {isFetching ? 'Refreshing…' : 'Refresh'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
              data-action="close-ai-debug"
              aria-label="Close debug panel"
            >
              ✕
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-auto bg-slate-50">
          {isLoading && <p className="p-5 text-[13px] text-slate-500">Loading snapshot…</p>}
          {error && (
            <p className="p-5 text-[13px] text-rose-700">
              Could not load debug snapshot: {errMessage(error, 'request failed')}
            </p>
          )}

          {data && (
            <div className="flex flex-col gap-4 p-5">

              {/* STATUS CARD */}
              <StatusCard data={data} sectionsBelow={sectionsBelow.length} />

              {/* SETUP */}
              <Section title="Setup">
                <SetupList data={data} droppedSources={droppedSources} />
              </Section>

              {/* TIMELINE */}
              <Section title="Timeline (newest first)">
                {audits.length === 0 && (
                  <p className="text-[12px] text-slate-500">No AI activity recorded yet.</p>
                )}
                {audits.length > 0 && (
                  <ul className="flex flex-col gap-2">
                    {audits.map((e, i) => {
                      const { line, detail } = narrateAudit(e)
                      return (
                        <li key={e.auditId ?? String(i)} className="flex items-start gap-3 text-[12px]" title={e.timestamp}>
                          <span className="mt-0.5 flex-none font-mono text-[10px] text-slate-500 w-[72px]">
                            {relative(e.timestamp)}
                          </span>
                          <div className="min-w-0">
                            <p className="text-slate-800">{line}</p>
                            {detail && <p className="mt-0.5 font-mono text-[10px] text-slate-500">{detail}</p>}
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </Section>

              {/* SECTIONS BELOW TARGET */}
              {sectionsBelow.length > 0 && (
                <Section title={`Sections below 85% confidence (${sectionsBelow.length})`}>
                  <ul className="flex flex-col gap-1.5">
                    {sectionsBelow.map(s => (
                      <li key={s.sectionId} className="rounded border border-amber-200 bg-amber-50/60 px-3 py-1.5 text-[12px]">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-amber-900">§{s.sectionNumber} {s.sectionTitle}</span>
                          <span className="font-mono text-[11px] text-amber-900">{s.aiConfidence}%</span>
                        </div>
                        {(s.aiFlags?.length ?? 0) > 0 && (
                          <ul className="mt-1 ml-2 list-disc text-[11px] text-amber-800">
                            {(s.aiFlags ?? []).map(f => <li key={f}>{flagLabel(f)}</li>)}
                          </ul>
                        )}
                      </li>
                    ))}
                  </ul>
                </Section>
              )}

              {/* PER-SECTION DRAFTING TRACE */}
              {(data.sectionDraftTraces?.length ?? 0) > 0 && (
                <Section title={`Per-section drafting trace (${data.sectionDraftTraces!.length} commits)`}>
                  <p className="mb-3 text-[11px] text-slate-500">
                    What the drafter was looking at each time it committed a section. Expand a section to see every commit, which source documents were in the model&rsquo;s context, and how big the prompt + output were.
                  </p>
                  <SectionDraftTraceList traces={data.sectionDraftTraces!} />
                </Section>
              )}

              {/* ISSUES TO INVESTIGATE */}
              <IssuesPanel
                stubMode={!!data.aiStubMode}
                droppedSources={droppedSources}
                sectionsBelow={sectionsBelow.length}
                sectionsWithFlags={sectionsWithFlags.length}
                sectionsTotal={sections.length}
              />

              {/* ADVANCED — RAW JSON */}
              <details
                className="rounded border border-slate-200 bg-white"
                open={showRaw}
                onToggle={e => setShowRaw((e.target as HTMLDetailsElement).open)}
              >
                <summary className="cursor-pointer select-none px-3 py-2 text-[12px] font-semibold text-slate-700">
                  Advanced — raw JSON (for support bug reports)
                </summary>
                <div className="border-t border-slate-200 bg-slate-900 p-3">
                  <button
                    type="button"
                    onClick={onCopy}
                    disabled={!data}
                    className="mb-2 inline-flex items-center gap-1.5 rounded-md border border-slate-500 bg-slate-800 px-2 py-0.5 text-[10px] font-semibold text-white hover:bg-slate-700"
                    data-action="copy-ai-debug"
                  >
                    {copied ? 'Copied!' : 'Copy JSON'}
                  </button>
                  <pre
                    className="whitespace-pre-wrap break-words font-mono text-[10px] leading-relaxed text-slate-100"
                    data-ai-debug-json
                  >{prettyJson}</pre>
                </div>
              </details>
            </div>
          )}
        </div>
      </aside>
    </div>
  )
}

// ---- Sub-components ----------------------------------------------------

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">{title}</h3>
      {children}
    </section>
  )
}

function StatusCard({ data, sectionsBelow }: { data: DebugData; sectionsBelow: number }) {
  const state  = data.document?.aiDraftState ?? 'not_started'
  const meta   = STATE_META[state] ?? STATE_META.not_started!
  const overall = data.document?.aiConfidenceOverall
  const lastPassNumber = data.document?.aiLastPassNumber
  const sectionsTotal  = data.sections?.length ?? 0
  return (
    <section className={`rounded-lg px-4 py-3 ${meta.chip}`}>
      <div className="flex items-center gap-2">
        <span className={`inline-block h-2 w-2 rounded-full ${meta.dot}`} />
        <p className="text-[14px] font-semibold">{meta.label}</p>
      </div>
      <p className="mt-1 text-[12px] opacity-90">
        {typeof overall === 'number' ? <>Overall confidence <strong>{overall}%</strong></> : 'No confidence score yet'}
        {typeof lastPassNumber === 'number' && <> · last pass {lastPassNumber}</>}
        {sectionsTotal > 0 && <> · {sectionsTotal} section{sectionsTotal === 1 ? '' : 's'}</>}
        {sectionsBelow > 0 && <> · <strong>{sectionsBelow}</strong> still below 85%</>}
        {data.aiStubMode && <> · <span className="font-semibold">stub mode (no API key)</span></>}
      </p>
    </section>
  )
}

function SetupList({ data, droppedSources }: { data: DebugData; droppedSources: DebugSource[] }) {
  const policyVersion  = data.policy?.pinnedVersionAtCreate ?? data.policy?.current?.version
  const policyPinned   = data.policy?.pinnedVersionAtCreate !== null && data.policy?.pinnedVersionAtCreate !== undefined
  const promptVersion  = data.aiPromptRecord?.version
  const promptChars    = data.aiPromptRecord?.smePromptChars
  const bpVersion      = data.bestPracticeRecord?.version
  const bpPrinciples   = data.bestPracticeRecord?.principleCount
  const templateLabel  = data.template?.label ?? data.template?.type
  const templateCount  = data.template?.sectionCount
  const totalSources   = data.sources?.totalLinked ?? data.sources?.items?.length ?? 0
  const usableSources  = data.sources?.usableByDrafter ?? 0
  const droppedCount   = data.sources?.droppedByDrafter ?? droppedSources.length
  return (
    <ul className="flex flex-col gap-1.5 text-[12px] text-slate-700">
      {policyVersion !== undefined && (
        <li>
          <span className="text-slate-500">Policy:</span> <strong>v{policyVersion}</strong>
          {policyPinned ? ' (pinned at document create)' : ' (current)'}
        </li>
      )}
      {promptVersion !== undefined && (
        <li>
          <span className="text-slate-500">SME prompt:</span> AiPromptRecord v{promptVersion}
          {typeof promptChars === 'number' && <> · {promptChars.toLocaleString()} chars</>}
        </li>
      )}
      {bpVersion !== undefined && (
        <li>
          <span className="text-slate-500">Best-practice digest:</span> v{bpVersion}
          {typeof bpPrinciples === 'number' && <> · {bpPrinciples} principle{bpPrinciples === 1 ? '' : 's'}</>}
          <span className="ml-1 text-slate-400">(author guidance only — retired as AI steering)</span>
        </li>
      )}
      {templateLabel && (
        <li>
          <span className="text-slate-500">Template:</span> {templateLabel}
          {typeof templateCount === 'number' && <> · {templateCount} section{templateCount === 1 ? '' : 's'}</>}
        </li>
      )}
      <li>
        <span className="text-slate-500">Sources:</span> {totalSources} attached
        {usableSources > 0 && <> · {usableSources} usable</>}
        {droppedCount > 0 && <> · <span className="text-amber-700">{droppedCount} dropped</span></>}
      </li>
      {droppedSources.length > 0 && (
        <li className="ml-4">
          <ul className="list-disc text-[11px] text-amber-800">
            {droppedSources.map(s => (
              <li key={s.uploadId}>
                <span className="font-mono">{s.title ?? s.fileName ?? s.uploadId}</span>
                {' — '}
                {DROP_REASON_LABELS[s.dropReason ?? ''] ?? s.dropReason ?? 'unknown reason'}
              </li>
            ))}
          </ul>
        </li>
      )}
    </ul>
  )
}

function IssuesPanel(props: {
  stubMode: boolean
  droppedSources: DebugSource[]
  sectionsBelow: number
  sectionsWithFlags: number
  sectionsTotal: number
}) {
  const issues: Array<{ severity: 'high' | 'med'; text: string }> = []
  if (props.stubMode)        issues.push({ severity: 'high', text: 'Stub mode is active — no ANTHROPIC_API_KEY set. AI drafts are placeholder text, not real model output.' })
  if (props.droppedSources.length > 0) {
    issues.push({ severity: 'high', text: `${props.droppedSources.length} source${props.droppedSources.length === 1 ? ' was' : 's were'} dropped. The AI never saw their content (see Setup for reasons).` })
  }
  if (props.sectionsBelow > 0) {
    issues.push({
      severity: props.sectionsBelow > props.sectionsTotal / 2 ? 'high' : 'med',
      text: `${props.sectionsBelow} section${props.sectionsBelow === 1 ? '' : 's'} still below the 85% confidence target. Run another validation pass or review flagged items manually.`,
    })
  }
  if (props.sectionsWithFlags > 0 && props.sectionsBelow === 0) {
    issues.push({ severity: 'med', text: `${props.sectionsWithFlags} section${props.sectionsWithFlags === 1 ? ' has' : 's have'} AI flags but are above target — review if the flagged concerns are false positives.` })
  }
  if (issues.length === 0) return null
  return (
    <Section title={`Issues to investigate (${issues.length})`}>
      <ul className="flex flex-col gap-1.5 text-[12px]">
        {issues.map((it, i) => (
          <li
            key={i}
            className={`rounded px-3 py-1.5 ${it.severity === 'high' ? 'border border-rose-200 bg-rose-50 text-rose-900' : 'border border-amber-200 bg-amber-50 text-amber-900'}`}
          >
            {it.text}
          </li>
        ))}
      </ul>
    </Section>
  )
}

// Per-section trace list — groups raw commit rows by sectionId so writers
// can expand a section and see every commit the drafter made for it, along
// with the source documents that were attached each time.
function SectionDraftTraceList({ traces }: { traces: DebugSectionTrace[] }) {
  const [expanded, setExpanded] = useState<string | null>(null)
  const grouped = useMemo(() => {
    const by = new Map<string, DebugSectionTrace[]>()
    for (const t of traces) {
      const arr = by.get(t.sectionId) ?? []
      arr.push(t)
      by.set(t.sectionId, arr)
    }
    // Sort sections by the number-aware compare used elsewhere, keep the
    // per-section list newest-first (the server already sorted DESC by
    // draftedAt so we just slot-in).
    return Array.from(by.entries())
      .map(([sectionId, items]) => ({
        sectionId,
        sectionNumber: items[0]?.sectionNumber ?? '',
        sectionTitle:  items[0]?.sectionTitle  ?? '',
        items,
      }))
      .sort((a, b) => compareSectionNumbers(a.sectionNumber, b.sectionNumber))
  }, [traces])

  return (
    <div className="flex flex-col divide-y divide-slate-100 rounded border border-slate-200 bg-white">
      {grouped.map(g => {
        const isOpen = expanded === g.sectionId
        return (
          <div key={g.sectionId} data-trace-section={g.sectionId}>
            <button
              type="button"
              onClick={() => setExpanded(isOpen ? null : g.sectionId)}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] hover:bg-slate-50"
            >
              <span className="font-semibold text-slate-800">§{g.sectionNumber}</span>
              <span className="flex-1 truncate text-slate-600">{g.sectionTitle}</span>
              <span className="rounded-full bg-slate-100 px-2 text-[10px] font-bold text-slate-600">
                {g.items.length} commit{g.items.length === 1 ? '' : 's'}
              </span>
              <span
                aria-hidden="true"
                className="text-slate-400 transition-transform"
                style={{ transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}
              >▸</span>
            </button>
            {isOpen && (
              <div className="flex flex-col gap-3 bg-slate-50 px-3 pb-3 pt-1">
                {g.items.map(t => (
                  <div key={t.id} className="rounded border border-slate-200 bg-white p-2 text-[11px]">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-700">{t.model}</span>
                      <span className="font-mono text-[10px] text-slate-500">{relative(t.draftedAt)}</span>
                      <span className="ml-auto font-mono text-[10px] text-slate-500">
                        prompt {t.promptCharCount.toLocaleString()} ch · output {t.outputCharCount.toLocaleString()} ch
                      </span>
                    </div>
                    <div className="mt-1.5 text-[10px] font-mono uppercase tracking-wider text-slate-500">
                      Sources in context ({t.sourceTitles.length})
                    </div>
                    {t.sourceTitles.length === 0 ? (
                      <p className="mt-0.5 text-[11px] italic text-slate-500">
                        No source documents were attached to this call.
                      </p>
                    ) : (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {t.sourceTitles.map((title, i) => (
                          <span
                            key={`${t.id}-${i}`}
                            className="rounded border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[11px] text-blue-800"
                            title={t.sourceIds[i] ?? ''}
                          >
                            {title}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

/** Numeric-aware section-number compare — "2.10" > "2.9". */
function compareSectionNumbers(a: string, b: string): number {
  const partsA = a.split('.').map(p => parseInt(p, 10))
  const partsB = b.split('.').map(p => parseInt(p, 10))
  const len = Math.max(partsA.length, partsB.length)
  for (let i = 0; i < len; i++) {
    const ai = Number.isFinite(partsA[i]) ? partsA[i]! : 0
    const bi = Number.isFinite(partsB[i]) ? partsB[i]! : 0
    if (ai !== bi) return ai - bi
  }
  return a.localeCompare(b)
}
