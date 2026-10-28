import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query'
import type { AuditEntry } from '@platform/types'
import { documentsApi } from '../api'
import { apiConfig } from '../api/client'
import { DateTimeRangeFilter, defaultRange, rangeToIso, toInputValue, type TimeZoneMode } from '../components/ui/DateTimeRangeFilter'
import { wordDiff, type DiffOp } from './wordDiff'

interface ScopeSection { id: string; number: string; title: string }

interface Props {
  documentId: string
  // The section selected in the editor. When set, the trail opens scoped to it.
  section?: ScopeSection | null
}

// '§1' / '1' / '§ 1' → '1', so comment sectionRefs match the section number either way.
const normRef = (v: string) => v.replace(/^§\s*/, '').trim().toLowerCase()

// Does this audit entry belong to the given section? Edits, AI drafts, reverts and
// source references record the section key; comments record a "§n" reference.
function entryInSection(e: AuditEntry, s: ScopeSection): boolean {
  const d = e.details ?? {}
  if (typeof d.sectionId === 'string') return d.sectionId === s.id
  if (typeof d.sectionRef === 'string') {
    const ref = normRef(d.sectionRef)
    return ref === normRef(s.number) || ref.startsWith(`${normRef(s.number)} `)
  }
  return false
}

const PAGE_SIZE = 100

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

// Format ISO → "2024-10-22 16:47 GMT+5:30" in the viewer's own time zone.
const localParts = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hour12: false, timeZoneName: 'short',
})
function formatTimestamp(iso: string): string {
  const p = Object.fromEntries(localParts.formatToParts(new Date(iso)).map(x => [x.type, x.value]))
  const hh = p.hour === '24' ? '00' : p.hour
  return `${p.year}-${p.month}-${p.day} ${hh}:${p.minute} ${p.timeZoneName}`
}

