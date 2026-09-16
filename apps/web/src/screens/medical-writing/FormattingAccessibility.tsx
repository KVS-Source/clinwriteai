import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useFormattingStore } from '../../modules/medical-writing/store'
import type { WCAGResult } from '../../modules/medical-writing/store'

// --- Initial WCAG state — one Contrast failure per brief ---
const INITIAL_WCAG: WCAGResult = {
  runAt:  '2026-10-19T09:10:00Z',
  passed: false,
  score:  82,
  failures: [
    {
      id:        'wcag-cf-001',
      criterion: 'WCAG 1.4.3 — Contrast failure',
      severity:  'must-fix',
      slide:     'Slide 22',
      detail:    'Contrast ratio: 2.8:1 (required: ≥4.5:1 for normal text, ≥3:1 for large text). Change text colour from #94A3B8 to #475569 on slide 22 background #FFFFFF to achieve 5.9:1.',
      fixed:     false,
    },
  ],
}

// --- Static channels + locales ---

const CHANNEL_OPTIONS = [
  { id: 'Congress',           active: true },
  { id: 'Rep Detail Aid',     active: true },
  { id: 'Digital',            active: false },
  { id: 'Print',              active: false },
  { id: 'Email distribution', active: false },
]

const DEFAULT_LOCALES = [
  { code: 'en-GB', label: 'English (Parent)', status: 'MLR Approved',      affiliate: null,                                                assigned: null },
  { code: 'fr-FR', label: 'French (FR)',      status: 'Local MLR pending', affiliate: 'GenBioCa France',                                   assigned: '19 Oct 2026' },
]

function formatDateTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  const hh = String(d.getUTCHours()).padStart(2, '0')
  const mm = String(d.getUTCMinutes()).padStart(2, '0')
  return `${hh}:${mm} UTC`
}

interface CheckDotProps { passed: boolean; label: string }
function CheckDot({ passed, label }: CheckDotProps) {
  return (
    <div className="flex items-center gap-2" data-check-item={label} data-check-passed={passed}>
      <span className="flex h-4 w-4 flex-none items-center justify-center rounded-full text-[10px] font-bold text-white" style={{ backgroundColor: passed ? '#15803D' : '#94A3B8' }}>{passed ? '✓' : ''}</span>
      <span className="text-[13px]" style={{ color: passed ? '#0F172A' : '#64748B' }}>{label}</span>
    </div>
  )
}

