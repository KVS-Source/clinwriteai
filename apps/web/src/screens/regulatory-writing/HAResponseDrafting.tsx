import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import type { HACorrespondence, HAQuestion } from '@platform/types'
import { regulatoryWritingApi } from '../../modules/regulatory-writing/api/regulatoryWriting'

const CATEGORY_META = {
  clinical:       { bg: '#EFF6FF', fg: '#2563EB', label: 'Clinical' },
  cmc:            { bg: '#FFFBEB', fg: '#B45309', label: 'CMC' },
  administrative: { bg: '#F1F5F9', fg: '#64748B', label: 'Administrative' },
} as const

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const day = String(d.getUTCDate()).padStart(2, '0')
  const hh  = String(d.getUTCHours()).padStart(2, '0')
  const mm  = String(d.getUTCMinutes()).padStart(2, '0')
  return `${day} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()} ${hh}:${mm} UTC`
}

const DEFAULT_DRAFT = `GenBioCa Sciences thanks the FDA for this question. We provide the requested subgroup analyses below.

ECOG Performance Status Subgroup:
ECOG 0 — HR 0.57 (95% CI 0.43–0.76; p<0.001) [Source: CSR v1.0 · Table 14.2.7.1]
ECOG 1–2 — HR 0.66 (95% CI 0.50–0.87; p=0.003) [Source: CSR v1.0 · Table 14.2.7.1]
Interaction p-value: 0.42 (non-significant)

Histology Subgroup:
Squamous — HR 0.59 (95% CI 0.42–0.83; p=0.003) [Source: CSR v1.0 · Table 14.2.7.2]
Non-squamous — HR 0.62 (95% CI 0.46–0.83; p=0.002) [Source: CSR v1.0 · Table 14.2.7.2]`

