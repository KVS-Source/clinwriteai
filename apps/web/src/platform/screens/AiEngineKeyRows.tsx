// Settings → AI engine → "API keys" sub-section.
//
// Each unique provider from the engines list gets its own masked-key row with
// an Edit/Save affordance. Storage reuses the existing ExternalApiCredential
// table (apiId = lowercased provider name, e.g. "anthropic") so there's no
// new migration and the audit path is the same one that already covers the
// External APIs tab.
//
// The AI gateway today reads ANTHROPIC_API_KEY from env; this component lets
// an IT admin paste that key through the UI so a fresh install no longer
// needs shell access to turn AI on. The gateway will follow (DB-lookup
// ahead of env fallback) in a follow-up.

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { AiEngineOption } from '@platform/types'
import { PLATFORM_ACCENT } from '@platform/types'
import { platformApi, type ExternalApiCredentialRow } from '../api/platformApi'
import { describeApiError } from '../../api'

interface Props {
  engines: AiEngineOption[]
}

/** Provider → credential apiId. Lowercased so admins can rename a provider
 *  label (e.g. "Anthropic Inc.") without breaking the existing stored key. */
function apiIdForProvider(provider: string): string {
  return provider.trim().toLowerCase().replace(/\s+/g, '-')
}

interface ProviderGroup {
  apiId:    string
  label:    string
  engineIds: string[]
}

function groupByProvider(engines: AiEngineOption[]): ProviderGroup[] {
  const map = new Map<string, ProviderGroup>()
  for (const e of engines) {
    const apiId = apiIdForProvider(e.provider)
    const group = map.get(apiId)
    if (group) {
      group.engineIds.push(e.id)
    } else {
      map.set(apiId, { apiId, label: e.provider, engineIds: [e.id] })
    }
  }
  return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label))
}

export function AiEngineKeyRows({ engines }: Props) {
  const providers = useMemo(() => groupByProvider(engines), [engines])

  const { data: credRows = [] } = useQuery({
    queryKey: ['external-api-credentials'],
    queryFn:  () => platformApi.listExternalApiCredentials(),
    retry: false,
  })
  const byApiId = useMemo(
    () => new Map(credRows.map(r => [r.apiId, r])),
    [credRows],
  )

  if (providers.length === 0) return null

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4" data-ai-key-rows>
      <header className="mb-3">
        <h3 className="text-[13px] font-semibold text-slate-900">API keys</h3>
        <p className="mt-0.5 text-[12px] text-slate-600">
          One key per provider. The AI gateway tries the admin-saved key first and falls back to the server&rsquo;s environment variable.
        </p>
      </header>

      <div className="flex flex-col divide-y divide-slate-100">
        {providers.map(p => (
          <KeyRow
            key={p.apiId}
            provider={p}
            row={byApiId.get(p.apiId) ?? null}
          />
        ))}
      </div>
    </section>
  )
}

function KeyRow({ provider, row }: { provider: ProviderGroup; row: ExternalApiCredentialRow | null }) {
  const qc = useQueryClient()
  const [editing,    setEditing]    = useState(false)
  const [draftKey,   setDraftKey]   = useState('')
  const [reveal,     setReveal]     = useState(false)
  const [errorText,  setErrorText]  = useState<string | null>(null)

  const save = useMutation({
    mutationFn: (apiKey: string | null) =>
      platformApi.saveExternalApiCredentials(provider.apiId, { apiKey }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['external-api-credentials'] })
      void qc.invalidateQueries({ queryKey: ['ai-readiness'] })
      setEditing(false)
      setDraftKey('')
      setReveal(false)
      setErrorText(null)
    },
    onError: err => setErrorText(describeApiError(err).message),
  })

  function handleSave() {
    const trimmed = draftKey.trim()
    if (!trimmed) { setErrorText('Enter a key or click Clear to remove the stored one.'); return }
    save.mutate(trimmed)
  }

  function handleClear() {
    save.mutate(null)
  }

  const hasKey = row?.hasApiKey ?? false

  return (
    <div className="flex flex-wrap items-center gap-3 py-2.5" data-provider-row={provider.apiId}>
      <div className="min-w-[120px] flex-none">
        <p className="text-[13px] font-semibold text-slate-900">{provider.label}</p>
        <p className="mt-0.5 font-mono text-[10px] text-slate-500">{provider.engineIds.join(' · ')}</p>
      </div>

      {editing ? (
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <input
            type={reveal ? 'text' : 'password'}
            value={draftKey}
            onChange={e => { setDraftKey(e.target.value); setErrorText(null) }}
            placeholder={hasKey ? `Current: ${row?.apiKeyMasked ?? '•••'}` : 'Paste API key…'}
            autoFocus
            disabled={save.isPending}
            className="h-8 flex-1 min-w-[180px] rounded-md border border-slate-300 bg-white px-2 font-mono text-[12px] outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-100 disabled:opacity-50"
          />
          <button
            type="button"
            onClick={() => setReveal(r => !r)}
            className="h-8 rounded-md border border-slate-300 bg-white px-2 text-[11px] text-slate-700 hover:bg-slate-50"
          >{reveal ? 'Hide' : 'Show'}</button>
          <button
            type="button"
            onClick={handleSave}
            disabled={save.isPending || !draftKey.trim()}
            className="h-8 rounded-md px-3 text-[12px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
            style={{ backgroundColor: PLATFORM_ACCENT.primary }}
          >{save.isPending ? 'Saving…' : 'Save'}</button>
          <button
            type="button"
            onClick={() => { setEditing(false); setDraftKey(''); setReveal(false); setErrorText(null) }}
            disabled={save.isPending}
            className="h-8 rounded-md border border-slate-300 bg-white px-2 text-[12px] text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >Cancel</button>
        </div>
      ) : (
        <div className="flex flex-1 flex-wrap items-center gap-2">
          {hasKey ? (
            <>
              <code className="rounded bg-slate-100 px-2 py-1 font-mono text-[11px] text-slate-700">
                {row?.apiKeyMasked ?? '•••'}
              </code>
              <span className="font-mono text-[10px] text-slate-500">
                Updated {row ? new Date(row.updatedAt).toLocaleString() : '—'}
              </span>
            </>
          ) : (
            <span className="rounded bg-amber-50 px-2 py-1 font-mono text-[11px] text-amber-900">Not set</span>
          )}

          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="h-8 rounded-md border border-slate-300 bg-white px-3 text-[12px] font-semibold text-slate-700 hover:bg-slate-50"
            >{hasKey ? 'Replace' : 'Set key'}</button>
            {hasKey && (
              <button
                type="button"
                onClick={handleClear}
                disabled={save.isPending}
                className="h-8 rounded-md border border-slate-300 bg-white px-2 text-[11px] text-slate-700 hover:bg-red-50 hover:text-red-700 disabled:opacity-50"
              >Clear</button>
            )}
          </div>
        </div>
      )}

      {errorText && (
        <p className="w-full text-[11px] text-red-600">{errorText}</p>
      )}
    </div>
  )
}
