import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { AuditEntry } from '@platform/types'
import { documentsApi } from '../api'

interface Props {
  documentId: string
}

type FilterKey = 'all' | 'edits' | 'ai' | 'comments' | 'signatures'
type EventType = AuditEntry['eventType']

// Which event types belong to each filter chip
const FILTER_MAP: Record<FilterKey, EventType[] | 'all'> = {
  all:        'all',
  edits:      ['content-edited', 'version-restore'],
  ai:         ['ai-draft', 'qa-review-completed'],
  comments:   ['comment-added', 'comment-resolved'],
  signatures: ['document-signed'],
}

const FILTER_CHIPS: { key: FilterKey; label: string }[] = [
  { key: 'all',        label: 'All' },
  { key: 'edits',      label: 'Edits' },
  { key: 'ai',         label: 'AI' },
  { key: 'comments',   label: 'Comments' },
  { key: 'signatures', label: 'Signatures' },
]

// Event badge palette
const EVENT_BADGE: Record<EventType, { bg: string; fg: string; label: string }> = {
  'content-edited':      { bg: '#EFF6FF', fg: '#2563EB', label: 'CONTENT EDITED' },
  'ai-draft':            { bg: '#F5F3FF', fg: '#7C3AED', label: 'AI DRAFT' },
  'comment-added':       { bg: '#FFFBEB', fg: '#B45309', label: 'COMMENT ADDED' },
  'comment-resolved':    { bg: '#F0FDF4', fg: '#15803D', label: 'COMMENT RESOLVED' },
  'checklist-waived':    { bg: '#FFFBEB', fg: '#B45309', label: 'CHECKLIST WAIVED' },
  'checklist-completed': { bg: '#F0FDF4', fg: '#15803D', label: 'CHECKLIST COMPLETED' },
  'document-signed':     { bg: '#F0FDF4', fg: '#15803D', label: 'DOCUMENT SIGNED' },
  'version-restore':     { bg: '#EFF6FF', fg: '#2563EB', label: 'VERSION RESTORED' },
  'voice-note-added':    { bg: '#F5F3FF', fg: '#7C3AED', label: 'VOICE NOTE' },
  'qa-review-completed': { bg: '#F0FDF4', fg: '#15803D', label: 'QA REVIEW' },
}

// Actor avatar colours (matches design-system Pattern 7)
const AVATAR_COLOURS: Record<string, { bg: string; fg: string }> = {
  MW: { bg: '#DBEAFE', fg: '#1D4ED8' },
  SC: { bg: '#F0FDF4', fg: '#15803D' },
  JO: { bg: '#F5F3FF', fg: '#7C3AED' },
  EV: { bg: '#FEF3C7', fg: '#D97706' },
  PN: { bg: '#FEE2E2', fg: '#DC2626' },
  AH: { bg: '#E0F2FE', fg: '#0369A1' },
  RT: { bg: '#FCE7F3', fg: '#9D174D' },
  LP: { bg: '#F3F4F6', fg: '#374151' },
  AI: { bg: '#F5F3FF', fg: '#7C3AED' },
}

