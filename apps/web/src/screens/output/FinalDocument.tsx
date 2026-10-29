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

// The API returns sections ordered as text (§1, §10, §11, §2 ...). Present them
// in document order: compare section numbers numerically, part by part.
const sectionOrder = new Intl.Collator(undefined, { numeric: true })
const bySectionNumber = (a: Section, b: Section) =>
  sectionOrder.compare(a.number.replace(/^§/, ''), b.number.replace(/^§/, ''))

const isBlankHtml = (html: string | undefined) => !html || html.replace(/<[^>]*>/g, '').trim() === ''

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
              disabled={!isSigned}
              onClick={() => {
                // Browser-native PDF export of the current signed-and-locked
                // document view. Replaced by a server-rendered PDF once the
                // Phase 4 reports pipeline + puppeteer worker lands.
                window.print()
              }}
              title={isSigned ? 'Open browser Print dialog (Save as PDF)' : 'Available once the document is signed'}
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

              {/* Signature chain banner — only for a signed document, and only what was really signed */}
              {isSigned && (
              <div
                className="mb-6 flex items-center gap-4 rounded-lg px-5 py-4"
                style={{ backgroundColor: '#F0FDF4', border: '1px solid #BBF7D0' }}
                data-chain-banner
              >
                <ShieldIcon size={24} colour="#15803D" />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <p className="text-sm font-bold" style={{ color: '#15803D' }}>Electronically signed document</p>
                  <p className="font-mono text-[11px] font-medium" style={{ color: '#15803D', opacity: 0.7 }} title={sealHash ? `SHA-256: ${sealHash}` : undefined}>
                    {document.title} · {signedVersion}{sealHash ? ` · SHA-256: ${shortHash(sealHash)}` : ''}
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
                          {record.signer} · {MEANING_VERB[record.meaning] ?? record.meaning}{when ? ` · ${when}` : ''}
                        </p>
                      </div>
                    )
                  })}
                </div>
              </div>
              )}

              {/* Every section of the document, in order */}
              {[...document.sections].sort(bySectionNumber).map(section => {
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
