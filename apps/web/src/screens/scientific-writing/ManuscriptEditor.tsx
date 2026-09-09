import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { publicationsApi } from '../../api'
import { AIFootprintChip, ResizablePanel } from '../../components/ui'
import type { ResizablePanelApi } from '../../components/ui/ResizablePanel'
import { LiteratureCitationPanel } from '../../panels/LiteratureCitationPanel'
import { usePublicationStore } from '../../modules/scientific-writing/store'
import type { PanelModeB } from '../../modules/scientific-writing/store/publicationStore'

// ============================================================================
// Static config
// ============================================================================

interface SectionDef {
  id:       string
  label:    string
  status:   'complete' | 'active' | 'progress' | 'none'
  kind?:    'methods' | 'results' | 'intro' | 'empty'
  consort?: string
  hint?:    string
  locked?:  boolean
  who?:     { initials: string; bg: string; fg: string; title: string }
  childRows?: { label: string; warn?: boolean; note?: string }[]
}

const SECTIONS: SectionDef[] = [
  { id: 'title',       label: 'Title & authors', status: 'complete' },
  { id: 'abstract',    label: 'Abstract',        status: 'complete' },
  { id: 'intro',       label: 'Introduction',    status: 'progress', kind: 'intro',    consort: 'CONSORT 2010 — introduction' },
  { id: 'methods',     label: 'Methods',         status: 'active',   kind: 'methods',  consort: 'CONSORT 2010 — methods',
    childRows: [
      { label: 'Study design' },
      { label: 'Participants' },
      { label: 'Interventions' },
      { label: 'CONSORT items', warn: true, note: '3 open' },
    ] },
  { id: 'results',     label: 'Results',         status: 'progress', kind: 'results',  consort: 'CONSORT 2010 — results',
    who: { initials: 'PN', bg: '#DBEAFE', fg: '#1D4ED8', title: 'Dr Priya Nair is viewing this section' },
    childRows: [{ label: 'Primary endpoint', note: 'draft' }] },
  { id: 'discussion',  label: 'Discussion',      status: 'none', kind: 'empty', consort: 'CONSORT 2010 — discussion',
    hint: 'Interpretation, limitations and generalisability are drafted here.',
    locked: true,
    who: { initials: 'SC', bg: '#F5F3FF', fg: '#7C3AED', title: 'Locked by Dr Sarah Chen — editing now' } },
  { id: 'conclusion',  label: 'Conclusion',      status: 'none', kind: 'empty', consort: 'CONSORT 2010 — conclusion',
    hint: 'A single paragraph stating the trial conclusion.' },
  { id: 'references',  label: 'References',      status: 'none', kind: 'empty', consort: 'Vancouver style',
    hint: 'References are compiled from inserted citations.' },
  { id: 'disclosures', label: 'Disclosures',     status: 'none', kind: 'empty', consort: 'ICMJE disclosures',
    hint: 'Funding, conflicts of interest and data-sharing statements.' },
]

const STATUS_MARKS: Record<SectionDef['status'], { bg: string; border: string; mark: string }> = {
  complete: { bg: '#16A34A', border: '#16A34A', mark: '✓' },
  active:   { bg: '#0D9488', border: '#0D9488', mark: '' },
  progress: { bg: '#CCFBF1', border: '#0D9488', mark: '' },
  none:     { bg: '#FFFFFF', border: '#CBD5E1', mark: '' },
}

const PRESENCE = [
  { initials: 'MW', bg: '#CCFBF1', fg: '#0F766E', title: 'Marcus Webb — lead medical writer · editing Methods' },
  { initials: 'PN', bg: '#DBEAFE', fg: '#1D4ED8', title: 'Dr Priya Nair — biostatistician · viewing Results' },
  { initials: 'SC', bg: '#F5F3FF', fg: '#7C3AED', title: 'Dr Sarah Chen — publication manager · editing Discussion' },
]

const REVISIONS = [
  { name: 'v0.2 · Draft',              meta: 'Marcus Webb · 22 Oct 2024 09:14 UTC',    state: 'Current',    tone: 'cur' as const },
  { name: 'v0.1 · Co-author review',   meta: 'Dr Sarah Chen · 15 Oct 2024 10:22 UTC',  state: 'Reviewed',   tone: 'rev' as const },
  { name: 'v0.1 · Initial draft',      meta: 'Marcus Webb · 08 Oct 2024 08:20 UTC',    state: 'Superseded', tone: 'old' as const },
]

const REV_TONES = {
  cur: { bg: '#F0FDF4', fg: '#15803D' },
  rev: { bg: '#FFFBEB', fg: '#B45309' },
  old: { bg: '#F1F5F9', fg: '#475569' },
}

const TLFS = [
  { ref: 'Table 14.2.1', title: 'Primary efficacy analysis — PFS, ITT population',        value: 'HR = 0.61 (0.48–0.77)',       changed: true  },
  { ref: 'Figure 11.1',  title: 'Kaplan–Meier plot — progression-free survival',           value: 'Median 14.2 vs 8.7 mo',       changed: false },
  { ref: 'Table 14.3.2', title: 'Treatment-emergent adverse events by grade',              value: 'Grade ≥3: 41.2% vs 33.8%',    changed: false },
  { ref: 'Table 14.2.3', title: 'Sensitivity analysis — prior thoracic radiotherapy',      value: 'HR = 0.64 (0.49–0.83)',       changed: false },
]

const FLAGS = [
  { section: 'Results',  phrase: '"demonstrated superior PFS"', advice: 'Efficacy claim without safety context. Add corresponding safety data or cite CI and p-value.', target: 'results' },
  { section: 'Abstract', phrase: '"well tolerated"',            advice: 'Tolerability claim without grade ≥3 event rates. Cite Table 14.3.2.',                          target: 'abstract' },
]

const CONSORT_ITEMS = [
  { item: '4a',  label: 'Eligibility criteria for participants',                        done: false },
  { item: '4b',  label: 'Settings and locations where data were collected',             done: true  },
  { item: '8a',  label: 'Method used to generate the random allocation sequence',       done: true  },
  { item: '10',  label: 'Who enrolled participants and who assigned them',              done: false },
  { item: '11a', label: 'Blinding — who was blinded after assignment',                  done: true  },
  { item: '12b', label: 'Methods for additional analyses, such as subgroup analyses',   done: false },
]

