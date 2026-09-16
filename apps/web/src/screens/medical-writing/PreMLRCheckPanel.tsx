import { useEffect, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import type { AgenticFinding, AgenticReport, PreMLRIssue, PreMLRResult } from '@platform/types'
import { medContentApi } from '../../modules/medical-writing/api/medContent'
import { usePreMLRStore } from '../../modules/medical-writing/store'

// --- Static assumption: current user is not MLR Lead ---
type UserRole = 'author' | 'mlr-lead' | 'reviewer'
const CURRENT_USER_ROLE: UserRole = 'author'
const CURRENT_USER_NAME = 'Dr Sarah Chen'

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  const hh = String(d.getUTCHours()).padStart(2, '0')
  const mm = String(d.getUTCMinutes()).padStart(2, '0')
  return `${hh}:${mm} UTC`
}

function SeverityBadge({ severity }: { severity: PreMLRIssue['severity'] }) {
  const meta =
    severity === 'must-fix'  ? { bg: '#EFF6FF', fg: '#005F8E', border: '#93C5FD', label: 'Must Fix' } :
    severity === 'should-fix' ? { bg: '#FFFBEB', fg: '#B45309', border: '#FDE68A', label: 'Should Fix' } :
                                { bg: '#F8FAFC', fg: '#94A3B8', border: '#E2E8F0', label: 'Note' }
  return (
    <span
      className="inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold"
      style={{ backgroundColor: meta.bg, color: meta.fg, border: `1px solid ${meta.border}` }}
      data-severity={severity}
    >{meta.label}</span>
  )
}

