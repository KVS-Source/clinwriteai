import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import type { PublicationAuthor, RACIRole } from '@platform/types'
import { publicationsApi } from '../../api'
import { useAuthorStore } from '../../modules/scientific-writing/store'

// --- Static config ---

const CRITERIA_LABELS = [
  '1. Substantial contributions to the conception or design of the work, or the acquisition, analysis or interpretation of data',
  '2. Drafting the work or critically revising it for important intellectual content',
  '3. Final approval of the version to be published',
  '4. Agreement to be accountable for all aspects of the work',
]

const RACI_TONE: Record<RACIRole, { bg: string; fg: string }> = {
  R: { bg: '#EFF6FF', fg: '#1D4ED8' },
  A: { bg: '#F0FDF4', fg: '#15803D' },
  C: { bg: '#F1F5F9', fg: '#475569' },
  I: { bg: '#F1F5F9', fg: '#94A3B8' },
}

const LOGGED_IN_USER = 'Dr Sarah Chen'
const CANONICAL_PUB  = 'pub-001'

// --- Helpers ---

function formatCoiLabel(a: PublicationAuthor): string {
  if (a.coiStatus === 'submitted' && a.coiSubmittedAt) {
    const d = new Date(a.coiSubmittedAt)
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
    return `Submitted ${d.getUTCDate()} ${months[d.getUTCMonth()]}`
  }
  if (a.coiStatus === 'pending') return 'Pending — reminder sent'
  return 'Not required'
}

function icmjeMetCount(a: PublicationAuthor): number {
  return a.icmjeCriteria.filter(c => c.met).length
}

// --- Subcomponents ---

interface AuthorRowProps {
  author:            PublicationAuthor
  isOpen:            boolean
  onToggle:          () => void
  onToggleCriterion: (idx: number, currentMet: boolean) => void
  onAcknowledge:     () => void
  onRemind:          () => void
  onRequestConfirm:  () => void
  isAcknowledged:    boolean
}