// (Panel titles are inlined at each panel body's PanelShell prop.)

// ============================================================================
// Subcomponents
// ============================================================================

function TopBar() {
  return (
    <div className="flex flex-none items-center" style={{ height: 56, backgroundColor: '#1E293B' }} data-topbar>
      <div className="flex flex-none items-center gap-2.5" style={{ width: 224, padding: '0 20px' }}>
        <div
          className="flex flex-none items-center justify-center rounded-md text-sm font-extrabold text-white"
          style={{ width: 28, height: 28, backgroundColor: '#0D9488' }}
        >C</div>
        <div className="flex flex-col gap-px">
          <p className="text-sm font-extrabold leading-tight tracking-tight text-white">ClinWrite.AI</p>
          <p className="font-mono text-[9px] font-medium uppercase tracking-widest leading-tight" style={{ color: '#64748B' }}>
            AI-native authoring
          </p>
        </div>
      </div>
      <div className="flex flex-1 min-w-0 items-center gap-4" style={{ padding: '0 20px' }}>
        <div className="flex min-w-0 items-center gap-2 text-[13px]">
          <span style={{ color: '#94A3B8' }}>Projects</span>
          <span style={{ color: '#475569' }}>/</span>
          <span className="font-semibold text-white">VELORA-301</span>
          <span style={{ color: '#475569' }}>/</span>
          <span className="font-semibold text-white">Scientific Writing</span>
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-2 text-xs" style={{ color: '#94A3B8' }}>
          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: '#16A34A' }} />
          Autosaved 09:14 UTC
        </div>
        <div className="flex items-center gap-2.5">
          <div
            className="flex flex-none items-center justify-center rounded-full text-xs font-bold text-white"
            style={{ width: 30, height: 30, backgroundColor: '#334155' }}
          >MW</div>
          <div className="flex flex-col leading-tight">
            <p className="text-[13px] font-semibold text-white">Marcus Webb</p>
            <p className="text-[11px]" style={{ color: '#94A3B8' }}>Lead medical writer</p>
          </div>
        </div>
      </div>
    </div>
  )
}

function IconRail() {
  const items = [
    { key: 'apps',     active: false, path: <><rect x="2" y="2" width="5" height="5" rx="1.2" fill="currentColor" /><rect x="9" y="2" width="5" height="5" rx="1.2" fill="currentColor" /><rect x="2" y="9" width="5" height="5" rx="1.2" fill="currentColor" /><rect x="9" y="9" width="5" height="5" rx="1.2" fill="currentColor" /></> },
    { key: 'document', active: true,  path: <><rect x="2" y="2.4" width="10" height="12" rx="1.4" fill="none" stroke="currentColor" strokeWidth="1.4" /><rect x="4" y="5" width="6" height="1.2" rx="0.6" fill="currentColor" /><rect x="4" y="8" width="6" height="1.2" rx="0.6" fill="currentColor" /><rect x="4" y="11" width="4" height="1.2" rx="0.6" fill="currentColor" /></> },
    { key: 'comments', active: false, path: <><rect x="2" y="3" width="12" height="8.4" rx="2" fill="none" stroke="currentColor" strokeWidth="1.4" /></> },
    { key: 'bell',     active: false, path: <><path d="M4 12h8l-1-2v-3a3 3 0 0 0-6 0v3l-1 2z" fill="none" stroke="currentColor" strokeWidth="1.3" /></> },
  ]
  return (
    <div
      className="flex flex-none flex-col items-center gap-1"
      style={{ width: 56, backgroundColor: '#1E293B', padding: '12px 0' }}
      data-icon-rail
    >
      {items.map(item => (
        <button
          key={item.key}
          type="button"
          className="flex items-center justify-center rounded-md transition-colors"
          style={{
            width:  36,
            height: 36,
            backgroundColor: item.active ? '#334155' : 'transparent',
            color:           item.active ? '#5EEAD4' : '#94A3B8',
          }}
          data-icon-active={item.active || undefined}
          data-icon={item.key}
        >
          <svg width="16" height="16" viewBox="0 0 16 16">{item.path}</svg>
        </button>
      ))}
      <div className="flex-1" />
      <button
        type="button"
        className="flex items-center justify-center rounded-md"
        style={{ width: 36, height: 36, color: '#94A3B8' }}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
          <circle cx="8" cy="8" r="5.4" />
          <circle cx="8" cy="8" r="1.6" fill="currentColor" />
        </svg>
      </button>
    </div>
  )
}

