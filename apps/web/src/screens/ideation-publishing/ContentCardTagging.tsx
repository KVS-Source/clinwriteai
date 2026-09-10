import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type {
  AtomisedContent, ChannelFormat, IdeationContentCard, IdeationProject,
} from '@platform/types'
import { CHANNEL_META } from '@platform/types'
import { ProvenanceChip } from '../../components/ui/ProvenanceChip'
import { ClaimCurrencyBadge } from '../../components/ui/ClaimCurrencyBadge'
import { ChannelAdaptationCard } from '../../components/ui/ChannelAdaptationCard'
import { AtomisationSpinner } from '../../components/ui/AtomisationSpinner'
import { useIdeationStore } from '../../modules/ideation-publishing/store'
import { useAtomisationStore } from '../../modules/ideation-publishing/store'
import ideationCardsFixture      from '../../data/ideationContentCards.json'
import ideationProjectsFixture   from '../../data/ideationProjects.json'
import atomisedFixture           from '../../data/atomisedContent.json'

const CARDS       = ideationCardsFixture      as unknown as IdeationContentCard[]
const PROJECTS    = ideationProjectsFixture   as unknown as IdeationProject[]
const ADAPTATIONS = atomisedFixture           as unknown as AtomisedContent[]

function formatDay(iso: string): string {
  const d = new Date(iso)
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]}`
}

interface CardRowProps {
  card:     IdeationContentCard
  isActive: boolean
  onSelect: () => void
}

function CardRow({ card, isActive, onSelect }: CardRowProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      data-card-row={card.id}
      data-active={isActive || undefined}
      className="flex w-full flex-col gap-2 rounded-lg border bg-white p-4 text-left transition-shadow hover:shadow-sm"
      style={{ borderColor: isActive ? '#0D9488' : '#E2E8F0', borderWidth: isActive ? 2 : 1 }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase"
          style={{ backgroundColor: '#F0FDF4', color: '#166534', letterSpacing: '0.06em' }}
          data-status-pill={card.overallStatus}
        >Approved</span>
        <ClaimCurrencyBadge status={card.claimCurrencyStatus} compact />
        <span className="font-mono text-[10px] text-slate-400">{card.id}</span>
      </div>
      <p className="text-[14px] font-bold text-slate-900">{card.title}</p>
      <p className="text-[12px] text-slate-500">{card.sourceSection}</p>
      <div data-provenance-slot>
        <ProvenanceChip chain={card.provenanceChain} compact />
      </div>
      <div className="flex flex-wrap items-center gap-1" data-channels>
        {card.channelFormats.map(ch => (
          <span
            key={ch}
            className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold"
            style={{ backgroundColor: '#F1F5F9', color: '#475569' }}
            data-channel-chip={ch}
          >{CHANNEL_META[ch]?.label ?? ch}</span>
        ))}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-3 text-[10px] text-slate-500">
        <span>KOL ✓ {card.kolApprovedBy}</span>
        <span>MA ✓ Dr Rebecca Morton</span>
      </div>
      {card.claimCurrencyFlag && (
        <p
          className="rounded-md px-2 py-1 text-[11px]"
          style={{ backgroundColor: '#F0FDF4', color: '#166534' }}
          data-flag-acknowledged
        >
          ✓ Flag acknowledged · Ms Priya Nair · {formatDay(card.claimCurrencyFlag.acknowledgedAt)}
        </p>
      )}
    </button>
  )
}

export function ContentCardTagging() {
  const { projectId, ideationProjectId } = useParams()
  const navigate = useNavigate()

  const setCards          = useIdeationStore(s => s.setCards)
  const setAdaptations    = useAtomisationStore(s => s.setAdaptations)
  const generatingChannels = useAtomisationStore(s => s.generatingChannels)
  const startGenerating   = useAtomisationStore(s => s.startGenerating)
  const finishGenerating  = useAtomisationStore(s => s.finishGenerating)

  const cards = useMemo(() => CARDS.filter(c => c.ideationProjectId === ideationProjectId), [ideationProjectId])
  const project = useMemo(() => PROJECTS.find(p => p.id === ideationProjectId), [ideationProjectId])
  const [activeCardId, setActiveCardId] = useState<string>(cards[0]?.id ?? '')

  useEffect(() => { setCards(cards) }, [cards, setCards])
  useEffect(() => { setAdaptations(ADAPTATIONS) }, [setAdaptations])

  const activeCard = cards.find(c => c.id === activeCardId) ?? cards[0]
  const cardAdaptations = ADAPTATIONS.filter(a => a.ideationContentCardId === activeCard?.id)

  const handleAtomise = (channel: ChannelFormat) => {
    startGenerating(channel)
    // DD-E-004: one API call per channel, individual per-channel spinner
    window.setTimeout(() => finishGenerating(channel), 1200)
  }

  if (!project || !activeCard) {
    return <div className="p-8 text-center text-sm text-slate-500" data-screen="content-card-tagging">No cards for {ideationProjectId}.</div>
  }

  return (
    <div className="bg-slate-50" data-screen="content-card-tagging">
      <div className="mx-auto flex flex-col gap-4" style={{ maxWidth: 1600, padding: '20px 24px 48px' }}>

        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-xs text-slate-500">
          <button onClick={() => navigate(`/projects/${projectId}/ideation-publishing`)} className="hover:text-slate-900">Ideation &amp; Publishing</button>
          <span style={{ color: '#CBD5E1' }}>&gt;</span>
          <button onClick={() => navigate(`/projects/${projectId}/ideation-publishing/projects/${ideationProjectId}`)} className="hover:text-slate-900">{project.title}</button>
          <span style={{ color: '#CBD5E1' }}>&gt;</span>
          <span className="font-semibold text-slate-900">Tagging &amp; Atomisation</span>
        </nav>

        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <h1 className="text-[22px] font-bold text-slate-900" style={{ margin: 0 }}>Content Card Tagging &amp; Atomisation</h1>
            <p className="mt-1 font-mono text-xs text-slate-500">Stage 2 · {project.title}</p>
          </div>
          <div className="flex flex-none gap-2">
            <button
              type="button"
              onClick={() => navigate(`/projects/${projectId}/ideation-publishing/projects/${ideationProjectId}`)}
              className="h-9 rounded-md border border-slate-300 bg-white px-3 text-[13px] font-semibold text-slate-700 hover:bg-slate-50"
            >← Back</button>
            <button
              type="button"
              onClick={() => navigate(`/projects/${projectId}/ideation-publishing/projects/${ideationProjectId}/compliance`)}
              data-proceed-to-compliance
              className="h-9 rounded-md px-3 text-[13px] font-semibold text-white"
              style={{ backgroundColor: '#0D9488' }}
            >Proceed to compliance →</button>
          </div>
        </div>

        {/* Three-panel body */}
        <div className="grid gap-4" style={{ gridTemplateColumns: '340px 340px 1fr' }}>

          {/* LEFT — source document (read-only, DD-E-001) */}
          <aside
            className="flex flex-col rounded-lg border border-slate-200 bg-white"
            data-source-document
            data-read-only
            style={{ maxHeight: 760 }}
          >
            <header className="flex flex-col gap-1 border-b border-slate-200 px-4 py-3">
              <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Source document — read-only</span>
              <p className="text-[13px] font-semibold text-slate-900">VELORA-301 KOL Advisory Board Summary v1.0</p>
              <p className="font-mono text-[10px] text-slate-500">DD-E-001 · edits at source in Module C only</p>
            </header>
            <div
              className="flex-1 overflow-auto px-4 py-3 text-[12px] leading-relaxed text-slate-700"
              onClick={(e) => {
                const marker = document.createElement('span')
                marker.textContent = '+ Tag'
                marker.style.cssText = 'position:fixed;top:' + e.clientY + 'px;left:' + e.clientX + 'px;padding:2px 6px;background:#0D9488;color:white;border-radius:4px;font-size:11px;font-weight:600;pointer-events:none;z-index:9999;'
                marker.setAttribute('data-tag-affordance', '+')
                document.body.appendChild(marker)
                setTimeout(() => marker.remove(), 800)
              }}
              data-source-body
            >
              <p className="mt-2">
                <mark style={{ backgroundColor: '#CCFBF1', padding: '1px 3px' }} data-tagged-section="§3.2">
                  <strong>§3.2 Primary endpoint.</strong> Veloricept plus pembrolizumab demonstrated a statistically
                  significant improvement in progression-free survival (hazard ratio 0.61; 95% CI 0.48–0.77;
                  p&lt;0.001) in the intention-to-treat population, with a median PFS of 14.2 months versus 8.7
                  months with pembrolizumab alone.
                </mark>
              </p>
              <p className="mt-2">
                <mark style={{ backgroundColor: '#CCFBF1', padding: '1px 3px' }} data-tagged-section="§3.4">
                  <strong>§3.4 Subgroups.</strong> Benefit was consistent across PD-L1 expression level (CPS ≥1%
                  and ≥50%) and tumour histology (squamous and non-squamous). Interaction p-values were
                  non-significant.
                </mark>
              </p>
              <p className="mt-2">
                <mark style={{ backgroundColor: '#CCFBF1', padding: '1px 3px' }} data-tagged-section="§4.1">
                  <strong>§4.1 Safety overview.</strong> Grade 3 or higher treatment-related adverse events
                  occurred in 52% of patients in the veloricept arm versus 44% in the control arm. No new safety
                  signals were identified.
                </mark>
              </p>
              <p className="mt-3 text-slate-600">
                <strong>§4.3 Notable AEs.</strong> Pneumonitis was reported in 8% of veloricept-treated patients.
                Discontinuation due to AEs occurred in 12% versus 8%.
              </p>
              <p className="mt-4 rounded-md px-3 py-2 text-[11px]" style={{ backgroundColor: '#F1F5F9', color: '#475569' }}>
                Click a passage → shows <strong>+ Tag</strong> affordance. No cursor. No edit mode.
              </p>
            </div>
          </aside>

          {/* CENTRE — content card list */}
          <section className="flex flex-col gap-3" data-card-list>
            <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">
              {cards.length} Content Cards
            </p>
            {cards.map(c => (
              <CardRow
                key={c.id}
                card={c}
                isActive={c.id === activeCard.id}
                onSelect={() => setActiveCardId(c.id)}
              />
            ))}
          </section>

          {/* RIGHT — atomisation panel */}
          <section
            className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-5"
            data-atomisation-panel
            data-active-card={activeCard.id}
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Atomisation · {activeCard.id}</p>
                <p className="text-[15px] font-bold text-slate-900">{activeCard.title}</p>
              </div>
              <span
                className="inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold"
                style={{ backgroundColor: '#F0FDFA', color: '#0F766E' }}
              >{activeCard.channelFormats.length} channels</span>
            </div>

            {/* Source passage (read-only) */}
            <div
              className="rounded-md p-3 text-[12px] leading-relaxed text-slate-700"
              style={{ backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0' }}
              data-source-passage
            >
              <p className="mb-1 font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Source passage · {activeCard.sourceSection}</p>
              "{activeCard.sourcePassage}"
            </div>

            {/* Per-channel spinners (DD-E-004 — one per channel, never a single shared spinner) */}
            <AtomisationSpinner
              channels={activeCard.channelFormats}
              completing={generatingChannels}
            />

            {/* Generate buttons */}
            <div className="flex flex-wrap items-center gap-2" data-generate-buttons>
              {activeCard.channelFormats.map(ch => (
                <button
                  key={ch}
                  type="button"
                  onClick={() => handleAtomise(ch)}
                  disabled={generatingChannels.includes(ch)}
                  data-generate-channel={ch}
                  className="h-8 rounded-md px-3 text-[12px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                  style={{ backgroundColor: '#0D9488' }}
                >
                  Generate ✦ {CHANNEL_META[ch]?.label ?? ch}
                </button>
              ))}
            </div>

            {/* Channel adaptations (one per channel — DD-E-004) */}
            <div className="flex flex-col gap-3" data-adaptations>
              {cardAdaptations.map(a => (
                <ChannelAdaptationCard key={a.id} adaptation={a} onEdit={() => {}} />
              ))}
              {cardAdaptations.length === 0 && (
                <p className="rounded-md border border-dashed border-slate-300 p-4 text-center text-[12px] text-slate-500">
                  No adaptations yet — click Generate ✦ per channel to atomise.
                </p>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
