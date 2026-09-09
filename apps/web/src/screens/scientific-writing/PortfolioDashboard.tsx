import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import type { Publication } from '@platform/types'
import { publicationsApi } from '../../api'

// --- Static config ---

interface StageDef {
  id:     Publication['stage']
  label:  string
  headBg: string
  headFg: string
  accent: string
}

const STAGES: StageDef[] = [
  { id: 'published',  label: 'Final output & published', headBg: '#F0FDF4', headFg: '#15803D', accent: '#16A34A' },
  { id: 'submission', label: 'Journal submission',       headBg: '#FFFBEB', headFg: '#B45309', accent: '#D97706' },
  { id: 'review',     label: 'Internal review',          headBg: '#EFF6FF', headFg: '#1D4ED8', accent: '#2563EB' },
  { id: 'authoring',  label: 'Authoring',                headBg: '#FFFFFF', headFg: '#0F766E', accent: '#0D9488' },
  { id: 'planning',   label: 'Planning',                 headBg: '#FFFFFF', headFg: '#64748B', accent: '#CBD5E1' },
]

interface PipelineEvent {
  label: string
  when:  string
  done?: boolean
  next?: boolean
}

const PIPELINE: PipelineEvent[] = [
  { label: 'Plain language summary submitted', when: 'Nov 2026', done: true },
  { label: 'Lancet Oncology submission',       when: 'Dec 2026', done: true },
  { label: 'JCO manuscript published',         when: 'Jan 2027', done: true },
  { label: 'ASCO 2027 abstract due',           when: 'Feb 2027', next: true },
  { label: 'ESMO 2027 planning',               when: 'Mar 2027' },
]

const SCOPES = ['All projects', 'VELORA-301', 'VELORA-302', 'AURELIA-101'] as const
type Scope = typeof SCOPES[number]

// Map friendly scope → projectId used in publications.json
const SCOPE_TO_PROJECT: Record<Exclude<Scope, 'All projects'>, string> = {
  'VELORA-301':  'proj-velora-301',
  'VELORA-302':  'proj-velora-302',
  'AURELIA-101': 'proj-aurelia-101',
}

const PROJECT_LABEL: Record<string, string> = {
  'proj-velora-301':  'VELORA-301',
  'proj-velora-302':  'VELORA-302',
  'proj-aurelia-101': 'AURELIA-101',
}

// Type badge palette (same as B01)
const TYPE_BADGE: Record<string, { bg: string; fg: string; label: string }> = {
  'manuscript':             { bg: '#F0FDFA', fg: '#0F766E', label: 'MANUSCRIPT' },
  'abstract':               { bg: '#F0FDFA', fg: '#0F766E', label: 'ABSTRACT' },
  'poster':                 { bg: '#F0FDFA', fg: '#0F766E', label: 'POSTER' },
  'pls':                    { bg: '#F1F5F9', fg: '#64748B', label: 'PLS' },
  'plain-language-summary': { bg: '#F1F5F9', fg: '#64748B', label: 'PLS' },
  'letter':                 { bg: '#F1F5F9', fg: '#64748B', label: 'LETTER' },
  'review':                 { bg: '#F0FDFA', fg: '#0F766E', label: 'REVIEW' },
}

const STATUS_PILL: Record<Publication['status'], { bg: string; fg: string; label: string }> = {
  'not-started':       { bg: '#F1F5F9', fg: '#64748B', label: 'Planning' },
  'in-authoring':      { bg: '#EFF6FF', fg: '#1D4ED8', label: 'In authoring' },
  'in-review':         { bg: '#FFFBEB', fg: '#B45309', label: 'In review' },
  'under-peer-review': { bg: '#FFFBEB', fg: '#B45309', label: 'Under peer review' },
  'submitted':         { bg: '#F0FDF4', fg: '#15803D', label: 'Submitted ✓' },
  'accepted':          { bg: '#F0FDF4', fg: '#15803D', label: 'Accepted ✓' },
  'published':         { bg: '#F0FDF4', fg: '#15803D', label: 'Published ✓' },
  'withdrawn':         { bg: '#F1F5F9', fg: '#475569', label: 'Withdrawn' },
}

