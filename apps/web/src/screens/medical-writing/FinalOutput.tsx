import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import type { ContentExpiryRecord, MedLibraryCard } from '@platform/types'
import { medContentApi } from '../../modules/medical-writing/api/medContent'
import { ApiError } from '../../api/client'
import { projectsApi, documentsApi } from '../../api'
import { useProjectPeople } from '../../hooks/useProjectPeople'
import { fmtDay, fmtDayTime, frameworksFor, stageLabel, tierLabel, ver } from './medLabels'

// Provenance, package files and frameworks are built from the item itself (see the component).

const MODULE_CHIPS = [
  { id: 'D', label: 'Regulatory Writing · D',   bg: '#FFF7ED', fg: '#B45309' },
  { id: 'E', label: 'Ideation & Publishing · E', bg: '#EFF6FF', fg: '#005F8E' },
]

// Messaging framework "card" — synthetic, appended to library-card list per brief
const FRAMEWORK_CARD = {
  id:                 'mlc-framework',
  name:               'Veloricept brand messaging framework',
  tags:               'FRAMEWORK · PUSHED AT STAGE 2',
  taTag:              'Oncology',
  availableInModules: ['regulatory-writing', 'ideation-publishing'],
  origin:             'originally pushed at Stage 2 · confirmed at Final Output ✓',
}

function shift(iso: string, deltaDays: number): string {
  const d = new Date(iso)
  d.setUTCDate(d.getUTCDate() - deltaDays)
  return d.toISOString()
}

