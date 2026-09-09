import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import type { ConsistencyCheckResult, ConsistencyContradiction, SuperReviewer, ECTDNode } from '@platform/types'
import { regulatoryWritingApi } from '../../modules/regulatory-writing/api/regulatoryWriting'
import { useSuperReviewStore, useECTDStore } from '../../modules/regulatory-writing/store'
import { ConsistencyContradictionCard } from '../../components/ui'

type SuperReviewTab = 'consistency' | 'safety' | 'comments'

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const day = String(d.getUTCDate()).padStart(2, '0')
  const hh  = String(d.getUTCHours()).padStart(2, '0')
  const mm  = String(d.getUTCMinutes()).padStart(2, '0')
  return `${day} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()} ${hh}:${mm} UTC`
}

function joinNames(names: string[]): string {
  if (names.length === 0) return '—'
  if (names.length === 1) return names[0]
  return names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1]
}

export function SuperReview() {
  const { projectId, submissionId } = useParams()
  const navigate = useNavigate()

  const reviewers        = useSuperReviewStore(s => s.reviewers)
  const setReviewers     = useSuperReviewStore(s => s.setReviewers)
  const setConsistency   = useSuperReviewStore(s => s.setConsistencyResult)

  const nodes    = useECTDStore(s => s.nodes)
  const setNodes = useECTDStore(s => s.setNodes)

  const [tab, setTab]                     = useState<SuperReviewTab>('consistency')
  const [ccResult, setCCResult]           = useState<ConsistencyCheckResult | null>(null)
  const [isRunningCheck, setRunningCheck] = useState(false)
  const [resolutionDraft, setResolutionDraft] = useState<Record<string, string>>({})
  const [toast, setToast]                 = useState<string | null>(null)

  const flash = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3000) }

  const { data: fetchedReviewers = [] } = useQuery({
    queryKey: ['super-reviewers', submissionId],
    queryFn:  () => regulatoryWritingApi.getSuperReviewers(submissionId!),
    enabled:  !!submissionId,
  })
  const { data: fetchedCC } = useQuery({
    queryKey: ['consistency', submissionId],
    queryFn:  () => regulatoryWritingApi.getConsistencyCheck(submissionId!),
    enabled:  !!submissionId,
  })
  const { data: fetchedNodes = [] } = useQuery({
    queryKey: ['reg-ectd-map', submissionId],
    queryFn:  () => regulatoryWritingApi.getECTDMap(submissionId!),
    enabled:  !!submissionId,
  })

  useEffect(() => { setReviewers(fetchedReviewers as SuperReviewer[]) }, [fetchedReviewers, setReviewers])
  useEffect(() => { if (fetchedCC) { setCCResult(fetchedCC as ConsistencyCheckResult); setConsistency(fetchedCC as ConsistencyCheckResult) } }, [fetchedCC, setConsistency])
  useEffect(() => { setNodes(fetchedNodes as ECTDNode[]) }, [fetchedNodes, setNodes])

  const signedCount    = reviewers.filter(r => !!r.signedAt).length
  const pendingNames   = reviewers.filter(r => !r.signedAt).map(r => r.name.replace(/^Dr |^Mr |^Ms /, m => m.trim() + ' '))
  const allSigned      = reviewers.length > 0 && signedCount === reviewers.length
  const unresolvedMajor = useMemo(() => {
    if (!ccResult) return 0
    return ccResult.contradictions.filter(c => c.severity === 'major' && !c.resolved).length
  }, [ccResult])
  const unresolvedMinor = useMemo(() => {
    if (!ccResult) return 0
    return ccResult.contradictions.filter(c => c.severity === 'minor' && !c.resolved).length
  }, [ccResult])

  const canSubmit = allSigned && unresolvedMajor === 0

  const runCheckMutation = useMutation({
    mutationFn: () => {
      setRunningCheck(true)
      return regulatoryWritingApi.runConsistencyCheck(submissionId!)
    },
    onSuccess: (data) => {
      setCCResult(data.result)
      setRunningCheck(false)
      flash('Consistency check complete.')
    },
    onError: () => setRunningCheck(false),
  })

  const resolveContradiction = (id: string) => {
    const note = resolutionDraft[id]
    if (!note || !note.trim()) { flash('Enter a resolution note first.'); return }
    if (!ccResult) return
    const updated: ConsistencyCheckResult = {
      ...ccResult,
      contradictions: ccResult.contradictions.map(c => c.id === id ? {
        ...c, resolved: true, resolvedBy: 'Dr Sarah Chen', resolvedAt: new Date().toISOString(), resolutionNote: note,
      } : c),
    }
    updated.passed = !updated.contradictions.some(c => c.severity === 'major' && !c.resolved)
    setCCResult(updated)
    flash(`${id} resolved.`)
  }

  const submitToStage5 = () => {
    if (!canSubmit) return
    navigate(`/projects/${projectId}/regulatory-writing/submissions/${submissionId}/publishing`)
  }

  const compiled = nodes.filter(n => n.status === 'signed').length
  const dossierPct = nodes.length === 0 ? 0 : Math.round((compiled / nodes.length) * 100)

  const gateItems = [
    { label: 'All 6 RACI roles signed',        passed: allSigned,              detail: `${signedCount}/${reviewers.length}` },
    { label: 'All Major contradictions resolved', passed: unresolvedMajor === 0, detail: `${(ccResult?.contradictions.filter(c=>c.severity==='major').length ?? 0) - unresolvedMajor}/${ccResult?.contradictions.filter(c=>c.severity==='major').length ?? 0}` },
    { label: 'All Minor noted or resolved',    passed: unresolvedMinor === 0,   detail: `${(ccResult?.contradictions.filter(c=>c.severity==='minor').length ?? 0) - unresolvedMinor}/${ccResult?.contradictions.filter(c=>c.severity==='minor').length ?? 0}` },
    { label: 'PV Lead PSUR sign-off',          passed: false,                   detail: 'pending' },
  ]
  const unmetCount = gateItems.filter(g => !g.passed).length

  return (
    <div className="bg-slate-50" data-screen="super-review">
      <div className="mx-auto flex flex-col gap-4" style={{ maxWidth: 1440, padding: '16px 24px 24px' }}>

        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-xs text-slate-500">
          <button onClick={() => navigate(`/projects/${projectId}/regulatory-writing`)} className="hover:text-slate-900">Regulatory Writing</button>
          <span style={{ color: '#CBD5E1' }}>&gt;</span>
          <span className="font-semibold text-slate-900">Super Review</span>
        </nav>

        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="flex min-w-0 flex-col gap-1.5">
            <h1 className="text-[22px] font-bold text-slate-900" style={{ margin: 0 }}>Super Review</h1>
            <div className="flex items-center gap-2 font-mono text-xs" style={{ color: '#64748B' }}>
              <span>Stage 4 · Multi-disciplinary review</span>
              <span
                className="inline-flex rounded-md px-2 py-0.5 text-[11px] font-semibold"
                style={{ backgroundColor: '#FFFBEB', color: '#B45309' }}
                data-signed-status
              >{signedCount} of {reviewers.length} signed</span>
            </div>
          </div>
          <div className="flex flex-none flex-col items-end gap-0.5">
            <button
              type="button"
              onClick={submitToStage5}
              disabled={!canSubmit}
              data-submit-stage-5
              data-submit-enabled={canSubmit}
              className="h-9 rounded-md px-3 text-[13px] font-semibold text-white"
              style={{ backgroundColor: canSubmit ? '#B0200D' : '#CBD5E1', cursor: canSubmit ? 'pointer' : 'not-allowed' }}
            >Submit to Stage 5 →</button>
            {!canSubmit && (
              <span className="text-[11px]" style={{ color: '#005F8E' }} data-submit-blocked-reason>
                {unresolvedMajor > 0
                  ? `Major contradiction unresolved — must resolve before Stage 5.`
                  : `${unmetCount} of ${gateItems.length} gate items unmet — ${reviewers.length - signedCount} reviewers still pending.`}
              </span>
            )}
          </div>
        </div>

        <div className="grid gap-4" style={{ gridTemplateColumns: '280px minmax(0,1fr) 300px' }}>
          {/* LEFT — RACI panel */}
          <aside className="rounded-lg border border-slate-200 bg-white p-3" data-raci-panel>
            <h3 className="mb-2 text-[13px] font-bold text-slate-900">RACI Sign-off</h3>
            <p className="mb-3 text-[11px]" style={{ color: '#64748B' }} data-signoff-summary>
              {signedCount} of {reviewers.length} signed{pendingNames.length > 0 ? ` · waiting for ${joinNames(pendingNames)}` : ''}
            </p>
            <div className="flex flex-col gap-1.5">
              {reviewers.map(r => (
                <div key={r.id} className="flex items-center gap-2 rounded-md p-1.5" data-raci-row={r.userId}>
                  <div className="flex h-7 w-7 flex-none items-center justify-center rounded-full text-[10px] font-bold" style={{ backgroundColor: r.avBg, color: r.avFg }}>
                    {r.initials}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px] font-semibold text-slate-800">{r.name}</p>
                    <p className="truncate text-[11px] text-slate-500">{r.role}</p>
                  </div>
                  <span
                    className="whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] font-semibold"
                    style={{ backgroundColor: r.pillBg, color: r.pillFg, border: r.pillBorder }}
                    data-raci-status={r.signedAt ? 'signed' : 'pending'}
                  >{r.signedAt ? `✓ Submitted ${r.signedAtDisplay ?? ''}` : '○ Pending'}</span>
                </div>
              ))}
            </div>
            <p className="mt-3 text-[10px]" style={{ color: '#64748B' }}>
              E-signature (21 CFR Part 11) required for final sign-off.
            </p>
          </aside>

          {/* CENTRE — Tabs */}
          <section className="flex flex-col gap-3" data-tabs>
            <div className="flex border-b border-slate-200">
              {(['consistency', 'safety', 'comments'] as SuperReviewTab[]).map(id => {
                const label = id === 'consistency' ? 'Consistency Report' : id === 'safety' ? 'Safety Report' : 'Comments'
                const active = tab === id
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setTab(id)}
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
              })}
            </div>

            {tab === 'consistency' && (
              <div data-tab-consistency>
                <div className="mb-3 flex items-start justify-between gap-2">
                  <div>
                    <p className="text-[13px] font-semibold text-slate-800">
                      Cross-Module Consistency Report · {ccResult?.contradictions.length ?? 0} contradictions
                    </p>
                    <p className="font-mono text-[11px] text-slate-500" data-cc-header>
                      Last run: {formatDateTime(ccResult?.runAt)} · {ccResult?.model ?? 'claude-sonnet-4-6'} · Logged to audit trail
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => runCheckMutation.mutate()}
                    disabled={isRunningCheck}
                    data-run-again
                    className="h-8 rounded-md px-3 text-[12px] font-semibold text-white"
                    style={{ backgroundColor: isRunningCheck ? '#CBD5E1' : '#D97706' }}
                  >{isRunningCheck ? 'Running…' : 'Run again ✦'}</button>
                </div>

                <div className="flex flex-col gap-3">
                  {ccResult?.contradictions.map((c: ConsistencyContradiction) => (
                    <div key={c.id} data-cc-item={c.id}>
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
                          >Resolve ✓</button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                <p className="mt-3 rounded-md px-3 py-2 text-[12px]" style={{ backgroundColor: '#EFF6FF', color: '#005F8E', border: '1px solid #93C5FD' }} data-cc-gate-note>
                  {ccResult?.contradictions.filter(c=>c.severity==='major'&&c.resolved).length ?? 0} Major resolved ✓ · {unresolvedMinor} Minor unresolved — Super Review can proceed to Stage 5 (Minor contradictions do not block, but must be noted).
                </p>
              </div>
            )}

            {tab === 'safety' && (
              <div data-tab-safety className="rounded-lg border border-slate-200 bg-white p-4">
                <p className="text-[13px] font-semibold text-slate-800">PSUR/PBRER draft</p>
                <p className="mt-1 text-[12px] text-slate-600">Auto-generated from Argus safety line-listing exports · ICH E2C(R2) structure.</p>
                <span className="mt-2 inline-flex rounded-md px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: '#FFF5F5', color: '#B0200D', border: '1px solid #FFC5C5' }}>
                  AI footprint · 68% ✦
                </span>
                <p className="mt-3 text-[12px] text-slate-700">
                  <strong>PV Lead verification required:</strong> Dr Rebecca Morton — ○ pending
                </p>
              </div>
            )}

            {tab === 'comments' && (
              <div data-tab-comments className="flex flex-col gap-2">
                <div className="rounded-md border border-slate-200 bg-white p-3">
                  <p className="font-mono text-[11px] text-slate-500">REG-D-001 · Dr Vasquez · Clinical Lead · 14 Oct</p>
                  <p className="mt-1 text-[13px] text-slate-800">HR discrepancy in §2.5.4 — confirm which analysis version is cited.</p>
                </div>
                <div className="rounded-md border border-slate-200 bg-white p-3">
                  <p className="font-mono text-[11px] text-slate-500">REG-D-002 · Dr Hartley · Reg Affairs · 15 Oct</p>
                  <p className="mt-1 text-[13px] text-slate-800">Cover letter for FDA needs updated submission date — 15 Jan 2027 not 01 Jan.</p>
                </div>
              </div>
            )}
          </section>

          {/* RIGHT — Gate status panel */}
          <aside className="rounded-lg border border-slate-200 bg-white p-4" data-gate-panel>
            <h3 className="mb-2 text-[13px] font-bold text-slate-900">Gate Status</h3>
            <p className="text-[12px] text-slate-800">Dossier completeness</p>
            <p className="text-[13px] font-semibold text-slate-800">{nodes.length} sections · {compiled} compiled ✓</p>
            <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-100">
              <div className="h-full" style={{ width: `${dossierPct}%`, backgroundColor: '#B0200D' }} data-dossier-progress />
            </div>

            <div className="mt-4 flex flex-col gap-1.5" data-gate-checklist>
              {gateItems.map((g, i) => (
                <div key={i} className="flex items-center gap-2 text-[12px]" data-gate-item={g.label}>
                  <span
                    className="flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold text-white"
                    style={{ backgroundColor: g.passed ? '#15803D' : '#005F8E' }}
                  >{g.passed ? '✓' : '!'}</span>
                  <span style={{ color: g.passed ? '#0F172A' : '#005F8E' }}>{g.label} <span className="font-mono text-slate-500">({g.detail})</span></span>
                </div>
              ))}
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