export function PreMLRCheckPanel() {
  const { projectId, contentId } = useParams()
  const navigate = useNavigate()

  const result           = usePreMLRStore(s => s.result)
  const agenticReport    = usePreMLRStore(s => s.agenticReport)
  const setResult        = usePreMLRStore(s => s.setResult)
  const setAgenticReport = usePreMLRStore(s => s.setAgenticReport)
  const acknowledgeIssue = usePreMLRStore(s => s.acknowledgeIssue)

  const [toast, setToast] = useState<string | null>(null)
  const flash = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3400) }

  const { data: fetchedResult } = useQuery({
    queryKey: ['pre-mlr', contentId],
    queryFn:  () => medContentApi.getPreMLR(contentId!),
    enabled:  !!contentId,
  })
  const { data: fetchedAgentic } = useQuery({
    queryKey: ['agentic-report', contentId],
    queryFn:  () => medContentApi.getAgenticReport(contentId!),
    enabled:  !!contentId,
  })

  useEffect(() => { if (fetchedResult)  setResult(fetchedResult as PreMLRResult) },  [fetchedResult, setResult])
  useEffect(() => { if (fetchedAgentic) setAgenticReport(fetchedAgentic as AgenticReport) }, [fetchedAgentic, setAgenticReport])

  const ackMutation = useMutation({
    mutationFn: (issueId: string) =>
      medContentApi.acknowledgeIssue(contentId!, issueId, { acknowledgedBy: CURRENT_USER_NAME }),
    onSuccess: (_data, issueId) => {
      acknowledgeIssue(issueId, CURRENT_USER_NAME)
      flash(`Issue ${issueId} acknowledged.`)
    },
  })

  const submitMutation = useMutation({
    mutationFn: () => medContentApi.submitToMLR(contentId!, { submittedBy: CURRENT_USER_NAME }),
    onSuccess:  () => navigate(`/projects/${projectId}/medical-writing/content/${contentId}/mlr-review`),
  })

  const canSubmit = !!result && result.passed && result.mustFixCount === 0

  const handleTierOverrideClick = () => {
    if (CURRENT_USER_ROLE !== 'mlr-lead') {
      flash('Tier override requires MLR Lead e-signature. Override reason will be recorded to the immutable audit trail.')
    }
  }

  return (
    <div className="bg-slate-50" data-screen="pre-mlr-check-panel">
      <div className="flex flex-col gap-5" style={{ maxWidth: 1180, padding: '20px 32px 48px' }}>

        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-xs text-slate-500">
          <button onClick={() => navigate(`/projects/${projectId}/medical-writing/content/${contentId}/editor`)} className="hover:text-slate-900">Content Editor</button>
          <span style={{ color: '#CBD5E1' }}>&gt;</span>
          <span className="font-semibold text-slate-900">Pre-MLR Automated Check</span>
        </nav>

        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="flex min-w-0 flex-col gap-1.5">
            <h1 className="text-[22px] font-bold text-slate-900" style={{ margin: 0 }}>Pre-MLR Automated Check</h1>
            <p className="font-mono text-xs" style={{ color: '#64748B' }}>Stage 4a · Automated quality checks before MLR review</p>
          </div>
          <div className="flex flex-none items-center gap-2">
            <button
              type="button"
              onClick={() => document.querySelector('[data-panel="agentic"]')?.scrollIntoView({ behavior: 'smooth' })}
              data-view-agentic
              className="h-9 rounded-md border border-slate-300 bg-white px-3 text-[13px] font-semibold text-slate-700 hover:bg-slate-50"
            >View agentic report</button>
            <button
              type="button"
              onClick={() => submitMutation.mutate()}
              disabled={!canSubmit}
              data-submit-to-mlr
              data-submit-enabled={canSubmit}
              className="h-9 rounded-md px-3 text-[13px] font-semibold text-white"
              style={{ backgroundColor: canSubmit ? '#7C3AED' : '#CBD5E1', cursor: canSubmit ? 'pointer' : 'not-allowed' }}
            >Submit to MLR team →</button>
          </div>
        </div>

        {/* Document summary */}
        <div className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 md:grid-cols-4" data-doc-summary>
          <div><p className="font-mono text-[10px] uppercase text-slate-500">Title</p><p className="text-[13px] font-semibold text-slate-800">Veloricept + Pembrolizumab HCP Slide Deck</p></div>
          <div><p className="font-mono text-[10px] uppercase text-slate-500">Version</p><p className="text-[13px] font-semibold text-slate-800">v0.3</p></div>
          <div><p className="font-mono text-[10px] uppercase text-slate-500">Slides</p><p className="text-[13px] font-semibold text-slate-800">26</p></div>
          <div><p className="font-mono text-[10px] uppercase text-slate-500">Word count</p><p className="text-[13px] font-semibold text-slate-800">2,140</p></div>
        </div>

        <p className="font-mono text-[10px] uppercase tracking-widest" style={{ color: '#64748B' }}>
          Check results · sequential (pre-MLR → agentic)
        </p>

        {/* Pre-MLR Results */}
        <section className="rounded-lg border border-slate-200 bg-white p-5" data-panel="pre-mlr-results">
          {result && (
            <div
              className="mb-4 rounded-md px-3 py-2 text-[13px]"
              style={{
                backgroundColor: result.mustFixCount === 0 ? '#F0FDF4' : '#FFFBEB',
                color:           result.mustFixCount === 0 ? '#166534' : '#78350F',
                border:          `1px solid ${result.mustFixCount === 0 ? '#BBF7D0' : '#FDE68A'}`,
              }}
              data-pre-mlr-summary
              data-pre-mlr-passed={result.passed}
            >
              {result.mustFixCount === 0
                ? `Pre-MLR: ${result.mustFixCount} must-fix · ${result.shouldFixCount} should-fix · ${result.noteCount} note — Ready to submit`
                : `Pre-MLR: ${result.mustFixCount} must-fix — Resolve before submitting.`}
            </div>
          )}

          <div className="flex flex-col gap-3" data-issues-list>
            {(result?.issues ?? []).map(i => (
              <article key={i.id} className="rounded-md border border-slate-200 p-3" data-issue-card={i.id}>
                <header className="mb-2 flex items-center gap-2">
                  <SeverityBadge severity={i.severity} />
                  {i.slide && <span className="font-mono text-[11px] text-slate-500">{i.slide}</span>}
                  <span className="ml-auto font-mono text-[10px] text-slate-400">{i.id}</span>
                </header>
                <p className="text-[13px] font-semibold text-slate-800">{i.title}</p>
                <p className="mt-1 text-[13px] text-slate-700">{i.detail}</p>
                {i.suggestedFix && (
                  <p className="mt-2 rounded-md bg-slate-50 p-2 text-[12px] text-slate-700">
                    <strong>Suggested fix:</strong> {i.suggestedFix}
                  </p>
                )}
                <div className="mt-2">
                  {i.acknowledged ? (
                    <span
                      className="inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold"
                      style={{ backgroundColor: '#F0FDF4', color: '#166534' }}
                      data-issue-acknowledged
                    >
                      ACKNOWLEDGED · {i.acknowledgedBy}
                    </span>
                  ) : i.severity === 'must-fix' ? (
                    <span
                      className="inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold"
                      style={{ backgroundColor: '#EFF6FF', color: '#005F8E' }}
                      data-must-fix-label
                    >Resolve before submitting</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => ackMutation.mutate(i.id)}
                      data-ack-button={i.id}
                      className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-[12px] font-semibold text-slate-700 hover:bg-slate-50"
                    >Acknowledge</button>
                  )}
                </div>
              </article>
            ))}
          </div>
        </section>

        {/* Section divider — sequential Pre-MLR → Agentic */}
        <div className="my-2 flex items-center gap-3" data-section-divider>
          <div className="h-px flex-1 bg-slate-200" />
          <span className="font-mono text-[11px] uppercase" style={{ color: '#7C3AED', letterSpacing: '0.1em' }}>
            Pre-MLR check complete → Agentic review
          </span>
          <div className="h-px flex-1 bg-slate-200" />
        </div>

        {/* Agentic MLR Pre-Review */}
        <section
          className="rounded-lg border border-slate-200 p-5"
          style={{ backgroundColor: '#FFFBEB', borderLeft: '4px solid #F59E0B' }}
          data-panel="agentic"
        >
          <header className="mb-3">
            <h2 className="text-[16px] font-bold text-slate-900">Agentic MLR Pre-Review</h2>
            <p className="font-mono text-[11px] uppercase" style={{ color: '#78350F', letterSpacing: '0.06em' }}>
              Label-grounding check · IFPMA/EFPIA/ABPI/PhRMA codes · Advisory only
            </p>
            <p className="mt-1 font-mono text-[11px]" style={{ color: '#64748B' }} data-agentic-attribution>
              Generated {formatDateTime(agenticReport?.runAt)} · {agenticReport?.model ?? 'claude-sonnet-4-6'} · All findings logged to audit trail
            </p>
          </header>

          <div className="flex flex-col gap-3">
            {(agenticReport?.findings ?? []).map((f: AgenticFinding) => (
              <article key={f.n} className="rounded-md border border-amber-200 bg-white p-3" data-agentic-finding={f.n}>
                <header className="mb-1 flex items-center gap-2">
                  <SeverityBadge severity={f.severity} />
                  <span className="font-mono text-[11px] text-slate-500">{f.slide}</span>
                  {f.escalatedToMustFix && (
                    <span
                      className="ml-2 inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold"
                      style={{ backgroundColor: '#EFF6FF', color: '#005F8E', border: '1px solid #93C5FD' }}
                      data-escalation-chip
                    >
                      escalated to Must Fix by {f.escalatedBy}
                    </span>
                  )}
                </header>
                <p className="text-[13px] font-semibold text-slate-800">{f.title}</p>
                <p className="mt-1 text-[13px] text-slate-700">{f.detail}</p>
              </article>
            ))}
          </div>

          <p className="mt-3 text-[12px]" style={{ color: '#78350F' }}>
            This report is advisory only. Human MLR Review Team makes the final approval decision.
          </p>
          <div className="mt-2 flex gap-3 text-[12px]">
            <button type="button" onClick={() => flash('PDF export queued')} className="font-semibold text-violet-700 hover:underline">Download full agentic report (PDF)</button>
          </div>
          <p className="mt-2 font-mono text-[10px]" style={{ color: '#94A3B8' }}>
            Generation and all findings are logged to the audit trail.
          </p>
        </section>

        {/* Review Tier */}
        <section className="rounded-lg border border-slate-200 bg-white p-5" data-panel="review-tier">
          <h2 className="mb-2 text-[14px] font-bold text-slate-900">Review Tier</h2>
          <div className="mb-2 flex items-center gap-3">
            <span
              className="inline-flex items-center rounded-md px-2 py-1 text-[12px] font-semibold"
              style={{ backgroundColor: '#FFFBEB', color: '#B45309' }}
              data-current-tier
            >Tier 2 — Standard Review</span>
            <span className="text-[12px] text-slate-500">All 4 MLR reviewers assigned · Standard checklist</span>
          </div>
          <button
            type="button"
            onClick={handleTierOverrideClick}
            disabled={CURRENT_USER_ROLE !== 'mlr-lead'}
            data-tier-override
            data-tier-override-enabled={CURRENT_USER_ROLE === 'mlr-lead'}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-[12px] font-semibold"
            style={{
              color:  CURRENT_USER_ROLE === 'mlr-lead' ? '#1E293B' : '#94A3B8',
              cursor: CURRENT_USER_ROLE === 'mlr-lead' ? 'pointer' : 'not-allowed',
            }}
          >Override tier (requires MLR Lead sign-off)</button>
        </section>
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
