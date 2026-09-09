import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import type { GatewaySubmissionRecord, HACorrespondence, RegulatoryLibraryCard, PartElevenSignature } from '@platform/types'
import { GATEWAY_PRIORITY } from '@platform/types'
import { regulatoryWritingApi } from '../../modules/regulatory-writing/api/regulatoryWriting'
import { useGatewayStore } from '../../modules/regulatory-writing/store'
import { GatewayACKTimeline, PartElevenConfirm } from '../../components/ui'

const CURRENT_USER_NAME = 'Dr James Hartley'
const CURRENT_USER_ROLE = 'Regulatory Affairs Lead'

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const day = String(d.getUTCDate()).padStart(2, '0')
  const hh  = String(d.getUTCHours()).padStart(2, '0')
  const mm  = String(d.getUTCMinutes()).padStart(2, '0')
  return `${day} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()} ${hh}:${mm} UTC`
}
function formatDateShort(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${String(d.getUTCDate()).padStart(2, '0')} ${months[d.getUTCMonth()]}`
}

export function GatewaySubmission() {
  const { projectId, submissionId } = useParams()
  const navigate = useNavigate()

  const records                = useGatewayStore(s => s.records)
  const setRecords             = useGatewayStore(s => s.setRecords)
  const confirmingTransmission = useGatewayStore(s => s.confirmingTransmission)
  const setConfirmingTransmission = useGatewayStore(s => s.setConfirmingTransmission)
  const markTransmitted        = useGatewayStore(s => s.markTransmitted)

  const [correspondence, setCorrespondence] = useState<HACorrespondence[]>([])
  const [libraryCards,   setLibraryCards]   = useState<RegulatoryLibraryCard[]>([])
  const [toast, setToast] = useState<string | null>(null)
  const flash = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3200) }

  const { data: fetchedRecords = [] } = useQuery({
    queryKey: ['gateway-submissions', submissionId],
    queryFn:  () => regulatoryWritingApi.getGatewaySubmissions(submissionId!),
    enabled:  !!submissionId,
  })
  const { data: fetchedHAC = [] } = useQuery({
    queryKey: ['ha-correspondence', submissionId],
    queryFn:  () => regulatoryWritingApi.getHACorrespondence(submissionId!),
    enabled:  !!submissionId,
  })
  const { data: fetchedCards = [] } = useQuery({
    queryKey: ['reg-library-cards', submissionId],
    queryFn:  () => regulatoryWritingApi.getLibraryCards(submissionId!),
    enabled:  !!submissionId,
  })

  useEffect(() => { setRecords(fetchedRecords as GatewaySubmissionRecord[]) }, [fetchedRecords, setRecords])
  useEffect(() => { setCorrespondence(fetchedHAC as HACorrespondence[]) },   [fetchedHAC])
  useEffect(() => { setLibraryCards(fetchedCards as RegulatoryLibraryCard[]) }, [fetchedCards])

  const fdaRecord = records.find(r => r.gateway === 'fda-esg')
  const emaRecord = records.find(r => r.gateway === 'ema-cesp')
  const ack2Confirmed = fdaRecord?.status === 'ack2' || fdaRecord?.status === 'ack3'

  const preSubmissionChecks = [
    { label: 'eCTD validation passed (Critical: 0, Major: 0)', passed: true },
    { label: 'PPD/CCI redaction confirmed (55/55)',            passed: true },
    { label: 'All 6 Super Review sign-offs',                    passed: true },
    { label: 'e-signature on file — Reg Affairs Lead',          passed: true },
    { label: 'Gateway credentials configured (Admin)',          passed: true },
  ]
  const readyForTransmission = preSubmissionChecks.every(c => c.passed)

  const emaTransmitMutation = useMutation({
    mutationFn: (signature: PartElevenSignature) => regulatoryWritingApi.transmitToGateway(submissionId!, {
      gateway:    'ema-cesp',
      partEleven: signature,
    }),
    onSuccess: (data) => {
      if (emaRecord) markTransmitted(emaRecord.id, data.transmittedAt ?? new Date().toISOString(), (data.partEleven as PartElevenSignature) ?? {
        meaning: 'I authorise the transmission of this eCTD package to EMA CESP.',
        timestamp: new Date().toISOString(),
        signatoryName: CURRENT_USER_NAME,
        signatoryRole: CURRENT_USER_ROLE,
      })
      flash('EMA CESP transmission recorded. ACK1 expected within 10 minutes.')
    },
  })

  const confirmEMATransmit = () => {
    const sig: PartElevenSignature = {
      meaning: 'I authorise the transmission of this eCTD package to EMA CESP under EU Regulation 726/2004.',
      timestamp: new Date().toISOString(),
      signatoryName: CURRENT_USER_NAME,
      signatoryRole: CURRENT_USER_ROLE,
    }
    setConfirmingTransmission(true)
    emaTransmitMutation.mutate(sig)
  }

  const correspondenceSorted = useMemo(() => {
    return [...correspondence].sort((a, b) => {
      const at = a.receivedAt ?? a.respondedAt ?? ''
      const bt = b.receivedAt ?? b.respondedAt ?? ''
      return bt.localeCompare(at)
    })
  }, [correspondence])

  const openHAResponse = () => navigate(`/projects/${projectId}/regulatory-writing/submissions/${submissionId}/ha-response`)
  const openCompliance = () => navigate(`/projects/${projectId}/regulatory-writing/submissions/${submissionId}/final`)

  return (
    <div className="bg-slate-50" data-screen="gateway-submission">
      <div className="mx-auto flex flex-col gap-4" style={{ maxWidth: 1440, padding: '16px 24px 24px' }}>

        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-xs text-slate-500">
          <button onClick={() => navigate(`/projects/${projectId}/regulatory-writing`)} className="hover:text-slate-900">Regulatory Writing</button>
          <span style={{ color: '#CBD5E1' }}>&gt;</span>
          <span className="font-semibold text-slate-900">Gateway Submission · Stage 6</span>
        </nav>

        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="flex min-w-0 flex-col gap-1.5">
            <h1 className="text-[22px] font-bold text-slate-900" style={{ margin: 0 }}>Gateway Submission · Stage 6</h1>
            <div className="flex items-center gap-2 text-[12px]" style={{ color: '#64748B' }}>
              <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: '#15803D' }} />
              <span>Stage 6 · FDA ACK2 confirmed</span>
            </div>
          </div>
          <div className="flex flex-none gap-2">
            {ack2Confirmed && (
              <span className="inline-flex items-center rounded-md px-2 py-1 text-[11px] font-semibold" style={{ backgroundColor: '#F0FDF4', color: '#166534' }} data-master-library-badge>
                Master Library push ✓
              </span>
            )}
            <button
              type="button"
              onClick={openCompliance}
              data-view-compliance
              className="h-9 rounded-md border border-slate-300 bg-white px-3 text-[13px] font-semibold text-slate-700"
            >View compliance provenance →</button>
          </div>
        </div>

        <div className="grid gap-4" style={{ gridTemplateColumns: 'minmax(0,1.15fr) minmax(0,0.85fr)' }}>
          {/* LEFT */}
          <div className="flex flex-col gap-3">

            {/* Pre-submission checklist */}
            <section className="rounded-lg border border-slate-200 bg-white p-4" data-pre-submission>
              <h3 className="mb-2 text-[13px] font-bold text-slate-900">Pre-submission checklist</h3>
              <ul className="flex flex-col gap-1 text-[13px]">
                {preSubmissionChecks.map((c, i) => (
                  <li key={i} className="flex items-center gap-2" data-check-item={c.label}>
                    <span className="flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold text-white" style={{ backgroundColor: c.passed ? '#15803D' : '#005F8E' }}>{c.passed ? '✓' : '!'}</span>
                    <span className="text-slate-800">{c.label}</span>
                  </li>
                ))}
              </ul>
              {readyForTransmission && (
                <p className="mt-3 rounded-md px-3 py-2 text-[12px] font-semibold" style={{ backgroundColor: '#F0FDF4', color: '#166534', border: '1px solid #BBF7D0' }} data-ready-banner>
                  ✓ Ready for transmission
                </p>
              )}
            </section>

            {/* Package summary */}
            <section className="rounded-lg border border-slate-200 bg-white p-4" data-package-summary>
              <h3 className="mb-2 text-[13px] font-bold text-slate-900">Submission package</h3>
              <p className="text-[13px] text-slate-800">Veloricept NDA v1.0 · 62 sections · eCTD v3.2.2</p>
              <p className="mt-1 text-[12px] text-slate-500">Package size: <strong>{fdaRecord?.packageSize ?? '—'}</strong> · {fdaRecord?.sectionCount ?? '—'} document units</p>
              <p className="mt-1 font-mono text-[11px] text-slate-500">Hash: {fdaRecord?.packageHash?.slice(0, 8) ?? '—'}…</p>
            </section>

            {/* Gateway rows */}
            <section className="rounded-lg border border-slate-200 bg-white p-4" data-gateway-rows>
              <h3 className="mb-3 text-[13px] font-bold text-slate-900">Gateways</h3>

              {/* FDA — already transmitted */}
              <div className="rounded-md border p-3" style={{ borderColor: '#BBF7D0', backgroundColor: '#F0FDF4' }} data-gateway-row="fda-esg">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[11px] font-semibold" style={{ color: '#166534' }}>FDA ESG (Priority 1)</span>
                  <span className="ml-auto text-[11px]" style={{ color: '#166534' }}>✓ Transmitted · {formatDateTime(fdaRecord?.transmittedAt)} · {fdaRecord?.transmittedByName ?? CURRENT_USER_NAME}</span>
                </div>
              </div>

              {/* EMA — pending */}
              <div className="mt-2 rounded-md border p-3" style={{ borderColor: '#E2E8F0', backgroundColor: '#FFFFFF' }} data-gateway-row="ema-cesp">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[11px] font-semibold text-slate-700">EMA CESP (Priority {GATEWAY_PRIORITY['ema-cesp'].priority})</span>
                  <span className="ml-auto text-[11px] text-slate-600">Configured ✓ · Credentials on file</span>
                </div>
                <p className="mt-1 rounded-md px-2 py-1 text-[11px]" style={{ backgroundColor: '#FFFBEB', color: '#B45309', border: '1px solid #FDE68A' }}>
                  This action is irreversible. The submission will be logged to the EMA Central Submission Portal.
                </p>
                <div className="mt-2">
                  {!emaRecord?.transmittedAt && (
                    confirmingTransmission ? (
                      <PartElevenConfirm
                        onConfirm={confirmEMATransmit}
                        meaning="I authorise the transmission of this eCTD package to EMA CESP under EU Regulation 726/2004."
                        signatoryName={CURRENT_USER_NAME}
                        signatoryRole={CURRENT_USER_ROLE}
                        triggerLabel="Transmit to EMA CESP →"
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmingTransmission(true)}
                        data-transmit-ema
                        className="h-9 rounded-md px-3 text-[13px] font-semibold text-white"
                        style={{ backgroundColor: '#B0200D' }}
                      >Transmit to EMA CESP →</button>
                    )
                  )}
                  {emaRecord?.transmittedAt && (
                    <span className="inline-flex rounded-md px-2 py-1 text-[11px] font-semibold" style={{ backgroundColor: '#F0FDF4', color: '#166534' }}>
                      ✓ Transmitted {formatDateTime(emaRecord.transmittedAt)}
                    </span>
                  )}
                </div>
              </div>

              {/* MHRA — disabled */}
              <div className="mt-2 rounded-md border p-3" style={{ borderColor: '#E2E8F0', backgroundColor: '#F8FAFC' }} data-gateway-row="mhra">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[11px] font-semibold text-slate-500">MHRA (Priority {GATEWAY_PRIORITY['mhra'].priority})</span>
                  <span className="ml-auto text-[11px] text-slate-500">UI only — API procurement required before production. OQ-D-008 resolved: include in prototype.</span>
                </div>
                <button
                  type="button"
                  disabled
                  data-transmit-mhra-disabled
                  className="mt-2 h-9 rounded-md px-3 text-[13px] font-semibold"
                  style={{ backgroundColor: '#F1F5F9', color: '#94A3B8', cursor: 'not-allowed', border: '1px solid #E2E8F0' }}
                >MHRA — Coming in production</button>
              </div>
            </section>
          </div>

          {/* RIGHT */}
          <div className="flex flex-col gap-3">
            {/* ACK status */}
            <section className="rounded-lg border border-slate-200 bg-white p-4" data-ack-tracker>
              <h3 className="mb-3 text-[13px] font-bold text-slate-900">ACK Status Tracker</h3>
              {fdaRecord && (
                <div className="mb-3" data-ack-fda>
                  <p className="mb-1 font-mono text-[11px] font-semibold text-slate-700">FDA ESG</p>
                  <GatewayACKTimeline record={fdaRecord} />
                </div>
              )}
              {emaRecord && (
                <div data-ack-ema>
                  <p className="mb-1 font-mono text-[11px] font-semibold text-slate-700">EMA CESP</p>
                  <GatewayACKTimeline record={emaRecord} />
                </div>
              )}
            </section>

            {/* Predictive timeline */}
            <section className="rounded-lg border border-slate-200 bg-white p-4" data-predictive-timeline>
              <h3 className="mb-2 text-[13px] font-bold text-slate-900">Predictive timeline</h3>
              <p className="text-[12px] text-slate-800">
                Next milestone: <strong>ACK3 from FDA</strong> — estimated {fdaRecord?.ack3EstimatedDate ?? '31 Oct 2026'} ± 5 business days
              </p>
              <div className="mt-2 flex items-center gap-1">
                {(['Transmitted', 'ACK1', 'ACK2', 'ACK3'] as const).map((label, i) => {
                  const done = i === 0 ? !!fdaRecord?.transmittedAt
                    : i === 1 ? !!fdaRecord?.ack1At
                    : i === 2 ? !!fdaRecord?.ack2At
                    :           !!fdaRecord?.ack3At
                  return (
                    <div key={label} className="flex flex-1 items-center gap-1">
                      <span className="inline-block h-2 w-2 flex-none rounded-full" style={{ backgroundColor: done ? '#15803D' : '#CBD5E1' }} />
                      <span className="text-[10px] font-mono" style={{ color: done ? '#166534' : '#94A3B8' }}>{label} {done ? '✓' : ''}</span>
                      {i < 3 && <div className="h-px flex-1" style={{ backgroundColor: done ? '#15803D' : '#E2E8F0' }} />}
                    </div>
                  )
                })}
              </div>
            </section>

            {/* HA correspondence log */}
            <section className="rounded-lg border border-slate-200 bg-white p-4" data-ha-log>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-[13px] font-bold text-slate-900">HA Correspondence Log</h3>
                <button type="button" onClick={openHAResponse} data-open-ha-response className="text-[11px] font-semibold" style={{ color: '#B0200D' }}>
                  Upload incoming HA correspondence →
                </button>
              </div>
              <ul className="flex flex-col gap-1 text-[12px]">
                {correspondenceSorted.map(h => (
                  <li key={h.id} className="flex items-center gap-2 rounded-md bg-slate-50 px-2 py-1" data-hac-row={h.id}>
                    <span className="font-mono text-[11px] text-slate-500">{formatDateShort(h.receivedAt ?? h.respondedAt)}</span>
                    <span className="flex-1 text-slate-700 truncate">{h.contentSummary}</span>
                    <span className="font-mono text-[10px]" style={{ color: '#166534' }}>Auto-parsed ✓</span>
                  </li>
                ))}
              </ul>
            </section>

            {/* Master Library push */}
            {ack2Confirmed && (
              <section className="rounded-lg border p-4" style={{ backgroundColor: '#F0FDF4', borderColor: '#BBF7D0' }} data-master-library>
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-bold" style={{ color: '#166534' }}>ACK2 ✓ — Master Library push unlocked</span>
                </div>
                <p className="mt-1 text-[12px]" style={{ color: '#166534' }}>{libraryCards.length} cards pushed ✓</p>
                <ul className="mt-2 flex flex-col gap-1 text-[12px]">
                  {libraryCards.map(c => (
                    <li key={c.id} className="rounded-md bg-white p-2" data-library-card={c.id}>
                      <p className="font-semibold text-slate-800">{c.name}</p>
                      <p className="font-mono text-[10px] text-slate-500">{c.tags}</p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: '#FFF5F5', color: '#B0200D' }}>Regulatory Writing · D</span>
                        <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: '#EFF6FF', color: '#005F8E' }}>Ideation &amp; Publishing · E</span>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        </div>
      </div>

      {toast && (
        <div
          data-toast
          className="pointer-events-none fixed bottom-5 left-1/2 flex -translate-x-1/2 items-center gap-2.5 rounded-lg px-4 py-3 text-[13px]"
          style={{ backgroundColor: '#1E293B', color: '#FFFFFF' }}
        >
          <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: '#B0200D' }} />
          {toast}
        </div>
      )}
    </div>
  )
}
