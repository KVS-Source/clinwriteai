import { useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import type { MedClaim, MedContentItem } from '@platform/types'
import { MED_CONTENT_TYPE_META } from '@platform/types'
import { medContentApi } from '../../modules/medical-writing/api/medContent'
import { ReviewTierBadge } from '../../components/ui'

// --- Static slide list ---

type SlideState = 'done' | 'active' | 'warn' | 'todo'
interface Slide {
  n:        number
  title:    string
  state:    SlideState
  subLabel?: string
}

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

export function ContentEditor() {
  const { projectId, contentId } = useParams()
  const navigate = useNavigate()

  const [activeSlide, setActiveSlide]         = useState(4)
  const [showPAOAnnotations, setShowPAO]      = useState(false)
  const [activeTab, setActiveTab]             = useState<'ai' | 'claims' | 'fk' | 'a11y'>('ai')
  const [aiFootprintPct, setAiFootprintPct]   = useState(31)
  const [aiSuggestionOpen, setAiSuggestionOpen] = useState(true)
  const [toast, setToast]                     = useState<string | null>(null)

  const flash = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 2800) }

  const { data: item } = useQuery({
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

  const preMLRRerunMutation = useMutation({
    mutationFn: () => medContentApi.runPreMLR(contentId!),
    onSuccess:  () => flash('Pre-MLR check queued — results available in under 45 seconds.'),
  })

  const aiSuggestMutation = useMutation({
    mutationFn: () => medContentApi.aiSuggest(contentId!, { sectionId: slideLocation }),
    onSuccess:  () => { setAiSuggestionOpen(true); flash('New AI suggestion generated.') },
  })

  const handleAcceptAI = () => {
    setAiFootprintPct(v => Math.min(100, v + 3))
    setAiSuggestionOpen(false)
    flash('Suggestion accepted. AI footprint updated.')
  }
  const handleDiscardAI = () => {
    setAiSuggestionOpen(false)
    flash('Suggestion discarded. AI footprint recalculated.')
  }

  const submitPreMLR = () => navigate(`/projects/${projectId}/medical-writing/content/${contentId}/pre-mlr`)
  const openClaimsMatrix = () => navigate(`/projects/${projectId}/medical-writing/claims-matrix`)

  const currentItem: MedContentItem | undefined = item

  return (
    <div className="bg-slate-50" data-screen="content-editor">
      <div className="mx-auto flex flex-col" style={{ maxWidth: 1340, padding: '16px 24px 40px' }}>

        {/* Breadcrumb */}
        <nav className="mb-3 flex items-center gap-2 text-xs text-slate-500">
          <button onClick={() => navigate(`/projects/${projectId}/medical-writing`)} className="hover:text-slate-900">Medical Writing</button>
          <span style={{ color: '#CBD5E1' }}>&gt;</span>
          <span className="font-semibold text-slate-900">{currentItem?.title ?? 'Content'}</span>
        </nav>

        {/* Header bar */}
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3" data-editor-header>
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

          <label className="flex items-center gap-2 text-[12px] text-slate-700" data-pao-toggle>
            <input
              type="checkbox"
              checked={showPAOAnnotations}
              onChange={(e) => setShowPAO(e.target.checked)}
              data-pao-checkbox
            />
            Patient Advocate annotations
          </label>

          <div className="flex-1" />

          <div className="flex items-center gap-2 text-[12px]" data-pre-mlr-status>
            <span className="font-mono text-[11px]" style={{ color: '#64748B' }}>
              Pre-MLR check · Last run: 09:10 UTC · <span style={{ color: '#15803D' }}>0 must-fix</span> · <span style={{ color: '#B45309' }}>2 should-fix</span>
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
            onClick={submitPreMLR}
            data-submit-pre-mlr
            className="h-9 rounded-md px-3 text-[13px] font-semibold text-white"
            style={{ backgroundColor: '#7C3AED' }}
          >Submit for Pre-MLR →</button>
        </div>

        <div className="grid gap-4" style={{ gridTemplateColumns: '220px minmax(0,1fr) 340px' }}>

          {/* LEFT — Slide navigator */}
          <aside className="rounded-lg border border-slate-200 bg-white p-3" data-slide-navigator>
            <p className="mb-2 font-mono text-[10px] uppercase" style={{ color: '#64748B', letterSpacing: '0.1em' }}>Slides</p>
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
            </div>
          </aside>

          {/* CENTRE — Content canvas */}
          <section className="rounded-lg border border-slate-200 bg-white p-6" data-content-canvas>
            <p className="font-mono text-[10px] uppercase" style={{ color: '#64748B', letterSpacing: '0.1em' }}>Slide {activeSlide}</p>
            <h2 className="mt-1 text-[20px] font-bold text-slate-900">VELORA-301 study design</h2>
            <p className="mt-4 text-[14px] leading-[1.7] text-slate-800">
              VELORA-301 was a phase III, multicentre, randomised, double-blind trial evaluating <span className="underline decoration-violet-400 decoration-2 underline-offset-2">Veloricept 200 mg once daily + pembrolizumab 200 mg Q3W</span> versus pembrolizumab monotherapy in treatment-naive advanced NSCLC with PD-L1 tumour proportion score ≥50%.
            </p>
            <p className="mt-3 text-[14px] leading-[1.7] text-slate-800">
              Primary endpoint: progression-free survival (blinded independent central review). Secondary endpoints included overall survival, objective response rate, and safety.
            </p>
            <p className="mt-4 font-mono text-[11px]" style={{ color: '#64748B' }} data-provenance-line>
              Grounded in SmPC v2.1 §4.2 and CSR v1.0 §6.1.1 · Module A
            </p>

            {showPAOAnnotations && (
              <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3" data-pao-card>
                <p className="text-[11px] font-mono uppercase" style={{ color: '#B45309', letterSpacing: '0.08em' }}>Patient advocate — advisory only</p>
                <p className="mt-1 text-[13px] text-amber-900">"PD-L1 ≥50%" is jargon for lay audiences. Add a plain-language footnote if this deck is shared beyond specialists.</p>
              </div>
            )}
          </section>

          {/* RIGHT — Tabbed panel */}
          <aside className="rounded-lg border border-slate-200 bg-white" data-right-panel>
            <div className="flex border-b border-slate-200 px-2">
              <TabButton id="ai"     label="AI Suggest" active={activeTab === 'ai'}     onClick={() => setActiveTab('ai')} />
              <TabButton id="claims" label="Claims"     active={activeTab === 'claims'} onClick={() => setActiveTab('claims')} />
              <TabButton id="fk"     label="FK"         active={activeTab === 'fk'}     onClick={() => setActiveTab('fk')} />
              <TabButton id="a11y"   label="A11y"       active={activeTab === 'a11y'}   onClick={() => setActiveTab('a11y')} />
            </div>

            <div className="p-3">
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
                      <p className="mt-2 font-mono text-[10px]" style={{ color: '#94A3B8' }}>
                        Generated 09:14 UTC · claude-sonnet-4-6 · Accepting logs to audit trail.
                      </p>
                      <div className="mt-3 flex gap-2">
                        <button type="button" onClick={handleAcceptAI} data-accept-ai className="rounded-md bg-violet-600 px-3 py-1.5 text-[12px] font-semibold text-white" style={{ backgroundColor: '#7C3AED' }}>Accept</button>
                        <button type="button" onClick={handleDiscardAI} data-discard-ai className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-[12px] font-semibold text-slate-700">Discard</button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-[12px] text-slate-500">No pending suggestions. Click "Suggest again ✦" to request a new one.</p>
                  )}
                </div>
              )}

              {activeTab === 'claims' && (
                <div data-tab-claims>
                  <p className="mb-2 text-[11px] font-mono uppercase" style={{ color: '#64748B', letterSpacing: '0.08em' }}>Claims on Slide {activeSlide}</p>
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
                  {!isPatientFacing && (
                    <p className="text-[12px] text-slate-500" data-fk-na>
                      Not applicable for this content type.
                    </p>
                  )}
                  {isPatientFacing && fkScore && (
                    <div className="flex flex-col gap-2" data-fk-live>
                      <p className="text-[13px] font-semibold">
                        Grade {fkScore.score.toFixed(1)} · <span style={{ color: fkScore.passed ? '#15803D' : '#B45309' }}>{fkScore.passed ? 'Passes gate ✓' : 'Above 8 · needs revision'}</span>
                      </p>
                      <p className="font-mono text-[11px]" style={{ color: '#64748B' }}>
                        Shown for the linked patient version. The active HCP slide deck is not FK-gated.
                      </p>
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'a11y' && (
                <div data-tab-a11y>
                  <ul className="flex flex-col gap-1 text-[12px]">
                    <li className="flex items-center gap-2"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: '#15803D' }} />Alt text present on all images</li>
                    <li className="flex items-center gap-2"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: '#D97706' }} />Contrast: 4.3:1 (target 4.5:1)</li>
                    <li className="flex items-center gap-2"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: '#15803D' }} />Heading order valid</li>
                    <li className="flex items-center gap-2"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: '#D97706' }} />Reading level: grade 12</li>
                  </ul>
                  <p className="mt-3 font-mono text-[10px]" style={{ color: '#64748B' }}>
                    Full remediation runs in Stage 5 — Formatting &amp; Accessibility.
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
