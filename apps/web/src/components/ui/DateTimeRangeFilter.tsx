// Date & time range filter shared by the admin Audit Trail page and the per-document
// audit panel: one button showing the current range that opens a popover with From / To
// (date + time, to the minute), quick presets, a "Times in" timezone choice and Clear.
// The default range is one month back to the end of today.

import { useEffect, useRef, useState } from 'react'

export type TimeZoneMode = 'local' | 'utc'

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

const inputClass = 'rounded-md border border-slate-300 px-2 py-1.5 text-[12px]'

// A picked date + time (to the minute) → the ISO instant, in the timezone the
// viewer has chosen. The end of the range covers that whole minute.
export function rangeToIso(value: string, edge: 'start' | 'end', tz: TimeZoneMode): string | undefined {
  if (!value) return undefined
  const secs = edge === 'start' ? ':00.000' : ':59.999'
  return tz === 'utc'
    ? `${value}${secs}Z`
    : new Date(`${value}${secs}`).toISOString()  // no suffix → parsed as browser-local
}

// A Date → the YYYY-MM-DDTHH:mm string a datetime-local input expects, in the chosen timezone.
export function toInputValue(d: Date, tz: TimeZoneMode): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return tz === 'utc'
    ? `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`
    : `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

// '2026-10-27T09:05' → '27 Oct 09:05'
function shortWhen(value: string): string {
  const [day, time] = value.split('T')
  const [, m, d] = (day ?? '').split('-').map(Number)
  return m && d ? `${String(d).padStart(2, '0')} ${MONTHS[m - 1]} ${time ?? ''}`.trim() : value
}

type RangePreset = { label: string; ms?: number; today?: true; months?: number }

const RANGE_PRESETS: RangePreset[] = [
  { label: 'Last hour',     ms: 60 * 60 * 1000 },
  { label: 'Last 24 hours', ms: 24 * 60 * 60 * 1000 },
  { label: 'Today',         today: true },
  { label: 'Last 7 days',   ms: 7 * 24 * 60 * 60 * 1000 },
  { label: 'Last month',    months: 1 },
]

// Default range: the start of the same day last month → the end of today, so the
// page opens on one month of history and entries arriving later today still show.
export function defaultRange(tz: TimeZoneMode): { from: string; to: string } {
  const now = new Date()
  const start = new Date(now)
  if (tz === 'utc') start.setUTCMonth(start.getUTCMonth() - 1)
  else start.setMonth(start.getMonth() - 1)
  return { from: `${toInputValue(start, tz).slice(0, 10)}T00:00`, to: `${toInputValue(now, tz).slice(0, 10)}T23:59` }
}

// The from/to a preset means right now, in the chosen timezone.
function presetRange(p: RangePreset, tz: TimeZoneMode): { from: string; to: string } {
  const now = new Date()
  const to = toInputValue(now, tz)
  if (p.today) return { from: `${to.slice(0, 10)}T00:00`, to }
  if (p.months) {
    const start = new Date(now)
    if (tz === 'utc') start.setUTCMonth(start.getUTCMonth() - p.months)
    else start.setMonth(start.getMonth() - p.months)
    return { from: toInputValue(start, tz), to }
  }
  return { from: toInputValue(new Date(now.getTime() - p.ms!), tz), to }
}

// One "Date & time" filter: a button showing the current range that opens a popover
// with From / To (date + time, to the minute), quick presets and Clear. Values are in
// the "Times in" timezone the viewer picked.
export function DateTimeRangeFilter({ from, to, tz, invalid, onChange, onTzChange, align = 'right' }: {
  from: string; to: string; tz: TimeZoneMode; invalid: boolean
  onChange: (range: { from: string; to: string }) => void
  onTzChange: (tz: TimeZoneMode) => void
  /** Which edge of the button the popover lines up with (use 'left' when the button sits on the left of a narrow panel). */
  align?: 'left' | 'right'
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    // Esc closes just this popover. It is handled first (capture) and marked as used, so a
    // panel the filter sits in doesn't also close on the same keypress.
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); setOpen(false) } }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey, true)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey, true) }
  }, [open])

  const label =
    from && to ? `${shortWhen(from)} → ${shortWhen(to)}` :
    from       ? `From ${shortWhen(from)}` :
    to         ? `Until ${shortWhen(to)}` :
                 'Date & time range'

  // Which preset produced the current range. It stays highlighted only while the
  // range is untouched — editing From/To, clearing or Reset un-highlights it.
  const [picked, setPicked] = useState<{ label: string; from: string; to: string } | null>(null)
  const activePreset = picked && picked.from === from && picked.to === to ? picked.label : null

  const applyPreset = (p: RangePreset) => {
    const range = presetRange(p, tz)
    setPicked({ label: p.label, ...range })
    onChange(range)
    setOpen(false)
  }

  const fieldLabel = 'flex flex-col gap-1 text-[11px] font-semibold text-slate-600'

  return (
    <div ref={ref} className="relative" data-field="date-range">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`${inputClass} flex min-w-[220px] items-center justify-between gap-2 bg-white text-left ${from || to ? 'text-slate-900' : 'text-slate-500'} ${invalid ? 'border-red-400' : ''}`}
      >
        <span className="truncate">{label}</span>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="flex-none text-slate-500" aria-hidden>
          <rect x="2" y="3" width="12" height="11" rx="1.5" /><path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3" />
        </svg>
      </button>

      {open && (
        <div role="dialog" aria-label="Date and time range" className={`absolute ${align === 'left' ? 'left-0' : 'right-0'} z-20 mt-1 w-[320px] rounded-lg border border-slate-200 bg-white p-4 shadow-xl`}>
          <div className="flex flex-wrap gap-1.5">
            {RANGE_PRESETS.map(p => {
              const active = activePreset === p.label
              return (
                <button key={p.label} type="button" onClick={() => applyPreset(p)}
                  aria-pressed={active}
                  data-preset={p.label}
                  className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                    active
                      ? 'border-slate-800 bg-slate-800 font-semibold text-white'
                      : 'border-slate-300 text-slate-700 hover:bg-slate-50'
                  }`}
                >{p.label}</button>
              )
            })}
          </div>

          <div className="mt-3 flex flex-col gap-3">
            <label className={fieldLabel}>
              From
              <input type="datetime-local" className={`${inputClass} w-full`} value={from} max={to || undefined}
                onChange={e => onChange({ from: e.target.value, to })} data-field="from" />
            </label>
            <label className={fieldLabel}>
              To
              <input type="datetime-local" className={`${inputClass} w-full`} value={to} min={from || undefined}
                onChange={e => onChange({ from, to: e.target.value })} data-field="to" />
            </label>
          </div>

          {invalid && <p className="mt-2 text-[11px] text-red-700">"From" is after "To".</p>}
          {/* Which timezone the From / To above (and the table's times) are in. Switching keeps
              the range pointing at the same moments. */}
          <label className="mt-3 flex items-center justify-between gap-2 text-[11px] font-semibold text-slate-600">
            Times in
            <select className={`${inputClass} w-[200px] font-normal text-slate-900`} value={tz}
              onChange={e => onTzChange(e.target.value as TimeZoneMode)} data-field="timezone">
              <option value="local">Local ({Intl.DateTimeFormat().resolvedOptions().timeZone})</option>
              <option value="utc">UTC</option>
            </select>
          </label>
          <p className="mt-1.5 font-mono text-[10px] text-slate-500">"To" includes that whole minute.</p>

          <div className="mt-3 flex justify-between border-t border-slate-200 pt-3">
            <button type="button" onClick={() => onChange({ from: '', to: '' })} disabled={!from && !to}
              className="rounded-md px-2 py-1 text-[12px] text-slate-600 hover:bg-slate-100 disabled:opacity-40">Clear</button>
            <button type="button" onClick={() => setOpen(false)}
              className="rounded-md bg-slate-800 px-3 py-1 text-[12px] font-semibold text-white">Done</button>
          </div>
        </div>
      )}
    </div>
  )
}
