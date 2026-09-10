import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import type { ContentExpiryRecord, MedLibraryCard } from '@platform/types'
import { medContentApi } from '../../modules/medical-writing/api/medContent'

// --- Static provenance chain ---

const CLINICAL_SOURCE = [
  { label: 'VELORA-301 CSR v1.0', when: 'Signed 28 Oct 2026' },
  { label: 'SmPC v2.1',           when: 'Approved 15 Sep 2026' },
]

const MODULE_C_MILESTONES = [
  { label: 'Stage 1 briefing',       when: '12 Oct 2026 · Dr Sarah Chen' },
  { label: 'Stage 2 KOL session',    when: '14 Oct 2026 · 4 KOL attendees' },
  { label: 'Stage 3 draft v0.3',     when: '16 Oct 2026' },
  { label: 'Pre-MLR check passed',   when: '17 Oct 2026' },
  { label: 'MLR Approved',           when: '20 Oct 2026 · Tier 2 Standard' },
]

const FRAMEWORKS_APPLIED = ['21 CFR Part 11', 'IFPMA', 'EFPIA', 'ABPI Code 2023', 'WCAG 2.1 AA']

const FILES_IN_PACKAGE = [
  'Veloricept_HCP_Slide_Deck_v0.3.pdf',
  'Veloricept_HCP_Slide_Deck_v0.3.pptx',
  'Veloricept_HCP_Slide_Deck_v0.3.html',
  'MLR_Review_Record.pdf',
  'Compliance_Provenance_Record.pdf',
]

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

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${String(d.getUTCDate()).padStart(2, '0')} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`
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
  const expiryDate = expiryRecord?.expiryDate ?? '2028-10-20'
  const cardCount = libraryCards.length + 1 // + framework card

  return (
    <div className="bg-slate-50" data-screen="final-output">
      <div className="mx-auto flex flex-col gap-4" style={{ maxWidth: 1180, padding: '20px 32px 40px' }}>

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
          <p className="text-[13px] font-semibold text-slate-800">This content is MLR-approved and locked for distribution.</p>
          <p className="text-[11px]" style={{ color: '#64748B' }}>Stage 6 · 21 CFR Part 11 compliant · Expires {formatDate(expiryDate)}</p>
          <button type="button" onClick={() => flash('Distribution log opened.')} className="mt-1 text-[11px] font-semibold text-violet-700 hover:underline">View distribution log →</button>
        </div>

        {/* Final Output Record */}
        <section className="rounded-lg border border-slate-200 bg-white p-5" data-final-output-record>
          <h2 className="text-[16px] font-bold text-slate-900">Veloricept HCP Slide Deck</h2>
          <p className="text-[11px]" style={{ color: '#64748B' }}>MLR Approved {formatDate('2026-10-20')} · Distribution: Congress, Rep Detail Aid</p>

          {/* MLR sign-off */}
          <div className="mt-3 rounded-md bg-slate-50 p-3" data-mlr-signoff>
            <p className="font-mono text-[11px] uppercase" style={{ color: '#64748B', letterSpacing: '0.08em' }}>MLR sign-off</p>
            <p className="mt-1 text-[13px] font-semibold text-slate-800">Dr Rebecca Morton (MLR Lead)</p>
            <p className="text-[12px] text-slate-700">Meaning: "I approve this content for external distribution"</p>
            <p className="text-[11px]" style={{ color: '#64748B' }}>20 Oct 2026 14:22 UTC · e-signature on file · 21 CFR Part 11 record</p>
          </div>

          {/* Distribution package */}
          <div className="mt-4" data-distribution-package>
            <p className="font-mono text-[11px] uppercase" style={{ color: '#64748B', letterSpacing: '0.08em' }}>Distribution package</p>
            <button
              type="button"
              onClick={() => flash('Download initiated. 5 files packaged.')}
              data-download-all
              className="mt-2 rounded-md px-3 py-1.5 text-[12px] font-semibold text-white"
              style={{ backgroundColor: '#7C3AED' }}
            >Download all (.zip)</button>
            <ul className="mt-2 text-[12px]" data-files-list>
              {FILES_IN_PACKAGE.map(f => <li key={f} className="text-slate-700">{f}</li>)}
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
            <p className="font-mono text-[11px] uppercase" style={{ color: '#1D4ED8', letterSpacing: '0.08em' }}>Clinical Writing · Module A</p>
            <ul className="mt-1 text-[12px]">
              {CLINICAL_SOURCE.map(r => <li key={r.label} className="text-slate-700"><strong>{r.label}</strong> · {r.when}</li>)}
              <li className="mt-1 font-mono text-[10px] text-slate-500">Audit references: AE-006 → AE-012</li>
            </ul>
          </div>

          <div className="mt-3 rounded-md bg-slate-50 p-3">
            <p className="font-mono text-[11px] uppercase" style={{ color: '#7C3AED', letterSpacing: '0.08em' }}>Medical Writing · Module C</p>
            <ol className="mt-2 flex flex-col gap-2" data-provenance-timeline>
              {MODULE_C_MILESTONES.map((m, i) => (
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
              {FRAMEWORKS_APPLIED.map(f => (
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
              <p className="text-[13px] font-semibold text-slate-800" data-expiry-date>{formatDate(expiryDate)}</p>
            </div>
            <div>
              <p className="font-mono text-[11px] uppercase" style={{ color: '#64748B', letterSpacing: '0.08em' }}>60-day alert</p>
              <p className="text-[13px] text-slate-800" data-alert-60>
                {formatDate(shift(expiryDate, 60))} <span className="text-slate-500">· not yet sent</span>
              </p>
            </div>
            <div>
              <p className="font-mono text-[11px] uppercase" style={{ color: '#64748B', letterSpacing: '0.08em' }}>30-day alert</p>
              <p className="text-[13px] text-slate-800" data-alert-30>
                {formatDate(shift(expiryDate, 30))} <span className="text-slate-500">· not yet sent</span>
              </p>
            </div>
            <div>
              <p className="font-mono text-[11px] uppercase" style={{ color: '#64748B', letterSpacing: '0.08em' }}>Alert recipients</p>
              <p className="text-[13px] text-slate-800" data-alert-recipients>Dr Sarah Chen, Dr Rebecca Morton</p>
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

          <p className="mt-3 text-[11px]" style={{ color: '#64748B' }}>Expiry: {formatDate(expiryDate)} applies to all cards from this item.</p>
          <button type="button" onClick={() => flash('Opening Master Library')} className="mt-2 text-[12px] font-semibold text-violet-700 hover:underline">View in Master Library →</button>
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
