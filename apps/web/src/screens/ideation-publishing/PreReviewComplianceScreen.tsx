import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { AtomisedContent, IdeationContentCard, IdeationProject } from '@platform/types'
import { ProvenanceChip } from '../../components/ui/ProvenanceChip'
import { ClaimCurrencyBadge } from '../../components/ui/ClaimCurrencyBadge'
import { useIdeationStore, useAtomisationStore } from '../../modules/ideation-publishing/store'
import ideationCardsFixture    from '../../data/ideationContentCards.json'
import ideationProjectsFixture from '../../data/ideationProjects.json'
import atomisedFixture         from '../../data/atomisedContent.json'

const CARDS       = ideationCardsFixture    as unknown as IdeationContentCard[]
const PROJECTS    = ideationProjectsFixture as unknown as IdeationProject[]
const ADAPTATIONS = atomisedFixture         as unknown as AtomisedContent[]

interface MustFixIssue {
  id:         string
  cardId:     string
  channelId:  string
  channel:    string
  code:       string
  headline:   string
  detail:     string
  suggested:  string
  resolvedAt: string
  resolvedBy: string
  resolvedByRole: string
}

interface AdvisoryIssue {
  id:        string
  cardId:    string
  channelId: string
  channel:   string
  headline:  string
  detail:    string
  acknowledgedBy?: string
}

// Fixture: single Must Fix on ac-001 already resolved by Ideation Lead
const MUST_FIX_ISSUES: MustFixIssue[] = [
  {
    id:         'mf-001',
    cardId:     'c-001',
    channelId:  'ac-001',
    channel:    'LinkedIn',
    code:       'IFPMA Code §5.2',
    headline:   'Promotional comparative framing without cited source',
    detail:     'Phrase "reinforces the clinical benefit" is promotional comparative framing without a cited source.',
    suggested:  'Replace with: "demonstrated a hazard ratio of 0.61 (95% CI 0.48–0.77; p<0.001)"',
    resolvedAt: '2026-11-09T10:31:00Z',
    resolvedBy: 'Ms Priya Nair',
    resolvedByRole: 'Ideation Lead',
  },
]

const ADVISORY_ISSUES: AdvisoryIssue[] = [
  {
    id:        'adv-001',
    cardId:    'c-001',
    channelId: 'ac-001',
    channel:   'LinkedIn',
    headline:  "Abbreviation 'HR' unexpanded on first use",
    detail:    "Expand to 'hazard ratio (HR)' for general audience clarity.",
    acknowledgedBy: 'Ms Priya Nair',
  },
  {
    id:        'adv-002',
    cardId:    'c-001',
    channelId: 'ac-002',
    channel:   'Blog Post',
    headline:  'Fair-balance recommendation',
    detail:    'Consider a short safety-summary line alongside the efficacy headline.',
    acknowledgedBy: 'Ms Priya Nair',
  },
]

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const dd = String(d.getUTCDate()).padStart(2, '0')
  const hh = String(d.getUTCHours()).padStart(2, '0')
  const mm = String(d.getUTCMinutes()).padStart(2, '0')
  return `${dd} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()} ${hh}:${mm} UTC`
}

function complianceCountsFor(cardId: string) {
  const mustFixTotal      = MUST_FIX_ISSUES.filter(i => i.cardId === cardId).length
  const mustFixUnresolved = MUST_FIX_ISSUES.filter(i => i.cardId === cardId && !i.resolvedAt).length
  const advisory          = ADVISORY_ISSUES.filter(i => i.cardId === cardId).length
  return { mustFixTotal, mustFixUnresolved, advisory }
}

interface CardListRowProps {
  card:     IdeationContentCard
  isActive: boolean
  onSelect: () => void
}

function CardListRow({ card, isActive, onSelect }: CardListRowProps) {
  const counts = complianceCountsFor(card.id)
  const gateOpen = counts.mustFixUnresolved === 0
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
          style={{ backgroundColor: gateOpen ? '#F0FDF4' : '#FEF2F2', color: gateOpen ? '#166534' : '#991B1B', letterSpacing: '0.06em' }}
          data-compliance-status={gateOpen ? 'open' : 'blocked'}
        >{gateOpen ? '✓ Ready' : '⊘ Blocked'}</span>
        <ClaimCurrencyBadge status={card.claimCurrencyStatus} compact />
      </div>
      <p className="text-[14px] font-bold text-slate-900">{card.title}</p>
      <p className="text-[11px] text-slate-500">{card.sourceSection}</p>
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <span
          className="rounded-md px-2 py-0.5 font-semibold"
          style={{ backgroundColor: '#F0FDF4', color: '#166534' }}
          data-must-fix-count={counts.mustFixUnresolved}
        >✓ {counts.mustFixUnresolved} Must Fix</span>
        <span
          className="rounded-md px-2 py-0.5 font-semibold"
          style={{ backgroundColor: '#F0FDFA', color: '#0F766E' }}
          data-advisory-count={counts.advisory}
        >{counts.advisory} Advisory</span>
      </div>
    </button>
  )
}

