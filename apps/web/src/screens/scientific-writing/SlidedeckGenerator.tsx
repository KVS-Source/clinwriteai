import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { SlideDeckJob, Slide } from '@platform/types'
import { MODULE_B_SB10_ACCENT } from '@platform/types'
import { platformApi } from '../../platform/api/platformApi'

const DEMO_PUB_ID = 'pub-velora-301-manuscript'
const DEMO_JOB_ID = 'sdj-001'

type RightTab = 'content' | 'notes' | 'figures'

const SOURCES = ['Full manuscript', 'Abstract', 'Selected sections'] as const

// Collaborative editing strip — per brief §41 + §87
const PRESENCE = [
  { userId: 'user-cl', name: 'Dr Elena Vasquez',  state: 'you'                       as const },
  { userId: 'user-ma', name: 'Dr Rebecca Morton', state: 'viewing'                   as const },
  { userId: 'user-dc', name: 'Mr David Chen',     state: 'editing-slide-06'          as const },
]

function formatUTC(iso: string): string {
  const d = new Date(iso)
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const dd = String(d.getUTCDate()).padStart(2, '0')
  const hh = String(d.getUTCHours()).padStart(2, '0')
  const mm = String(d.getUTCMinutes()).padStart(2, '0')
  return `${dd} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()} ${hh}:${mm} UTC`
}
function initialsFor(name: string): string {
  return name.split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('')
}

