import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import type { SubmissionCheck, SubmissionCheckGroup, SubmissionCheckState } from '@platform/types'
import { publicationsApi } from '../../api'

// --- Static config ---

const CANONICAL_PUB = 'pub-001'

interface JournalDef {
  id:        'nejm' | 'jco' | 'lancet' | 'annals'
  name:      string
  meta:      string
  score:     number
  wordLimit: number
  rationale?: string
}

const JOURNALS: Record<JournalDef['id'], JournalDef> = {
  nejm:   { id: 'nejm',   name: 'New England Journal of Medicine', meta: 'Impact factor 96.2 · Open access: no · Acceptance rate ~5%', score: 62, wordLimit: 3500 },
  jco:    { id: 'jco',    name: 'Journal of Clinical Oncology',    meta: 'Impact factor 45.3 · Open access: optional · Acceptance rate ~18%', score: 94, wordLimit: 5000,
            rationale: 'Best fit: NSCLC clinical trial data, PFS primary endpoint, and your study size.' },
  lancet: { id: 'lancet', name: 'Lancet Oncology',                 meta: 'Impact factor 41.6 · Open access: optional', score: 87, wordLimit: 4500 },
  annals: { id: 'annals', name: 'Annals of Oncology',              meta: 'Impact factor 51.8 · Open access: optional', score: 81, wordLimit: 4000 },
}

const JOURNAL_ORDER: JournalDef['id'][] = ['jco', 'lancet', 'annals']

const GROUP_LABELS: Record<SubmissionCheckGroup, string> = {
  format:     'Manuscript format',
  words:      'Word count & length',
  equator:    'EQUATOR checklist',
  figures:    'Figures & tables',
  statements: 'Author statements',
  plagiarism: 'Plagiarism & duplication',
  refs:       'References',
}

const GROUP_ORDER: SubmissionCheckGroup[] = ['format', 'words', 'equator', 'figures', 'statements', 'plagiarism', 'refs']

// State tone mapping — no red
const STATE_TONE: Record<SubmissionCheckState, {
  bg: string; rule: string; markBg: string; mark: string
  tagBg: string; tagFg: string; tagLabel: string
}> = {
  pass:  { bg: '#FFFFFF', rule: 'transparent', markBg: '#16A34A', mark: '✓', tagBg: '#F0FDF4', tagFg: '#15803D', tagLabel: 'Pass' },
  warn:  { bg: '#FFFBEB', rule: '#D97706',     markBg: '#D97706', mark: '!', tagBg: '#FFFBEB', tagFg: '#B45309', tagLabel: 'Advisory' },
  ack:   { bg: '#FFFBEB', rule: '#D97706',     markBg: '#D97706', mark: '!', tagBg: '#F1F5F9', tagFg: '#475569', tagLabel: 'Acknowledged' },
  block: { bg: '#EFF6FF', rule: '#005F8E',     markBg: '#005F8E', mark: '!', tagBg: '#EFF6FF', tagFg: '#005F8E', tagLabel: 'Blocking' },
}

// Checks with action buttons
const CHECK_ACTIONS: Record<string, { primary?: string; secondary?: string }> = {
  'chk-w03': { primary: 'Jump to longest section →' },
  'chk-e02': { primary: 'Open CONSORT checklist →' },
  'chk-p02': { primary: 'Confirm & proceed', secondary: 'View match' },
  'chk-s05': { primary: 'Open author management →' },
}

// --- Component ---