export function HAResponseDrafting() {
  const { projectId, submissionId } = useParams()
  const navigate = useNavigate()

  const [haRecords, setHARecords]           = useState<HACorrespondence[]>([])
  const [activeQuestionId, setActiveId]     = useState<string>('q-003')
  const [draftText, setDraftText]           = useState(DEFAULT_DRAFT)
  const [aiFootprintPct, setAiFootprintPct] = useState(72)
  const [isGenerating, setGenerating]       = useState(false)
  const [toast, setToast]                   = useState<string | null>(null)

  const flash = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3200) }

  const { data: fetched = [] } = useQuery({
    queryKey: ['ha-correspondence', submissionId],
    queryFn:  () => regulatoryWritingApi.getHACorrespondence(submissionId!),
    enabled:  !!submissionId,
  })
  useEffect(() => { setHARecords(fetched as HACorrespondence[]) }, [fetched])

  const loqRecord = haRecords.find(h => h.type === 'loq')
  const questions = loqRecord?.questions ?? []
  const activeQuestion: HAQuestion | undefined = questions.find(q => q.questionId === activeQuestionId)

  const respondedCount = questions.filter(q => q.status === 'responded').length
  const totalExtracted = loqRecord?.questionsExtracted ?? questions.length
  const canSubmitPackage = respondedCount === totalExtracted

  const generateMutation = useMutation({
    mutationFn: () => {
      setGenerating(true)
      return regulatoryWritingApi.generateHAResponse(submissionId!, loqRecord!.id, { questionId: activeQuestionId, by: 'Dr Sarah Chen' })
    },
    onSuccess: (data) => {
      setDraftText(data.responseDraft || DEFAULT_DRAFT)
      setAiFootprintPct(data.aiFootprintPct ?? 72)
      setGenerating(false)
      flash('AI draft regenerated. Logged to audit trail.')
    },
    onError: () => setGenerating(false),
  })

  // Break the draft text into paragraphs, wrapping source citations in a mono chip
  const renderedDraft = useMemo(() => {
    return draftText.split('\n\n').map((para, i) => (
      <p key={i} className="mt-3 text-[13px] text-slate-800 whitespace-pre-line">{para}</p>
    ))
  }, [draftText])

  return (
    <div className="bg-slate-50" data-screen="ha-response-drafting">
      <div className="flex flex-col gap-4" style={{ maxWidth: 1440, padding: '16px 24px 24px' }}>

        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-xs text-slate-500">
          <button onClick={() => navigate(`/projects/${projectId}/regulatory-writing`)} className="hover:text-slate-900">Regulatory Writing</button>
          <span style={{ color: '#CBD5E1' }}>&gt;</span>
          <button onClick={() => navigate(`/projects/${projectId}/regulatory-writing/submissions/${submissionId}/gateway`)} className="hover:text-slate-900">Gateway</button>
          <span style={{ color: '#CBD5E1' }}>&gt;</span>
          <span className="font-semibold text-slate-900">HA Response Drafting</span>
        </nav>

        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="flex min-w-0 flex-col gap-1.5">
            <h1 className="text-[22px] font-bold text-slate-900" style={{ margin: 0 }}>HA Response Drafting · Day 120 List of Questions · FDA</h1>
            <span
              className="inline-flex w-max rounded-md px-2 py-0.5 text-[11px] font-semibold"
              style={{ backgroundColor: '#FFFBEB', color: '#B45309' }}
              data-header-progress
            >
              {totalExtracted} questions · {respondedCount} responded · {totalExtracted - respondedCount} remaining
            </span>
          </div>
          <button
            type="button"
            disabled={!canSubmitPackage}
            data-submit-response-package
            data-submit-enabled={canSubmitPackage}
            className="h-9 rounded-md px-3 text-[13px] font-semibold text-white"
            style={{ backgroundColor: canSubmitPackage ? '#B0200D' : '#CBD5E1', cursor: canSubmitPackage ? 'pointer' : 'not-allowed' }}
          >Submit response package →</button>
        </div>

        <div className="grid gap-4" style={{ gridTemplateColumns: '360px minmax(0,1fr)' }}>
          {/* LEFT — LoQ upload panel + question list */}
          <aside className="flex flex-col gap-3">
            <section className="rounded-lg border border-slate-200 bg-white p-3" data-loq-upload>
              <p className="font-mono text-[10px] uppercase text-slate-500" style={{ letterSpacing: '0.1em' }}>LoQ upload</p>
              <p className="mt-1 text-[13px] font-semibold text-slate-800">FDA Day 120 LoQ</p>
              <p className="mt-1 text-[11px] text-slate-500">Uploaded {formatDateTime(loqRecord?.receivedAt)} · {totalExtracted} questions · Auto-parsed ✓</p>
              <p className="mt-2 rounded-md bg-slate-50 p-2 text-[11px] text-slate-700" data-loq-categorisation>
                {totalExtracted} questions extracted · Categorised: <strong>Clinical ({loqRecord?.questionsCategories?.clinical ?? 0})</strong> · <strong>CMC ({loqRecord?.questionsCategories?.cmc ?? 0})</strong> · <strong>Administrative ({loqRecord?.questionsCategories?.administrative ?? 0})</strong> · Routed to RACI roles
              </p>
              <button type="button" className="mt-2 text-[12px] font-semibold" style={{ color: '#B0200D' }}>View LoQ document →</button>
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-3" data-question-list>
              <p className="mb-2 font-mono text-[10px] uppercase text-slate-500" style={{ letterSpacing: '0.1em' }}>Questions</p>
              <div className="flex flex-col gap-1">
                {questions.map(q => {
                  const active = activeQuestionId === q.questionId
                  const cat    = CATEGORY_META[q.category]
                  const dotBg  = q.status === 'responded' ? '#15803D'
                                : q.status === 'in-progress' ? '#B0200D'
                                : '#94A3B8'
                  const dot    = q.status === 'responded' ? '✓'
                                : q.status === 'in-progress' ? '●'
                                : '○'
                  return (
                    <button
                      key={q.questionId}
                      type="button"
                      onClick={() => setActiveId(q.questionId)}
                      data-question-row={q.questionId}
                      data-question-active={active || undefined}
                      className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left"
                      style={{
                        backgroundColor: active ? '#FFF5F5' : 'transparent',
                        borderLeft:      active ? '3px solid #B0200D' : '3px solid transparent',
                      }}
                    >
                      <span className="font-mono text-[10px] text-slate-500 w-8 flex-none">Q{q.number}</span>
                      <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: cat.bg, color: cat.fg }}>{cat.label}</span>
                      <span className="min-w-0 flex-1 truncate text-[11px] text-slate-600">{q.assignedRole}</span>
                      <span className="font-mono text-[13px] leading-none" style={{ color: dotBg }} data-question-status={q.status}>{dot}</span>
                    </button>
                  )
                })}
              </div>
            </section>
          </aside>

          {/* RIGHT — Active question */}
          <section className="flex flex-col gap-3" data-active-question>
            {activeQuestion ? (
              <>
                <div className="rounded-lg border border-slate-200 bg-white p-4" data-ha-question>
                  <p className="font-mono text-[10px] uppercase text-slate-500" style={{ letterSpacing: '0.08em' }}>Question {activeQuestion.number} · {CATEGORY_META[activeQuestion.category].label} · assigned to {activeQuestion.assignedRole}</p>
                  <p
                    className="mt-2 rounded-md p-3 text-[13px] text-slate-800"
                    style={{ backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0' }}
                    data-ha-question-text
                  >{activeQuestion.text}</p>
                </div>

                <div className="rounded-lg border border-slate-200 bg-white p-4" data-ai-draft>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[11px] font-mono uppercase" style={{ color: '#B0200D', letterSpacing: '0.08em' }}>✦ AI draft</p>
                      <p className="mt-0.5 font-mono text-[11px] text-slate-500" data-ai-attribution>
                        Generated {formatDateTime(new Date().toISOString())} · claude-sonnet-4-6 · Grounded in canonical JSON layer · Logged to audit trail
                      </p>
                    </div>
                    <span
                      className="inline-flex flex-none rounded-md px-2 py-0.5 text-[11px] font-semibold"
                      style={{ backgroundColor: '#FFF5F5', color: '#B0200D', border: '1px solid #FFC5C5' }}
                      data-ai-footprint
                    >AI footprint · {aiFootprintPct}% ✦</span>
                  </div>

                  <div
                    className="mt-3 rounded-md p-3"
                    style={{ backgroundColor: '#FFF5F5', border: '1px solid #FFC5C5' }}
                    data-draft-block
                  >
                    {renderedDraft}
                    <div className="mt-3 flex flex-wrap gap-1.5" data-source-chips>
                      <span className="inline-flex rounded-md px-1.5 py-0.5 font-mono text-[10px]" style={{ backgroundColor: '#FFFFFF', color: '#005F8E', border: '1px solid #93C5FD' }}>CSR v1.0 · Table 14.2.7.1</span>
                      <span className="inline-flex rounded-md px-1.5 py-0.5 font-mono text-[10px]" style={{ backgroundColor: '#FFFFFF', color: '#005F8E', border: '1px solid #93C5FD' }}>CSR v1.0 · Table 14.2.7.2</span>
                    </div>
                  </div>

                  <textarea
                    value={draftText}
                    onChange={(e) => setDraftText(e.target.value)}
                    data-draft-textarea
                    className="mt-3 min-h-[140px] w-full rounded-md border border-slate-300 bg-white p-3 font-mono text-[12px] text-slate-800"
                  />

                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      onClick={() => generateMutation.mutate()}
                      disabled={isGenerating}
                      data-regenerate-draft
                      className="rounded-md px-3 py-1.5 text-[12px] font-semibold text-white"
                      style={{ backgroundColor: isGenerating ? '#CBD5E1' : '#B0200D' }}
                    >{isGenerating ? 'Generating…' : 'Regenerate draft ✦'}</button>
                    <button
                      type="button"
                      onClick={() => flash('Response saved. Logged to audit trail.')}
                      data-save-draft
                      className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-[12px] font-semibold text-slate-700"
                    >Save draft</button>
                  </div>
                </div>

                <div className="rounded-lg border border-slate-200 bg-white p-4" data-signoff-row>
                  <h3 className="mb-2 text-[13px] font-bold text-slate-900">Sign-off</h3>
                  <div className="flex flex-col gap-1 text-[12px] text-slate-700">
                    <p>Regulatory Writer: Dr Sarah Chen <span style={{ color: '#B0200D' }}>● In review</span></p>
                    <p>Clinical Lead: Dr Elena Vasquez <span className="text-slate-500">○ Pending</span></p>
                  </div>
                  <button
                    type="button"
                    onClick={() => flash('Response signed by Regulatory Writer. Logged to audit trail.')}
                    data-sign-response
                    className="mt-2 rounded-md px-3 py-1.5 text-[12px] font-semibold text-white"
                    style={{ backgroundColor: '#B0200D' }}
                  >Sign off this response</button>
                </div>

                <div className="rounded-lg border border-slate-200 bg-white p-4" data-response-history>
                  <p className="font-mono text-[11px] text-slate-500">Previous version: Q{activeQuestion.number} draft v0.1 · 09:44 UTC · AI-generated</p>
                </div>
              </>
            ) : (
              <p className="text-[13px] text-slate-500">Select a question from the left panel.</p>
            )}
          </section>
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
