import { useEffect, useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { CalendarEntry, IdeationContentCard, IdeationProject } from '@platform/types'
import { CHANNEL_META } from '@platform/types'
import { ProvenanceChip } from '../../components/ui/ProvenanceChip'
import { ClaimCurrencyBadge } from '../../components/ui/ClaimCurrencyBadge'
import { useIdeationStore } from '../../modules/ideation-publishing/store'
import ideationProjectsFixture from '../../data/ideationProjects.json'
import ideationCardsFixture    from '../../data/ideationContentCards.json'
import calendarFixture         from '../../data/ideationCalendar.json'

const PROJECTS = ideationProjectsFixture as unknown as IdeationProject[]
const CARDS    = ideationCardsFixture    as unknown as IdeationContentCard[]
const CAL      = calendarFixture         as unknown as CalendarEntry[]

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const dd = String(d.getUTCDate()).padStart(2, '0')
  const hh = String(d.getUTCHours()).padStart(2, '0')
  const mm = String(d.getUTCMinutes()).padStart(2, '0')
  return `${dd} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()} ${hh}:${mm} UTC`
}
function formatDate(iso: string): string {
  const d = new Date(iso)
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${String(d.getUTCDate()).padStart(2, '0')} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

export function FinalOutputPublishingRecord() {
  const { projectId, ideationProjectId } = useParams()
  const navigate = useNavigate()

  const setCards = useIdeationStore(s => s.setCards)

  const project = useMemo(() => PROJECTS.find(p => p.id === ideationProjectId), [ideationProjectId])
  const cards   = useMemo(() => CARDS.filter(c => c.ideationProjectId === ideationProjectId), [ideationProjectId])
  useEffect(() => { setCards(cards) }, [cards, setCards])

  if (!project) {
    return <div className="p-8 text-center text-sm text-slate-500" data-screen="final-output-publishing-record">Project not found.</div>
  }

  const publishedForCard = (cardId: string) =>
    CAL.filter(e => e.ideationContentCardId === cardId && e.status === 'published').length

  const goStandards = () => navigate(`/projects/${projectId}/ideation-publishing/projects/${ideationProjectId}/standards`)
  const goCalendar   = () => navigate(`/projects/${projectId}/ideation-publishing/calendar`)
  const goPublishing = () => navigate(`/projects/${projectId}/ideation-publishing/publishing`)

  return (
    <div className="bg-slate-50" data-screen="final-output-publishing-record">
      <div className="mx-auto flex flex-col gap-4" style={{ maxWidth: 1440, padding: '20px 32px 48px' }}>

        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-xs text-slate-500">
          <button onClick={() => navigate(`/projects/${projectId}/ideation-publishing`)} className="hover:text-slate-900">Ideation &amp; Publishing</button>
          <span style={{ color: '#CBD5E1' }}>&gt;</span>
          <button onClick={() => navigate(`/projects/${projectId}/ideation-publishing/projects/${ideationProjectId}`)} className="hover:text-slate-900">{project.title}</button>
          <span style={{ color: '#CBD5E1' }}>&gt;</span>
          <span className="font-semibold text-slate-900">Final Output</span>
        </nav>

        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <h1 className="text-[22px] font-bold text-slate-900" style={{ margin: 0 }}>Final Output · {project.title}</h1>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-slate-500">
              <span
                className="inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold"
                style={{ backgroundColor: '#F0FDF4', color: '#166534' }}
                data-approved-badge
              >Approved</span>
              <span className="font-mono text-[11px] text-slate-500">
                Completed 28 Oct 2026 · Ms Priya Nair · Ideation Lead
              </span>
            </p>
          </div>
          <div className="flex flex-none gap-2">
            <button
              type="button"
              data-export-record
              className="h-9 rounded-md border border-slate-300 bg-white px-3 text-[13px] font-semibold text-slate-700 hover:bg-slate-50"
            >Export record →</button>
          </div>
        </div>

        {/* Body — two column: main + sidebar */}
        <div className="grid gap-4" style={{ gridTemplateColumns: '1fr 280px' }}>

          {/* MAIN COLUMN */}
          <div className="flex flex-col gap-4">

            {/* Project summary */}
            <section className="rounded-lg border border-slate-200 bg-white p-5" data-project-summary>
              <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Project summary</p>
              <div className="mt-2 flex flex-wrap items-center gap-4">
                <span className="text-[15px] font-bold text-slate-900">{project.title}</span>
                <span
                  className="inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-mono font-semibold uppercase"
                  style={{ backgroundColor: '#F0FDFA', color: '#0F766E', letterSpacing: '0.06em' }}
                >{project.taTag}</span>
                <span className="font-mono text-[11px] text-slate-500">{project.compound} · {project.indication}</span>
              </div>
              {project.maApprovedAt && (
                <p className="mt-2 text-[12px] font-semibold" style={{ color: '#166534' }} data-ma-approval-stamp>
                  MA approved · {project.maApprovedByName ?? 'Dr Rebecca Morton'} · {formatDateTime(project.maApprovedAt)}
                </p>
              )}
              <p className="mt-1 text-[12px] text-slate-600">
                {project.approvedCardCount} of {project.contentCardCount} cards approved
              </p>
            </section>

            {/* Content card summary */}
            <section className="rounded-lg border border-slate-200 bg-white p-5" data-card-summary>
              <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Content cards</p>
              <div className="mt-3 flex flex-col gap-3">
                {cards.map(c => {
                  const published = publishedForCard(c.id)
                  return (
                    <div
                      key={c.id}
                      className="flex flex-col gap-2 rounded-md border border-slate-200 p-3"
                      data-card-row={c.id}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className="inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase"
                          style={{ backgroundColor: '#F0FDF4', color: '#166534', letterSpacing: '0.06em' }}
                        >✓ Approved</span>
                        <ClaimCurrencyBadge status={c.claimCurrencyStatus} compact />
                        <span className="font-mono text-[10px] text-slate-500">{c.id}</span>
                      </div>
                      <p className="text-[13px] font-bold text-slate-900">{c.title}</p>
                      <div className="flex flex-wrap items-center gap-1" data-channels>
                        {c.channelFormats.map(ch => (
                          <span
                            key={ch}
                            className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold"
                            style={{ backgroundColor: '#F1F5F9', color: '#475569' }}
                          >{CHANNEL_META[ch]?.label ?? ch}</span>
                        ))}
                      </div>
                      <p className="font-mono text-[10px] text-slate-500">{published} published across {c.channelFormats.length} channels</p>
                      <div data-provenance-slot>
                        <ProvenanceChip chain={c.provenanceChain} compact />
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>

            {/* Master Library push record */}
            <section
              className="flex flex-col gap-2 rounded-lg border p-5"
              style={{ backgroundColor: '#F0FDFA', borderColor: '#99F6E4' }}
              data-master-library-push
            >
              <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-600">Master Library push</p>
              <p className="text-[13px] text-slate-800">
                {project.approvedCardCount} approved cards from this ideation project are available to push to the Master Library.
              </p>
              <div>
                <button
                  type="button"
                  data-master-library-push-button
                  className="h-9 rounded-md px-4 text-[13px] font-semibold text-white"
                  style={{ backgroundColor: '#0D9488' }}
                >Push approved cards →</button>
              </div>
              <p className="font-mono text-[10px] text-slate-500">Reference — Module D handles the underlying Master Library service.</p>
            </section>

            {/* Compliance provenance */}
            <section className="rounded-lg border border-slate-200 bg-white p-5" data-compliance-provenance>
              <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Compliance provenance</p>
              <ol className="mt-3 flex flex-col gap-2 text-[13px] text-slate-800">
                <li data-provenance-step="source">
                  <strong>Source</strong> · VELORA-301 KOL Advisory Board Summary v1.0 · Module C · Final Output
                </li>
                <li data-provenance-step="source-gate">
                  <strong>Source gate</strong> · ✓ Passed · 18 Oct 2026
                </li>
                <li data-provenance-step="claim-currency">
                  <strong>Claim currency</strong> · ⚠ 1 flag acknowledged · Ms Priya Nair · 19 Oct 2026
                </li>
                <li data-provenance-step="kol">
                  <strong>KOL review</strong> · ✓ Prof. James Hartley · 18 Oct 2026 14:32 UTC
                </li>
                <li data-provenance-step="ma">
                  <strong>MA approval</strong> · ✓ Dr Rebecca Morton · {formatDateTime(project.maApprovedAt ?? '2026-10-19T16:41:00Z')}
                </li>
              </ol>
              <p
                className="mt-4 rounded-md px-3 py-2 text-[11px]"
                style={{ backgroundColor: '#F0FDFA', color: '#0F766E' }}
                data-part-eleven-note
              >
                All events above are logged to the 21 CFR Part 11 compliant platform audit trail. The KOL and Medical Affairs sign-offs are <strong>digital approval stamps</strong>, not full Part 11 e-signatures, per the Ideation &amp; Publishing compliance posture.
              </p>
              <p
                className="mt-2 font-mono text-[11px] text-slate-500"
                data-immutability-note
              >
                This record is immutable. All events were written at the time of the action.
              </p>
            </section>

            {/* Standards bridge — sE10 */}
            <section
              className="flex flex-col gap-2 rounded-lg border p-5"
              style={{ backgroundColor: '#F0FDFA', borderColor: '#99F6E4' }}
              data-standards-bridge
            >
              <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-600">Standards &amp; metadata</p>
              <p className="text-[13px] text-slate-800">
                <strong>C-002</strong> blog post qualifies as a long-form article and is eligible for
                DOI registration, Dublin Core tagging and a WCAG 2.1 AA output check.
              </p>
              <div>
                <button
                  type="button"
                  onClick={goStandards}
                  data-open-standards-c002
                  className="h-9 rounded-md px-4 text-[13px] font-semibold text-white"
                  style={{ backgroundColor: '#0D9488' }}
                >Open standards &amp; metadata for C-002 →</button>
              </div>
            </section>
          </div>

          {/* SIDEBAR */}
          <aside className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4" data-sidebar-quick-links>
            <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Quick links</p>
            <button type="button" onClick={goCalendar}   data-link-calendar   className="h-9 rounded-md border border-slate-200 bg-white px-3 text-left text-[12px] font-semibold text-slate-700 hover:bg-slate-50">View content calendar →</button>
            <button type="button" onClick={goPublishing} data-link-publishing className="h-9 rounded-md border border-slate-200 bg-white px-3 text-left text-[12px] font-semibold text-slate-700 hover:bg-slate-50">View publishing monitor →</button>
            <button type="button" onClick={goStandards}  data-link-standards  className="h-9 rounded-md border border-slate-200 bg-white px-3 text-left text-[12px] font-semibold text-slate-700 hover:bg-slate-50">Standards &amp; metadata →</button>
            <p className="mt-3 font-mono text-[10px] text-slate-500">
              Completed {formatDate('2026-10-28')} · Ideation Lead sign-off
            </p>
          </aside>
        </div>
      </div>
    </div>
  )
}
