import { useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import type { MedClaim, MedContentItem } from '@platform/types'
import { MED_CONTENT_TYPE_META } from '@platform/types'
import { medContentApi } from '../../modules/medical-writing/api/medContent'
import { ReviewTierBadge } from '../../components/ui'

// --- Static slide list — 26 slides per brief §43 ---

type SlideState = 'done' | 'active' | 'warn' | 'todo'
interface Slide { n: number; title: string; state: SlideState; subLabel?: string }

const SLIDES: Slide[] = [
  { n: 1,  title: 'Title',                                     state: 'done' },
  { n: 2,  title: 'Disclosure',                                state: 'done' },
  { n: 3,  title: 'Disease context — NSCLC',                  state: 'done' },
  { n: 4,  title: 'VELORA-301 study design',                  state: 'active' },
  { n: 5,  title: 'Primary endpoint: PFS',                     state: 'warn', subLabel: '1 must-fix · fair-balance required' },
  { n: 6,  title: 'Secondary endpoints',                       state: 'todo' },
  { n: 7,  title: 'Safety overview',                           state: 'todo' },
  { n: 8,  title: 'Discontinuations & dose modifications',    state: 'todo' },
]
const TOTAL_SLIDES = 26

// --- Collaborators in this deck now (brief §47) ---
const COLLABORATORS = [
  { userId: 'user-cl',  name: 'Dr Elena Vasquez',  initials: 'EV', state: 'you' as const },
  { userId: 'user-cmc', name: 'Dr Arjun Patel',    initials: 'AP', state: 'editing-slide-04' as const },
  { userId: 'user-ma',  name: 'Dr Rebecca Morton', initials: 'RM', state: 'viewing' as const },
]

// --- Subcomponents ---

interface TabProps { active: boolean; onClick: () => void; label: string; id: string }
function TabButton({ active, onClick, label, id }: TabProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-tab={id}
      data-tab-active={active || undefined}
      className="px-3 py-2 text-[13px]"
      style={{
        borderBottom: `2px solid ${active ? '#7C3AED' : 'transparent'}`,
        color:        active ? '#5B21B6' : '#64748B',
        fontWeight:   active ? 600 : 500,
      }}
    >{label}</button>
  )
}

interface StatusPillProps { status: MedClaim['approvalStatus'] }
function ClaimStatusPill({ status }: StatusPillProps) {
  const meta =
    status === 'approved' ? { bg: '#F0FDF4', fg: '#15803D', label: 'Approved' } :
    status === 'modified' ? { bg: '#FFFBEB', fg: '#B45309', label: 'Modified' } :
    status === 'must-fix' ? { bg: '#EFF6FF', fg: '#005F8E', label: 'Must fix' } :
                            { bg: '#F5F3FF', fg: '#5B21B6', label: 'New' }
  return (
    <span
      className="inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold"
      style={{ backgroundColor: meta.bg, color: meta.fg }}
      data-claim-status={status}
    >{meta.label}</span>
  )
}

// --- Screen ---

type RightTab = 'content' | 'pao' | 'ai' | 'claims' | 'fk' | 'a11y'