export function FinalOutput() {
  const { projectId, contentId } = useParams()
  const navigate = useNavigate()
  const [toast, setToast] = useState<string | null>(null)
  const flash = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3200) }

  const { data: final } = useQuery({
    queryKey: ['med-content-final', contentId],
    queryFn:  () => medContentApi.getFinal(contentId!),
    enabled:  !!contentId,
  })

  const libraryCards: MedLibraryCard[] = final?.libraryCards ?? []
  const expiryRecord: ContentExpiryRecord | undefined = final?.expiryRecord
  const item = final?.contentItem
  const expiryDate: string | null = expiryRecord?.expiryDate ?? item?.expiryDate ?? null
  const cardCount = libraryCards.length + 1 // + framework card

  // The latest MLR decision (meaning + time), the latest Pre-MLR run, and the linked Clinical Writing source.
  const { data: decision } = useQuery({
    queryKey: ['mlr-decision-latest', contentId],
    queryFn:  () => medContentApi.getLatestMLRDecision(contentId!).catch(e => { if (e instanceof ApiError && e.status === 404) return null; throw e }),
    enabled:  !!contentId,
    retry:    false,
  })
  const { data: preMlr } = useQuery({
    queryKey: ['pre-mlr', contentId],
    queryFn:  () => medContentApi.getPreMLR(contentId!).catch(e => { if (e instanceof ApiError && e.status === 404) return null; throw e }),
    enabled:  !!contentId,
    retry:    false,
  })
  const sourceProjectId = item?.sourceModuleAProjectId ?? undefined
  const { data: sourceProject } = useQuery({
    queryKey: ['project', sourceProjectId],
    queryFn:  () => projectsApi.get(sourceProjectId!),
    enabled:  !!sourceProjectId,
    retry:    false,
  })
  const { data: sourceDocs = [] } = useQuery({
    queryKey: ['documents', sourceProjectId],
    queryFn:  () => documentsApi.list(sourceProjectId!),
    enabled:  !!sourceProjectId,
    retry:    false,
  })
  const { usersById } = useProjectPeople(projectId)
  const ownerName = item?.ownerId ? (usersById.get(item.ownerId)?.name ?? null) : null

  const approval = final?.approvals?.[0] ?? null
  const approvedAtIso = decision?.timestampUtc ?? item?.approvedAt ?? approval?.decidedAt ?? null
  const clinicalSources = sourceDocs
    .filter(d => d.type === 'csr-full' || d.type === 'csr-synopsis' || d.type === 'ib')
    .map(d => ({ label: `${d.title} ${ver(d.version)}`, when: String(d.status ?? '') }))
  const milestones = [
    { label: 'Created (Stage 1 · Briefing)', when: fmtDay(item?.createdAt) },
    ...(preMlr ? [{ label: 'Pre-MLR check run', when: `${fmtDay((preMlr as unknown as { runAt?: string }).runAt)} · ${preMlr.passed ? 'passed' : 'not passed'}` }] : []),
    ...(decision ? [{ label: decision.decision === 'approved' ? 'MLR approved' : `MLR decision: ${decision.decision.replace('_', ' ')}`, when: `${fmtDay(decision.timestampUtc)} · ${decision.decidedByName} · ${tierLabel(item?.reviewTier)}` }] : []),
  ]
  const fileBase = (item?.title ?? 'content').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'content'
  const filesInPackage = item ? [
    `${fileBase}_v${item.version.replace(/^v/i, '')}.pdf`,
    `${fileBase}_v${item.version.replace(/^v/i, '')}.html`,
    ...(item.type === 'hcp-slide-deck' ? [`${fileBase}_v${item.version.replace(/^v/i, '')}.pptx`] : []),
    'MLR_Review_Record.pdf',
    'Compliance_Provenance_Record.pdf',
  ] : []
  const frameworksApplied = frameworksFor(item?.complianceTrack)

  return (
    <div className="bg-slate-50" data-screen="final-output">
      <div className="flex flex-col gap-4" style={{ maxWidth: 1180, padding: '20px 32px 40px' }}>

        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-xs text-slate-500">
          <button onClick={() => navigate(`/projects/${projectId}/medical-writing`)} className="hover:text-slate-900">Medical Writing</button>
          <span style={{ color: '#CBD5E1' }}>&gt;</span>
          <span className="font-semibold text-slate-900">Final Output</span>
        </nav>

        {/* Status banner */}
        <div
          className="rounded-md px-4 py-3"
          style={{ backgroundColor: '#F1F5F9', border: '1px solid #E2E8F0' }}
          data-status-banner
        >
          <p className="text-[13px] font-semibold text-slate-800" data-final-status>{item?.stage === 6 ? 'This content is MLR-approved and locked for distribution.' : 'This content is not MLR-approved yet.'}</p>
          <p className="text-[11px]" style={{ color: '#64748B' }}>{stageLabel(item?.stage)} · 21 CFR Part 11 record · Expires {fmtDay(expiryDate)}</p>
          <button type="button" onClick={() => flash('Distribution log opened.')} className="mt-1 text-[11px] font-semibold text-violet-700 hover:underline">View distribution log →</button>
        </div>

        {/* Final Output Record */}
        <section className="rounded-lg border border-slate-200 bg-white p-5" data-final-output-record>
          <h2 className="text-[16px] font-bold text-slate-900" data-final-title>{item?.title ?? '…'}</h2>
          <p className="text-[11px]" style={{ color: '#64748B' }} data-final-subtitle>
            {approvedAtIso ? `MLR Approved ${fmtDay(approvedAtIso)}` : 'Not MLR-approved yet'} · Distribution: {item && item.channels.length > 0 ? item.channels.join(', ') : 'no channels set'}
          </p>

          {/* MLR sign-off */}
          <div className="mt-3 rounded-md bg-slate-50 p-3" data-mlr-signoff>
            <p className="font-mono text-[11px] uppercase" style={{ color: '#64748B', letterSpacing: '0.08em' }}>MLR sign-off</p>
            {decision || approval ? (
              <>
                <p className="mt-1 text-[13px] font-semibold text-slate-800" data-signoff-name>{decision?.decidedByName ?? approval?.name} (MLR Lead)</p>
                {decision?.meaning && <p className="text-[12px] text-slate-700" data-signoff-meaning>Meaning: "{decision.meaning}"</p>}
                <p className="text-[11px]" style={{ color: '#64748B' }} data-signoff-time>{fmtDayTime(decision?.timestampUtc ?? approval?.decidedAt)} · e-signature recorded · 21 CFR Part 11 record</p>
              </>
            ) : (
              <p className="mt-1 text-[12px] text-slate-500" data-signoff-none>No MLR sign-off recorded yet.</p>
            )}
          </div>

          {/* Distribution package */}
          <div className="mt-4" data-distribution-package>
            <p className="font-mono text-[11px] uppercase" style={{ color: '#64748B', letterSpacing: '0.08em' }}>Distribution package</p>
            <button
              type="button"
              onClick={() => flash(`Download initiated. ${filesInPackage.length} files packaged.`)}
              data-download-all
              className="mt-2 rounded-md px-3 py-1.5 text-[12px] font-semibold text-white"
              style={{ backgroundColor: '#7C3AED' }}
            >Download all (.zip)</button>
            <ul className="mt-2 text-[12px]" data-files-list>
              {filesInPackage.map(f => <li key={f} className="text-slate-700">{f}</li>)}
            </ul>
          </div>

          {/* Regulatory disclaimer (neutral record entry) */}
          <div
            className="mt-3 rounded-md px-3 py-2"
            style={{ backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0' }}
            data-regulatory-disclaimer
          >
            <p className="text-[12px]" style={{ color: '#475569' }}>
              ClinWrite.AI regulatory disclaimer is included as page 1 of all exported PDFs and is recorded in the distribution package.
            </p>
          </div>
        </section>

        {/* Compliance Provenance */}
        <section className="rounded-lg border border-slate-200 bg-white p-5" data-compliance-provenance>
          <h2 className="text-[14px] font-bold text-slate-900">Compliance Provenance</h2>
          <p className="text-[11px]" style={{ color: '#64748B' }}>Cross-module 21 CFR Part 11 audit chain</p>

          <div className="mt-3 rounded-md bg-slate-50 p-3">
            <p className="font-mono text-[11px] uppercase" style={{ color: '#1D4ED8', letterSpacing: '0.08em' }}>Clinical Writing · source project {sourceProject ? (sourceProject.shortTitle || sourceProject.name) : '—'}</p>
            <ul className="mt-1 text-[12px]" data-clinical-sources>
              {clinicalSources.length === 0
                ? <li className="text-slate-500">No CSR or IB in the linked Clinical Writing project.</li>
                : clinicalSources.map(r => <li key={r.label} className="text-slate-700"><strong>{r.label}</strong>{r.when ? ` · ${r.when}` : ''}</li>)}
            </ul>
          </div>

          <div className="mt-3 rounded-md bg-slate-50 p-3">
            <p className="font-mono text-[11px] uppercase" style={{ color: '#7C3AED', letterSpacing: '0.08em' }}>Medical Writing · this item</p>
            <ol className="mt-2 flex flex-col gap-2" data-provenance-timeline>
              {milestones.map((m, i) => (
                <li key={m.label} className="flex items-start gap-2" data-milestone={i + 1}>
                  <span className="mt-1 inline-block h-2 w-2 flex-none rounded-full" style={{ backgroundColor: '#7C3AED' }} />
                  <div>
                    <p className="text-[13px] font-semibold text-slate-800">{i + 1}. {m.label}</p>
                    <p className="font-mono text-[11px] text-slate-500">{m.when}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>

          <div className="mt-3">
            <p className="font-mono text-[11px] uppercase" style={{ color: '#64748B', letterSpacing: '0.08em' }}>Compliance frameworks applied</p>
            <div className="mt-1 flex flex-wrap gap-1.5" data-frameworks-applied>
              {frameworksApplied.map(f => (
                <span key={f} className="rounded-md px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: '#F1F5F9', color: '#475569', border: '1px solid #E2E8F0' }}>{f}</span>
              ))}
            </div>
          </div>
        </section>

        {/* Content Expiry */}
        <section className="rounded-lg border border-slate-200 bg-white p-5" data-content-expiry>
          <h2 className="text-[14px] font-bold text-slate-900">Content Expiry</h2>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <div>
              <p className="font-mono text-[11px] uppercase" style={{ color: '#64748B', letterSpacing: '0.08em' }}>Expiry date</p>
              <p className="text-[13px] font-semibold text-slate-800" data-expiry-date>{fmtDay(expiryDate)}</p>
            </div>
            <div>
              <p className="font-mono text-[11px] uppercase" style={{ color: '#64748B', letterSpacing: '0.08em' }}>60-day alert</p>
              <p className="text-[13px] text-slate-800" data-alert-60>
                {expiryDate ? fmtDay(shift(expiryDate, 60)) : '—'} <span className="text-slate-500">· not yet sent</span>
              </p>
            </div>
            <div>
              <p className="font-mono text-[11px] uppercase" style={{ color: '#64748B', letterSpacing: '0.08em' }}>30-day alert</p>
              <p className="text-[13px] text-slate-800" data-alert-30>
                {expiryDate ? fmtDay(shift(expiryDate, 30)) : '—'} <span className="text-slate-500">· not yet sent</span>
              </p>
            </div>
            <div>
              <p className="font-mono text-[11px] uppercase" style={{ color: '#64748B', letterSpacing: '0.08em' }}>Alert recipients</p>
              <p className="text-[13px] text-slate-800" data-alert-recipients>{ownerName ? `${ownerName} (content owner)` : 'Content owner'}</p>
            </div>
          </div>
          <button type="button" className="mt-3 text-[12px] font-semibold text-violet-700 hover:underline">Configure alerts →</button>
        </section>

        {/* Master Library */}
        <section className="rounded-lg border border-slate-200 bg-white p-5" data-master-library>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[14px] font-bold text-slate-900">Master Library</h2>
            <span
              className="inline-flex items-center rounded-md px-2 py-1 text-[11px] font-semibold"
              style={{ backgroundColor: '#F0FDF4', color: '#166534' }}
              data-cards-pushed
            >{cardCount} cards pushed ✓</span>
          </div>

          <div className="flex flex-col gap-2">
            {libraryCards.map(c => (
              <div key={c.id} className="rounded-md border border-slate-200 p-3" data-library-card={c.id}>
                <p className="text-[13px] font-semibold text-slate-800">{c.name}</p>
                <p className="font-mono text-[10px]" style={{ color: '#64748B', letterSpacing: '0.06em' }}>{c.tags}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {MODULE_CHIPS.map(m => (
                    <span
                      key={m.id}
                      className="rounded-md px-2 py-0.5 text-[10px] font-semibold"
                      style={{ backgroundColor: m.bg, color: m.fg }}
                      data-module-chip={m.id}
                    >{m.label}</span>
                  ))}
                </div>
              </div>
            ))}
            {/* Messaging framework card — synthetic */}
            <div
              className="rounded-md border p-3"
              style={{ backgroundColor: '#F5F3FF', borderColor: '#DDD6FE' }}
              data-library-card="mlc-framework"
              data-framework-card
            >
              <p className="text-[13px] font-semibold text-slate-800">{FRAMEWORK_CARD.name}</p>
              <p className="text-[11px]" style={{ color: '#5B21B6' }}>{FRAMEWORK_CARD.origin}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {MODULE_CHIPS.map(m => (
                  <span
                    key={m.id}
                    className="rounded-md px-2 py-0.5 text-[10px] font-semibold"
                    style={{ backgroundColor: m.bg, color: m.fg }}
                    data-module-chip={m.id}
                  >{m.label}</span>
                ))}
              </div>
            </div>
          </div>

          <p className="mt-3 text-[11px]" style={{ color: '#64748B' }}>Expiry: {fmtDay(expiryDate)} applies to all cards from this item.</p>
          <button type="button" onClick={() => navigate('/library')} className="mt-2 text-[12px] font-semibold text-violet-700 hover:underline">View in Master Library →</button>
        </section>
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
  )
}
