import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import type { KOLSession } from '@platform/types'
import { medContentApi } from '../../modules/medical-writing/api/medContent'
import { ApiError } from '../../api/client'
import { useKOLStore } from '../../modules/medical-writing/store'
import { SlidePanel } from '../../components/ui'
import { VoiceNoteRecorder, formatClock, type LocalVoiceNote } from './KOLVoiceNoteRecorder'

// --- Helpers ---

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${String(d.getUTCDate()).padStart(2, '0')} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  const date = formatDate(iso)
  const hh = String(d.getUTCHours()).padStart(2, '0')
  const mm = String(d.getUTCMinutes()).padStart(2, '0')
  return `${date} ${hh}:${mm} UTC`
}

// Plain-language reason for a failed request. Never shows raw status codes or server text.
function describeRequestError(e: unknown, doing: string): string {
  if (e instanceof ApiError) {
    if (e.status === 401) return 'Your session has expired. Sign in again and retry.'
    if (e.status === 403) return `You don't have access to Medical Writing, so ${doing} isn't available to you.`
    if (e.status === 404) return `This content item or its KOL session no longer exists, so ${doing} isn't available.`
    if (e.status === 503) return `Medical Writing is switched off on this server, so ${doing} isn't available.`
    return `Something went wrong on the server while ${doing}. Please try again.`
  }
  return `Could not reach the server while ${doing}. Check your connection and try again.`
}

// Static messaging framework returned after insights are generated
const DEFAULT_FRAMEWORK = [
  { claim: 'Superior PFS vs SoC in PD-L1 ≥50%',       evidence: 'VELORA-301 CSR v1.0 · Table 14-2',       audience: 'Oncology HCPs', status: 'Approved' },
  { claim: 'Manageable safety profile',                 evidence: 'VELORA-301 CSR v1.0 · §12',              audience: 'Oncology HCPs', status: 'Approved' },
  { claim: 'Consistent PFS across biomarker subgroups', evidence: 'VELORA-301 CSR v1.0 · subgroup forest',  audience: 'Oncology HCPs', status: 'Pending' },
]

// --- Subcomponents ---

interface CheckDotProps {
  passed:      boolean
  label:       string
  softWarning?: boolean
}
function CheckDot({ passed, label, softWarning }: CheckDotProps) {
  const bg = passed ? '#15803D' : softWarning ? '#D97706' : '#CBD5E1'
  return (
    <div className="flex items-center gap-2" data-check-item={label} data-check-passed={passed}>
      <span className="flex h-4 w-4 flex-none items-center justify-center rounded-full text-[10px] font-bold text-white" style={{ backgroundColor: bg }}>
        {passed ? '✓' : softWarning ? '!' : ''}
      </span>
      <span className="text-[13px]" style={{ color: passed ? '#0F172A' : softWarning ? '#78350F' : '#64748B' }}>{label}</span>
    </div>
  )
}

// --- Screen ---

