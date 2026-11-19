// Settings → Branding tab (Phase 3, migration 93).
//
// Install-wide branding IT admin edits once. Server merges partial
// PATCH bodies so a single-field update doesn't overwrite the others.

import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { platformApi, type BrandingSettings } from '../api/platformApi'
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

export function BrandingTab() {
  const qc = useQueryClient()
  const settingsQ = useQuery({
    queryKey: ['platform-settings'],
    queryFn:  () => platformApi.getPlatformSettings(),
  })

  const [draft, setDraft] = useState<BrandingSettings>({})
  const [notice, setNotice] = useState<string | null>(null)

  // Hydrate the editor when the server view arrives. React-query's
  // isLoading flips to false before `data` is set, so gate on both.
  useEffect(() => {
    if (settingsQ.data) setDraft(settingsQ.data.branding ?? {})
  }, [settingsQ.data])

  const saveMut = useMutation({
    mutationFn: (body: BrandingSettings) => platformApi.updateBranding(body),
    onSuccess: () => {
      setNotice('Branding saved.')
      qc.invalidateQueries({ queryKey: ['platform-settings'] })
    },
    onError: () => { setNotice(null) },
  })

  const field = <K extends keyof BrandingSettings>(key: K) => (v: BrandingSettings[K]) => {
    setDraft(prev => ({ ...prev, [key]: v }))
    setNotice(null)
  }

  return (
    <div className="flex flex-col gap-6" data-tab="branding">
      <header>
        <h2 className="text-[16px] font-semibold text-slate-900">Branding</h2>
        <p className="mt-1 text-[12px] text-slate-500">
          How the install appears to users and in generated emails / PDFs. Changes take
          effect on the next page load for most surfaces; outbound emails use the current
          values at send time.
        </p>
      </header>

      {settingsQ.isLoading && <p className="text-[13px] text-slate-500">Loading…</p>}
      {settingsQ.error && <p className="text-[13px] text-rose-700">{errMessage(settingsQ.error, 'Could not load settings')}</p>}

      {settingsQ.data && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field
            label="Company name"
            hint="Shown in the top bar, email sender, and PDF headers."
            value={draft.companyName ?? ''}
            onChange={field('companyName')}
            placeholder="ClinWrite.AI"
          />
          <Field
            label="Email from name"
            hint="The sender name that appears on outbound notification emails."
            value={draft.emailFromName ?? ''}
            onChange={field('emailFromName')}
            placeholder={draft.companyName || 'ClinWrite.AI'}
          />
          <ColorField
            label="Primary color"
            hint="Used for accents, active states, and the top bar underline."
            value={draft.primaryColor ?? ''}
            onChange={field('primaryColor')}
          />
          <Field
            label="Logo URL"
            hint="Direct link to a PNG/SVG. Appears top-left in the app shell (max 160×40px)."
            value={draft.logoUrl ?? ''}
            onChange={field('logoUrl')}
            placeholder="https://cdn.example.com/logo.png"
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
          {saveMut.isPending ? 'Saving…' : 'Save branding'}
        </button>
      </div>
    </div>
  )
}

function Field(props: { label: string; hint?: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="block">
      <span className="block text-[12px] font-medium text-slate-700">{props.label}</span>
      <input
        type="text"
        value={props.value}
        onChange={e => props.onChange(e.target.value)}
        placeholder={props.placeholder}
        className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-[13px] placeholder:text-slate-400 focus:border-blue-500 focus:outline-none"
      />
      {props.hint && <span className="mt-1 block text-[11px] text-slate-500">{props.hint}</span>}
    </label>
  )
}

function ColorField(props: { label: string; hint?: string; value: string; onChange: (v: string) => void }) {
  const normalised = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(props.value) ? props.value : '#2563EB'
  return (
    <label className="block">
      <span className="block text-[12px] font-medium text-slate-700">{props.label}</span>
      <div className="mt-1 flex items-center gap-2">
        <input
          type="color"
          value={normalised}
          onChange={e => props.onChange(e.target.value.toUpperCase())}
          className="h-9 w-12 cursor-pointer rounded border border-slate-300 bg-white"
          aria-label={`${props.label} color picker`}
        />
        <input
          type="text"
          value={props.value}
          onChange={e => props.onChange(e.target.value)}
          placeholder="#2563EB"
          className="flex-1 rounded-md border border-slate-300 bg-white px-3 py-1.5 font-mono text-[12px] focus:border-blue-500 focus:outline-none"
        />
      </div>
      {props.hint && <span className="mt-1 block text-[11px] text-slate-500">{props.hint}</span>}
    </label>
  )
}
