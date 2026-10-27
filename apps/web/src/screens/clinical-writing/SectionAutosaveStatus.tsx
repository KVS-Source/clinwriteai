// Status pill shown next to the section title (sPM-autosave).
//
// Replaces the previous Edit section / Save section / Discard buttons —
// the writer no longer has to think about modes. The pill reflects:
//
//   - Autosave status (idle / dirty / saving / saved / error) when this
//     user owns the lock.
//   - Foreign lock holder ("Read-only — Alice is editing · 48s") when
//     another user holds. Clicking it does nothing by design; the lock
//     releases itself when the other user navigates away.
//   - A quiet nothing when there's no active section.
//
// Deliberately a single <span> so it slots into any inline layout.

import type { AutosaveStatus } from '../../hooks/useAutosave'
import type { LockMode, LockHolder } from '../../hooks/useSectionLock'

function fmtClock(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

function fmtExpiresIn(seconds: number): string {
  if (seconds <= 60) return `${seconds}s`
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return s === 0 ? `${m}m` : `${m}m ${s}s`
}

export interface SectionAutosaveStatusProps {
  lockMode:    LockMode
  holder:      LockHolder | null
  holderName?: string                           // resolved from userId by the caller; falls back to the raw id
  status:      AutosaveStatus
  lastSavedAt: Date | null
}

export function SectionAutosaveStatus({ lockMode, holder, holderName, status, lastSavedAt }: SectionAutosaveStatusProps) {
  if (lockMode === 'foreign' && holder) {
    const name = holderName ?? holder.userId
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800"
        title={`Lease expires in ${fmtExpiresIn(holder.expiresInSeconds)} unless renewed`}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.4">
          <rect x="2" y="4.4" width="6" height="4" rx="0.8" />
          <path d="M3.4 4.4 V3 a1.6 1.6 0 0 1 3.2 0 V4.4" />
        </svg>
        Read-only — {name} is editing
      </span>
    )
  }

  // 'owned' + 'idle' + 'error' all use the same pill style; the inner text + icon change.
  let label = ''
  let tone: 'neutral' | 'muted' | 'ok' | 'err' = 'muted'
  let icon: React.ReactNode = null

  if (status === 'saving') {
    label = 'Saving…'
    tone = 'neutral'
    icon = (
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.4" className="animate-spin">
        <circle cx="5" cy="5" r="3.2" strokeDasharray="12 20" />
      </svg>
    )
  } else if (status === 'error') {
    label = 'Save failed — retrying on next change'
    tone = 'err'
    icon = (
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.4">
        <circle cx="5" cy="5" r="3.6" />
        <line x1="5" y1="3.4" x2="5" y2="5.6" strokeLinecap="round" />
        <circle cx="5" cy="7" r="0.4" fill="currentColor" />
      </svg>
    )
  } else if (status === 'dirty') {
    label = 'Editing — autosaves on pause'
    tone = 'muted'
    icon = (
      <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
        <circle cx="5" cy="5" r="2" />
      </svg>
    )
  } else if (status === 'saved' && lastSavedAt) {
    label = `Saved ${fmtClock(lastSavedAt)}`
    tone = 'ok'
    icon = (
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="2.4,5.4 4.2,7.2 7.6,3.4" />
      </svg>
    )
  } else {
    label = lockMode === 'owned' ? 'Ready — autosaves when you type' : 'Open — click to edit'
    tone = 'muted'
  }

  const toneClass =
    tone === 'ok'      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'  :
    tone === 'err'     ? 'border-rose-300 bg-rose-50 text-rose-700'           :
    tone === 'neutral' ? 'border-blue-200 bg-blue-50 text-blue-700'           :
                         'border-slate-200 bg-slate-50 text-slate-500'

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-semibold ${toneClass}`}>
      {icon}
      {label}
    </span>
  )
}