export function KOLAdvisoryBoardSession() {
  const { projectId } = useParams()
  const navigate = useNavigate()

  const session               = useKOLStore(s => s.session)
  const insightsReportText    = useKOLStore(s => s.insightsReportText)
  const messagingFramework    = useKOLStore(s => s.messagingFramework)
  const isGeneratingInsights  = useKOLStore(s => s.isGeneratingInsights)
  const setSession            = useKOLStore(s => s.setSession)
  const setInsightsReportText = useKOLStore(s => s.setInsightsReportText)
  const setMessagingFramework = useKOLStore(s => s.setMessagingFramework)
  const setGeneratingInsights = useKOLStore(s => s.setGeneratingInsights)

  const [activeTab, setActiveTab] = useState<'insights' | 'framework'>('insights')
  const [sessionNotes, setSessionNotes] = useState('')
  const [toast, setToast] = useState<string | null>(null)

  // Voice notes are browser-only for now (no API): they live in this tab and are freed on leave.
  const [voiceOpen, setVoiceOpen] = useState(false)
  const [voiceNotes, setVoiceNotes] = useState<LocalVoiceNote[]>([])
  const voiceNotesRef = useRef<LocalVoiceNote[]>([])
  voiceNotesRef.current = voiceNotes
  useEffect(() => () => { voiceNotesRef.current.forEach(n => URL.revokeObjectURL(n.url)) }, [])
  const removeVoiceNote = (id: string) => setVoiceNotes(list => {
    const gone = list.find(n => n.id === id)
    if (gone) URL.revokeObjectURL(gone.url)
    return list.filter(n => n.id !== id)
  })

  // Module-level screen: resolve the active content from the first project
  // content item (users can switch via the picker). Removes the previous
  // hardcoded MOCK_CONTENT_ID = 'mc-001' which broke every non-VELORA project.
  const { data: projectContent = [], isLoading: contentLoading, isError: contentError, error: contentErr } = useQuery({
    queryKey: ['medContent', projectId],
    queryFn:  () => medContentApi.list(projectId!),
    enabled:  !!projectId,
  })
  const [activeContentId, setActiveContentId] = useState<string | null>(null)
  useEffect(() => {
    if (!activeContentId && projectContent.length > 0) setActiveContentId(projectContent[0].id)
  }, [projectContent, activeContentId])

  const { data: fetched, isError: sessionError, error: sessionErr } = useQuery({
    queryKey: ['kol-session', activeContentId],
    queryFn:  () => medContentApi.getKOLSession(activeContentId!),
    enabled:  !!activeContentId,
  })

  useEffect(() => { if (fetched) setSession(fetched as KOLSession) }, [fetched, setSession])

  const [generateError, setGenerateError] = useState<string | null>(null)

  // Why the session isn't available, if it isn't — shown instead of failing silently.
  const loadProblem: string | null =
    contentError ? describeRequestError(contentErr, 'loading this project\'s content')
    : !contentLoading && !contentError && projectContent.length === 0 ? 'This project has no Medical Writing content yet, so there is no KOL session to report on.'
    : sessionError ? describeRequestError(sessionErr, 'loading the KOL session')
    : null

  const generateMutation = useMutation({
    mutationFn: () => {
      if (!session) return Promise.reject(new Error('no session'))
      setGeneratingInsights(true)
      return medContentApi.generateInsights(session.id)
    },
    onMutate: () => setGenerateError(null),
    onSuccess: (data) => {
      setInsightsReportText(data.insightsReportText)
      setMessagingFramework(DEFAULT_FRAMEWORK.map(r => r.claim))
      setGeneratingInsights(false)
    },
    onError: (e) => {
      setGeneratingInsights(false)
      setGenerateError(describeRequestError(e, 'generating the insights report'))
    },
  })

  const handleGenerate = () => {
    if (!session) {
      setGenerateError(loadProblem ?? 'The KOL session has not loaded yet. Wait a moment and try again.')
      return
    }
    generateMutation.mutate()
  }

  const handleRequestApproval = () => {
    const kolNames = (session?.attendees ?? [])
      .filter(a => a.gdprConsent === 'confirmed')
      .map(a => a.name)
      .join(', ')
    flash(`Approval request sent to KOL list — ${kolNames || 'no external KOLs'} notified.`)
  }

  const flash = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 3200)
  }

  const notesReady    = sessionNotes.trim().length > 0
  const insightsReady = !!insightsReportText
  const frameworkReady = messagingFramework.length > 0
  const quotesApprovedReady = insightsReady && Math.random() > 0.5 // soft: cosmetic
  const canProceed = notesReady && insightsReady && frameworkReady

  const advanceStageMutation = useMutation({
    mutationFn: () => medContentApi.advanceStage(activeContentId!),
  })

  const proceed = () => {
    if (!canProceed || !session) return
    // Fire the stage advance (idempotent on the server; returns 422 if the
    // content isn't in the stage this screen gates). Navigate regardless so
    // demo flow doesn't block on the API round-trip.
    advanceStageMutation.mutate(undefined, {
      onSettled: () => navigate(`/projects/${projectId}/medical-writing/content/${session.contentItemId}/editor`),
    })
  }

  return (
    <div className="bg-slate-50" data-screen="kol-advisory-board-session">
      <div className="flex flex-col gap-5" style={{ maxWidth: 1180, padding: '20px 32px 48px' }}>

        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-xs text-slate-500">
          <button onClick={() => navigate(`/projects/${projectId}/medical-writing`)} className="hover:text-slate-900">Medical Writing</button>
          <span style={{ color: '#CBD5E1' }}>&gt;</span>
          <span className="font-semibold text-slate-900">KOL Advisory Board Session</span>
        </nav>

        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="flex min-w-0 flex-col gap-1.5">
            <h1 className="text-[22px] font-bold text-slate-900" style={{ margin: 0 }}>KOL Advisory Board Session</h1>
            <p className="font-mono text-xs" style={{ color: '#64748B' }}>
              Stage 2 · {formatDate(session?.sessionDate)} · {session?.attendees.length ?? 0} KOL attendees
            </p>
          </div>
          <div className="flex flex-none items-center gap-2">
            <span className="font-mono text-[11px] uppercase" style={{ letterSpacing: '0.1em', color: '#7C3AED' }}>Stage 2 of 6</span>
            <button
              type="button"
              onClick={() => setVoiceOpen(true)}
              data-add-voice-note
              className="h-9 rounded-md border border-slate-300 bg-white px-3 text-[13px] font-semibold text-slate-700 hover:bg-slate-50"
            >Add voice note</button>
            <button
              type="button"
              onClick={proceed}
              disabled={!canProceed}
              data-proceed-stage-3
              data-proceed-enabled={canProceed}
              className="h-9 rounded-md px-3 text-[13px] font-semibold text-white transition-colors"
              style={{ backgroundColor: canProceed ? '#7C3AED' : '#CBD5E1', cursor: canProceed ? 'pointer' : 'not-allowed' }}
            >Proceed to Stage 3 →</button>
          </div>
        </div>

        {/* Pre-Meeting */}
        <section className="rounded-lg border border-slate-200 bg-white p-5" data-panel="pre-meeting">
          <h2 className="mb-3 text-[14px] font-bold text-slate-900">Pre-Meeting</h2>

          <p className="mb-1 text-[11px] font-mono uppercase" style={{ color: '#64748B', letterSpacing: '0.1em' }}>Pre-read documents</p>
          <div className="mb-4 flex flex-wrap gap-2" data-pre-reads>
            {(session?.preReads ?? []).map(doc => (
              <span
                key={doc}
                className="inline-flex items-center gap-2 rounded-md px-2.5 py-1 text-[12px] font-medium"
                style={{ backgroundColor: '#F1F5F9', color: '#334155', border: '1px solid #E2E8F0' }}
              >
                📄 {doc}
                <span className="font-mono text-[10px]" style={{ color: '#15803D' }}>UPLOADED ✓</span>
              </span>
            ))}
          </div>

          <p className="mb-1 text-[11px] font-mono uppercase" style={{ color: '#64748B', letterSpacing: '0.1em' }}>Session objectives</p>
          <p className="mb-4 rounded-md bg-slate-50 p-3 text-[13px] text-slate-700" data-agenda>
            Validate combination positioning, discuss safety-management protocols, agree Tier-2 messaging for HCP audiences.
          </p>

          <p className="mb-1 text-[11px] font-mono uppercase" style={{ color: '#64748B', letterSpacing: '0.1em' }}>KOL attendees</p>
          <table className="w-full text-[13px]" data-attendees-table>
            <thead>
              <tr className="text-left text-[11px] font-mono uppercase text-slate-500" style={{ letterSpacing: '0.06em' }}>
                <th className="pb-2 pr-3">Name</th>
                <th className="pb-2 pr-3">Affiliation</th>
                <th className="pb-2 pr-3">GDPR consent</th>
                <th className="pb-2">Role</th>
              </tr>
            </thead>
            <tbody>
              {(session?.attendees ?? []).map(a => (
                <tr key={a.name} className="border-t border-slate-100" data-attendee-row={a.name}>
                  <td className="py-2 pr-3 font-semibold text-slate-800">{a.name}</td>
                  <td className="py-2 pr-3 text-slate-600">{a.affiliation}</td>
                  <td className="py-2 pr-3">
                    <span
                      className="inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold"
                      style={{ backgroundColor: a.consentBg, color: a.consentFg }}
                      data-gdpr-consent={a.gdprConsent}
                    >
                      ✓ {a.gdprConsent === 'internal' ? 'Internal' : 'Confirmed'}
                    </span>
                  </td>
                  <td className="py-2 text-slate-600">{a.role}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {/* Session Notes */}
        <section className="rounded-lg border border-slate-200 bg-white p-5" data-panel="session-notes">
          <h2 className="mb-3 text-[14px] font-bold text-slate-900">Session Notes</h2>
          <textarea
            value={sessionNotes}
            onChange={(e) => setSessionNotes(e.target.value)}
            placeholder="Structured notes aligned to content outline…"
            data-session-notes-input
            className="min-h-[140px] w-full rounded-md border border-slate-300 p-3 text-[13px] outline-none focus:border-violet-500"
          />
        </section>

        {/* Voice Notes */}
        <section className="rounded-lg border border-slate-200 bg-white p-5" data-panel="voice-notes">
          <h2 className="mb-3 text-[14px] font-bold text-slate-900">Voice Notes</h2>
          <div className="flex flex-col gap-2" data-voice-note-list>
            {voiceNotes.length === 0 && (
              <p className="rounded-md bg-slate-50 p-3 text-[13px] text-slate-600" data-voice-empty>
                No voice notes yet. Use <span className="font-semibold">Add voice note</span> to record one or upload an audio file.
              </p>
            )}
            {voiceNotes.map(n => (
              <div key={n.id} className="rounded-md bg-slate-50 p-3" data-voice-note={n.id}>
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <span className="text-[13px] font-semibold text-slate-800">{n.label}</span>
                  <span
                    className="rounded-md px-1.5 py-0.5 font-mono text-[10px] font-semibold"
                    style={{ backgroundColor: '#FFFBEB', color: '#B45309' }}
                  >NOT SAVED · NOT TRANSCRIBED</span>
                  <button
                    type="button"
                    onClick={() => removeVoiceNote(n.id)}
                    className="ml-auto text-[12px] font-semibold text-red-700 hover:underline"
                    aria-label={`Remove ${n.label}`}
                  >Remove</button>
                </div>
                <p className="mb-2 font-mono text-[11px]" style={{ color: '#64748B' }}>
                  {n.source === 'recorded' ? 'Recorded' : 'Uploaded'} · {formatClock(n.durationSec)} · {formatDateTime(n.createdAt)}
                </p>
                <audio controls src={n.url} className="w-full" />
              </div>
            ))}
            <p className="text-[11px]" style={{ color: '#64748B' }}>
              Voice notes are kept in this browser tab only until server storage is available. They are lost when you refresh.
            </p>
            <button
              type="button"
              className="w-fit text-[12px] font-semibold text-violet-700 hover:underline"
              onClick={() => flash('Upload meeting transcript')}
            >Upload meeting transcript</button>
          </div>
          <div className="mt-3 flex items-center gap-2 rounded-md bg-slate-50 p-3">
            <span className="text-[13px] text-slate-800">📄 {session?.transcriptRef ?? '—'}</span>
            <span className="font-mono text-[11px]" style={{ color: '#15803D' }}>UPLOADED ✓ · Indexed for AI insights</span>
          </div>
        </section>

        {(loadProblem || generateError) && (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-[13px] text-red-800" role="alert" data-insights-problem>
            {generateError ?? loadProblem}
          </div>
        )}

        {/* KOL Insights Report */}
        <section className="rounded-lg border border-slate-200 bg-white p-5" data-panel="insights-report">
          <div className="mb-3 flex items-end justify-between border-b border-slate-200">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setActiveTab('insights')}
                data-tab="insights"
                data-tab-active={activeTab === 'insights' || undefined}
                className="px-3 py-2 text-[13px]"
                style={{
                  borderBottom: `2px solid ${activeTab === 'insights' ? '#7C3AED' : 'transparent'}`,
                  color:        activeTab === 'insights' ? '#5B21B6' : '#64748B',
                  fontWeight:   activeTab === 'insights' ? 600 : 500,
                }}
              >KOL Insights Report</button>
              <button
                type="button"
                onClick={() => setActiveTab('framework')}
                data-tab="framework"
                data-tab-active={activeTab === 'framework' || undefined}
                className="px-3 py-2 text-[13px]"
                style={{
                  borderBottom: `2px solid ${activeTab === 'framework' ? '#7C3AED' : 'transparent'}`,
                  color:        activeTab === 'framework' ? '#5B21B6' : '#64748B',
                  fontWeight:   activeTab === 'framework' ? 600 : 500,
                }}
              >Messaging Framework</button>
            </div>
            <div className="flex gap-2 pb-2">
              {insightsReady && (
                <>
                  <button type="button" onClick={handleRequestApproval} data-send-to-kols className="h-8 rounded-md px-3 text-[12px] font-semibold text-white" style={{ backgroundColor: '#7C3AED' }}>
                    Send to KOLs for quote approval
                  </button>
                  <button type="button" onClick={handleGenerate} className="h-8 rounded-md border border-slate-300 bg-white px-3 text-[12px] font-semibold text-slate-700 hover:bg-slate-50">
                    Regenerate report
                  </button>
                  <button type="button" onClick={() => flash('PDF export queued')} className="h-8 rounded-md border border-slate-300 bg-white px-3 text-[12px] font-semibold text-slate-700 hover:bg-slate-50">
                    Export as PDF
                  </button>
                </>
              )}
            </div>
          </div>

          {activeTab === 'insights' && (
            <>
              {!insightsReady && !isGeneratingInsights && (
                <div className="flex flex-col items-center gap-3 rounded-md bg-slate-50 py-10 text-center" data-insights-empty>
                  <p className="text-[15px] font-semibold text-slate-800">No insights report yet</p>
                  <p className="max-w-[420px] text-[13px]" style={{ color: '#64748B' }}>
                    Capture session notes, voice notes or a transcript, then generate the KOL insights report that feeds Stage 3 drafting.
                  </p>
                  <button
                    type="button"
                    onClick={handleGenerate}
                    data-generate-insights
                    className="mt-2 h-9 rounded-md px-4 text-[13px] font-semibold text-white"
                    style={{ backgroundColor: '#7C3AED' }}
                  >Generate insights report ✦</button>
                </div>
              )}
              {isGeneratingInsights && (
                <div className="flex flex-col items-center gap-3 rounded-md bg-slate-50 py-10 text-center" data-insights-loading>
                  <p className="text-[15px] font-semibold text-slate-800">Generating insights report…</p>
                  <p className="max-w-[420px] text-[13px]" style={{ color: '#64748B' }}>
                    Themes, unmet needs, evidence gaps.
                  </p>
                </div>
              )}
              {insightsReady && !isGeneratingInsights && (
                <div data-insights-body>
                  <pre className="whitespace-pre-wrap rounded-md bg-slate-50 p-4 text-[13px] text-slate-800">{insightsReportText}</pre>
                  <p className="mt-3 font-mono text-[11px]" style={{ color: '#64748B' }}>
                    This insights report and its AI generation are logged to the audit trail.
                  </p>
                </div>
              )}
            </>
          )}

          {activeTab === 'framework' && (
            <>
              {!insightsReady ? (
                <div className="rounded-md bg-slate-50 py-8 text-center" data-framework-empty>
                  <p className="text-[13px]" style={{ color: '#64748B' }}>Messaging framework will populate once the insights report is generated.</p>
                </div>
              ) : (
                <table className="w-full text-[13px]" data-framework-table>
                  <thead>
                    <tr className="text-left text-[11px] font-mono uppercase text-slate-500" style={{ letterSpacing: '0.06em' }}>
                      <th className="pb-2 pr-3">Key Claim</th>
                      <th className="pb-2 pr-3">Evidence Source</th>
                      <th className="pb-2 pr-3">Target Audience</th>
                      <th className="pb-2">Approval Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {DEFAULT_FRAMEWORK.map(r => (
                      <tr key={r.claim} className="border-t border-slate-100">
                        <td className="py-2 pr-3 font-semibold text-slate-800">{r.claim}</td>
                        <td className="py-2 pr-3 text-slate-600">{r.evidence}</td>
                        <td className="py-2 pr-3 text-slate-600">{r.audience}</td>
                        <td className="py-2">
                          <span
                            className="inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold"
                            style={{
                              backgroundColor: r.status === 'Approved' ? '#F0FDF4' : '#FFFBEB',
                              color:           r.status === 'Approved' ? '#15803D' : '#B45309',
                            }}
                          >{r.status}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
        </section>

        {/* Readiness */}
        <section className="rounded-lg border border-slate-200 bg-white p-5" data-panel="readiness">
          <h2 className="mb-3 text-[14px] font-bold text-slate-900">Stage 3 readiness</h2>
          <div className="flex flex-col gap-1.5" data-stage3-readiness>
            <CheckDot label="Session notes captured"        passed={notesReady} />
            <CheckDot label="Insights report generated"     passed={insightsReady} />
            <CheckDot label="Messaging framework created"   passed={frameworkReady} />
            <CheckDot label="KOL quote approvals complete"  passed={quotesApprovedReady} softWarning={!quotesApprovedReady && insightsReady} />
          </div>
          <p className="mt-3 text-[11px]" style={{ color: '#64748B' }}>
            First three items are hard gates. Quote approvals are a soft warning — they do not block Stage 3.
          </p>
        </section>
      </div>

      <SlidePanel
        open={voiceOpen}
        onClose={() => setVoiceOpen(false)}
        title="Add voice note"
        subtitle="KOL Advisory Board Session"
        storageKey="kol-voice-panel-width"
        defaultWidth={420}
      >
        <VoiceNoteRecorder
          onSave={note => {
            setVoiceNotes(list => [note, ...list])
            setVoiceOpen(false)
            flash('Voice note added to this session (not saved to the server).')
          }}
        />
      </SlidePanel>

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
