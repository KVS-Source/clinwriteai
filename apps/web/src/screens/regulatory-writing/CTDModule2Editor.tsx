import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import type { ECTDNode, ConsistencyCheckResult, ConsistencyContradiction } from '@platform/types'
import { regulatoryWritingApi } from '../../modules/regulatory-writing/api/regulatoryWriting'
import { useECTDStore } from '../../modules/regulatory-writing/store'
import { ECTDStatusDot, ConsistencyContradictionCard, DataObjectivityFlag } from '../../components/ui'

const FLAGGED_NODE_IDS = new Set<string>(['nd-014', 'nd-018', 'nd-025'])

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  const hh = String(d.getUTCHours()).padStart(2, '0')
  const mm = String(d.getUTCMinutes()).padStart(2, '0')
  return `${hh}:${mm} UTC`
}

interface TabButtonProps { id: string; label: string; active: boolean; onClick: () => void }
function TabButton({ id, label, active, onClick }: TabButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-tab={id}
      data-tab-active={active || undefined}
      className="px-3 py-2 text-[13px]"
      style={{
        borderBottom: `2px solid ${active ? '#B0200D' : 'transparent'}`,
        color:        active ? '#B0200D' : '#64748B',
        fontWeight:   active ? 600 : 500,
      }}
    >{label}</button>
  )
}

