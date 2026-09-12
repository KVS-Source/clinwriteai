import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { AtomisedContent, IdeationContentCard, IdeationProject } from '@platform/types'
import { useIdeationStore } from '../../modules/ideation-publishing/store'
import ideationProjectsFixture from '../../data/ideationProjects.json'
import ideationCardsFixture    from '../../data/ideationContentCards.json'
import atomisedFixture         from '../../data/atomisedContent.json'

const PROJECTS    = ideationProjectsFixture as unknown as IdeationProject[]
const CARDS       = ideationCardsFixture    as unknown as IdeationContentCard[]
const ADAPTATIONS = atomisedFixture         as unknown as AtomisedContent[]

// Long-form / DOI-eligible channels (AC-E-017)
const DOI_ELIGIBLE_CHANNELS: string[] = ['blog', 'medical-affairs']

const DUBLIN_CORE: { key: string; value: string }[] = [
  { key: 'dc:title',       value: 'VELORA-301 Phase III Primary PFS Data — Blog Summary' },
  { key: 'dc:creator',     value: 'GenBioCa Sciences Medical Affairs' },
  { key: 'dc:subject',     value: 'Oncology · NSCLC · Veloricept · Pembrolizumab' },
  { key: 'dc:description', value: 'Summary of primary PFS efficacy results from the VELORA-301 Phase III trial.' },
  { key: 'dc:date',        value: '2026-10-25' },
  { key: 'dc:type',        value: 'Blog Post' },
  { key: 'dc:format',      value: 'text/html' },
  { key: 'dc:identifier',  value: '— (pending DOI registration)' },
  { key: 'dc:rights',      value: '© 2026 GenBioCa Sciences. For medical affairs use.' },
  { key: 'dc:language',    value: 'en' },
  { key: 'dc:source',      value: 'VELORA-301 KOL Advisory Board Summary v1.0' },
  { key: 'dc:relation',    value: 'VELORA-301 CSR v1.0' },
  { key: 'dc:coverage',    value: 'Global — FDA + EMA submission territories' },
  { key: 'dc:publisher',   value: 'GenBioCa Sciences' },
  { key: 'dc:contributor', value: 'Prof. James Hartley (KOL reviewer)' },
]

const DOI_RECORD = {
  doi:               '10.48291/velora301-pfs-2026',
  crossrefConfirm:   'ref_12345',
  registrationDate:  '25 Oct 2026',
  wordCountForEligibility: 1247,
}

const ORCID_KOL = {
  name:  'Prof. James Hartley',
  title: 'Professor of Oncology',
  orcid: '0000-0000-0000-0000',
  status:'pending',
}

