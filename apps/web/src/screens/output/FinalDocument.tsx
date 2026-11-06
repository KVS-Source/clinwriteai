import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { STATUS_META, type Section, type SignatureRecord } from '@platform/types'
import i18n from '../../i18n'
import { DOCUMENT_STATUS_KEY, signerRoleLabel } from '../../utils/documentLabels'
import { formatDateUtc, uiLocale } from '../../utils/formatDate'
import { documentsApi, projectsApi } from '../../api'
import { ApiError } from '../../api/client'
import { MyRaciRole } from '../clinical-writing/MyRaciRole'
import { useDocumentStore, useProjectStore } from '../../store'
import { SectionNavigator } from '../clinical-writing/SectionNavigator'
import { EditorContent, useRichTextEditor } from '../clinical-writing/RichTextEditor'
import { SlidePanel } from '../../components/ui/SlidePanel'
import { LibraryPushedBadge, PushToLibraryButton } from '../../components/library/PushToLibraryButton'
import { AuditTrailPanel } from '../../panels/AuditTrailPanel'
import { useSignatureAccess } from './useSignatureAccess'

// Avatar palette — matches design-system Pattern 7
const AVATAR_COLOURS: Record<string, { bg: string; fg: string }> = {
  MW: { bg: '#DBEAFE', fg: '#1D4ED8' },
  SC: { bg: '#F0FDF4', fg: '#15803D' },
  JO: { bg: '#F5F3FF', fg: '#7C3AED' },
  EV: { bg: '#FEF3C7', fg: '#D97706' },
}

// What each signature means, as shown in the chain banner.
const MEANING_VERB_KEY: Record<string, string> = {
  authored: 'page.final_document.meaning_authored',
  reviewed: 'page.final_document.meaning_reviewed',
  approved: 'page.final_document.meaning_approved',
  acknowledged: 'page.final_document.meaning_acknowledged',
}

// '28 Oct 2026 15:47 UTC' — signed records are shown in UTC, like the e-signature screen.
// Returns null for a missing or unreadable time rather than printing a made-up one.
function formatUtc(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const p = (n: number) => String(n).padStart(2, '0')
  return `${formatDateUtc(d)} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`
}

// The same moment in the viewer's own time zone, for the hover text.
const formatLocal = (iso: string | null | undefined): string | undefined =>
  iso && !Number.isNaN(new Date(iso).getTime()) ? new Date(iso).toLocaleString(uiLocale(), { dateStyle: 'medium', timeStyle: 'short' }) : undefined

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

// Outcome of a checklist rule, as printed in the Compliance Summary.
const RULE_OUTCOME: Record<string, { labelKey: string; colour: string }> = {
  complete:      { labelKey: 'page.final_document.outcome_met',           colour: '#15803D' },
  waived:        { labelKey: 'page.final_document.outcome_waived',        colour: '#B45309' },
  pending:       { labelKey: 'page.final_document.outcome_not_completed', colour: '#B91C1C' },
  'in-progress': { labelKey: 'page.final_document.outcome_not_completed', colour: '#B91C1C' },
  in_progress:   { labelKey: 'page.final_document.outcome_not_completed', colour: '#B91C1C' },
}

// Why the server refused the PDF, in the reader's language. An unknown refusal keeps the server's own words.
function pdfErrorText(e: unknown): string {
  if (e instanceof ApiError) {
    const body = e.body as { error?: string; message?: string } | null
    if (body?.error === 'signature_records_missing') return i18n.t('page.final_document.pdf_refused_no_records')
    if (body?.error === 'signed_content_changed') return i18n.t('page.final_document.pdf_refused_changed')
    if (e.status === 403) return i18n.t('page.final_document.denied_title')
    if (body?.message) return body.message
  }
  return i18n.t('page.final_document.pdf_failed')
}

