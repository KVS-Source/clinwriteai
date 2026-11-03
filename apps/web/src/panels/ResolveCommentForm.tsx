import { useState } from 'react'
import { useTranslation } from 'react-i18next'
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

const OPTION_KEYS: { type: ResolutionType; labelKey: string; hintKey: string }[] = [
  { type: 'accept',                   labelKey: 'page.resolve_comment_form.option_accept_label',          hintKey: 'page.resolve_comment_form.option_accept_hint' },
  { type: 'accept-with-modification', labelKey: 'page.resolve_comment_form.option_accept_mod_label',      hintKey: 'page.resolve_comment_form.option_accept_mod_hint' },
  { type: 'reject',                   labelKey: 'page.resolve_comment_form.option_reject_label',          hintKey: 'page.resolve_comment_form.option_reject_hint' },
]

export const RESOLVE_NOTE_MAX = 500

// Internal English labels for the resolution-note parser. These are
// identifiers used in audit entries (not user-facing chrome), so they
// stay in English. Use RESOLUTION_LABEL_KEYS for display.
export const RESOLUTION_LABEL: Record<string, string> = {
  accept:                   'Accepted',
  accept_with_modification: 'Accepted with modification',
  reject:                   'Rejected',
}

export const RESOLUTION_LABEL_KEYS: Record<string, string> = {
  accept:                   'page.resolve_comment_form.resolution_accepted',
  accept_with_modification: 'page.resolve_comment_form.resolution_accepted_with_modification',
  reject:                   'page.resolve_comment_form.resolution_rejected',
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
  const { t } = useTranslation()
  const [type, setType] = useState<ResolutionType>('accept')
  const [note, setNote] = useState('')
  const [err,  setErr]  = useState<string | null>(null)

  const submit = () => {
    // Enter in the note field bypasses the disabled button; don't send a second request.
    if (isPending) return
    if (!note.trim()) { setErr(t('page.resolve_comment_form.note_required')); return }
    onConfirm(type, note.trim())
  }

  return (
    <div
      className="flex flex-col gap-2 rounded border p-2.5"
      style={{ borderColor: '#BFDBFE', backgroundColor: '#EFF6FF' }}
      data-resolve-form
    >
      <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label={t('page.resolve_comment_form.resolution_type_aria')}>
        <span className="text-[11px] font-semibold text-slate-700">{t('page.resolve_comment_form.type_label')}</span>
        {OPTION_KEYS.map(o => (
          <button
            key={o.type}
            type="button"
            role="radio"
            aria-checked={type === o.type}
            title={t(o.hintKey)}
            onClick={() => setType(o.type)}
            className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold transition-colors"
            style={type === o.type ? {
              backgroundColor: '#2563EB', color: '#FFFFFF', border: '1px solid #2563EB',
            } : {
              backgroundColor: '#FFFFFF', color: '#475569', border: '1px solid #E2E8F0',
            }}
          >
            {t(o.labelKey)}
          </button>
        ))}
      </div>
      <label>
        <span className="text-[11px] font-semibold text-slate-700">{t('page.resolve_comment_form.note_label')}</span>
        <input
          type="text"
          value={note}
          maxLength={RESOLVE_NOTE_MAX}
          onChange={e => { setNote(e.target.value); if (err) setErr(null) }}
          onKeyDown={e => { if (e.key === 'Enter') submit() }}
          placeholder={t('page.resolve_comment_form.note_placeholder')}
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
          {t('button.cancel')}
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={isPending}
          data-action="confirm-resolve"
          className="rounded bg-blue-600 px-3 py-1 text-[11px] font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {isPending ? t('page.resolve_comment_form.resolving') : t('page.resolve_comment_form.confirm_resolve')}
        </button>
      </div>
    </div>
  )
}
