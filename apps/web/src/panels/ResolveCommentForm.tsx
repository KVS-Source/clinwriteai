import { useState } from 'react'
import type { ResolutionType } from '@platform/types'

// Inline "resolve a comment" form (PRD AC-A-055 / API contract: resolution
// type + a mandatory note). Shared by the Comments dashboard and the
// reviewer-view Comments panel so both behave identically.

interface ResolveFormProps {
  onCancel:  () => void
  onConfirm: (type: ResolutionType, note: string) => void
  isPending: boolean
  error?:    string | null
}

const OPTIONS: { type: ResolutionType; label: string; hint: string }[] = [
  { type: 'accept',                   label: 'Accept',         hint: 'Implement as requested' },
  { type: 'accept-with-modification', label: 'Accept w/ mod',  hint: 'Implement with changes' },
  { type: 'reject',                   label: 'Reject',         hint: 'Do not implement' },
]

export const RESOLVE_NOTE_MAX = 500

export const RESOLUTION_LABEL: Record<string, string> = {
  accept:                   'Accepted',
  accept_with_modification: 'Accepted with modification',
  reject:                   'Rejected',
}

// Resolution notes are stored with a tag in front: "[accept] text" when resolved directly, or
// "[CRM:CRM-002:accept_with_modification] text" when resolved in a CRM meeting. Split it off.
export function parseResolutionNote(note: string | null | undefined): { text: string; viaCrm: string | null; decision: string | null } {
  const raw = note ?? ''
  const crm = /^\[CRM:([^:\]]+):([^\]]*)\]\s*/.exec(raw)
  if (crm) return { text: raw.slice(crm[0].length), viaCrm: crm[1], decision: RESOLUTION_LABEL[crm[2]] ?? null }
  const plain = /^\[([a-z_]+)\]\s*/.exec(raw)
  if (plain && RESOLUTION_LABEL[plain[1]]) return { text: raw.slice(plain[0].length), viaCrm: null, decision: RESOLUTION_LABEL[plain[1]] }
  return { text: raw, viaCrm: null, decision: null }
}

export function ResolveForm({ onCancel, onConfirm, isPending, error }: ResolveFormProps) {
  const [type, setType] = useState<ResolutionType>('accept')
  const [note, setNote] = useState('')
  const [err,  setErr]  = useState<string | null>(null)

  const submit = () => {
    // Enter in the note field bypasses the disabled button; don't send a second request.
    if (isPending) return
    if (!note.trim()) { setErr('Resolution note is required'); return }
    onConfirm(type, note.trim())
  }

  return (
    <div
      className="flex flex-col gap-2 rounded border p-2.5"
      style={{ borderColor: '#BFDBFE', backgroundColor: '#EFF6FF' }}
      data-resolve-form
    >
      <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="Resolution type">
        <span className="text-[11px] font-semibold text-slate-700">Type:</span>
        {OPTIONS.map(o => (
          <button
            key={o.type}
            type="button"
            role="radio"
            aria-checked={type === o.type}
            title={o.hint}
            onClick={() => setType(o.type)}
            className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold transition-colors"
            style={type === o.type ? {
              backgroundColor: '#2563EB', color: '#FFFFFF', border: '1px solid #2563EB',
            } : {
              backgroundColor: '#FFFFFF', color: '#475569', border: '1px solid #E2E8F0',
            }}
          >
            {o.label}
          </button>
        ))}
      </div>
      <label>
        <span className="text-[11px] font-semibold text-slate-700">Resolution note (required)</span>
        <input
          type="text"
          value={note}
          maxLength={RESOLVE_NOTE_MAX}
          onChange={e => { setNote(e.target.value); if (err) setErr(null) }}
          onKeyDown={e => { if (e.key === 'Enter') submit() }}
          placeholder="Describe how this comment was resolved"
          className="mt-1 h-8 w-full rounded border px-2 text-[12px] outline-none focus:border-blue-600 focus:shadow-focus"
          style={{ borderColor: '#E2E8F0' }}
          autoFocus
        />
      </label>
      {(err ?? error) && <p className="text-[11px] font-semibold" style={{ color: '#DC2626' }} role="alert">{err ?? error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={isPending}
          className="rounded border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={isPending}
          data-action="confirm-resolve"
          className="rounded bg-blue-600 px-3 py-1 text-[11px] font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {isPending ? 'Resolving…' : 'Confirm resolve'}
        </button>
      </div>
    </div>
  )
}