export function FinalDocument() {
  const { t } = useTranslation()
  const { projectId, documentId } = useParams()
  // Who may see the Final Document (the e-signature action table): not an admin, a guest, or QC on its own.
  const access = useSignatureAccess(documentId)
  const [auditOpen, setAuditOpen] = useState(false)
  const [toast, setToast]         = useState<string | null>(null)
  const [pdfBusy, setPdfBusy]     = useState(false)
  const [pdfError, setPdfError]   = useState<string | null>(null)
  const setActiveProject          = useProjectStore(s => s.setActiveProject)
  const setActiveDocument         = useDocumentStore(s => s.setActiveDocument)
  const setActiveSection          = useDocumentStore(s => s.setActiveSection)

  // Read through the Final Document's own endpoint, which applies the same access rule
  // on the server. Keyed under ['document', id] so the usual refreshes still reach it.
  const { data: document, error: finalReadError } = useQuery({
    queryKey: ['document', documentId, 'final'],
    queryFn:  () => documentsApi.getFinal(documentId!),
    enabled:  !!documentId,
    retry:    false,
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

  // The PDF is made on the server, which also decides whether it may go out as signed
  // and records the export. A refusal comes back with the reason to show.
  const downloadPdf = async () => {
    if (!documentId) return
    setPdfBusy(true)
    setPdfError(null)
    try {
      const { blob, filename } = await documentsApi.downloadFinalPdf(documentId)
      const url = URL.createObjectURL(blob)
      const a = window.document.createElement('a')
      a.href = url
      a.download = filename ?? 'final-document.pdf'
      window.document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
    } catch (e) {
      setPdfError(pdfErrorText(e))
    } finally {
      setPdfBusy(false)
    }
  }

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
  // The signed document's version — v1.0 once the chain completes (AC-A-046) — and the
  // document hash bound to the signatures.
  const signedVersion = document?.version ?? signedRecords.find(r => r.version_at_signing)?.version_at_signing ?? ''
  const sealHash = [...signedRecords].reverse().find(r => r.documentHash)?.documentHash
  const signedAtText = formatUtc(signedAtIso)
  const activeSectionData = document?.sections.find(s => s.id === activeSection)
  // "Signed" status with no signature on record: the status was set without a completed
  // e-signature chain (AC-A-045 / 046). It is not presented or exported as a signed record.
  const signatureGap = isSigned && signedRecords.length === 0
  const orderedSections = useMemo(() => (document ? [...document.sections].sort(bySectionNumber) : []), [document])

  // Access first: a refused read never delivers the document, so checking for it
  // first would leave "Loading document…" on screen for good. The API's 403 counts
  // too, in case the server's rule and this screen's ever disagree.
  const refused = (access.ready && !access.canViewFinal)
    || (finalReadError instanceof ApiError && finalReadError.status === 403)
  if (refused) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1" data-final-access-denied>
        <p className="font-mono text-sm text-slate-600">{t('page.final_document.denied_title')}</p>
        <p className="max-w-md text-center text-xs text-slate-500">{t('page.final_document.denied_body')}</p>
      </div>
    )
  }

  if (!document) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="font-mono text-sm text-slate-400">{t('page.final_document.loading')}</p>
      </div>
    )
  }

  const unsignedStatusKey = DOCUMENT_STATUS_KEY[document.status] ?? DOCUMENT_STATUS_KEY['not-started']

  return (
    <div className="flex h-full flex-col" data-screen="final-document">

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
              {isSigned ? t('page.final_document.version_final', { version: document.version }) : document.version}
            </span>
            {isSigned ? (
              <span
                className="flex-none rounded-full px-2.5 py-1 text-xs font-semibold"
                style={{ backgroundColor: '#F0FDF4', color: '#15803D', border: '1px solid #BBF7D0' }}
                data-doc-status="signed"
              >
                {t('page.final_document.signed_badge')}
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
                {t(unsignedStatusKey)}
              </span>
            )}
            <LibraryPushedBadge document={document} />
            {documentId && <MyRaciRole documentId={documentId} />}
          </div>

          <div className="flex flex-none items-center gap-3">
            {isSigned && signedAtText && (
              <div className="flex items-center gap-1.5 whitespace-nowrap text-xs text-slate-500" title={formatLocal(signedAtIso)} data-signed-at>
                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: '#16A34A' }} />
                {t('page.final_document.signed_at', { when: signedAtText.replace(/ (\d\d:\d\d UTC)$/, ' · $1') })}
              </div>
            )}
            <PushToLibraryButton document={document} />
            <button
              type="button"
              disabled={signatureGap || pdfBusy}
              onClick={() => void downloadPdf()}
              title={signatureGap
                ? t('page.final_document.pdf_tooltip_gap')
                : isSigned ? t('page.final_document.pdf_tooltip_signed') : t('page.final_document.pdf_tooltip_draft')}
              className="rounded-md bg-blue-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-blue-700 transition-colors disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-blue-600"
              data-action="download-final-pdf"
            >
              {pdfBusy ? t('page.final_document.pdf_preparing') : isSigned ? t('page.final_document.pdf_download') : t('page.final_document.pdf_download_draft')}
            </button>
            <button
              type="button"
              onClick={() => {
                const url = window.location.href
                if (navigator.clipboard?.writeText) {
                  navigator.clipboard.writeText(url).then(() => setToast(t('page.final_document.link_copied')), () => window.prompt(t('page.final_document.copy_prompt'), url))
                } else {
                  window.prompt(t('page.final_document.copy_prompt'), url)
                }
              }}
              title={t('page.final_document.share_tooltip')}
              className="rounded-md border border-slate-200 bg-white px-4 py-2 text-[13px] font-semibold text-slate-900 hover:bg-slate-50 transition-colors"
            >
              {t('page.final_document.share')}
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
            ? t('page.final_document.banner_signed')
            : t('page.final_document.banner_unsigned', { status: t(unsignedStatusKey) })}
        </p>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => setAuditOpen(true)}
          className="whitespace-nowrap text-[13px] font-semibold hover:opacity-80 transition-opacity"
          style={{ color: isSigned ? '#15803D' : '#B45309' }}
          data-action="view-audit-trail"
        >
          {t('page.final_document.view_audit')}
        </button>
      </div>

      {pdfError && (
        <div className="flex flex-none items-start justify-between gap-3 border-b border-red-200 bg-red-50 px-8 py-2.5 text-[13px] text-red-800" role="alert" data-final-pdf-error>
          <span>{pdfError}</span>
          <button type="button" onClick={() => setPdfError(null)} className="flex-none font-semibold underline">{t('page.final_document.dismiss')}</button>
        </div>
      )}

      {/* ============ Two-column row — no right panel in the final view ============ */}
      <div className="flex flex-1 min-h-0">

        <div className="flex"><SectionNavigator sections={navSections} /></div>

        {/* Editor pane — read-only, no toolbar, no right panel */}
        <div className="relative flex min-w-0 flex-1 flex-col bg-white">
          {showWatermark && (
            <div aria-hidden="true" data-watermark className="pointer-events-none absolute inset-0 z-[5] flex items-center justify-center overflow-hidden">
              <span className="-rotate-[28deg] select-none whitespace-nowrap text-[88px] font-black tracking-widest" style={{ color: 'rgba(148,163,184,0.2)' }}>{t('page.final_document.watermark')}</span>
            </div>
          )}
          {/* Content scroll */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-12 pt-6 pb-8" data-final-scroll>
            <div className="flex max-w-[760px] flex-col">

              {/* "Signed" with no signature on record: say so instead of presenting it as signed */}
              {signatureGap && (
                <div
                  className="mb-6 flex items-start gap-4 rounded-lg px-5 py-4"
                  style={{ backgroundColor: '#FFFBEB', border: '1px solid #FDE68A' }}
                  data-signature-gap
                >
                  <ShieldIcon size={24} colour="#B45309" />
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <p className="text-sm font-bold" style={{ color: '#B45309' }}>{t('page.final_document.gap_title')}</p>
                    <p className="text-[12px] leading-relaxed" style={{ color: '#92400E' }}>
                      {t('page.final_document.gap_body')}
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
                  <p className="text-sm font-bold" style={{ color: '#15803D' }}>{t('page.final_document.signed_title')}</p>
                  <p className="font-mono text-[11px] font-medium" style={{ color: '#15803D', opacity: 0.7 }} title={sealHash ? `SHA-256: ${sealHash}` : undefined}>
                    {document.title} · {signedVersion}{sealHash ? ` · SHA-256: ${shortHash(sealHash)}` : ''}
                  </p>
                </div>
                <div className="flex flex-none flex-col gap-1">
                  {signedRecords.length === 0 && (
                    <p className="text-[11px] italic" style={{ color: '#15803D', opacity: 0.8 }} data-no-signatures>
                      {t('page.final_document.no_signature_records')}
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
                          {record.signer}{record.role ? ` · ${signerRoleLabel(record.role)}` : ''} · {MEANING_VERB_KEY[record.meaning] ? t(MEANING_VERB_KEY[record.meaning]!) : record.meaning}{when ? ` · ${when}` : ''}
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
                      ? <p className="mt-2 text-sm italic text-slate-400">{t('page.final_document.no_section_content')}</p>
                      : <FinalSectionBody html={html} />}
                  </section>
                )
              })}
              {document.sections.length === 0 && (
                <p className="text-sm italic text-slate-400">{t('page.final_document.no_sections')}</p>
              )}

              {/* Appendix — Compliance Summary (FR-A-030, FR-A-001d; AC-A-029, AC-A-013) */}
              <section className="mt-4 border-t border-slate-200 pt-6" data-compliance-summary>
                <h2 className="text-[20px] font-bold" style={{ breakAfter: 'avoid' }}>{t('page.final_document.appendix_title')}</h2>
                {complianceFailed && <p className="mt-2 text-sm text-red-700">{t('page.final_document.compliance_failed')}</p>}
                {!compliance && !complianceFailed && <p className="mt-2 font-mono text-xs text-slate-400">{t('page.final_document.compliance_loading')}</p>}
                {compliance && (
                  <>
                    <p className="mt-2 text-[13px] text-slate-600">
                      {compliance.checklistTemplateVersion != null
                        ? t('page.final_document.compliance_generated_version', { version: compliance.checklistTemplateVersion })
                        : t('page.final_document.compliance_generated')}
                    </p>

                    <h3 className="mt-5 text-[15px] font-bold text-slate-900">{t('page.final_document.frameworks_title')}</h3>
                    {compliance.frameworks.length === 0
                      ? <p className="mt-1 text-[13px] italic text-slate-500">{t('page.final_document.no_frameworks')}</p>
                      : (
                        <table className="mt-2 w-full border-collapse text-[12px]">
                          <thead>
                            <tr className="text-left text-slate-500">
                              <th className="border-b border-slate-200 py-1.5 pr-3 font-semibold">{t('page.final_document.col_framework')}</th>
                              <th className="border-b border-slate-200 py-1.5 pr-3 font-semibold">{t('page.final_document.col_version')}</th>
                              <th className="border-b border-slate-200 py-1.5 pr-3 font-semibold">{t('page.final_document.col_jurisdiction')}</th>
                              <th className="border-b border-slate-200 py-1.5 font-semibold">{t('page.final_document.col_reference')}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {compliance.frameworks.map(f => (
                              <tr key={f.name} className="align-top">
                                <td className="border-b border-slate-100 py-1.5 pr-3 font-semibold text-slate-900">{f.name}</td>
                                <td className="border-b border-slate-100 py-1.5 pr-3 text-slate-700">{f.version ?? '—'}</td>
                                <td className="border-b border-slate-100 py-1.5 pr-3 text-slate-700">{f.jurisdiction ?? '—'}</td>
                                <td className="break-all border-b border-slate-100 py-1.5 text-slate-700">
                                  {f.sourceUrl ?? (f.inRegistry ? '—' : t('page.final_document.not_in_registry'))}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}

                    <h3 className="mt-6 text-[15px] font-bold text-slate-900">{t('page.final_document.rules_title')}</h3>
                    {compliance.frameworks.map(f => (
                      <div key={f.name} className="mt-3" style={{ breakInside: 'avoid' }}>
                        <p className="text-[13px] font-semibold text-slate-800">{f.name}</p>
                        <ul className="mt-1 flex flex-col gap-1">
                          {f.rules.map((r, i) => {
                            const outcome = RULE_OUTCOME[r.status]
                            return (
                              <li key={i} className="flex items-start gap-3 text-[12px]">
                                <span className="min-w-0 flex-1 text-slate-800">{r.text}{r.mandatory ? '' : t('page.final_document.recommended_suffix')}</span>
                                <span className="flex-none font-semibold" style={{ color: outcome?.colour ?? '#475569' }}>{outcome ? t(outcome.labelKey) : r.status}</span>
                              </li>
                            )
                          })}
                        </ul>
                      </div>
                    ))}

                    <h3 className="mt-6 text-[15px] font-bold text-slate-900">{t('page.final_document.waived_title')}</h3>
                    {compliance.waivedMandatory.length === 0
                      ? <p className="mt-1 text-[13px] text-slate-600">{t('page.final_document.waived_none')}</p>
                      : (
                        <table className="mt-2 w-full border-collapse text-[12px]" data-waived-items>
                          <thead>
                            <tr className="text-left text-slate-500">
                              <th className="border-b border-slate-200 py-1.5 pr-3 font-semibold">{t('page.final_document.col_item')}</th>
                              <th className="border-b border-slate-200 py-1.5 pr-3 font-semibold">{t('page.final_document.col_framework')}</th>
                              <th className="border-b border-slate-200 py-1.5 pr-3 font-semibold">{t('page.final_document.col_waived_by')}</th>
                              <th className="border-b border-slate-200 py-1.5 font-semibold">{t('page.final_document.col_reason')}</th>
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

                    <h3 className="mt-6 text-[15px] font-bold text-slate-900">{t('page.final_document.removed_title')}</h3>
                    {(compliance.removedMandatory ?? []).length === 0
                      ? <p className="mt-1 text-[13px] text-slate-600">{t('page.final_document.removed_none')}</p>
                      : (
                        <table className="mt-2 w-full border-collapse text-[12px]" data-removed-items>
                          <thead>
                            <tr className="text-left text-slate-500">
                              <th className="border-b border-slate-200 py-1.5 pr-3 font-semibold">{t('page.final_document.col_item')}</th>
                              <th className="border-b border-slate-200 py-1.5 pr-3 font-semibold">{t('page.final_document.col_framework')}</th>
                              <th className="border-b border-slate-200 py-1.5 pr-3 font-semibold">{t('page.final_document.col_removed_by')}</th>
                              <th className="border-b border-slate-200 py-1.5 font-semibold">{t('page.final_document.col_reason')}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(compliance.removedMandatory ?? []).map((r, i) => (
                              <tr key={i} className="align-top">
                                <td className="border-b border-slate-100 py-1.5 pr-3 text-slate-900">{r.text}</td>
                                <td className="border-b border-slate-100 py-1.5 pr-3 text-slate-700">{r.framework}</td>
                                <td className="border-b border-slate-100 py-1.5 pr-3 text-slate-700">
                                  {r.removedBy ?? '—'}{r.removedAt ? <><br /><span className="text-[11px] text-slate-500">{formatUtc(r.removedAt)}</span></> : null}
                                </td>
                                <td className="border-b border-slate-100 py-1.5 text-slate-700">{r.reason ?? '—'}</td>
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
              activeSectionData ? t('page.final_document.provenance_section', { number: activeSectionData.number.replace(/^§/, ''), title: activeSectionData.title }) : null,
              isSigned ? t('page.final_document.provenance_read_only') : t('page.final_document.provenance_preview'),
              isSigned ? t('page.final_document.provenance_signed', { version: signedVersion }) : document.version,
              isSigned ? t('page.final_document.provenance_signatures', { count: signedRecords.length }) : null,
              isSigned && signedAtText ? t('page.final_document.provenance_locked', { when: signedAtText }) : null,
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
        title={t('page.final_document.audit_panel_title')}
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