export function PreReviewComplianceScreen() {
  const { projectId, ideationProjectId } = useParams()
  const navigate = useNavigate()

  const setCards       = useIdeationStore(s => s.setCards)
  const setAdaptations = useAtomisationStore(s => s.setAdaptations)

  const cards = useMemo(() => CARDS.filter(c => c.ideationProjectId === ideationProjectId), [ideationProjectId])
  const project = useMemo(() => PROJECTS.find(p => p.id === ideationProjectId), [ideationProjectId])
  const [activeCardId, setActiveCardId] = useState<string>(cards[0]?.id ?? '')
  const activeCard = cards.find(c => c.id === activeCardId) ?? cards[0]

  useEffect(() => { setCards(cards) }, [cards, setCards])
  useEffect(() => { setAdaptations(ADAPTATIONS) }, [setAdaptations])

  const totalUnresolvedMustFix = cards.reduce((n, c) => n + complianceCountsFor(c.id).mustFixUnresolved, 0)
  const gateOpen = totalUnresolvedMustFix === 0

  if (!project || !activeCard) {
    return <div className="p-8 text-center text-sm text-slate-500" data-screen="pre-review-compliance">No cards.</div>
  }

  const activeAdaptations = ADAPTATIONS.filter(a => a.ideationContentCardId === activeCard.id)
  const activeMustFix     = MUST_FIX_ISSUES.filter(i => i.cardId === activeCard.id)
  const activeAdvisories  = ADVISORY_ISSUES.filter(i => i.cardId === activeCard.id)

  const handleSubmitToKOL = () => {
    navigate(`/projects/${projectId}/ideation-publishing/projects/${ideationProjectId}/ma-approval`)
  }

  return (
    <div className="bg-slate-50" data-screen="pre-review-compliance" data-gate-open={gateOpen || undefined}>
      <div className="flex flex-col gap-4" style={{ maxWidth: 1440, padding: '20px 32px 48px' }}>

        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-xs text-slate-500">
          <button onClick={() => navigate(`/projects/${projectId}/ideation-publishing`)} className="hover:text-slate-900">Ideation &amp; Publishing</button>
          <span style={{ color: '#CBD5E1' }}>&gt;</span>
          <button onClick={() => navigate(`/projects/${projectId}/ideation-publishing/projects/${ideationProjectId}`)} className="hover:text-slate-900">{project.title}</button>
          <span style={{ color: '#CBD5E1' }}>&gt;</span>
          <span className="font-semibold text-slate-900">Pre-Review Compliance</span>
        </nav>

        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <h1 className="text-[22px] font-bold text-slate-900" style={{ margin: 0 }}>Pre-Review Compliance</h1>
            <p className="mt-1 font-mono text-xs text-slate-500">Stage 2 (pre-KOL) · {project.title}</p>
          </div>
          <div className="flex flex-none items-center gap-3">
            <div className="flex flex-col text-right">
              <span
                className="text-[11px] font-mono font-semibold uppercase tracking-widest"
                style={{ color: gateOpen ? '#0F766E' : '#BE123C' }}
                data-gate-summary
              >{totalUnresolvedMustFix} Must Fix blocks KOL submission</span>
              <span className="text-[11px] text-slate-500">
                Advisory findings cannot block a gate.
              </span>
            </div>
            <button
              type="button"
              onClick={handleSubmitToKOL}
              disabled={!gateOpen}
              data-submit-to-kol
              className="h-9 rounded-md px-4 text-[13px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
              style={{ backgroundColor: '#0D9488' }}
            >Submit to KOL Review →</button>
          </div>
        </div>

        {/* Two-column body */}
        <div className="grid gap-4" style={{ gridTemplateColumns: '340px 1fr' }}>

          {/* LEFT — card compliance list */}
          <section className="flex flex-col gap-3" data-card-list>
            <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">
              {cards.length} Cards · Compliance status
            </p>
            {cards.map(c => (
              <CardListRow
                key={c.id}
                card={c}
                isActive={c.id === activeCard.id}
                onSelect={() => setActiveCardId(c.id)}
              />
            ))}
          </section>

          {/* RIGHT — active card detail */}
          <section
            className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-5"
            data-card-detail={activeCard.id}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Compliance detail · {activeCard.id}</p>
                <p className="text-[16px] font-bold text-slate-900">{activeCard.title}</p>
                <p className="mt-0.5 text-[12px] text-slate-500">{activeCard.sourceSection}</p>
              </div>
              <div className="flex flex-col items-end gap-1">
                <ClaimCurrencyBadge status={activeCard.claimCurrencyStatus} />
              </div>
            </div>

            {/* ProvenanceChip always visible */}
            <div data-provenance-slot>
              <ProvenanceChip chain={activeCard.provenanceChain} />
            </div>

            {/* Must Fix section */}
            {activeMustFix.length > 0 && (
              <div className="flex flex-col gap-2" data-must-fix-section>
                <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Must Fix — blocks KOL submission until resolved</p>
                {activeMustFix.map(iss => (
                  <div
                    key={iss.id}
                    className="rounded-lg border p-3"
                    style={{ backgroundColor: '#FFFBEB', borderColor: '#FDE68A' }}
                    data-must-fix-issue={iss.id}
                    data-resolved={!!iss.resolvedAt || undefined}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-mono font-semibold uppercase" style={{ backgroundColor: '#FEF3C7', color: '#78350F' }}>{iss.code}</span>
                      <span className="font-mono text-[10px] text-slate-500">{iss.channel} · {iss.channelId}</span>
                      {iss.resolvedAt && (
                        <span
                          className="inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-semibold"
                          style={{ backgroundColor: '#F0FDF4', color: '#166534' }}
                          data-issue-resolved
                        >✓ Resolved</span>
                      )}
                    </div>
                    <p className="mt-2 text-[13px] font-semibold text-slate-900">{iss.headline}</p>
                    <p className="mt-1 text-[12px] text-slate-700">{iss.detail}</p>
                    <p className="mt-2 rounded-md px-2 py-1 text-[12px]" style={{ backgroundColor: '#FEF3C7', color: '#78350F' }}>
                      Suggested fix: {iss.suggested}
                    </p>
                    {iss.resolvedAt && (
                      <p
                        className="mt-2 text-[11px] font-semibold"
                        style={{ color: '#166534' }}
                        data-resolution-stamp
                      >
                        Resolved · {iss.resolvedBy}, {iss.resolvedByRole} · {formatDateTime(iss.resolvedAt)}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Advisory section — teal informational */}
            {activeAdvisories.length > 0 && (
              <div className="flex flex-col gap-2" data-advisory-section>
                <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Advisory — informational only</p>
                {activeAdvisories.map(a => (
                  <div
                    key={a.id}
                    className="rounded-lg border p-3"
                    style={{ backgroundColor: '#F0FDFA', borderColor: '#99F6E4' }}
                    data-advisory-issue={a.id}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: '#CCFBF1', color: '#0F766E' }}>Advisory</span>
                      <span className="font-mono text-[10px] text-slate-500">{a.channel} · {a.channelId}</span>
                    </div>
                    <p className="mt-2 text-[13px] font-semibold text-slate-900">{a.headline}</p>
                    <p className="mt-1 text-[12px] text-slate-700">{a.detail}</p>
                  </div>
                ))}
                <p className="rounded-md px-3 py-2 text-[11px]" style={{ backgroundColor: '#F0FDFA', color: '#0F766E' }} data-advisory-note>
                  Advisory findings cannot block a gate.
                </p>
              </div>
            )}

            {/* Adaptations with resolved fix chips */}
            <div className="flex flex-col gap-2" data-adaptations>
              <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Channels ({activeAdaptations.length})</p>
              {activeAdaptations.map(ad => {
                const fix = ad.complianceFixes[0]
                return (
                  <div
                    key={ad.id}
                    className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-3 text-[12px]"
                    data-adaptation-row={ad.id}
                  >
                    <span
                      className="inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase"
                      style={{ backgroundColor: '#F0FDFA', color: '#0F766E', letterSpacing: '0.06em' }}
                    >{ad.channelLabel}</span>
                    {ad.complianceScreenPassed && (
                      <span className="rounded-md px-2 py-0.5 font-semibold" style={{ backgroundColor: '#F0FDF4', color: '#166534' }}>Compliance ✓</span>
                    )}
                    {fix && (
                      <span
                        className="rounded-md px-2 py-0.5 text-[11px] font-semibold"
                        style={{ backgroundColor: '#FFFBEB', color: '#B45309', border: '1px solid #FDE68A' }}
                        data-fix-applied
                      >1 fix applied · '{"transformative"}' removed per MLR guidance §4.2</span>
                    )}
                  </div>
                )
              })}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