interface SectionNavProps {
  activeSection: string
  onSelect: (id: string) => void
  onOpenConsort: () => void
}
function SectionNav({ activeSection, onSelect, onOpenConsort }: SectionNavProps) {
  return (
    <div
      className="flex flex-none flex-col"
      style={{ width: 224, backgroundColor: '#F8FAFC', borderRight: '1px solid #E2E8F0' }}
      data-section-nav
    >
      <div className="flex-none" style={{ padding: '16px 16px 10px' }}>
        <p className="font-mono text-[11px] font-medium uppercase tracking-widest" style={{ color: '#64748B' }}>
          IMRAD structure
        </p>
      </div>
      <div className="flex-1 flex-col gap-px overflow-y-auto" style={{ padding: '0 8px 12px' }}>
        {SECTIONS.map(section => {
          const isActive = activeSection === section.id
          const mark = STATUS_MARKS[section.status]
          const textColour = section.status === 'none' && !isActive ? '#94A3B8' : '#1E293B'
          return (
            <div key={section.id} className="flex flex-col">
              <button
                type="button"
                onClick={() => onSelect(section.id)}
                data-section-row={section.id}
                data-active={isActive || undefined}
                className="flex items-center gap-2.5 rounded-md text-left transition-colors hover:bg-slate-100"
                style={{
                  padding:         '8px 10px',
                  backgroundColor: isActive ? '#FFFFFF' : 'transparent',
                }}
              >
                <span
                  className="flex flex-none items-center justify-center rounded-full font-extrabold text-white"
                  style={{
                    width:  14, height: 14, fontSize: 9,
                    backgroundColor: mark.bg,
                    border:          `1px solid ${mark.border}`,
                  }}
                  data-status-dot={section.status}
                >
                  {mark.mark}
                </span>
                <span
                  className="min-w-0 flex-1 text-[13px] leading-tight"
                  style={{ color: textColour, fontWeight: isActive ? 600 : 500 }}
                >
                  {section.label}
                </span>
                {section.locked && (
                  <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="#94A3B8" strokeWidth="1.2" className="flex-none">
                    <rect x="2.2" y="5.2" width="7.6" height="5.4" rx="1" />
                    <path d="M4 5.2V3.8a2 2 0 0 1 4 0v1.4" />
                  </svg>
                )}
                {section.who && (
                  <span
                    title={section.who.title}
                    className="flex flex-none items-center justify-center rounded-full font-mono font-bold"
                    style={{ width: 16, height: 16, fontSize: 9, backgroundColor: section.who.bg, color: section.who.fg }}
                  >
                    {section.who.initials}
                  </span>
                )}
              </button>
              {section.childRows && isActive && section.childRows.map((child, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={child.warn ? onOpenConsort : undefined}
                  className="flex items-center gap-2 rounded-md text-left transition-colors hover:bg-slate-100"
                  style={{ padding: '6px 10px 6px 33px' }}
                  data-child-row={child.label}
                >
                  {child.warn && (
                    <span
                      className="flex flex-none items-center justify-center rounded font-extrabold text-white"
                      style={{ width: 14, height: 14, fontSize: 9, backgroundColor: '#D97706' }}
                    >!</span>
                  )}
                  <span className="min-w-0 flex-1 text-xs" style={{ color: child.warn ? '#B45309' : '#64748B' }}>
                    {child.label}
                  </span>
                  {child.note && (
                    <span className="flex-none text-[11px]" style={{ color: child.warn ? '#B45309' : '#94A3B8' }}>
                      {child.note}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )
        })}
      </div>
      <div className="flex flex-none flex-col gap-2" style={{ padding: '12px 16px', borderTop: '1px solid #E2E8F0' }}>
        <p className="font-mono text-[10px] font-medium uppercase tracking-widest" style={{ color: '#64748B' }}>
          CONSORT 2010 · 18/25 items
        </p>
        <div className="h-1 overflow-hidden rounded-[2px]" style={{ backgroundColor: '#E2E8F0' }}>
          <div className="h-full" style={{ width: '72%', backgroundColor: '#0D9488' }} />
        </div>
        <button
          type="button"
          onClick={onOpenConsort}
          data-open-consort
          className="text-left text-[11px] font-semibold"
          style={{ color: '#B45309' }}
        >
          3 items incomplete in Methods
        </button>
      </div>
    </div>
  )
}

// --- Right panel bodies ---

function FootprintBody({ documentId, api }: { documentId: string; api: ResizablePanelApi }) {
  const { data } = useQuery({
    queryKey: ['footprint', documentId],
    queryFn:  () => publicationsApi.getFootprint(documentId),
    enabled:  !!documentId,
  })
  const total     = data?.totalAiPercent    ?? 34
  const breakdown = data?.breakdown ?? []

  return (
    <PanelShell title="AI footprint" mode="footprint" api={api}>
      <div className="flex flex-col items-center gap-3" data-footprint-body>
        <div
          className="relative flex items-center justify-center rounded-full"
          style={{ width: 132, height: 132, background: `conic-gradient(#0D9488 0% ${total}%, #E2E8F0 ${total}% 100%)` }}
        >
          <div
            className="flex flex-col items-center justify-center rounded-full bg-white"
            style={{ width: 92, height: 92 }}
          >
            <p className="text-[22px] font-bold" style={{ color: '#0D9488' }}>{total}%</p>
            <p className="font-mono text-[9px] font-medium uppercase tracking-widest" style={{ color: '#64748B' }}>AI</p>
          </div>
        </div>
        <p className="text-[13px] font-semibold">{total}% AI-assisted · {100 - total}% human-authored</p>
      </div>

      <div className="flex flex-col gap-2">
        <p className="font-mono text-[10px] font-medium uppercase tracking-widest" style={{ color: '#64748B' }}>
          By section
        </p>
        {breakdown.map(row => (
          <div key={row.label} className="flex flex-col gap-1" data-footprint-row={row.label}>
            <div className="flex items-baseline justify-between">
              <p className="text-xs font-semibold">{row.label}</p>
              <p className="font-mono text-[11px] font-medium" style={{ color: '#64748B' }}>
                {row.aiPercent}% AI · {100 - row.aiPercent}% human
              </p>
            </div>
            <div className="h-1.5 overflow-hidden rounded-[3px]" style={{ backgroundColor: '#E2E8F0' }}>
              <div className="h-full" style={{ width: `${row.aiPercent}%`, backgroundColor: '#0D9488' }} />
            </div>
          </div>
        ))}
      </div>

      <p
        className="font-mono text-[10px] leading-relaxed"
        style={{ color: '#64748B', backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 6, padding: 10 }}
      >
        AI footprint is immutable. To reduce AI%, edit AI-drafted passages and replace with human-authored text.
      </p>
    </PanelShell>
  )
}

function SuggestBody({ api, onAccept }: { api: ResizablePanelApi; onAccept: () => void }) {
  return (
    <PanelShell title="AI suggest" mode="suggest" api={api}>
      <div className="flex flex-col gap-1" data-suggest-body>
        <p className="font-mono text-[10px] font-medium uppercase tracking-widest" style={{ color: '#64748B' }}>
          Suggestion
        </p>
        <p className="text-xs" style={{ color: '#94A3B8' }}>Generated 09:12 UTC · claude-sonnet-4</p>
      </div>
      <div
        className="text-[13px] leading-relaxed"
        style={{ borderLeft: '3px solid #93C5FD', backgroundColor: '#F0F7FF', borderRadius: '0 4px 4px 0', padding: 12 }}
      >
        Sensitivity analysis restricted to patients with prior thoracic radiotherapy showed a consistent PFS benefit (HR 0.64; 95% CI 0.49–0.83). This subgroup finding supports the primary analysis.
      </div>
      <p className="text-xs italic" style={{ color: '#64748B' }}>Sources: Table 14.2.3 · SAP v2.0 §6.3</p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onAccept}
          data-suggest-accept
          className="flex-1 rounded-md text-xs font-semibold text-white transition-colors"
          style={{ height: 34, backgroundColor: '#0D9488' }}
        >
          Accept
        </button>
        <button
          type="button"
          className="flex-1 rounded-md bg-white text-xs font-semibold text-slate-900 transition-colors"
          style={{ height: 34, border: '1px solid #E2E8F0' }}
        >
          Discard
        </button>
      </div>
      <p className="text-[11px] leading-relaxed" style={{ color: '#94A3B8' }}>
        Accepting records AI provenance to the audit trail and updates the AI footprint.
      </p>
    </PanelShell>
  )
}

function TLFBody({ api }: { api: ResizablePanelApi }) {
  return (
    <PanelShell title="TLF reference" mode="tlf" api={api}>
      <div
        className="flex items-start gap-2.5 rounded-md"
        style={{ backgroundColor: '#FFFBEB', border: '1px solid #FDE68A', padding: '10px 12px' }}
        data-tlf-update-banner
      >
        <span className="mt-1 h-1.5 w-1.5 flex-none rounded-full" style={{ backgroundColor: '#D97706' }} />
        <p className="text-xs leading-relaxed">
          <span className="font-bold">TLF updated — review references.</span>{' '}
          TLF package v3 was revised in Clinical Writing on 21 Oct 2024, after this manuscript last referenced it.
        </p>
      </div>
      <p className="font-mono text-[10px] font-medium" style={{ color: '#64748B' }}>Linked package · TLF v3</p>
      <div className="flex flex-col gap-2" data-tlf-body>
        {TLFS.map(t => (
          <div
            key={t.ref}
            className="flex flex-col gap-1.5 rounded-md bg-white"
            style={{ border: '1px solid #E2E8F0', padding: 10 }}
            data-tlf-item={t.ref}
          >
            <div className="flex items-center gap-2">
              <p className="text-xs font-bold">{t.ref}</p>
              {t.changed && (
                <span
                  className="font-mono font-medium uppercase"
                  style={{
                    fontSize: 9, color: '#B45309', backgroundColor: '#FFFBEB',
                    border: '1px solid #FDE68A', borderRadius: 3, padding: '2px 5px',
                  }}
                  data-tlf-changed
                >
                  CHANGED
                </span>
              )}
            </div>
            <p className="text-[11px] leading-relaxed" style={{ color: '#64748B' }}>{t.title}</p>
            <span
              className="self-start font-mono text-[10px] font-medium"
              style={{ color: '#1E293B', backgroundColor: '#F8FAFC', borderRadius: 3, padding: '3px 6px' }}
            >
              {t.value}
            </span>
            <button type="button" className="self-start text-[11px] font-semibold" style={{ color: '#0F766E' }}>
              Reference
            </button>
          </div>
        ))}
      </div>
    </PanelShell>
  )
}

function BalanceBody({ api }: { api: ResizablePanelApi }) {
  return (
    <PanelShell title="Fair balance" mode="balance" api={api}>
      <div className="flex items-baseline gap-2" data-balance-body>
        <p className="text-[22px] font-bold" style={{ color: '#B45309' }}>{FLAGS.length}</p>
        <p className="text-xs" style={{ color: '#64748B' }}>advisory flags · none blocking</p>
      </div>
      <div className="flex flex-col gap-2">
        {FLAGS.map((flag, i) => (
          <div
            key={i}
            className="flex flex-col gap-1.5 rounded-md"
            style={{
              backgroundColor: '#FFFBEB',
              border:          '1px solid #FDE68A',
              borderLeft:      '3px solid #D97706',
              padding:         '10px 12px',
            }}
            data-balance-flag={flag.target}
          >
            <p className="font-mono text-[10px] font-medium uppercase" style={{ color: '#B45309' }}>{flag.section}</p>
            <p className="text-xs font-bold">{flag.phrase}</p>
            <p className="text-xs leading-relaxed" style={{ color: '#475569' }}>{flag.advice}</p>
            <button type="button" className="self-start text-[11px] font-semibold" style={{ color: '#0F766E' }}>
              Go to flag
            </button>
          </div>
        ))}
      </div>
      <p className="text-[11px] leading-relaxed" style={{ color: '#94A3B8' }}>
        Fair-balance flags are advisory. They do not block submission for review, and each resolution is recorded in the audit trail.
      </p>
    </PanelShell>
  )
}

function ConsortBody({ api }: { api: ResizablePanelApi }) {
  return (
    <PanelShell title="CONSORT 2010 items" mode="consort" api={api}>
      <div className="flex flex-col gap-1.5" data-consort-body>
        <p className="font-mono text-[10px] font-medium" style={{ color: '#64748B' }}>CONSORT 2010 · 18/25 items</p>
        <div className="h-1 overflow-hidden rounded-[2px]" style={{ backgroundColor: '#E2E8F0' }}>
          <div className="h-full" style={{ width: '72%', backgroundColor: '#0D9488' }} />
        </div>
      </div>
      <div className="flex flex-col gap-2">
        {CONSORT_ITEMS.map(item => (
          <div
            key={item.item}
            className="flex flex-col gap-1.5 rounded-md bg-white"
            style={{ border: '1px solid #E2E8F0', padding: 10 }}
            data-consort-item={item.item}
            data-consort-done={item.done || undefined}
          >
            <div className="flex items-center gap-2">
              <span
                className="flex flex-none items-center justify-center rounded font-extrabold text-white"
                style={{
                  width: 14, height: 14, fontSize: 9,
                  backgroundColor: item.done ? '#16A34A' : '#D97706',
                  border:          `1px solid ${item.done ? '#16A34A' : '#D97706'}`,
                }}
              >
                {item.done ? '✓' : '!'}
              </span>
              <p className="font-mono text-[10px] font-medium" style={{ color: '#64748B' }}>Item {item.item}</p>
            </div>
            <p className="text-xs font-semibold leading-relaxed">{item.label}</p>
          </div>
        ))}
      </div>
    </PanelShell>
  )
}

interface PanelShellProps {
  title:  string
  mode:   NonNullable<PanelModeB>
  api:    ResizablePanelApi
  children: React.ReactNode
}
function PanelShell({ title, mode, api, children }: PanelShellProps) {
  const setActivePanel = usePublicationStore(s => s.setActivePanel)
  return (
    <>
      <div
        className="flex flex-none items-center gap-2.5"
        style={{ padding: '14px 16px', borderBottom: '1px solid #E2E8F0' }}
        data-panel-header={mode}
      >
        <p className="min-w-0 flex-1 text-[13px] font-bold">{title}</p>
        <button
          type="button"
          onClick={api.widen}
          data-panel-widen
          title="Widen"
          className="flex items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100"
          style={{ width: 24, height: 24 }}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4">
            <polyline points="9,2 12,2 12,5" strokeLinecap="round" />
            <polyline points="5,12 2,12 2,9"  strokeLinecap="round" />
          </svg>
        </button>
        <button
          type="button"
          onClick={api.narrow}
          data-panel-narrow
          title="Narrow"
          className="flex items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100"
          style={{ width: 24, height: 24 }}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4">
            <polyline points="6,2 6,5 9,5" strokeLinecap="round" />
            <polyline points="8,12 8,9 5,9" strokeLinecap="round" />
          </svg>
        </button>
        <button
          type="button"
          onClick={() => setActivePanel(null)}
          data-panel-close
          className="flex items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
          style={{ width: 24, height: 24, fontSize: 15 }}
        >
          ×
        </button>
      </div>
      <div className="flex flex-1 min-h-0 flex-col gap-4 overflow-y-auto" style={{ padding: 16 }}>
        {children}
      </div>
    </>
  )
}

// ============================================================================
// Main screen
// ============================================================================

export function ManuscriptEditor() {
  const { projectId, publicationId } = useParams()
  const navigate                     = useNavigate()

  const activePanel     = usePublicationStore(s => s.activePanel)
  const setActivePanel  = usePublicationStore(s => s.setActivePanel)
  const setPanelWidth   = usePublicationStore(s => s.setPanelWidth)

  const [activeSection, setActiveSection] = useState('methods')
  const [highlightAi]                     = useState(true)
  const [trackChanges, setTrackChanges]   = useState(false)
  const [revOpen, setRevOpen]             = useState(false)
  const [rev, setRev]                     = useState('v0.2 · Draft')
  const [compareActive, setCompareActive] = useState(false)
  const [balanceTip, setBalanceTip]       = useState(false)
  const [barWidth, setBarWidth]           = useState(1160)
  const [moreOpen, setMoreOpen]           = useState(false)

  const barRef = useRef<HTMLDivElement | null>(null)

  const { data: publication } = useQuery({
    queryKey: ['publication', publicationId],
    queryFn:  () => publicationsApi.get(publicationId!),
    enabled:  !!publicationId,
  })

  const activeSectionDef = useMemo(
    () => SECTIONS.find(s => s.id === activeSection) ?? SECTIONS[3],
    [activeSection],
  )

  // ResizeObserver on formatting toolbar → density level
  useEffect(() => {
    if (!barRef.current) return
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) setBarWidth(entry.contentRect.width)
    })
    ro.observe(barRef.current)
    return () => ro.disconnect()
  }, [])

  const level =
    barWidth >= 765 ? 0 :
    barWidth >= 453 ? 1 :
    barWidth >= 321 ? 2 : 3

  const showLabels        = level === 0
  const showFormats       = level <= 1
  const showBasics        = level <= 2

  const panelOpen = activePanel !== null
  const panelReservedWidth = panelOpen ? usePublicationStore.getState().panelWidth : 0

  const handlePanelWidth = (w: number) => {
    setPanelWidth(w)
    // Update toolbar padding-right so it doesn't underflow the panel
    if (barRef.current?.parentElement) {
      barRef.current.parentElement.style.paddingRight = `${w + 16}px`
    }
  }

  useEffect(() => {
    // Reset toolbar padding when panel is closed
    if (!panelOpen && barRef.current?.parentElement) {
      barRef.current.parentElement.style.paddingRight = '16px'
    }
  }, [panelOpen])

  const handleAcceptSuggestion = () => {
    setActivePanel('footprint')
  }

  const handleExitEditor = () => {
    navigate(`/projects/${projectId}/scientific-writing`)
  }

  return (
    <div
      className="absolute inset-0 flex flex-col overflow-hidden bg-white"
      style={{ zIndex: 40 }}
      data-screen="manuscript-editor"
    >
      <TopBar />
      <div className="flex flex-1 min-h-0">
        <IconRail />
        <SectionNav
          activeSection={activeSection}
          onSelect={setActiveSection}
          onOpenConsort={() => setActivePanel('consort')}
        />

        {/* Editor column */}
        <div className="relative flex flex-1 min-w-0 flex-col bg-white" data-editor-column>

          {/* Publication toolbar */}
          <div
            className="flex flex-none items-center gap-4"
            style={{ height: 56, borderBottom: '1px solid #E2E8F0', padding: '0 24px' }}
            data-publication-toolbar
          >
            <p className="min-w-0 flex-none overflow-hidden text-ellipsis whitespace-nowrap text-sm font-semibold" style={{ maxWidth: 360 }}>
              {publication?.title ?? 'Phase III NSCLC — Primary Efficacy Results: Veloricept + Pembrolizumab'}
            </p>
            <span
              className="flex-none rounded-full font-semibold"
              style={{ padding: '4px 10px', backgroundColor: '#EFF6FF', color: '#2563EB', fontSize: 12 }}
            >
              In Authoring
            </span>

            {/* Revision picker */}
            <div className="relative flex-none">
              <button
                type="button"
                onClick={() => setRevOpen(v => !v)}
                data-rev-toggle
                className="flex items-center gap-1.5 rounded-md bg-white text-slate-500 hover:bg-slate-50 transition-colors"
                style={{ padding: '5px 9px', border: '1px solid #E2E8F0' }}
              >
                <span className="font-mono text-[11px] font-medium">{rev}</span>
                <svg width="9" height="9" viewBox="0 0 10 10"><polygon points="1,3 9,3 5,8" fill="#64748B" /></svg>
              </button>
              {revOpen && (
                <div
                  className="absolute z-40 flex flex-col gap-0.5 rounded-lg bg-white p-1.5"
                  style={{
                    top: '100%', marginTop: 6, width: 330,
                    border: '1px solid #E2E8F0',
                    boxShadow: '0 12px 28px rgba(15,23,42,0.14)',
                  }}
                  data-rev-menu
                >
                  <p className="font-mono text-[10px] font-medium uppercase tracking-widest" style={{ color: '#64748B', padding: '4px 10px' }}>
                    Revisions
                  </p>
                  {REVISIONS.map(r => {
                    const tone = REV_TONES[r.tone]
                    return (
                      <button
                        key={r.name}
                        type="button"
                        onClick={() => { setRev(r.name); setRevOpen(false) }}
                        data-rev-option={r.name}
                        className="flex items-center justify-between gap-3 rounded-md p-2 hover:bg-slate-50"
                        style={{ backgroundColor: rev === r.name ? '#F8FAFC' : 'transparent' }}
                      >
                        <div className="flex min-w-0 flex-col items-start">
                          <p className="font-mono text-xs font-medium">{r.name}</p>
                          <p className="text-[11px]" style={{ color: '#64748B' }}>{r.meta}</p>
                        </div>
                        <span
                          className="flex-none rounded-full text-[10px] font-semibold"
                          style={{ padding: '2px 7px', backgroundColor: tone.bg, color: tone.fg }}
                        >
                          {r.state}
                        </span>
                      </button>
                    )
                  })}
                  <div className="h-px" style={{ backgroundColor: '#E2E8F0' }} />
                  <button
                    type="button"
                    onClick={() => { setCompareActive(true); setRevOpen(false) }}
                    data-rev-compare
                    className="flex items-center gap-2 rounded-md p-2 text-left text-xs hover:bg-slate-50"
                    style={{ color: '#0F766E' }}
                  >
                    Compare revisions…
                  </button>
                </div>
              )}
            </div>

            <div className="flex-1" />

            {/* Presence stack */}
            <div className="flex flex-none items-center">
              {PRESENCE.map((p, i) => (
                <div
                  key={p.initials}
                  title={p.title}
                  className="flex flex-none items-center justify-center rounded-full font-mono font-bold"
                  style={{
                    width: 24, height: 24, fontSize: 10,
                    backgroundColor: p.bg, color: p.fg,
                    border: '2px solid #FFFFFF',
                    marginLeft: i === 0 ? 0 : -6,
                    zIndex: PRESENCE.length - i,
                  }}
                >
                  {p.initials}
                </div>
              ))}
            </div>

            <span className="h-5 w-px" style={{ backgroundColor: '#E2E8F0' }} />

            <button
              type="button"
              onClick={() => setActivePanel('footprint')}
              data-footprint-chip-trigger
              className="rounded-full"
              style={{ padding: 0, border: 'none', background: 'transparent' }}
            >
              <AIFootprintChip aiPercent={34} label="34% AI · 66% human" />
            </button>

            <button
              type="button"
              onClick={handleExitEditor}
              data-submit-review
              className="rounded-md text-[13px] font-semibold text-white transition-colors"
              style={{ height: 36, padding: '0 14px', backgroundColor: '#0D9488' }}
            >
              Submit for review →
            </button>
          </div>

          {/* Compare banner */}
          {compareActive && (
            <div
              className="flex flex-none items-center gap-3"
              style={{ backgroundColor: '#F0FDFA', borderBottom: '1px solid #99F6E4', padding: '10px 24px' }}
              data-compare-banner
            >
              <span
                className="flex flex-none items-center justify-center rounded-full text-white font-extrabold"
                style={{ width: 16, height: 16, fontSize: 10, backgroundColor: '#0D9488' }}
              >
                i
              </span>
              <p className="min-w-0 flex-1 text-[13px]">
                Comparing <span className="font-mono text-xs">v0.1</span> → <span className="font-mono text-xs">v0.2</span> · 14 insertions, 3 deletions across Methods and Results · read-only
              </p>
              <button
                type="button"
                onClick={() => setCompareActive(false)}
                className="text-xs font-semibold"
                style={{ color: '#0F766E' }}
              >
                Exit compare
              </button>
            </div>
          )}

          {/* Formatting toolbar */}
          <div
            className="flex flex-none items-center gap-2 relative"
            style={{ height: 48, borderBottom: '1px solid #E2E8F0', padding: '0 16px' }}
            data-formatting-toolbar
          >
            <div ref={barRef} className="flex flex-1 min-w-0 items-center gap-2" data-toolbar-inner data-density={level}>
              {showBasics && (
                <>
                  <ToolButton label="B" title="Bold" />
                  <ToolButton label="I" title="Italic" italic />
                </>
              )}
              {showFormats && (
                <>
                  <Divider />
                  <ToolButton label="H1" title="Heading 1" />
                  <ToolButton label="H2" title="Heading 2" />
                </>
              )}
              <Divider />
              <ToolChip
                active={activePanel === 'suggest'}
                onClick={() => setActivePanel(activePanel === 'suggest' ? null : 'suggest')}
                data-tool="ai-suggest"
                bg={activePanel === 'suggest' ? '#0D9488' : '#F0FDFA'}
                fg={activePanel === 'suggest' ? '#FFFFFF' : '#0F766E'}
                border={activePanel === 'suggest' ? '#0D9488' : '#99F6E4'}
                label={showLabels ? 'AI suggest' : undefined}
                icon={
                  <svg width="12" height="12" viewBox="0 0 14 14"><polygon points="7,1.2 8.6,5.4 12.8,7 8.6,8.6 7,12.8 5.4,8.6 1.2,7 5.4,5.4" fill="currentColor" /></svg>
                }
              />
              <ToolChip
                active={activePanel === 'literature'}
                onClick={() => setActivePanel(activePanel === 'literature' ? null : 'literature')}
                data-tool="literature"
                bg={activePanel === 'literature' ? '#475569' : '#FFFFFF'}
                fg={activePanel === 'literature' ? '#FFFFFF' : '#475569'}
                border={activePanel === 'literature' ? '#475569' : '#E2E8F0'}
                label={showLabels ? 'Literature' : undefined}
                icon={
                  <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3">
                    <rect x="2" y="2" width="4" height="10" rx="0.8" />
                    <rect x="8" y="2" width="4" height="10" rx="0.8" />
                  </svg>
                }
              />
              <ToolChip
                active={activePanel === 'tlf'}
                onClick={() => setActivePanel(activePanel === 'tlf' ? null : 'tlf')}
                data-tool="tlf"
                bg={activePanel === 'tlf' ? '#475569' : '#FFFFFF'}
                fg={activePanel === 'tlf' ? '#FFFFFF' : '#475569'}
                border={activePanel === 'tlf' ? '#475569' : '#E2E8F0'}
                label={showLabels ? 'TLF reference' : undefined}
                notification
                icon={
                  <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3">
                    <rect x="1.4" y="1.8" width="11.2" height="10.4" rx="1.2" />
                    <line x1="1.4" y1="5" x2="12.6" y2="5" />
                  </svg>
                }
              />
              <ToolChip
                active={activePanel === 'balance'}
                onClick={() => setActivePanel(activePanel === 'balance' ? null : 'balance')}
                data-tool="balance"
                bg={activePanel === 'balance' ? '#475569' : '#FFFFFF'}
                fg={activePanel === 'balance' ? '#FFFFFF' : '#475569'}
                border={activePanel === 'balance' ? '#475569' : '#E2E8F0'}
                label={showLabels ? 'Fair balance' : undefined}
                icon={
                  <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3">
                    <line x1="7" y1="2" x2="7" y2="12" />
                    <line x1="3" y1="4" x2="11" y2="4" />
                  </svg>
                }
              />
            </div>
            <div className="relative flex-none">
              <button
                type="button"
                onClick={() => setMoreOpen(v => !v)}
                data-more-toggle
                className="flex items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100"
                style={{
                  width: 30, height: 30, fontSize: 15, fontWeight: 700,
                  backgroundColor: moreOpen ? '#F1F5F9' : 'transparent',
                }}
              >
                ⋯
              </button>
              {moreOpen && (
                <div
                  className="absolute z-30 flex flex-col gap-0.5 rounded-lg bg-white p-1.5"
                  style={{
                    top: 40, right: 0, width: 252,
                    border: '1px solid #E2E8F0',
                    boxShadow: '0 12px 28px rgba(15,23,42,0.12)',
                  }}
                  data-more-menu
                >
                  <p className="font-mono text-[10px] font-medium uppercase tracking-widest" style={{ color: '#64748B', padding: '6px 10px 4px' }}>
                    Document tools
                  </p>
                  <div className="flex items-center justify-between rounded-md text-[13px] hover:bg-slate-50" style={{ padding: '9px 10px' }}>
                    <span>Reference style</span>
                    <span className="font-mono text-[10px] font-medium" style={{ color: '#64748B' }}>Vancouver ▾</span>
                  </div>
                  <button type="button" className="flex items-center rounded-md text-left text-[13px] hover:bg-slate-50" style={{ padding: '9px 10px' }}>
                    Add comment
                  </button>
                  <button
                    type="button"
                    onClick={() => setTrackChanges(v => !v)}
                    data-track-toggle
                    className="flex items-center justify-between rounded-md text-[13px] hover:bg-slate-50"
                    style={{ padding: '9px 10px' }}
                  >
                    <span>Track changes</span>
                    <span
                      className="flex items-center"
                      style={{
                        width: 32, height: 18, borderRadius: 999, padding: 2,
                        backgroundColor: trackChanges ? '#0D9488' : '#CBD5E1',
                        justifyContent: trackChanges ? 'flex-end' : 'flex-start',
                      }}
                    >
                      <span className="block rounded-full bg-white" style={{ width: 14, height: 14 }} />
                    </span>
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Canvas */}
          <div className="flex-1 overflow-y-auto" data-canvas>
            <div className="flex flex-col gap-5" style={{ maxWidth: 780, padding: '32px 48px 48px' }}>
              <div className="flex items-center gap-3">
                <h2 className="text-lg font-bold tracking-tight">{activeSectionDef.label}</h2>
                {activeSectionDef.consort && (
                  <span
                    className="font-mono font-medium uppercase"
                    style={{
                      fontSize: 9, letterSpacing: '0.1em',
                      backgroundColor: '#F0FDFA', border: '1px solid #99F6E4', color: '#0F766E',
                      borderRadius: 999, padding: '4px 9px',
                    }}
                    data-consort-badge
                  >
                    {activeSectionDef.consort}
                  </span>
                )}
              </div>

              {activeSectionDef.kind === 'methods' && (
                <>
                  <p className="text-sm leading-relaxed">
                    <span className="font-bold">Study design.</span> This was a randomised, double-blind, placebo-controlled, phase III trial conducted at 142 sites in 24 countries between March 2022 and September 2024.
                  </p>
                  {highlightAi && (
                    <div
                      className="relative"
                      style={{
                        borderLeft:      '3px solid #93C5FD',
                        backgroundColor: '#F0F7FF',
                        borderRadius:    '0 4px 4px 0',
                        padding:         '12px 16px',
                      }}
                      data-ai-paragraph
                    >
                      <span
                        className="absolute font-mono font-medium"
                        style={{
                          top: 10, right: 10, fontSize: 9,
                          color: '#1D4ED8', backgroundColor: '#DBEAFE',
                          borderRadius: 4, padding: '4px 7px',
                        }}
                        data-ai-badge
                      >
                        AI
                      </span>
                      <p className="text-sm leading-relaxed" style={{ paddingRight: 44 }}>
                        Randomisation was performed by an interactive web-response system on{' '}
                        <span style={{ borderBottom: '1.5px solid #93C5FD', cursor: 'pointer' }}>22 Oct 2024</span> and stratified by PD-L1 tumour proportion score and prior thoracic radiotherapy. Masking was maintained for participants, investigators and outcome adjudicators.
                      </p>
                    </div>
                  )}
                </>
              )}

              {activeSectionDef.kind === 'results' && (
                <>
                  <p className="text-sm leading-relaxed">
                    In the intent-to-treat population, veloricept plus pembrolizumab{' '}
                    <button
                      type="button"
                      onClick={() => setBalanceTip(v => !v)}
                      data-balance-underline
                      style={{
                        borderBottom: '2px solid #D97706',
                        backgroundColor: '#FFFBEB',
                        cursor: 'pointer',
                        padding: '1px 2px',
                      }}
                    >
                      demonstrated superior PFS
                    </button>
                    {' '}versus placebo plus pembrolizumab.
                  </p>
                  {balanceTip && (
                    <div
                      className="flex items-start gap-2.5 rounded-md"
                      style={{
                        backgroundColor: '#FFFBEB',
                        border:          '1px solid #FDE68A',
                        borderLeft:      '3px solid #D97706',
                        padding:         '12px 14px',
                        maxWidth:        520,
                      }}
                      data-balance-inline
                    >
                      <span
                        className="flex flex-none items-center justify-center rounded font-extrabold text-white"
                        style={{ width: 18, height: 18, fontSize: 10, backgroundColor: '#D97706' }}
                      >!</span>
                      <div className="flex flex-col gap-1.5">
                        <p className="text-xs font-bold">Fair balance: efficacy claim without safety context</p>
                        <p className="text-xs leading-relaxed" style={{ color: '#475569' }}>
                          Add corresponding safety data, or cite the confidence interval and p-value alongside the claim.
                        </p>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            className="rounded-md bg-white text-xs font-semibold"
                            style={{ padding: '6px 11px', border: '1px solid #E2E8F0' }}
                          >
                            Insert CI and p-value
                          </button>
                          <button
                            type="button"
                            onClick={() => setBalanceTip(false)}
                            className="rounded-md bg-white text-xs font-semibold"
                            style={{ padding: '6px 11px', border: '1px solid #E2E8F0' }}
                          >
                            Mark as reviewed
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                  {/* TLF embed card */}
                  <div
                    className="flex flex-col gap-2 rounded-md bg-white"
                    style={{ border: '1px solid #E2E8F0', padding: 12 }}
                    data-tlf-embed
                  >
                    <div className="flex items-center gap-2">
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="#0D9488" strokeWidth="1.4">
                        <rect x="1.4" y="1.8" width="11.2" height="10.4" rx="1.2" />
                        <line x1="1.4" y1="5" x2="12.6" y2="5" />
                      </svg>
                      <p className="text-xs font-bold">Table 14.2.1</p>
                      <div className="flex-1" />
                      <button type="button" className="text-xs font-semibold" style={{ color: '#0F766E' }}>View source</button>
                    </div>
                    <p className="text-xs" style={{ color: '#64748B' }}>TLF package v3 · Primary efficacy analysis · Clinical Writing</p>
                    <span
                      className="self-start font-mono text-xs"
                      style={{ color: '#1E293B', backgroundColor: '#F8FAFC', borderRadius: 4, padding: '4px 8px' }}
                    >
                      HR = 0.61 (95% CI 0.48–0.77)
                    </span>
                  </div>
                </>
              )}

              {activeSectionDef.kind === 'empty' && (
                <div className="flex flex-col gap-3">
                  <p className="text-sm" style={{ color: '#94A3B8' }}>
                    This section has not been started. {activeSectionDef.hint}
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="flex items-center gap-1.5 rounded-md bg-white text-[13px] font-semibold"
                      style={{ height: 36, padding: '0 14px', border: '1px solid #BFDBFE', color: '#1D4ED8' }}
                    >
                      <svg width="12" height="12" viewBox="0 0 14 14"><polygon points="7,1.2 8.6,5.4 12.8,7 8.6,8.6 7,12.8 5.4,8.6 1.2,7 5.4,5.4" fill="currentColor" /></svg>
                      Draft with AI
                    </button>
                    <button
                      type="button"
                      className="rounded-md bg-white text-[13px] font-semibold text-slate-900"
                      style={{ height: 36, padding: '0 14px', border: '1px solid #E2E8F0' }}
                    >
                      Start writing
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Footer strip */}
          <div
            className="flex flex-none items-center gap-3"
            style={{ backgroundColor: '#F8FAFC', borderTop: '1px solid #E2E8F0', padding: '10px 24px' }}
            data-provenance
          >
            <p className="min-w-0 flex-1 text-xs" style={{ color: '#64748B' }}>
              {activeSectionDef.label} · edits, provenance and audit trail follow this section.
            </p>
            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: '#16A34A' }} />
            <p className="text-xs" style={{ color: '#64748B' }}>All changes autosaved 09:14 UTC</p>
          </div>

          {/* Right panel (ResizablePanel absolute overlay) */}
          {panelOpen && activePanel && (
            <ResizablePanel
              defaultWidth={panelReservedWidth || 280}
              topOffset={56}
              onWidthChange={handlePanelWidth}
            >
              {(api) => (
                <>
                  {activePanel === 'footprint'  && <FootprintBody documentId={publicationId ?? ''} api={api} />}
                  {activePanel === 'suggest'    && <SuggestBody   api={api} onAccept={handleAcceptSuggestion} />}
                  {activePanel === 'literature' && <LiteratureCitationPanel publicationId={publicationId ?? ''} api={api} />}
                  {activePanel === 'tlf'        && <TLFBody       api={api} />}
                  {activePanel === 'balance'    && <BalanceBody   api={api} />}
                  {activePanel === 'consort'    && <ConsortBody   api={api} />}
                </>
              )}
            </ResizablePanel>
          )}
        </div>
      </div>
    </div>
  )
}

// --- Toolbar helpers ---

function ToolButton({ label, title, italic }: { label: string; title: string; italic?: boolean }) {
  return (
    <button
      type="button"
      title={title}
      className="flex flex-none items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100"
      style={{ height: 30, minWidth: 30, padding: '0 8px' }}
    >
      <span className="text-sm font-bold" style={{ fontStyle: italic ? 'italic' : undefined }}>{label}</span>
    </button>
  )
}

function Divider() {
  return <span className="h-6 w-px flex-none" style={{ backgroundColor: '#E2E8F0' }} />
}

interface ToolChipProps {
  active?:      boolean
  onClick?:     () => void
  bg:           string
  fg:           string
  border:       string
  label?:       string
  icon:         React.ReactNode
  notification?: boolean
  'data-tool':  string
}
function ToolChip({ active, onClick, bg, fg, border, label, icon, notification, ...rest }: ToolChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-active={active || undefined}
      className="relative flex flex-none items-center gap-1.5 rounded-md text-xs font-semibold transition-colors"
      style={{ height: 30, padding: label ? '0 10px' : 0, minWidth: 30, backgroundColor: bg, color: fg, border: `1px solid ${border}` }}
      {...rest}
    >
      {icon}
      {label}
      {notification && (
        <span
          className="absolute rounded-full"
          style={{
            top: -3, right: -3, width: 9, height: 9,
            backgroundColor: '#D97706',
            border: '1.5px solid #FFFFFF',
          }}
        />
      )}
    </button>
  )
}