// --- Main screen ---

export function PortfolioDashboard() {
  const { projectId } = useParams()

  const [scope,       setScope]       = useState<Scope>('All projects')
  const [filterOpen,  setFilterOpen]  = useState(false)
  const [toast,       setToast]       = useState<string | null>(null)
  const dropdownRef                   = useRef<HTMLDivElement | null>(null)

  // Fetch all publications (portfolio list). Uses list endpoint from B00.
  const { data: allPubs = [] } = useQuery({
    queryKey: ['portfolio', projectId ?? 'all'],
    queryFn:  () => publicationsApi.list('proj-velora-301'),
  })

  // For the dashboard we need cross-project data. If the projectId route param
  // is present, fall back to that; otherwise fetch every project separately.
  const { data: allPubsCross = [] } = useQuery({
    queryKey: ['portfolio-cross'],
    queryFn: async () => {
      const [a, b, c] = await Promise.all([
        publicationsApi.list('proj-velora-301'),
        publicationsApi.list('proj-velora-302'),
        publicationsApi.list('proj-aurelia-101'),
      ])
      return [...a, ...b, ...c]
    },
  })

  // Prefer cross-project payload once it loads
  const pubs = allPubsCross.length > 0 ? allPubsCross : allPubs

  // Filter by scope
  const visiblePubs = useMemo(() => {
    if (scope === 'All projects') return pubs
    const target = SCOPE_TO_PROJECT[scope]
    return pubs.filter(p => p.projectId === target)
  }, [pubs, scope])

  // Group by stage — exclude empty lanes
  const stages = useMemo(() => {
    return STAGES.map(stage => ({
      ...stage,
      pubs: visiblePubs.filter(p => p.stage === stage.id),
    })).filter(s => s.pubs.length > 0)
  }, [visiblePubs])

  // GPP status counts
  const gppRows = useMemo(() => {
    const published  = visiblePubs.filter(p => p.gpp2022 === 'complete' || p.status === 'published').length
    const submitted  = visiblePubs.filter(p => p.gpp2022 === 'submitted').length
    const progress   = visiblePubs.filter(p => p.gpp2022 === 'progress').length
    const total      = published + submitted + progress
    const compliant  = published + submitted
    const gppPct     = total > 0 ? Math.round((compliant / total) * 100) : 0
    return { published, submitted, progress, total, gppPct }
  }, [visiblePubs])

  const gppMut = useMutation({
    mutationFn: () => new Promise<void>(resolve => window.setTimeout(resolve, 800)),
    onSuccess:  () => {
      const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
      setToast(`GPP 2022 report exported — ${visiblePubs.length} publications · ${gppRows.gppPct}% compliance · ${now}.`)
    },
  })

  // Toast auto-clear
  useEffect(() => {
    if (!toast) return
    const t = window.setTimeout(() => setToast(null), 3600)
    return () => window.clearTimeout(t)
  }, [toast])

  // Close dropdown on outside click
  useEffect(() => {
    if (!filterOpen) return
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setFilterOpen(false)
    }
    window.document.addEventListener('mousedown', handler)
    return () => window.document.removeEventListener('mousedown', handler)
  }, [filterOpen])

  const handleSelectScope = (s: Scope) => {
    setScope(s)
    setFilterOpen(false)
  }

  return (
    <div className="flex h-full flex-col bg-slate-50" data-screen="portfolio-dashboard-b">
      <div className="mx-auto flex flex-col gap-5" style={{ maxWidth: 1280, padding: '20px 32px 48px' }}>

        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="flex flex-col gap-1.5">
            <h1 className="text-2xl font-bold tracking-tight" style={{ margin: 0 }}>Publications portfolio</h1>
            <p className="font-mono text-xs font-medium" style={{ color: '#64748B' }} data-header-subtitle>
              GenBioCa Sciences · {scope} · {visiblePubs.length} publication{visiblePubs.length === 1 ? '' : 's'}
            </p>
          </div>
          <div className="flex flex-none items-center gap-2">

            {/* Scope dropdown */}
            <div ref={dropdownRef} className="relative" data-scope-dropdown>
              <button
                type="button"
                onClick={() => setFilterOpen(v => !v)}
                data-scope-toggle
                className="flex items-center gap-2 rounded-md bg-white text-[13px] font-semibold"
                style={{ height: 36, padding: '0 12px', border: '1px solid #E2E8F0', color: '#1E293B' }}
              >
                <span style={{ fontSize: 11, color: '#64748B' }}>Scope:</span>
                <span>{scope}</span>
                <svg width="9" height="9" viewBox="0 0 10 10"><polygon points="1,3 9,3 5,8" fill="#64748B" /></svg>
              </button>
              {filterOpen && (
                <div
                  className="absolute right-0 top-full z-30 mt-1.5 flex flex-col gap-0.5 rounded-lg bg-white p-1.5"
                  style={{
                    minWidth: 200,
                    border: '1px solid #E2E8F0',
                    boxShadow: '0 12px 28px rgba(15,23,42,0.12)',
                  }}
                  data-scope-menu
                >
                  {SCOPES.map(s => {
                    const isSelected = scope === s
                    return (
                      <button
                        key={s}
                        type="button"
                        onClick={() => handleSelectScope(s)}
                        data-scope-option={s}
                        className="flex items-center justify-between rounded-md text-[13px]"
                        style={{
                          padding: '8px 12px',
                          backgroundColor: isSelected ? '#F1F5F9' : 'transparent',
                          fontWeight: isSelected ? 600 : 500,
                        }}
                      >
                        <span>{s}</span>
                        {isSelected && <span style={{ color: '#0D9488' }}>✓</span>}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => gppMut.mutate()}
              disabled={gppMut.isPending}
              data-export-gpp
              className="rounded-md text-[13px] font-semibold text-white"
              style={{ height: 36, padding: '0 14px', backgroundColor: '#0D9488' }}
            >
              {gppMut.isPending ? 'Exporting…' : 'Export GPP 2022 report'}
            </button>
          </div>
        </div>

        {/* Two-col body */}
        <div className="flex gap-6">

          {/* Stage lanes */}
          <div className="flex flex-1 min-w-0 flex-col gap-3" data-stage-lanes>
            {stages.length === 0 ? (
              <div
                className="rounded-lg bg-white p-8 text-center"
                style={{ border: '1px solid #E2E8F0', color: '#94A3B8' }}
                data-empty
              >
                No publications match the current scope.
              </div>
            ) : stages.map(stage => (
              <div key={stage.id} className="overflow-hidden rounded-lg border border-slate-200 bg-white" data-stage-lane={stage.id}>
                <div
                  className="flex items-center gap-3"
                  style={{ backgroundColor: stage.headBg, padding: '10px 16px', borderBottom: '1px solid #E2E8F0' }}
                >
                  <p
                    className="font-mono text-[11px] font-medium uppercase tracking-widest"
                    style={{ color: stage.headFg, letterSpacing: '0.12em' }}
                  >
                    {stage.label}
                  </p>
                  <span
                    className="rounded-full font-mono text-[11px] font-medium"
                    style={{ padding: '2px 8px', backgroundColor: '#F1F5F9', color: '#475569' }}
                  >
                    {stage.pubs.length}
                  </span>
                </div>
                <div className="flex flex-col">
                  {stage.pubs.map((pub, idx) => {
                    const badge   = TYPE_BADGE[pub.type] ?? { bg: '#F1F5F9', fg: '#64748B', label: pub.type.toUpperCase() }
                    const pill    = STATUS_PILL[pub.status]
                    const project = PROJECT_LABEL[pub.projectId] ?? pub.projectId
                    return (
                      <div
                        key={pub.id}
                        className="flex cursor-pointer items-start gap-4 transition-colors hover:bg-slate-50"
                        style={{
                          padding: '14px 16px',
                          borderTop: idx > 0 ? '1px solid #F1F5F9' : undefined,
                          borderLeft: `3px solid ${stage.accent}`,
                        }}
                        onClick={() => setToast(`${pub.title} · ${pill?.label ?? pub.status} · ${project}.`)}
                        data-pub-row={pub.id}
                      >
                        <div className="flex flex-none flex-col items-start gap-1">
                          <span
                            className="rounded font-mono font-medium uppercase"
                            style={{
                              fontSize: 9, letterSpacing: '0.1em',
                              padding: '3px 7px', backgroundColor: badge.bg, color: badge.fg,
                            }}
                            data-pub-badge={pub.type}
                          >
                            {badge.label}
                          </span>
                          <span className="font-mono text-[11px]" style={{ color: '#94A3B8' }}>{project}</span>
                        </div>
                        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                          <p className="text-[15px] font-bold leading-tight" style={{ color: '#1E293B' }}>{pub.title}</p>
                          <p className="text-[13px]" style={{ color: '#64748B' }}>{pub.journal ?? pub.keyMessage ?? ''}</p>
                          <div className="flex flex-wrap items-center gap-1.5">
                            {pub.doi && (
                              <span
                                className="font-mono text-[11px] font-medium"
                                style={{ padding: '2px 7px', backgroundColor: '#F1F5F9', color: '#475569', borderRadius: 4 }}
                                data-pub-doi
                              >
                                {pub.doi}
                              </span>
                            )}
                            {(pub.gpp2022 === 'submitted' || pub.gpp2022 === 'complete' || pub.status === 'published') && (
                              <span
                                className="rounded-full text-[11px] font-semibold"
                                style={{ padding: '2px 8px', backgroundColor: '#F0FDF4', color: '#15803D' }}
                                data-pub-gpp
                              >
                                GPP 2022 ✓
                              </span>
                            )}
                            {pub.aiLabel && (
                              <span
                                className="rounded-full text-[11px] font-semibold"
                                style={{ padding: '2px 8px', backgroundColor: '#F0FDFA', color: '#0F766E' }}
                                data-pub-ai
                              >
                                {pub.aiLabel}
                              </span>
                            )}
                            {pub.due && (
                              <span
                                className="rounded-full text-[11px] font-semibold"
                                style={{ padding: '2px 8px', backgroundColor: '#FFFBEB', color: '#B45309' }}
                                data-pub-due
                              >
                                {pub.due}
                              </span>
                            )}
                            {pub.warning && (
                              <span
                                className="rounded-full text-[11px] font-semibold"
                                style={{ padding: '2px 8px', backgroundColor: '#FFFBEB', color: '#B45309' }}
                                data-pub-warning
                              >
                                ⚠ {pub.warning}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex flex-none flex-col items-end gap-1">
                          {pill && (
                            <span
                              className="rounded-full text-[11px] font-semibold"
                              style={{ padding: '3px 9px', backgroundColor: pill.bg, color: pill.fg }}
                              data-pub-status
                            >
                              {pill.label}
                            </span>
                          )}
                          <span className="font-mono text-[11px]" style={{ color: '#94A3B8' }}>{pub.version}</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>

          {/* Right sidebar */}
          <aside className="flex w-[280px] flex-none flex-col gap-3">

            {/* GPP 2022 status */}
            <div className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-4" data-sidebar-gpp>
              <p className="font-mono text-[10px] font-medium uppercase tracking-widest" style={{ color: '#64748B' }}>
                GPP 2022 status
              </p>
              <div className="flex items-baseline justify-between py-1" style={{ borderBottom: '1px solid #F1F5F9' }}>
                <span className="text-xs" style={{ color: '#64748B' }}>Published</span>
                <span className="text-xs font-bold" style={{ color: '#15803D' }}>{gppRows.published} complete</span>
              </div>
              <div className="flex items-baseline justify-between py-1" style={{ borderBottom: '1px solid #F1F5F9' }}>
                <span className="text-xs" style={{ color: '#64748B' }}>Submitted</span>
                <span className="text-xs font-bold" style={{ color: '#B45309' }}>{gppRows.submitted} in flight</span>
              </div>
              <div className="flex items-baseline justify-between py-1">
                <span className="text-xs" style={{ color: '#64748B' }}>In progress</span>
                <span className="text-xs font-bold" style={{ color: '#475569' }}>{gppRows.progress} drafting</span>
              </div>
              <div className="mt-2 flex flex-col gap-1">
                <div className="flex items-baseline justify-between">
                  <span className="text-[11px]" style={{ color: '#64748B' }}>Compliance</span>
                  <span className="text-xs font-bold" style={{ color: '#15803D' }}>{gppRows.gppPct}%</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-[3px]" style={{ backgroundColor: '#E2E8F0' }}>
                  <div className="h-full" style={{ width: `${gppRows.gppPct}%`, backgroundColor: '#16A34A' }} />
                </div>
              </div>
            </div>

            {/* Submission pipeline */}
            <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4" data-sidebar-pipeline>
              <p className="font-mono text-[10px] font-medium uppercase tracking-widest" style={{ color: '#64748B' }}>
                Submission pipeline
              </p>
              <div className="flex flex-col" style={{ position: 'relative' }}>
                <div
                  className="absolute"
                  style={{ left: 5, top: 6, bottom: 6, width: 1, backgroundColor: '#E2E8F0' }}
                />
                {PIPELINE.map((event, i) => {
                  const dotColour = event.done ? '#16A34A' : event.next ? '#0D9488' : '#CBD5E1'
                  const textColour = event.done ? '#1E293B' : event.next ? '#0F766E' : '#94A3B8'
                  return (
                    <div key={i} className="flex items-start gap-2.5 py-1.5" data-pipeline-event={event.next ? 'next' : event.done ? 'done' : 'future'}>
                      <span
                        className="mt-1.5 h-[11px] w-[11px] flex-none rounded-full"
                        style={{ backgroundColor: dotColour, border: '2px solid #FFFFFF', boxShadow: '0 0 0 1px #E2E8F0', position: 'relative', zIndex: 1 }}
                      />
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <div className="flex items-baseline gap-2">
                          <p
                            className="text-xs leading-relaxed"
                            style={{ color: textColour, fontWeight: event.next ? 700 : 500 }}
                          >
                            {event.label}
                          </p>
                          {event.next && (
                            <span
                              className="rounded font-mono text-[9px] font-medium uppercase"
                              style={{
                                padding: '1px 6px', letterSpacing: '0.1em',
                                backgroundColor: '#F0FDFA', color: '#0F766E', border: '1px solid #99F6E4',
                              }}
                              data-pipeline-next-badge
                            >
                              Next
                            </span>
                          )}
                        </div>
                        <span className="font-mono text-[10px]" style={{ color: '#94A3B8' }}>{event.when}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Master library */}
            <div className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-4" data-sidebar-library>
              <p className="font-mono text-[10px] font-medium uppercase tracking-widest" style={{ color: '#64748B' }}>
                Master library
              </p>
              <p className="text-2xl font-bold" style={{ color: '#0D9488' }}>12</p>
              <p className="text-xs leading-relaxed" style={{ color: '#64748B' }}>
                content cards contributed · 3 projects reusing
              </p>
              <div className="flex flex-wrap gap-2">
                <span
                  className="inline-flex items-center gap-1.5 rounded-full text-[11px] font-semibold"
                  style={{ padding: '3px 9px', backgroundColor: '#F5F3FF', color: '#6D28D9' }}
                  data-library-chip="medical"
                >
                  <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: '#7C3AED' }} />
                  Medical Writing
                </span>
                <span
                  className="inline-flex items-center gap-1.5 rounded-full text-[11px] font-semibold"
                  style={{ padding: '3px 9px', backgroundColor: '#EFF6FF', color: '#005F8E' }}
                  data-library-chip="ideation"
                >
                  <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: '#005F8E' }} />
                  Ideation & Publishing
                </span>
              </div>
              <button type="button" className="self-start text-xs font-semibold" style={{ color: '#0F766E' }}>
                View master library →
              </button>
            </div>
          </aside>
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
          data-portfolio-toast
        >
          <span className="h-1.5 w-1.5 flex-none rounded-full" style={{ backgroundColor: '#0D9488' }} />
          <span className="leading-relaxed">{toast}</span>
        </div>
      )}
    </div>
  )
}