export function SlidedeckGenerator() {
  const { projectId, publicationId } = useParams<{ projectId: string; publicationId: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()

  const pubId = publicationId ?? DEMO_PUB_ID

  const { data: job } = useQuery<SlideDeckJob>({
    queryKey: ['slidedeck', pubId, DEMO_JOB_ID],
    queryFn:  () => platformApi.getSlideDeckJob(pubId, DEMO_JOB_ID),
  })

  const [source, setSource]         = useState<typeof SOURCES[number]>('Full manuscript')
  const [rightTab, setRightTab]     = useState<RightTab>('content')
  const [activeSlideId, setActiveSlideId] = useState<string>('slide-001')
  const [altText, setAltText]       = useState<string>('')
  const [altSaved, setAltSaved]     = useState<boolean>(false)
  const [acceptedIds, setAcceptedIds] = useState<Set<string>>(new Set())

  const activeSlide = job?.slides.find(s => s.id === activeSlideId) ?? job?.slides[0] ?? null

  const congressGate = job?.congressGateActive ?? true
  const accessGate   = (job?.accessibilityGate.active && !altSaved) ?? true

  const missingAlt   = job?.accessibilityGate.missingAltText ?? []
  const missingFig   = missingAlt[0] // fig-003 on slide-006 in fixture

  const canExport = !congressGate && !accessGate

  const totalSlides   = job?.totalSlides ?? 0
  const visibleSlides = job?.slides ?? []
  const moreCount     = Math.max(0, totalSlides - visibleSlides.length)

  const activePosition = useMemo(() => {
    const idx = visibleSlides.findIndex(s => s.id === activeSlide?.id)
    return idx >= 0 ? visibleSlides[idx].position : 1
  }, [visibleSlides, activeSlide])

  const saveAlt = () => {
    if (!altText.trim()) return
    setAltSaved(true)
    void platformApi.updateSlide(pubId, DEMO_JOB_ID, 'slide-006', {
      figures: (activeSlide?.figures ?? []).map(f => f.figureId === 'fig-003' ? { ...f, altText } : f),
    } as Partial<Slide>).catch(() => {})
  }
  const acceptSlide = () => activeSlide && setAcceptedIds(new Set([...acceptedIds, activeSlide.id]))
  const regenerate = () => {
    // Regenerating replaces every slide not accepted. Accepted slides are kept.
    void qc.invalidateQueries({ queryKey: ['slidedeck', pubId, DEMO_JOB_ID] })
  }
  const doExport = async (format: 'pptx' | 'pdf') => {
    if (!canExport) return
    await platformApi.exportSlideDeck(pubId, DEMO_JOB_ID).catch(() => {})
    void format
  }

  if (!job || !activeSlide) {
    return <div className="p-8 text-center text-sm text-slate-500" data-screen="slide-deck-generator">Loading…</div>
  }

  return (
    <div className="bg-slate-50" data-screen="slide-deck-generator" data-module-accent={MODULE_B_SB10_ACCENT.primary}>
      <div className="mx-auto flex flex-col gap-4" style={{ maxWidth: 1600, padding: '20px 24px 48px' }}>

        <nav className="flex items-center gap-2 text-xs text-slate-500">
          <button onClick={() => navigate(`/projects/${projectId}/scientific-writing`)} className="hover:text-slate-900">Scientific Writing</button>
          <span style={{ color: '#CBD5E1' }}>&gt;</span>
          <button onClick={() => navigate(`/projects/${projectId}/scientific-writing/publications/${pubId}`)} className="hover:text-slate-900">{job.publicationTitle}</button>
          <span style={{ color: '#CBD5E1' }}>&gt;</span>
          <span className="font-semibold text-slate-900">Slide Deck</span>
        </nav>

        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <h1 className="text-[22px] font-bold text-slate-900" style={{ margin: 0 }}>Slide deck generator</h1>
            <p className="mt-1 font-mono text-xs text-slate-500">
              {job.publicationTitle} · {job.congressTarget} · {job.slideCountLimit} slides max · 16:9
            </p>
          </div>
        </div>

        {/* Three-column layout */}
        <div className="grid gap-4" style={{ gridTemplateColumns: '300px 1fr 340px' }}>

          {/* LEFT — controls */}
          <aside className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4" data-left-panel>
            <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Source</p>
            <p className="text-[13px] font-semibold text-slate-900">{job.publicationTitle}</p>
            <p className="font-mono text-[10px] text-slate-500">Congress target: {job.congressTarget}</p>

            {congressGate && (
              <div
                className="rounded-md p-2 text-[12px] font-semibold"
                style={{ backgroundColor: '#FFFBEB', color: '#B45309', border: '1px solid #FDE68A' }}
                data-congress-gate
              >⚠ {totalSlides} of {job.slideCountLimit} slides — over congress limit</div>
            )}

            <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">AI attribution</p>
            <p className="font-mono text-[11px] text-slate-700" data-ai-attribution>
              {job.aiFootprintPct}% ✦ · <code>{job.aiModel}</code> · generated {formatUTC(job.generatedAt)}
            </p>

            <div className="flex flex-col gap-2">
              <button type="button" className="h-9 rounded-md px-3 text-[12px] font-semibold text-white" style={{ backgroundColor: MODULE_B_SB10_ACCENT.primary }} data-create-deck>+ Create slide deck with AI</button>
              <button type="button" onClick={regenerate} className="h-9 rounded-md border px-3 text-[12px] font-semibold" style={{ borderColor: MODULE_B_SB10_ACCENT.primary, color: MODULE_B_SB10_ACCENT.primary }} data-regenerate>Regenerate ✦</button>
              <button type="button" className="h-9 rounded-md border border-slate-300 bg-white px-3 text-[12px] font-semibold text-slate-700 hover:bg-slate-50" data-present>▶ Present</button>
            </div>

            <div className="mt-2">
              <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Generate from</p>
              <div className="mt-1 flex flex-col gap-1" data-sources>
                {SOURCES.map(s => (
                  <label key={s} className="flex items-center gap-2 text-[12px] text-slate-700">
                    <input type="radio" name="source" checked={source === s} onChange={() => setSource(s)}
                      data-source-radio={s} style={{ accentColor: MODULE_B_SB10_ACCENT.primary }} />
                    {s}
                  </label>
                ))}
              </div>
            </div>

            <p className="mt-2 rounded-md p-2 font-mono text-[11px] text-slate-500" data-regenerate-note>
              Regenerating replaces every slide that has not been accepted. Accepted slides are kept.
            </p>
          </aside>

          {/* CENTRE — thumbnails + canvas */}
          <section className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4" data-centre-panel>
            <div className="flex items-center gap-2 overflow-x-auto pb-2" data-thumbnails>
              {visibleSlides.map(s => {
                const isActive = s.id === activeSlide.id
                const isAccepted = acceptedIds.has(s.id)
                return (
                  <button
                    key={s.id} type="button" onClick={() => setActiveSlideId(s.id)}
                    data-thumb={s.id}
                    data-thumb-active={isActive || undefined}
                    data-thumb-accepted={isAccepted || undefined}
                    className="flex h-16 w-28 flex-none flex-col items-start justify-between rounded-md border p-1.5 text-left"
                    style={{
                      borderColor: isActive ? MODULE_B_SB10_ACCENT.primary : '#E2E8F0',
                      borderWidth: isActive ? 2 : 1,
                      backgroundColor: isAccepted ? '#F0FDF4' : '#FFFFFF',
                    }}
                  >
                    <span className="font-mono text-[9px] text-slate-500">{s.position}</span>
                    <span className="line-clamp-2 text-[10px] text-slate-800">{s.title}</span>
                  </button>
                )
              })}
              {moreCount > 0 && (
                <div className="flex h-16 flex-none items-center justify-center rounded-md border border-dashed border-slate-300 px-3 font-mono text-[10px] text-slate-500" data-more-slides>
                  + {moreCount} more slides
                </div>
              )}
            </div>

            {/* Presence strip */}
            <div className="flex items-center gap-2 rounded-md p-2" style={{ backgroundColor: `${MODULE_B_SB10_ACCENT.primary}11` }} data-presence-strip>
              {PRESENCE.map(p => (
                <div key={p.userId} className="flex items-center gap-1" data-presence-user={p.userId} data-presence-state={p.state}>
                  <span
                    className="inline-flex h-6 w-6 items-center justify-center rounded-full font-mono text-[9px] font-bold text-white"
                    style={{ backgroundColor: MODULE_B_SB10_ACCENT.primary }}
                  >{initialsFor(p.name)}</span>
                  <span className="text-[11px] font-semibold text-slate-800">
                    {p.name}
                    {p.state === 'you'                 && ' (you)'}
                    {p.state === 'viewing'             && <span className="ml-1 font-mono text-[10px] text-slate-500">viewing</span>}
                    {p.state === 'editing-slide-06'    && <span className="ml-1 font-mono text-[10px] text-slate-500">editing slide 06</span>}
                  </span>
                </div>
              ))}
            </div>

            {/* Canvas */}
            <div className="rounded-lg border border-slate-200 bg-white p-6" data-slide-canvas>
              <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Slide {activePosition} of {totalSlides} · 16:9</p>
              <h2 className="mt-3 text-[20px] font-bold text-slate-900" data-slide-title>{activeSlide.title}</h2>
              <p className="mt-3 whitespace-pre-line text-[13px] text-slate-700" data-slide-body>{activeSlide.bodyText}</p>
            </div>
          </section>

          {/* RIGHT — tabbed */}
          <aside className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4" data-right-panel>
            <div className="flex items-center gap-1 border-b border-slate-200" data-tabs>
              {(['content','notes','figures'] as RightTab[]).map(t => (
                <button
                  key={t} type="button" onClick={() => setRightTab(t)}
                  data-tab={t} data-active={t === rightTab || undefined}
                  className="px-2 py-1 text-[12px] font-semibold capitalize"
                  style={{
                    color: t === rightTab ? MODULE_B_SB10_ACCENT.primary : '#64748B',
                    borderBottom: t === rightTab ? `2px solid ${MODULE_B_SB10_ACCENT.primary}` : '2px solid transparent',
                  }}
                >{t}</button>
              ))}
            </div>

            {rightTab === 'content' && (
              <div className="flex flex-col gap-2" data-tab-panel="content">
                <label className="flex flex-col gap-1">
                  <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Slide title</span>
                  <input defaultValue={activeSlide.title} className="h-9 rounded-md border border-slate-300 px-3 text-[13px]" />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Body</span>
                  <textarea defaultValue={activeSlide.bodyText} rows={5} className="rounded-md border border-slate-300 p-2 text-[12px]" />
                </label>
                <button type="button" className="self-start text-[12px] font-semibold hover:underline" style={{ color: MODULE_B_SB10_ACCENT.primary }} data-insert-figure>Insert figure from CSR →</button>

                <div className="mt-2 rounded-md border border-slate-200 p-2" data-ai-refine>
                  <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">AI refine</p>
                  <textarea placeholder="Ask AI to refine this slide…" rows={2} className="mt-1 w-full rounded-md border border-slate-300 p-2 text-[12px]" />
                  <div className="mt-2 flex gap-2">
                    <button type="button" onClick={acceptSlide} className="h-8 rounded-md px-3 text-[12px] font-semibold text-white" style={{ backgroundColor: MODULE_B_SB10_ACCENT.primary }} data-accept>Accept</button>
                    <button type="button" className="h-8 rounded-md border border-slate-300 bg-white px-3 text-[12px] font-semibold text-slate-700" data-discard>Discard</button>
                  </div>
                </div>
              </div>
            )}

            {rightTab === 'notes' && (
              <div className="flex flex-col gap-2" data-tab-panel="notes">
                <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Speaker notes</span>
                <textarea defaultValue={activeSlide.speakerNotes} rows={8} className="rounded-md border border-slate-300 p-2 text-[12px]" data-speaker-notes />
              </div>
            )}

            {rightTab === 'figures' && (
              <div className="flex flex-col gap-2" data-tab-panel="figures">
                {activeSlide.figures.length === 0 && <p className="text-[12px] text-slate-500">No figures on this slide.</p>}
                {activeSlide.figures.map(f => {
                  const isMissing = !f.altText
                  return (
                    <div key={f.figureId} className="rounded-md border border-slate-200 p-2" data-figure={f.figureId} data-figure-missing={isMissing || undefined}>
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-[11px] font-semibold text-slate-800">{f.figureId}</span>
                        {isMissing
                          ? <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium" style={{ backgroundColor: '#FFFBEB', color: '#B45309' }}>⚠ Missing</span>
                          : <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium" style={{ backgroundColor: '#F0FDF4', color: '#166534' }}>✓ Alt text</span>}
                      </div>
                      {!isMissing && <p className="mt-1 text-[11px] text-slate-600">{f.altText}</p>}
                    </div>
                  )
                })}
              </div>
            )}
          </aside>
        </div>

        {/* Export panel */}
        <section className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-5" data-export-panel>
          <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Export</p>

          <div className="flex flex-wrap items-center gap-3 text-[12px] text-slate-700">
            <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Format</span>
            <label className="flex items-center gap-1"><input type="radio" name="fmt" defaultChecked /> .pptx</label>
            <label className="flex items-center gap-1"><input type="radio" name="fmt" /> PDF</label>
            <span className="ml-4 font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Template</span>
            <span className="font-semibold text-slate-800">{job.clientTemplate.label}</span>
          </div>

          {accessGate && missingFig && (
            <div className="rounded-lg border p-3" style={{ backgroundColor: '#FFFBEB', borderColor: '#FDE68A' }} data-alt-gate>
              <p className="text-[12px] font-semibold" style={{ color: '#B45309' }}>
                ⚠ Accessibility check failed · Figure 3 on slide 6 is missing alt text.
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input
                  type="text" placeholder={missingFig.figureDescription}
                  value={altText} onChange={(e) => setAltText(e.currentTarget.value)}
                  data-alt-input={missingFig.figureId}
                  className="h-9 flex-1 min-w-[240px] rounded-md border border-slate-300 px-3 text-[12px]"
                />
                <button type="button" onClick={saveAlt} disabled={!altText.trim()}
                  data-resolve-alt
                  className="h-9 rounded-md px-3 text-[12px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
                  style={{ backgroundColor: MODULE_B_SB10_ACCENT.primary }}
                >Save alt text</button>
              </div>
            </div>
          )}

          {congressGate && (
            <div className="rounded-lg border p-3" style={{ backgroundColor: '#FFFBEB', borderColor: '#FDE68A' }} data-congress-slide-gate>
              <p className="text-[12px] font-semibold" style={{ color: '#B45309' }}>
                ⚠ Slide limit exceeded · {totalSlides} slides against {job.slideCountLimit}-slide limit.
              </p>
            </div>
          )}

          <div className="flex items-center gap-2">
            <button type="button" onClick={() => doExport('pptx')} disabled={!canExport}
              data-export-pptx
              className="h-9 rounded-md px-4 text-[13px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
              style={{ backgroundColor: MODULE_B_SB10_ACCENT.primary }}
            >Export .pptx →</button>
            <button type="button" onClick={() => doExport('pdf')} disabled={!canExport}
              data-export-pdf
              className="h-9 rounded-md border px-4 text-[13px] font-semibold disabled:cursor-not-allowed disabled:opacity-40"
              style={{ borderColor: MODULE_B_SB10_ACCENT.primary, color: MODULE_B_SB10_ACCENT.primary }}
            >Export PDF →</button>
          </div>

          <p className="font-mono text-[11px] text-slate-500" data-export-note>
            Export unlocks when the accessibility check passes and the slide count is within the congress limit.
          </p>
        </section>
      </div>
    </div>
  )
}
