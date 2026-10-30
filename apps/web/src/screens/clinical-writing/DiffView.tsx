import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import type { PlatformUser } from '@platform/types'
import { documentsApi, projectsApi } from '../../api'
import { platformApi } from '../../platform/api/platformApi'
import { usePresenceSnapshot } from '../../hooks/usePresence'
import { StatusPill } from '../../components/ui'
import { useAuthStore, useDocumentStore, useProjectStore } from '../../store'
import { wordDiff, type DiffOp } from '../../panels/wordDiff'
import { SectionNavigator } from './SectionNavigator'
import { HtmlDiff } from './HtmlDiff'

// Presence avatar colours — same palette and hashing as DocumentEditor, so a
// user keeps their colour across the Editor and Version Diff tabs.
const AVATAR_PALETTE: Array<{ bg: string; fg: string }> = [
  { bg: '#DBEAFE', fg: '#1D4ED8' },
  { bg: '#F5F3FF', fg: '#7C3AED' },
  { bg: '#FEF3C7', fg: '#D97706' },
  { bg: '#D1FAE5', fg: '#065F46' },
  { bg: '#FEE2E2', fg: '#B91C1C' },
  { bg: '#E0E7FF', fg: '#3730A3' },
  { bg: '#FCE7F3', fg: '#9D174D' },
]