export function CTDModule2Editor() {
  const { projectId, submissionId } = useParams()
  const navigate = useNavigate()

  const nodes           = useECTDStore(s => s.nodes)
  const setNodes        = useECTDStore(s => s.setNodes)
  const activeNodeId    = useECTDStore(s => s.activeNodeId)
  const setActiveNodeId = useECTDStore(s => s.setActiveNodeId)

  const [activeTab, setActiveTab]                 = useState<'ai' | 'crossref' | 'consistency' | 'audit'>('ai')
  const [aiFootprintPct, setAiFootprintPct]       = useState(51)
  const [aiSuggestionOpen, setAiSuggestionOpen]   = useState(true)
  const [inlineMessage, setInlineMessage]         = useState<string | null>(null)
  const [consistencyResult, setConsistencyResult] = useState<ConsistencyCheckResult | null>(null)
  const [toast, setToast]                         = useState<string | null>(null)
  const [resolutionDraft, setResolutionDraft]     = useState<Record<string, string>>({})

  const flash = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3000) }

  const { data: fetched = [] } = useQuery({
    queryKey: ['reg-ectd-map', submissionId],
    queryFn:  () => regulatoryWritingApi.getECTDMap(submissionId!),
    enabled:  !!submissionId,
  })
  const { data: fetchedCC } = useQuery({
    queryKey: ['consistency', submissionId],
    queryFn:  () => regulatoryWritingApi.getConsistencyCheck(submissionId!),
    enabled:  !!submissionId,
  })

  useEffect(() => { setNodes(fetched as ECTDNode[]) }, [fetched, setNodes])
  useEffect(() => { if (fetchedCC) setConsistencyResult(fetchedCC as ConsistencyCheckResult) }, [fetchedCC])

  useEffect(() => {
    if (!activeNodeId && nodes.length > 0) {
      setActiveNodeId(nodes.find(n => n.id === 'nd-018')?.id ?? nodes[0].id)
    }
  }, [nodes, activeNodeId, setActiveNodeId])

  const selected = nodes.find(n => n.id === activeNodeId) ?? null

  const unresolvedMajor = useMemo(() => {
    if (!consistencyResult) return 0
    return consistencyResult.contradictions.filter(c => c.severity === 'major' && !c.resolved).length
  }, [consistencyResult])
  const canSubmitSuper = unresolvedMajor === 0

  const runCheckMutation = useMutation({
    mutationFn: () => regulatoryWritingApi.runConsistencyCheck(submissionId!),
    onSuccess:  (data) => { setConsistencyResult(data.result); flash('Consistency check complete.') },
  })

  const aiSuggestMutation = useMutation({
    mutationFn: () => Promise.resolve({ ok: true }),
    onSuccess:  () => { setAiSuggestionOpen(true); flash('AI suggestion refreshed.') },
  })

  const handleNodeNav = (node: ECTDNode) => {
    if (node.isReadOnly) {
      setInlineMessage('Module 5 — read-only · Module A')
      setTimeout(() => setInlineMessage(null), 3200)
      return
    }
    if (node.isSystemGenerated) {
      setInlineMessage('System-generated — not editable')
      setTimeout(() => setInlineMessage(null), 3200)
      return
    }
    setInlineMessage(null)
    setActiveNodeId(node.id)
  }

  const handleAccept = () => {
    setAiFootprintPct(p => Math.min(100, p + 3))
    setAiSuggestionOpen(false)
    flash('Suggestion accepted. AI footprint updated. Logged to audit trail.')
  }
  const handleDiscard = () => {
    setAiSuggestionOpen(false)
    flash('Suggestion discarded. Logged to audit trail.')
  }

  const submitToSuperReview = () => {
    if (!canSubmitSuper) return
    navigate(`/projects/${projectId}/regulatory-writing/submissions/${submissionId}/super-review`)
  }

  const resolveContradiction = (id: string) => {
    const note = resolutionDraft[id]
    if (!note || !note.trim()) { flash('Enter a resolution note first.'); return }
    if (!consistencyResult) return
    const updated: ConsistencyCheckResult = {
      ...consistencyResult,
      contradictions: consistencyResult.contradictions.map(c => c.id === id ? {
        ...c, resolved: true, resolvedBy: 'Dr Sarah Chen', resolvedAt: new Date().toISOString(), resolutionNote: note,
      } : c),
    }
    updated.passed = !updated.contradictions.some(c => c.severity === 'major' && !c.resolved)
    setConsistencyResult(updated)
    flash(`Contradiction ${id} resolved.`)
  }

  return (
    <div className="bg-slate-50" data-screen="ctd-module2-editor">
      <div className="flex flex-col" style={{ maxWidth: 1440, padding: '16px 24px 24px' }}>

        {/* Breadcrumb */}
        <nav className="mb-3 flex items-center gap-2 text-xs text-slate-500">
          <button onClick={() => navigate(`/projects/${projectId}/regulatory-writing`)} className="hover:text-slate-900">Regulatory Writing</button>
          <span style={{ color: '#CBD5E1' }}>&gt;</span>
          <button onClick={() => navigate(`/projects/${projectId}/regulatory-writing/submissions/${submissionId}`)} className="hover:text-slate-900">Veloricept NDA</button>
          <span style={{ color: '#CBD5E1' }}>&gt;</span>
          <span className="font-semibold text-slate-900">CTD Module 2 Editor</span>
        </nav>

        {/* Header bar */}
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3" data-editor-header>
          <span
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-semibold"
            style={{ backgroundColor: '#EFF6FF', color: '#005F8E', border: '1px solid #93C5FD' }}
            data-source-chip
          >
            <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: '#005F8E' }} />
            Drafted from: VELORA-301 CSR v1.0 · Module A
          </span>
          <span
            className="inline-flex items-center rounded-md px-2 py-1 text-[11px] font-semibold"
            style={{ backgroundColor: '#FFF5F5', color: '#B0200D', border: '1px solid #FFC5C5' }}
            data-ai-footprint
          >AI footprint · {aiFootprintPct}% ✦</span>

          <div className="flex-1" />

          <button
            type="button"
            onClick={() => runCheckMutation.mutate()}
            data-run-consistency
            className="h-9 rounded-md px-3 text-[13px] font-semibold text-white"
            style={{ backgroundColor: '#D97706' }}
          >Run consistency check ✦</button>

          <div className="flex flex-none flex-col items-end gap-0.5">
            <button
              type="button"
              onClick={submitToSuperReview}
              disabled={!canSubmitSuper}
              data-submit-super-review
              data-submit-enabled={canSubmitSuper}
              className="h-9 rounded-md px-3 text-[13px] font-semibold text-white"
              style={{ backgroundColor: canSubmitSuper ? '#B0200D' : '#CBD5E1', cursor: canSubmitSuper ? 'pointer' : 'not-allowed' }}
            >Submit for Super Review →</button>
            {!canSubmitSuper && (
              <span className="text-[11px]" style={{ color: '#005F8E' }} data-submit-blocked-reason>
                Resolve {unresolvedMajor} Major contradiction{unresolvedMajor === 1 ? '' : 's'} before Super Review
              </span>
            )}
          </div>
        </div>

        <div className="grid gap-4" style={{ gridTemplateColumns: '240px minmax(0,1fr) 320px' }}>
          {/* LEFT — Section navigator */}
          <aside className="rounded-lg border border-slate-200 bg-white p-3" data-nav>
            <p className="mb-2 font-mono text-[10px] uppercase text-slate-500" style={{ letterSpacing: '0.1em' }}>Module 2 Sections</p>
            <div className="flex flex-col gap-0.5">
              {nodes.filter(n => n.moduleSection.startsWith('2') || n.moduleSection.startsWith('5')).map(n => {
                const active   = activeNodeId === n.id
                const flagged  = FLAGGED_NODE_IDS.has(n.id)
                return (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => handleNodeNav(n)}
                    data-nav-row={n.id}
                    data-nav-active={active || undefined}
                    data-nav-read-only={n.isReadOnly || undefined}
                    data-nav-system-generated={n.isSystemGenerated || undefined}
                    className="flex items-center gap-2 rounded-md px-2 py-1 text-left"
                    style={{
                      backgroundColor: active ? '#FFF5F5' : 'transparent',
                      borderLeft:      active ? '3px solid #B0200D' : '3px solid transparent',
                    }}
                  >
                    <span className="font-mono text-[10px] w-14 text-slate-500 flex-none">{n.moduleSection}</span>
                    <span className="min-w-0 flex-1 truncate text-[12px] text-slate-800">{n.sectionTitle}</span>
                    {n.isSystemGenerated && <span title="System-generated" style={{ color: '#005F8E' }} className="text-[11px]">◉</span>}
                    {flagged && <span data-nav-flag className="text-[11px]" style={{ color: '#B45309' }}>⚠</span>}
                    <ECTDStatusDot status={n.status} />
                    {n.isReadOnly && <span title="Read-only · Module A" className="text-[11px]" style={{ color: '#005F8E' }}>🔒</span>}
                  </button>
                )
              })}
            </div>
            {inlineMessage && (
              <p className="mt-2 rounded-md px-2 py-1 text-[11px]" style={{ backgroundColor: '#EFF6FF', color: '#005F8E', border: '1px solid #93C5FD' }} data-inline-message>
                {inlineMessage}
              </p>
            )}
          </aside>

          {/* CENTRE — Document canvas */}
          <section className="rounded-lg border border-slate-200 bg-white p-6" data-canvas>
            {selected ? (
              <>
                <p className="font-mono text-[11px] uppercase text-slate-500" style={{ letterSpacing: '0.08em' }}>{selected.moduleSection}</p>
                <h2 className="text-[18px] font-bold text-slate-900">{selected.sectionTitle}</h2>

                {/* AI-generated block */}
                <div
                  className="mt-4 rounded-md p-4"
                  style={{ backgroundColor: '#FFF5F5', border: '1px solid #FFC5C5' }}
                  data-block-ai
                >
                  <p className="text-[14px] leading-relaxed text-slate-800">
                    Veloricept plus pembrolizumab demonstrated statistically significant improvement in progression-free survival (hazard ratio{' '}
                    <span
                      className="cursor-help"
                      style={{ textDecoration: 'underline wavy', textDecorationColor: '#D97706', textUnderlineOffset: '3px' }}
                      title="⚠ Consistency flag: Module 5 Table 14.2.1 shows 0.63 in the interim analysis. Verify source version."
                      data-consistency-underline
                    >0.61</span>
                    ; 95% CI 0.48–0.77; p&lt;0.001)
                  </p>
                  <p className="mt-1 flex items-center gap-2">
                    <span
                      className="inline-flex items-center rounded-md px-1.5 py-0.5 font-mono text-[10px]"
                      style={{ backgroundColor: '#FFFFFF', color: '#005F8E', border: '1px solid #93C5FD' }}
                      data-inline-source-citation
                    >CSR v1.0 · Table 14.2.1</span>
                  </p>
                  <p className="mt-3 text-[14px] leading-relaxed text-slate-800">
                    These results establish veloricept as a{' '}
                    <DataObjectivityFlag
                      text="best-in-class"
                      suggestion="Comparative superlative — 'best-in-class' requires substantiated head-to-head evidence. PRD v4.1 §12.4 Rule 1. Suggested: 'These results demonstrate a clinically meaningful improvement in PFS.'"
                    />
                    {' '}treatment option.
                  </p>
                </div>

                {/* Human-authored block */}
                <div className="mt-3 rounded-md bg-white p-4" style={{ border: '1px solid #E2E8F0' }} data-block-human>
                  <p className="text-[14px] leading-relaxed text-slate-800">
                    The clinical benefit was consistent across all pre-specified subgroups including PD-L1 expression and histology (Section 2.7.3.3).
                  </p>
                  <span
                    className="mt-2 inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-semibold"
                    style={{ backgroundColor: '#F0FDF4', color: '#166534' }}
                    data-crossref-verified
                  >→ 2.7.3.3 ✓ verified</span>
                </div>
              </>
            ) : (
              <p className="text-[13px] text-slate-500">Loading section…</p>
            )}
          </section>

          {/* RIGHT — Tabs */}
          <aside className="rounded-lg border border-slate-200 bg-white" data-right-panel>
            <div className="flex border-b border-slate-200 px-2">
              <TabButton id="ai"          label="AI Suggest ✦" active={activeTab === 'ai'}          onClick={() => setActiveTab('ai')} />
              <TabButton id="crossref"    label="Cross-Ref"    active={activeTab === 'crossref'}    onClick={() => setActiveTab('crossref')} />
              <TabButton id="consistency" label="Consistency"  active={activeTab === 'consistency'} onClick={() => setActiveTab('consistency')} />
              <TabButton id="audit"       label="Audit"        active={activeTab === 'audit'}       onClick={() => setActiveTab('audit')} />
            </div>

            <div className="p-3">
              {activeTab === 'ai' && (
                <div data-tab-ai>
                  {aiSuggestionOpen ? (
                    <div className="rounded-md border border-slate-200 bg-slate-50 p-3" data-ai-suggestion>
                      <p className="text-[11px] font-mono uppercase text-slate-500" style={{ letterSpacing: '0.06em' }}>Suggested addition · Section 2.5.5 Safety Overview</p>
                      <p className="mt-1 text-[13px] text-slate-800">
                        &quot;Treatment-emergent adverse events of grade ≥3 occurred in 52% of patients on the veloricept combination arm versus 44% on control.&quot;
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <span className="inline-flex rounded-md px-1.5 py-0.5 font-mono text-[10px]" style={{ backgroundColor: '#FFFFFF', color: '#005F8E', border: '1px solid #93C5FD' }}>CSR v1.0 · §12.2</span>
                        <span className="inline-flex rounded-md px-1.5 py-0.5 font-mono text-[10px]" style={{ backgroundColor: '#FFFFFF', color: '#005F8E', border: '1px solid #93C5FD' }}>SmPC v2.1 · §4.8</span>
                      </div>
                      <p className="mt-2 font-mono text-[10px] text-slate-500">Generated {formatDateTime(new Date().toISOString())} · claude-sonnet-4-6 · Logged to audit trail</p>
                      <div className="mt-3 flex gap-2">
                        <button type="button" onClick={handleAccept} data-accept-ai className="rounded-md px-3 py-1.5 text-[12px] font-semibold text-white" style={{ backgroundColor: '#B0200D' }}>Accept ✓</button>
                        <button type="button" onClick={handleDiscard} data-discard-ai className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-[12px] font-semibold text-slate-700">Discard ✗</button>
                        <button type="button" onClick={() => aiSuggestMutation.mutate()} data-suggest-again className="text-[12px] font-semibold" style={{ color: '#B0200D' }}>Suggest again ✦</button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-[12px] text-slate-500">No pending suggestions. Click Suggest again ✦.</p>
                  )}
                </div>
              )}

              {activeTab === 'crossref' && (
                <div data-tab-crossref>
                  <ul className="flex flex-col gap-1 text-[12px]" data-crossref-list>
                    <li className="rounded-md bg-slate-50 px-2 py-1" style={{ color: '#166534' }}>→ 2.7.3.3 ✓ verified</li>
                    <li className="rounded-md px-2 py-1" style={{ backgroundColor: '#FFFBEB', color: '#B45309', border: '1px solid #FDE68A' }}>→ Module 5 · Table 14.2.1 ⚠ — check version (0.61 vs 0.63)</li>
                    <li className="rounded-md bg-slate-50 px-2 py-1" style={{ color: '#166534' }}>→ Module 5 · Figure 14.2.1-1 ✓ verified</li>
                  </ul>
                  <button type="button" onClick={() => runCheckMutation.mutate()} className="mt-2 text-[12px] font-semibold" style={{ color: '#B0200D' }}>Run full cross-module check ✦</button>
                </div>
              )}

              {activeTab === 'consistency' && (
                <div data-tab-consistency>
                  <p className="font-mono text-[11px] text-slate-500">
                    Last run: {consistencyResult ? new Date(consistencyResult.runAt).toISOString().slice(0,16).replace('T',' ') + ' UTC' : '—'} · {consistencyResult?.contradictions.length ?? 0} contradictions found
                  </p>
                  <div className="mt-2 flex flex-col gap-2">
                    {consistencyResult?.contradictions.map((c: ConsistencyContradiction) => (
                      <div key={c.id} data-consistency-item={c.id}>
                        <ConsistencyContradictionCard contradiction={c} />
                        {!c.resolved && (
                          <div className="mt-1 flex gap-2" data-resolution-form={c.id}>
                            <input
                              type="text"
                              placeholder="Resolution note…"
                              value={resolutionDraft[c.id] ?? ''}
                              onChange={(e) => setResolutionDraft(d => ({ ...d, [c.id]: e.target.value }))}
                              data-resolution-input={c.id}
                              className="flex-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-[12px]"
                            />
                            <button
                              type="button"
                              onClick={() => resolveContradiction(c.id)}
                              data-resolve-contradiction={c.id}
                              className="rounded-md px-2 py-1 text-[11px] font-semibold text-white"
                              style={{ backgroundColor: '#B0200D' }}
                            >Resolve</button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {activeTab === 'audit' && (
                <div data-tab-audit>
                  <ul className="flex flex-col gap-1 font-mono text-[11px] text-slate-600">
                    <li>09:22 UTC · AI suggestion accepted · Section 2.5.4 · Dr S. Chen</li>
                    <li>09:18 UTC · Consistency check run · 2 contradictions · Logged</li>
                    <li>09:10 UTC · Section opened for editing · Dr S. Chen</li>
                  </ul>
                </div>
              )}
            </div>
          </aside>
        </div>
      </div>

      {toast && (
        <div
          data-toast
          className="pointer-events-none fixed bottom-5 left-1/2 flex -translate-x-1/2 items-center gap-2.5 rounded-lg px-4 py-3 text-[13px]"
          style={{ backgroundColor: '#1E293B', color: '#FFFFFF' }}
        >
          <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: '#B0200D' }} />
          {toast}
        </div>
      )}
    </div>
  )
}
