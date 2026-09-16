import { useEffect, useState, useMemo } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import type { MLRComment, MLRDecision, MLRReviewer, MedContentItem } from '@platform/types'
import { medContentApi } from '../../modules/medical-writing/api/medContent'
import { useMLRStore } from '../../modules/medical-writing/store'
import { MLRCommentCard, ReviewTierBadge } from '../../components/ui'

// --- Static assumption: current user is the MLR Lead (Dr James Hartley) ---
const CURRENT_USER_ID   = 'user-jh'
const CURRENT_USER_NAME = 'Dr James Hartley'
const CURRENT_USER_ROLE = 'MLR Lead'

const DECISION_OPTIONS: {
  id:     MLRDecision
  title:  string
  hint:   string
  bg:     string
  border: string
  fg:     string
}[] = [
  { id: 'approve',                  title: 'Approve for distribution',                       hint: 'Content ready for external distribution',      bg: '#FFFFFF', border: '#BBF7D0', fg: '#166534' },
  { id: 'approve-with-revisions',   title: 'Approve with minor revisions — author to resolve', hint: 'Author to resolve minor comments',            bg: '#FFFFFF', border: '#FDE68A', fg: '#B45309' },
  { id: 'return-to-author',         title: 'Return to author — major revisions required',    hint: 'Reverts content to Stage 3 — In Authoring',   bg: '#FFFBEB', border: '#FDE68A', fg: '#B45309' },
  { id: 'reject',                   title: 'Reject — fundamental issues',                     hint: 'Content will be archived',                     bg: '#FFF1F2', border: '#FDA4AF', fg: '#BE123C' },
]

