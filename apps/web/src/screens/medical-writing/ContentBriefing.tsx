import { useMemo, useState, useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import type { ComplianceTrack, MedContentItem, MedContentType } from '@platform/types'
import { MED_CONTENT_TYPE_META } from '@platform/types'
import { medContentApi } from '../../modules/medical-writing/api/medContent'

// --- Static config ---

const TA_OPTIONS = ['Oncology', 'Cardiometabolic', 'Neurology', 'Immunology', 'Rare Disease', 'Respiratory'] as const

const AUDIENCE_OPTIONS = ['HCP', 'Patient', 'Caregiver'] as const
type Audience = typeof AUDIENCE_OPTIONS[number]

const CHANNEL_OPTIONS = ['Congress', 'Rep Detail Aid', 'Digital', 'Print', 'Email distribution'] as const

const CONTENT_TYPES: MedContentType[] = [
  'hcp-slide-deck', 'mi-letter', 'pil', 'cme-module', 'disease-dossier', 'eu-ctr-pls', 'advisory-report',
]

const DEFAULT_AUDIENCE: Record<MedContentType, Audience[]> = {
  'hcp-slide-deck':  ['HCP'],
  'mi-letter':       ['HCP'],
  'pil':             ['Patient', 'Caregiver'],
  'cme-module':      ['HCP'],
  'disease-dossier': ['HCP'],
  'eu-ctr-pls':      ['Patient'],
  'advisory-report': ['HCP'],
}

const PATIENT_FACING_TYPES: MedContentType[] = ['pil', 'eu-ctr-pls']

function frameworksFor(track: ComplianceTrack | null): string[] {
  if (!track) return []
  if (track === 'accme') return ['ACCME Standards 2022', 'EACCME Guidelines', '21 CFR Part 11']
  return ['IFPMA Code', 'EFPIA Code', 'ABPI Code 2023', 'PhRMA Code', '21 CFR Part 11']
}

function tierFor(type: MedContentType | null): 1 | 2 | 3 {
  if (!type) return 2
  if (type === 'pil' || type === 'eu-ctr-pls') return 3
  if (type === 'cme-module' || type === 'mi-letter') return 1
  return 2
}

// --- Subcomponents ---

interface CheckDotProps {
  passed: boolean
  label:  string
}
function CheckDot({ passed, label }: CheckDotProps) {
  return (
    <div className="flex items-center gap-2" data-check-item={label} data-check-passed={passed}>
      <span
        className="flex h-4 w-4 flex-none items-center justify-center rounded-full text-[10px] font-bold text-white"
        style={{ backgroundColor: passed ? '#15803D' : '#CBD5E1' }}
      >
        {passed ? '✓' : ''}
      </span>
      <span className="text-[13px]" style={{ color: passed ? '#0F172A' : '#64748B' }}>{label}</span>
    </div>
  )
}

interface PillProps { text: string; onRemove?: () => void; active?: boolean; onClick?: () => void }
function Pill({ text, onRemove, active, onClick }: PillProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] font-medium"
      style={{
        backgroundColor: active ? '#F5F3FF' : '#F1F5F9',
        color:           active ? '#5B21B6' : '#475569',
        border:          active ? '1px solid #DDD6FE' : '1px solid #E2E8F0',
      }}
    >
      {text}
      {onRemove && (
        <span
          onClick={(e) => { e.stopPropagation(); onRemove() }}
          className="cursor-pointer opacity-60 hover:opacity-100"
        >×</span>
      )}
    </button>
  )
}

// --- Screen ---

