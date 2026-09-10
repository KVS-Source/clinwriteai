import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { IdeationContentCard, IdeationProject, KOLContact } from '@platform/types'
import { ProvenanceChip } from '../../components/ui/ProvenanceChip'
import { ClaimCurrencyBadge } from '../../components/ui/ClaimCurrencyBadge'
import { useIdeationStore } from '../../modules/ideation-publishing/store'
import ideationCardsFixture    from '../../data/ideationContentCards.json'
import ideationProjectsFixture from '../../data/ideationProjects.json'
import kolContactsFixture      from '../../data/kolContacts.json'

const CARDS    = ideationCardsFixture    as unknown as IdeationContentCard[]
const PROJECTS = ideationProjectsFixture as unknown as IdeationProject[]
const KOLS     = kolContactsFixture      as unknown as KOLContact[]

const IL_RESOLUTION = {
  resolvedBy:  'Ms Priya Nair',
  resolvedRole:'Ideation Lead',
  resolvedAt:  '2026-10-21T09:15:00Z',
  note:        'Current label thresholds confirmed with CMC Lead. Subgroup claim consistent with approved SmPC v2.1.',
}

function formatDateOnly(iso: string): string {
  const d = new Date(iso)
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}
function formatDateTime(iso: string): string {
  const d = new Date(iso)
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const dd = String(d.getUTCDate()).padStart(2, '0')
  const hh = String(d.getUTCHours()).padStart(2, '0')
  const mm = String(d.getUTCMinutes()).padStart(2, '0')
  return `${dd} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()} ${hh}:${mm} UTC`
}

interface CardListRowProps {
  card:      IdeationContentCard
  isActive:  boolean
  onSelect:  () => void
  kolDecision?: 'approved' | 'rejected' | 'pending'
  kolHasComment: boolean
  maApproved: boolean
}

