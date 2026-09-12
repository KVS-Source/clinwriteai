import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import type {
  PublicationType, ReportingGuideline, CreatePublicationBody,
} from '@platform/types'
import { publicationsApi } from '../../api'

// --- Static config ---

type ManuscriptSubtype = 'original' | 'review' | 'case'
type BaaChoice        = 'confirmed' | 'contact' | null

interface TypeCardDef {
  id:    PublicationType
  code:  string
  label: string
  sub:   string
}

const TYPE_CARDS: TypeCardDef[] = [
  { id: 'manuscript', code: 'MANUSCRIPT',  label: 'Manuscript',              sub: 'Original research / review / case report' },
  { id: 'abstract',   code: 'ABSTRACT',    label: 'Congress abstract',       sub: 'Oral or poster presentation' },
  { id: 'poster',     code: 'POSTER',      label: 'Poster / slide deck',     sub: 'Scientific congress poster' },
  { id: 'review',     code: 'WHITE PAPER', label: 'White paper',             sub: 'Opinion piece / position paper' },
  { id: 'letter',     code: 'LETTER',      label: 'Letter to editor',        sub: 'Commentary / response' },
  { id: 'pls',        code: 'PLS',         label: 'Plain language summary',  sub: 'Lay audience summary' },
  { id: 'plain-language-summary', code: 'PRESS', label: 'Press release',     sub: 'With communications team' },
]

interface GuidelineDef {
  id:    ReportingGuideline
  study: string
  name:  string
  desc:  string
  items: number
  note:  string
}

const GUIDELINES: GuidelineDef[] = [
  { id: 'CONSORT', study: 'Randomised controlled trial',      name: 'CONSORT 2010', desc: 'Parallel-group, crossover and cluster RCTs',   items: 25,
    note: 'CONSORT 2010 — 25 mandatory reporting items will be attached to your Methods section. You will be guided to complete each item during drafting.' },
  { id: 'STROBE',  study: 'Observational study',              name: 'STROBE 2007',  desc: 'Cohort, case-control, cross-sectional',        items: 22,
    note: 'STROBE 2007 — 22 reporting items will be attached to your Methods section. You will be guided to complete each item during drafting.' },
  { id: 'PRISMA',  study: 'Systematic review',                name: 'PRISMA 2020',  desc: 'Systematic review / meta-analysis',            items: 27,
    note: 'PRISMA 2020 — 27 reporting items will be attached, including the flow diagram and search strategy appendix.' },
  { id: 'CARE',    study: 'Meta-analysis (observational)',    name: 'MOOSE 2000',   desc: 'Meta-analysis of observational studies',       items: 35,
    note: 'MOOSE 2000 — 35 reporting items will be attached across background, search strategy, methods, results and discussion.' },
]

const SUBTYPES: { id: ManuscriptSubtype; label: string }[] = [
  { id: 'original', label: 'Original research' },
  { id: 'review',   label: 'Review' },
  { id: 'case',     label: 'Case report' },
]

const TA_OPTIONS = ['Oncology', 'Cardiology', 'Neurology', 'Immunology']

const TEAM = [
  { role: 'Medical writer / publication lead', name: 'Marcus Webb',   initials: 'MW' as const },
  { role: 'Lead author (KOL)',                 name: null,             initials: null },
  { role: 'Publication manager',               name: 'Dr Sarah Chen',  initials: 'SC' as const },
  { role: 'Biostatistician',                   name: 'Dr Priya Nair',  initials: 'PN' as const },
]

const STEP_LABELS = ['Source document', 'Publication type', 'EQUATOR guideline', 'Journal & team']

const JOURNAL_META = [
  'Impact Factor: 96.2',
  'Vancouver',
  'Max 3,500 words',
  'Max 5 figures',
]

// --- Subcomponents ---