export function StandardsMetadataDOI() {
  const { projectId, ideationProjectId } = useParams()
  const navigate = useNavigate()

  const setCards = useIdeationStore(s => s.setCards)
  const project = useMemo(() => PROJECTS.find(p => p.id === ideationProjectId), [ideationProjectId])
  const cards   = useMemo(() => CARDS.filter(c => c.ideationProjectId === ideationProjectId), [ideationProjectId])
  useEffect(() => { setCards(cards) }, [cards, setCards])

  // For each card, we can atomise into channels; DOI eligibility is per-adaptation
  const adaptationsByCard = useMemo(() => {
    const map: Record<string, AtomisedContent[]> = {}
    ADAPTATIONS.forEach(a => { (map[a.ideationContentCardId] ??= []).push(a) })
    return map
  }, [])

  const [wcagFormat, setWcagFormat] = useState<'pdf' | 'html'>('pdf')

  if (!project) {
    return <div className="p-8 text-center text-sm text-slate-500" data-screen="standards-metadata-doi">Project not found.</div>
  }

  return (
    <div className="bg-slate-50" data-screen="standards-metadata-doi">
      <div className="flex flex-col gap-4" style={{ maxWidth: 1440, padding: '20px 32px 48px' }}>

        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-xs text-slate-500">
          <button onClick={() => navigate(`/projects/${projectId}/ideation-publishing`)} className="hover:text-slate-900">Ideation &amp; Publishing</button>
          <span style={{ color: '#CBD5E1' }}>&gt;</span>
          <button onClick={() => navigate(`/projects/${projectId}/ideation-publishing/projects/${ideationProjectId}`)} className="hover:text-slate-900">{project.title}</button>
          <span style={{ color: '#CBD5E1' }}>&gt;</span>
          <span className="font-semibold text-slate-900">Standards, Metadata &amp; DOI</span>
        </nav>

        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <h1 className="text-[22px] font-bold text-slate-900" style={{ margin: 0 }}>Standards, Metadata &amp; DOI</h1>
            <p className="mt-1 font-mono text-xs text-slate-500">{project.title} · Module E owns CrossRef/ORCID shared service (OQ-E-006)</p>
          </div>
        </div>

        {/* PANEL 1 — DOI Registration */}
        <section className="rounded-lg border border-slate-200 bg-white p-5" data-panel="doi-registration">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Panel 1 · DOI Registration (FR-E-019 · AC-E-017)</p>
          <p className="mt-2 text-[13px] text-slate-700" data-doi-availability-note>
            DOI registration available for blog post and long-form content only.
          </p>

          <div className="mt-4 flex flex-col gap-3">
            {cards.flatMap(c =>
              (adaptationsByCard[c.id] ?? []).map(ad => {
                const eligible = DOI_ELIGIBLE_CHANNELS.includes(ad.channel)
                return (
                  <div
                    key={ad.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-200 p-3 text-[12px]"
                    data-doi-row={ad.id}
                    data-doi-eligible={eligible || undefined}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-mono text-[10px] text-slate-500">{c.id} · {ad.id}</p>
                      <p className="text-[13px] font-semibold text-slate-900">{c.title} · {ad.channelLabel}</p>
                    </div>
                    {eligible ? (
                      <button
                        type="button"
                        data-register-doi={ad.id}
                        className="h-8 rounded-md px-3 text-[12px] font-semibold text-white"
                        style={{ backgroundColor: '#0D9488' }}
                      >Register DOI →</button>
                    ) : (
                      <span
                        className="inline-flex items-center rounded-md px-2 py-1 text-[11px] font-semibold"
                        style={{ backgroundColor: '#F1F5F9', color: '#475569' }}
                        data-doi-not-eligible
                      >Not eligible — DOI registration applies to long-form citable artefacts only.</span>
                    )}
                  </div>
                )
              }),
            )}
          </div>

          {/* Registered DOI display (hard-coded from brief) */}
          <div
            className="mt-4 rounded-md p-3 text-[12px]"
            style={{ backgroundColor: '#F0FDFA', color: '#0F766E', border: '1px solid #99F6E4' }}
            data-doi-registered-state
          >
            <p className="font-mono text-[10px] font-semibold uppercase tracking-widest">Registered</p>
            <p className="mt-1 text-slate-800">
              DOI: <strong data-registered-doi>{DOI_RECORD.doi}</strong> · Crossref confirmation:
              <strong data-crossref-confirm> {DOI_RECORD.crossrefConfirm}</strong> · Registered {DOI_RECORD.registrationDate}
            </p>
            <p className="mt-1 text-slate-700">Word count for eligibility: <strong>{DOI_RECORD.wordCountForEligibility.toLocaleString()} words</strong></p>
            <p className="mt-1 font-mono text-[10px] text-slate-500" data-doi-irreversible-note>
              After registration this field becomes read-only — irreversible (DD-E-006).
            </p>
          </div>

          <p
            className="mt-2 rounded-md p-2 font-mono text-[11px]"
            style={{ backgroundColor: '#F1F5F9', color: '#475569' }}
            data-shared-service-note
          >
            CrossRef/ORCID API: Module E owns this shared service. Module B publications use the same service. (AC-E-020)
          </p>
        </section>

        {/* PANEL 2 — ORCID Verification */}
        <section className="rounded-lg border border-slate-200 bg-white p-5" data-panel="orcid">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Panel 2 · ORCID Verification (FR-E-019)</p>
          <p className="mt-2 text-[13px] text-slate-700">KOL: {ORCID_KOL.name} · {ORCID_KOL.title}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              type="text"
              defaultValue={ORCID_KOL.orcid}
              data-orcid-input
              className="h-9 flex-1 rounded-md border border-slate-300 px-3 font-mono text-[12px]"
            />
            <button
              type="button"
              data-verify-orcid
              className="h-9 rounded-md px-3 text-[13px] font-semibold text-white"
              style={{ backgroundColor: '#0D9488' }}
            >Verify →</button>
          </div>
          <p className="mt-2 text-[12px]" style={{ color: '#475569' }} data-orcid-optional-note>
            ORCID verification is optional for KOL contributors. Module E owns the ORCID API used by both this module and Module B.
          </p>
          <p className="mt-1 font-mono text-[11px]" style={{ color: '#B45309' }} data-orcid-status>
            {ORCID_KOL.orcid} · {ORCID_KOL.status}
          </p>
        </section>

        {/* PANEL 3 — Dublin Core */}
        <section className="rounded-lg border border-slate-200 bg-white p-5" data-panel="dublin-core">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Panel 3 · Dublin Core Metadata (FR-E-019 · AC-E-018) · DCMI Terms 2020</p>
          <p className="mt-2 text-[13px] text-slate-700">For <strong>ac-002 Blog Post</strong> (long-form):</p>
          <p className="mt-1 rounded-md px-3 py-2 text-[12px]" style={{ backgroundColor: '#F0FDFA', color: '#0F766E' }} data-first-implementation-note>
            First implementation of Dublin Core metadata in the platform.
          </p>
          <dl
            className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2"
            data-dublin-core-grid
            data-dublin-core-count={DUBLIN_CORE.length}
          >
            {DUBLIN_CORE.map(f => (
              <div
                key={f.key}
                className="flex flex-col gap-0.5 rounded-md border border-slate-200 p-2"
                data-dc-field={f.key}
              >
                <dt className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">{f.key}</dt>
                <dd className="text-[12px] text-slate-800">{f.value}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-3">
            <button
              type="button"
              data-tag-embed
              className="h-9 rounded-md px-4 text-[13px] font-semibold text-white"
              style={{ backgroundColor: '#0D9488' }}
            >Tag &amp; embed →</button>
          </div>
        </section>

        {/* PANEL 4 — WCAG 2.1 AA */}
        <section className="rounded-lg border border-slate-200 bg-white p-5" data-panel="wcag">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Panel 4 · WCAG 2.1 Level AA — Content Output Check (FR-E-019 · AC-E-019)</p>
          <p className="mt-2 text-[13px] font-semibold text-slate-900" data-wcag-header>
            WCAG 2.1 Level AA — Content Output Check
          </p>
          <p
            className="mt-1 rounded-md px-3 py-2 text-[12px]"
            style={{ backgroundColor: '#F0FDFA', color: '#0F766E' }}
            data-wcag-clarifying-note
          >
            WCAG 2.1 AA applies to published content outputs. The ClinWrite.AI platform UI targets WCAG 2.2 AA — these are separate standards. (AC-E-019)
          </p>
          <p className="mt-2 font-mono text-[11px] text-slate-500">
            Same engine as the Medical Writing accessibility check (Module C).
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-[12px] text-slate-700">
              <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Format</span>
              <select
                value={wcagFormat}
                onChange={(e) => setWcagFormat(e.target.value as 'pdf' | 'html')}
                data-wcag-format
                className="h-8 rounded-md border border-slate-300 px-2 text-[12px]"
              >
                <option value="pdf">PDF</option>
                <option value="html">HTML</option>
              </select>
            </label>
            <button
              type="button"
              data-run-wcag
              className="h-8 rounded-md px-3 text-[12px] font-semibold text-white"
              style={{ backgroundColor: '#0D9488' }}
            >Run WCAG check →</button>
            <span className="font-mono text-[11px] text-slate-500">for Blog Post output</span>
          </div>
        </section>
      </div>
    </div>
  )
}