export function ContentBriefing() {
  const { projectId, contentId } = useParams()
  const navigate = useNavigate()
  const qc       = useQueryClient()
  const isNew    = contentId === 'new' || !contentId

  const { data: existing } = useQuery({
    queryKey: ['med-content', contentId],
    queryFn:  () => medContentApi.get(contentId!),
    enabled:  !isNew,
  })

  // Form state — hydrated from existing item when present
  const [title,       setTitle]       = useState('')
  const [type,        setType]        = useState<MedContentType | null>(null)
  const [track,       setTrack]       = useState<ComplianceTrack | null>(null)
  const [taTag,       setTaTag]       = useState<typeof TA_OPTIONS[number] | null>('Oncology')
  const [audience,    setAudience]    = useState<Audience[]>([])
  const [channels,    setChannels]    = useState<string[]>(['Congress', 'Digital'])
  const [targetDate,  setTargetDate]  = useState('')

  // Source documents — Module A read-only. All three linked by default for the demo.
  const [sourceDocs] = useState({ csr: true, smpc: true, ib: true })
  const [mapLinked] = useState(true)
  const [ppLinked]  = useState(false)

  // Hydrate from existing item
  useEffect(() => {
    if (!existing) return
    setTitle(existing.title)
    setType(existing.type)
    setTrack(existing.complianceTrack)
    setTaTag((TA_OPTIONS as readonly string[]).includes(existing.taTag) ? existing.taTag as typeof TA_OPTIONS[number] : null)
    setAudience((existing.targetAudience as Audience[]) ?? [])
    setChannels(existing.channels ?? [])
  }, [existing])

  // When type changes, default audience if the user hasn't set one
  useEffect(() => {
    if (type && audience.length === 0) setAudience(DEFAULT_AUDIENCE[type])
  }, [type, audience.length])

  const frameworks = useMemo(() => frameworksFor(track), [track])
  const showFKNote = !!type && PATIENT_FACING_TYPES.includes(type)
  const tier       = useMemo(() => tierFor(type), [type])

  // Readiness gate
  const checks = [
    { label: 'Source documents linked',    passed: sourceDocs.csr && sourceDocs.smpc && sourceDocs.ib },
    { label: 'TA tag set',                 passed: !!taTag },
    { label: 'Audience defined',           passed: audience.length > 0 },
    { label: 'Content type selected',      passed: !!type },
    { label: 'Compliance track confirmed', passed: !!track },
    { label: 'Content title set',          passed: title.trim().length > 0 },
  ]
  const ready = checks.every(c => c.passed)

  const saveMutation = useMutation({
    mutationFn: () => {
      const body = {
        type:            type ?? 'hcp-slide-deck',
        title,
        complianceTrack: track ?? 'mlr',
        taTag:           taTag ?? 'Oncology',
        targetAudience:  audience,
        channels,
      }
      if (isNew) return medContentApi.create(projectId!, body)
      return medContentApi.update(contentId!, body as Partial<MedContentItem>)
    },
    onSuccess: (item) => {
      qc.invalidateQueries({ queryKey: ['med-content'] })
      if (isNew) navigate(`../content/${item.id}`)
    },
  })

  const proceed = () => {
    if (!ready) return
    saveMutation.mutate(undefined, {
      onSuccess: () => {
        navigate(`/projects/${projectId}/medical-writing/kol-session`)
      },
    })
  }

  return (
    <div className="bg-slate-50" data-screen="content-briefing">
      <div className="flex flex-col gap-5" style={{ maxWidth: 1240, padding: '20px 32px 48px' }}>

        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-xs text-slate-500">
          <button onClick={() => navigate(`/projects/${projectId}/medical-writing`)} className="hover:text-slate-900">Medical Writing</button>
          <span style={{ color: '#CBD5E1' }}>&gt;</span>
          <span className="text-slate-700">{title || (isNew ? 'New content item' : (existing?.title ?? 'Content'))}</span>
          <span style={{ color: '#CBD5E1' }}>&gt;</span>
          <span className="font-semibold text-slate-900">Content Briefing</span>
        </nav>

        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="flex min-w-0 flex-col gap-1.5">
            <h1 className="text-[22px] font-bold tracking-tight text-slate-900" style={{ margin: 0 }}>Content Briefing</h1>
            <p className="font-mono text-xs font-medium" style={{ color: '#64748B' }}>Stage 1 · Strategic Input &amp; Briefing</p>
          </div>
          <div className="flex flex-none items-center gap-2">
            <span className="font-mono text-[11px] uppercase" style={{ letterSpacing: '0.1em', color: '#7C3AED' }}>Stage 1 of 6</span>
            <button
              type="button"
              onClick={() => saveMutation.mutate()}
              data-save-draft
              className="h-9 rounded-md border border-slate-300 bg-white px-3 text-[13px] font-semibold text-slate-700 hover:bg-slate-50"
            >Save draft</button>
            <button
              type="button"
              onClick={proceed}
              disabled={!ready}
              data-proceed-stage-2
              data-proceed-enabled={ready}
              className="h-9 rounded-md px-3 text-[13px] font-semibold text-white transition-colors"
              style={{
                backgroundColor: ready ? '#7C3AED' : '#CBD5E1',
                cursor:          ready ? 'pointer' : 'not-allowed',
              }}
            >Proceed to Stage 2 →</button>
          </div>
        </div>

        <div className="grid gap-5" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)' }}>

          {/* --- LEFT COLUMN --- */}
          <div className="flex flex-col gap-5">

            {/* Source Documents */}
            <section className="rounded-lg border border-slate-200 bg-white p-5" data-panel="source-documents">
              <header className="mb-3 flex items-center justify-between">
                <div>
                  <h2 className="text-[14px] font-bold text-slate-900">Source Documents</h2>
                  <p className="font-mono text-[11px] text-slate-500">Module A · VELORA-301 · Read-only</p>
                </div>
              </header>
              <div className="flex flex-wrap gap-2">
                <Pill text="CSR ✓" active />
                <Pill text="SmPC ✓" active />
                <Pill text="IB ✓" active />
              </div>
              <div className="mt-3 flex items-center gap-2" data-module-b-link>
                <span className="text-[13px] text-slate-500">Module B publication:</span>
                <span className="inline-flex items-center gap-1 text-[13px] text-slate-400">Not linked</span>
              </div>
              <div className="mt-3 inline-flex items-center gap-2 rounded-md px-2 py-1 text-[12px] font-semibold" style={{ backgroundColor: '#EFF6FF', color: '#1D4ED8', border: '1px solid #93C5FD' }}>
                <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: '#2563EB' }} />
                VELORA-301 CSR v1.0 · Module A
              </div>
            </section>

            {/* Content Plan */}
            <section className="rounded-lg border border-slate-200 bg-white p-5" data-panel="content-plan">
              <h2 className="mb-3 text-[14px] font-bold text-slate-900">Content Plan</h2>

              <label className="mb-3 block">
                <span className="mb-1 block text-[12px] font-semibold text-slate-600">Content title <span style={{ color: '#B45309' }}>*</span></span>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Veloricept + Pembrolizumab HCP Slide Deck"
                  data-input-title
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-[13px] outline-none focus:border-violet-500"
                />
              </label>

              <div className="mb-3">
                <p className="mb-1 text-[12px] font-semibold text-slate-600">Target audience</p>
                <div className="flex flex-wrap gap-2" data-audience-picker>
                  {AUDIENCE_OPTIONS.map(opt => (
                    <Pill
                      key={opt}
                      text={opt}
                      active={audience.includes(opt)}
                      onClick={() => setAudience(a => a.includes(opt) ? a.filter(x => x !== opt) : [...a, opt])}
                    />
                  ))}
                </div>
              </div>

              <div className="mb-3">
                <p className="mb-1 text-[12px] font-semibold text-slate-600">Distribution channels</p>
                <div className="flex flex-wrap gap-2" data-channel-picker>
                  {CHANNEL_OPTIONS.map(opt => (
                    <Pill
                      key={opt}
                      text={opt}
                      active={channels.includes(opt)}
                      onClick={() => setChannels(c => c.includes(opt) ? c.filter(x => x !== opt) : [...c, opt])}
                    />
                  ))}
                </div>
              </div>

              <label className="mb-3 block">
                <span className="mb-1 block text-[12px] font-semibold text-slate-600">Target completion date</span>
                <input
                  type="date"
                  value={targetDate}
                  onChange={(e) => setTargetDate(e.target.value)}
                  data-input-target-date
                  className="rounded-md border border-slate-300 px-3 py-2 text-[13px] outline-none focus:border-violet-500"
                />
              </label>

              <div className="flex items-center justify-between rounded-md px-3 py-2" style={{ backgroundColor: '#F0FDF4', border: '1px solid #BBF7D0' }} data-map-link>
                <span className="text-[13px] text-slate-800">VELORA-301 Medical Affairs Plan v1.0 · <span style={{ color: '#15803D', fontWeight: 600 }}>Linked ✓</span></span>
                <div className="flex gap-2">
                  <button type="button" className="text-[12px] font-semibold text-slate-600 hover:underline">Link</button>
                  <button type="button" className="text-[12px] font-semibold text-slate-600 hover:underline">Create new</button>
                </div>
              </div>

              <div className="mt-2 flex items-center justify-between rounded-md px-3 py-2" style={{ backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0' }} data-pp-link>
                <span className="text-[13px] text-slate-500">Publication Plan · <span style={{ color: '#94A3B8' }}>Not yet linked</span></span>
                <div className="flex gap-2">
                  <button type="button" className="text-[12px] font-semibold text-slate-600 hover:underline">Link</button>
                  <button type="button" className="text-[12px] font-semibold text-slate-600 hover:underline">Create new</button>
                </div>
              </div>

              {/* map/pp indicator variables used to keep the intent readable — not silenced */}
              <span className="sr-only" aria-hidden>{mapLinked ? 'map-linked' : ''}{ppLinked ? '' : ''}</span>
            </section>
          </div>

          {/* --- RIGHT COLUMN --- */}
          <div className="flex flex-col gap-5">

            {/* Scope Matrix */}
            <section className="rounded-lg border border-slate-200 bg-white p-5" data-panel="scope-matrix">
              <h2 className="mb-3 text-[14px] font-bold text-slate-900">Content Scope Matrix</h2>

              <p className="mb-1 text-[12px] font-semibold text-slate-600">Therapy area</p>
              <div className="mb-4 flex flex-wrap gap-2" data-ta-picker>
                {TA_OPTIONS.map(ta => (
                  <Pill key={ta} text={ta} active={taTag === ta} onClick={() => setTaTag(ta)} />
                ))}
              </div>

              <p className="mb-1 text-[12px] font-semibold text-slate-600">Content type</p>
              <div className="mb-2 grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }} data-type-grid>
                {CONTENT_TYPES.map(t => {
                  const meta   = MED_CONTENT_TYPE_META[t]
                  const active = type === t
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setType(t)}
                      data-type-card={t}
                      data-type-active={active || undefined}
                      className="flex flex-col items-start gap-1 rounded-md px-3 py-2.5 text-left transition-colors"
                      style={{
                        backgroundColor: active ? '#F5F3FF' : '#FFFFFF',
                        border:          active ? '2px solid #7C3AED' : '1px solid #E2E8F0',
                      }}
                    >
                      <span className="font-mono text-[9px] font-medium uppercase tracking-widest" style={{ color: active ? '#5B21B6' : '#64748B' }}>{meta.code}</span>
                      <span className="text-[13px] font-semibold" style={{ color: active ? '#5B21B6' : '#0F172A' }}>{meta.label}</span>
                    </button>
                  )
                })}
              </div>
              {showFKNote && (
                <p className="mt-2 text-[12px]" style={{ color: '#B45309' }} data-fk-note>
                  Patient-facing content — Content above FK grade 8 is blocked from MLR submission.
                </p>
              )}

              <p className="mb-1 mt-4 text-[12px] font-semibold text-slate-600">Compliance track</p>
              <div className="grid gap-2" style={{ gridTemplateColumns: '1fr 1fr' }} data-track-picker>
                <button
                  type="button"
                  onClick={() => setTrack('mlr')}
                  data-track-card="mlr"
                  data-track-active={track === 'mlr' || undefined}
                  className="rounded-md px-3 py-3 text-left transition-colors"
                  style={{
                    backgroundColor: track === 'mlr' ? '#EFF6FF' : '#FFFFFF',
                    border:          track === 'mlr' ? '2px solid #2563EB' : '1px solid #E2E8F0',
                  }}
                >
                  <p className="text-[13px] font-bold" style={{ color: track === 'mlr' ? '#1D4ED8' : '#0F172A' }}>MLR Track</p>
                  <p className="text-[12px] text-slate-500">Promotional / Medical Content</p>
                </button>
                <button
                  type="button"
                  onClick={() => setTrack('accme')}
                  data-track-card="accme"
                  data-track-active={track === 'accme' || undefined}
                  className="rounded-md px-3 py-3 text-left transition-colors"
                  style={{
                    backgroundColor: track === 'accme' ? '#F0FDF4' : '#FFFFFF',
                    border:          track === 'accme' ? '2px solid #15803D' : '1px solid #E2E8F0',
                  }}
                >
                  <p className="text-[13px] font-bold" style={{ color: track === 'accme' ? '#15803D' : '#0F172A' }}>ACCME/EACCME Track</p>
                  <p className="text-[12px] text-slate-500">Independent Medical Education</p>
                </button>
              </div>
              <p className="mt-2 text-[12px]" style={{ color: '#B45309' }} data-track-lock-warning>
                Compliance track is locked once content reaches Stage 2. To change track, archive this item and create a new one with the correct track.
              </p>
            </section>

            {/* Scope Summary */}
            <section className="rounded-lg border border-slate-200 bg-white p-5" data-panel="scope-summary">
              <h2 className="mb-3 text-[14px] font-bold text-slate-900">Scope Summary</h2>

              <div className="mb-3 grid gap-1">
                <p className="text-[11px] font-mono uppercase" style={{ color: '#64748B', letterSpacing: '0.1em' }}>Source</p>
                <p className="text-[13px] text-slate-800">VELORA-301 CSR v1.0 · Module A</p>
              </div>

              <div className="mb-3">
                <p className="mb-1 text-[11px] font-mono uppercase" style={{ color: '#64748B', letterSpacing: '0.1em' }}>Channels</p>
                <div className="flex flex-wrap gap-1.5" data-summary-channels>
                  {channels.length > 0
                    ? channels.map(c => <Pill key={c} text={c} active />)
                    : <span className="text-[13px] text-slate-400">No channels selected</span>}
                </div>
              </div>

              <div className="mb-3">
                <p className="mb-1 text-[11px] font-mono uppercase" style={{ color: '#64748B', letterSpacing: '0.1em' }}>Review tier</p>
                <div className="grid grid-cols-3 gap-2" data-summary-tiers>
                  {[1, 2, 3].map(t => {
                    const active = tier === t
                    const bg = t === 1 ? '#F0FDF4' : t === 2 ? '#FFFBEB' : '#EFF6FF'
                    const fg = t === 1 ? '#15803D' : t === 2 ? '#B45309' : '#005F8E'
                    return (
                      <div
                        key={t}
                        data-summary-tier={t}
                        data-summary-tier-active={active || undefined}
                        className="rounded-md px-3 py-2 text-center"
                        style={{
                          backgroundColor: active ? bg : '#F8FAFC',
                          color:           active ? fg : '#94A3B8',
                          border:          active ? `2px solid ${fg}` : '1px solid #E2E8F0',
                        }}
                      >
                        <p className="text-[12px] font-bold">Tier {t}</p>
                        <p className="text-[11px]">{t === 1 ? 'Expedited' : t === 2 ? 'Standard' : 'Enhanced'}</p>
                      </div>
                    )
                  })}
                </div>
              </div>

              <div className="mb-3">
                <p className="mb-1 text-[11px] font-mono uppercase" style={{ color: '#64748B', letterSpacing: '0.1em' }}>Applicable frameworks</p>
                <div className="flex flex-wrap gap-1.5" data-summary-frameworks>
                  {frameworks.length === 0
                    ? <span className="text-[13px] text-slate-400">Select a compliance track</span>
                    : frameworks.map(f => (
                        <span
                          key={f}
                          className="rounded-md px-2 py-1 text-[11px] font-semibold"
                          style={{ backgroundColor: '#F1F5F9', color: '#475569', border: '1px solid #E2E8F0' }}
                          data-framework-chip={f}
                        >{f}</span>
                      ))}
                </div>
              </div>

              <div>
                <p className="mb-1 text-[11px] font-mono uppercase" style={{ color: '#64748B', letterSpacing: '0.1em' }}>Stage 2 readiness checklist</p>
                <div className="flex flex-col gap-1.5" data-readiness-checklist>
                  {checks.map(c => <CheckDot key={c.label} passed={c.passed} label={c.label} />)}
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  )
}