export function ContentEditor() {
  const { projectId, contentId } = useParams()
  const navigate = useNavigate()

  const [activeSlide, setActiveSlide]         = useState(4)
  const [showPAOAnnotations, setShowPAO]      = useState(false)
  const [activeTab, setActiveTab]             = useState<RightTab>('content')
  const [aiFootprintPct, setAiFootprintPct]   = useState(28) // per brief §36 (28% AI)
  const [aiSuggestionOpen, setAiSuggestionOpen] = useState(true)
  const [suggestResolved, setSuggestResolved] = useState(false)
  const [altText, setAltText]                 = useState('')
  const [altSaved, setAltSaved]               = useState(false)
  const [toast, setToast]                     = useState<string | null>(null)

  const flash = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 2800) }

  const { data: item }  = useQuery({
    queryKey: ['med-content', contentId],
    queryFn:  () => medContentApi.get(contentId!),
    enabled:  !!contentId,
  })

  const { data: claims = [] } = useQuery({
    queryKey: ['med-claims', contentId],
    queryFn:  () => medContentApi.getClaims(contentId!),
    enabled:  !!contentId,
  })

  const isPatientFacing = item ? MED_CONTENT_TYPE_META[item.type]?.patientFacing : false

  const { data: fkScore } = useQuery({
    queryKey: ['fk-score', contentId],
    queryFn:  () => medContentApi.getFKScore(contentId!),
    enabled:  !!contentId && isPatientFacing,
  })

  const slideLocation = `Slide ${activeSlide}`
  const slideClaims = useMemo(
    () => claims.filter(c => c.location === slideLocation),
    [claims, slideLocation],
  )
  const claimCounts = useMemo(() => {
    const approved = claims.filter(c => c.approvalStatus === 'approved').length
    const pending  = claims.filter(c => c.approvalStatus !== 'approved').length
    return { tracked: claims.length, approved, pending }
  }, [claims])

  const preMLRRerunMutation = useMutation({
    mutationFn: () => medContentApi.runPreMLR(contentId!),
    onSuccess:  () => flash('Pre-MLR check queued — results available in under 45 seconds.'),
  })

  const aiSuggestMutation = useMutation({
    mutationFn: () => medContentApi.aiSuggest(contentId!, { sectionId: slideLocation }),
    onSuccess:  () => { setAiSuggestionOpen(true); setSuggestResolved(false); flash('New AI suggestion generated.') },
  })

  const handleAcceptAI = () => {
    setAiFootprintPct(v => Math.min(100, v + 3))
    setAiSuggestionOpen(false)
    setSuggestResolved(true)
    flash('Suggestion accepted. AI footprint updated.')
  }
  const handleDiscardAI = () => {
    setAiSuggestionOpen(false)
    flash('Suggestion discarded. AI footprint recalculated.')
  }

  const submitPreMLR    = () => navigate(`/projects/${projectId}/medical-writing/content/${contentId}/pre-mlr`)
  const openClaimsMatrix = () => navigate(`/projects/${projectId}/medical-writing/claims-matrix`)

  const currentItem: MedContentItem | undefined = item

  // Export gates (brief §38–40)
  const mustFixCount: number = 1 // Slide 5 fair-balance
  const altTextComplete      = altSaved
  const canExport            = mustFixCount === 0 && altTextComplete

  const mlrFootprintLabel = `${aiFootprintPct}% AI · ${100 - aiFootprintPct}% Human`

  return (
    <div className="bg-slate-50" data-screen="content-editor">
      <div className="flex flex-col" style={{ maxWidth: 1340, padding: '16px 24px 40px' }}>

        {/* Breadcrumb */}
        <nav className="mb-3 flex items-center gap-2 text-xs text-slate-500">
          <button onClick={() => navigate(`/projects/${projectId}/medical-writing`)} className="hover:text-slate-900">Medical Writing</button>
          <span style={{ color: '#CBD5E1' }}>&gt;</span>
          <span className="font-semibold text-slate-900">{currentItem?.title ?? 'Content'}</span>
        </nav>

        {/* Header bar */}
        <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3" data-editor-header>
          <p className="font-mono text-[11px] text-slate-500" data-content-title>
            VELORA-301 · Medical Writing · Veloricept HCP Slide Deck · Stage 3 · Authoring
          </p>
          <span
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] font-semibold"
            style={{ backgroundColor: '#F5F3FF', color: '#5B21B6', border: '1px solid #DDD6FE' }}
            data-messaging-framework-chip
          >
            <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: '#7C3AED' }} />
            Messaging framework: VELORA-301 v1.0 ✓
          </span>
          {currentItem?.reviewTier && (
            <ReviewTierBadge tier={currentItem.reviewTier} overridden={!!currentItem.reviewTierOverriddenBy} />
          )}

          {/* MLR footprint split format */}
          <span
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] font-semibold"
            style={{ backgroundColor: '#F5F3FF', color: '#5B21B6', border: '1px solid #DDD6FE' }}
            data-mlr-footprint
          >
            <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: '#7C3AED' }} />
            MLR footprint · <span data-mlr-footprint-label>{mlrFootprintLabel}</span>
          </span>

          <div className="flex-1" />

          <div className="flex items-center gap-2 text-[12px]" data-pre-mlr-status>
            <span className="font-mono text-[11px]" style={{ color: '#64748B' }}>
              Pre-MLR check · Last run: 09:10 UTC · <span style={{ color: '#B0200D' }}>1 must-fix</span> · <span style={{ color: '#B45309' }}>2 should-fix</span>
            </span>
            <button
              type="button"
              onClick={() => preMLRRerunMutation.mutate()}
              data-rerun-pre-mlr
              className="text-[12px] font-semibold text-violet-700 hover:underline"
            >Re-run</button>
          </div>

          <button
            type="button"
            data-new-slide-ai
            className="h-9 rounded-md border px-3 text-[12px] font-semibold"
            style={{ borderColor: '#7C3AED', color: '#7C3AED' }}
          >+ New slide with AI</button>
          <button
            type="button"
            data-present
            className="h-9 rounded-md border border-slate-300 bg-white px-3 text-[12px] font-semibold text-slate-700 hover:bg-slate-50"
          >▶ Present</button>
          <button
            type="button"
            disabled={!canExport}
            data-export-mlr
            className="h-9 rounded-md px-3 text-[12px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
            style={{ backgroundColor: '#7C3AED' }}
          >Export for MLR circulation →</button>
          <button
            type="button"
            onClick={submitPreMLR}
            data-submit-pre-mlr
            className="h-9 rounded-md px-3 text-[13px] font-semibold text-white"
            style={{ backgroundColor: '#7C3AED' }}
          >Submit for Pre-MLR →</button>
        </div>

        {/* Gate notes */}
        <div className="mb-4 flex flex-col gap-2">
          <div className="rounded-md border p-2 text-[12px]" style={{ backgroundColor: '#FFFBEB', borderColor: '#FDE68A', color: '#B45309' }} data-mustfix-gate>
            ⚠ Pre-MLR check has 1 must-fix · Slide 5 carries an unsubstantiated claim. Resolve the must-fix finding before exporting for MLR circulation.
          </div>
          {!altSaved && (
            <div className="rounded-md border p-2 text-[12px]" style={{ backgroundColor: '#FFFBEB', borderColor: '#FDE68A', color: '#B45309' }} data-alttext-gate>
              ⚠ Alt text missing on Fig 1.1 · WCAG 2.2 AA requires alt text on every figure.
            </div>
          )}
          <p className="font-mono text-[11px] text-slate-500" data-export-note>
            Export is disabled until the must-fix finding and the missing alt text are resolved.
          </p>
        </div>

        <div className="grid gap-4" style={{ gridTemplateColumns: '260px minmax(0,1fr) 360px' }}>

          {/* LEFT — Slide navigator */}
          <aside className="rounded-lg border border-slate-200 bg-white p-3" data-slide-navigator>
            <p className="mb-2 font-mono text-[10px] uppercase" style={{ color: '#64748B', letterSpacing: '0.1em' }} data-deck-count>
              Slide deck · {TOTAL_SLIDES} slides
            </p>
            <div className="flex flex-col gap-1">
              {SLIDES.map(s => {
                const active = activeSlide === s.n
                const dot =
                  s.state === 'done' ? '#15803D' :
                  s.state === 'active' ? '#7C3AED' :
                  s.state === 'warn' ? '#D97706' :
                  '#CBD5E1'
                return (
                  <button
                    key={s.n}
                    type="button"
                    onClick={() => setActiveSlide(s.n)}
                    data-slide-chip={s.n}
                    data-slide-state={s.state}
                    className="flex flex-col rounded-md px-2 py-1.5 text-left"
                    style={{
                      backgroundColor: active ? '#F5F3FF' : 'transparent',
                      border:          active ? '1px solid #DDD6FE' : '1px solid transparent',
                    }}
                  >
                    <div className="flex items-center gap-2 text-[12px]">
                      <span className="inline-block h-2 w-2 flex-none rounded-full" style={{ backgroundColor: dot }} />
                      <span className="font-mono text-[10px] text-slate-500">S{s.n}</span>
                      <span className="truncate font-semibold text-slate-800">{s.title}</span>
                    </div>
                    {s.subLabel && (
                      <span className="ml-4 font-mono text-[10px]" style={{ color: '#B45309' }} data-slide-sublabel={s.n}>
                        {s.subLabel}
                      </span>
                    )}
                  </button>
                )
              })}
              <p className="mt-1 font-mono text-[10px] text-slate-400">+ {TOTAL_SLIDES - SLIDES.length} more slides</p>
            </div>

            <div className="mt-4 border-t border-slate-200 pt-3" data-collaborators-strip>
              <p className="font-mono text-[10px] uppercase" style={{ color: '#64748B', letterSpacing: '0.1em' }}>In this deck now</p>
              <div className="mt-2 flex flex-col gap-1">
                {COLLABORATORS.map(c => (
                  <div key={c.userId} className="flex items-center gap-2 text-[12px] text-slate-800" data-collaborator={c.userId} data-collaborator-state={c.state}>
                    <span className="inline-flex h-6 w-6 items-center justify-center rounded-full font-mono text-[10px] font-bold text-white" style={{ backgroundColor: '#7C3AED' }}>{c.initials}</span>
                    <span className="font-semibold">{c.name}{c.state === 'you' ? ' (you)' : ''}</span>
                    {c.state === 'editing-slide-04' && <span className="font-mono text-[10px] text-slate-500">editing slide 4</span>}
                    {c.state === 'viewing'          && <span className="font-mono text-[10px] text-slate-500">viewing</span>}
                  </div>
                ))}
              </div>
              <p className="mt-2 font-mono text-[10px] text-slate-500" data-lock-note>
                One editor per slide. Locks release after 5 minutes idle.
              </p>
            </div>
          </aside>

          {/* CENTRE — Content canvas */}
          <section className="rounded-lg border border-slate-200 bg-white p-6" data-content-canvas>
            <p className="font-mono text-[10px] uppercase" style={{ color: '#64748B', letterSpacing: '0.1em' }} data-slide-locator>
              Slide {activeSlide} of {TOTAL_SLIDES} · Study design · You hold the edit lock · released after 5 min idle
            </p>
            <h2 className="mt-1 text-[20px] font-bold text-slate-900">VELORA-301 Phase III Study Design</h2>
            <p className="mt-2 text-[13px] text-slate-600">Randomised, Double-Blind, Placebo-Controlled</p>

            <div className="mt-4 rounded-md border border-dashed border-slate-300 p-4" data-figure-placeholder>
              <p className="font-mono text-[11px]" style={{ color: '#64748B' }}>Study schema diagram (TLF Fig 1.1 · Module A) · Replace figure · <span style={{ color: '#B45309' }}>alt text missing</span></p>
            </div>

            <p className="mt-4 text-[14px] leading-[1.7] text-slate-800">
              VELORA-301 was a phase III, multicentre, randomised, double-blind trial evaluating <span className="underline decoration-violet-400 decoration-2 underline-offset-2">Veloricept 200 mg once daily + pembrolizumab 200 mg Q3W</span> versus pembrolizumab monotherapy in treatment-naive advanced NSCLC with PD-L1 tumour proportion score ≥50%.
            </p>
            <p className="mt-3 text-[14px] leading-[1.7] text-slate-800">
              Primary endpoint: progression-free survival (blinded independent central review). Secondary endpoints included overall survival, objective response rate, and safety.
            </p>
            <p className="mt-2 font-mono text-[11px] text-slate-500">Dr Arjun Patel is editing this block</p>

            <p className="mt-4 font-mono text-[11px]" style={{ color: '#64748B' }} data-provenance-line>
              Grounded in SmPC v2.1 §4.2 and CSR v1.0 §6.1.1 · Module A
            </p>

            <span
              className="mt-3 inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold"
              style={{ backgroundColor: '#F0FDF4', color: '#166534' }}
              data-claims-matrix-chip
            >Claims matrix: approved ✓ · Source: CSR v1.0 Table 14.2.1</span>

            {showPAOAnnotations && (
              <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3" data-pao-card>
                <p className="text-[11px] font-mono uppercase" style={{ color: '#B45309', letterSpacing: '0.08em' }}>Patient advocate — advisory only</p>
                <p className="mt-1 text-[13px] text-amber-900">"PD-L1 ≥50%" is jargon for lay audiences. Add a plain-language footnote if this deck is shared beyond specialists.</p>
              </div>
            )}
          </section>

          {/* RIGHT — Tabbed panel */}
          <aside className="rounded-lg border border-slate-200 bg-white" data-right-panel>
            <div className="flex flex-wrap border-b border-slate-200 px-2">
              <TabButton id="content" label="Content"           active={activeTab === 'content'} onClick={() => setActiveTab('content')} />
              <TabButton id="pao"     label="Patient Advocate"  active={activeTab === 'pao'}     onClick={() => setActiveTab('pao')} />
              <TabButton id="ai"      label="AI Auto-Suggest"   active={activeTab === 'ai'}      onClick={() => setActiveTab('ai')} />
              <TabButton id="claims"  label="Claims"            active={activeTab === 'claims'}  onClick={() => setActiveTab('claims')} />
              <TabButton id="fk"      label="FK Readability"    active={activeTab === 'fk'}      onClick={() => setActiveTab('fk')} />
              <TabButton id="a11y"    label="Accessibility"     active={activeTab === 'a11y'}    onClick={() => setActiveTab('a11y')} />
            </div>

            <div className="p-3">
              {activeTab === 'content' && (
                <div data-tab-content className="flex flex-col gap-2">
                  <label className="flex flex-col gap-1">
                    <span className="font-mono text-[10px] uppercase" style={{ color: '#64748B', letterSpacing: '0.08em' }}>Slide title</span>
                    <input defaultValue="VELORA-301 Phase III Study Design" className="h-9 rounded-md border border-slate-300 px-3 text-[13px]" />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="font-mono text-[10px] uppercase" style={{ color: '#64748B', letterSpacing: '0.08em' }}>Body text</span>
                    <textarea rows={5} defaultValue="Randomised, Double-Blind, Placebo-Controlled" className="rounded-md border border-slate-300 p-2 text-[12px]" />
                  </label>
                  <button type="button" className="self-start text-[12px] font-semibold text-violet-700 hover:underline" data-insert-figure>Insert figure from CSR →</button>

                  <div className="mt-2 rounded-md border border-slate-200 p-2" data-ai-refine>
                    <p className="font-mono text-[10px] uppercase" style={{ color: '#64748B', letterSpacing: '0.08em' }}>AI refine</p>
                    <p className="mt-1 text-[11px] text-slate-500">Refinement applies to this text block only. It cannot introduce values not in grounded sources.</p>
                    <p className="mt-2 font-mono text-[10px] text-slate-400">claude-sonnet-4-6 · grounded in SmPC v2.1 + CSR v1.0</p>
                  </div>

                  <div className="mt-2 rounded-md border border-slate-200 p-2" data-alt-text-input>
                    <p className="font-mono text-[10px] uppercase" style={{ color: '#64748B', letterSpacing: '0.08em' }}>Alt text — mandatory</p>
                    <input type="text" value={altText} onChange={(e) => setAltText(e.currentTarget.value)}
                      placeholder="Describe Fig 1.1 for screen readers"
                      data-alt-input
                      className="mt-1 h-8 w-full rounded-md border border-slate-300 px-2 text-[12px]" />
                    <div className="mt-2 flex items-center gap-2">
                      <button type="button" onClick={() => { if (altText.trim()) { setAltSaved(true); flash('Alt text saved. WCAG check re-run.') } }}
                        disabled={!altText.trim()}
                        data-save-alt
                        className="h-8 rounded-md px-3 text-[12px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
                        style={{ backgroundColor: '#7C3AED' }}>Save alt text</button>
                      {altSaved && <span className="text-[11px] font-semibold" style={{ color: '#166534' }}>✓ Saved</span>}
                    </div>
                    <p className="mt-2 font-mono text-[10px] text-slate-500">Missing alt text blocks export and is reported by the WCAG 2.2 AA check.</p>
                  </div>
                </div>
              )}

              {activeTab === 'pao' && (
                <div data-tab-pao className="flex flex-col gap-2">
                  <label className="flex items-center gap-2 text-[12px] text-slate-700" data-pao-toggle>
                    <input
                      type="checkbox"
                      checked={showPAOAnnotations}
                      onChange={(e) => setShowPAO(e.target.checked)}
                      data-pao-checkbox
                    />
                    Show Patient Advocate annotations
                  </label>
                  <p className="font-mono text-[10px] text-slate-500">Patient Advocate annotations · advisory only</p>
                </div>
              )}

              {activeTab === 'ai' && (
                <div data-tab-ai>
                  <div className="mb-2 flex items-center justify-between">
                    <span
                      className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-semibold"
                      style={{ backgroundColor: '#F5F3FF', color: '#5B21B6', border: '1px solid #DDD6FE' }}
                      data-ai-footprint-chip
                    >
                      <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: '#7C3AED' }} />
                      AI footprint · {aiFootprintPct}%
                    </span>
                    <button
                      type="button"
                      onClick={() => aiSuggestMutation.mutate()}
                      data-suggest-again
                      className="text-[11px] font-semibold text-violet-700 hover:underline"
                    >Suggest again ✦</button>
                  </div>

                  {aiSuggestionOpen ? (
                    <div className="rounded-md border border-slate-200 bg-slate-50 p-3" data-ai-suggestion>
                      <p className="text-[11px] font-mono uppercase" style={{ color: '#64748B', letterSpacing: '0.08em' }}>Suggested addition · Slide 4 methods</p>
                      <p className="mt-1 text-[13px] text-slate-800">
                        "Randomisation was stratified by PD-L1 expression (50–74% vs ≥75%), performance status (0 vs 1), and geographic region."
                      </p>
                      <p className="mt-2 font-mono text-[11px]" style={{ color: '#64748B' }}>
                        Grounded: SmPC v2.1 §5.1 · CSR v1.0 §9.2
                      </p>
                      <p className="mt-2 font-mono text-[10px]" style={{ color: '#94A3B8' }} data-ai-attribution>
                        Generated 09:14 UTC · claude-sonnet-4-6 · Accepting logs to audit trail.
                      </p>
                      <div className="mt-3 flex gap-2">
                        <button type="button" onClick={handleAcceptAI} data-accept-ai className="rounded-md px-3 py-1.5 text-[12px] font-semibold text-white" style={{ backgroundColor: '#7C3AED' }}>Accept</button>
                        <button type="button" onClick={handleDiscardAI} data-discard-ai className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-[12px] font-semibold text-slate-700">Discard</button>
                      </div>
                    </div>
                  ) : (
                    <div data-suggest-resolved>
                      {suggestResolved && (
                        <p className="mb-2 rounded-md p-2 text-[12px]" style={{ backgroundColor: '#F0FDF4', color: '#166534' }} data-suggest-resolved-msg>
                          ✓ Suggestion accepted and logged to the audit trail. Suggest again to iterate.
                        </p>
                      )}
                      <p className="text-[12px] text-slate-500">No pending suggestions. Click "Suggest again ✦" to request a new one.</p>
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'claims' && (
                <div data-tab-claims>
                  <p className="mb-2 text-[11px] font-mono uppercase" style={{ color: '#64748B', letterSpacing: '0.08em' }} data-claim-counts>
                    {claimCounts.tracked} tracked · {claimCounts.approved} approved · {claimCounts.pending} pending
                  </p>
                  {slideClaims.length === 0 ? (
                    <p className="text-[12px] text-slate-500">No claims on this slide.</p>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {slideClaims.map(c => (
                        <div key={c.id} className="rounded-md border border-slate-200 p-2" data-claim-card={c.id}>
                          <div className="mb-1 flex items-center justify-between gap-2">
                            <span className="font-mono text-[10px] text-slate-500">{c.id}</span>
                            <ClaimStatusPill status={c.approvalStatus} />
                          </div>
                          <p className="text-[13px] text-slate-800">{c.claimText}</p>
                          <p className="mt-1 font-mono text-[11px]" style={{ color: '#64748B' }}>
                            Source: {c.sourceRef ?? 'unset'}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={openClaimsMatrix}
                    data-open-claims-matrix
                    className="mt-3 text-[12px] font-semibold text-violet-700 hover:underline"
                  >Open full claims matrix →</button>
                </div>
              )}

              {activeTab === 'fk' && (
                <div data-tab-fk>
                  <p className="font-mono text-[10px] uppercase" style={{ color: '#64748B', letterSpacing: '0.08em' }}>Live scoring · Updated paragraph by paragraph</p>
                  <p className="mt-2 text-[13px] font-semibold" data-fk-grade>
                    Grade 7.2 · Gate ≤8 · <span style={{ color: '#166534' }}>Passes gate ✓</span>
                  </p>
                  <p className="mt-1 font-mono text-[11px] text-slate-500">1 section above FK 8 — advisory only (below FK 10 gate).</p>
                  {!isPatientFacing && (
                    <p className="mt-2 text-[12px] text-slate-500" data-fk-na>
                      Shown for the linked patient version. The active HCP slide deck is not FK-gated.
                    </p>
                  )}
                  {isPatientFacing && fkScore && (
                    <div className="mt-2 flex flex-col gap-2" data-fk-live>
                      <p className="text-[13px] font-semibold">
                        Grade {fkScore.score.toFixed(1)} · <span style={{ color: fkScore.passed ? '#15803D' : '#B45309' }}>{fkScore.passed ? 'Passes gate ✓' : 'Above 8 · needs revision'}</span>
                      </p>
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'a11y' && (
                <div data-tab-a11y>
                  <p className="mb-2 text-[11px] font-mono uppercase" style={{ color: '#64748B', letterSpacing: '0.08em' }} data-wcag-header>
                    WCAG 2.2 AA · slide-level checks
                  </p>
                  <ul className="flex flex-col gap-1 text-[12px]">
                    <li className="flex items-center gap-2" data-a11y-check="alt-text"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: altSaved ? '#15803D' : '#D97706' }} />Alt text on figures · {altSaved ? 'complete ✓' : 'Fig 1.1 missing'}</li>
                    <li className="flex items-center gap-2" data-a11y-check="contrast"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: '#D97706' }} />Contrast: 4.3:1 (target 4.5:1)</li>
                    <li className="flex items-center gap-2" data-a11y-check="headings"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: '#15803D' }} />Heading order valid</li>
                    <li className="flex items-center gap-2" data-a11y-check="reading-level"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: '#D97706' }} />Reading level: grade 12</li>
                  </ul>
                  <p className="mt-3 font-mono text-[10px]" style={{ color: '#64748B' }} data-a11y-stage-note>
                    Full remediation runs in Stage 5 — Formatting &amp; Accessibility. Accessibility is advisory at this stage; the hard gate activates at Stage 5.
                  </p>
                </div>
              )}
            </div>
          </aside>
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
    </div>
  )
}