function hashString(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

const avatarColor = (userId: string) => AVATAR_PALETTE[hashString(userId) % AVATAR_PALETTE.length]!

function initialsFromName(name: string | null | undefined): string {
  if (!name) return '?'
  return name.trim().split(/\s+/).slice(0, 2).map(p => p[0]?.toUpperCase() ?? '').join('') || '?'
}

// Section HTML → plain text for the word diff (tags become spaces, entities decoded).
function htmlToText(html: string): string {
  const spaced = html.replace(/<[^>]*>/g, ' ')
  const decoded = new DOMParser().parseFromString(spaced, 'text/html').body.textContent ?? ''
  return decoded.replace(/\s+/g, ' ').trim()
}

// Same rule the restore worker uses for the version it creates (v0.N → v0.N+1).
function bumpVersion(v: string): string {
  const m = v.match(/^v(\d+)\.(\d+)$/)
  return m ? `v${m[1]}.${Number(m[2]) + 1}` : `${v}.1`
}

// Shown in the viewer's local time; the UTC time is on hover.
const fmtLocal = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'
const fmtUtc = (iso: string | null | undefined) =>
  iso
    ? `${new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })} UTC`
    : '—'

// How long to wait for the restore worker to create the new version before saying so.
const RESTORE_WAIT_MS = 60_000

type SectionDiff = {
  sectionId: string
  number: string
  title: string
  kind: 'changed' | 'added' | 'removed' | 'unchanged'
  ops: DiffOp[]
  added: number
  removed: number
  // Section HTML on each side, for the structure-preserving render (HtmlDiff).
  fromHtml: string
  toHtml: string
}

const sectionLabel = (number: string) => (number.startsWith('§') ? number : `§${number}`)

export function DiffView() {
  const { projectId, documentId } = useParams()
  const navigate                  = useNavigate()
  const qc                        = useQueryClient()
  const setActiveProject          = useProjectStore(s => s.setActiveProject)

  const diffVersions            = useDocumentStore(s => s.diffVersions)
  const selectedForRestore      = useDocumentStore(s => s.selectedForRestore)
  const toggleSectionForRestore = useDocumentStore(s => s.toggleSectionForRestore)
  const clearRestoreSelection   = useDocumentStore(s => s.clearRestoreSelection)
  const closeDiff               = useDocumentStore(s => s.closeDiff)
  const toggleDiffMode          = useDocumentStore(s => s.toggleDiffMode)
  const activeSection           = useDocumentStore(s => s.activeSection)
  const setActiveDocument       = useDocumentStore(s => s.setActiveDocument)

  const [reason, setReason] = useState('')

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

  // Restore runs in the background worker: after it is queued, the version list is polled
  // until the new version shows up (or RESTORE_WAIT_MS passes).
  const [restoreWait, setRestoreWait] = useState<{ sinceCount: number; startedAt: number; timedOut: boolean } | null>(null)

  const { data: versions = [], isLoading: versionsLoading } = useQuery({
    queryKey: ['versions', documentId],
    queryFn:  () => documentsApi.getVersions(documentId!),
    enabled:  !!documentId,
    refetchInterval: restoreWait && !restoreWait.timedOut ? 2_000 : false,
  })

  // Real presence on this document (same snapshot the Editor shows).
  const { data: presenceSnapshot } = usePresenceSnapshot(documentId ?? '', { pollMs: 15_000 })
  const currentUser = useAuthStore(s => s.user)
  const { data: platformUsers = [] } = useQuery<PlatformUser[]>({
    queryKey: ['platform-users'],
    queryFn:  () => platformApi.listUsers(),
    staleTime: 60_000,
  })
  const usersById = useMemo(() => new Map(platformUsers.map(u => [u.id, u])), [platformUsers])

  const presenceStack = useMemo(() => {
    if (!presenceSnapshot) return []
    const seen = new Set<string>()
    const out: Array<{ userId: string; name: string; initials: string; isCurrentUser: boolean; color: { bg: string; fg: string } }> = []
    for (const section of presenceSnapshot.sections) {
      for (const user of section.users) {
        if (user.status === 'ended' || seen.has(user.userId)) continue
        seen.add(user.userId)
        const name = usersById.get(user.userId)?.name ?? 'Unknown'
        out.push({ userId: user.userId, name, initials: initialsFromName(name), isCurrentUser: currentUser?.id === user.userId, color: avatarColor(user.userId) })
      }
    }
    return out
  }, [presenceSnapshot, usersById, currentUser])

  useEffect(() => {
    if (project) setActiveProject(project)
  }, [project, setActiveProject])

  // Push the loaded document into the store so TopNav's enriched breadcrumb
  // (Projects / Project / Clinical Writing / <title>) picks up the title on
  // the Version Diff tab the same way it does on the Editor tab.
  useEffect(() => {
    if (document) setActiveDocument(document)
  }, [document, setActiveDocument])

  // The pair being compared. "To" is the version picked in the Editor (default: the current
  // one); "from" is the picked older version (default: the one just before "to"). Versions
  // come newest-first. A pair left over from another document falls back to these defaults.
  const toRecord = useMemo(
    () => versions.find(v => v.versionNumber === diffVersions?.to) ?? versions.find(v => v.isCurrent) ?? versions[0] ?? null,
    [versions, diffVersions],
  )
  const olderVersions = useMemo(() => {
    const toIdx = toRecord ? versions.findIndex(v => v.id === toRecord.id) : -1
    return toIdx === -1 ? [] : versions.slice(toIdx + 1)
  }, [versions, toRecord])
  const fromRecord = useMemo(
    () => olderVersions.find(v => v.versionNumber === diffVersions?.from) ?? olderVersions[0] ?? null,
    [olderVersions, diffVersions],
  )
  const toVersion   = toRecord?.versionNumber ?? '—'
  const fromVersion = fromRecord?.versionNumber ?? '—'

  const { data: fromSections, isLoading: fromLoading, isError: fromFailed } = useQuery({
    queryKey: ['version-sections', documentId, fromRecord?.id],
    queryFn:  () => documentsApi.getVersionSections(documentId!, fromRecord!.id),
    enabled:  !!documentId && !!fromRecord,
    staleTime: Infinity,   // a stored version never changes
  })
  const { data: toSections, isLoading: toLoading, isError: toFailed } = useQuery({
    queryKey: ['version-sections', documentId, toRecord?.id],
    queryFn:  () => documentsApi.getVersionSections(documentId!, toRecord!.id),
    enabled:  !!documentId && !!toRecord,
    staleTime: Infinity,
  })

  // Section-by-section comparison, in the "to" version's order; sections only in "from" go last.
  const sectionDiffs = useMemo<SectionDiff[]>(() => {
    if (!fromSections || !toSections) return []
    const fromById = new Map(fromSections.sections.map(s => [s.sectionId, s]))
    const toIds = new Set(toSections.sections.map(s => s.sectionId))
    const out: SectionDiff[] = []
    for (const s of toSections.sections) {
      const prev = fromById.get(s.sectionId)
      const d = wordDiff(htmlToText(prev?.contentHtml ?? ''), htmlToText(s.contentHtml))
      const kind = !prev ? 'added' : d.added + d.removed > 0 ? 'changed' : 'unchanged'
      out.push({ sectionId: s.sectionId, number: s.sectionNumber, title: s.sectionTitle, kind, ops: d.ops, added: d.added, removed: d.removed, fromHtml: prev?.contentHtml ?? '', toHtml: s.contentHtml })
    }
    for (const s of fromSections.sections) {
      if (toIds.has(s.sectionId)) continue
      const d = wordDiff(htmlToText(s.contentHtml), '')
      out.push({ sectionId: s.sectionId, number: s.sectionNumber, title: s.sectionTitle, kind: 'removed', ops: d.ops, added: 0, removed: d.removed, fromHtml: s.contentHtml, toHtml: '' })
    }
    return out
  }, [fromSections, toSections])

  const changedDiffs   = sectionDiffs.filter(d => d.kind !== 'unchanged')
  const unchangedDiffs = sectionDiffs.filter(d => d.kind === 'unchanged')
  const wordsAdded     = changedDiffs.reduce((n, d) => n + d.added, 0)
  const wordsRemoved   = changedDiffs.reduce((n, d) => n + d.removed, 0)
  const diffById       = useMemo(() => new Map(sectionDiffs.map(d => [d.sectionId, d])), [sectionDiffs])

  // Picking a section in the navigator scrolls to its comparison.
  const diffPaneRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!activeSection) return
    diffPaneRef.current?.querySelector(`[data-diff-section="${CSS.escape(activeSection)}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }, [activeSection])

  // Version picker for the "Comparing <from> → <to>" label: any version older than "to".
  const [fromMenuOpen, setFromMenuOpen] = useState(false)
  const fromMenuRef = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!fromMenuOpen) return
    const onDown = (e: MouseEvent) => {
      if (fromMenuRef.current && !fromMenuRef.current.contains(e.target as Node)) setFromMenuOpen(false)
    }
    window.document.addEventListener('mousedown', onDown)
    return () => window.document.removeEventListener('mousedown', onDown)
  }, [fromMenuOpen])

  // The restore worker builds the new version on top of the current one.
  const currentVersionNumber = versions.find(v => v.isCurrent)?.versionNumber ?? versions[0]?.versionNumber ?? null
  const nextVersionLabel = currentVersionNumber ? bumpVersion(currentVersionNumber) : 'a new version'

  // Only sections that exist in the "from" version and differ can be restored from it.
  const restorable = (d: SectionDiff) => d.kind === 'changed' || d.kind === 'removed'
  const selectedHere = selectedForRestore.filter(id => {
    const d = diffById.get(id)
    return !!d && restorable(d)
  })

  const restoreMut = useMutation({
    mutationFn: () => documentsApi.restoreSections(documentId!, {
      sections: selectedHere.map(sectionId => ({ sectionId, fromVersionId: fromRecord!.id })),
      reason,
    }),
    onSuccess: () => {
      setRestoreWait({ sinceCount: versions.length, startedAt: Date.now(), timedOut: false })
    },
  })

  // The new version has appeared → open it in the Editor. No new version in time → say so.
  useEffect(() => {
    if (!restoreWait || restoreWait.timedOut) return
    if (versions.length > restoreWait.sinceCount) {
      setRestoreWait(null)
      qc.invalidateQueries({ queryKey: ['document', documentId] })
      clearRestoreSelection()
      closeDiff()
      setReason('')
      navigate(`/projects/${projectId}/clinical-writing/documents/${documentId}`)
      return
    }
    const left = restoreWait.startedAt + RESTORE_WAIT_MS - Date.now()
    const t = window.setTimeout(() => setRestoreWait(w => (w ? { ...w, timedOut: true } : w)), Math.max(0, left))
    return () => window.clearTimeout(t)
  }, [versions, restoreWait, qc, documentId, projectId, navigate, clearRestoreSelection, closeDiff])
  const restoring = restoreMut.isPending || (!!restoreWait && !restoreWait.timedOut)

  const handleExitDiff = () => {
    closeDiff()
    navigate(`/projects/${projectId}/clinical-writing/documents/${documentId}`)
  }

  const canSubmit = !!fromRecord && selectedHere.length > 0 && reason.trim().length > 0 && !restoring
  const cancelRestore = () => { clearRestoreSelection(); setReason(''); setRestoreWait(null) }

  if (!document) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="font-mono text-sm text-slate-400">Loading document…</p>
      </div>
    )
  }

  const toAuthor = toRecord ? (usersById.get(toRecord.createdBy)?.name ?? toRecord.createdBy) : null
  const comparing = fromLoading || toLoading || versionsLoading
  const compareFailed = fromFailed || toFailed

  return (
    <div className="flex h-full flex-col" data-screen="diff-view">

      {/* ============ Document header ============ */}
      <div
        className="flex flex-none flex-col gap-2 border-b border-slate-200 bg-white px-6 pt-3"
        style={{ position: 'relative', zIndex: 6 }}
      >
        {/* Breadcrumb moved to TopNav (same cleanup as DocumentEditor —
            TopNav shows Projects / Project / Clinical Writing / <doc title>
            on all /documents/:id/* routes). */}

        {/* Title row */}
        <div className="flex h-14 items-center justify-between gap-6">
          <div className="flex min-w-0 items-center gap-3">
            <h1 className="truncate text-base font-bold tracking-tight text-slate-900">{document.title}</h1>
            <span className="flex-none"><StatusPill status={document.status} size="sm" /></span>

            {/* Version chip — active diff state */}
            <button
              type="button"
              onClick={handleExitDiff}
              title="Exit diff view"
              data-version-chip-active
              className="flex flex-none items-center gap-2 rounded-md transition-colors hover:bg-blue-100"
              style={{ border: '1px solid #2563EB', backgroundColor: '#EFF6FF', padding: '5px 9px' }}
            >
              <span className="font-mono text-[11px] font-medium" style={{ color: '#2563EB' }}>{toVersion}{toRecord?.label ? ` · ${toRecord.label}` : ''}</span>
              <span className="text-xs font-bold" style={{ color: '#2563EB' }}>×</span>
            </button>

            {/* Comparing label — fromVersion is a dropdown so the writer can
                compare against any older version, not just the previous one. */}
            <span className="flex items-center gap-1 whitespace-nowrap font-mono text-[11px] font-medium text-slate-500">
              Comparing
              <span className="relative" ref={fromMenuRef}>
                <button
                  type="button"
                  onClick={() => setFromMenuOpen(v => !v)}
                  data-action="pick-from-version"
                  title="Compare against a different version"
                  className="flex items-center gap-0.5 rounded border border-slate-300 bg-white px-1.5 py-0.5 font-mono text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                >
                  {fromVersion}
                  <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 4.5 6 7.5 9 4.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </button>
                {fromMenuOpen && (
                  <div
                    className="absolute left-0 top-full z-30 mt-1 flex w-64 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white font-sans shadow-xl"
                    role="listbox"
                    data-version-picker
                  >
                    <p className="flex-none border-b border-slate-100 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                      Compare {toVersion} with
                    </p>
                    {olderVersions.length === 0 && (
                      <p className="px-3 py-2 text-[11px] italic text-slate-400">No older versions yet.</p>
                    )}
                    <div className="max-h-72 overflow-y-auto py-1">
                      {olderVersions.map(v => {
                        const selected = v.id === fromRecord?.id
                        return (
                          <button
                            key={v.id}
                            type="button"
                            role="option"
                            aria-selected={selected}
                            title={fmtUtc(v.createdAt)}
                            onClick={() => {
                              toggleDiffMode(v.versionNumber, toVersion)
                              setFromMenuOpen(false)
                            }}
                            className={`flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-slate-50 ${selected ? 'bg-blue-50' : ''}`}
                          >
                            <span className={`w-12 flex-none font-mono text-[12px] font-semibold ${selected ? 'text-blue-700' : 'text-slate-800'}`}>{v.versionNumber}</span>
                            <span className="min-w-0 flex-1 truncate text-[11px] text-slate-500">{fmtLocal(v.createdAt)}</span>
                            {v.label && (
                              <span className="flex-none rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">{v.label}</span>
                            )}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}
              </span>
              → {toVersion}
            </span>
          </div>

          <div className="flex flex-none items-center gap-3.5">
            {toRecord && (
              <div className="flex items-center gap-1.5 text-xs text-slate-500" title={fmtUtc(toRecord.createdAt)}>
                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: '#16A34A' }} />
                {toVersion} saved {fmtLocal(toRecord.createdAt)}
              </div>
            )}

            {presenceStack.length > 0 && (
              <div className="flex flex-none items-center">
                {presenceStack.slice(0, 5).map((p, i) => (
                  <div
                    key={p.userId}
                    title={p.isCurrentUser ? `${p.name} (you)` : p.name}
                    className="flex h-6 w-6 flex-none items-center justify-center rounded-full font-mono text-[10px] font-bold"
                    style={{
                      backgroundColor: p.color.bg,
                      color: p.color.fg,
                      boxShadow: p.isCurrentUser ? '0 0 0 2px #FFFFFF, 0 0 0 4px #2563EB' : '0 0 0 2px #FFFFFF',
                      marginLeft: i === 0 ? 0 : -6,
                      zIndex: presenceStack.length - i,
                    }}
                  >
                    {p.initials}
                  </div>
                ))}
              </div>
            )}

            <span className="h-5 w-px" style={{ backgroundColor: '#E2E8F0' }} />
            <span className="flex-none text-xs text-slate-500">
              {presenceStack.length === 0 ? 'Only you' : `${presenceStack.length} active`}
            </span>

            <button
              type="button"
              onClick={() => navigate(`/projects/${projectId}/clinical-writing/documents/${documentId}`)}
              title="DiffView is read-only — go back to Editor to make changes"
              className="rounded-md border border-slate-200 bg-white px-3.5 py-2 text-[13px] font-semibold text-slate-900 hover:bg-slate-50 transition-colors"
            >
              Back to Editor
            </button>
            <button
              type="button"
              onClick={() => navigate(`/projects/${projectId}/clinical-writing/documents/${documentId}?submit=1`)}
              title="Opens the Submit-for-Review panel on the Editor"
              className="rounded-md bg-blue-600 px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-blue-700 transition-colors"
            >
              Submit for review
            </button>
          </div>
        </div>
      </div>

      {/* ============ Body ============ */}
      <div className="flex flex-1 min-h-0">

        <SectionNavigator sections={document.sections} />

        {/* Diff pane */}
        <div className="flex min-w-0 flex-1 flex-col bg-white">

          {/* Diff toolbar */}
          <div
            className="flex h-10 flex-none items-center gap-4 border-b border-slate-200 px-8"
            style={{ backgroundColor: '#F8FAFC' }}
            data-diff-toolbar
          >
            <p className="font-mono text-[10px] font-medium uppercase tracking-widest text-slate-500">Diff view</p>
            <span className="h-4 w-px bg-slate-200" />
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: '#16A34A' }} />
              <span className="text-[11px] text-slate-500">Added</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: '#DC2626' }} />
              <span className="text-[11px] text-slate-500">Removed</span>
            </div>
            <div className="flex-1" />
            {!comparing && fromRecord && (
              <span className="whitespace-nowrap font-mono text-[11px] text-slate-500" data-diff-summary>
                {changedDiffs.length} section{changedDiffs.length === 1 ? '' : 's'} changed · +{wordsAdded} / −{wordsRemoved} words
              </span>
            )}
            <button
              type="button"
              onClick={handleExitDiff}
              className="whitespace-nowrap text-xs font-semibold text-blue-600 hover:text-blue-700 transition-colors"
            >
              Exit diff view
            </button>
          </div>

          {/* Diff content */}
          <div ref={diffPaneRef} className="flex-1 overflow-y-auto px-12 py-8">
            <div className="flex max-w-[760px] flex-col">
              {!versionsLoading && !fromRecord && (
                <p className="text-sm text-slate-500" data-diff-empty>
                  {toRecord ? `${toVersion} is the only version of this document, so there is nothing to compare yet.` : 'This document has no saved versions yet.'}
                </p>
              )}
              {fromRecord && comparing && <p className="font-mono text-sm text-slate-400">Comparing {fromVersion} → {toVersion}…</p>}
              {fromRecord && compareFailed && <p className="text-sm text-red-700">Could not load the versions to compare. Try again.</p>}

              {fromRecord && !comparing && !compareFailed && changedDiffs.length === 0 && (
                <p className="text-sm text-slate-500" data-diff-empty>No differences between {fromVersion} and {toVersion}.</p>
              )}

              {!comparing && !compareFailed && changedDiffs.map((d, idx) => {
                const isSelected = selectedForRestore.includes(d.sectionId)
                const canRestore = restorable(d)
                return (
                  <div key={d.sectionId} className={idx === 0 ? '' : 'mt-7'} data-diff-section={d.sectionId}>
                    <div className="flex items-center gap-3 rounded-md px-3 py-2" style={{ backgroundColor: d.kind === 'removed' ? '#FEF2F2' : '#F0FDF4' }}>
                      <h4 className="min-w-0 flex-1 text-[15px] font-bold text-slate-900">
                        {sectionLabel(d.number)} {d.title}
                      </h4>
                      <span
                        className="flex-none rounded font-mono text-[9px] font-medium tracking-wide text-slate-500"
                        style={{ backgroundColor: '#F1F5F9', padding: '2px 6px' }}
                      >
                        {d.kind === 'added' ? `new in ${toVersion}` : d.kind === 'removed' ? `removed in ${toVersion}` : `+${d.added} / −${d.removed} words`}
                      </span>
                      {canRestore && (
                        <>
                          <button
                            type="button"
                            onClick={() => toggleSectionForRestore(d.sectionId)}
                            title={isSelected ? 'Deselect' : 'Select for restore'}
                            data-restore-checkbox
                            data-checked={isSelected || undefined}
                            className="flex h-4 w-4 flex-none cursor-pointer items-center justify-center rounded"
                            style={{
                              border: `1px solid ${isSelected ? '#2563EB' : '#CBD5E1'}`,
                              backgroundColor: isSelected ? '#2563EB' : '#FFFFFF',
                            }}
                          >
                            {isSelected && (
                              <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                                <polyline points="2,6.4 4.6,9 10,3.2" stroke="#FFFFFF" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => toggleSectionForRestore(d.sectionId)}
                            data-restore-link
                            className="flex-none whitespace-nowrap text-xs font-semibold transition-colors"
                            style={{ color: isSelected ? '#15803D' : '#2563EB' }}
                          >
                            {isSelected ? 'Selected for restore ✓' : `Restore ${sectionLabel(d.number)} from ${fromVersion} →`}
                          </button>
                        </>
                      )}
                    </div>
                    {d.ops.length === 0
                      ? <p className="mt-3 text-sm italic text-slate-400">(empty)</p>
                      : <HtmlDiff fromHtml={d.fromHtml} toHtml={d.toHtml} />}
                  </div>
                )
              })}

              {/* Unchanged sections, dimmed */}
              {!comparing && !compareFailed && unchangedDiffs.length > 0 && (
                <div className="mt-7 flex flex-col gap-1" style={{ opacity: 0.5 }} data-diff-unchanged>
                  <p className="text-xs font-semibold text-slate-500">
                    {unchangedDiffs.length} unchanged section{unchangedDiffs.length === 1 ? '' : 's'}
                  </p>
                  {unchangedDiffs.map(d => (
                    <p key={d.sectionId} className="text-[13px] text-slate-500" data-diff-section={d.sectionId}>
                      {sectionLabel(d.number)} {d.title}
                    </p>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Provenance bar */}
          <div
            className="flex h-10 flex-none items-center overflow-hidden truncate whitespace-nowrap border-t border-slate-200 px-5 text-xs text-slate-500"
            style={{ backgroundColor: '#F8FAFC' }}
          >
            Diff: {fromVersion} → {toVersion}
            {fromRecord && !comparing && ` · ${changedDiffs.length} section${changedDiffs.length === 1 ? '' : 's'} changed`}
            {toRecord && <span title={fmtUtc(toRecord.createdAt)}>&nbsp;· {toVersion} created by {toAuthor} · {fmtLocal(toRecord.createdAt)}</span>}
          </div>
        </div>

        {/* Restore panel — beside the diff, like the Editor's right panels; open while sections are ticked. */}
        {selectedHere.length > 0 && (
          <div className="flex w-[360px] max-w-full flex-none flex-col border-l border-slate-200 bg-white" data-restore-panel>
            <div className="flex h-12 flex-none items-center justify-between border-b border-slate-200 px-4">
              <div className="flex items-center gap-2">
                <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="#2563EB" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9" /><polyline points="2.5,2.5 2.5,5.5 5.5,5.5" />
                </svg>
                <h2 className="text-[14px] font-bold text-slate-900">Restore sections</h2>
              </div>
              <button
                type="button"
                onClick={cancelRestore}
                disabled={restoring}
                aria-label="Close and clear the selection"
                className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><line x1="3" y1="3" x2="9" y2="9" /><line x1="9" y1="3" x2="3" y2="9" /></svg>
              </button>
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
              <div>
                <p className="mb-2 text-[12px] font-semibold text-slate-700">
                  {selectedHere.length} section{selectedHere.length === 1 ? '' : 's'} selected · from {fromVersion}
                </p>
                <ul className="flex flex-col gap-1.5" data-restore-list>
                  {selectedHere.map(id => {
                    const d = diffById.get(id)
                    return (
                      <li key={id} className="flex items-start gap-2 rounded-md border border-slate-200 px-2.5 py-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-[13px] font-semibold leading-snug text-slate-900">
                            {sectionLabel(d?.number ?? id)} {d?.title ?? ''}
                          </p>
                          <p className="mt-0.5 font-mono text-[10px] text-slate-500">
                            {d?.kind === 'removed' ? `removed in ${toVersion} — will be brought back` : `+${d?.added ?? 0} / −${d?.removed ?? 0} words will be undone`}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => toggleSectionForRestore(id)}
                          disabled={restoring}
                          aria-label={`Remove ${sectionLabel(d?.number ?? id)} from the restore`}
                          title="Remove from the restore"
                          className="flex-none rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
                        >
                          <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><line x1="3" y1="3" x2="9" y2="9" /><line x1="9" y1="3" x2="3" y2="9" /></svg>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="restore-reason" className="text-[12px] font-semibold text-slate-700">
                  Reason <span className="text-red-600" aria-hidden="true">*</span>
                </label>
                <textarea
                  id="restore-reason"
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                  placeholder="Why are you restoring these sections?"
                  rows={3}
                  required
                  aria-required="true"
                  disabled={restoring}
                  className="resize-y rounded-md border border-slate-200 bg-white px-2.5 py-2 text-[13px] text-slate-900 outline-none focus:border-blue-600 focus:shadow-focus disabled:bg-slate-50"
                />
              </div>

              {restoreMut.isError ? (
                <p className="text-[12px] font-semibold text-red-700" data-restore-note>
                  Could not start the restore: {(restoreMut.error as { body?: { message?: string; error?: string } } | null)?.body?.message ?? (restoreMut.error as { body?: { error?: string } } | null)?.body?.error ?? (restoreMut.error as Error | null)?.message ?? 'unknown error'}
                </p>
              ) : restoreWait?.timedOut ? (
                <p className="text-[12px] font-semibold text-amber-700" data-restore-note>
                  The restore is queued, but {nextVersionLabel} hasn't been created yet — the background worker may not be running. It will appear in the version list once the worker processes it.
                </p>
              ) : (
                <p className="text-[11px] leading-relaxed text-slate-500" data-restore-note>
                  {restoring
                    ? `Restore queued — waiting for ${nextVersionLabel} to be created…`
                    : `A new ${nextVersionLabel} will be created with these sections as they were in ${fromVersion}. ${fromVersion} and ${toVersion} remain permanently in version history.`}
                </p>
              )}
            </div>

            <div className="flex flex-none items-center justify-end gap-2 border-t border-slate-200 px-4 py-3">
              <button
                type="button"
                onClick={cancelRestore}
                disabled={restoring}
                className="rounded-md border border-slate-200 bg-white px-3.5 py-2 text-[13px] font-semibold text-slate-900 hover:bg-slate-100 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => restoreMut.mutate()}
                disabled={!canSubmit}
                title={!reason.trim() ? 'Enter a reason for the restore first' : undefined}
                className="whitespace-nowrap rounded-md bg-blue-600 px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-blue-700 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                data-restore-submit
              >
                {restoring ? `Creating ${nextVersionLabel}…` : `Create ${nextVersionLabel} →`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