interface StepperProps {
  current: 1 | 2 | 3 | 4
  onGo:    (step: 1 | 2 | 3 | 4) => void
}
function Stepper({ current, onGo }: StepperProps) {
  return (
    <div className="flex items-start gap-0" data-stepper>
      {STEP_LABELS.map((label, idx) => {
        const step   = (idx + 1) as 1 | 2 | 3 | 4
        const done   = step < current
        const active = step === current
        const bg     = done || active ? '#0D9488' : '#FFFFFF'
        const fg     = done || active ? '#FFFFFF' : '#94A3B8'
        const border = done || active ? '#0D9488' : '#E2E8F0'
        const mark   = done ? '✓' : String(step)
        const labelColour = active ? '#0F766E' : done ? '#0F766E' : '#94A3B8'
        const lineBefore  = idx === 0 ? 'transparent' : done || active ? '#0D9488' : '#E2E8F0'
        const lineAfter   = idx === STEP_LABELS.length - 1 ? 'transparent' : done ? '#0D9488' : '#E2E8F0'

        return (
          <div key={label} className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="flex items-center">
              <div className="h-0.5 flex-1" style={{ backgroundColor: lineBefore }} />
              <button
                type="button"
                onClick={() => onGo(step)}
                data-step-circle={step}
                data-step-state={done ? 'done' : active ? 'active' : 'upcoming'}
                className="flex h-7 w-7 flex-none cursor-pointer items-center justify-center rounded-full text-xs font-bold"
                style={{ backgroundColor: bg, color: fg, border: `1.5px solid ${border}` }}
              >
                {mark}
              </button>
              <div className="h-0.5 flex-1" style={{ backgroundColor: lineAfter }} />
            </div>
            <p
              className="text-center text-[11px] font-semibold leading-tight"
              style={{ color: labelColour, padding: '0 4px' }}
            >
              {label}
            </p>
          </div>
        )
      })}
    </div>
  )
}

interface Doc {
  key:     'csr' | 'sap' | 'tlf' | 'protocol'
  name:    string
  state:   string
}
const DOCS: Doc[] = [
  { key: 'csr',      name: 'Clinical study report — VELORA-301', state: 'v1.0 · Signed ✓' },
  { key: 'sap',      name: 'Statistical analysis plan v2.0',     state: 'Signed ✓' },
  { key: 'tlf',      name: 'TLF package v3',                     state: 'Validated ✓' },
  { key: 'protocol', name: 'Protocol v3.2',                      state: 'Optional' },
]

// --- Main wizard ---

interface WizardProps {
  onClose?: () => void
}