function joinNames(names: string[]): string {
  if (names.length === 0) return '—'
  if (names.length === 1) return names[0]
  if (names.length === 2) return `${names[0]} and ${names[1]}`
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${String(d.getUTCDate()).padStart(2, '0')} ${months[d.getUTCMonth()]}`
}

export function MLRReview() {
  const { projectId, contentId } = useParams()
  const navigate = useNavigate()

  const reviewers          = useMLRStore(s => s.reviewers)
  const comments           = useMLRStore(s => s.comments)
  const decisionDraft      = useMLRStore(s => s.decisionDraft)
  const decisionNote       = useMLRStore(s => s.decisionNote)
  const signatureConfirmed = useMLRStore(s => s.signatureConfirmed)
  const setReviewers       = useMLRStore(s => s.setReviewers)
  const setComments        = useMLRStore(s => s.setComments)
  const setDecisionDraft   = useMLRStore(s => s.setDecisionDraft)
  const setDecisionNote    = useMLRStore(s => s.setDecisionNote)
  const setSignatureConfirmed = useMLRStore(s => s.setSignatureConfirmed)

  const [activeTab, setActiveTab] = useState<'content' | 'claims' | 'agentic' | 'accme'>('content')
  const [signStepOpen, setSignStepOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const flash = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3200) }

  const { data: item } = useQuery({
    queryKey: ['med-content', contentId],
    queryFn:  () => medContentApi.get(contentId!),
    enabled:  !!contentId,
  })

  const { data: fetchedReviewers } = useQuery({
    queryKey: ['mlr-reviewers', contentId],
    queryFn:  () => medContentApi.getMLRReviewers(contentId!),
    enabled:  !!contentId,
  })
  const { data: fetchedComments } = useQuery({
    queryKey: ['mlr-comments', contentId],
    queryFn:  () => medContentApi.getMLRComments(contentId!),
    enabled:  !!contentId,
  })
  const { data: agentic } = useQuery({
    queryKey: ['agentic-report', contentId],
    queryFn:  () => medContentApi.getAgenticReport(contentId!),
    enabled:  !!contentId,
  })

  useEffect(() => { if (fetchedReviewers) setReviewers(fetchedReviewers as MLRReviewer[]) }, [fetchedReviewers, setReviewers])
  useEffect(() => { if (fetchedComments)  setComments(fetchedComments as MLRComment[]) },   [fetchedComments, setComments])

  const currentItem: MedContentItem | undefined = item
  const showAccmeTab = currentItem?.complianceTrack === 'accme'
  const tabs: { id: typeof activeTab; label: string }[] = [
    { id: 'content', label: 'Content Review' },
    { id: 'claims',  label: 'Claims Matrix' },
    { id: 'agentic', label: 'Agentic Report' },
    ...(showAccmeTab ? [{ id: 'accme' as const, label: 'ACCME Checklist' }] : []),
  ]

  const submittedCount = reviewers.filter(r => !!r.submittedAt).length
  const notSubmittedNames = reviewers.filter(r => !r.submittedAt).map(r => r.name)
  const allSubmitted = reviewers.length > 0 && notSubmittedNames.length === 0
  const isMLRLead = CURRENT_USER_ROLE === 'MLR Lead'
  const canSubmit = allSubmitted && isMLRLead && !!decisionDraft

  const submitDecisionMutation = useMutation({
    mutationFn: () =>
      medContentApi.submitMLRDecision(contentId!, {
        decision:           decisionDraft!,
        decisionNote,
        signatureConfirmed: true,
        signaturePassword:  '',
        decidedBy:          CURRENT_USER_ID,
      }),
    onSuccess: (data) => {
      flash('MLR decision signed and recorded · Part 11 compliant · Audit trail updated.')
      setSignStepOpen(false)
      setSignatureConfirmed(false)
      const next = data.nextStatus
      if (next === 'in-authoring') {
        navigate(`/projects/${projectId}/medical-writing/content/${contentId}/editor`)
      } else if (next === 'mlr-approved') {
        navigate(`/projects/${projectId}/medical-writing/content/${contentId}/formatting`)
      }
    },
  })

  const handleSubmitClick = () => {
    if (!canSubmit) return
    if (!signStepOpen) { setSignStepOpen(true); return }
    if (!signatureConfirmed) return
    submitDecisionMutation.mutate()
  }

  const currentUserReviewer = reviewers.find(r => r.userId === CURRENT_USER_ID)

  const commentsForActive = useMemo(() => comments, [comments])

  return (
    <div className="bg-slate-50" data-screen="mlr-review">
      <div className="flex flex-col gap-4" style={{ maxWidth: 1360, padding: '16px 24px 40px' }}>

        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-xs text-slate-500">
          <button onClick={() => navigate(`/projects/${projectId}/medical-writing`)} className="hover:text-slate-900">Medical Writing</button>
          <span style={{ color: '#CBD5E1' }}>&gt;</span>
          <span className="font-semibold text-slate-900">MLR Review</span>
        </nav>

        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="flex min-w-0 flex-col gap-1.5">
            <h1 className="text-[22px] font-bold text-slate-900" style={{ margin: 0 }}>{currentItem?.title ?? 'MLR Review'}</h1>
            <p className="font-mono text-xs" style={{ color: '#64748B' }}>
              v{currentItem?.version ?? '0.0'} · Tier 2 Standard Review · IFPMA/EFPIA/ABPI/PhRMA
            </p>
          </div>
          <div className="flex flex-none flex-col items-end gap-1">
            <button
              type="button"
              onClick={handleSubmitClick}
              disabled={!canSubmit}
              data-submit-mlr-decision
              data-submit-enabled={canSubmit}
              className="h-9 rounded-md px-3 text-[13px] font-semibold text-white"
              style={{ backgroundColor: canSubmit ? '#7C3AED' : '#CBD5E1', cursor: canSubmit ? 'pointer' : 'not-allowed' }}
            >Submit MLR decision</button>
            {!isMLRLead && (
              <span className="text-[11px]" style={{ color: '#64748B' }}>MLR Lead role required</span>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-200" data-tab-bar>
          {tabs.map(t => (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveTab(t.id)}
              data-tab={t.id}
              data-tab-active={activeTab === t.id || undefined}
              className="px-3 py-2 text-[13px]"
              style={{
                borderBottom: `2px solid ${activeTab === t.id ? '#7C3AED' : 'transparent'}`,
                color:        activeTab === t.id ? '#5B21B6' : '#64748B',
                fontWeight:   activeTab === t.id ? 600 : 500,
              }}
            >{t.label}</button>
          ))}
        </div>

        <div className="grid gap-4" style={{ gridTemplateColumns: 'minmax(0,1fr) 360px' }}>

          {/* LEFT: main panel */}
          <div className="flex flex-col gap-4">
            {activeTab === 'content' && (
              <>
                {/* Content canvas */}
                <section className="rounded-lg border border-slate-200 bg-white p-6" data-content-canvas>
                  <div className="mb-3 flex items-center gap-2">
                    <span
                      className="inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold"
                      style={{ backgroundColor: '#EFF6FF', color: '#1D4ED8' }}
                    >UNDER REVIEW</span>
                    <span className="font-mono text-[11px] text-slate-500">Slide 12 · Primary endpoint · PFS</span>
                  </div>
                  <h2 className="text-[18px] font-bold text-slate-900">Primary endpoint: progression-free survival</h2>
                  <p className="mt-3 text-[13px] text-slate-800">
                    Veloricept plus pembrolizumab significantly improved PFS vs pembrolizumab alone
                    (HR 0.61; 95% CI 0.48–0.77; p&lt;0.001).
                  </p>
                  <div className="mt-4 flex h-40 items-center justify-center rounded-md bg-slate-50 text-[12px]" style={{ color: '#64748B' }}>
                    Kaplan-Meier curve (TLF Fig 14.2.1 · Module A)
                  </div>
                </section>

                {/* Comments thread */}
                <section className="rounded-lg border border-slate-200 bg-white p-4" data-comments-thread>
                  <h3 className="mb-3 text-[13px] font-bold text-slate-900">MLR comments</h3>
                  <div className="flex flex-col gap-2.5">
                    {commentsForActive.map(c => (
                      <div key={c.id}>
                        <MLRCommentCard comment={c} />
                        {c.escalatedFromAgentic && (
                          <p
                            className="mt-1 inline-flex items-center gap-1 rounded-md px-2 py-1 font-mono text-[10px]"
                            style={{ backgroundColor: '#F8FAFC', color: '#475569', border: '1px solid #E2E8F0' }}
                            data-escalation-footer={c.id}
                          >
                            ⬆ Escalated from agentic Should Fix · {c.escalatedBy?.replace('Dr Rebecca ', 'Dr ')} · {formatDate(c.escalatedAt)} {c.escalatedAt ? new Date(c.escalatedAt).toISOString().slice(11, 16) : ''}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              </>
            )}

            {activeTab === 'claims' && (
              <section className="rounded-lg border border-slate-200 bg-white p-6" data-claims-tab>
                <h3 className="text-[14px] font-bold text-slate-900">Claims Matrix (read-only in MLR)</h3>
                <p className="mt-2 text-[13px] text-slate-600">
                  Six approved, one modified, one must-fix, one new claim. Open the full Claims Matrix to review and adopt.
                </p>
                <button
                  type="button"
                  onClick={() => navigate(`/projects/${projectId}/medical-writing/claims-matrix`)}
                  data-open-claims-matrix
                  className="mt-3 text-[13px] font-semibold text-violet-700 hover:underline"
                >Open Claims Matrix →</button>
              </section>
            )}

            {activeTab === 'agentic' && (
              <section className="rounded-lg border border-slate-200 bg-white p-6" data-agentic-tab>
                <h3 className="text-[14px] font-bold text-slate-900">Agentic Pre-Review Findings</h3>
                <div className="mt-3 flex flex-col gap-2">
                  {(agentic?.findings ?? []).map(f => (
                    <article key={f.n} className="rounded-md border border-slate-200 p-3">
                      <p className="text-[13px] font-semibold text-slate-800">{f.title}</p>
                      <p className="mt-1 font-mono text-[11px] text-slate-500">{f.slide}</p>
                      <p className="mt-1 text-[13px] text-slate-700">{f.detail}</p>
                    </article>
                  ))}
                </div>
              </section>
            )}
          </div>

          {/* RIGHT: sidebar */}
          <div className="flex flex-col gap-4">

            {/* MLR Reviewers */}
            <section className="rounded-lg border border-slate-200 bg-white p-4" data-reviewers-panel>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-[13px] font-bold text-slate-900">MLR Reviewers</h3>
                {currentItem && currentItem.reviewTier && (
                  <ReviewTierBadge tier={currentItem.reviewTier} overridden={!!currentItem.reviewTierOverriddenBy} />
                )}
              </div>
              <p className="mb-2 text-[11px]" style={{ color: '#64748B' }} data-reviewer-count>
                {submittedCount} of {reviewers.length} reviewers submitted{notSubmittedNames.length > 0 ? ` · waiting for ${joinNames(notSubmittedNames)}` : ''}
              </p>
              <div className="flex flex-col gap-1.5">
                {reviewers.map(r => (
                  <div key={r.id} className="flex items-center gap-2 rounded-md p-1.5" data-reviewer-row={r.userId} style={{ backgroundColor: r.userId === CURRENT_USER_ID ? '#F5F3FF' : 'transparent' }}>
                    <div className="flex h-7 w-7 flex-none items-center justify-center rounded-full text-[10px] font-bold" style={{ backgroundColor: r.avBg, color: r.avFg }}>{r.initials}</div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12px] font-semibold text-slate-800">{r.name}{r.userId === CURRENT_USER_ID ? ' (you)' : ''}</p>
                      <p className="truncate text-[11px] text-slate-500">{r.role}</p>
                    </div>
                    <span
                      className="whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] font-semibold"
                      style={{ backgroundColor: r.pillBg, color: r.pillFg, border: r.pillBorder }}
                    >
                      {r.submittedAt ? `✓ Submitted ${formatDate(r.submittedAt)}` : r.userId === CURRENT_USER_ID ? '○ Not yet submitted' : '○ In progress'}
                    </span>
                  </div>
                ))}
              </div>
            </section>

            {/* Claims summary */}
            <section className="rounded-lg border border-slate-200 bg-white p-4" data-claims-summary>
              <h3 className="mb-1 text-[13px] font-bold text-slate-900">Claims Status</h3>
              <ul className="text-[12px]">
                <li>✓ 6 approved</li>
                <li>~ 1 modified</li>
                <li>! 1 must-fix</li>
                <li>+ 1 new</li>
              </ul>
              <button type="button" onClick={() => navigate(`/projects/${projectId}/medical-writing/claims-matrix`)} className="mt-2 text-[12px] font-semibold text-violet-700 hover:underline">Open Claims Matrix →</button>
            </section>

            {/* Agentic summary */}
            <section className="rounded-lg border border-slate-200 bg-white p-4" data-agentic-summary>
              <h3 className="mb-1 text-[13px] font-bold text-slate-900">Agentic Pre-Review</h3>
              <ul className="flex flex-col gap-1 text-[12px]">
                {(agentic?.findings ?? []).map(f => (
                  <li key={f.n}>
                    <span className="font-mono text-[10px] text-slate-500">{f.slide}</span>
                    {f.escalatedToMustFix && (
                      <span className="ml-1 text-[10px]" style={{ color: '#005F8E' }}>· escalated to Must Fix by {f.escalatedBy?.replace('Dr Rebecca ', 'Dr ')}</span>
                    )}
                  </li>
                ))}
              </ul>
              <button type="button" onClick={() => setActiveTab('agentic')} className="mt-2 text-[12px] font-semibold text-violet-700 hover:underline">View full agentic report →</button>
            </section>

            {/* MLR Decision (Lead only) */}
            <section className="rounded-lg border border-slate-200 bg-white p-4" data-mlr-decision-panel>
              <h3 className="mb-2 text-[13px] font-bold text-slate-900">MLR Decision</h3>
              {!isMLRLead && <p className="text-[12px] text-slate-500">Only the MLR Lead ({currentUserReviewer?.role ?? 'user'}) can submit the decision.</p>}
              <div className="flex flex-col gap-2">
                {DECISION_OPTIONS.map(opt => {
                  const active = decisionDraft === opt.id
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => isMLRLead && setDecisionDraft(opt.id)}
                      disabled={!isMLRLead}
                      data-decision-option={opt.id}
                      data-decision-active={active || undefined}
                      className="flex flex-col items-start rounded-md p-2.5 text-left"
                      style={{
                        backgroundColor: opt.bg,
                        border:          active ? `2px solid ${opt.border}` : `1px solid #E2E8F0`,
                        opacity:         isMLRLead ? 1 : 0.7,
                      }}
                    >
                      <span className="text-[12px] font-semibold" style={{ color: opt.fg }}>{opt.title}</span>
                      <span className="text-[11px] text-slate-500">{opt.hint}</span>
                    </button>
                  )
                })}
              </div>
              <p className="mt-3 text-[11px]" style={{ color: '#64748B' }}>
                Submitting this decision creates an immutable, 21 CFR Part 11-compliant record.
              </p>

              {signStepOpen && (
                <div className="mt-3 rounded-md border border-slate-300 bg-slate-50 p-3" data-sign-step>
                  <p className="text-[12px] font-semibold text-slate-800">Signatory: {CURRENT_USER_NAME}</p>
                  <p className="text-[11px] text-slate-500">Role: MLR Lead</p>
                  <p className="mt-2 text-[12px] text-slate-700">Decision: <strong>{DECISION_OPTIONS.find(o => o.id === decisionDraft)?.title}</strong></p>
                  <label className="mt-2 flex items-start gap-2 text-[12px] text-slate-700">
                    <input
                      type="checkbox"
                      checked={signatureConfirmed}
                      onChange={(e) => setSignatureConfirmed(e.target.checked)}
                      data-sign-confirm-checkbox
                    />
                    <span>I confirm this decision is accurate and I am signing this record under 21 CFR Part 11.</span>
                  </label>
                  <textarea
                    value={decisionNote}
                    onChange={(e) => setDecisionNote(e.target.value)}
                    placeholder="Optional note…"
                    className="mt-2 w-full rounded-md border border-slate-300 p-2 text-[12px]"
                    data-decision-note-input
                  />
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() => submitDecisionMutation.mutate()}
                      disabled={!signatureConfirmed}
                      data-confirm-sign
                      className="rounded-md px-3 py-1.5 text-[12px] font-semibold text-white"
                      style={{ backgroundColor: signatureConfirmed ? '#7C3AED' : '#CBD5E1', cursor: signatureConfirmed ? 'pointer' : 'not-allowed' }}
                    >Confirm &amp; sign</button>
                    <button
                      type="button"
                      onClick={() => setSignStepOpen(false)}
                      className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-[12px] font-semibold text-slate-700"
                    >Cancel</button>
                  </div>
                </div>
              )}
            </section>
          </div>
        </div>
      </div>

      {toast && (
        <div
          data-toast
          className="pointer-events-none fixed bottom-5 left-1/2 flex -translate-x-1/2 items-center gap-2.5 rounded-lg px-4 py-3 text-[13px]"
          style={{ backgroundColor: '#1E293B', color: '#FFFFFF' }}
        >
          <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: '#7C3AED' }} />
          {toast}
        </div>
      )}
    </div>
  )
}