export function FormattingAccessibility() {
  const { projectId, contentId } = useParams()
  const navigate = useNavigate()

  const wcagResult      = useFormattingStore(s => s.wcagResult)
  const isRunning       = useFormattingStore(s => s.isRunningWCAG)
  const setWCAGResult   = useFormattingStore(s => s.setWCAGResult)
  const setRunningWCAG  = useFormattingStore(s => s.setRunningWCAG)
  const markFailureFixed = useFormattingStore(s => s.markFailureFixed)

  const [channels, setChannels] = useState<Record<string, boolean>>(
    Object.fromEntries(CHANNEL_OPTIONS.map(c => [c.id, c.active]))
  )
  const [toast, setToast] = useState<string | null>(null)

  const flash = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3400) }

  useEffect(() => { if (!wcagResult) setWCAGResult(INITIAL_WCAG) }, [wcagResult, setWCAGResult])

  const handleRunWCAG = () => {
    setRunningWCAG(true)
    setTimeout(() => {
      const failures = (wcagResult?.failures ?? INITIAL_WCAG.failures)
      const allFixed = failures.every(f => f.fixed)
      setWCAGResult({
        runAt:  new Date().toISOString(),
        passed: allFixed,
        score:  allFixed ? 100 : 82,
        failures,
      })
      setRunningWCAG(false)
      flash(allFixed ? 'WCAG 2.1 AA · 48 tests pass · HTML unlocked.' : 'WCAG re-run complete · issues remain.')
    }, 3000)
  }

  const handleApplyFix = (failureId: string) => {
    markFailureFixed(failureId)
    flash(`Fix applied to ${failureId}. Re-run the WCAG check to confirm.`)
  }

  const htmlPassed = wcagResult?.passed ?? false
  const anyChannelSelected = Object.values(channels).some(Boolean)

  const checklist = [
    { label: 'Output formats generated',          passed: true },
    { label: 'WCAG 2.1 AA check passed',          passed: htmlPassed },
    { label: 'Distribution channels confirmed',   passed: anyChannelSelected },
    { label: 'Channel tags applied to all outputs', passed: anyChannelSelected },
  ]
  const canProceed = checklist.every(c => c.passed)

  const proceed = () => {
    if (!canProceed) return
    navigate(`/projects/${projectId}/medical-writing/content/${contentId}/final`)
  }

  const toggleChannel = (id: string) => setChannels(c => ({ ...c, [id]: !c[id] }))

  return (
    <div className="bg-slate-50" data-screen="formatting-accessibility">
      <div className="flex flex-col gap-4" style={{ maxWidth: 1180, padding: '20px 32px 40px' }}>

        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-xs text-slate-500">
          <button onClick={() => navigate(`/projects/${projectId}/medical-writing`)} className="hover:text-slate-900">Medical Writing</button>
          <span style={{ color: '#CBD5E1' }}>&gt;</span>
          <span className="font-semibold text-slate-900">Formatting &amp; Accessibility</span>
        </nav>

        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="flex min-w-0 flex-col gap-1.5">
            <h1 className="text-[22px] font-bold text-slate-900" style={{ margin: 0 }}>Formatting &amp; Accessibility</h1>
            <p className="font-mono text-xs" style={{ color: '#64748B' }}>Stage 5 · MLR Approved · Format for distribution</p>
          </div>
          <div className="flex flex-none gap-2">
            <button
              type="button"
              onClick={handleRunWCAG}
              disabled={isRunning}
              data-run-wcag
              className="h-9 rounded-md border border-slate-300 bg-white px-3 text-[13px] font-semibold text-slate-700 hover:bg-slate-50"
            >{isRunning ? 'Running…' : 'Run WCAG check'}</button>
            <button
              type="button"
              onClick={proceed}
              disabled={!canProceed}
              data-proceed-stage-6
              data-proceed-enabled={canProceed}
              className="h-9 rounded-md px-3 text-[13px] font-semibold text-white"
              style={{ backgroundColor: canProceed ? '#7C3AED' : '#CBD5E1', cursor: canProceed ? 'pointer' : 'not-allowed' }}
            >Proceed to Stage 6 →</button>
          </div>
        </div>

        {/* MLR Approval strip */}
        <div className="rounded-md px-3 py-2" style={{ backgroundColor: '#F0FDF4', border: '1px solid #BBF7D0' }} data-mlr-approval>
          <p className="text-[13px]" style={{ color: '#166534' }}>
            <strong>MLR Approved · 18 Oct 2026 · Tier 2 Standard Review</strong>
          </p>
          <p className="text-[11px]" style={{ color: '#166534' }}>Dr Rebecca Morton (MLR Lead) · e-signature on file</p>
        </div>

        {/* Output Formats */}
        <section className="rounded-lg border border-slate-200 bg-white p-5" data-output-formats>
          <h2 className="mb-3 text-[14px] font-bold text-slate-900">Output Formats</h2>
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
            {[
              { id: 'PDF',  ready: true },
              { id: 'PPTX', ready: true },
              { id: 'HTML', ready: htmlPassed },
            ].map(f => (
              <div key={f.id} className="rounded-md border border-slate-200 p-3" data-format-card={f.id}>
                <p className="text-[13px] font-semibold">{f.id}</p>
                <span
                  className="mt-1 inline-flex rounded-md px-2 py-0.5 text-[11px] font-semibold"
                  style={{ backgroundColor: f.ready ? '#F0FDF4' : '#FFFBEB', color: f.ready ? '#166534' : '#B45309' }}
                  data-format-status={f.id}
                >
                  {f.ready ? 'Ready ✓' : 'WCAG check required'}
                </span>
                <button
                  type="button"
                  disabled={!f.ready}
                  data-download={f.id}
                  className="mt-2 h-8 w-full rounded-md text-[12px] font-semibold"
                  style={{
                    backgroundColor: f.ready ? '#7C3AED' : '#F1F5F9',
                    color:           f.ready ? '#FFFFFF' : '#94A3B8',
                    cursor:          f.ready ? 'pointer' : 'not-allowed',
                  }}
                >Download</button>
              </div>
            ))}
          </div>
          <button
            type="button"
            className="mt-3 text-[12px] font-semibold text-violet-700 hover:underline"
            data-download-all
          >Download all ready formats (.zip)</button>
        </section>

        {/* WCAG panel */}
        <section className="rounded-lg border border-slate-200 bg-white p-5" data-wcag-panel>
          <h2 className="mb-2 text-[14px] font-bold text-slate-900">WCAG 2.1 Level AA — Content Output Check</h2>

          {isRunning && (
            <p className="text-[13px]" style={{ color: '#64748B' }} data-wcag-loading>Running WCAG 2.1 AA check…</p>
          )}

          {!isRunning && wcagResult && !wcagResult.passed && (
            <div>
              {wcagResult.failures.map(f => (
                <div key={f.id} className="rounded-md border border-amber-200 bg-amber-50 p-3" data-wcag-failure={f.id}>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[13px] font-semibold" style={{ color: '#78350F' }}>{f.criterion}</p>
                    <button
                      type="button"
                      className="text-[12px] font-semibold text-violet-700 hover:underline"
                      data-wcag-jump-slide
                    >Jump to {f.slide} →</button>
                  </div>
                  <p className="mt-1 text-[13px] text-amber-900">{f.detail}</p>
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() => handleApplyFix(f.id)}
                      data-apply-fix={f.id}
                      className="rounded-md px-3 py-1.5 text-[12px] font-semibold text-white"
                      style={{ backgroundColor: '#7C3AED' }}
                    >Apply suggested fix</button>
                    {f.fixed && (
                      <span
                        className="inline-flex items-center rounded-md px-2 py-1 text-[11px] font-semibold"
                        style={{ backgroundColor: '#F0FDF4', color: '#15803D' }}
                        data-fix-applied
                      >Fix applied ✓</span>
                    )}
                  </div>
                </div>
              ))}
              <p className="mt-2 text-[12px]" style={{ color: '#78350F' }}>
                After fixing, re-run the WCAG check to confirm.
              </p>
              <p className="mt-1 font-mono text-[11px]" style={{ color: '#64748B' }} data-wcag-stamp>
                Last run: {formatDateTime(wcagResult.runAt)}
              </p>
            </div>
          )}

          {!isRunning && wcagResult && wcagResult.passed && (
            <div
              className="rounded-md p-3"
              style={{ backgroundColor: '#F0FDF4', border: '1px solid #BBF7D0' }}
              data-wcag-passed
            >
              <p className="text-[13px] font-semibold" style={{ color: '#166534' }}>All 48 tests pass at Level AA.</p>
              <p className="text-[12px]" style={{ color: '#166534' }}>HTML output is cleared and Stage 6 is unlocked.</p>
              <p className="mt-1 font-mono text-[11px]" style={{ color: '#166534' }}>Last run: {formatDateTime(wcagResult.runAt)}</p>
            </div>
          )}
        </section>

        {/* Distribution Channels */}
        <section className="rounded-lg border border-slate-200 bg-white p-5" data-distribution-channels>
          <h2 className="text-[14px] font-bold text-slate-900">Distribution Channels</h2>
          <p className="mt-1 text-[12px]" style={{ color: '#64748B' }}>Channel tags travel with the content item and its Master Library cards.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {CHANNEL_OPTIONS.map(c => {
              const active = channels[c.id]
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => toggleChannel(c.id)}
                  data-channel-chip={c.id}
                  data-channel-active={active || undefined}
                  className="rounded-md px-3 py-1.5 text-[12px] font-medium"
                  style={{
                    backgroundColor: active ? '#F5F3FF' : '#FFFFFF',
                    color:           active ? '#5B21B6' : '#64748B',
                    border:          active ? '1px solid #DDD6FE' : '1px solid #E2E8F0',
                    borderLeft:      active ? '3px solid #7C3AED' : '1px solid #E2E8F0',
                  }}
                >{c.id}{active ? ' ✓' : ''}</button>
              )
            })}
          </div>
        </section>

        {/* Localisation */}
        <section className="rounded-lg border border-slate-200 bg-white p-5" data-localisation>
          <h2 className="text-[14px] font-bold text-slate-900">Localisation · Browser-native localisation · Shared Master Library model</h2>
          <div className="mt-3 flex flex-col gap-2">
            {DEFAULT_LOCALES.map(l => {
              const approved = l.status === 'MLR Approved'
              return (
                <div key={l.code} className="flex flex-wrap items-center gap-3 rounded-md border border-slate-200 p-3" data-locale-row={l.code}>
                  <span className="font-mono text-[11px] text-slate-500">{l.code}</span>
                  <span className="text-[13px] font-semibold text-slate-800">{l.label}</span>
                  <span
                    className="ml-auto inline-flex rounded-md px-2 py-0.5 text-[11px] font-semibold"
                    style={{ backgroundColor: approved ? '#F0FDF4' : '#FFFBEB', color: approved ? '#166534' : '#B45309' }}
                  >{l.status}</span>
                  {l.affiliate && (
                    <span className="text-[11px]" style={{ color: '#64748B' }}>Affiliate: {l.affiliate} · Assigned {l.assigned}</span>
                  )}
                </div>
              )
            })}
          </div>
          <button
            type="button"
            onClick={() => flash('Local MLR review chain — French affiliate (GenBioCa France) · Separate sign-off chain · Cards push to shared Master Library on approval.')}
            data-view-local-mlr
            className="mt-2 text-[12px] font-semibold text-violet-700 hover:underline"
          >View local MLR chain →</button>
          <button type="button" onClick={() => flash('Add locale — POST /med-content/:id/locales')} className="ml-3 mt-2 text-[12px] font-semibold text-violet-700 hover:underline" data-add-locale>Add locale</button>
        </section>

        {/* Stage 5 checklist */}
        <section className="rounded-lg border border-slate-200 bg-white p-5" data-stage5-checklist>
          <h2 className="mb-2 text-[14px] font-bold text-slate-900">Stage 5 Checklist</h2>
          <div className="flex flex-col gap-1.5">
            {checklist.map(c => <CheckDot key={c.label} passed={c.passed} label={c.label} />)}
          </div>
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
