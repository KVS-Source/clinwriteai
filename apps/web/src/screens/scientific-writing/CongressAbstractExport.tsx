import { useEffect, useMemo, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import { publicationsApi } from '../../api'
import { useCongressStore } from '../../modules/scientific-writing/store'

// --- Static config ---

type CongressId = 'asco' | 'esmo' | 'ash' | 'aacr' | 'sitc'

interface CongressDef {
  id:        CongressId
  name:      string
  short:     string
  limit:     number
  keywords:  number
  deadline:  string
  portal:    string
  sections:  string
  font:      string
}

const CONGRESSES: CongressDef[] = [
  { id: 'asco', name: 'ASCO Annual Meeting 2027', short: 'ASCO 2027', limit: 3000, keywords: 5, deadline: 'Deadline 01 Dec 2026', portal: 'abstract.asco.org',       sections: 'Background / Methods / Results / Conclusions', font: 'Times New Roman 12pt' },
  { id: 'esmo', name: 'ESMO Congress 2027',       short: 'ESMO 2027', limit: 2500, keywords: 4, deadline: 'Deadline 15 Apr 2027', portal: 'esmo.org/abstracts',        sections: 'Background / Methods / Results / Conclusions', font: 'Times New Roman 11pt' },
  { id: 'ash',  name: 'ASH Annual Meeting 2026',  short: 'ASH 2026',  limit: 3800, keywords: 3, deadline: 'Deadline 04 Aug 2026', portal: 'hematology.org/abstracts',  sections: 'Introduction / Methods / Results / Conclusion', font: 'Arial 10pt' },
  { id: 'aacr', name: 'AACR Annual Meeting 2027', short: 'AACR 2027', limit: 2200, keywords: 5, deadline: 'Deadline 24 Nov 2026', portal: 'aacr.org/abstracts',        sections: 'Background / Methods / Results / Conclusions', font: 'Arial 10pt' },
  { id: 'sitc', name: 'SITC Annual Meeting 2026', short: 'SITC 2026', limit: 2800, keywords: 4, deadline: 'Deadline 12 Jul 2026', portal: 'sitcancer.org/abstracts',   sections: 'Background / Methods / Results / Conclusions', font: 'Times New Roman 11pt' },
]

const ABSTRACT_BODY = {
  background:  'Anti-PD-1 monotherapy is a standard first-line option for advanced non–small-cell lung cancer (NSCLC) with high PD-L1 expression, but median progression-free survival (PFS) remains under nine months in unselected populations and most patients progress within the first year. Veloricept is a first-in-class bispecific antibody targeting PD-1 and TIGIT, two co-inhibitory receptors that are frequently co-expressed on tumour-infiltrating lymphocytes. In the Phase II VELORA-201 study, veloricept plus pembrolizumab produced a confirmed objective response rate of 48% with no new safety signals, providing the rationale for this Phase III evaluation in previously untreated advanced disease.',
  methods:     'VELORA-301 was a randomised, double-blind, placebo-controlled Phase III trial conducted at 87 investigational sites across 14 countries. Eligible adults (≥18 years) had histologically confirmed Stage IIIB/IV NSCLC, measurable disease per RECIST v1.1, an ECOG performance status of 0 or 1, and no prior systemic therapy for advanced disease. Patients were randomised 1:1 to veloricept 15 mg/kg plus pembrolizumab 200 mg or placebo plus pembrolizumab 200 mg intravenously every three weeks for up to 35 cycles. Randomisation used a centralised interactive web response system with stratification by PD-L1 tumour proportion score (<1% vs ≥1%), geographic region and histology. The primary endpoint was investigator-assessed PFS; secondary endpoints included overall survival, objective response rate and safety.',
  results:     'Between March 2022 and September 2023, 812 patients were randomised (combination, n = 406; control, n = 406). Baseline characteristics were balanced across arms. At the pre-specified primary analysis, median PFS was 14.2 months (95% CI 12.4–16.1) with the combination versus 8.7 months (95% CI 7.6–9.9) with pembrolizumab alone (hazard ratio 0.61; 95% CI 0.48–0.77; p < 0.001). The PFS benefit was consistent across pre-specified subgroups, including PD-L1 expression, histology and region. Confirmed objective response rate was 52.7% versus 38.4%. Grade ≥3 treatment-emergent adverse events occurred in 41.2% versus 33.8% of patients; treatment discontinuation for adverse events occurred in 9.1% versus 7.4%. No new safety signals were identified.',
  conclusions: 'Veloricept plus pembrolizumab significantly improved progression-free survival compared with pembrolizumab alone in previously untreated advanced NSCLC, with a manageable safety profile consistent with the Phase II experience. These data support the combination as a first-line treatment option and overall survival follow-up continues.',
}

const TITLE         = 'PFS benefit of veloricept plus pembrolizumab in advanced NSCLC: results of the Phase III VELORA-301 trial'
const AUTHORS       = 'Webb M¹, Hartley J², Chen S¹, Vasquez E¹, Nair P¹'
const AFFILIATIONS  = '¹GenBioCa Sciences, Boston MA · ²Memorial Cancer Institute'
const DISCLOSURE    = 'Funding: GenBioCa Sciences. Conflicts of interest: per conflict-of-interest disclosures on file.'

const PACKAGE_ITEMS = [
  { title: 'Formatted abstract (DOCX)', note: 'Ready to paste into the congress portal' },
  { title: 'Formatted abstract (PDF)',  note: 'For records' },
  { title: 'Author disclosures (PDF)',  note: 'COI forms on file' },
  { title: 'CONSORT checklist (PDF)',   note: 'Completed 25/25 items' },
  { title: 'Source provenance record',  note: 'VELORA-301 CSR v1.0 · Clinical Writing audit reference' },
]

// --- Component ---

export function CongressAbstractExport() {
  const { publicationId } = useParams()
  const pubId             = publicationId ?? 'pub-001'

  const activeCongress   = useCongressStore(s => s.selectedCongress)
  const setActiveCongress = useCongressStore(s => s.setSelectedCongress)

  // Map store's selectedCongress (uppercase like "ASCO") to our lowercase CongressId
  const congressId: CongressId = useMemo(() => {
    const lc = activeCongress.toLowerCase()
    return (['asco', 'esmo', 'ash', 'aacr', 'sitc'].includes(lc) ? lc : 'asco') as CongressId
  }, [activeCongress])

  const congress = useMemo(() => CONGRESSES.find(c => c.id === congressId) ?? CONGRESSES[0], [congressId])

  const [keywords,      setKeywords]      = useState(4)
  const [switcherOpen,  setSwitcherOpen]  = useState(false)
  const [congressQuery, setCongressQuery] = useState('')
  const [copied,        setCopied]        = useState(false)
  const [toast,         setToast]         = useState<string | null>(null)

  // Derived
  const headings = congress.sections.split(' / ')
  const bodies   = [ABSTRACT_BODY.background, ABSTRACT_BODY.methods, ABSTRACT_BODY.results, ABSTRACT_BODY.conclusions]
  const chars    = useMemo(
    () => [TITLE, AUTHORS, AFFILIATIONS, DISCLOSURE].concat(bodies).join(' ').length,
    [bodies],
  )
  const over      = chars > congress.limit
  const pct       = Math.min(100, Math.round((chars / congress.limit) * 100))
  const keywordsOk = keywords >= congress.keywords

  const counter = {
    text:  `${chars.toLocaleString()} / ${congress.limit.toLocaleString()} characters`,
    state: over ? `Over limit by ${chars - congress.limit}` : 'Within limit',
    fg:    over ? '#005F8E' : '#15803D',
    fill:  over ? '#005F8E' : '#0D9488',
    width: `${pct}%`,
  }

  // Toast auto-clear
  useEffect(() => {
    if (!toast) return
    const t = window.setTimeout(() => setToast(null), 3400)
    return () => window.clearTimeout(t)
  }, [toast])

  // Copy reset
  useEffect(() => {
    if (!copied) return
    const t = window.setTimeout(() => setCopied(false), 2200)
    return () => window.clearTimeout(t)
  }, [copied])

  const exportMut = useMutation({
    mutationFn: () => publicationsApi.congressExport(pubId, {
      format:   'pdf',
      congress: congress.id.toUpperCase(),
    }),
    onSuccess: () => setToast(`Export package ready — submit to ${congress.portal}. Audit trail entry recorded.`),
  })

  const handleCopy = () => {
    const text = `${TITLE}\n\n${AUTHORS}\n${AFFILIATIONS}\n\n${headings.map((h, i) => `${h}: ${bodies[i]}`).join('\n\n')}\n\n${DISCLOSURE}`
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).catch(() => { /* ignore */ })
    setCopied(true)
    setToast('Abstract copied to clipboard.')
  }

  const handleSelectCongress = (id: CongressId) => {
    setActiveCongress(id.toUpperCase())
    setSwitcherOpen(false)
    setCongressQuery('')
    const target = CONGRESSES.find(c => c.id === id)!
    setToast(`Target congress switched to ${target.name}. Limit now ${target.limit.toLocaleString()} characters. Keyword count revalidated.`)
  }

  const handleAddKeyword = () => {
    setKeywords(k => Math.min(k + 1, congress.keywords))
    setToast('Keyword added. MeSH validation queued.')
  }

  const filteredCongresses = useMemo(() => {
    const q = congressQuery.trim().toLowerCase()
    if (!q) return CONGRESSES
    return CONGRESSES.filter(c =>
      c.name.toLowerCase().includes(q) ||
      c.short.toLowerCase().includes(q) ||
      c.id.toLowerCase().includes(q))
  }, [congressQuery])

  // --- Validation rows ---
  interface ValidationRow { id: string; label: string; state: 'pass' | 'warn' | 'block'; fix?: string | null }
  const validation: ValidationRow[] = [
    {
      id:     'chars',
      label:  over ? 'Abstract exceeds character limit' : 'Character limit',
      state:  over ? 'block' : 'pass',
    },
    { id: 'authors',    label: 'Author format matches congress style', state: 'pass' },
    { id: 'sections',   label: 'Structured sections applied',           state: 'pass' },
    { id: 'disclosure', label: 'Disclosure statement present',          state: 'pass' },
    {
      id:     'keywords',
      label:  keywordsOk ? `Keywords: ${keywords}/${congress.keywords} MeSH terms` : `Keywords: ${keywords}/${congress.keywords} — add ${congress.keywords - keywords} more`,
      state:  keywordsOk ? 'pass' : 'warn',
      fix:    !keywordsOk ? 'Add keyword' : null,
    },
  ]

  return (
    <div className="bg-slate-50" data-screen="congress-abstract-export">
      <div className="flex flex-col gap-5" style={{ maxWidth: 1280, padding: '20px 32px 48px' }}>

        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="flex flex-col gap-1.5">
            <h1 className="text-2xl font-bold tracking-tight" style={{ margin: 0 }}>Congress abstract export</h1>
            <p className="font-mono text-xs font-medium" style={{ color: '#64748B' }} data-header-subtitle>
              {congress.name} · Structured abstract
            </p>
          </div>
          <div className="flex flex-none gap-2">
            <button
              type="button"
              onClick={handleCopy}
              data-copy
              className="rounded-md bg-white text-[13px] font-semibold transition-colors"
              style={{ height: 36, padding: '0 14px', border: '1px solid #0D9488', color: '#0F766E' }}
            >
              {copied ? 'Copied ✓' : 'Copy to clipboard'}
            </button>
            <button
              type="button"
              onClick={() => exportMut.mutate()}
              disabled={exportMut.isPending}
              data-download
              className="rounded-md text-[13px] font-semibold text-white"
              style={{ height: 36, padding: '0 14px', backgroundColor: '#0D9488' }}
            >
              Download export package
            </button>
          </div>
        </div>

        {/* Two-col body */}
        <div className="flex gap-6">
          {/* Left: formatted preview + validation */}
          <div className="flex flex-1 min-w-0 flex-col gap-3">

            {/* Preview card */}
            <div className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white" style={{ padding: 24 }} data-preview-card>
              <div className="flex items-center justify-between gap-3">
                <p className="font-mono text-[10px] font-medium uppercase tracking-widest" style={{ color: '#94A3B8' }}>
                  {congress.short} · Formatted preview
                </p>
                <span
                  className="rounded-full text-[11px] font-semibold"
                  style={{ padding: '3px 9px', backgroundColor: '#F0FDFA', color: '#0F766E' }}
                  data-font-badge
                >
                  {congress.font}
                </span>
              </div>

              {/* Character counter */}
              <div className="flex flex-col gap-1.5" data-char-counter data-over={over || undefined}>
                <div className="flex items-baseline justify-between gap-2">
                  <p className="font-mono text-xs font-medium" style={{ color: '#475569' }}>{counter.text}</p>
                  <p className="text-xs font-semibold" style={{ color: counter.fg }}>{counter.state}</p>
                </div>
                <div className="h-1.5 overflow-hidden rounded-[3px]" style={{ backgroundColor: '#E2E8F0' }}>
                  <div className="h-full transition-all" style={{ width: counter.width, backgroundColor: counter.fill }} />
                </div>
              </div>

              <div className="h-px" style={{ backgroundColor: '#E2E8F0' }} />

              {/* Abstract body */}
              <div
                className="flex flex-col gap-3"
                style={{ fontFamily: '"Times New Roman", Times, serif' }}
                data-abstract-body
              >
                <p className="text-base font-bold" style={{ lineHeight: 1.35 }}>{TITLE}</p>
                <p className="text-sm" style={{ lineHeight: 1.5 }}>{AUTHORS}</p>
                <p className="text-xs" style={{ lineHeight: 1.5, color: '#64748B' }}>{AFFILIATIONS}</p>
                {headings.map((heading, i) => (
                  <div key={heading} className="flex flex-col gap-1.5">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-bold" style={{ letterSpacing: '0.02em' }}>{heading}.</p>
                      {i === 1 && (
                        <span
                          className="rounded font-mono text-[9px] font-medium uppercase"
                          style={{ padding: '2px 6px', backgroundColor: '#F0FDFA', color: '#0F766E', letterSpacing: '0.08em' }}
                          data-consort-badge
                        >
                          CONSORT ✓
                        </span>
                      )}
                      {i === 2 && (
                        <span
                          className="rounded font-mono text-[9px] font-medium uppercase"
                          style={{ padding: '2px 6px', backgroundColor: '#F0FDFA', color: '#0F766E', letterSpacing: '0.08em' }}
                          data-tlf-badge
                        >
                          Table 14.2.1 · Clinical Writing
                        </span>
                      )}
                    </div>
                    <p className="text-sm" style={{ lineHeight: 1.55 }}>{bodies[i]}</p>
                  </div>
                ))}
                <p className="text-xs italic" style={{ lineHeight: 1.5, color: '#64748B' }}>{DISCLOSURE}</p>
              </div>

              <div className="h-px" style={{ backgroundColor: '#E2E8F0' }} />

              {/* Validation rows */}
              <div className="flex flex-col gap-1.5" data-validation>
                {validation.map(row => {
                  const tone = row.state === 'pass'
                    ? { bg: '#16A34A', mark: '✓', fg: '#15803D' }
                    : row.state === 'warn'
                      ? { bg: '#D97706', mark: '!', fg: '#B45309' }
                      : { bg: '#005F8E', mark: '!', fg: '#005F8E' }
                  return (
                    <div key={row.id} className="flex items-center gap-2.5" data-validation-row={row.id} data-validation-state={row.state}>
                      <span
                        className="flex flex-none items-center justify-center rounded-full font-extrabold text-white"
                        style={{ width: 16, height: 16, fontSize: 9, backgroundColor: tone.bg }}
                      >{tone.mark}</span>
                      <p className="flex-1 text-[13px]" style={{ color: '#1E293B' }}>{row.label}</p>
                      {row.fix && (
                        <button
                          type="button"
                          onClick={handleAddKeyword}
                          data-add-keyword
                          className="text-xs font-semibold"
                          style={{ color: '#0F766E' }}
                        >
                          {row.fix}
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          {/* Right: rules card + export package */}
          <aside className="flex w-[320px] flex-none flex-col gap-3">

            {/* Rules card */}
            <div className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-4" data-rules-card>
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold">{congress.short} submission rules</p>
                <button
                  type="button"
                  onClick={() => setSwitcherOpen(true)}
                  data-change-congress
                  className="text-xs font-semibold"
                  style={{ color: '#0F766E' }}
                >
                  Change congress
                </button>
              </div>
              <RuleRow label="Character limit" ok={!over} value={`${chars} / ${congress.limit}`} />
              <RuleRow label="Author format"   ok value="Applied" />
              <RuleRow label="Sections"        ok value={congress.sections} />
              <RuleRow label="Keywords"        ok={keywordsOk} value={`${keywords} / ${congress.keywords}`} />
              <RuleRow label="Disclosure"      ok value="Applied" />
              <RuleRow label="Font"            ok value={congress.font} />
              <RuleRow label="Deadline"        ok value={congress.deadline.replace('Deadline ', '')} />
            </div>

            {/* Export package */}
            <div className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-4" data-package-card>
              <p className="text-sm font-semibold">Export package</p>
              <div className="flex flex-col gap-2">
                {PACKAGE_ITEMS.map(item => (
                  <div key={item.title} className="flex items-start gap-2.5" data-package-item={item.title}>
                    <span
                      className="mt-0.5 flex flex-none items-center justify-center rounded-full font-extrabold text-white"
                      style={{ width: 14, height: 14, fontSize: 8, backgroundColor: '#16A34A' }}
                    >✓</span>
                    <div className="flex min-w-0 flex-1 flex-col">
                      <p className="text-xs font-semibold">{item.title}</p>
                      <p className="text-[11px] leading-relaxed" style={{ color: '#64748B' }}>{item.note}</p>
                    </div>
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={() => exportMut.mutate()}
                disabled={exportMut.isPending}
                data-download-zip
                className="mt-2 w-full rounded-md text-[13px] font-semibold text-white"
                style={{ height: 36, backgroundColor: '#0D9488' }}
              >
                Download export package (.zip)
              </button>
              <p className="font-mono text-[10px] leading-relaxed" style={{ color: '#94A3B8' }}>
                Manual submission — paste or upload to{' '}
                <span style={{ color: '#0F766E' }}>{congress.portal}</span>. Audit trail records the export event and the source provenance.
              </p>
            </div>
          </aside>
        </div>
      </div>

      {/* Congress switcher modal */}
      {switcherOpen && (
        <div
          className="fixed inset-0 flex items-center justify-center"
          style={{ backgroundColor: 'rgba(15,23,42,0.6)', zIndex: 50, padding: 32 }}
          data-switcher-backdrop
          onClick={() => setSwitcherOpen(false)}
        >
          <div
            className="flex w-full flex-col overflow-hidden bg-white"
            style={{
              maxWidth: 480,
              maxHeight: '100%',
              borderRadius: 12,
              boxShadow: '0 24px 60px rgba(15,23,42,0.3)',
            }}
            data-switcher-modal
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3" style={{ padding: '20px 24px 0' }}>
              <div className="flex flex-col gap-1">
                <p className="font-mono text-[10px] font-medium uppercase tracking-widest" style={{ color: '#64748B' }}>
                  Change congress
                </p>
                <p className="text-base font-bold">Select a target congress</p>
              </div>
              <button
                type="button"
                onClick={() => setSwitcherOpen(false)}
                data-switcher-close
                className="flex h-7 w-7 items-center justify-center rounded text-slate-500 hover:bg-slate-100"
                style={{ fontSize: 16 }}
              >×</button>
            </div>

            <div className="flex flex-col gap-3" style={{ padding: '16px 24px' }}>
              <div className="flex items-center gap-2 rounded-md bg-white" style={{ border: '1px solid #E2E8F0', padding: '8px 10px' }}>
                <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                  <circle cx="6" cy="6" r="4.2" stroke="#94A3B8" strokeWidth="1.4" />
                  <rect x="8.9" y="9.6" width="4.4" height="1.4" rx="0.7" transform="rotate(45 8.9 9.6)" fill="#94A3B8" />
                </svg>
                <input
                  type="text"
                  value={congressQuery}
                  onChange={(e) => setCongressQuery(e.target.value)}
                  placeholder="Search congresses…"
                  data-switcher-search
                  className="min-w-0 flex-1 border-none bg-transparent text-xs outline-none"
                />
              </div>

              <div className="flex max-h-[360px] flex-col gap-2 overflow-y-auto">
                {filteredCongresses.length === 0 ? (
                  <div
                    className="rounded-md bg-white p-4 text-center text-xs"
                    style={{ border: '1px solid #E2E8F0', color: '#94A3B8' }}
                    data-switcher-empty
                  >
                    No congress matches that search. An administrator can add a congress.
                  </div>
                ) : filteredCongresses.map(c => {
                  const isCurrent = c.id === congressId
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => handleSelectCongress(c.id)}
                      data-switcher-option={c.id}
                      className="flex flex-col gap-1 rounded-md text-left transition-colors hover:bg-slate-50"
                      style={{
                        padding:         12,
                        border:          isCurrent ? '1px solid #99F6E4' : '1px solid #E2E8F0',
                        backgroundColor: isCurrent ? '#F0FDFA' : '#FFFFFF',
                      }}
                    >
                      <div className="flex items-center gap-2">
                        <p className="min-w-0 flex-1 text-[13px] font-bold">{c.name}</p>
                        {isCurrent && <span className="text-sm font-bold" style={{ color: '#0D9488' }}>✓</span>}
                      </div>
                      <p className="text-[11px]" style={{ color: '#64748B' }}>
                        {c.deadline} · Limit {c.limit.toLocaleString()} chars · Keywords {c.keywords}
                      </p>
                      <p className="font-mono text-[10px]" style={{ color: '#94A3B8' }}>{c.portal}</p>
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div
          className="fixed left-1/2 z-50 flex -translate-x-1/2 items-center gap-2.5 rounded-lg text-[13px] text-white"
          style={{
            bottom: 20, maxWidth: 580,
            backgroundColor: '#1E293B',
            padding: '12px 16px',
            boxShadow: '0 12px 28px rgba(15,23,42,0.24)',
          }}
          data-congress-toast
        >
          <span className="h-1.5 w-1.5 flex-none rounded-full" style={{ backgroundColor: '#0D9488' }} />
          <span className="leading-relaxed">{toast}</span>
        </div>
      )}
    </div>
  )
}

// --- Sub ---

function RuleRow({ label, ok, value }: { label: string; ok: boolean; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 border-b py-1.5" style={{ borderColor: '#F1F5F9' }}>
      <span className="text-xs" style={{ color: '#64748B' }}>{label}</span>
      <span className="text-xs font-semibold" style={{ color: ok ? '#15803D' : '#B45309' }}>
        {ok ? '✓ Applied' : '⚠ '}{ok ? '' : value}
      </span>
      {ok && (
        <span className="ml-1 text-xs" style={{ color: '#94A3B8' }}>{value}</span>
      )}
    </div>
  )
}