// Same moment in UTC, shown as the hover text.
function formatTimestampUtc(iso: string): string {
  return `${new Date(iso).toISOString().slice(0, 16).replace('T', ' ')} UTC`
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

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

// Same marks as the Version Diff screen (DiffView): struck-through red for removed
// words, green for added ones.
const DEL_STYLE = { backgroundColor: '#FEE2E2', color: '#DC2626', textDecoration: 'line-through', borderRadius: 2, padding: '0 2px' } as const
const INS_STYLE = { backgroundColor: '#DCFCE7', color: '#15803D', textDecoration: 'none',         borderRadius: 2, padding: '0 2px' } as const

// Words joined by single spaces, with a marked run rendered in its highlight.
function renderRuns(ops: DiffOp[], show: 'del' | 'ins' | 'both'): ReactNode[] {
  const out: ReactNode[] = []
  ops.forEach((op, i) => {
    if (op.type === 'del' && show === 'ins') return
    if (op.type === 'ins' && show === 'del') return
    const text = op.words.join(' ')
    if (out.length) out.push(' ')
    out.push(
      op.type === 'eq'  ? <span key={i}>{text}</span>
      : op.type === 'del' ? <del key={i} style={DEL_STYLE} data-diff="del">{text}</del>
      :                     <ins key={i} style={INS_STYLE} data-diff="ins">{text}</ins>,
    )
  })
  return out
}

// What a section edit changed: only the changed words, in place, with a few words
// of surrounding text to show where. The full before/after stays available.
function ChangeBlock({ before, after }: { before: string; after: string }) {
  const [showFull, setShowFull] = useState(false)
  const diff = useMemo(() => wordDiff(before, after), [before, after])

  const summary = [
    diff.added   ? `+${plural(diff.added, 'word')} added` : '',
    diff.removed ? `−${plural(diff.removed, 'word')} removed` : '',
  ].filter(Boolean).join(' · ')

  return (
    <div className="mt-1 flex flex-col gap-1.5 text-[12px] leading-[1.55]" data-audit-change>
      <p className="font-mono text-[10px] text-slate-500" data-change-summary>
        {diff.hunks.length === 0
          ? 'No wording change (formatting or spacing only)'
          : `${summary} · ${plural(diff.hunks.length, 'place')}`}
      </p>

      {/* Each change inline in its sentence: removed words struck through, added words in green. */}
      {diff.hunks.map((h, i) => (
        <div key={i} className="rounded border border-slate-200 bg-white px-2.5 py-1.5" data-change-hunk={i + 1}>
          <span className="block font-mono text-[9px] font-semibold uppercase tracking-wider text-slate-400">
            {h.atStart && h.atEnd ? 'whole text' : h.atStart ? 'at start' : h.atEnd ? 'at end' : `change ${i + 1}`}
          </span>
          <p className="text-[12.5px] leading-[1.7] text-slate-700">
            {h.before.length > 0 && <span className="text-slate-500">…{h.before.join(' ')} </span>}
            {renderRuns(h.ops, 'both')}
            {h.after.length > 0 && <span className="text-slate-500"> {h.after.join(' ')}…</span>}
          </p>
        </div>
      ))}

      <button type="button" onClick={() => setShowFull(s => !s)} className="self-start text-[11px] font-semibold text-blue-600 hover:text-blue-700">
        {showFull ? 'Hide full before / after' : 'Show full before / after'}
      </button>
      {/* Full text, highlighting only what changed: removed words in Before, added words in After. */}
      {showFull && (
        <div className="flex flex-col gap-1.5" data-change-full>
          <div className="rounded border border-slate-200 border-l-2 border-l-red-400 bg-white px-2.5 py-1.5">
            <span className="font-mono text-[9px] font-semibold uppercase tracking-wider text-red-700">Before</span>
            <p className="text-[12px] leading-[1.7] text-slate-700" data-full="before">
              {before ? renderRuns(diff.ops, 'del') : <span className="italic text-slate-400">(empty)</span>}
            </p>
          </div>
          <div className="rounded border border-slate-200 border-l-2 border-l-green-500 bg-white px-2.5 py-1.5">
            <span className="font-mono text-[9px] font-semibold uppercase tracking-wider text-green-700">After</span>
            <p className="text-[12px] leading-[1.7] text-slate-700" data-full="after">
              {after ? renderRuns(diff.ops, 'ins') : <span className="italic text-slate-400">(empty)</span>}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

export function AuditTrailPanel({ documentId, section = null }: Props) {
  const [filter, setFilter] = useState<FilterKey>('all')
  // Scoped to the selected section by default; picking another section re-scopes to it.
  const [wholeDocument, setWholeDocument] = useState(false)
  useEffect(() => { setWholeDocument(false) }, [section?.id])
  const scopeSection = wholeDocument ? null : section

  // Date & time range — opens on the last month, same as the admin Audit Trail page.
  const [tz, setTz] = useState<TimeZoneMode>('local')
  const [range, setRange] = useState(() => defaultRange('local'))
  const rangeActive  = range.from !== '' || range.to !== ''
  const rangeInvalid = range.from !== '' && range.to !== '' && range.from > range.to
  const fromIso = rangeToIso(range.from, 'start', tz)
  const toIso   = rangeToIso(range.to, 'end', tz)
  // Switching timezone keeps the range on the same moments, re-expressed in the new zone.
  const changeTz = (next: TimeZoneMode) => {
    const convert = (v: string) => (v ? toInputValue(new Date(rangeToIso(v, 'start', tz)!), next) : '')
    setRange(r => ({ from: convert(r.from), to: convert(r.to) }))
    setTz(next)
  }

  // The trail is loaded a page at a time, newest first; "Load more" fetches the next page.
  // A From that is after the To isn't sent — the list keeps showing the last valid range.
  const { data, isLoading, hasNextPage, fetchNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ['audit', documentId, 'pages', fromIso ?? null, toIso ?? null],
    queryFn:  ({ pageParam }) => documentsApi.getAuditTrail(documentId, { limit: PAGE_SIZE, offset: pageParam, from: fromIso, to: toIso }),
    initialPageParam: 0,
    getNextPageParam: (last, all) => {
      const loaded = all.reduce((n, p) => n + p.entries.length, 0)
      return last.entries.length > 0 && loaded < last.total ? loaded : undefined
    },
    enabled:  !!documentId && !rangeInvalid,
    placeholderData: keepPreviousData,
  })

  const entries: AuditEntry[] = useMemo(() => data?.pages.flatMap(p => p.entries) ?? [], [data])
  const total   = data?.pages[0]?.total ?? 0

  // Newest first
  const sorted = useMemo(() => {
    return [...entries].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
  }, [entries])

  const filtered = useMemo(() => {
    const allowed = FILTER_MAP[filter]
    const inScope = scopeSection ? sorted.filter(e => entryInSection(e, scopeSection)) : sorted
    if (allowed === 'all') return inScope
    return inScope.filter(e => allowed.includes(e.eventType))
  }, [sorted, filter, scopeSection])

  // Downloads come from the API so the export is itself audited server-side.
  const [downloading, setDownloading] = useState<'csv' | 'pdf' | null>(null)
  const [downloadError, setDownloadError] = useState<string | null>(null)

  const download = async (format: 'csv' | 'pdf') => {
    setDownloading(format)
    setDownloadError(null)
    try {
      const path = format === 'csv' ? 'audit/export' : 'audit/pdf'
      const res = await fetch(`${apiConfig.baseUrl}/documents/${encodeURIComponent(documentId)}/${path}`, { credentials: 'include' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const blob = await res.blob()
      const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1]
        ?? `audit-trail-${documentId}.${format}`
      const url = URL.createObjectURL(blob)
      const a = window.document.createElement('a')
      a.href = url
      a.download = name
      window.document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      setDownloadError(`Couldn't download the audit trail (${err instanceof Error ? err.message : 'network error'}). Please try again.`)
    } finally {
      setDownloading(null)
    }
  }
  const handleExport      = () => { void download('csv') }
  const handleDownloadPDF = () => { void download('pdf') }

  return (
    <div className="flex h-full flex-col overflow-hidden">

      {/* Sub-header: filter chips + date range placeholder */}
      <div className="flex flex-none flex-col gap-2 border-b border-slate-200 px-4 py-2.5" style={{ backgroundColor: '#F8FAFC' }}>
        {/* Scope: the selected section, or the whole document */}
        {section && (
          <div className="flex items-center gap-2" data-audit-scope={scopeSection ? 'section' : 'document'}>
            {scopeSection ? (
              <span className="inline-flex min-w-0 items-center gap-1 rounded-full border border-blue-300 bg-blue-50 py-0.5 pl-2.5 pr-1 text-[11px] font-semibold text-blue-800">
                <span className="truncate">{scopeSection.number.startsWith('§') ? '' : '§'}{scopeSection.number} {scopeSection.title}</span>
                <button
                  type="button"
                  onClick={() => setWholeDocument(true)}
                  aria-label="Show the whole document's audit trail"
                  title="Show the whole document"
                  className="flex h-4 w-4 flex-none items-center justify-center rounded-full hover:bg-blue-100"
                >
                  <svg width="8" height="8" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M3 3l6 6M9 3l-6 6" /></svg>
                </button>
              </span>
            ) : (
              <>
                <span className="text-[11px] font-semibold text-slate-700">Whole document</span>
                <button type="button" onClick={() => setWholeDocument(false)} className="text-[11px] font-semibold text-blue-600 hover:text-blue-700">
                  Only {section.number.startsWith('§') ? '' : '§'}{section.number} →
                </button>
              </>
            )}
          </div>
        )}
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
        <DateTimeRangeFilter
          align="left"
          from={range.from} to={range.to} tz={tz} invalid={rangeInvalid}
          onChange={setRange} onTzChange={changeTz}
        />
        {rangeInvalid && <p className="text-[11px] text-red-700">The range's "From" is after its "To".</p>}
      </div>

      {/* Scroll list */}
      <div className="flex-1 overflow-y-auto">
        {isLoading && (
          <div className="p-8 text-center font-mono text-xs text-slate-400">Loading audit trail…</div>
        )}

        {!isLoading && filtered.length === 0 && (
          <div className="p-8 text-center">
            <p className="text-sm font-semibold text-slate-900">
              {scopeSection ? 'No events for this section'
                : rangeActive && entries.length === 0 ? 'No events in this date range'
                : 'No matching events'}{hasNextPage ? ' in the entries loaded so far' : ''}
            </p>
            {rangeActive && (
              <button type="button" onClick={() => setRange({ from: '', to: '' })} className="mt-1 mr-3 text-xs font-semibold text-blue-600 hover:text-blue-700" data-action="show-all-time">
                Show all time
              </button>
            )}
            {scopeSection && (
              <button type="button" onClick={() => setWholeDocument(true)} className="mt-1 mr-3 text-xs font-semibold text-blue-600 hover:text-blue-700">
                Show whole document
              </button>
            )}
            {hasNextPage && filter !== 'all' && (
              <button
                type="button"
                onClick={() => { void fetchNextPage() }}
                disabled={isFetchingNextPage}
                className="mt-1 mr-3 text-xs font-semibold text-blue-600 hover:text-blue-700 disabled:opacity-60"
                data-action="load-more-audit"
              >{isFetchingNextPage ? 'Loading…' : 'Load older entries'}</button>
            )}
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
          // Real audit rows include actions the panel has no badge for
          // (status changes, uploads, CRM…) — fall back to a neutral badge
          // labelled from the raw action instead of crashing the editor.
          const rawAction = (entry.action ?? '').replace(/[._]/g, ' ').trim()
          const badge = EVENT_BADGE[entry.eventType] ?? { bg: '#F1F5F9', fg: '#475569', label: (rawAction || 'EVENT').toUpperCase() }
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
                <p className="font-mono text-[10px] text-slate-500" title={`UTC: ${formatTimestampUtc(entry.timestamp)}`}>{formatTimestamp(entry.timestamp)}</p>
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
                  <span className="text-slate-500">{actionPhrase(entry.eventType) ?? rawAction}</span>
                </p>
              </div>

              {/* Row 3: detail */}
              <p className="text-[12px] leading-[1.5] text-slate-500">{entry.detail}</p>

              {/* Section edits: previous → new content */}
              {typeof entry.details?.before === 'string' && typeof entry.details?.after === 'string' && (
                <ChangeBlock before={entry.details.before} after={entry.details.after} />
              )}
            </div>
          )
        })}

        {/* Footer. The API returns the whole trail in one response, so there is
            nothing more to load — when a chip hides entries, offer to clear it. */}
        {!isLoading && hasNextPage && (
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <p className="text-xs text-slate-500">
              {filter === 'all'
                ? `Showing ${entries.length} of ${total} entries`
                : `${filtered.length} match in the ${entries.length} loaded (${total} entries in total)`}
            </p>
            <button
              type="button"
              onClick={() => { void fetchNextPage() }}
              disabled={isFetchingNextPage}
              className="flex-none text-xs font-semibold text-blue-600 hover:text-blue-700 disabled:cursor-wait disabled:opacity-60"
              data-action="load-more-audit"
            >{isFetchingNextPage ? 'Loading…' : 'Load more →'}</button>
          </div>
        )}
        {!isLoading && !hasNextPage && filter !== 'all' && filtered.length > 0 && total > filtered.length && (
          <div className="flex items-center justify-between px-4 py-3">
            <p className="text-xs text-slate-500">Showing {filtered.length} of {total} entries (filtered)</p>
            <button
              type="button"
              onClick={() => setFilter('all')}
              className="text-xs font-semibold text-blue-600 hover:text-blue-700"
              data-action="show-all-audit"
            >Show all {total} →</button>
          </div>
        )}
        {!isLoading && !hasNextPage && (filter === 'all' || total <= filtered.length) && filtered.length > 0 && (
          <p className="px-4 py-3 text-xs text-slate-500">Showing all {filtered.length} entries{rangeActive ? ' in this date range' : ''}</p>
        )}
      </div>

      {/* Sticky footer */}
      {downloadError && (
        <p className="flex-none border-t border-red-200 bg-red-50 px-4 py-2 text-[11px] text-red-800" data-download-error>{downloadError}</p>
      )}
      <div
        className="flex flex-none gap-2 border-t border-slate-200 px-4 py-3"
        style={{ backgroundColor: '#F8FAFC' }}
      >
        <button
          type="button"
          onClick={handleExport}
          disabled={downloading !== null}
          className="flex-1 rounded-md border border-slate-200 bg-white py-2 text-xs font-semibold text-slate-900 hover:bg-slate-100 transition-colors disabled:cursor-wait disabled:opacity-60"
          data-action="export-audit-csv"
        >
          {downloading === 'csv' ? 'Exporting…' : 'Export audit trail'}
        </button>
        <button
          type="button"
          onClick={handleDownloadPDF}
          disabled={downloading !== null}
          className="flex-1 rounded-md border border-slate-200 bg-white py-2 text-xs font-semibold text-slate-900 hover:bg-slate-100 transition-colors disabled:cursor-wait disabled:opacity-60"
          data-action="export-audit-pdf"
        >
          {downloading === 'pdf' ? 'Preparing PDF…' : 'Download as PDF'}
        </button>
      </div>
    </div>
  )
}
