import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { STATUS_META, type Section, type SignatureRecord } from '@platform/types'
import { documentsApi, projectsApi } from '../../api'
import { useDocumentStore, useProjectStore } from '../../store'
import { SectionNavigator } from '../clinical-writing/SectionNavigator'
import { EditorContent, useRichTextEditor } from '../clinical-writing/RichTextEditor'
import { SlidePanel } from '../../components/ui/SlidePanel'
import { AuditTrailPanel } from '../../panels/AuditTrailPanel'

// Avatar palette — matches design-system Pattern 7
const AVATAR_COLOURS: Record<string, { bg: string; fg: string }> = {
  MW: { bg: '#DBEAFE', fg: '#1D4ED8' },
  SC: { bg: '#F0FDF4', fg: '#15803D' },
  JO: { bg: '#F5F3FF', fg: '#7C3AED' },
  EV: { bg: '#FEF3C7', fg: '#D97706' },
}

// What each signature means, as shown in the chain banner.
const MEANING_VERB: Record<string, string> = { authored: 'Authored', reviewed: 'Reviewed', approved: 'Approved' }

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

// '28 Oct 2026 15:47 UTC' — signed records are shown in UTC, like the e-signature screen.
// Returns null for a missing or unreadable time rather than printing a made-up one.
function formatUtc(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`
}

// The same moment in the viewer's own time zone, for the hover text.
const formatLocal = (iso: string | null | undefined): string | undefined =>
  iso && !Number.isNaN(new Date(iso).getTime()) ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : undefined

// '3a9f…c4d2' — a SHA-256 shortened for the banner (the full value is in the hover text).
const shortHash = (h: string) => (h.length > 12 ? `${h.slice(0, 4)}…${h.slice(-4)}` : h)

function ShieldIcon({ size = 14, colour = '#15803D', stroke = 1.6 }: { size?: number; colour?: string; stroke?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className="flex-none">
      <path d="M12 2.6l7 2.6v6.2c0 4.4-2.9 8.2-7 10.0-4.1-1.8-7-5.6-7-10.0V5.2z" stroke={colour} strokeWidth={stroke} />
      <polyline points="8.4,12 11,14.6 15.8,9.6" fill="none" stroke={colour} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// Read-only render of one section's saved HTML. Goes through TipTap's schema
// (same as the editor) rather than innerHTML, so stored markup can't inject
// script into the signed, locked view.
function FinalSectionBody({ html }: { html: string }) {
  const editor = useRichTextEditor({ content: html, editable: false })
  return (
    <div className="mt-2 [&_.tiptap-editor]:min-h-0">
      <EditorContent editor={editor} />
    </div>
  )
}

// The API returns sections ordered as text (§1, §10, §11, §2 ...). Present them in document
// order: front matter without a number (ES, TOC) first, as in the Editor, then the numbered
// sections compared numerically, part by part.
const sectionOrder = new Intl.Collator(undefined, { numeric: true })
const sectionKey = (s: Section) => s.number.replace(/^§/, '')
const isFrontMatter = (s: Section) => !/^\d/.test(sectionKey(s))
const bySectionNumber = (a: Section, b: Section) =>
  Number(isFrontMatter(b)) - Number(isFrontMatter(a)) || sectionOrder.compare(sectionKey(a), sectionKey(b))

const isBlankHtml = (html: string | undefined) => !html || html.replace(/<[^>]*>/g, '').trim() === ''

// A value for CSS `content:` (quoted, escaped) — used for the printed page header / footer.
const cssText = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]+/g, ' ')}"`

// Outcome of a checklist rule, as printed in the Compliance Summary.
const RULE_OUTCOME: Record<string, { label: string; colour: string }> = {
  complete:      { label: 'Met',           colour: '#15803D' },
  waived:        { label: 'Waived',        colour: '#B45309' },
  pending:       { label: 'Not completed', colour: '#B91C1C' },
  'in-progress': { label: 'Not completed', colour: '#B91C1C' },
  in_progress:   { label: 'Not completed', colour: '#B91C1C' },
}

export function FinalDocument() {
  const { projectId, documentId } = useParams()
  const [auditOpen, setAuditOpen] = useState(false)
  const [toast, setToast]         = useState<string | null>(null)
  const setActiveProject          = useProjectStore(s => s.setActiveProject)
  const setActiveDocument         = useDocumentStore(s => s.setActiveDocument)
  const setActiveSection          = useDocumentStore(s => s.setActiveSection)

  const { data: document } = useQuery({
    queryKey: ['document', documentId],
    queryFn:  () => documentsApi.get(documentId!),
    enabled:  !!documentId,
  })

  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn:  () => projectsApi.get(projectId!),
    enabled:  !!projectId,
  })

  const { data: chain = [] } = useQuery({
    queryKey: ['signature-chain', documentId],
    queryFn:  () => documentsApi.getSignatureChain(documentId!),
    enabled:  !!documentId,
  })

  const { data: compliance, isError: complianceFailed } = useQuery({
    queryKey: ['compliance-summary', documentId],
    queryFn:  () => documentsApi.getComplianceSummary(documentId!),
    enabled:  !!documentId,
  })

  const activeSection = useDocumentStore(s => s.activeSection)
  const scrollRef     = useRef<HTMLDivElement | null>(null)
  const landed        = useRef(false)
  // Set when the reading position (not a click) changed the active section, so the
  // scroll-into-view effect below doesn't fight the reader's own scrolling.
  const spied         = useRef<string | null>(null)
  // After a click in the section list, ignore scroll-driven updates while the smooth scroll runs.
  const spyPausedUntil = useRef(0)

  // Start at the top once per document; a reload of the same document keeps the section the
  // reader scrolled to.
  const startedDocumentRef = useRef<string | null>(null)
  useEffect(() => {
    if (!document) return
    setActiveDocument(document)
    if (startedDocumentRef.current === document.id) return
    startedDocumentRef.current = document.id
    setActiveSection([...document.sections].sort(bySectionNumber)[0]?.id ?? null)
    landed.current = false
  }, [document, setActiveDocument, setActiveSection])

  // Section navigator click → scroll that section into view (skip the initial
  // landing so the page opens at the top, not mid-document).
  useEffect(() => {
    if (!activeSection) return
    if (!landed.current) { landed.current = true; return }
    if (spied.current === activeSection) { spied.current = null; return }
    spyPausedUntil.current = Date.now() + 900
    scrollRef.current
      ?.querySelector<HTMLElement>(`[data-final-section="${activeSection}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [activeSection])

  // Reading position → active section: the last section whose top has scrolled past the top
  // of the pane. Keeps the left list highlight and the bottom bar in step with the reader.
  useEffect(() => {
    const pane = scrollRef.current
    if (!pane || !document) return
    const onScroll = () => {
      if (Date.now() < spyPausedUntil.current) return
      const top = pane.getBoundingClientRect().top + 24
      let current: string | null = null
      for (const el of pane.querySelectorAll<HTMLElement>('[data-final-section]')) {
        if (el.getBoundingClientRect().top <= top) current = el.dataset.finalSection ?? null
        else break
      }
      if (current && current !== useDocumentStore.getState().activeSection) {
        spied.current = current
        setActiveSection(current)
      }
    }
    pane.addEventListener('scroll', onScroll, { passive: true })
    return () => pane.removeEventListener('scroll', onScroll)
  }, [document, setActiveSection])

  // "Link copied" notice that clears itself.
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2500)
    return () => clearTimeout(t)
  }, [toast])

  // Print stylesheet hook: lets index.css un-clip the app shell while this
  // screen is mounted so "Download PDF" prints every page, not one viewport.
  useEffect(() => {
    window.document.body.classList.add('printing-final-document')
    return () => window.document.body.classList.remove('printing-final-document')
  }, [])

  useEffect(() => {
    if (project) setActiveProject(project)
  }, [project, setActiveProject])

  // Only a document whose status is "signed" gets the signed-and-locked treatment.
  const isSigned = document?.status === 'signed'
  // Interim (unsigned) versions carry a watermark until final sign-off (FR-A-011).
  const showWatermark = !isSigned && document?.watermarked !== false

  // Signed: every section reads as complete (100% progress bar, all-green dots).
  // Not signed: the sections keep their real status.
  const navSections: Section[] = useMemo(() => {
    if (!document) return []
    const sorted = [...document.sections].sort(bySectionNumber)
    return isSigned
      ? sorted.map(s => ({ ...s, status: 'complete' as const, isLocked: false, lockedByUserId: undefined }))
      : sorted
  }, [document, isSigned])

  // The signatures actually recorded on this document, in signing order — real signers,
  // meanings and times; nothing is shown for a signature that hasn't happened.
  const signedRecords = useMemo(
    () => chain.filter((r: SignatureRecord) => r.status === 'signed').sort((a: SignatureRecord, b: SignatureRecord) => a.step - b.step),
    [chain],
  )
  // When it was signed: the document's own signed time, else the last signature on the chain.
  const signedAtIso: string | null = useMemo(() => {
    if (document?.signedAt) return document.signedAt
    const times = signedRecords.map(r => r.timestamp).filter((t): t is string => !!t).sort()
    return times.length ? times[times.length - 1]! : null
  }, [document, signedRecords])
  // The version and document hash that were bound to the signatures.
  const signedVersion = signedRecords.find(r => r.version_at_signing)?.version_at_signing ?? document?.version ?? ''
  const sealHash = [...signedRecords].reverse().find(r => r.documentHash)?.documentHash
  const signedAtText = formatUtc(signedAtIso)
  const activeSectionData = document?.sections.find(s => s.id === activeSection)
  // "Signed" status with no signature on record: the status was set without a completed
  // e-signature chain (AC-A-045 / 046). It is not presented or exported as a signed record.
  const signatureGap = isSigned && signedRecords.length === 0
  const orderedSections = useMemo(() => (document ? [...document.sections].sort(bySectionNumber) : []), [document])

  // Printed page header / footer (Download PDF): title, version and status on every page,
  // "Page X of Y" at the bottom. The title page carries none of it.
  useEffect(() => {
    if (!document) return
    const status = isSigned && !signatureGap ? 'Final · Signed' : 'Not signed'
    const header = `${document.title} · ${isSigned ? signedVersion : document.version} · ${status}`
    const style = window.document.createElement('style')
    style.setAttribute('data-final-print-page', '')
    style.textContent = `@media print {
  @page {
    size: A4;
    margin: 20mm 16mm 18mm;
    @top-left     { content: ${cssText(header)}; font: 8pt sans-serif; color: #64748b; }
    @top-right    { content: ${cssText(project?.shortTitle ?? '')}; font: 8pt sans-serif; color: #64748b; }
    @bottom-left  { content: ${cssText(`Printed ${formatUtc(new Date().toISOString()) ?? ''}`)}; font: 8pt sans-serif; color: #94a3b8; }
    @bottom-right { content: "Page " counter(page) " of " counter(pages); font: 8pt sans-serif; color: #64748b; }
  }
  @page :first {
    @top-left { content: none; } @top-right { content: none; }
  }
}`
    window.document.head.appendChild(style)
    return () => style.remove()
  }, [document, project, isSigned, signatureGap, signedVersion])

  if (!document) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="font-mono text-sm text-slate-400">Loading document…</p>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col" data-screen="final-document" data-print-root>

      {/* ============ Document header ============ */}
      <div
        className="flex flex-none flex-col gap-2 border-b border-slate-200 bg-white px-8 pt-3"
        style={{ position: 'relative', zIndex: 6 }}
        data-screen-only
      >
        {/* Breadcrumb moved to TopNav (same cleanup as DocumentEditor). */}

        {/* Title row */}
        <div className="flex h-14 items-center justify-between gap-6">
          <div className="flex min-w-0 items-center gap-3">
            <h1 className="truncate text-base font-bold tracking-tight text-slate-900">{document.title}</h1>
            <span className="flex-none font-mono text-[11px] font-medium text-slate-500">
              {isSigned ? `${document.version} · Final` : document.version}
            </span>
            {isSigned ? (
              <span
                className="flex-none rounded-full px-2.5 py-1 text-xs font-semibold"
                style={{ backgroundColor: '#F0FDF4', color: '#15803D', border: '1px solid #BBF7D0' }}
                data-doc-status="signed"
              >
                Signed ✓
              </span>
            ) : (
              <span
                className="flex-none rounded-full px-2.5 py-1 text-xs font-semibold"
                style={{
                  backgroundColor: (STATUS_META[document.status] ?? STATUS_META['not-started']).bg,
                  color:           (STATUS_META[document.status] ?? STATUS_META['not-started']).fg,
                  border: '1px solid #E2E8F0',
                }}
                data-doc-status={document.status}
              >
                {(STATUS_META[document.status] ?? STATUS_META['not-started']).label}
              </span>
            )}
          </div>

          <div className="flex flex-none items-center gap-3">
            {isSigned && signedAtText && (
              <div className="flex items-center gap-1.5 whitespace-nowrap text-xs text-slate-500" title={formatLocal(signedAtIso)} data-signed-at>
                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: '#16A34A' }} />
                Signed {signedAtText.replace(/ (\d\d:\d\d UTC)$/, ' · $1')}
              </div>
            )}
            <button
              type="button"
              disabled={!isSigned || signatureGap}
              onClick={() => {
                // Browser-native PDF export of the current signed-and-locked
                // document view. Replaced by a server-rendered PDF once the
                // Phase 4 reports pipeline + puppeteer worker lands.
                window.print()
              }}
              title={signatureGap
                ? 'No signature records are on file, so this cannot be exported as a signed document'
                : isSigned ? 'Open browser Print dialog (Save as PDF)' : 'Available once the document is signed'}
              className="rounded-md bg-blue-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-blue-700 transition-colors disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-blue-600"
            >
              Download PDF
            </button>
            <button
              type="button"
              onClick={() => {
                const url = window.location.href
                if (navigator.clipboard?.writeText) {
                  navigator.clipboard.writeText(url).then(() => setToast('Link copied'), () => window.prompt('Copy this link to share:', url))
                } else {
                  window.prompt('Copy this link to share:', url)
                }
              }}
              title="Copy a shareable link to this document"
              className="rounded-md border border-slate-200 bg-white px-4 py-2 text-[13px] font-semibold text-slate-900 hover:bg-slate-50 transition-colors"
            >
              Share
            </button>
          </div>
        </div>
      </div>

      {/* ============ Status banner (36px) — replaces EditorToolbar ============ */}
      <div
        className="flex h-9 flex-none items-center gap-3 px-8"
        style={isSigned
          ? { backgroundColor: '#F0FDF4', borderBottom: '1px solid #BBF7D0' }
          : { backgroundColor: '#FFFBEB', borderBottom: '1px solid #FDE68A' }}
        data-signed-banner={isSigned ? 'signed' : 'unsigned'}
        data-screen-only
      >
        <ShieldIcon size={14} colour={isSigned ? '#15803D' : '#B45309'} />
        <p className="overflow-hidden text-ellipsis whitespace-nowrap text-[13px]" style={{ color: isSigned ? '#15803D' : '#B45309' }}>
          {isSigned
            ? 'This document is signed and locked. No further edits are permitted.'
            : `This document is not signed yet (${(STATUS_META[document.status] ?? STATUS_META['not-started']).label}). This is a read-only preview of its current content.`}
        </p>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => setAuditOpen(true)}
          className="whitespace-nowrap text-[13px] font-semibold hover:opacity-80 transition-opacity"
          style={{ color: isSigned ? '#15803D' : '#B45309' }}
          data-action="view-audit-trail"
        >
          View audit trail →
        </button>
      </div>

      {/* ============ Two-column row — no right panel in the final view ============ */}
      <div className="flex flex-1 min-h-0">

        <div className="flex" data-no-print><SectionNavigator sections={navSections} /></div>

        {/* Editor pane — read-only, no toolbar, no right panel */}
        <div className="relative flex min-w-0 flex-1 flex-col bg-white">
          {showWatermark && (
            <>
              {/* On screen: centred over the reading pane. In print: repeated on every page. */}
              <div aria-hidden="true" data-watermark className="pointer-events-none absolute inset-0 z-[5] flex items-center justify-center overflow-hidden print:hidden">
                <span className="-rotate-[28deg] select-none whitespace-nowrap text-[88px] font-black tracking-widest" style={{ color: 'rgba(148,163,184,0.2)' }}>DRAFT — NOT SIGNED</span>
              </div>
              <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-[5] hidden items-center justify-center print:flex">
                <span className="-rotate-[28deg] select-none whitespace-nowrap text-[88px] font-black tracking-widest" style={{ color: 'rgba(148,163,184,0.35)' }}>DRAFT — NOT SIGNED</span>
              </div>
            </>
          )}
          {/* Content scroll */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-12 pt-6 pb-8" data-final-scroll>
            <div className="flex max-w-[760px] flex-col">

              {/* Printed title page (Download PDF only) */}
              <div data-print-only data-print-page-break className="pt-[30mm]">
                <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">{project?.shortTitle ?? ''}{project?.name ? ` · ${project.name}` : ''}</p>
                <h1 className="mt-4 text-[28px] font-bold leading-tight text-slate-900">{document.title}</h1>
                <table className="mt-10 w-full text-[12px]">
                  <tbody>
                    <tr><td className="w-44 py-1.5 text-slate-500">Version</td><td className="py-1.5 font-semibold text-slate-900">{isSigned ? `${signedVersion} · Final` : document.version}</td></tr>
                    <tr><td className="py-1.5 text-slate-500">Status</td><td className="py-1.5 font-semibold text-slate-900">{signatureGap ? 'Marked signed — no signatures on record' : isSigned ? 'Signed ✓' : (STATUS_META[document.status] ?? STATUS_META['not-started']).label}</td></tr>
                    {isSigned && signedAtText && <tr><td className="py-1.5 text-slate-500">Signed</td><td className="py-1.5 text-slate-900">{signedAtText}</td></tr>}
                    {project?.therapeuticArea && <tr><td className="py-1.5 text-slate-500">Therapeutic area</td><td className="py-1.5 text-slate-900">{project.therapeuticArea}</td></tr>}
                    {project?.phase && <tr><td className="py-1.5 text-slate-500">Phase</td><td className="py-1.5 text-slate-900">{project.phase}</td></tr>}
                    {sealHash && <tr><td className="py-1.5 align-top text-slate-500">Document hash (SHA-256)</td><td className="break-all py-1.5 font-mono text-[10px] text-slate-900">{sealHash}</td></tr>}
                    <tr><td className="py-1.5 text-slate-500">Document ID</td><td className="py-1.5 font-mono text-[11px] text-slate-900">{document.id}</td></tr>
                  </tbody>
                </table>
              </div>

              {/* Printed table of contents */}
              <div data-print-only data-print-page-break>
                <h2 className="text-[20px] font-bold text-slate-900">Contents</h2>
                <ol className="mt-4 flex flex-col gap-1.5 text-[13px] text-slate-900">
                  {orderedSections.map(s => (
                    <li key={s.id}>{s.number}. {s.title}</li>
                  ))}
                  <li>Appendix — Compliance Summary</li>
                </ol>
              </div>

              {/* "Signed" with no signature on record: say so instead of presenting it as signed */}
              {signatureGap && (
                <div
                  className="mb-6 flex items-start gap-4 rounded-lg px-5 py-4"
                  style={{ backgroundColor: '#FFFBEB', border: '1px solid #FDE68A' }}
                  data-signature-gap
                >
                  <ShieldIcon size={24} colour="#B45309" />
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <p className="text-sm font-bold" style={{ color: '#B45309' }}>Marked as signed, but no signatures are on record</p>
                    <p className="text-[12px] leading-relaxed" style={{ color: '#92400E' }}>
                      This document's status is Signed, but it has no completed e-signature chain, so there are no signers, signature meanings or document hash to show.
                      It cannot be treated or exported as a signed record. Ask an administrator to check how its status was set.
                    </p>
                  </div>
                </div>
              )}

              {/* Signature chain banner — only for a signed document, and only what was really signed */}
              {isSigned && !signatureGap && (
              <div
                className="mb-6 flex items-center gap-4 rounded-lg px-5 py-4"
                style={{ backgroundColor: '#F0FDF4', border: '1px solid #BBF7D0' }}
                data-chain-banner
              >
                <ShieldIcon size={24} colour="#15803D" />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <p className="text-sm font-bold" style={{ color: '#15803D' }}>Electronically signed document</p>
                  <p className="font-mono text-[11px] font-medium" style={{ color: '#15803D', opacity: 0.7 }} title={sealHash ? `SHA-256: ${sealHash}` : undefined} data-screen-only>
                    {document.title} · {signedVersion}{sealHash ? ` · SHA-256: ${shortHash(sealHash)}` : ''}
                  </p>
                  {/* In print the full hash, so the paper copy can be checked against the record. */}
                  <p className="break-all font-mono text-[9px] font-medium" style={{ color: '#15803D' }} data-print-only>
                    {document.title} · {signedVersion}{sealHash ? ` · SHA-256: ${sealHash}` : ''}
                  </p>
                </div>
                <div className="flex flex-none flex-col gap-1">
                  {signedRecords.length === 0 && (
                    <p className="text-[11px] italic" style={{ color: '#15803D', opacity: 0.8 }} data-no-signatures>
                      No signature records on file
                    </p>
                  )}
                  {signedRecords.map(record => {
                    const c = AVATAR_COLOURS[record.initials] ?? AVATAR_COLOURS.MW
                    const when = formatUtc(record.timestamp)
                    return (
                      <div key={record.id} className="flex items-center gap-1.5" data-chain-row={record.initials} title={formatLocal(record.timestamp)}>
                        <div
                          className="flex h-[18px] w-[18px] flex-none items-center justify-center rounded-full font-mono text-[9px] font-bold"
                          style={{ backgroundColor: c.bg, color: c.fg }}
                        >
                          {record.initials}
                        </div>
                        <p className="whitespace-nowrap text-[11px]" style={{ color: '#15803D' }}>
                          {record.signer}{record.role ? ` · ${record.role}` : ''} · {MEANING_VERB[record.meaning] ?? record.meaning}{when ? ` · ${when}` : ''}
                        </p>
                      </div>
                    )
                  })}
                </div>
              </div>
              )}

              {/* Every section of the document, in order */}
              {orderedSections.map(section => {
                const html = section.contentHtml
                return (
                  <section
                    key={section.id}
                    data-final-section={section.id}
                    className="mb-8 scroll-mt-4"
                    style={{ breakInside: 'auto' }}
                  >
                    <h2 className="text-[20px] font-bold tracking-tight" style={{ breakAfter: 'avoid' }}>
                      {section.number}. {section.title}
                    </h2>
                    {isBlankHtml(html)
                      ? <p className="mt-2 text-sm italic text-slate-400">No content recorded for this section.</p>
                      : <FinalSectionBody html={html} />}
                  </section>
                )
              })}
              {document.sections.length === 0 && (
                <p className="text-sm italic text-slate-400">This document has no sections.</p>
              )}

              {/* Appendix — Compliance Summary (FR-A-030, FR-A-001d; AC-A-029, AC-A-013) */}
              <section className="mt-4 border-t border-slate-200 pt-6" data-compliance-summary data-print-break-before>
                <h2 className="text-[20px] font-bold" style={{ breakAfter: 'avoid' }}>Appendix — Compliance Summary</h2>
                {complianceFailed && <p className="mt-2 text-sm text-red-700">The Compliance Summary could not be loaded.</p>}
                {!compliance && !complianceFailed && <p className="mt-2 font-mono text-xs text-slate-400">Loading compliance summary…</p>}
                {compliance && (
                  <>
                    <p className="mt-2 text-[13px] text-slate-600">
                      Generated from this document's input checklist{compliance.checklistTemplateVersion != null ? ` (template v${compliance.checklistTemplateVersion})` : ''}.
                    </p>

                    <h3 className="mt-5 text-[15px] font-bold text-slate-900">Applicable regulatory frameworks</h3>
                    {compliance.frameworks.length === 0
                      ? <p className="mt-1 text-[13px] italic text-slate-500">No frameworks are recorded on this document's checklist.</p>
                      : (
                        <table className="mt-2 w-full border-collapse text-[12px]">
                          <thead>
                            <tr className="text-left text-slate-500">
                              <th className="border-b border-slate-200 py-1.5 pr-3 font-semibold">Framework</th>
                              <th className="border-b border-slate-200 py-1.5 pr-3 font-semibold">Version</th>
                              <th className="border-b border-slate-200 py-1.5 pr-3 font-semibold">Jurisdiction</th>
                              <th className="border-b border-slate-200 py-1.5 font-semibold">Reference</th>
                            </tr>
                          </thead>
                          <tbody>
                            {compliance.frameworks.map(f => (
                              <tr key={f.name} className="align-top">
                                <td className="border-b border-slate-100 py-1.5 pr-3 font-semibold text-slate-900">{f.name}</td>
                                <td className="border-b border-slate-100 py-1.5 pr-3 text-slate-700">{f.version ?? '—'}</td>
                                <td className="border-b border-slate-100 py-1.5 pr-3 text-slate-700">{f.jurisdiction ?? '—'}</td>
                                <td className="break-all border-b border-slate-100 py-1.5 text-slate-700">
                                  {f.sourceUrl ?? (f.inRegistry ? '—' : 'Not in the framework registry')}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}

                    <h3 className="mt-6 text-[15px] font-bold text-slate-900">Rules applied</h3>
                    {compliance.frameworks.map(f => (
                      <div key={f.name} className="mt-3" style={{ breakInside: 'avoid' }}>
                        <p className="text-[13px] font-semibold text-slate-800">{f.name}</p>
                        <ul className="mt-1 flex flex-col gap-1">
                          {f.rules.map((r, i) => {
                            const outcome = RULE_OUTCOME[r.status] ?? { label: r.status, colour: '#475569' }
                            return (
                              <li key={i} className="flex items-start gap-3 text-[12px]">
                                <span className="min-w-0 flex-1 text-slate-800">{r.text}{r.mandatory ? '' : ' (recommended)'}</span>
                                <span className="flex-none font-semibold" style={{ color: outcome.colour }}>{outcome.label}</span>
                              </li>
                            )
                          })}
                        </ul>
                      </div>
                    ))}

                    <h3 className="mt-6 text-[15px] font-bold text-slate-900">Waived Framework Mandatory items</h3>
                    {compliance.waivedMandatory.length === 0
                      ? <p className="mt-1 text-[13px] text-slate-600">None — no Framework Mandatory checklist item was waived.</p>
                      : (
                        <table className="mt-2 w-full border-collapse text-[12px]" data-waived-items>
                          <thead>
                            <tr className="text-left text-slate-500">
                              <th className="border-b border-slate-200 py-1.5 pr-3 font-semibold">Item</th>
                              <th className="border-b border-slate-200 py-1.5 pr-3 font-semibold">Framework</th>
                              <th className="border-b border-slate-200 py-1.5 pr-3 font-semibold">Waived by</th>
                              <th className="border-b border-slate-200 py-1.5 font-semibold">Reason</th>
                            </tr>
                          </thead>
                          <tbody>
                            {compliance.waivedMandatory.map((w, i) => (
                              <tr key={i} className="align-top">
                                <td className="border-b border-slate-100 py-1.5 pr-3 text-slate-900">{w.text}</td>
                                <td className="border-b border-slate-100 py-1.5 pr-3 text-slate-700">{w.framework}</td>
                                <td className="border-b border-slate-100 py-1.5 pr-3 text-slate-700">
                                  {w.waivedBy ?? '—'}{w.waivedAt ? <><br /><span className="text-[11px] text-slate-500">{formatUtc(w.waivedAt)}</span></> : null}
                                </td>
                                <td className="border-b border-slate-100 py-1.5 text-slate-700">{w.reason ?? '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                  </>
                )}
              </section>
            </div>
          </div>

          {/* Provenance bar (40px) */}
          <div
            className="flex h-10 flex-none items-center overflow-hidden truncate whitespace-nowrap border-t border-slate-200 px-5 text-xs text-slate-500"
            style={{ backgroundColor: '#F8FAFC' }}
            data-provenance-bar
          >
            {[
              activeSectionData ? `Section ${activeSectionData.number.replace(/^§/, '')} ${activeSectionData.title}` : null,
              isSigned ? 'read-only' : 'read-only preview · not signed',
              isSigned ? `signed ${signedVersion}` : document.version,
              isSigned ? `${signedRecords.length} ${signedRecords.length === 1 ? 'signature' : 'signatures'} on record` : null,
              isSigned && signedAtText ? `locked ${signedAtText}` : null,
            ].filter(Boolean).join(' · ')}
          </div>
        </div>
      </div>

      {toast && (
        <div role="status" data-toast className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-md bg-slate-900 px-4 py-2 text-[13px] font-semibold text-white shadow-lg">
          {toast}
        </div>
      )}

      {/* "View audit trail": this document's own audit trail, without leaving the signed view. */}
      <SlidePanel
        open={auditOpen}
        onClose={() => setAuditOpen(false)}
        title="Audit trail"
        subtitle={document.title}
        storageKey="panel-width-document-audit"
        defaultWidth={460}
        closeOnOutsideClick
      >
        <div className="flex h-full flex-col" data-document-audit-panel={document.id}>
          <div className="min-h-0 flex-1">
            <AuditTrailPanel key={document.id} documentId={document.id} />
          </div>
        </div>
      </SlidePanel>
    </div>
  )
}
