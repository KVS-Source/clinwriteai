// Small floating pill that tells testers which handler groups are mocked.
//
// Why it exists: during Phase 2 cutover we toggle groups one at a time, and
// it's easy for a tester to think they're exercising the real API when they
// aren't (or vice versa). The badge removes that ambiguity.
//
// Visibility: shown when at least one mock group is active OR when
// VITE_SHOW_CUTOVER_BADGE is set. Never shown in production builds unless
// VITE_SHOW_CUTOVER_BADGE=on — leaking internal state to end users is a
// support burden.

import { useState } from 'react'
import { activeMockGroups } from '../mocks/browser'
import { apiConfig } from '../api/client'

export function CutoverBadge() {
  const [open, setOpen] = useState(false)
  const mocks = activeMockGroups()

  const show =
    import.meta.env.DEV ||
    import.meta.env.VITE_SHOW_CUTOVER_BADGE === 'on' ||
    mocks.length > 0

  if (!show) return null

  const label = mocks.length === 0 ? 'LIVE API' : `MSW: ${mocks.length} group${mocks.length === 1 ? '' : 's'}`
  const tone = mocks.length === 0 ? 'bg-emerald-600' : 'bg-amber-600'

  return (
    <div
      className="fixed bottom-4 right-4 z-[9999] font-mono text-xs text-white shadow-lg select-none"
      role="status"
      aria-label="API cutover status"
    >
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className={`${tone} rounded-full px-3 py-1 opacity-80 hover:opacity-100 transition`}
      >
        {label} {open ? '▾' : '▸'}
      </button>
      {open && (
        <div className="mt-1 bg-slate-900/95 text-slate-100 rounded-md p-3 w-72 space-y-1">
          <div className="font-semibold text-emerald-300">API base</div>
          <div className="truncate">{apiConfig.baseUrl}</div>
          <div className="font-semibold text-emerald-300 pt-2">Mocked groups</div>
          {mocks.length === 0 ? (
            <div className="text-slate-400">none — all requests hit the real API</div>
          ) : (
            <ul className="space-y-0.5">
              {mocks.map(m => (
                <li key={m} className="text-amber-200">• {m}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
