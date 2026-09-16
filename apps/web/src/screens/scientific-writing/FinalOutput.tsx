import { useEffect, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import { publicationsApi } from '../../api'

const CANONICAL_PUB = 'pub-001'

// --- Subcomponents ---

function CheckIcon({ colour = '#16A34A', size = 20 }: { colour?: string; size?: number }) {
  return (
    <span
      className="flex flex-none items-center justify-center rounded-full font-extrabold text-white"
      style={{ width: size, height: size, fontSize: size * 0.55, backgroundColor: colour }}
      aria-hidden="true"
    >✓</span>
  )
}

function SectionLabel({ children, color = '#64748B' }: { children: React.ReactNode; color?: string }) {
  return (
    <p
      className="font-mono font-medium uppercase tracking-widest"
      style={{ fontSize: 10, color, letterSpacing: '0.12em' }}
    >
      {children}
    </p>
  )
}

// --- Main screen ---

export function FinalOutput() {
  const { publicationId } = useParams()
  const pubId             = publicationId ?? CANONICAL_PUB

  const [copied, setCopied] = useState(false)
  const [toast,  setToast]  = useState<string | null>(null)

  const { data } = useQuery({
    queryKey: ['final-output', pubId],
    queryFn:  () => publicationsApi.getFinal(pubId),
  })

  const downloadMut = useMutation({
    mutationFn: () => publicationsApi.downloadFinal(pubId),
    onSuccess:  (res) => setToast(`Full publication package downloaded · ${res.fileCount} files · includes the cross-module compliance provenance record.`),
  })

  // Toast auto-clear 3.4s
  useEffect(() => {
    if (!toast) return
    const t = window.setTimeout(() => setToast(null), 3400)
    return () => window.clearTimeout(t)
  }, [toast])

  // Copy reset 2.2s
  useEffect(() => {
    if (!copied) return
    const t = window.setTimeout(() => setCopied(false), 2200)
    return () => window.clearTimeout(t)
  }, [copied])

  if (!data) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="font-mono text-sm text-slate-400">Loading final publication record…</p>
      </div>
    )
  }

  const handleCopyCitation = () => {
    // Strip <em> tags for clipboard
    const plainCitation = data.citation.replace(/<[^>]+>/g, '')
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(plainCitation).catch(() => { /* ignore */ })
    setCopied(true)
    setToast('Citation copied in JCO format.')
  }

  const handleFileDownload = (fileName: string) => {
    setToast(`${fileName} downloaded. The download is recorded in the audit trail.`)
  }

  const formattedPublishedDate = new Date(data.publishedDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  const formattedDoiDate       = new Date(data.doiRegisteredAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })

  return (
    <div className="flex h-full flex-col bg-slate-50" data-screen="final-output">

      {/* Published banner */}
      <div
        className="flex flex-none items-center gap-3"
        style={{
          backgroundColor: '#F0FDF4',
          borderBottom:    '1px solid #BBF7D0',
          height:          44,
          padding:         '0 32px',
        }}
        data-published-banner
      >
        <CheckIcon />
        <p className="min-w-0 flex-1 text-[13px]" style={{ color: '#15803D' }}>
          <span className="font-bold">This manuscript is published and locked.</span>{' '}
          DOI registered · ORCID verified · GPP 2022 compliant
        </p>
        <a
          href={data.articleUrl}
          target="_blank"
          rel="noreferrer"
          data-view-article
          className="text-xs font-semibold"
          style={{ color: '#15803D' }}
        >
          View published article →
        </a>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        <div className="flex flex-col gap-5" style={{ maxWidth: 1280, padding: '20px 32px 48px' }}>

          {/* Header */}
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div className="flex flex-col gap-1.5">
              <h1 className="text-2xl font-bold tracking-tight" style={{ margin: 0 }}>Final publication record</h1>
              <p className="font-mono text-xs font-medium" style={{ color: '#64748B' }}>
                {data.journal} · Published {formattedPublishedDate}
              </p>
            </div>
            <div className="flex flex-none gap-2">
              <button
                type="button"
                onClick={() => downloadMut.mutate()}
                disabled={downloadMut.isPending}
                data-download-package
                className="rounded-md text-[13px] font-semibold text-white"
                style={{ height: 36, padding: '0 14px', backgroundColor: '#0D9488' }}
              >
                Download full package (.zip)
              </button>
            </div>
          </div>

          <div className="flex gap-6">
            {/* Left column */}
            <div className="flex flex-1 min-w-0 flex-col gap-3">

              {/* Card 1 — Citation + DOI + ORCIDs */}
              <div className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-5" data-citation-card>
                <div className="flex flex-col gap-2">
                  <SectionLabel>Citation</SectionLabel>
                  <div
                    className="text-sm leading-relaxed"
                    style={{ backgroundColor: '#F8FAFC', padding: 14, borderRadius: 6, border: '1px solid #E2E8F0' }}
                    dangerouslySetInnerHTML={{ __html: data.citation }}
                    data-citation-body
                  />
                  <button
                    type="button"
                    onClick={handleCopyCitation}
                    data-copy-citation
                    className="self-start text-xs font-semibold"
                    style={{ color: '#0F766E' }}
                  >
                    {copied ? 'Citation copied ✓' : 'Copy citation'}
                  </button>
                </div>

                <div className="h-px" style={{ backgroundColor: '#E2E8F0' }} />

                <div className="flex flex-col gap-2">
                  <SectionLabel>DOI Record</SectionLabel>
                  <a
                    href={`https://doi.org/${data.doi}`}
                    target="_blank"
                    rel="noreferrer"
                    data-doi
                    className="self-start font-mono text-[13px] font-medium"
                    style={{ color: '#0F766E' }}
                  >
                    {data.doi}
                  </a>
                  <div className="flex items-center gap-2">
                    <span
                      className="inline-flex items-center gap-1.5 rounded-full text-[11px] font-semibold"
                      style={{ padding: '3px 9px', backgroundColor: '#F0FDF4', color: '#15803D' }}
                    >
                      CrossRef registered ✓
                    </span>
                    <span className="font-mono text-[11px]" style={{ color: '#94A3B8' }}>
                      Registered {formattedDoiDate}
                    </span>
                  </div>
                </div>

                <div className="h-px" style={{ backgroundColor: '#E2E8F0' }} />

                <div className="flex flex-col gap-1">
                  <SectionLabel>ORCID verification</SectionLabel>
                  <div className="flex flex-col" data-orcid-list>
                    {data.orcids.map(orcid => (
                      <div
                        key={orcid.orcid}
                        className="flex items-center gap-3 py-2.5"
                        style={{ borderBottom: '1px solid #F1F5F9' }}
                        data-orcid-row={orcid.initials}
                      >
                        <span
                          className="flex flex-none items-center justify-center rounded-full font-mono font-bold"
                          style={{ width: 26, height: 26, fontSize: 11, backgroundColor: orcid.avatarBg, color: orcid.avatarFg }}
                        >{orcid.initials}</span>
                        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <p className="text-[13px] font-semibold">{orcid.name}</p>
                          <p className="font-mono text-[11px]" style={{ color: '#475569' }}>{orcid.orcid}</p>
                        </div>
                        <span
                          className="rounded-full text-[11px] font-semibold"
                          style={{ padding: '3px 9px', backgroundColor: '#F0FDF4', color: '#15803D' }}
                          data-orcid-verified
                        >
                          ORCID verified ✓
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Card 2 — Package files */}
              <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-5" data-package-card>
                <p className="text-sm font-bold">Publication package</p>
                <div className="flex flex-col" data-package-files>
                  {data.packageFiles.map((file, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => handleFileDownload(file.name)}
                      data-package-file={idx}
                      data-cross-module={file.crossModule || undefined}
                      className="flex items-center gap-3 rounded-md py-2.5 text-left transition-colors hover:bg-slate-50"
                      style={{ padding: '10px 12px', borderBottom: idx < data.packageFiles.length - 1 ? '1px solid #F1F5F9' : undefined }}
                    >
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#0D9488" strokeWidth="1.4" className="flex-none">
                        <path d="M8 2v9m0 0l-3-3m3 3l3-3" strokeLinecap="round" strokeLinejoin="round" />
                        <rect x="2" y="12" width="12" height="2" rx="0.5" />
                      </svg>
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <p className="text-[13px] font-semibold">{file.name}</p>
                        <p className="text-xs" style={{ color: '#64748B' }}>{file.note}</p>
                        {file.crossModule && (
                          <span
                            className="mt-1 inline-flex self-start items-center gap-1.5 rounded font-mono text-[10px] font-medium"
                            style={{ padding: '2px 6px', backgroundColor: '#F0FDFA', color: '#0F766E', border: '1px solid #99F6E4' }}
                            data-cross-module-chip
                          >
                            Clinical Writing → Scientific Writing
                          </span>
                        )}
                      </div>
                      <span className="flex-none text-xs font-semibold" style={{ color: '#0F766E' }}>Download</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Card 3 — Compliance provenance */}
              <div
                className="flex flex-col gap-4 rounded-lg bg-white"
                style={{ padding: 20, border: '1px solid #E2E8F0', borderLeft: '3px solid #0D9488' }}
                data-provenance-card
              >
                <div className="flex flex-col gap-1.5">
                  <SectionLabel color="#0F766E">Compliance provenance</SectionLabel>
                  <p className="text-xs leading-relaxed" style={{ color: '#475569' }}>
                    The cross-module 21 CFR Part 11 record, from source clinical data through to the published manuscript.
                  </p>
                </div>

                {/* Source record */}
                <div className="flex flex-col gap-2" data-source-record>
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: '#2563EB' }} />
                    <p className="text-[13px] font-bold">Clinical Writing source record</p>
                  </div>
                  <div className="flex flex-col gap-1.5" style={{ paddingLeft: 16, borderLeft: '1px solid #E2E8F0', marginLeft: 4 }}>
                    {data.provenanceChain.sourceRecord.map((row, i) => (
                      <div key={i} className="flex items-center justify-between gap-3 py-1" data-source-row={i}>
                        <p className="text-xs font-semibold">{row.label}</p>
                        <p className="font-mono text-[11px]" style={{ color: '#64748B' }}>{row.meta}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Down arrow */}
                <div className="flex items-center justify-center" data-provenance-arrow>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#0D9488" strokeWidth="1.6">
                    <line x1="12" y1="4" x2="12" y2="20" strokeLinecap="round" />
                    <polyline points="6,14 12,20 18,14" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <p className="text-center font-mono text-[10px] uppercase" style={{ color: '#94A3B8', letterSpacing: '0.14em' }}>
                  Linked under project VELORA-301
                </p>

                {/* Publication record */}
                <div className="flex flex-col gap-2" data-publication-record>
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: '#0D9488' }} />
                    <p className="text-[13px] font-bold">Scientific Writing publication record</p>
                  </div>
                  <div className="flex flex-col gap-1.5" style={{ paddingLeft: 16, borderLeft: '1px solid #E2E8F0', marginLeft: 4 }}>
                    {data.provenanceChain.publicationRecord.map((row, i) => (
                      <div key={i} className="flex items-center gap-3 py-1" data-pub-row={i}>
                        <span
                          className="h-1.5 w-1.5 flex-none rounded-full"
                          style={{ backgroundColor: row.current ? '#16A34A' : '#0D9488' }}
                          data-milestone-dot={row.current ? 'published' : 'in-progress'}
                        />
                        <p className="min-w-0 flex-1 text-xs font-semibold">{row.label}</p>
                        <p className="font-mono text-[11px]" style={{ color: '#64748B' }}>{row.meta}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <div
                  className="font-mono text-[10px] leading-relaxed"
                  style={{ backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 6, padding: 10, color: '#64748B' }}
                  data-compliance-note
                >
                  This audit chain is immutable and GPP 2022-compliant. Each row is signed and time-stamped in the 21 CFR Part 11 register.
                </div>
              </div>
            </div>

            {/* Right column */}
            <aside className="flex w-[320px] flex-none flex-col gap-3">

              {/* Master library */}
              <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4" data-library-card>
                <div className="flex items-center justify-between">
                  <p className="text-sm font-bold">Master library</p>
                  <span
                    className="rounded-full text-[11px] font-semibold"
                    style={{ padding: '3px 9px', backgroundColor: '#F0FDF4', color: '#15803D' }}
                  >
                    {data.libraryCards.length} cards pushed ✓
                  </span>
                </div>
                <div className="flex flex-col gap-1.5" data-library-list>
                  {data.libraryCards.map((card, i) => (
                    <div
                      key={i}
                      className="flex flex-col gap-0.5 rounded-md"
                      style={{ backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0', padding: '8px 10px' }}
                      data-library-item={i}
                    >
                      <p className="text-xs font-semibold">{card.name}</p>
                      <p className="text-[11px]" style={{ color: '#64748B' }}>{card.note}</p>
                    </div>
                  ))}
                </div>
                <button type="button" className="self-start text-xs font-semibold" style={{ color: '#0F766E' }}>
                  View in master library →
                </button>
                <div className="h-px" style={{ backgroundColor: '#E2E8F0' }} />
                <SectionLabel>Available for reuse in</SectionLabel>
                <div className="flex flex-wrap gap-2">
                  <span
                    className="inline-flex items-center gap-1.5 rounded-full text-[11px] font-semibold"
                    style={{ padding: '3px 9px', backgroundColor: '#F5F3FF', color: '#6D28D9' }}
                    data-reuse-chip="medical"
                  >
                    <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: '#7C3AED' }} />
                    Medical Writing
                  </span>
                  <span
                    className="inline-flex items-center gap-1.5 rounded-full text-[11px] font-semibold"
                    style={{ padding: '3px 9px', backgroundColor: '#EFF6FF', color: '#005F8E' }}
                    data-reuse-chip="ideation"
                  >
                    <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: '#005F8E' }} />
                    Ideation & Publishing
                  </span>
                </div>
              </div>

              {/* Status */}
              <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4" data-status-card>
                <p className="text-sm font-bold">Publication status</p>
                <span
                  className="self-start rounded-full text-sm font-bold"
                  style={{ padding: '4px 12px', backgroundColor: '#F0FDF4', color: '#15803D' }}
                  data-published-pill
                >
                  Published ✓
                </span>
                <div className="flex flex-col" data-status-rows>
                  {data.statusRows.map((row, i) => (
                    <div
                      key={i}
                      className="flex items-baseline justify-between gap-2 py-1.5"
                      style={{ borderBottom: '1px solid #F1F5F9' }}
                      data-status-row={i}
                    >
                      <span className="text-xs" style={{ color: '#64748B' }}>{row.label}</span>
                      <span className="text-xs font-semibold" style={{ color: row.fg }}>{row.value}</span>
                    </div>
                  ))}
                </div>
                <p className="font-mono text-[11px] leading-relaxed" style={{ color: '#94A3B8' }}>
                  This record is read-only. Any correction requires a new publication event.
                </p>
              </div>
            </aside>
          </div>
        </div>
      </div>

      {toast && (
        <div
          className="fixed left-1/2 z-50 flex -translate-x-1/2 items-center gap-2.5 rounded-lg text-[13px] text-white"
          style={{
            bottom: 20, maxWidth: 580,
            backgroundColor: '#1E293B',
            padding: '12px 16px',
            boxShadow: '0 12px 28px rgba(15,23,42,0.24)',
          }}
          data-final-toast
        >
          <span className="h-1.5 w-1.5 flex-none rounded-full" style={{ backgroundColor: '#0D9488' }} />
          <span className="leading-relaxed">{toast}</span>
        </div>
      )}
    </div>
  )
}
