// Settings → Localisation tab (Phase 3, migration 93).
//
// Install-wide locale defaults. User-level overrides are a future item
// — today every user shares the install's timezone + date format.

import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { platformApi, type LocalisationSettings } from '../api/platformApi'
import { ApiError } from '../../api/client'

function errMessage(err: unknown, fallback = 'Request failed'): string {
  if (err instanceof ApiError) {
    const body = err.body as { message?: string; error?: string } | null
    if (body?.message) return body.message
    if (body?.error)   return body.error
    return `${err.status}`
  }
  return err instanceof Error ? err.message : fallback
}

// Compact list of common IANA zones so the admin doesn't have to type.
// Free-form entry still works via the datalist pattern.
const COMMON_TIMEZONES = [
  'UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Madrid',
  'Asia/Kolkata', 'Asia/Tokyo', 'Asia/Shanghai', 'Asia/Singapore', 'Asia/Dubai',
  'Australia/Sydney',
]

// Top 25 ISO-3166 countries by likely customer base. Not exhaustive — the
// input accepts any 2-letter code; the datalist is just an aid.
const COMMON_COUNTRIES = [
  'US', 'GB', 'CA', 'AU', 'DE', 'FR', 'ES', 'IT', 'NL', 'SE',
  'JP', 'CN', 'IN', 'SG', 'KR', 'AE', 'IL', 'ZA', 'BR', 'MX',
  'CH', 'IE', 'DK', 'NO', 'FI',
]

const DATE_FORMATS = [
  'yyyy-MM-dd',          // 2026-11-19 (ISO)
  'dd/MM/yyyy',          // 19/11/2026 (EU)
  'MM/dd/yyyy',          // 11/19/2026 (US)
  'd MMM yyyy',          // 19 Nov 2026
  'MMMM d, yyyy',        // November 19, 2026
]

const CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'INR', 'AUD', 'CAD', 'CHF', 'CNY', 'SGD']

export function LocalisationTab() {
  const qc = useQueryClient()
  const settingsQ = useQuery({
    queryKey: ['platform-settings'],
    queryFn:  () => platformApi.getPlatformSettings(),
  })

  const [draft, setDraft] = useState<LocalisationSettings>({})
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    if (settingsQ.data) setDraft(settingsQ.data.localisation ?? {})
  }, [settingsQ.data])

  const saveMut = useMutation({
    mutationFn: (body: LocalisationSettings) => platformApi.updateLocalisation(body),
    onSuccess: () => {
      setNotice('Localisation saved.')
      qc.invalidateQueries({ queryKey: ['platform-settings'] })
    },
    onError: () => { setNotice(null) },
  })

  const field = <K extends keyof LocalisationSettings>(key: K) => (v: LocalisationSettings[K]) => {
    setDraft(prev => ({ ...prev, [key]: v }))
    setNotice(null)
  }

  return (
    <div className="flex flex-col gap-6" data-tab="localisation">
      <header>
        <h2 className="text-[16px] font-semibold text-slate-900">Localisation</h2>
        <p className="mt-1 text-[12px] text-slate-500">
          Install-wide defaults for time zone, country, date format, and currency.
          Applies to every user on this install &mdash; per-user overrides are a future
          enhancement.
        </p>
      </header>

      {settingsQ.isLoading && <p className="text-[13px] text-slate-500">Loading…</p>}
      {settingsQ.error && <p className="text-[13px] text-rose-700">{errMessage(settingsQ.error, 'Could not load settings')}</p>}

      {settingsQ.data && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <AutocompleteField
            label="Time zone"
            hint="IANA time zone (e.g. Asia/Kolkata). Used for timestamps, scheduling, and date-only UI."
            value={draft.timezone ?? ''}
            onChange={field('timezone')}
            options={COMMON_TIMEZONES}
            placeholder="UTC"
            listId="tz-list"
          />
          <AutocompleteField
            label="Country"
            hint="ISO-3166 alpha-2 country code (e.g. US, GB, IN). Default for new users."
            value={draft.country ?? ''}
            onChange={v => field('country')(v.toUpperCase())}
            options={COMMON_COUNTRIES}
            placeholder="US"
            listId="country-list"
            maxLength={2}
          />
          <SelectField
            label="Date format"
            hint="Applied to every date the UI renders (lists, cards, PDFs)."
            value={draft.dateFormat ?? ''}
            onChange={field('dateFormat')}
            options={DATE_FORMATS}
          />
          <SelectField
            label="Time format"
            hint="24-hour or 12-hour clock for timestamps."
            value={draft.timeFormat ?? '24h'}
            onChange={v => field('timeFormat')(v as '24h' | '12h')}
            options={['24h', '12h']}
          />
          <AutocompleteField
            label="Currency"
            hint="ISO-4217 code (e.g. USD, EUR, INR). Used by subscription + payment surfaces."
            value={draft.currency ?? ''}
            onChange={v => field('currency')(v.toUpperCase())}
            options={CURRENCIES}
            placeholder="USD"
            listId="currency-list"
            maxLength={3}
          />
        </div>
      )}

      {saveMut.error && (
        <p className="text-[12px] text-rose-700">{errMessage(saveMut.error, 'Save failed')}</p>
      )}
      {notice && !saveMut.error && (
        <p className="text-[12px] text-emerald-700">{notice}</p>
      )}

      <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-3">
        <button
          type="button"
          onClick={() => saveMut.mutate(draft)}
          disabled={saveMut.isPending || !settingsQ.data}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-[13px] font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {saveMut.isPending ? 'Saving…' : 'Save localisation'}
        </button>
      </div>
    </div>
  )
}

function AutocompleteField(props: {
  label: string; hint?: string; value: string; onChange: (v: string) => void
  options: string[]; placeholder?: string; listId: string; maxLength?: number
}) {
  return (
    <label className="block">
      <span className="block text-[12px] font-medium text-slate-700">{props.label}</span>
      <input
        type="text"
        value={props.value}
        onChange={e => props.onChange(e.target.value)}
        placeholder={props.placeholder}
        list={props.listId}
        maxLength={props.maxLength}
        className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-[13px] placeholder:text-slate-400 focus:border-blue-500 focus:outline-none"
      />
      <datalist id={props.listId}>
        {props.options.map(o => <option key={o} value={o} />)}
      </datalist>
      {props.hint && <span className="mt-1 block text-[11px] text-slate-500">{props.hint}</span>}
    </label>
  )
}

function SelectField(props: { label: string; hint?: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <label className="block">
      <span className="block text-[12px] font-medium text-slate-700">{props.label}</span>
      <select
        value={props.value}
        onChange={e => props.onChange(e.target.value)}
        className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-[13px] focus:border-blue-500 focus:outline-none"
      >
        <option value="">— pick one —</option>
        {props.options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
      {props.hint && <span className="mt-1 block text-[11px] text-slate-500">{props.hint}</span>}
    </label>
  )
}
