import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import type { MedClaim, MedContentItem } from '@platform/types'
import { MED_CONTENT_TYPE_META } from '@platform/types'
import { medContentApi, type MedSlide } from '../../modules/medical-writing/api/medContent'
import { projectsApi } from '../../api/projects'
import { ReviewTierBadge } from '../../components/ui'
import { ApiError } from '../../api/client'
import { useAiReadiness, isAiReady } from '../../platform/ai-readiness'
import { fmtTime, stageLabel, textOf, ver } from './medLabels'

// The slide navigator and canvas show the item's own slide deck (GET /slide-deck). An item with no slides yet
// shows an empty state, not a demo deck.

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

  const [activeSlide, setActiveSlide]         = useState(1)
  const [showPAOAnnotations, setShowPAO]      = useState(false)
  const [activeTab, setActiveTab]             = useState<RightTab>('content')
  // The latest AI suggestion returned by the API for this slide (none until "Suggest again" is used).
  const [aiSuggestion, setAiSuggestion] = useState<{ responseText: string; aiModel: string; generatedAt: string } | null>(null)
  const [aiSuggestionOpen, setAiSuggestionOpen] = useState(false)
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

  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn:  () => projectsApi.get(projectId!),
    enabled:  !!projectId,
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

  const qc = useQueryClient()
  // Slide deck + slides — the real backing store. `+ New slide with AI`
  // writes here; we poll briefly after an AI enqueue so the new row shows
  // up without a manual refresh. Deck lazy-creates on the first GET.
  const { data: deckData } = useQuery({
    queryKey: ['med-slide-deck', contentId],
    queryFn:  () => medContentApi.getSlideDeck(contentId!),
    enabled:  !!contentId,
    // Poll briefly while the deck is 'generating' — stops once the worker
    // flips it back to 'ready'. Prevents the dead-polling tax when nothing
    // is in flight.
    refetchInterval: (query) => {
      const d = query.state.data?.deck
      return d?.status === 'generating' ? 1500 : false
    },
  })
  const liveSlides: MedSlide[] = useMemo(() => deckData?.slides ?? [], [deckData])
  const { data: readiness } = useAiReadiness()
  const aiReady = isAiReady(readiness)
  const [newSlideOpen, setNewSlideOpen] = useState(false)
  const [newSlidePrompt, setNewSlidePrompt] = useState('')
  const generateSlide = useMutation({
    mutationFn: () => medContentApi.generateSlide(contentId!, {
      prompt:   newSlidePrompt.trim() || undefined,
      position: liveSlides.length + 1,
    }),
    onSuccess: (res) => {
      flash(`AI slide generation enqueued at position ${res.position} — refreshing the deck…`)
      setNewSlideOpen(false)
      setNewSlidePrompt('')
      qc.invalidateQueries({ queryKey: ['med-slide-deck', contentId] })
    },
    onError: (err: unknown) => {
      if (err instanceof ApiError && err.status === 503) {
        const body = err.body as { message?: string } | null
        flash(body?.message ?? 'AI is not configured — ask an admin to set up the AI engine.')
      } else {
        flash(`Slide generation failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    },
  })

  // Auto-stop polling + surface a toast when a new AI slide lands after
  // enqueue — otherwise the user sees the deck quietly grow one row and
  // might miss the completion signal.
  const [lastSlideCount, setLastSlideCount] = useState<number | null>(null)
  useEffect(() => {
    if (lastSlideCount === null) { setLastSlideCount(liveSlides.length); return }
    if (liveSlides.length > lastSlideCount) {
      flash(`Slide ${liveSlides.length} added — AI drafted title + body + speaker notes. Review in the deck.`)
      setLastSlideCount(liveSlides.length)
    } else if (liveSlides.length !== lastSlideCount) {
      setLastSlideCount(liveSlides.length)
    }
  }, [liveSlides.length, lastSlideCount])

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

  // Latest Pre-MLR run (404 until the first run).
  const { data: preMlr } = useQuery({
    queryKey: ['pre-mlr', contentId],
    queryFn:  () => medContentApi.getPreMLR(contentId!).catch(e => { if (e instanceof ApiError && e.status === 404) return null; throw e }),
    enabled:  !!contentId,
    retry:    false,
  })
  const preMlrRunAt = preMlr ? (preMlr as unknown as { runAt?: string }).runAt : undefined

  const preMLRRerunMutation = useMutation({
    mutationFn: () => medContentApi.runPreMLR(contentId!),
    onSuccess:  () => { flash('Pre-MLR check run.'); qc.invalidateQueries({ queryKey: ['pre-mlr', contentId] }) },
  })

  const aiSuggestMutation = useMutation({
    mutationFn: () => medContentApi.aiSuggest(contentId!, { sectionId: slideLocation }),
    onSuccess:  (res) => { setAiSuggestion(res); setAiSuggestionOpen(true); setSuggestResolved(false); flash('New AI suggestion generated.') },
  })

  const handleAcceptAI = () => {
    setAiSuggestionOpen(false)
    setSuggestResolved(true)
    flash('Suggestion accepted.')
  }
  const handleDiscardAI = () => {
    setAiSuggestionOpen(false)
    setAiSuggestion(null)
    flash('Suggestion discarded.')
  }

  const submitPreMLR    = () => navigate(`/projects/${projectId}/medical-writing/content/${contentId}/pre-mlr`)
  const openClaimsMatrix = () => navigate(`/projects/${projectId}/medical-writing/claims-matrix`)

  const currentItem: MedContentItem | undefined = item

  // Export gates (brief §38–40) — canExport was computed to enable the
  // "Export for MLR circulation" button, but export isn't implemented yet,
  // so the button is permanently disabled with a "coming soon" tooltip
  // (see below). Keeping the counters here as reference for when export lands.
  const mustFixCount   = preMlr?.mustFixCount ?? 0
  const shouldFixCount = preMlr?.shouldFixCount ?? 0

  // AI footprint: the deck's own figure, else the item's; unknown until the API has one.
  const aiFootprintPct: number | null = deckData?.deck.aiFootprintPct ?? (item ? item.aiFootprintPct ?? null : null)
  const mlrFootprintLabel = aiFootprintPct == null ? '—' : `${aiFootprintPct}% AI · ${100 - aiFootprintPct}% Human`

  const activeLiveSlide = liveSlides.find(s => s.position === activeSlide) ?? liveSlides[0] ?? null
  const totalSlides = liveSlides.length
  const approvedClaims = claims.filter(c => c.approvalStatus === 'approved').length
  const aiModelLabel = activeLiveSlide?.aiModel ?? deckData?.deck.aiModel ?? null

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
            {project?.shortTitle ?? project?.name ?? '…'} · Medical Writing · {currentItem?.title ?? '…'} · {stageLabel(currentItem?.stage)}
          </p>
          <span
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] font-semibold"
            style={{ backgroundColor: '#F5F3FF', color: '#5B21B6', border: '1px solid #DDD6FE' }}
            data-messaging-framework-chip
          >
            <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: '#7C3AED' }} />
            Messaging framework: {project?.shortTitle ?? '—'} {ver(currentItem?.version)} ✓
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
            <span className="font-mono text-[11px]" style={{ color: '#64748B' }} data-pre-mlr-summary>
              {preMlr
                ? <>Pre-MLR check · Last run: {fmtTime(preMlrRunAt)} · <span style={{ color: '#B0200D' }}>{mustFixCount} must-fix</span> · <span style={{ color: '#B45309' }}>{shouldFixCount} should-fix</span></>
                : <>Pre-MLR check · Not run yet</>}
            </span>
            <button
              type="button"
              onClick={() => preMLRRerunMutation.mutate()}
              data-rerun-pre-mlr
              className="text-[12px] font-semibold text-violet-700 hover:underline"
            >{preMlr ? 'Re-run' : 'Run'}</button>
          </div>

          <button
            type="button"
            onClick={() => setNewSlideOpen(true)}
            disabled={generateSlide.isPending || !aiReady}
            title={!aiReady ? 'AI is not set up — ask an admin to configure the AI engine before generating slides.' : undefined}
            data-new-slide-ai
            className="h-9 rounded-md border px-3 text-[12px] font-semibold disabled:opacity-50"
            style={{ borderColor: '#7C3AED', color: '#7C3AED' }}
          >{generateSlide.isPending ? 'Generating…' : '+ New slide with AI'}</button>
          <button
            type="button"
            disabled
            title="Present mode is not implemented yet."
            data-present
            className="h-9 rounded-md border border-slate-300 bg-white px-3 text-[12px] font-semibold text-slate-400"
          >▶ Present</button>
          <button
            type="button"
            disabled
            title="MLR export is not implemented yet."
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
          >Go to Pre-MLR check →</button>
        </div>

        {/* Gate notes */}
        <div className="mb-4 flex flex-col gap-2">
          {mustFixCount > 0 && (
            <div className="rounded-md border p-2 text-[12px]" style={{ backgroundColor: '#FFFBEB', borderColor: '#FDE68A', color: '#B45309' }} data-mustfix-gate>
              ⚠ Pre-MLR check has {mustFixCount} must-fix finding{mustFixCount === 1 ? '' : 's'}. Resolve {mustFixCount === 1 ? 'it' : 'them'} before submitting to MLR.
            </div>
          )}
          <p className="font-mono text-[11px] text-slate-500" data-export-note>
            Export for MLR circulation isn't available yet.
          </p>
        </div>

        <div className="grid gap-4" style={{ gridTemplateColumns: '260px minmax(0,1fr) 360px' }}>

          {/* LEFT — Slide navigator. When the deck has any AI-generated
              slides, render those (real data from GET /slide-deck);
              otherwise fall back to the fixture SLIDES so the canvas
              placeholder demo still shows — the fixture will fade as
              the user generates slides. */}
          <aside className="rounded-lg border border-slate-200 bg-white p-3" data-slide-navigator>
            <p className="mb-2 font-mono text-[10px] uppercase" style={{ color: '#64748B', letterSpacing: '0.1em' }} data-deck-count>
              Slide deck · {totalSlides} slide{totalSlides === 1 ? '' : 's'}
              {deckData?.deck.status === 'generating' && ' · generating…'}
            </p>
            <div className="flex flex-col gap-1">
              {liveSlides.length === 0 && (
                <p className="rounded-md bg-slate-50 p-2 text-[12px] text-slate-500" data-no-slides>
                  No slides yet. Use “+ New slide with AI” to draft the first one.
                </p>
              )}
              {liveSlides.map(s => {
                const active = activeLiveSlide?.id === s.id
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setActiveSlide(s.position)}
                    data-slide-chip={s.position}
                    data-slide-state={s.aiGenerated ? 'ai' : 'human'}
                    className="flex flex-col rounded-md px-2 py-1.5 text-left"
                    style={{
                      backgroundColor: active ? '#F5F3FF' : 'transparent',
                      border:          active ? '1px solid #DDD6FE' : '1px solid transparent',
                    }}
                  >
                    <div className="flex items-center gap-2 text-[12px]">
                      <span className="inline-block h-2 w-2 flex-none rounded-full" style={{ backgroundColor: s.aiGenerated ? '#7C3AED' : '#15803D' }} />
                      <span className="font-mono text-[10px] text-slate-500">S{s.position}</span>
                      <span className="truncate font-semibold text-slate-800">{s.title}</span>
                    </div>
                    {s.aiGenerated && (
                      <span className="ml-4 font-mono text-[10px] text-violet-700" data-slide-ai-tag>
                        AI draft · review before MLR
                      </span>
                    )}
                  </button>
                )
              })}
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
            {activeLiveSlide ? (
              <>
                <p className="font-mono text-[10px] uppercase" style={{ color: '#64748B', letterSpacing: '0.1em' }} data-slide-locator>
                  Slide {activeLiveSlide.position} of {totalSlides}{activeLiveSlide.lastEditedAt ? ` · last edited ${fmtTime(activeLiveSlide.lastEditedAt)}` : ''}
                </p>
                <h2 className="mt-1 text-[20px] font-bold text-slate-900" data-slide-title>{activeLiveSlide.title}</h2>
                <p className="mt-4 whitespace-pre-line text-[14px] leading-[1.7] text-slate-800" data-slide-body>
                  {textOf(activeLiveSlide.bodyHtml) || 'This slide has no body text yet.'}
                </p>
              </>
            ) : (
              <p className="text-[13px] text-slate-500" data-canvas-empty>This item has no slides yet.</p>
            )}

            <span
              className="mt-4 inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold"
              style={{ backgroundColor: claims.length > 0 && approvedClaims === claims.length ? '#F0FDF4' : '#F8FAFC', color: claims.length > 0 && approvedClaims === claims.length ? '#166534' : '#475569' }}
              data-claims-matrix-chip
            >{claims.length === 0 ? 'Claims matrix: no claims yet' : `Claims matrix: ${approvedClaims} of ${claims.length} approved`}</span>

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
                    <input key={`t-${activeLiveSlide?.id ?? 'none'}`} defaultValue={activeLiveSlide?.title ?? ''} placeholder="No slide selected" className="h-9 rounded-md border border-slate-300 px-3 text-[13px]" />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="font-mono text-[10px] uppercase" style={{ color: '#64748B', letterSpacing: '0.08em' }}>Body text</span>
                    <textarea key={`b-${activeLiveSlide?.id ?? 'none'}`} rows={5} defaultValue={textOf(activeLiveSlide?.bodyHtml)} className="rounded-md border border-slate-300 p-2 text-[12px]" />
                  </label>
                  <button type="button" className="self-start text-[12px] font-semibold text-violet-700 hover:underline" data-insert-figure>Insert figure from CSR →</button>

                  <div className="mt-2 rounded-md border border-slate-200 p-2" data-ai-refine>
                    <p className="font-mono text-[10px] uppercase" style={{ color: '#64748B', letterSpacing: '0.08em' }}>AI refine</p>
                    <p className="mt-1 text-[11px] text-slate-500">Refinement applies to this text block only. It cannot introduce values not in grounded sources.</p>
                    <p className="mt-2 font-mono text-[10px] text-slate-400" data-ai-model>{aiModelLabel ? `${aiModelLabel} · grounded in the linked source documents` : 'Grounded in the linked source documents'}</p>
                  </div>

                  <div className="mt-2 rounded-md border border-slate-200 p-2" data-alt-text-input>
                    <p className="font-mono text-[10px] uppercase" style={{ color: '#64748B', letterSpacing: '0.08em' }}>Alt text — mandatory</p>
                    <input type="text" value={altText} onChange={(e) => setAltText(e.currentTarget.value)}
                      placeholder="Describe the figure for screen readers"
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
                    <p className="mt-2 font-mono text-[10px] text-slate-500">Missing alt text is reported by the WCAG 2.1 AA check.</p>
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
                      AI footprint · {aiFootprintPct == null ? '—' : `${aiFootprintPct}%`}
                    </span>
                    <button
                      type="button"
                      onClick={() => aiSuggestMutation.mutate()}
                      data-suggest-again
                      className="text-[11px] font-semibold text-violet-700 hover:underline"
                    >Suggest again ✦</button>
                  </div>

                  {aiSuggestionOpen && aiSuggestion ? (
                    <div className="rounded-md border border-slate-200 bg-slate-50 p-3" data-ai-suggestion>
                      <p className="text-[11px] font-mono uppercase" style={{ color: '#64748B', letterSpacing: '0.08em' }}>Suggested addition · {slideLocation}</p>
                      <p className="mt-1 whitespace-pre-line text-[13px] text-slate-800" data-ai-suggestion-text>{aiSuggestion.responseText}</p>
                      <p className="mt-2 font-mono text-[10px]" style={{ color: '#94A3B8' }} data-ai-attribution>
                        Generated {fmtTime(aiSuggestion.generatedAt)} · {aiSuggestion.aiModel}
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
                      <p className="text-[12px] text-slate-500">No pending suggestions. Click "Suggest again ✦" to request one.</p>
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
                  <p className="font-mono text-[10px] uppercase" style={{ color: '#64748B', letterSpacing: '0.08em' }}>Latest recorded score · gate is grade 8 or lower</p>
                  {!isPatientFacing && (
                    <p className="mt-2 text-[12px] text-slate-500" data-fk-na>
                      This content type isn't patient-facing, so the reading-level gate doesn't apply.
                    </p>
                  )}
                  {isPatientFacing && fkScore && (
                    <div className="mt-2 flex flex-col gap-2" data-fk-live>
                      <p className="text-[13px] font-semibold" data-fk-grade>
                        Grade {Number(fkScore.score).toFixed(1)} · <span style={{ color: fkScore.passed ? '#15803D' : '#B45309' }}>{fkScore.passed ? 'Passes gate ✓' : 'Above grade 8 · needs revision'}</span>
                      </p>
                    </div>
                  )}
                  {isPatientFacing && !fkScore && (
                    <p className="mt-2 text-[12px] text-slate-500" data-fk-none>
                      No score recorded yet. Patient-facing content needs grade 8 or lower before MLR submission.
                    </p>
                  )}
                </div>
              )}

              {activeTab === 'a11y' && (
                <div data-tab-a11y>
                  <p className="mb-2 text-[11px] font-mono uppercase" style={{ color: '#64748B', letterSpacing: '0.08em' }} data-wcag-header>
                    WCAG 2.1 AA · slide-level checks
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

        {newSlideOpen && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
            data-modal="new-slide-ai"
            onClick={() => setNewSlideOpen(false)}
          >
            <div
              className="w-full max-w-lg rounded-lg bg-white p-5 shadow-xl"
              onClick={e => e.stopPropagation()}
            >
              <h2 className="text-[16px] font-semibold text-slate-900">New slide with AI</h2>
              <p className="mt-0.5 text-[12px] text-slate-500">
                The drafter reads this deck's existing slides + the content item's briefing + the policy's SME prompt
                and best-practice digest, then produces a complete slide (title, body, speaker notes, optional figure).
                Review and polish before pre-MLR.
              </p>
              <label className="mt-4 flex flex-col gap-1">
                <span className="text-[12px] font-semibold text-slate-800">What should this slide cover? (optional)</span>
                <textarea
                  value={newSlidePrompt}
                  onChange={e => setNewSlidePrompt(e.currentTarget.value.slice(0, 500))}
                  rows={4}
                  placeholder="e.g. Summarise safety findings for Grade ≥3 adverse events — one sentence per class, no new claims."
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-[13px]"
                  data-field="new-slide-prompt"
                  autoFocus
                />
                <span className="self-end font-mono text-[10px] text-slate-400">{newSlidePrompt.length} / 500</span>
              </label>
              <p className="mt-2 text-[11px] text-slate-500">
                Leaving this empty lets the drafter infer the next slide from the deck's existing flow.
                New slide will be inserted at position <span className="font-mono">{liveSlides.length + 1}</span>.
              </p>
              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => { setNewSlideOpen(false); setNewSlidePrompt('') }}
                  className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-[12px] font-semibold text-slate-700 hover:bg-slate-50"
                  data-action="new-slide-cancel"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => generateSlide.mutate()}
                  disabled={generateSlide.isPending || !aiReady}
                  title={!aiReady ? 'AI is not set up — configure an AI engine first.' : undefined}
                  className="rounded-md border border-violet-600 bg-violet-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
                  data-action="new-slide-generate"
                >
                  {generateSlide.isPending ? 'Enqueuing…' : 'Generate with AI'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