function CardListRow(p: CardListRowProps) {
  return (
    <button
      type="button"
      onClick={p.onSelect}
      data-card-row={p.card.id}
      data-active={p.isActive || undefined}
      className="flex w-full flex-col gap-2 rounded-lg border bg-white p-4 text-left transition-shadow hover:shadow-sm"
      style={{ borderColor: p.isActive ? '#0D9488' : '#E2E8F0', borderWidth: p.isActive ? 2 : 1 }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase" style={{ backgroundColor: '#F0FDF4', color: '#166534', letterSpacing: '0.06em' }}>KOL ✓ {p.kolDecision ?? 'pending'}</span>
        <span className="inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase" style={{ backgroundColor: '#F0FDFA', color: '#0F766E', letterSpacing: '0.06em' }} data-ma-status={p.maApproved ? 'approved' : 'pending'}>MA {p.maApproved ? '✓ Approved' : '○ Pending'}</span>
        {p.kolHasComment && (
          <span className="inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: '#FFFBEB', color: '#B45309' }} data-modification-requested>✎ Modification</span>
        )}
      </div>
      <p className="text-[14px] font-bold text-slate-900">{p.card.title}</p>
      <p className="text-[11px] text-slate-500">{p.card.sourceSection}</p>
      <ClaimCurrencyBadge status={p.card.claimCurrencyStatus} compact />
      <div data-provenance-slot>
        <ProvenanceChip chain={p.card.provenanceChain} compact />
      </div>
    </button>
  )
}

export function MedicalAffairsApproval() {
  const { projectId, ideationProjectId } = useParams()
  const navigate = useNavigate()

  const setCards = useIdeationStore(s => s.setCards)

  const project = useMemo(() => PROJECTS.find(p => p.id === ideationProjectId), [ideationProjectId])
  const cards   = useMemo(() => CARDS.filter(c => c.ideationProjectId === ideationProjectId), [ideationProjectId])
  const kol     = useMemo(() => KOLS.find(k => k.ideationProjectId === ideationProjectId), [ideationProjectId])
  useEffect(() => { setCards(cards) }, [cards, setCards])

  const [activeCardId, setActiveCardId] = useState<string>('c-003') // default to c-003 (KOL comment path)
  const activeCard = cards.find(c => c.id === activeCardId) ?? cards[0]

  const decisionByCard = useMemo(() => {
    const map: Record<string, { decision: 'approved' | 'rejected' | 'pending'; comment: string | null }> = {}
    kol?.reviewDecisions.forEach(d => { map[d.cardId] = { decision: d.decision, comment: d.comment } })
    return map
  }, [kol])

  const approvedCount     = kol?.reviewDecisions.filter(d => d.decision === 'approved').length ?? 0
  const modificationCount = kol?.reviewDecisions.filter(d => d.decision === 'approved' && d.comment).length ?? 0
  const approvedNoComment = approvedCount - modificationCount

  const maApproved = !!project?.maApprovedAt

  if (!project || !activeCard || !kol) {
    return <div className="p-8 text-center text-sm text-slate-500" data-screen="ma-approval">Project not found.</div>
  }

  const activeDecision = decisionByCard[activeCard.id]

  return (
    <div className="bg-slate-50" data-screen="ma-approval">
      <div className="mx-auto flex flex-col gap-4" style={{ maxWidth: 1440, padding: '20px 32px 48px' }}>

        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-xs text-slate-500">
          <button onClick={() => navigate(`/projects/${projectId}/ideation-publishing`)} className="hover:text-slate-900">Ideation &amp; Publishing</button>
          <span style={{ color: '#CBD5E1' }}>&gt;</span>
          <button onClick={() => navigate(`/projects/${projectId}/ideation-publishing/projects/${ideationProjectId}`)} className="hover:text-slate-900">{project.title}</button>
          <span style={{ color: '#CBD5E1' }}>&gt;</span>
          <span className="font-semibold text-slate-900">Medical Affairs Approval</span>
        </nav>

        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <h1 className="text-[22px] font-bold text-slate-900" style={{ margin: 0 }}>Medical Affairs Approval</h1>
            <p className="mt-1 font-mono text-xs text-slate-500">Stage 4 · {project.title}</p>
            <p
              className="mt-2 text-[12px]"
              style={{ color: '#0F766E' }}
              data-kol-outcome-summary
            >
              {kol.name} · {formatDateTime(kol.signedOffAt ?? kol.reviewLinkExpiry)} · {approvedNoComment} approved · {modificationCount} modification requested
            </p>
          </div>
          <div className="flex flex-none gap-2">
            <button
              type="button"
              onClick={() => navigate(`/projects/${projectId}/ideation-publishing/calendar`)}
              disabled={!maApproved}
              data-proceed-to-calendar
              className="h-9 rounded-md border border-slate-300 bg-white px-3 text-[13px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
            >Proceed to calendar →</button>
            <button
              type="button"
              disabled={maApproved}
              data-approve-all
              className="h-9 rounded-md px-4 text-[13px] font-semibold text-white disabled:cursor-not-allowed"
              style={{ backgroundColor: maApproved ? '#0F766E' : '#0D9488' }}
            >{maApproved ? '✓ All approved' : 'Approve all →'}</button>
          </div>
        </div>

        {/* Two-column body */}
        <div className="grid gap-4" style={{ gridTemplateColumns: '380px 1fr' }}>

          {/* LEFT — card list */}
          <section className="flex flex-col gap-3" data-card-list>
            <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Cards · KOL + MA status</p>
            {cards.map(c => {
              const d = decisionByCard[c.id]
              return (
                <CardListRow
                  key={c.id}
                  card={c}
                  isActive={c.id === activeCard.id}
                  onSelect={() => setActiveCardId(c.id)}
                  kolDecision={d?.decision}
                  kolHasComment={!!d?.comment}
                  maApproved={maApproved}
                />
              )
            })}
          </section>

          {/* RIGHT — active card detail */}
          <section
            className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-5"
            data-card-detail={activeCard.id}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">{activeCard.id} · {activeCard.sourceSection}</p>
                <p className="text-[16px] font-bold text-slate-900">{activeCard.title}</p>
              </div>
              <ClaimCurrencyBadge status={activeCard.claimCurrencyStatus} />
            </div>

            <div data-provenance-slot>
              <ProvenanceChip chain={activeCard.provenanceChain} />
            </div>

            {/* Source passage — read-only */}
            <div
              className="rounded-md p-3 text-[13px] leading-relaxed text-slate-700"
              style={{ backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0' }}
              data-source-passage
            >
              "{activeCard.sourcePassage}"
            </div>

            {/* KOL review section */}
            <div
              className="rounded-lg border p-4"
              style={{ backgroundColor: '#F0FDF4', borderColor: '#BBF7D0' }}
              data-kol-review-section
            >
              <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-600">KOL Review</p>
              <p className="mt-1 text-[13px] font-semibold text-slate-900">
                {kol.name} · {kol.title} · {activeDecision?.decision === 'approved' ? '✓ Approved' : activeDecision?.decision === 'rejected' ? '⊘ Rejected' : '○ Pending'} · {formatDateTime(kol.signedOffAt ?? kol.reviewLinkExpiry)}
              </p>
              {activeDecision?.comment && (
                <div
                  className="mt-2 rounded-md p-3 text-[12px]"
                  style={{ backgroundColor: '#FFFFFF', border: '1px solid #86EFAC' }}
                  data-kol-comment
                >
                  <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">KOL comment</p>
                  <p className="mt-1 text-slate-800">"{activeDecision.comment}"</p>
                </div>
              )}
            </div>

            {/* Ideation Lead resolution (only when there's a KOL comment) — AC-E-010 */}
            {activeDecision?.comment && (
              <div
                className="rounded-lg border p-4"
                style={{ backgroundColor: '#F0FDFA', borderColor: '#99F6E4' }}
                data-il-resolution
              >
                <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-600">Ideation Lead resolution</p>
                <p className="mt-1 text-[13px] font-semibold text-slate-900" data-il-resolution-header>
                  Resolved by {IL_RESOLUTION.resolvedBy} ({IL_RESOLUTION.resolvedRole}) · {formatDateOnly(IL_RESOLUTION.resolvedAt)}
                </p>
                <p className="mt-1 text-[12px] text-slate-700">{IL_RESOLUTION.note}</p>
              </div>
            )}

            {/* MA approval strip */}
            <div
              className="rounded-lg border p-4"
              style={{ backgroundColor: '#F0FDFA', borderColor: '#99F6E4' }}
              data-ma-approval-strip
            >
              <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-600">MA Team Lead approval</p>
              <p className="mt-1 text-[13px] font-semibold text-slate-900">
                {project.maApprovedByName ?? 'Dr Rebecca Morton'} · {project.maApprovedByRole ?? 'MA Team Lead'} · Digital approval stamp
              </p>
              {project.maApprovedAt && (
                <p className="mt-1 text-[12px]" style={{ color: '#0F766E' }} data-ma-approved-at>
                  ✓ Approved · {formatDateTime(project.maApprovedAt)}
                </p>
              )}
              <p
                className="mt-2 rounded-md px-2 py-1 text-[11px] font-mono"
                style={{ backgroundColor: '#FFFFFF', color: '#475569', border: '1px solid #CBD5E1' }}
                data-not-e-signature-note
              >
                This is a digital approval record, not a regulatory e-signature (AC-E-011).
              </p>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
