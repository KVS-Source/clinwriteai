import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import type { GatewaySubmissionRecord, RegulatoryLibraryCard, RegulatorySubmission, ODDAssessment } from '@platform/types'
import { regulatoryWritingApi } from '../../modules/regulatory-writing/api/regulatoryWriting'
import { useRegulatorySubmissionStore, useGatewayStore } from '../../modules/regulatory-writing/store'

type TabId = 'final' | 'portfolio'

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
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const day = String(d.getUTCDate()).padStart(2, '0')
  const hh  = String(d.getUTCHours()).padStart(2, '0')
  const mm  = String(d.getUTCMinutes()).padStart(2, '0')
  return `${day} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()} ${hh}:${mm} UTC`
}

// Static Module D milestone list — factual record derived from sub-001 fixture context
const MODULE_D_MILESTONES = [
  { label: 'Stage 1 briefing — 01 Oct 2026 · Dr S. Chen' },
  { label: 'Stage 2 Module 2 authoring — 01–15 Oct 2026' },
  { label: 'Stage 3 CMC/Nonclinical finalisation — 14 Oct 2026' },
  { label: 'Stage 4 Super Review — 15 Oct 2026 · 2 of 6 roles signed (partial)' },
  { label: 'Stage 5 eCTD validation passed — 15 Oct 2026 · EXTEDO ✓' },
  { label: 'Stage 6 Transmitted — 16 Oct 2026 14:22 UTC · FDA ESG' },
]

const FRAMEWORKS_APPLIED = ['21 CFR Part 11', '21 CFR Part 314', 'ICH M4E(R2)', 'ICH E2C(R2)', 'EMA Regulation 726/2004', 'GDPR (EU) 2016/679', 'eCTD v3.2.2']