export function JournalSubmissionReadiness() {
  const { publicationId } = useParams()
  const pubId             = publicationId ?? CANONICAL_PUB
  const qc                = useQueryClient()

  const [journalId,      setJournalId]      = useState<JournalDef['id']>('nejm')
  const [running,        setRunning]        = useState(false)
  const [openGroups,     setOpenGroups]     = useState<Record<string, boolean>>({
    format: false, words: true, equator: true, figures: false, statements: true, plagiarism: true, refs: false,
  })
  const [overrides, setOverrides] = useState<Record<string, SubmissionCheckState>>({})
  const [toast, setToast]         = useState<string | null>(null)
  const [blockingResolved, setBlockingResolved] = useState(false)

  const { data } = useQuery({
    queryKey: ['submission-checks', pubId],
    queryFn:  () => publicationsApi.getSubmissionChecks(pubId),
  })

  // Merge fixture with overrides (and blockingResolved design prop)
  const checks: SubmissionCheck[] = useMemo(() => {
    const raw = data?.checks ?? []
    return raw.map(c => {
      let state = overrides[c.id] ?? c.state
      if (blockingResolved) {
        if (c.id === 'chk-w03') state = 'pass'
        if (c.id === 'chk-p02') state = 'pass'
      }
      return { ...c, state }
    })
  }, [data, overrides, blockingResolved])

  // Grouped for rendering
  const grouped = useMemo(() => {
    const g: Record<SubmissionCheckGroup, SubmissionCheck[]> = {
      format: [], words: [], equator: [], figures: [], statements: [], plagiarism: [], refs: [],
    }
    for (const c of checks) g[c.groupId]?.push(c)
    return g
  }, [checks])

  const totals = useMemo(() => {
    const total    = checks.length
    const pass     = checks.filter(c => c.state === 'pass' || c.state === 'ack').length
    const blocking = checks.filter(c => c.state === 'block').length
    const advisory = total - pass - blocking
    return { total, pass, blocking, advisory }
  }, [checks])

  const gate = useMemo(() => {
    if (totals.blocking > 0) {
      return {
        state:   'block' as const,
        bg:      '#EFF6FF',
        border:  '#BFDBFE',
        iconBg:  '#005F8E',
        iconFg:  '#FFFFFF',
        countFg: '#005F8E',
        title:   `${totals.blocking} check requires attention before submission`,
        detail:  `Resolve all blocking issues to proceed. ${totals.advisory} advisory item${totals.advisory === 1 ? '' : 's'} may proceed unresolved.`,
      }
    }
    if (totals.advisory > 0) {
      return {
        state:   'advisory' as const,
        bg:      '#FFFBEB',
        border:  '#FDE68A',
        iconBg:  '#D97706',
        iconFg:  '#FFFFFF',
        countFg: '#B45309',
        title:   'No blocking issues remain',
        detail:  `${totals.advisory} advisory item${totals.advisory === 1 ? '' : 's'} may proceed unresolved.`,
      }
    }
    return {
      state:   'clear' as const,
      bg:      '#F0FDF4',
      border:  '#BBF7D0',
      iconBg:  '#16A34A',
      iconFg:  '#FFFFFF',
      countFg: '#15803D',
      title:   'All checks passed',
      detail:  'Submission is ready.',
    }
  }, [totals])

  // Toast auto-clear
  useEffect(() => {
    if (!toast) return
    const t = window.setTimeout(() => setToast(null), 3200)
    return () => window.clearTimeout(t)
  }, [toast])

  const runMut = useMutation({
    mutationFn: () => publicationsApi.runSubmissionChecks(pubId),
    onMutate:   () => setRunning(true),
    onSuccess:  () => {
      setRunning(false)
      qc.invalidateQueries({ queryKey: ['submission-checks', pubId] })
      setToast(`Checks refreshed — ${totals.pass}/${totals.total} passed · ${totals.blocking} blocking · ${totals.advisory} advisory.`)
    },
    onError: () => setRunning(false),
  })

  const handleAction = (checkId: string, primary: boolean) => {
    if (checkId === 'chk-w03' && primary) {
      setToast('Opening Discussion — the longest section at 1,284 words. Trim 627 words to meet the 3,500-word limit.')
    } else if (checkId === 'chk-e02' && primary) {
      setToast('Opening the CONSORT 2010 checklist — 3 items outstanding in Methods and Discussion.')
    } else if (checkId === 'chk-s05' && primary) {
      setToast('Opening author management — Prof. Hartley has ICMJE criteria 3 and 4 outstanding.')
    } else if (checkId === 'chk-p02' && primary) {
      setOverrides(prev => ({ ...prev, [checkId]: 'ack' }))
      setToast('Confirmed as a distinct publication. The confirmation and the 67% overlap record are written to the audit trail for GPP 2022.')
    } else if (checkId === 'chk-p02' && !primary) {
      setToast('Opening the potential match — "VELORA-301 interim results — ASCO 2026 abstract".')
    }
  }

  const currentJournal = JOURNALS[journalId]
  const submitDisabled = totals.blocking > 0

  const handleSwitchJournal = (id: JournalDef['id']) => {
    setJournalId(id)
    setToast(`Target journal switched to ${JOURNALS[id].name}. Word limit revalidated (${JOURNALS[id].wordLimit.toLocaleString()} words).`)
  }

  return (
    <div className="bg-slate-50" data-screen="submission-readiness">
      <div className="mx-auto flex flex-col gap-5" style={{ maxWidth: 1280, padding: '20px 32px 48px' }}>

        {/* Gate banner */}
        <div
          className="flex items-center gap-3 rounded-lg"
          style={{
            backgroundColor: gate.bg,
            border:          `1px solid ${gate.border}`,
            padding:         '14px 16px',
          }}
          data-gate-banner
          data-gate-state={gate.state}
        >
          <span
            className="flex flex-none items-center justify-center rounded-full font-extrabold text-white"
            style={{ width: 24, height: 24, fontSize: 13, backgroundColor: gate.iconBg }}
          >
            {gate.state === 'clear' ? '✓' : '!'}
          </span>
          <div className="flex min-w-0 flex-1 flex-col">
            <p className="text-[13px] font-bold" style={{ color: gate.countFg }}>{gate.title}</p>
            <p className="text-xs leading-relaxed" style={{ color: gate.countFg }}>{gate.detail}</p>
          </div>
          <p className="font-mono text-xs font-medium" style={{ color: gate.countFg }} data-gate-count>
            {totals.pass} / {totals.total} checks passed
          </p>
        </div>

        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="flex flex-col gap-1.5">
            <h1 className="text-2xl font-bold tracking-tight" style={{ margin: 0 }}>Submission readiness</h1>
            <p className="font-mono text-xs font-medium" style={{ color: '#64748B' }}>
              {currentJournal.name} · Vancouver · {currentJournal.wordLimit.toLocaleString()} word limit
            </p>
          </div>
          <div className="flex flex-none gap-2">
            <button
              type="button"
              onClick={() => runMut.mutate()}
              disabled={running}
              data-run-checks
              className="flex items-center gap-2 rounded-md bg-white text-[13px] font-semibold transition-colors disabled:opacity-70"
              style={{ height: 36, padding: '0 14px', border: '1px solid #0D9488', color: '#0F766E' }}
            >
              {running && (
                <svg width="14" height="14" viewBox="0 0 14 14" className="animate-spin-aurora" data-spinner>
                  <circle cx="7" cy="7" r="5" fill="none" stroke="rgba(15,118,110,0.25)" strokeWidth="1.6" />
                  <path d="M12 7a5 5 0 0 0-5-5" fill="none" stroke="#0F766E" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              )}
              {running ? 'Running…' : 'Run all checks'}
            </button>
            <button
              type="button"
              onClick={() => setBlockingResolved(v => !v)}
              data-toggle-resolved
              className="rounded-md bg-white text-[11px] font-semibold text-slate-500"
              style={{ height: 36, padding: '0 10px', border: '1px solid #E2E8F0' }}
              title="Design toggle: mark blocking as resolved"
            >
              {blockingResolved ? 'Reset checks' : 'Resolve blocking (demo)'}
            </button>
            <button
              type="button"
              disabled={submitDisabled}
              data-submit-journal
              className="rounded-md text-[13px] font-semibold text-white transition-colors"
              style={{
                height:          36,
                padding:         '0 14px',
                backgroundColor: submitDisabled ? '#F1F5F9' : '#0D9488',
                color:           submitDisabled ? '#94A3B8' : '#FFFFFF',
                cursor:          submitDisabled ? 'not-allowed' : 'pointer',
              }}
            >
              Submit to journal →
            </button>
          </div>
        </div>

        {/* Two-col: check groups + journal panel */}
        <div className="flex gap-6">

          {/* Check groups */}
          <div className="flex flex-1 min-w-0 flex-col gap-3" data-check-list>
            {GROUP_ORDER.map(groupId => {
              const groupChecks = grouped[groupId]
              if (!groupChecks || groupChecks.length === 0) return null
              const groupPass  = groupChecks.filter(c => c.state === 'pass' || c.state === 'ack').length
              const groupTotal = groupChecks.length
              const hasBlock   = groupChecks.some(c => c.state === 'block')
              const hasWarn    = groupChecks.some(c => c.state === 'warn')
              const groupState: SubmissionCheckState =
                hasBlock ? 'block' : hasWarn ? 'warn' : 'pass'
              const groupTone = STATE_TONE[groupState]
              const isOpen    = openGroups[groupId] ?? false
              return (
                <div
                  key={groupId}
                  className="overflow-hidden rounded-lg border border-slate-200 bg-white"
                  data-group={groupId}
                  data-group-open={isOpen || undefined}
                >
                  <button
                    type="button"
                    onClick={() => setOpenGroups(g => ({ ...g, [groupId]: !isOpen }))}
                    data-group-toggle={groupId}
                    className="flex w-full items-center gap-3 text-left"
                    style={{ padding: '14px 16px' }}
                  >
                    <span
                      className="flex flex-none items-center justify-center rounded-full font-extrabold text-white"
                      style={{ width: 22, height: 22, fontSize: 11, backgroundColor: groupTone.markBg }}
                      data-group-badge={groupState}
                    >
                      {groupTone.mark}
                    </span>
                    <p className="min-w-0 flex-1 text-[13px] font-bold">{GROUP_LABELS[groupId]}</p>
                    <span className="font-mono text-[11px] font-medium" style={{ color: '#64748B' }}>
                      {groupPass}/{groupTotal}
                    </span>
                    <svg width="10" height="10" viewBox="0 0 10 10" style={{ transform: isOpen ? 'none' : 'rotate(-90deg)' }}>
                      <polygon points="1,3 9,3 5,8" fill="#64748B" />
                    </svg>
                  </button>
                  {isOpen && (
                    <div className="flex flex-col" style={{ borderTop: '1px solid #E2E8F0' }}>
                      {groupChecks.map(check => {
                        const tone   = STATE_TONE[check.state]
                        const action = CHECK_ACTIONS[check.id]
                        return (
                          <div
                            key={check.id}
                            className="flex flex-col gap-1.5"
                            style={{
                              backgroundColor: tone.bg,
                              borderLeft:      `3px solid ${tone.rule}`,
                              padding:         '12px 16px',
                              borderTop:       '1px solid #F1F5F9',
                            }}
                            data-check={check.id}
                            data-check-state={check.state}
                          >
                            <div className="flex items-start gap-2.5">
                              <span
                                className="mt-0.5 flex flex-none items-center justify-center rounded-full font-extrabold text-white"
                                style={{ width: 16, height: 16, fontSize: 9, backgroundColor: tone.markBg }}
                              >
                                {tone.mark}
                              </span>
                              <div className="flex min-w-0 flex-1 flex-col gap-1">
                                <p
                                  className="text-[13px]"
                                  style={{ fontWeight: check.state === 'pass' ? 500 : 600 }}
                                >
                                  {check.label}
                                </p>
                                <p className="text-xs leading-relaxed" style={{ color: '#475569' }}>{check.note}</p>
                              </div>
                              <span
                                className="flex-none whitespace-nowrap rounded-full text-[11px] font-semibold"
                                style={{ padding: '3px 9px', backgroundColor: tone.tagBg, color: tone.tagFg }}
                                data-check-tag={check.state}
                              >
                                {tone.tagLabel}
                              </span>
                            </div>
                            {action && (
                              <div className="flex flex-wrap items-center gap-3" style={{ paddingLeft: 24 }}>
                                {action.primary && (
                                  <button
                                    type="button"
                                    onClick={() => handleAction(check.id, true)}
                                    data-check-action={check.id}
                                    className="rounded-md text-xs font-semibold"
                                    style={
                                      check.state === 'warn'
                                        ? { padding: '6px 11px', backgroundColor: '#D97706', color: '#FFFFFF' }
                                        : { color: '#0F766E' }
                                    }
                                  >
                                    {action.primary}
                                  </button>
                                )}
                                {action.secondary && (
                                  <button
                                    type="button"
                                    onClick={() => handleAction(check.id, false)}
                                    data-check-secondary={check.id}
                                    className="text-xs font-semibold text-slate-500"
                                  >
                                    {action.secondary}
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Journal panel */}
          <aside className="flex w-[320px] flex-none flex-col gap-3" data-journal-panel>
            <div
              className="flex flex-col gap-2 rounded-lg bg-white"
              style={{ border: '2px solid #0D9488', padding: 16 }}
              data-journal-current={journalId}
            >
              <p className="font-mono text-[10px] font-medium uppercase tracking-widest" style={{ color: '#0F766E' }}>
                Current target
              </p>
              <p className="text-[15px] font-bold">{currentJournal.name}</p>
              <p className="text-xs leading-relaxed" style={{ color: '#64748B' }}>{currentJournal.meta}</p>
              {journalId === 'nejm' && (
                <span
                  className="self-start rounded-full text-[11px] font-semibold"
                  style={{ padding: '3px 9px', backgroundColor: '#FFFBEB', color: '#B45309' }}
                  data-not-recommended
                >
                  ⚠ Not top recommendation
                </span>
              )}
              {journalId === 'jco' && (
                <span
                  className="self-start rounded-full text-[11px] font-semibold"
                  style={{ padding: '3px 9px', backgroundColor: '#F0FDF4', color: '#15803D' }}
                >
                  ✓ Best fit
                </span>
              )}
              <div className="mt-1 flex items-center gap-2">
                <div className="h-1.5 flex-1 overflow-hidden rounded-[3px]" style={{ backgroundColor: '#E2E8F0' }}>
                  <div className="h-full" style={{ width: `${currentJournal.score}%`, backgroundColor: '#0D9488' }} />
                </div>
                <span className="font-mono text-[11px] font-medium" style={{ color: '#0F766E' }}>{currentJournal.score}%</span>
              </div>
            </div>

            <p className="font-mono text-[10px] font-medium uppercase tracking-widest" style={{ color: '#64748B' }}>
              Ranked alternatives
            </p>
            {JOURNAL_ORDER.map((jid, idx) => {
              const j = JOURNALS[jid]
              const isCurrent = journalId === jid
              return (
                <div
                  key={jid}
                  className="flex flex-col gap-1.5 rounded-lg bg-white"
                  style={{
                    border:          isCurrent ? '2px solid #0D9488' : '1px solid #E2E8F0',
                    padding:         12,
                    backgroundColor: jid === 'jco' ? '#F0FDFA' : '#FFFFFF',
                  }}
                  data-journal-alt={jid}
                >
                  <div className="flex items-baseline justify-between">
                    <p className="font-mono text-[10px] font-medium" style={{ color: '#94A3B8' }}>#{idx + 1}</p>
                    <span className="font-mono text-[11px] font-medium" style={{ color: '#0F766E' }}>{j.score}%</span>
                  </div>
                  <p className="text-[13px] font-bold">{j.name}</p>
                  <p className="text-[11px] leading-relaxed" style={{ color: '#64748B' }}>{j.meta}</p>
                  {j.rationale && (
                    <p className="text-[11px] italic leading-relaxed" style={{ color: '#475569' }}>{j.rationale}</p>
                  )}
                  <div className="mt-1 h-1 overflow-hidden rounded-[2px]" style={{ backgroundColor: '#E2E8F0' }}>
                    <div className="h-full" style={{ width: `${j.score}%`, backgroundColor: '#0D9488' }} />
                  </div>
                  {!isCurrent && (
                    <button
                      type="button"
                      onClick={() => handleSwitchJournal(jid)}
                      data-switch-journal={jid}
                      className="mt-1 rounded-md bg-white text-[11px] font-semibold"
                      style={{ padding: '6px 10px', border: '1px solid #0D9488', color: '#0F766E' }}
                    >
                      Switch to this journal
                    </button>
                  )}
                </div>
              )
            })}
            <p className="font-mono text-[10px] italic leading-relaxed" style={{ color: '#94A3B8' }}>
              Advisory — journal fit scores are informational and do not gate submission. Publication manager retains final choice.
            </p>
          </aside>
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
          data-sub-toast
        >
          <span className="h-1.5 w-1.5 flex-none rounded-full" style={{ backgroundColor: '#0D9488' }} />
          <span className="leading-relaxed">{toast}</span>
        </div>
      )}
    </div>
  )
}