export function NewPublicationWizard({ onClose }: WizardProps = {}) {
  const { projectId } = useParams()
  const navigate      = useNavigate()
  const qc            = useQueryClient()

  const [step, setStep]                   = useState<1 | 2 | 3 | 4>(1)
  const [docs, setDocs]                   = useState<Record<Doc['key'], boolean>>({ csr: true, sap: true, tlf: true, protocol: false })
  const [ta, setTa]                       = useState('Oncology')
  const [taOpen, setTaOpen]               = useState(false)
  const [type, setType]                   = useState<PublicationType>('manuscript')
  const [subtype, setSubtype]             = useState<ManuscriptSubtype>('original')
  const [baa, setBaa]                     = useState<BaaChoice>(null)
  const [guideline, setGuideline]         = useState<ReportingGuideline>('CONSORT')
  const [journal, setJournal]             = useState('New England Journal of Medicine')
  const [targetDate]                      = useState('2027-01-15')
  const [keyMessage, setKeyMessage]       = useState('')
  const [inviteOpen, setInviteOpen]       = useState(false)
  const [inviteEmail, setInviteEmail]     = useState('')

  const baaRequired = type === 'manuscript' && subtype === 'case'
  const baaBlocked  = baaRequired && baa === 'contact'
  const gate1       = !!ta && (!baaRequired || baa === 'confirmed')

  const currentGuideline = useMemo(
    () => GUIDELINES.find(g => g.id === guideline) ?? GUIDELINES[0],
    [guideline],
  )

  const nextDisabled = step === 1 ? !gate1 : false

  const handleClose = () => {
    if (onClose) onClose()
    else navigate(`/projects/${projectId}/scientific-writing`)
  }

  const createMut = useMutation({
    mutationFn: () => {
      const body: CreatePublicationBody = {
        projectId:              projectId ?? '',
        type,
        subtype:                type === 'manuscript' ? (subtype === 'original' ? 'original-research' : subtype === 'review' ? 'systematic-review' : 'case-report') : null,
        title:                  `${TYPE_CARDS.find(t => t.id === type)?.label ?? 'Publication'} — VELORA-301 draft`,
        guideline,
        journal:                journal || null,
        targetSubmissionDate:   targetDate,
        keyMessage:             keyMessage || null,
        sourceDocumentId:       'doc-velora-csr',
        sourceDocumentLabel:    'VELORA-301 CSR v1.0 · Module A',
        ownerId:                'user-mw',
      }
      return publicationsApi.create(body)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['publications', projectId] })
      navigate(`/projects/${projectId}/scientific-writing`)
    },
  })

  const handleNext = () => {
    if (step < 4) setStep((step + 1) as 1 | 2 | 3 | 4)
    else createMut.mutate()
  }

  const handleBack = () => {
    if (step > 1) setStep((step - 1) as 1 | 2 | 3 | 4)
  }

  const toggleDoc = (key: Doc['key']) => setDocs(d => ({ ...d, [key]: !d[key] }))

  const progressPct = step * 25

  return (
    <div
      className="absolute inset-0 flex items-center justify-center overflow-y-auto"
      data-screen="new-publication-wizard"
      style={{ backgroundColor: 'rgba(15,23,42,0.6)', padding: 32, zIndex: 40 }}
      data-wizard-backdrop
      onClick={handleClose}
    >
      <div
        className="flex w-full flex-col overflow-hidden bg-white"
        style={{
          maxWidth:   640,
          maxHeight:  '100%',
          borderRadius: 12,
          boxShadow:  '0 24px 60px rgba(15,23,42,0.3)',
        }}
        data-wizard-modal
        onClick={(e) => e.stopPropagation()}
      >

        {/* Header + Stepper */}
        <div className="flex flex-none flex-col gap-6" style={{ padding: '32px 40px 0' }}>
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-1">
              <p className="font-mono text-[10px] font-medium uppercase tracking-widest text-slate-500">
                New publication
              </p>
              <p className="text-lg font-bold tracking-tight text-slate-900">
                Scientific Writing · VELORA-301
              </p>
            </div>
            <button
              type="button"
              onClick={handleClose}
              aria-label="Close"
              data-wizard-close
              className="flex h-7 w-7 flex-none cursor-pointer items-center justify-center rounded text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
              style={{ fontSize: 16, lineHeight: 1 }}
            >
              ×
            </button>
          </div>
          <Stepper current={step} onGo={setStep} />
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-y-auto" style={{ padding: '28px 40px 32px' }}>

          {step === 1 && (
            <div className="flex flex-col gap-5" data-step-body={1}>
              <div className="flex flex-col gap-1.5">
                <p className="text-[17px] font-bold text-slate-900">Link source documents from Clinical Writing</p>
                <p className="font-mono text-[11px] font-medium uppercase tracking-widest" style={{ color: '#0F766E' }}>
                  Clinical Writing · VELORA-301
                </p>
              </div>

              <div
                className="flex flex-col gap-3.5"
                style={{ border: '2px solid #0D9488', borderRadius: 8, padding: '16px 20px' }}
                data-source-card
              >
                <div className="flex flex-col gap-2">
                  <span
                    className="inline-flex items-center gap-1.5 self-start rounded font-semibold"
                    style={{ padding: '3px 9px', borderRadius: 5, backgroundColor: '#EFF6FF', color: '#1D4ED8', fontSize: 12 }}
                  >
                    <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: '#2563EB' }} />
                    Clinical Writing
                  </span>
                  <p className="text-[13px] font-bold leading-relaxed">VELORA-301: Phase III NSCLC — Veloricept + Pembrolizumab</p>
                </div>
                <div className="h-px" style={{ backgroundColor: '#E2E8F0' }} />
                <div className="flex flex-col gap-0.5">
                  {DOCS.map(doc => {
                    const on = docs[doc.key]
                    return (
                      <button
                        type="button"
                        key={doc.key}
                        onClick={() => toggleDoc(doc.key)}
                        data-source-doc={doc.key}
                        data-checked={on || undefined}
                        className="flex items-center gap-3 rounded-md text-left transition-colors hover:bg-slate-50"
                        style={{ padding: '8px 6px' }}
                      >
                        <span
                          className="flex h-[18px] w-[18px] flex-none items-center justify-center rounded font-extrabold text-white"
                          style={{
                            fontSize:        12,
                            backgroundColor: on ? '#0D9488' : '#FFFFFF',
                            border:          `1px solid ${on ? '#0D9488' : '#CBD5E1'}`,
                          }}
                        >
                          {on ? '✓' : ''}
                        </span>
                        <span className="min-w-0 flex-1 text-[13px] text-slate-900">{doc.name}</span>
                        <span
                          className="flex-none font-mono text-[11px] font-medium"
                          style={{ color: on ? '#0F766E' : '#94A3B8' }}
                        >
                          {doc.state}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="flex flex-col gap-2" style={{ maxWidth: 300 }}>
                <p className="text-xs font-semibold text-slate-500">
                  Therapeutic area <span style={{ color: '#005F8E' }}>*</span>{' '}
                  <span className="font-medium text-slate-400">— mandatory</span>
                </p>
                <button
                  type="button"
                  onClick={() => setTaOpen(v => !v)}
                  data-ta-toggle
                  className="flex items-center justify-between rounded-md bg-white text-sm"
                  style={{
                    padding:   '10px 12px',
                    border:    '1px solid #0D9488',
                    boxShadow: '0 0 0 3px rgba(13,148,136,0.12)',
                  }}
                >
                  <span>{ta}</span>
                  <svg width="10" height="10" viewBox="0 0 10 10"><polygon points="1,3 9,3 5,8" fill="#64748B" /></svg>
                </button>
                {taOpen && (
                  <div
                    className="flex flex-col gap-0.5 rounded-lg border border-slate-200 bg-white p-1.5"
                    style={{ boxShadow: '0 12px 28px rgba(15,23,42,0.12)' }}
                  >
                    {TA_OPTIONS.map(opt => (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => { setTa(opt); setTaOpen(false) }}
                        data-ta-option={opt}
                        className="flex items-center justify-between rounded-md text-sm hover:bg-slate-50"
                        style={{
                          padding:         '9px 12px',
                          backgroundColor: ta === opt ? '#F0FDFA' : 'transparent',
                        }}
                      >
                        <span>{opt}</span>
                        {ta === opt && <span className="font-bold" style={{ color: '#0D9488' }}>✓</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {baaRequired && (
                <div
                  className="flex flex-col gap-3"
                  style={{
                    backgroundColor: '#FFFBEB',
                    border:          '1px solid #FDE68A',
                    borderLeft:      '3px solid #D97706',
                    borderRadius:    8,
                    padding:         16,
                  }}
                  data-baa-card
                >
                  <div className="flex items-start gap-3">
                    <div
                      className="flex flex-none items-center justify-center text-xs font-extrabold text-white"
                      style={{ width: 18, height: 18, backgroundColor: '#D97706', borderRadius: 5, marginTop: 1 }}
                    >
                      !
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <p className="text-[13px] font-bold">Case report with patient data detected</p>
                      <p className="text-[13px] leading-relaxed text-slate-600">
                        This publication type may contain patient-derived data (eCRF data, anonymised records, diagnostic results). A HIPAA BAA must be in place before this project can proceed to Stage 3.
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-col gap-2" style={{ paddingLeft: 30 }}>
                    {(['confirmed', 'contact'] as const).map(choice => {
                      const active = baa === choice
                      const label  = choice === 'confirmed'
                        ? 'BAA confirmed — proceed with case report'
                        : 'Contact GenBioCa Legal — I need to arrange a BAA'
                      return (
                        <button
                          key={choice}
                          type="button"
                          onClick={() => setBaa(choice)}
                          data-baa-option={choice}
                          className="flex items-start gap-2.5 text-left"
                        >
                          <span
                            className="flex flex-none items-center justify-center rounded-full bg-white"
                            style={{
                              width:  16,
                              height: 16,
                              marginTop: 2,
                              border: `1.5px solid ${active ? '#0D9488' : '#CBD5E1'}`,
                            }}
                          >
                            <span
                              className="block rounded-full"
                              style={{ width: 8, height: 8, backgroundColor: active ? '#0D9488' : 'transparent' }}
                            />
                          </span>
                          <span className="text-[13px] leading-relaxed">{label}</span>
                        </button>
                      )
                    })}
                  </div>
                  {baaBlocked && (
                    <div
                      className="text-xs leading-relaxed"
                      style={{
                        marginLeft:      30,
                        backgroundColor: '#FFFFFF',
                        border:          '1px solid #BFDBFE',
                        borderLeft:      '3px solid #005F8E',
                        borderRadius:    6,
                        padding:         '10px 12px',
                      }}
                    >
                      Publication creation is blocked until a BAA is in place. GenBioCa Legal will be notified when you request contact.
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {step === 2 && (
            <div className="flex flex-col gap-5" data-step-body={2}>
              <p className="text-[17px] font-bold text-slate-900">What are you creating?</p>
              <div className="grid gap-3" style={{ gridTemplateColumns: '1fr 1fr' }}>
                {TYPE_CARDS.map(card => {
                  const active = type === card.id
                  return (
                    <button
                      key={card.id}
                      type="button"
                      onClick={() => setType(card.id)}
                      data-type-card={card.id}
                      data-active={active || undefined}
                      className="flex items-start gap-3 text-left transition-colors"
                      style={{
                        padding:         16,
                        borderRadius:    8,
                        backgroundColor: active ? '#F0FDFA' : '#FFFFFF',
                        border:          active ? '2px solid #0D9488' : '1px solid #E2E8F0',
                      }}
                    >
                      <div
                        className="flex h-7 w-7 flex-none items-center justify-center rounded-md bg-white"
                        style={{ border: '1px solid #E2E8F0', color: active ? '#0D9488' : '#64748B' }}
                      >
                        <svg width="15" height="15" viewBox="0 0 14 14" fill="none">
                          <rect x="2.4" y="1.4" width="9.2" height="11.2" rx="1.2" stroke="currentColor" strokeWidth="1.3" />
                          <rect x="4.4" y="4.2" width="5.2" height="1.2" rx="0.6" fill="currentColor" />
                          <rect x="4.4" y="7"   width="5.2" height="1.2" rx="0.6" fill="currentColor" />
                        </svg>
                      </div>
                      <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <span
                          className="font-mono font-medium"
                          style={{ fontSize: 9, letterSpacing: '0.1em', color: active ? '#0F766E' : '#94A3B8' }}
                        >
                          {card.code}
                        </span>
                        <p className="text-[13px] font-bold">{card.label}</p>
                        <p className="text-xs leading-relaxed text-slate-500">{card.sub}</p>
                      </div>
                    </button>
                  )
                })}
              </div>

              {type === 'manuscript' && (
                <div
                  className="flex flex-col gap-2.5"
                  style={{ backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 8, padding: '14px 16px' }}
                >
                  <p className="text-xs font-semibold text-slate-500">Manuscript subtype</p>
                  <div className="flex flex-wrap gap-2">
                    {SUBTYPES.map(st => {
                      const on = subtype === st.id
                      return (
                        <button
                          key={st.id}
                          type="button"
                          onClick={() => setSubtype(st.id)}
                          data-subtype={st.id}
                          data-active={on || undefined}
                          className="rounded-full text-xs font-semibold transition-colors"
                          style={{
                            padding:         '6px 12px',
                            backgroundColor: on ? '#F0FDFA' : '#FFFFFF',
                            border:          `1px solid ${on ? '#0D9488' : '#E2E8F0'}`,
                            color:           on ? '#0F766E' : '#64748B',
                          }}
                        >
                          {st.label}
                        </button>
                      )
                    })}
                  </div>
                  {baaRequired && (
                    <p className="text-xs leading-relaxed" style={{ color: '#B45309' }}>
                      Case report selected — a HIPAA BAA acknowledgement has been added to step 1.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {step === 3 && (
            <div className="flex flex-col gap-5" data-step-body={3}>
              <div className="flex flex-col gap-1.5">
                <p className="text-[17px] font-bold text-slate-900">Select your reporting guideline</p>
                <p className="text-[13px] leading-relaxed text-slate-500">
                  ClinWrite.AI proposes a guideline from your study type. You can change it here; the attached checklist follows this choice.
                </p>
              </div>
              <div className="flex flex-col gap-2.5">
                {GUIDELINES.map(g => {
                  const active = guideline === g.id
                  return (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => setGuideline(g.id)}
                      data-guideline={g.id}
                      data-active={active || undefined}
                      className="flex items-center gap-3.5 text-left transition-colors"
                      style={{
                        minHeight:       80,
                        borderRadius:    8,
                        padding:         '16px 18px',
                        backgroundColor: active ? '#F0FDFA' : '#FFFFFF',
                        border:          active ? '2px solid #0D9488' : '1px solid #E2E8F0',
                      }}
                    >
                      <span
                        className="flex flex-none items-center justify-center rounded-full bg-white"
                        style={{
                          width:  18,
                          height: 18,
                          border: `1.5px solid ${active ? '#0D9488' : '#CBD5E1'}`,
                        }}
                      >
                        <span
                          className="rounded-full"
                          style={{ width: 9, height: 9, backgroundColor: active ? '#0D9488' : 'transparent' }}
                        />
                      </span>
                      <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <p className="text-[13px] font-semibold" style={{ color: '#475569' }}>{g.study}</p>
                        <p className="text-[15px] font-bold">{g.name}</p>
                        <p className="text-xs leading-relaxed text-slate-500">{g.desc}</p>
                      </div>
                      <span className="flex-none font-mono text-[11px] font-medium" style={{ color: '#94A3B8' }}>
                        {g.items} items
                      </span>
                    </button>
                  )
                })}
              </div>
              <div
                className="text-[13px] leading-relaxed"
                style={{
                  backgroundColor: '#F0FDFA',
                  border:          '1px solid #99F6E4',
                  borderLeft:      '3px solid #0D9488',
                  borderRadius:    6,
                  padding:         '12px 16px',
                }}
                data-guideline-note
              >
                {currentGuideline.note}
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="flex flex-col gap-6" data-step-body={4}>
              <p className="text-[17px] font-bold text-slate-900">Target journal and author team</p>

              <div className="flex flex-col gap-2.5">
                <p className="text-xs font-semibold text-slate-500">Target journal</p>
                <input
                  type="text"
                  value={journal}
                  onChange={(e) => setJournal(e.target.value)}
                  data-journal-input
                  className="w-full rounded-md bg-white text-sm outline-none"
                  style={{ padding: '10px 12px', border: '1px solid #E2E8F0' }}
                />
                <div className="flex flex-wrap gap-2">
                  {JOURNAL_META.map(text => (
                    <span
                      key={text}
                      className="font-mono text-[11px] font-medium"
                      style={{
                        color:           '#0F766E',
                        backgroundColor: '#F0FDFA',
                        border:          '1px solid #99F6E4',
                        borderRadius:    5,
                        padding:         '4px 8px',
                      }}
                    >
                      {text}
                    </span>
                  ))}
                </div>
                <p className="text-[11px] leading-relaxed text-slate-400">
                  Journal requirements are populated from the ClinWrite.AI journal registry. Fetched just now.
                </p>
              </div>

              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-2" style={{ maxWidth: 240 }}>
                  <p className="text-xs font-semibold text-slate-500">Planned submission date</p>
                  <div
                    className="flex items-center justify-between rounded-md bg-white text-sm"
                    style={{ padding: '10px 12px', border: '1px solid #E2E8F0' }}
                    data-target-date
                  >
                    <span>15 Jan 2027</span>
                    <span
                      className="font-mono font-medium uppercase"
                      style={{ fontSize: 10, letterSpacing: '0.1em', color: '#64748B' }}
                    >
                      Planned
                    </span>
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <p className="text-xs font-semibold text-slate-500">
                    Key message <span className="font-medium text-slate-400">— optional</span>
                  </p>
                  <textarea
                    rows={3}
                    value={keyMessage}
                    onChange={(e) => setKeyMessage(e.target.value)}
                    placeholder="Primary endpoint: Veloricept + Pembrolizumab significantly improves PFS vs pembrolizumab alone…"
                    className="w-full resize-y rounded-md bg-white text-sm leading-relaxed outline-none"
                    style={{ padding: '10px 12px', border: '1px solid #E2E8F0' }}
                    data-key-message
                  />
                </div>
              </div>

              <div className="flex flex-col gap-2.5" data-team-block>
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-xs font-semibold text-slate-500">Author team</p>
                  <span
                    className="font-mono font-medium uppercase text-slate-500"
                    style={{ fontSize: 10, letterSpacing: '0.12em' }}
                  >
                    From project RACI
                  </span>
                </div>
                <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                  <div
                    className="grid gap-4 text-xs font-semibold text-slate-500"
                    style={{
                      gridTemplateColumns: '1.3fr 1fr auto',
                      padding:             '10px 16px',
                      backgroundColor:     '#F8FAFC',
                      borderBottom:        '1px solid #E2E8F0',
                    }}
                  >
                    <div>Role</div><div>Assigned to</div><div>Status</div>
                  </div>
                  {TEAM.map(person => (
                    <div
                      key={person.role}
                      className="grid items-center gap-4 text-[13px]"
                      style={{
                        gridTemplateColumns: '1.3fr 1fr auto',
                        padding:             '12px 16px',
                        borderBottom:        '1px solid #E2E8F0',
                      }}
                      data-team-row={person.role}
                    >
                      <div className="min-w-0">{person.role}</div>
                      <div className="flex min-w-0 items-center gap-2">
                        {person.name && person.initials && (
                          <span
                            className="flex h-[22px] w-[22px] flex-none items-center justify-center rounded-full text-[10px] font-bold"
                            style={{ backgroundColor: '#F1F5F9', color: '#475569' }}
                          >
                            {person.initials}
                          </span>
                        )}
                        <span
                          className="min-w-0"
                          style={{
                            fontWeight: person.name ? 500 : 400,
                            color:      person.name ? '#1E293B' : '#94A3B8',
                          }}
                        >
                          {person.name ?? 'Not assigned'}
                        </span>
                      </div>
                      <div className="justify-self-end">
                        {person.name ? (
                          <span
                            className="inline-flex items-center gap-1.5 rounded-full text-xs font-semibold"
                            style={{ padding: '4px 10px', backgroundColor: '#F0FDF4', color: '#15803D' }}
                          >
                            Platform user ✓
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setInviteOpen(v => !v)}
                            data-invite-toggle
                            className="rounded-md bg-white text-xs font-semibold transition-colors"
                            style={{ padding: '6px 12px', border: '1px solid #0D9488', color: '#0F766E' }}
                          >
                            Invite by email
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                {inviteOpen && (
                  <div
                    className="flex items-center gap-2 rounded-lg"
                    style={{ backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0', padding: 12 }}
                    data-invite-form
                  >
                    <input
                      type="text"
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      placeholder="kol.author@institution.edu"
                      className="min-w-0 flex-1 rounded-md bg-white text-[13px] outline-none"
                      style={{ padding: '9px 12px', border: '1px solid #E2E8F0' }}
                    />
                    <button
                      type="button"
                      onClick={() => { setInviteOpen(false); setInviteEmail('') }}
                      className="flex-none rounded-md text-[13px] font-semibold text-white transition-colors"
                      style={{ height: 36, padding: '0 14px', backgroundColor: '#0D9488' }}
                    >
                      Send invite
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="flex flex-none items-center gap-5"
          style={{ borderTop: '1px solid #E2E8F0', padding: '16px 40px' }}
          data-wizard-footer
        >
          <p className="flex-none font-mono text-[11px] font-medium text-slate-500" style={{ width: 88 }}>
            Step {step} of 4
          </p>
          <div
            className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-[3px]"
            style={{ backgroundColor: '#E2E8F0' }}
            data-progress-track
          >
            <div className="h-full" style={{ width: `${progressPct}%`, backgroundColor: '#0D9488' }} />
          </div>
          <div className="flex flex-none gap-2">
            {step > 1 && (
              <button
                type="button"
                onClick={handleBack}
                data-back
                className="h-9 rounded-md bg-white text-[13px] font-semibold text-slate-900 transition-colors hover:bg-slate-50"
                style={{ padding: '0 14px', border: '1px solid #E2E8F0' }}
              >
                Back
              </button>
            )}
            <button
              type="button"
              onClick={handleNext}
              disabled={nextDisabled || createMut.isPending}
              data-next
              className="h-9 rounded-md text-[13px] font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                padding:         '0 16px',
                backgroundColor: nextDisabled ? '#E2E8F0' : '#0D9488',
                color:           nextDisabled ? '#94A3B8' : '#FFFFFF',
              }}
            >
              {step === 4
                ? (createMut.isPending ? 'Creating…' : 'Create Publication →')
                : 'Next →'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