function AuthorRow({ author, isOpen, onToggle, onToggleCriterion, onAcknowledge, onRemind, onRequestConfirm, isAcknowledged }: AuthorRowProps) {
  const raci    = RACI_TONE[author.raci] ?? RACI_TONE.C
  const metCount = icmjeMetCount(author)
  const allMet   = metCount === 4
  const missing  = author.icmjeCriteria.filter(c => !c.met).map(c => c.criterionIndex + 1)
  const softGate = !allMet && !isAcknowledged

  const icmjeBg = allMet ? '#F0FDF4' : '#FFFBEB'
  const icmjeFg = allMet ? '#15803D' : '#B45309'
  const icmjeLabel = allMet ? `${metCount}/4 criteria met ✓` : `⚠ ${metCount}/4 criteria`

  return (
    <>
      <tr
        data-author-row={author.id}
        data-open={isOpen || undefined}
        style={{ backgroundColor: isOpen ? '#F8FAFC' : '#FFFFFF', borderBottom: '1px solid #E2E8F0' }}
      >
        <td style={{ padding: '14px 12px' }}>
          <div className="flex items-center gap-2.5">
            <span
              className="flex flex-none items-center justify-center rounded-full font-mono font-bold"
              style={{ width: 28, height: 28, fontSize: 11, backgroundColor: author.avatarBg, color: author.avatarFg }}
            >
              {author.initials}
            </span>
            <div className="flex min-w-0 flex-col">
              <p className="text-[13px] font-semibold">{author.name}</p>
              {author.isExternal && (
                <span
                  className="mt-0.5 self-start rounded font-mono text-[9px] font-medium uppercase tracking-widest"
                  style={{ backgroundColor: '#F1F5F9', color: '#475569', padding: '1px 6px' }}
                  data-external-badge
                >
                  External
                </span>
              )}
            </div>
          </div>
        </td>
        <td className="text-xs" style={{ padding: '14px 12px', color: '#64748B' }}>{author.role}</td>
        <td style={{ padding: '14px 12px' }}>
          <span
            className="flex flex-none items-center justify-center rounded font-mono font-bold"
            style={{ width: 20, height: 20, fontSize: 10, backgroundColor: raci.bg, color: raci.fg }}
            data-raci-badge={author.raci}
          >
            {author.raci}
          </span>
        </td>
        <td style={{ padding: '14px 12px' }}>
          <span
            className="whitespace-nowrap rounded-full text-[11px] font-semibold"
            style={{ padding: '4px 10px', backgroundColor: icmjeBg, color: icmjeFg }}
            data-icmje-pill={author.id}
          >
            {icmjeLabel}
          </span>
        </td>
        <td style={{ padding: '14px 12px' }}>
          <span
            className="whitespace-nowrap rounded-full text-[11px] font-semibold"
            style={{
              padding: '4px 10px',
              backgroundColor: author.coiStatus === 'submitted' ? '#F0FDF4' : '#FFFBEB',
              color:           author.coiStatus === 'submitted' ? '#15803D' : '#B45309',
            }}
            data-coi-pill
          >
            {formatCoiLabel(author)}
          </span>
        </td>
        <td className="text-xs font-semibold" style={{ padding: '14px 12px', color: '#15803D' }} data-debarment-pill>
          Clear ✓
        </td>
        <td style={{ padding: '14px 12px' }}>
          <div className="flex items-center gap-2">
            <button type="button" className="text-xs font-semibold" style={{ color: '#0F766E' }}>View</button>
            {author.isExternal ? (
              <>
                <button
                  type="button"
                  onClick={onRemind}
                  data-remind={author.id}
                  className="text-xs font-semibold"
                  style={{ color: '#0F766E' }}
                >
                  Remind
                </button>
                <button type="button" className="text-xs font-semibold text-slate-500">Remove</button>
              </>
            ) : (
              <button type="button" className="text-xs font-semibold" style={{ color: '#0F766E' }}>Edit</button>
            )}
            <button
              type="button"
              onClick={onToggle}
              data-toggle-row={author.id}
              className="flex h-6 w-6 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100"
              aria-label="Toggle criteria"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" style={{ transform: isOpen ? 'rotate(0)' : 'rotate(-90deg)' }}>
                <polygon points="1,3 9,3 5,8" fill="currentColor" />
              </svg>
            </button>
          </div>
        </td>
      </tr>
      {isOpen && (
        <tr data-expanded-row={author.id} style={{ backgroundColor: '#F8FAFC', borderBottom: '1px solid #E2E8F0' }}>
          <td colSpan={7} style={{ padding: '4px 20px 20px' }}>
            <div className="flex flex-col gap-3">
              <p className="font-mono text-[10px] font-medium uppercase tracking-widest" style={{ color: '#64748B' }}>
                ICMJE criteria — required for authorship
              </p>
              <div className="flex flex-col gap-2">
                {CRITERIA_LABELS.map((label, i) => {
                  const criterion = author.icmjeCriteria.find(c => c.criterionIndex === i)
                  const met       = criterion?.met ?? false
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => onToggleCriterion(i, met)}
                      data-criterion={i}
                      data-criterion-met={met || undefined}
                      className="flex items-start gap-3 rounded-md bg-white text-left transition-colors hover:bg-slate-50"
                      style={{ padding: '10px 12px', border: '1px solid #E2E8F0' }}
                    >
                      <span
                        className="mt-0.5 flex flex-none items-center justify-center rounded font-extrabold text-white"
                        style={{
                          width:  18, height: 18, fontSize: 11,
                          backgroundColor: met ? '#0D9488' : '#FFFFFF',
                          border:          `1px solid ${met ? '#0D9488' : '#CBD5E1'}`,
                        }}
                      >
                        {met ? '✓' : ''}
                      </span>
                      <span className="min-w-0 flex-1 text-[13px] leading-relaxed">{label}</span>
                      <span
                        className="flex-none text-[11px] font-semibold"
                        style={{ color: met ? '#15803D' : '#B45309' }}
                      >
                        {met ? 'Met' : 'Not confirmed'}
                      </span>
                    </button>
                  )
                })}
              </div>

              {softGate && (
                <div
                  className="flex flex-col gap-2.5"
                  style={{
                    backgroundColor: '#FFFBEB',
                    border:          '1px solid #FDE68A',
                    borderLeft:      '3px solid #D97706',
                    borderRadius:    8,
                    padding:         16,
                  }}
                  data-soft-gate={author.id}
                >
                  <div className="flex items-start gap-3">
                    <span
                      className="flex flex-none items-center justify-center rounded font-extrabold text-white"
                      style={{ width: 18, height: 18, fontSize: 11, backgroundColor: '#D97706' }}
                    >!</span>
                    <p className="text-[13px] leading-relaxed" style={{ color: '#1E293B' }}>
                      {author.name} has not confirmed ICMJE criteria {missing.join(' and ')}. The manuscript can proceed, but a warning is logged to the audit trail and the final output package. The publication manager must acknowledge before stage 5.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-3" style={{ paddingLeft: 30 }}>
                    <button
                      type="button"
                      onClick={onAcknowledge}
                      data-acknowledge={author.id}
                      className="rounded-md text-xs font-semibold text-white"
                      style={{ padding: '8px 12px', backgroundColor: '#D97706' }}
                    >
                      Acknowledge & proceed
                    </button>
                    <button
                      type="button"
                      onClick={onRequestConfirm}
                      className="text-xs font-semibold"
                      style={{ color: '#0F766E' }}
                    >
                      Request confirmation from author
                    </button>
                  </div>
                </div>
              )}

              {isAcknowledged && !allMet && (
                <div
                  className="flex items-start gap-3"
                  style={{
                    backgroundColor: '#F0FDF4',
                    border:          '1px solid #BBF7D0',
                    borderLeft:      '3px solid #15803D',
                    borderRadius:    8,
                    padding:         14,
                  }}
                  data-acknowledged-card={author.id}
                >
                  <span
                    className="flex flex-none items-center justify-center rounded font-extrabold text-white"
                    style={{ width: 18, height: 18, fontSize: 11, backgroundColor: '#15803D' }}
                  >✓</span>
                  <div className="flex flex-col gap-1">
                    <p className="text-[13px] font-bold" style={{ color: '#15803D' }}>Soft gate acknowledged</p>
                    <p className="text-xs" style={{ color: '#15803D' }}>
                      Acknowledged by {LOGGED_IN_USER}. The outstanding ICMJE criteria are logged to the audit trail and the final output package.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

// --- Sidebar ---

interface SidebarProps {
  authors:         PublicationAuthor[]
  acknowledged:    Record<string, boolean>
  lastDebarment:   string
  isChecking:      boolean
  onRunDebarment:  () => void
}

function Sidebar({ authors, acknowledged, lastDebarment, isChecking, onRunDebarment }: SidebarProps) {
  const raciCounts = useMemo(() => {
    const counts: Record<string, number> = { R: 0, A: 0, C: 0, I: 0 }
    for (const a of authors) counts[a.raci] = (counts[a.raci] ?? 0) + 1
    return counts
  }, [authors])

  const allMet         = authors.every(a => icmjeMetCount(a) === 4)
  const pendingCount   = authors.filter(a => icmjeMetCount(a) < 4).length
  const pendingAckList = authors.filter(a => icmjeMetCount(a) < 4 && !acknowledged[a.id])

  let gateState: 'warn' | 'ack' | 'clear'
  let gateLabel: string
  let gateBg:    string
  let gateFg:    string
  if (allMet) {
    gateState = 'clear'; gateLabel = 'Clear to proceed'
    gateBg = '#F0FDF4';  gateFg = '#15803D'
  } else if (pendingAckList.length === 0) {
    gateState = 'ack';  gateLabel = 'Warning acknowledged'
    gateBg = '#F1F5F9'; gateFg = '#475569'
  } else {
    gateState = 'warn'; gateLabel = 'Warning — acknowledgement required'
    gateBg = '#FFFBEB'; gateFg = '#B45309'
  }

  return (
    <aside className="flex w-[280px] flex-none flex-col gap-3" data-author-sidebar>
      {/* RACI summary */}
      <div className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-4" data-sidebar-card="raci">
        <p className="text-[13px] font-bold">RACI summary</p>
        {(['R', 'A', 'C', 'I'] as RACIRole[]).map(role => (
          <div key={role} className="flex items-center justify-between border-b py-1.5" style={{ borderColor: '#F1F5F9' }}>
            <span className="text-xs" style={{ color: '#64748B' }}>{role}</span>
            <span className="text-xs font-bold">{raciCounts[role] ?? 0} assigned</span>
          </div>
        ))}
      </div>

      {/* Debarment */}
      <div className="flex flex-col gap-1.5 rounded-lg border border-slate-200 bg-white p-4" data-sidebar-card="debarment">
        <p className="text-[13px] font-bold">Debarment check</p>
        <p className="text-xs" style={{ color: '#64748B' }}>Last run · {lastDebarment}</p>
        <p className="text-xs font-semibold" style={{ color: '#15803D' }}>4 checked · 0 matches</p>
        <p className="font-mono text-[10px]" style={{ color: '#94A3B8' }}>Sources: FDA · OIG</p>
        <button
          type="button"
          onClick={onRunDebarment}
          disabled={isChecking}
          data-run-again
          className="mt-1 self-start text-xs font-semibold"
          style={{ color: '#0F766E' }}
        >
          {isChecking ? 'Checking…' : 'Run check again'}
        </button>
      </div>

      {/* ICMJE compliance */}
      <div className="flex flex-col gap-1.5 rounded-lg border border-slate-200 bg-white p-4" data-sidebar-card="icmje">
        <p className="text-[13px] font-bold">ICMJE compliance</p>
        <p className="text-xs" style={{ color: '#64748B' }}>
          {authors.length - pendingCount}/{authors.length} authors all criteria met
        </p>
        <p className="text-xs" style={{ color: pendingCount > 0 ? '#B45309' : '#94A3B8' }}>
          {pendingCount > 0 ? `${pendingCount} pending confirmation` : 'No outstanding criteria'}
        </p>
        <div className="mt-2 flex items-center gap-2">
          <span className="text-[11px]" style={{ color: '#64748B' }}>Stage 4 gate</span>
          <span
            className="rounded-full text-[11px] font-semibold"
            style={{ padding: '3px 9px', backgroundColor: gateBg, color: gateFg }}
            data-gate-pill={gateState}
          >
            {gateLabel}
          </span>
        </div>
      </div>
    </aside>
  )
}

// --- Main screen ---

export function AuthorManagement() {
  const { publicationId } = useParams()
  const pubId             = publicationId ?? CANONICAL_PUB

  const openAuthorId      = useAuthorStore(s => s.expandedAuthorId)
  const setExpandedAuthor = useAuthorStore(s => s.setExpandedAuthor)
  const setAuthorsInStore = useAuthorStore(s => s.setAuthors)

  const qc = useQueryClient()

  const [acknowledged,    setAcknowledged]   = useState<Record<string, boolean>>({})
  const [criterionState, setCriterionState]  = useState<Record<string, boolean[]>>({})
  const [isChecking,      setIsChecking]     = useState(false)
  const [lastDebarment,   setLastDebarment]  = useState('28 Oct 2026 · 16:47 UTC')
  const [toast,           setToast]          = useState<string | null>(null)

  const { data: fetchedAuthors = [] } = useQuery({
    queryKey: ['authors', pubId],
    queryFn:  () => publicationsApi.getAuthors(pubId),
  })

  // Merge fetched authors with local criterion overrides (allows toggle without waiting for API)
  const authors: PublicationAuthor[] = useMemo(() => {
    return fetchedAuthors.map(a => {
      const overrides = criterionState[a.id]
      if (!overrides) return a
      return {
        ...a,
        icmjeCriteria: a.icmjeCriteria.map((c, i) =>
          overrides[i] === undefined
            ? c
            : { ...c, met: overrides[i], confirmedBy: overrides[i] ? LOGGED_IN_USER : null, confirmedAt: overrides[i] ? new Date().toISOString() : null }),
      }
    })
  }, [fetchedAuthors, criterionState])

  useEffect(() => {
    if (fetchedAuthors.length > 0) setAuthorsInStore(fetchedAuthors)
  }, [fetchedAuthors, setAuthorsInStore])

  // Default openAuthorId to Hartley
  useEffect(() => {
    if (openAuthorId === null && authors.some(a => a.id === 'author-jh')) {
      setExpandedAuthor('author-jh')
    }
  }, [openAuthorId, authors, setExpandedAuthor])

  // Toast auto-clear
  useEffect(() => {
    if (!toast) return
    const t = window.setTimeout(() => setToast(null), 3000)
    return () => window.clearTimeout(t)
  }, [toast])

  const toggleICMJEMut = useMutation({
    mutationFn: (args: { authorId: string; idx: number; met: boolean }) =>
      publicationsApi.toggleICMJE(pubId, args.authorId, { criterionIndex: args.idx, met: args.met, confirmedBy: LOGGED_IN_USER }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['authors', pubId] }),
  })

  const acknowledgeMut = useMutation({
    mutationFn: (authorId: string) =>
      publicationsApi.acknowledgeICMJE(pubId, authorId, { acknowledgedBy: LOGGED_IN_USER }),
    onSuccess: () => setToast(`Acknowledged by ${LOGGED_IN_USER}. The outstanding ICMJE criteria are logged to the audit trail and the final output package.`),
  })

  const remindMut = useMutation({
    mutationFn: (authorId: string) => publicationsApi.remindAuthor(pubId, authorId),
    onSuccess: (_data, authorId) => {
      const author = authors.find(a => a.id === authorId)
      setToast(`Reminder sent to ${author?.name ?? 'author'} · ${new Date().toLocaleString('en-GB')}.`)
    },
  })

  const debarmentMut = useMutation({
    mutationFn: () => publicationsApi.runPublicationDebarmentCheck(pubId),
    onMutate:   () => setIsChecking(true),
    onSuccess:  (data) => {
      setIsChecking(false)
      setLastDebarment(new Date(data.checkedAt).toLocaleString('en-GB'))
      setToast(`Debarment check complete — ${data.authorsChecked} authors checked, ${data.matches} matches. Sources: ${data.sources.join(', ')}.`)
    },
    onError: () => setIsChecking(false),
  })

  const handleToggleRow = (id: string) => setExpandedAuthor(openAuthorId === id ? null : id)

  const handleToggleCriterion = (authorId: string, idx: number, currentMet: boolean) => {
    const nextMet = !currentMet
    setCriterionState(prev => {
      const authorState = [...(prev[authorId] ?? [])]
      authorState[idx] = nextMet
      return { ...prev, [authorId]: authorState }
    })
    toggleICMJEMut.mutate({ authorId, idx, met: nextMet })
  }

  const handleAcknowledge  = (authorId: string) => {
    setAcknowledged(prev => ({ ...prev, [authorId]: true }))
    acknowledgeMut.mutate(authorId)
  }
  const handleRemind         = (authorId: string) => remindMut.mutate(authorId)
  const handleRequestConfirm = (authorId: string) => {
    const author = authors.find(a => a.id === authorId)
    setToast(`Confirmation request sent to ${author?.name ?? 'author'}. Logged to the audit trail.`)
  }
  const handleRunDebarment   = () => debarmentMut.mutate()

  const pendingList   = authors.filter(a => icmjeMetCount(a) < 4)
  const pendingAckList = pendingList.filter(a => !acknowledged[a.id])
  const allMet         = pendingList.length === 0

  let stageBannerText: string
  if (allMet) {
    stageBannerText = 'All authors confirmed the four ICMJE criteria. No soft-gate acknowledgement required before stage 5.'
  } else if (pendingAckList.length === 0) {
    stageBannerText = 'Soft gate acknowledged. Outstanding criteria recorded in audit trail and will appear in final output package.'
  } else {
    stageBannerText = `Soft gate: ${pendingAckList.length} author${pendingAckList.length === 1 ? '' : 's'} ${pendingAckList.length === 1 ? 'has' : 'have'} ICMJE criteria outstanding. Publication manager must acknowledge before stage 5.`
  }

  return (
    <div className="bg-slate-50" data-screen="author-management">
      <div style={{ maxWidth: 1180, padding: '20px 32px 48px' }}>
        <div className="flex flex-col gap-5">

          {/* Header */}
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div className="flex flex-col gap-1.5">
              <h1 className="text-2xl font-bold tracking-tight" style={{ margin: 0 }}>Author Management</h1>
              <p className="font-mono text-xs font-medium" style={{ color: '#64748B' }}>
                VELORA-301 manuscript · RACI chart 2 · ICMJE 2023
              </p>
            </div>
            <div className="flex flex-none gap-2">
              <button
                type="button"
                data-add-author
                className="rounded-md bg-white text-[13px] font-semibold"
                style={{ height: 36, padding: '0 14px', border: '1px solid #0D9488', color: '#0F766E' }}
              >
                + Add author
              </button>
              <button
                type="button"
                onClick={handleRunDebarment}
                disabled={isChecking}
                data-run-debarment
                className="flex items-center gap-2 rounded-md text-[13px] font-semibold text-white transition-colors disabled:opacity-70"
                style={{ height: 36, padding: '0 14px', backgroundColor: '#0D9488' }}
              >
                {isChecking && (
                  <svg
                    width="14" height="14" viewBox="0 0 14 14"
                    className="animate-spin-aurora"
                    data-spinner
                  >
                    <circle cx="7" cy="7" r="5" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="1.6" />
                    <path d="M12 7a5 5 0 0 0-5-5" fill="none" stroke="#FFFFFF" strokeWidth="1.6" strokeLinecap="round" />
                  </svg>
                )}
                {isChecking ? 'Checking…' : 'Run debarment check'}
              </button>
            </div>
          </div>

          {/* Two-column: table + sidebar */}
          <div className="flex gap-6">
            <div className="flex-1 min-w-0 overflow-hidden rounded-lg border border-slate-200 bg-white" data-author-table>
              <table className="w-full text-left">
                <thead>
                  <tr style={{ backgroundColor: '#F8FAFC', borderBottom: '1px solid #E2E8F0' }}>
                    <th style={{ padding: '10px 12px' }} className="font-mono text-[10px] font-medium uppercase tracking-widest text-slate-500">Author</th>
                    <th style={{ padding: '10px 12px' }} className="font-mono text-[10px] font-medium uppercase tracking-widest text-slate-500">Role</th>
                    <th style={{ padding: '10px 12px' }} className="font-mono text-[10px] font-medium uppercase tracking-widest text-slate-500">RACI</th>
                    <th style={{ padding: '10px 12px' }} className="font-mono text-[10px] font-medium uppercase tracking-widest text-slate-500">ICMJE</th>
                    <th style={{ padding: '10px 12px' }} className="font-mono text-[10px] font-medium uppercase tracking-widest text-slate-500">COI</th>
                    <th style={{ padding: '10px 12px' }} className="font-mono text-[10px] font-medium uppercase tracking-widest text-slate-500">Debarment</th>
                    <th style={{ padding: '10px 12px' }} className="font-mono text-[10px] font-medium uppercase tracking-widest text-slate-500">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {authors.map(author => (
                    <AuthorRow
                      key={author.id}
                      author={author}
                      isOpen={openAuthorId === author.id}
                      isAcknowledged={!!acknowledged[author.id]}
                      onToggle={() => handleToggleRow(author.id)}
                      onToggleCriterion={(idx, met) => handleToggleCriterion(author.id, idx, met)}
                      onAcknowledge={() => handleAcknowledge(author.id)}
                      onRemind={() => handleRemind(author.id)}
                      onRequestConfirm={() => handleRequestConfirm(author.id)}
                    />
                  ))}
                </tbody>
              </table>

              {/* Stage gate banner */}
              <div
                className="flex items-start gap-3 border-t"
                style={{
                  backgroundColor: allMet ? '#F0FDF4' : pendingAckList.length === 0 ? '#F1F5F9' : '#FFFBEB',
                  borderTopColor:  '#E2E8F0',
                  padding:         '14px 16px',
                }}
                data-stage-banner
                data-stage-state={allMet ? 'clear' : pendingAckList.length === 0 ? 'ack' : 'warn'}
              >
                <span
                  className="flex flex-none items-center justify-center rounded font-extrabold text-white"
                  style={{
                    width:  18, height: 18, fontSize: 11,
                    backgroundColor: allMet ? '#15803D' : pendingAckList.length === 0 ? '#475569' : '#D97706',
                    marginTop: 1,
                  }}
                >
                  {allMet ? '✓' : '!'}
                </span>
                <p className="text-[13px] leading-relaxed">{stageBannerText}</p>
              </div>
            </div>

            <Sidebar
              authors={authors}
              acknowledged={acknowledged}
              lastDebarment={lastDebarment}
              isChecking={isChecking}
              onRunDebarment={handleRunDebarment}
            />
          </div>
        </div>
      </div>

      {toast && (
        <div
          className="fixed left-1/2 z-50 flex -translate-x-1/2 items-center gap-2.5 rounded-lg text-[13px] text-white"
          style={{
            bottom: 20, maxWidth: 560,
            backgroundColor: '#1E293B',
            padding: '12px 16px',
            boxShadow: '0 12px 28px rgba(15,23,42,0.24)',
          }}
          data-author-toast
        >
          <span className="h-1.5 w-1.5 flex-none rounded-full" style={{ backgroundColor: '#0D9488' }} />
          <span className="leading-relaxed">{toast}</span>
        </div>
      )}
    </div>
  )
}
