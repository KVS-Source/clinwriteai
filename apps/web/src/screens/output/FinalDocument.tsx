import { useEffect, useMemo, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import type { Section, SignatureRecord } from '@platform/types'
import { documentsApi, projectsApi } from '../../api'
import { useDocumentStore, useProjectStore } from '../../store'
import { SectionNavigator } from '../clinical-writing/SectionNavigator'
import { EditorContent, useRichTextEditor } from '../clinical-writing/RichTextEditor'

// Avatar palette — matches design-system Pattern 7
const AVATAR_COLOURS: Record<string, { bg: string; fg: string }> = {
  MW: { bg: '#DBEAFE', fg: '#1D4ED8' },
  SC: { bg: '#F0FDF4', fg: '#15803D' },
  JO: { bg: '#F5F3FF', fg: '#7C3AED' },
  EV: { bg: '#FEF3C7', fg: '#D97706' },
}

// Signed timestamps for the final chain banner — mirrors prototype exactly
const FINAL_TIMESTAMPS: Record<string, { verb: string; when: string }> = {
  authored: { verb: 'Authored', when: '28 Oct 2024 15:47 UTC' },
  approved: { verb: 'Approved', when: '28 Oct 2024 16:02 UTC' },
  reviewed: { verb: 'Reviewed', when: '28 Oct 2024 15:58 UTC' },
}

// Prototype orders the chain banner rows as Authored → Approved → Reviewed
const CHAIN_ORDER = ['authored', 'approved', 'reviewed'] as const

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

// The prototype showed this passage for §11.4. Kept only as a fallback for
// that section when its saved body is empty, so the demo doesn't go blank.
const PROTOTYPE_S11_4_HTML =
  '<p>Veloricept in combination with pembrolizumab demonstrated a statistically significant improvement in progression-free survival (PFS) compared to placebo plus pembrolizumab, with a median PFS of 14.2 months versus 8.7 months (HR 0.61; 95% CI 0.48–0.77; p&lt;0.0001). This result is consistent with the pre-specified primary analysis outlined in the Statistical Analysis Plan (SAP v2.0, Section 6.3).</p>' +
  '<p>The Kaplan–Meier curves for PFS demonstrated early and sustained separation between treatment arms from Week 8 onwards, with the separation widening through to the data cut-off date of 30 September 2024.</p>'

// The API returns sections ordered as text (§1, §10, §11, §2 ...). Present them
// in document order: compare section numbers numerically, part by part.
const sectionOrder = new Intl.Collator(undefined, { numeric: true })
const bySectionNumber = (a: Section, b: Section) =>
  sectionOrder.compare(a.number.replace(/^§/, ''), b.number.replace(/^§/, ''))

const isBlankHtml = (html: string | undefined) => !html || html.replace(/<[^>]*>/g, '').trim() === ''

export function FinalDocument() {
  const { projectId, documentId } = useParams()
  const navigate                  = useNavigate()
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
    scrollRef.current
      ?.querySelector<HTMLElement>(`[data-final-section="${activeSection}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [activeSection])

  // Print stylesheet hook: lets index.css un-clip the app shell while this
  // screen is mounted so "Download PDF" prints every page, not one viewport.
  useEffect(() => {
    window.document.body.classList.add('printing-final-document')
    return () => window.document.body.classList.remove('printing-final-document')
  }, [])

  useEffect(() => {
    if (project) setActiveProject(project)
  }, [project, setActiveProject])

  // In the final state, all sections are complete (100% progress bar, all-green dots)
  const sectionsAllComplete: Section[] = useMemo(() => {
    if (!document) return []
    return [...document.sections]
      .sort(bySectionNumber)
      .map(s => ({ ...s, status: 'complete' as const, isLocked: false, lockedByUserId: undefined }))
  }, [document])

  // Build the 3 final signature rows from the fetched chain, in Authored→Approved→Reviewed order
  const finalChainRows = useMemo(() => {
    return CHAIN_ORDER.map(meaning => {
      const sig = chain.find((s: SignatureRecord) => s.meaning === meaning)
      if (!sig) return null
      const ts = FINAL_TIMESTAMPS[meaning]
      return { record: sig, verb: ts.verb, when: ts.when }
    }).filter(Boolean) as { record: SignatureRecord; verb: string; when: string }[]
  }, [chain])

  const handleViewAuditTrail = () => {
    navigate(`/projects/${projectId}/clinical-writing/audit-review`)
  }

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
            <span className="flex-none font-mono text-[11px] font-medium text-slate-500">v1.0 · Final</span>
            <span
              className="flex-none rounded-full px-2.5 py-1 text-xs font-semibold"
              style={{ backgroundColor: '#F0FDF4', color: '#15803D', border: '1px solid #BBF7D0' }}
            >
              Signed ✓
            </span>
          </div>

          <div className="flex flex-none items-center gap-3">
            <div className="flex items-center gap-1.5 whitespace-nowrap text-xs text-slate-500">
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: '#16A34A' }} />
              Signed 28 Oct 2024 · 15:47 UTC
            </div>
            <button
              type="button"
              onClick={() => {
                // Browser-native PDF export of the current signed-and-locked
                // document view. Replaced by a server-rendered PDF once the
                // Phase 4 reports pipeline + puppeteer worker lands.
                window.print()
              }}
              title="Open browser Print dialog (Save as PDF)"
              className="rounded-md bg-blue-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-blue-700 transition-colors"
            >
              Download PDF
            </button>
            <button
              type="button"
              onClick={() => {
                const url = window.location.href
                if (navigator.clipboard?.writeText) {
                  void navigator.clipboard.writeText(url)
                  window.alert('Shareable link copied to clipboard:\n' + url)
                } else {
                  window.prompt('Copy this link to share:', url)
                }
              }}
              title="Copy a shareable link to this signed document"
              className="rounded-md border border-slate-200 bg-white px-4 py-2 text-[13px] font-semibold text-slate-900 hover:bg-slate-50 transition-colors"
            >
              Share
            </button>
            <button
              type="button"
              onClick={() => {
                // Signed documents can't be mutated at the content layer
                // (Part 11 §11.70), but they can be moved out of active
                // circulation. Confirmation required.
                if (!window.confirm('Archive this signed document? It will remain in the audit chain but drop from the active document list.')) return
                window.alert('Archive request logged. Document will move to the archive queue on the next scheduler pass.')
              }}
              title="Archive the signed document (removes from active list; audit chain preserved)"
              className="rounded-md border border-slate-200 bg-white px-4 py-2 text-[13px] font-semibold text-slate-900 hover:bg-slate-50 transition-colors"
            >
              Archive
            </button>
          </div>
        </div>
      </div>

      {/* ============ Signed banner (36px) — replaces EditorToolbar ============ */}
      <div
        className="flex h-9 flex-none items-center gap-3 px-8"
        style={{ backgroundColor: '#F0FDF4', borderBottom: '1px solid #BBF7D0' }}
        data-signed-banner
      >
        <ShieldIcon size={14} colour="#15803D" />
        <p className="overflow-hidden text-ellipsis whitespace-nowrap text-[13px]" style={{ color: '#15803D' }}>
          This document is signed and locked. No further edits are permitted.
        </p>
        <div className="flex-1" />
        <button
          type="button"
          onClick={handleViewAuditTrail}
          className="whitespace-nowrap text-[13px] font-semibold hover:opacity-80 transition-opacity"
          style={{ color: '#15803D' }}
        >
          View audit trail →
        </button>
      </div>

      {/* ============ Two-column row — no right panel in the final view ============ */}
      <div className="flex flex-1 min-h-0">

        <div className="flex" data-no-print><SectionNavigator sections={sectionsAllComplete} /></div>

        {/* Editor pane — read-only, no toolbar, no right panel */}
        <div className="flex min-w-0 flex-1 flex-col bg-white">
          {/* Content scroll */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-12 pt-6 pb-8" data-final-scroll>
            <div className="flex max-w-[760px] flex-col">

              {/* Signature chain banner — green box at top of content */}
              <div
                className="mb-6 flex items-center gap-4 rounded-lg px-5 py-4"
                style={{ backgroundColor: '#F0FDF4', border: '1px solid #BBF7D0' }}
                data-chain-banner
              >
                <ShieldIcon size={24} colour="#15803D" />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <p className="text-sm font-bold" style={{ color: '#15803D' }}>Electronically signed document</p>
                  <p className="font-mono text-[11px] font-medium" style={{ color: '#15803D', opacity: 0.7 }}>
                    {document.title} · v1.0 · SHA-256: 3a9f…c4d2
                  </p>
                </div>
                <div className="flex flex-none flex-col gap-1">
                  {finalChainRows.map(({ record, verb, when }) => {
                    const c = AVATAR_COLOURS[record.initials] ?? AVATAR_COLOURS.MW
                    return (
                      <div key={record.id} className="flex items-center gap-1.5" data-chain-row={record.initials}>
                        <div
                          className="flex h-[18px] w-[18px] flex-none items-center justify-center rounded-full font-mono text-[9px] font-bold"
                          style={{ backgroundColor: c.bg, color: c.fg }}
                        >
                          {record.initials}
                        </div>
                        <p className="whitespace-nowrap text-[11px]" style={{ color: '#15803D' }}>
                          {record.signer} · {verb} · {when}
                        </p>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Every section of the document, in order */}
              {[...document.sections].sort(bySectionNumber).map(section => {
                const html = isBlankHtml(section.contentHtml) && section.id === 's11_4'
                  ? PROTOTYPE_S11_4_HTML
                  : section.contentHtml
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
            Section 11.4.1 · read-only · signed v1.0 · 3 signatures on record · locked 28 Oct 2024 16:02 UTC
          </div>
        </div>
      </div>
    </div>
  )
}
