import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { CalendarEntry, SocialListeningAlert } from '@platform/types'
import { useCalendarStore } from '../../modules/ideation-publishing/store'
import calendarFixture from '../../data/ideationCalendar.json'
import alertsFixture   from '../../data/socialListeningAlerts.json'

const ENTRIES = calendarFixture as unknown as CalendarEntry[]
const ALERTS  = alertsFixture   as unknown as SocialListeningAlert[]

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']
const DAYS   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']

function formatDay(iso: string): string {
  const d = new Date(iso)
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]}`
}

interface DayCellProps {
  year:    number
  month:   number
  day:     number
  entries: CalendarEntry[]
  alerts:  SocialListeningAlert[]
  isOtherMonth?: boolean
}

function DayCell(p: DayCellProps) {
  const iso = `${p.year}-${String(p.month + 1).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
  const dayEntries = p.entries.filter(e => e.scheduledDate === iso)
  const hasOverdue = dayEntries.some(e => e.status === 'overdue')

  return (
    <div
      className="flex min-h-[110px] flex-col gap-1 rounded-md p-2"
      style={{
        backgroundColor: hasOverdue ? '#FFF1F2' : (p.isOtherMonth ? '#F8FAFC' : '#FFFFFF'),
        border: `1px solid ${hasOverdue ? '#FDA4AF' : '#E2E8F0'}`,
        opacity: p.isOtherMonth ? 0.55 : 1,
      }}
      data-day-cell={iso}
      data-has-overdue={hasOverdue || undefined}
    >
      <div className="flex items-center justify-between">
        <span className="font-mono text-[11px] font-semibold text-slate-500">{p.day}</span>
        {hasOverdue && <span className="font-mono text-[9px] font-semibold" style={{ color: '#BE123C' }}>OVERDUE</span>}
      </div>
      <div className="flex flex-col gap-1">
        {dayEntries.map(entry => {
          const alert = p.alerts.find(a => a.calendarEntryId === entry.id)
          const isPublished = entry.status === 'published'
          const isOverdue   = entry.status === 'overdue'
          const isScheduled = entry.status === 'scheduled'
          const bg = isPublished ? '#F0FDF4' : isOverdue ? '#FFE4E6' : '#F0FDFA'
          const fg = isPublished ? '#166534' : isOverdue ? '#BE123C' : '#0F766E'
          const border = isPublished ? '#BBF7D0' : isOverdue ? '#FDA4AF' : '#99F6E4'
          return (
            <div
              key={entry.id}
              className="rounded-md px-1.5 py-1"
              style={{ backgroundColor: bg, color: fg, border: `1px solid ${border}` }}
              data-calendar-entry={entry.id}
              data-entry-status={entry.status}
            >
              <div className="flex items-center gap-1">
                <p className="truncate text-[10px] font-semibold">
                  {entry.cardTitle.split(' — ')[0].replace('Efficacy Result', '')} — {entry.channelLabel}
                </p>
                {alert && (
                  <span
                    className="inline-block h-2 w-2 flex-none rounded-full"
                    style={{ backgroundColor: '#D97706' }}
                    title={`Sentiment alert: ${alert.sentimentScore} negative · Resolved by ${alert.resolvedByName} · ${formatDay(alert.resolvedAt!)}`}
                    data-sentiment-alert-dot={entry.id}
                    aria-label="Sentiment alert"
                  />
                )}
              </div>
              <p className="mt-0.5 font-mono text-[9px]">
                {isPublished && '✓ Published'}
                {isOverdue   && `OVERDUE · ${entry.overdueHours && entry.overdueHours < 72 ? `${entry.overdueHours}h` : `${Math.round((entry.overdueHours ?? 0)/24)} days`}`}
                {isScheduled && 'Scheduled'}
              </p>
              {entry.maAdvanceNotificationSent && (
                <p className="mt-0.5 rounded-sm px-1 font-mono text-[9px]" style={{ backgroundColor: '#F0FDFA', color: '#0F766E' }} data-ma-advance-notified={entry.id}>
                  MA notified {formatDay(entry.maAdvanceNotificationSentAt!)} ✓
                </p>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function ContentCalendar() {
  const { projectId } = useParams()
  const navigate = useNavigate()

  const setEntries      = useCalendarStore(s => s.setEntries)
  const setSocialAlerts = useCalendarStore(s => s.setSocialAlerts)
  const [view, setView] = useState<'month' | 'week'>('month')

  useEffect(() => { setEntries(ENTRIES); setSocialAlerts(ALERTS) }, [setEntries, setSocialAlerts])

  // October 2026 grid
  const year  = 2026
  const month = 9 // October (0-indexed)

  const monthGrid = useMemo(() => {
    const firstOfMonth = new Date(Date.UTC(year, month, 1))
    const startDayOfWeek = firstOfMonth.getUTCDay() // 0 = Sun
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()

    const cells: { day: number; month: number; year: number; isOtherMonth: boolean }[] = []
    // leading days from prev month
    for (let i = 0; i < startDayOfWeek; i++) {
      const prevMonthDays = new Date(Date.UTC(year, month, 0)).getUTCDate()
      const d = prevMonthDays - (startDayOfWeek - 1 - i)
      cells.push({ day: d, month: month - 1, year, isOtherMonth: true })
    }
    for (let d = 1; d <= daysInMonth; d++) cells.push({ day: d, month, year, isOtherMonth: false })
    // trailing to complete 6 rows (42 cells) so November dates are visible
    while (cells.length < 42) {
      const idx = cells.length - (startDayOfWeek + daysInMonth) + 1
      cells.push({ day: idx, month: month + 1, year, isOtherMonth: true })
    }
    return cells
  }, [year, month])

  return (
    <div className="bg-slate-50" data-screen="content-calendar">
      <div className="mx-auto flex flex-col gap-4" style={{ maxWidth: 1440, padding: '20px 32px 48px' }}>

        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-xs text-slate-500">
          <button onClick={() => navigate(`/projects/${projectId}/ideation-publishing`)} className="hover:text-slate-900">Ideation &amp; Publishing</button>
          <span style={{ color: '#CBD5E1' }}>&gt;</span>
          <span className="font-semibold text-slate-900">Content Calendar</span>
        </nav>

        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <h1 className="text-[22px] font-bold text-slate-900" style={{ margin: 0 }}>Content Calendar · {MONTHS[month]} {year}</h1>
            <p className="mt-1 font-mono text-xs text-slate-500">
              Mr Daniel Okafor · Content Calendar Manager
            </p>
          </div>
          <div className="flex flex-none items-center gap-2">
            <div
              className="flex items-center gap-1 rounded-md border border-slate-300 bg-white p-0.5"
              data-view-toggle
            >
              <button
                type="button"
                onClick={() => setView('month')}
                data-view-month
                data-active={view === 'month' || undefined}
                className="h-7 rounded-sm px-3 text-[12px] font-semibold"
                style={{ backgroundColor: view === 'month' ? '#0D9488' : 'transparent', color: view === 'month' ? '#FFFFFF' : '#475569' }}
              >Month</button>
              <button
                type="button"
                onClick={() => setView('week')}
                data-view-week
                data-active={view === 'week' || undefined}
                className="h-7 rounded-sm px-3 text-[12px] font-semibold"
                style={{ backgroundColor: view === 'week' ? '#0D9488' : 'transparent', color: view === 'week' ? '#FFFFFF' : '#475569' }}
              >Week</button>
            </div>
            <button
              type="button"
              data-schedule-content
              className="h-9 rounded-md px-4 text-[13px] font-semibold text-white"
              style={{ backgroundColor: '#0D9488' }}
            >Schedule content →</button>
          </div>
        </div>

        {/* Month grid */}
        <div className="rounded-lg border border-slate-200 bg-white p-4" data-month-grid>
          <div className="mb-2 grid grid-cols-7 gap-2">
            {DAYS.map(d => (
              <div key={d} className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-2">
            {monthGrid.map((c, i) => (
              <DayCell
                key={`${c.year}-${c.month}-${c.day}-${i}`}
                year={c.year}
                month={c.month}
                day={c.day}
                entries={ENTRIES}
                alerts={ALERTS}
                isOtherMonth={c.isOtherMonth}
              />
            ))}
          </div>
        </div>

        {/* Sentiment alert side note (visible for context) */}
        {ALERTS.length > 0 && (
          <div
            className="rounded-lg border border-slate-200 bg-white p-4"
            data-sentiment-alerts-panel
          >
            <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Sentiment alerts</p>
            {ALERTS.map(a => (
              <p key={a.id} className="mt-2 text-[12px] text-slate-700" data-sentiment-alert-line={a.id}>
                <strong>{a.cardTitle}</strong> · Sentiment alert: {a.sentimentScore} negative · Resolved by {a.resolvedByName} · {formatDay(a.resolvedAt!)}
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
