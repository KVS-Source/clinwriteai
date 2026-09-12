import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { AtomisedContent, CalendarEntry, SocialListeningAlert } from '@platform/types'
import { useCalendarStore } from '../../modules/ideation-publishing/store'
import calendarFixture from '../../data/ideationCalendar.json'
import alertsFixture   from '../../data/socialListeningAlerts.json'
import atomisedFixture from '../../data/atomisedContent.json'

const ENTRIES     = calendarFixture as unknown as CalendarEntry[]
const ALERTS      = alertsFixture   as unknown as SocialListeningAlert[]
const ADAPTATIONS = atomisedFixture as unknown as AtomisedContent[]

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const dd = String(d.getUTCDate()).padStart(2, '0')
  const hh = String(d.getUTCHours()).padStart(2, '0')
  const mm = String(d.getUTCMinutes()).padStart(2, '0')
  return `${dd} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()} ${hh}:${mm} UTC`
}
function formatDay(iso: string): string {
  const d = new Date(iso)
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]}`
}

interface QueueRowProps {
  entry:    CalendarEntry
  alert:    SocialListeningAlert | undefined
  isActive: boolean
  onSelect: () => void
}

function QueueRow(p: QueueRowProps) {
  const isOverdue   = p.entry.status === 'overdue'
  const isPublished = p.entry.status === 'published'

  const chipBg = isOverdue ? '#FFE4E6' : isPublished ? '#F0FDF4' : '#F0FDFA'
  const chipFg = isOverdue ? '#BE123C' : isPublished ? '#166534' : '#0F766E'
  const chipBorder = isOverdue ? '#FDA4AF' : isPublished ? '#BBF7D0' : '#99F6E4'
  const label = isOverdue ? 'OVERDUE' : isPublished ? '✓ Published' : 'Scheduled'

  return (
    <button
      type="button"
      onClick={p.onSelect}
      data-queue-row={p.entry.id}
      data-active={p.isActive || undefined}
      className="flex w-full flex-col gap-2 rounded-lg border bg-white p-3 text-left hover:shadow-sm"
      style={{ borderColor: p.isActive ? '#0D9488' : '#E2E8F0', borderWidth: p.isActive ? 2 : 1 }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase"
          style={{ backgroundColor: chipBg, color: chipFg, border: `1px solid ${chipBorder}`, letterSpacing: '0.06em' }}
          data-status-chip={p.entry.status}
        >{label}</span>
        {p.alert && (
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: '#D97706' }}
            data-sentiment-dot={p.entry.id}
            aria-label="Sentiment alert"
          />
        )}
      </div>
      <p className="text-[13px] font-bold text-slate-900">{p.entry.cardTitle} — {p.entry.channelLabel}</p>
      <p className="font-mono text-[10px] text-slate-500">
        {p.entry.assignedCreativeName} · {isPublished
          ? `Published ${formatDay(p.entry.publishedAt ?? p.entry.scheduledDate)}`
          : `${formatDay(p.entry.scheduledDate)} → ${isOverdue ? 'overdue' : 'scheduled'}`}
        {isPublished && p.entry.sentimentScore != null && ` · sentiment ${p.entry.sentimentScore}`}
      </p>
    </button>
  )
}

export function PublishingMonitor() {
  const { projectId } = useParams()
  const navigate = useNavigate()

  const setEntries      = useCalendarStore(s => s.setEntries)
  const setSocialAlerts = useCalendarStore(s => s.setSocialAlerts)

  // Sort: overdue first, then scheduled, then published
  const sorted = useMemo(() => {
    const rank = { overdue: 0, scheduled: 1, published: 2, cancelled: 3 }
    return [...ENTRIES].sort((a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9))
  }, [])

  useEffect(() => { setEntries(sorted); setSocialAlerts(ALERTS) }, [sorted, setEntries, setSocialAlerts])

  const [activeId, setActiveId] = useState<string>('cal-002')
  const active = sorted.find(e => e.id === activeId) ?? sorted[0]
  const activeAlert = ALERTS.find(a => a.calendarEntryId === active?.id)
  const activeAdaptation = ADAPTATIONS.find(a =>
    a.ideationContentCardId === active?.ideationContentCardId && a.channel === active?.channel,
  )

  const counts = useMemo(() => ({
    overdue:   ENTRIES.filter(e => e.status === 'overdue').length,
    scheduled: ENTRIES.filter(e => e.status === 'scheduled').length,
    published: ENTRIES.filter(e => e.status === 'published').length,
  }), [])

  const [utm, setUtm] = useState<string>('utm_source=linkedin&utm_medium=social&utm_campaign=VELORA-301-Nov26')
  const [seo, setSeo] = useState<string>('{"tags":["Oncology","VELORA-301"]}')

  if (!active) return <div className="p-8 text-center text-sm text-slate-500" data-screen="publishing-monitor">No entries.</div>

  return (
    <div className="bg-slate-50" data-screen="publishing-monitor">
      <div className="flex flex-col gap-4" style={{ maxWidth: 1440, padding: '20px 32px 48px' }}>

        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-xs text-slate-500">
          <button onClick={() => navigate(`/projects/${projectId}/ideation-publishing`)} className="hover:text-slate-900">Ideation &amp; Publishing</button>
          <span style={{ color: '#CBD5E1' }}>&gt;</span>
          <span className="font-semibold text-slate-900">Publishing Monitor</span>
        </nav>

        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <h1 className="text-[22px] font-bold text-slate-900" style={{ margin: 0 }}>Publishing Monitor</h1>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-slate-500">
              <span
                className="inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold"
                style={{ backgroundColor: '#FFE4E6', color: '#BE123C' }}
                data-header-overdue
              >{counts.overdue} overdue</span>
              <span
                className="inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold"
                style={{ backgroundColor: '#F0FDFA', color: '#0F766E' }}
                data-header-scheduled
              >{counts.scheduled} scheduled</span>
              <span
                className="inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold"
                style={{ backgroundColor: '#F0FDF4', color: '#166534' }}
                data-header-published
              >{counts.published} published</span>
            </p>
          </div>
          <div className="flex flex-none gap-2">
            <button
              type="button"
              onClick={() => navigate(`/projects/${projectId}/ideation-publishing/calendar`)}
              data-open-calendar
              className="h-9 rounded-md border border-slate-300 bg-white px-3 text-[13px] font-semibold text-slate-700 hover:bg-slate-50"
            >Calendar</button>
          </div>
        </div>

        {/* Two-column body */}
        <div className="grid gap-4" style={{ gridTemplateColumns: '380px 1fr' }}>

          {/* LEFT — publishing queue */}
          <section className="flex flex-col gap-3" data-publishing-queue>
            <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">
              Publishing queue · sorted by overdue first
            </p>
            {sorted.map(e => (
              <QueueRow
                key={e.id}
                entry={e}
                alert={ALERTS.find(a => a.calendarEntryId === e.id)}
                isActive={e.id === active.id}
                onSelect={() => setActiveId(e.id)}
              />
            ))}
          </section>

          {/* RIGHT — active entry detail */}
          <section
            className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-5"
            data-entry-detail={active.id}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Entry detail · {active.id}</p>
                <p className="text-[16px] font-bold text-slate-900">{active.cardTitle} — {active.channelLabel}</p>
                <p className="mt-0.5 font-mono text-[11px] text-slate-500">Scheduled {formatDay(active.scheduledDate)} · {active.assignedCreativeName}</p>
              </div>
            </div>

            {/* Content preview from atomisation */}
            {activeAdaptation && (
              <div
                className="rounded-md p-3 text-[13px] text-slate-700"
                style={{ backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0' }}
                data-content-preview
              >
                <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Content preview (read-only)</p>
                <p className="mt-2 line-clamp-4">{activeAdaptation.contentText.slice(0, 160)}…</p>
              </div>
            )}

            {/* Flagged comment (design fixture — cal-002) */}
            {active.id === 'cal-002' && (
              <div
                className="rounded-lg border p-4"
                style={{ backgroundColor: '#FFFBEB', borderColor: '#FDE68A' }}
                data-flagged-comment
              >
                <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-600">Flagged HCP comment · LinkedIn · 25 Oct 2026 07:52 UTC</p>
                <p className="mt-2 text-[13px] italic text-slate-800">
                  "The safety data for veloricept isn't as clean as this suggests — grade 3 AEs were higher than presented."
                </p>
                <p className="mt-2 font-mono text-[11px] text-slate-600">
                  Auto-categorised: <strong>Safety concern · HCP audience</strong>
                </p>
                <p className="mt-1 font-mono text-[11px] text-slate-600">
                  MA notification: Dr Rebecca Morton · 25 Oct 08:30 UTC
                </p>
                <p
                  className="mt-2 rounded-md p-2 text-[12px]"
                  style={{ backgroundColor: '#F0FDF4', color: '#166534' }}
                  data-ma-review-verdict
                >
                  ✓ Reviewed · no action required · Safety data are correctly presented per <strong>SmPC v2.1 §4.8</strong>.
                  Measured: grade 3+ TRAEs <strong>34.2%</strong>. Threshold: SmPC §4.8 reported rate 34.2%. Verdict: consistent.
                  · Dr Rebecca Morton · 25 Oct 2026 09:15 UTC
                </p>
                <p className="mt-2 font-mono text-[11px] text-slate-600" data-utm-line>
                  UTM performance: <code>utm_campaign=VELORA-301-Oct26</code> · 234 sessions · 18 social referrals · avg session 3m 42s
                </p>
              </div>
            )}

            {/* Sentiment alert panel */}
            {activeAlert && (
              <div
                className="rounded-lg border p-4"
                style={{ backgroundColor: '#F0FDFA', borderColor: '#99F6E4' }}
                data-sentiment-alert-panel
                data-alert-id={activeAlert.id}
              >
                <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-600">Sentiment alert · {activeAlert.id}</p>
                <p className="mt-1 text-[13px] font-semibold text-slate-900" data-sentiment-alert-summary>
                  Negative sentiment detected · score {activeAlert.sentimentScore} · triggered {formatDateTime(activeAlert.triggeredAt)}
                </p>
                <p className="mt-1 text-[12px] text-slate-700" data-auto-stop-note>
                  Auto-stop threshold: 0.50 negative. Score {activeAlert.sentimentScore} — notification sent, auto-stop not triggered.
                </p>
                {activeAlert.resolvedAt && (
                  <p
                    className="mt-2 rounded-md p-2 text-[12px]"
                    style={{ backgroundColor: '#F0FDF4', color: '#166534' }}
                    data-alert-resolved
                  >
                    ✓ Resolved by {activeAlert.resolvedByName} · {formatDateTime(activeAlert.resolvedAt)} · "{activeAlert.resolutionNote}"
                  </p>
                )}
              </div>
            )}

            {/* Mark as published (DD-E-005 — no social API call) */}
            <div className="flex flex-col gap-2" data-mark-published-block>
              <label className="flex flex-col gap-1">
                <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">UTM params</span>
                <input
                  type="text"
                  value={utm}
                  onChange={(e) => setUtm(e.target.value)}
                  data-utm-input
                  className="h-9 rounded-md border border-slate-300 px-3 text-[12px]"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">SEO metadata (JSON)</span>
                <input
                  type="text"
                  value={seo}
                  onChange={(e) => setSeo(e.target.value)}
                  data-seo-input
                  className="h-9 rounded-md border border-slate-300 px-3 font-mono text-[11px]"
                />
              </label>
              <button
                type="button"
                data-mark-published
                className="h-9 rounded-md px-4 text-[13px] font-semibold text-white"
                style={{ backgroundColor: '#0D9488' }}
              >Mark as published</button>
              <p
                className="rounded-md px-3 py-2 text-[11px] font-mono"
                style={{ backgroundColor: '#F1F5F9', color: '#475569' }}
                data-human-executed-note
              >
                Content is published manually by the Creative Team following the platform notification. Direct channel publishing is not enabled in this release. (DD-E-005)
              </p>
              <p
                className="rounded-md px-3 py-2 text-[11px]"
                style={{ backgroundColor: '#F0FDFA', color: '#0F766E' }}
                data-auto-stop-check-note
              >
                A sentiment check will run before publishing future VELORA-301 content due to this alert.
              </p>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