// Format ISO → "2024-10-22 16:47 UTC"
function formatTimestamp(iso: string): string {
  const d = new Date(iso)
  const yyyy = d.getUTCFullYear()
  const mm   = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd   = String(d.getUTCDate()).padStart(2, '0')
  const hh   = String(d.getUTCHours()).padStart(2, '0')
  const min  = String(d.getUTCMinutes()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd} ${hh}:${min} UTC`
}

function SparkleIcon({ colour = '#7C3AED' }: { colour?: string }) {
  return (
    <svg width="11" height="11" viewBox="0 0 14 14">
      <polygon points="7,1.2 8.6,5.4 12.8,7 8.6,8.6 7,12.8 5.4,8.6 1.2,7 5.4,5.4" fill={colour}/>
    </svg>
  )
}

function Avatar({ initials, colourKey, isAI }: { initials: string; colourKey: string; isAI: boolean }) {
  const c = AVATAR_COLOURS[colourKey] ?? AVATAR_COLOURS.MW
  return (
    <div
      className="flex h-5 w-5 flex-none items-center justify-center rounded-full font-mono text-[9px] font-bold"
      style={{ backgroundColor: c.bg, color: c.fg }}
    >
      {isAI ? <SparkleIcon colour={c.fg} /> : initials}
    </div>
  )
}

// Derive verb phrase for row 2 from eventType — action label from fixture is a full sentence, verb is nicer
function actionPhrase(eventType: EventType): string {
  switch (eventType) {
    case 'content-edited':      return 'edited content'
    case 'ai-draft':            return 'generated draft'
    case 'comment-added':       return 'added comment'
    case 'comment-resolved':    return 'resolved comment'
    case 'checklist-waived':    return 'waived item'
    case 'checklist-completed': return 'completed item'
    case 'document-signed':     return 'signed document'
    case 'version-restore':     return 'restored version'
    case 'voice-note-added':    return 'added voice note'
    case 'qa-review-completed': return 'completed QA review'
  }
}

export function AuditTrailPanel({ documentId }: Props) {
  const [filter, setFilter] = useState<FilterKey>('all')

  const { data, isLoading } = useQuery({
    queryKey: ['audit', documentId],
    queryFn:  () => documentsApi.getAuditTrail(documentId),
    enabled:  !!documentId,
  })

  const entries: AuditEntry[] = data?.entries ?? []
  const total   = data?.total   ?? 0

  // Newest first
  const sorted = useMemo(() => {
    return [...entries].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
  }, [entries])

  const filtered = useMemo(() => {
    const allowed = FILTER_MAP[filter]
    if (allowed === 'all') return sorted
    return sorted.filter(e => allowed.includes(e.eventType))
  }, [sorted, filter])

  const handleExport = () => {
    console.log('[audit] Export audit trail', { documentId, total, filtered: filtered.length })
  }
  const handleDownloadPDF = () => {
    console.log('[audit] Download as PDF', { documentId, total })
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">

      {/* Sub-header: filter chips + date range placeholder */}
      <div className="flex flex-none flex-col gap-2 border-b border-slate-200 px-4 py-2.5" style={{ backgroundColor: '#F8FAFC' }}>
        <div className="flex flex-wrap gap-1.5">
          {FILTER_CHIPS.map(chip => {
            const active = filter === chip.key
            return (
              <button
                key={chip.key}
                type="button"
                onClick={() => setFilter(chip.key)}
                className="rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors"
                style={active ? {
                  border: '1px solid #2563EB',
                  backgroundColor: '#EFF6FF',
                  color: '#1D4ED8',
                } : {
                  border: '1px solid #E2E8F0',
                  backgroundColor: '#FFFFFF',
                  color: '#475569',
                }}
              >
                {chip.label}
              </button>
            )
          })}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-slate-500">Range</span>
          <span className="rounded border px-1.5 py-0.5 font-mono text-[10px] text-slate-500" style={{ borderColor: '#E2E8F0', backgroundColor: '#FFFFFF' }}>
            all time
          </span>
        </div>
      </div>

      {/* Scroll list */}
      <div className="flex-1 overflow-y-auto">
        {isLoading && (
          <div className="p-8 text-center font-mono text-xs text-slate-400">Loading audit trail…</div>
        )}

        {!isLoading && filtered.length === 0 && (
          <div className="p-8 text-center">
            <p className="text-sm font-semibold text-slate-900">No matching events</p>
            <button
              type="button"
              onClick={() => setFilter('all')}
              className="mt-1 text-xs font-semibold text-blue-600 hover:text-blue-700"
            >
              Reset filter
            </button>
          </div>
        )}

        {!isLoading && filtered.map((entry: AuditEntry) => {
          const badge = EVENT_BADGE[entry.eventType]
          const isAI  = entry.actorColourKey === 'AI'
          return (
            <div
              key={entry.id}
              data-entry-id={entry.id}
              className="flex flex-col gap-1 border-b px-4 py-3 transition-colors hover:bg-slate-50"
              style={{ borderColor: '#F1F5F9' }}
            >
              {/* Row 1: timestamp + badge */}
              <div className="flex items-center justify-between gap-2.5">
                <p className="font-mono text-[10px] text-slate-500">{formatTimestamp(entry.timestamp)}</p>
                <span
                  className="whitespace-nowrap rounded px-1.5 py-0.5 font-mono text-[9px] font-medium tracking-wider"
                  style={{ backgroundColor: badge.bg, color: badge.fg }}
                >
                  {badge.label}
                </span>
              </div>

              {/* Row 2: avatar + name/action */}
              <div className="flex min-w-0 items-center gap-1.5">
                <Avatar initials={entry.actorInitials} colourKey={entry.actorColourKey} isAI={isAI} />
                <p className="min-w-0 truncate text-[13px]">
                  <span className="font-bold text-slate-900">{entry.actor}</span>{' '}
                  <span className="text-slate-500">{actionPhrase(entry.eventType)}</span>
                </p>
              </div>

              {/* Row 3: detail */}
              <p className="text-[12px] leading-[1.5] text-slate-500">{entry.detail}</p>
            </div>
          )
        })}

        {/* Load-more footer inside scroll list */}
        {!isLoading && total > filtered.length && (
          <div className="flex items-center justify-between px-4 py-3">
            <p className="text-xs text-slate-500">Showing {filtered.length} of {total} entries</p>
            <button className="text-xs font-semibold text-blue-600 hover:text-blue-700">Load more →</button>
          </div>
        )}
        {!isLoading && total <= filtered.length && filtered.length > 0 && (
          <p className="px-4 py-3 text-xs text-slate-500">Showing all {filtered.length} entries</p>
        )}
      </div>

      {/* Sticky footer */}
      <div
        className="flex flex-none gap-2 border-t border-slate-200 px-4 py-3"
        style={{ backgroundColor: '#F8FAFC' }}
      >
        <button
          type="button"
          onClick={handleExport}
          className="flex-1 rounded-md border border-slate-200 bg-white py-2 text-xs font-semibold text-slate-900 hover:bg-slate-100 transition-colors"
        >
          Export audit trail
        </button>
        <button
          type="button"
          onClick={handleDownloadPDF}
          className="flex-1 rounded-md border border-slate-200 bg-white py-2 text-xs font-semibold text-slate-900 hover:bg-slate-100 transition-colors"
        >
          Download as PDF
        </button>
      </div>
    </div>
  )
}