export function FinalOutputPortfolio() {
  const { projectId, submissionId } = useParams()
  const navigate = useNavigate()

  const [tab, setTab] = useState<TabId>('final')
  const [taFilter,   setTaFilter]   = useState<string>('all')
  const [typeFilter, setTypeFilter] = useState<string>('all')
  const [toast, setToast] = useState<string | null>(null)
  const flash = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3200) }

  const submissions    = useRegulatorySubmissionStore(s => s.submissions)
  const setSubmissions = useRegulatorySubmissionStore(s => s.setSubmissions)
  const gwRecords      = useGatewayStore(s => s.records)
  const setGwRecords   = useGatewayStore(s => s.setRecords)

  const { data: fetchedSubs = [] } = useQuery({
    queryKey: ['reg-submissions', projectId],
    queryFn:  () => regulatoryWritingApi.listSubmissions(projectId!),
    enabled:  !!projectId,
  })
  const { data: fetchedGw = [] } = useQuery({
    queryKey: ['gateway-submissions', submissionId ?? 'sub-001'],
    queryFn:  () => regulatoryWritingApi.getGatewaySubmissions(submissionId ?? 'sub-001'),
  })
  const { data: fetchedCards = [] } = useQuery({
    queryKey: ['reg-library-cards', submissionId ?? 'sub-001'],
    queryFn:  () => regulatoryWritingApi.getLibraryCards(submissionId ?? 'sub-001'),
  })
  const { data: oddData } = useQuery({
    queryKey: ['odd', 'sub-003'],
    queryFn:  () => regulatoryWritingApi.getODDAssessment('sub-003'),
  })

  useEffect(() => { setSubmissions(fetchedSubs as RegulatorySubmission[]) }, [fetchedSubs, setSubmissions])
  useEffect(() => { setGwRecords(fetchedGw as GatewaySubmissionRecord[]) }, [fetchedGw, setGwRecords])

  const libraryCards: RegulatoryLibraryCard[] = fetchedCards as RegulatoryLibraryCard[]
  const odd: ODDAssessment | undefined = oddData as ODDAssessment | undefined

  const activeId = submissionId ?? 'sub-001'
  const sub      = submissions.find(s => s.id === activeId)
  const fdaRecord = gwRecords.find(r => r.gateway === 'fda-esg')

  const kanbanLanes = useMemo(() => ({
    authoring:   submissions.filter(s => ['source-gathering','module2-authoring','finalisation'].includes(s.status)),
    superReview: submissions.filter(s => s.status === 'super-review'),
    publishing:  submissions.filter(s => s.status === 'publishing'),
    submitted:   submissions.filter(s => s.status === 'submitted' || s.status === 'post-submission'),
  }), [submissions])

  const kanbanFilter = (list: RegulatorySubmission[]) => list.filter(s =>
    (taFilter === 'all' || s.taTag === taFilter) &&
    (typeFilter === 'all' || s.submissionType === typeFilter),
  )

  return (
    <div className="bg-slate-50" data-screen="final-output-portfolio">
      <div className="flex flex-col gap-4" style={{ maxWidth: 1440, padding: '16px 24px 32px' }}>

        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-xs text-slate-500">
          <button onClick={() => navigate(`/projects/${projectId}/regulatory-writing`)} className="hover:text-slate-900">Regulatory Writing</button>
          <span style={{ color: '#CBD5E1' }}>&gt;</span>
          <span className="font-semibold text-slate-900">Final Output &amp; Portfolio</span>
        </nav>

        {/* Tab toggle */}
        <div className="flex border-b border-slate-200" data-tab-bar>
          {(['final', 'portfolio'] as TabId[]).map(id => {
            const label  = id === 'final' ? 'Final Output' : 'Submission Portfolio'
            const active = tab === id
            return (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                data-tab={id}
                data-tab-active={active || undefined}
                className="px-4 py-2 text-[13px]"
                style={{
                  borderBottom: `2px solid ${active ? '#B0200D' : 'transparent'}`,
                  color:        active ? '#B0200D' : '#64748B',
                  fontWeight:   active ? 600 : 500,
                }}
              >{label}</button>
            )
          })}
        </div>

        {tab === 'final' && (
          <>
            {/* ACK banner */}
            <div className="rounded-md px-4 py-3" style={{ backgroundColor: '#F0FDF4', border: '1px solid #BBF7D0' }} data-ack-banner>
              <p className="text-[14px] font-semibold" style={{ color: '#166534' }}>
                ACK2 ✓ — Format validation passed. FDA ESG accepted the submission package.
              </p>
              <p className="text-[12px]" style={{ color: '#166534' }}>
                Estimated review period: 10 months (PDUFA date: <strong>16 Aug 2027</strong>).
              </p>
            </div>

            <div className="grid gap-4" style={{ gridTemplateColumns: 'minmax(0,1.2fr) minmax(0,1fr)' }}>
              {/* LEFT column */}
              <div className="flex flex-col gap-4">
                <section className="rounded-lg border border-slate-200 bg-white p-4" data-submission-record>
                  <h3 className="text-[14px] font-bold text-slate-900">Submission Record</h3>
                  <p className="mt-2 text-[13px] text-slate-800">{sub?.title ?? 'Veloricept NDA v1.0'} · {fdaRecord?.sectionCount ?? 62} sections · eCTD v{sub?.ectdVersion ?? '3.2.2'} · {fdaRecord?.packageSize ?? '847 MB'}</p>
                  <p className="mt-1 font-mono text-[11px] text-slate-500">
                    Reg Affairs Lead e-signature: <strong>{fdaRecord?.partEleven?.signatoryName ?? 'Dr James Hartley'}</strong> · {formatDateTime(fdaRecord?.partEleven?.timestamp)} · 21 CFR Part 11 compliant
                  </p>
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      onClick={() => flash('Download initiated. Submission package + provenance manifest packaged.')}
                      data-download-package
                      className="rounded-md px-3 py-1.5 text-[12px] font-semibold text-white"
                      style={{ backgroundColor: '#B0200D' }}
                    >Download submission package (.zip)</button>
                    <button
                      type="button"
                      onClick={() => navigate(`/projects/${projectId}/regulatory-writing/submissions/${activeId}/ectd-map`)}
                      data-view-ectd-map
                      className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-[12px] font-semibold text-slate-700"
                    >View eCTD package →</button>
                  </div>
                </section>

                <section className="rounded-lg border border-slate-200 bg-white p-4" data-compliance-chain>
                  <h3 className="text-[14px] font-bold text-slate-900">Compliance Provenance</h3>
                  <p className="mt-1 font-mono text-[11px] text-slate-500">Cross-module 21 CFR Part 11 audit chain</p>

                  <div className="mt-3 rounded-md bg-slate-50 p-3" data-module-a-source>
                    <p className="font-mono text-[11px] uppercase" style={{ color: '#1D4ED8', letterSpacing: '0.06em' }}>Module A — Clinical Writing (Source)</p>
                    <ul className="mt-1 text-[12px] text-slate-700">
                      <li>VELORA-301 CSR v1.0 · Signed 28 Oct 2026</li>
                      <li>IB v3.0 · Signed 15 Sept 2026</li>
                      <li className="font-mono text-[11px] text-slate-500">847 canonical JSON data points extracted</li>
                    </ul>
                  </div>

                  <div className="mt-3 rounded-md bg-slate-50 p-3" data-module-d-milestones>
                    <p className="font-mono text-[11px] uppercase" style={{ color: '#B0200D', letterSpacing: '0.06em' }}>Module D — Regulatory Writing (Submission)</p>
                    <ol className="mt-2 flex flex-col gap-1">
                      {MODULE_D_MILESTONES.map((m, i) => (
                        <li key={i} className="flex items-start gap-2 text-[12px] text-slate-800" data-milestone={i + 1}>
                          <span className="mt-1 inline-block h-2 w-2 flex-none rounded-full" style={{ backgroundColor: '#B0200D' }} />
                          <span>{m.label}</span>
                        </li>
                      ))}
                    </ol>
                  </div>

                  <div className="mt-3">
                    <p className="font-mono text-[11px] uppercase text-slate-500" style={{ letterSpacing: '0.06em' }}>Regulatory frameworks applied</p>
                    <div className="mt-1 flex flex-wrap gap-1.5" data-frameworks-applied>
                      {FRAMEWORKS_APPLIED.map(f => (
                        <span key={f} className="rounded-md px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: '#F1F5F9', color: '#475569', border: '1px solid #E2E8F0' }}>{f}</span>
                      ))}
                    </div>
                  </div>
                </section>

                <div className="rounded-md px-3 py-2" style={{ backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0' }} data-regulatory-disclaimer>
                  <p className="text-[12px]" style={{ color: '#475569' }}>
                    ClinWrite.AI regulatory disclaimer is included as page 1 of all exported PDFs and is recorded in the distribution package.
                  </p>
                </div>
              </div>

              {/* RIGHT column */}
              <div className="flex flex-col gap-4">
                <section className="rounded-lg border p-4" style={{ backgroundColor: '#F0FDF4', borderColor: '#BBF7D0' }} data-master-library>
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-bold" style={{ color: '#166534' }}>Master Library push</span>
                    <span className="ml-auto inline-flex rounded-md px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: '#FFFFFF', color: '#166534' }}>
                      {libraryCards.length} cards pushed ✓
                    </span>
                  </div>
                  <ul className="mt-3 flex flex-col gap-2 text-[12px]">
                    {libraryCards.map(c => (
                      <li key={c.id} className="rounded-md bg-white p-2" data-library-card={c.id}>
                        <p className="text-[11px] font-mono uppercase" style={{ color: '#B0200D', letterSpacing: '0.06em' }}>{c.cardType}</p>
                        <p className="mt-1 font-semibold text-slate-800">{c.name}</p>
                        <p className="mt-1 font-mono text-[10px] text-slate-500">{c.tags}</p>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {c.availableInModules.map(m => (
                            <span key={m} className="rounded px-1.5 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: m === 'regulatory-writing' ? '#FFF5F5' : '#EFF6FF', color: m === 'regulatory-writing' ? '#B0200D' : '#005F8E' }} data-module-chip={m}>
                              {m === 'regulatory-writing' ? 'Regulatory Writing · D' : m === 'ideation-publishing' ? 'Ideation & Publishing · E' : m === 'medical-writing' ? 'Medical Writing · C' : m}
                            </span>
                          ))}
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>

                <section className="rounded-lg border border-slate-200 bg-white p-4" data-predictive-timeline>
                  <h3 className="mb-2 text-[13px] font-bold text-slate-900">Predictive timeline</h3>
                  <ul className="flex flex-col gap-1.5 text-[12px]">
                    <li className="flex items-center gap-2 text-slate-800"><span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: '#15803D' }} />✓ Transmitted: 16 Oct 2026</li>
                    <li className="flex items-center gap-2 text-slate-800"><span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: '#15803D' }} />✓ ACK1: 16 Oct 2026 (6 min)</li>
                    <li className="flex items-center gap-2 text-slate-800"><span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: '#15803D' }} />✓ ACK2: 16 Oct 2026 (2h 25m)</li>
                    <li className="flex items-center gap-2 text-slate-500"><span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: '#CBD5E1' }} />○ ACK3: estimated 31 Oct 2026</li>
                  </ul>
                  <p className="mt-4 rounded-md px-3 py-2 text-center" style={{ backgroundColor: '#FFF5F5', border: '2px solid #B0200D' }} data-pdufa>
                    <span className="font-mono text-[10px] uppercase" style={{ color: '#B0200D', letterSpacing: '0.08em' }}>PDUFA date (estimated)</span>
                    <br />
                    <strong className="text-[20px]" style={{ color: '#B0200D' }}>16 Aug 2027</strong>
                  </p>
                </section>
              </div>
            </div>
          </>
        )}

        {tab === 'portfolio' && (
          <div data-portfolio-tab>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-[18px] font-bold text-slate-900">Submission Portfolio</h2>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={taFilter}
                  onChange={(e) => setTaFilter(e.target.value)}
                  data-ta-filter
                  className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[12px] text-slate-800"
                >
                  <option value="all">All TAs</option>
                  <option value="Oncology">Oncology</option>
                  <option value="Cardiometabolic">Cardiometabolic</option>
                </select>
                <select
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value)}
                  data-type-filter
                  className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[12px] text-slate-800"
                >
                  <option value="all">All types</option>
                  <option value="ind">IND</option>
                  <option value="nda-maa">NDA/MAA</option>
                  <option value="psur-pbrer">PSUR/PBRER</option>
                </select>
                <button
                  type="button"
                  onClick={() => flash('Compliance report generated · all submissions in selected scope · MLR/ACK status · library push status · gateway timeline.')}
                  data-export-compliance-report
                  className="rounded-md px-3 py-1.5 text-[12px] font-semibold text-white"
                  style={{ backgroundColor: '#B0200D' }}
                >Export compliance report</button>
              </div>
            </div>

            <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(4, minmax(0,1fr)) 320px' }} data-kanban>
              {[
                { id: 'authoring',    label: 'Authoring',    items: kanbanFilter(kanbanLanes.authoring) },
                { id: 'super-review', label: 'Super Review', items: kanbanFilter(kanbanLanes.superReview) },
                { id: 'publishing',   label: 'Publishing',   items: kanbanFilter(kanbanLanes.publishing) },
                { id: 'submitted',    label: 'Submitted / Approved', items: kanbanFilter(kanbanLanes.submitted) },
              ].map(lane => (
                <div key={lane.id} className="rounded-lg border border-slate-200 bg-white p-3" data-lane={lane.id}>
                  <p className="mb-2 font-mono text-[11px] uppercase text-slate-500" style={{ letterSpacing: '0.08em' }}>{lane.label} · <span className="text-slate-700">{lane.items.length}</span></p>
                  <div className="flex flex-col gap-2">
                    {lane.items.map(s => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => navigate(`/projects/${s.projectId}/regulatory-writing/submissions/${s.id}`)}
                        data-portfolio-card={s.id}
                        className="flex flex-col rounded-md border border-slate-200 p-2 text-left"
                      >
                        <span className="font-mono text-[10px] uppercase" style={{ color: '#B0200D', letterSpacing: '0.08em' }}>{s.submissionType}</span>
                        <span className="text-[12px] font-semibold text-slate-800" style={{ lineHeight: 1.3 }}>{s.title}</span>
                        <span className="font-mono text-[10px] text-slate-500">{s.project ?? s.projectId} · {s.taTag}</span>
                        {s.status === 'super-review' && s.raciTotalCount && (
                          <span className="mt-1 inline-flex w-max rounded-md px-1.5 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: '#FFFBEB', color: '#B45309' }} data-lane-chip="raci">
                            {s.raciSignedCount ?? 0}/{s.raciTotalCount} roles signed
                          </span>
                        )}
                        {s.id === 'sub-001' && (
                          <span className="mt-1 inline-flex w-max rounded-md px-1.5 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: '#F0FDF4', color: '#166534' }} data-lane-chip="fda-ack2">
                            ACK2 ✓ · FDA + EMA (pending)
                          </span>
                        )}
                        {s.id === 'sub-003' && (
                          <span className="mt-1 inline-flex w-max rounded-md px-1.5 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: '#F0FDF4', color: '#166534' }} data-lane-chip="ema-ack3">
                            ACK3 ✓ · EMA CESP · {s.gatewayAck2ConfirmedAt ? formatDate(s.gatewayAck2ConfirmedAt) : '12 Oct'}
                          </span>
                        )}
                      </button>
                    ))}
                    {lane.items.length === 0 && (
                      <p className="text-[11px] italic text-slate-400">No submissions.</p>
                    )}
                  </div>
                </div>
              ))}

              {/* ODD sidebar */}
              <aside className="rounded-lg border border-slate-200 bg-white p-4" data-odd-panel>
                <h3 className="text-[13px] font-bold text-slate-900" data-odd-header>Orphan Drug Designation (ODD) Eligibility Tool</h3>
                {odd ? (
                  <>
                    <p className="mt-1 font-mono text-[11px] text-slate-500">AURELIA-101 · {odd.taTag} · Assessment {formatDate(odd.generatedAt)}</p>
                    <div className="mt-3 flex flex-col gap-2 text-[12px]">
                      <div className="rounded-md p-2" style={{ backgroundColor: odd.eu.meetsThreshold ? '#F0FDF4' : '#FFFBEB', color: odd.eu.meetsThreshold ? '#166534' : '#B45309' }} data-odd-eu>
                        <p><strong>EU:</strong> {odd.eu.prevalence} {odd.eu.meetsThreshold ? '✓' : '⚠'} (threshold: {odd.eu.threshold})</p>
                      </div>
                      <div className="rounded-md p-2" style={{ backgroundColor: odd.us.meetsThreshold ? '#F0FDF4' : '#FFFBEB', color: odd.us.meetsThreshold ? '#166534' : '#B45309' }} data-odd-us>
                        <p><strong>US:</strong> ~{odd.us.prevalencePatients.toLocaleString()} patients {odd.us.meetsThreshold ? '✓' : '⚠'} (threshold: {odd.us.threshold})</p>
                      </div>
                    </div>
                    <p className="mt-3 text-[13px] font-bold" style={{ color: '#B0200D' }} data-odd-score>
                      Eligibility score: {odd.eligibilityScore}% — {odd.eligibilityLabel}
                    </p>
                    <p className="mt-1 text-[12px]" style={{ color: '#B45309' }} data-odd-plausibility>
                      Medical plausibility: Significant benefit draft — pending Clinical Lead sign-off
                    </p>
                    <button type="button" onClick={() => flash('Full ODD assessment')} className="mt-2 text-[12px] font-semibold" style={{ color: '#B0200D' }}>
                      View full ODD assessment →
                    </button>
                  </>
                ) : (
                  <p className="text-[12px] text-slate-500">Loading ODD assessment…</p>
                )}
              </aside>
            </div>
          </div>
        )}
      </div>

      {toast && (
        <div
          data-toast
          className="pointer-events-none fixed bottom-5 left-1/2 flex w-[min(90vw,720px)] -translate-x-1/2 items-center gap-2.5 rounded-lg px-4 py-3 text-[13px]"
          style={{ backgroundColor: '#1E293B', color: '#FFFFFF' }}
        >
          <span className="inline-block h-1.5 w-1.5 flex-none rounded-full" style={{ backgroundColor: '#B0200D' }} />
          <span>{toast}</span>
        </div>
      )}
    </div>
  )
}
