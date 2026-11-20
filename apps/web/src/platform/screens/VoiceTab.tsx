// Settings → Voice transcription tab.
//
// Admin picks the active engine (cards are now clickable), adjusts GDPR
// jurisdiction + audio retention, and pastes the provider's API key inline.
// Engine/jurisdiction/retention persist via PATCH /platform-settings/voice
// (migration 96); the API key persists via the shared ExternalApiCredential
// pipe with apiId = `voice-<engine>`.

import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import type { PlatformConfig, VoiceEngineOption } from '@platform/types'
import { PLATFORM_ACCENT } from '@platform/types'
import {
  platformApi,
  type ExternalApiCredentialRow,
  type PlatformSettingsView,
  type VoiceSettings,
} from '../api/platformApi'
import { describeApiError } from '../../api'

interface Props {
  config: PlatformConfig
}

type Jurisdiction = 'EU' | 'UK' | 'US' | 'APAC'
type Retention    = 'delete-immediately' | 'retain-30d' | 'retain-90d'

function voiceApiId(engineId: string): string {
  return `voice-${engineId}`
}

export function VoiceTab({ config }: Props) {
  const { t } = useTranslation()
  const qc = useQueryClient()

  const { data: settings } = useQuery<PlatformSettingsView>({
    queryKey: ['platform-settings'],
    queryFn:  () => platformApi.getPlatformSettings(),
  })

  // Saved values from the PlatformSettings row override the stub values on
  // PlatformConfig (which exists for back-compat with mock-mode). Falls back
  // to the stub defaults until the admin saves their first change.
  const saved = settings?.voice ?? {}
  const activeEngineId = saved.engine ?? config.voiceTranscription.engine
  const jurisdiction: Jurisdiction =
    (saved.gdprJurisdiction as Jurisdiction | undefined) ?? (config.voiceTranscription.gdprJurisdiction as Jurisdiction)
  const retention: Retention =
    (saved.audioRetentionPolicy as Retention | undefined) ??
    ((config.voiceTranscription.audioRetentionPolicy as Retention | undefined) ?? 'delete-immediately')

  const engines = config.voiceTranscription.availableEngines

  const [draft, setDraft] = useState<VoiceSettings>({
    engine:               activeEngineId,
    gdprJurisdiction:     jurisdiction,
    audioRetentionPolicy: retention,
  })
  const [saveError, setSaveError] = useState<string | null>(null)

  // Re-sync the draft when the server answers (first load, or after another
  // tab's save invalidates the query). Skipped once the user edits locally.
  useEffect(() => {
    setDraft({
      engine:               activeEngineId,
      gdprJurisdiction:     jurisdiction,
      audioRetentionPolicy: retention,
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings?.updatedAt])

  const dirty =
    draft.engine !== activeEngineId
    || draft.gdprJurisdiction !== jurisdiction
    || draft.audioRetentionPolicy !== retention

  const save = useMutation({
    mutationFn: (body: Partial<VoiceSettings>) => platformApi.updateVoiceSettings(body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['platform-settings'] })
      void qc.invalidateQueries({ queryKey: ['platform-config'] })
      setSaveError(null)
    },
    onError: err => setSaveError(describeApiError(err).message),
  })

  function handleSave() {
    setSaveError(null)
    save.mutate({
      engine:               draft.engine,
      gdprJurisdiction:     draft.gdprJurisdiction,
      audioRetentionPolicy: draft.audioRetentionPolicy,
    })
  }

  return (
    <div className="flex flex-col gap-5" data-tab-panel="voice">
      <header>
        <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">{t('page.admin_panel.tab_voice')}</p>
        <h2 className="text-[16px] font-semibold text-slate-900">{t('page.admin_panel.voice_section_title')}</h2>
        <p className="mt-1 text-[12px] text-slate-500">{t('page.admin_panel.voice_section_subtitle')}</p>
      </header>

      {/* Clickable engine cards. Picking a new engine marks the draft dirty;
          the Save button below commits engine + GDPR + retention in one PATCH. */}
      <div
        className="grid gap-3"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}
        data-voice-grid
        role="radiogroup"
        aria-label="Voice transcription engine"
      >
        {engines.map(e => (
          <VoiceEngineCard
            key={e.id}
            engine={e}
            active={e.id === draft.engine}
            onPick={() => setDraft(d => ({ ...d, engine: e.id }))}
          />
        ))}
      </div>

      {/* API key for the picked engine. Independent of the Save button
          because keys persist through their own PUT (same as the AI engine
          key rows) — one card visible at a time, matching the "one key per
          provider" model. */}
      {draft.engine && (
        <VoiceEngineKeyRow
          engineId={draft.engine}
          engineLabel={engines.find(x => x.id === draft.engine)?.label ?? draft.engine}
        />
      )}

      {/* GDPR + retention row. */}
      <div className="rounded-lg border border-slate-200 bg-white p-4" data-gdpr>
        <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">{t('page.admin_panel.gdpr_posture')}</p>
        <div className="mt-2 grid gap-3" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <div>
            <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">{t('page.admin_panel.jurisdiction')}</p>
            <select
              value={draft.gdprJurisdiction ?? 'APAC'}
              onChange={e => setDraft(d => ({ ...d, gdprJurisdiction: e.target.value as Jurisdiction }))}
              data-jurisdiction-select
              data-jurisdiction-value={draft.gdprJurisdiction}
              className="mt-1 h-9 w-full rounded-md border border-slate-300 px-3 text-[13px]"
            >
              <option value="EU">EU</option>
              <option value="UK">UK</option>
              <option value="US">US</option>
              <option value="APAC">APAC</option>
            </select>
          </div>
          <div>
            <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">{t('page.admin_panel.audio_retention')}</p>
            <select
              value={draft.audioRetentionPolicy ?? 'delete-immediately'}
              onChange={e => setDraft(d => ({ ...d, audioRetentionPolicy: e.target.value as Retention }))}
              data-audio-retention-select
              className="mt-1 h-9 w-full rounded-md border border-slate-300 px-3 text-[13px]"
            >
              <option value="delete-immediately">{t('page.admin_panel.audio_delete_immediately')}</option>
              <option value="retain-30d">Retain 30 days</option>
              <option value="retain-90d">Retain 90 days</option>
            </select>
          </div>
        </div>
        <p
          className="mt-3 rounded-md p-3 text-[12px]"
          style={{ backgroundColor: PLATFORM_ACCENT.bgTint, color: PLATFORM_ACCENT.primary }}
          data-gdpr-note
        >
          {t('page.admin_panel.audio_gdpr_note')}
        </p>
      </div>

      {saveError && (
        <p className="rounded-md border border-red-200 bg-red-50 p-3 text-[12px] text-red-700">{saveError}</p>
      )}

      <div className="flex items-center justify-end gap-2">
        {dirty && (
          <button
            type="button"
            onClick={() => setDraft({ engine: activeEngineId, gdprJurisdiction: jurisdiction, audioRetentionPolicy: retention })}
            disabled={save.isPending}
            className="h-9 rounded-md border border-slate-300 bg-white px-3 text-[13px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >Discard</button>
        )}
        <button
          type="button"
          onClick={handleSave}
          disabled={!dirty || save.isPending}
          className="h-9 rounded-md px-4 text-[13px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
          style={{ backgroundColor: PLATFORM_ACCENT.primary }}
        >{save.isPending ? 'Saving…' : 'Save voice settings'}</button>
      </div>
    </div>
  )
}

function VoiceEngineCard({ engine, active, onPick }: { engine: VoiceEngineOption; active: boolean; onPick: () => void }) {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onPick}
      className="rounded-lg bg-white p-4 text-left transition-shadow hover:shadow-md focus:outline-none focus-visible:ring-2"
      style={{
        border:   `${active ? 2 : 1}px solid ${active ? PLATFORM_ACCENT.primary : '#E2E8F0'}`,
        boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
        cursor:   'pointer',
      }}
      data-voice-engine={engine.id}
      data-voice-active={active || undefined}
    >
      <p className="text-[14px] font-semibold text-slate-900">{engine.label}</p>
      <div className="mt-2">
        {active ? (
          <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ backgroundColor: '#F0FDF4', color: '#166534' }}>
            ✓ {t('page.admin_panel.chip_active')}
          </span>
        ) : (
          <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ backgroundColor: '#F1F5F9', color: '#475569' }}>
            ○ {t('page.admin_panel.chip_available')}
          </span>
        )}
      </div>
    </button>
  )
}

function VoiceEngineKeyRow({ engineId, engineLabel }: { engineId: string; engineLabel: string }) {
  const qc = useQueryClient()
  const apiId = useMemo(() => voiceApiId(engineId), [engineId])

  const { data: credRows = [] } = useQuery({
    queryKey: ['external-api-credentials'],
    queryFn:  () => platformApi.listExternalApiCredentials(),
    retry: false,
  })
  const row: ExternalApiCredentialRow | null = useMemo(
    () => credRows.find(r => r.apiId === apiId) ?? null,
    [credRows, apiId],
  )

  const [editing,    setEditing]    = useState(false)
  const [draftKey,   setDraftKey]   = useState('')
  const [reveal,     setReveal]     = useState(false)
  const [errorText,  setErrorText]  = useState<string | null>(null)

  // Reset the editor when the admin picks a different engine; the previous
  // engine's draft shouldn't carry over.
  useEffect(() => {
    setEditing(false)
    setDraftKey('')
    setReveal(false)
    setErrorText(null)
  }, [engineId])

  const save = useMutation({
    mutationFn: (apiKey: string | null) =>
      platformApi.saveExternalApiCredentials(apiId, { apiKey }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['external-api-credentials'] })
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

  const hasKey = row?.hasApiKey ?? false

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4" data-voice-key-row data-voice-key-engine={engineId}>
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-[140px] flex-none">
          <p className="text-[13px] font-semibold text-slate-900">{engineLabel} API key</p>
          <p className="mt-0.5 font-mono text-[10px] text-slate-500">{apiId}</p>
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
                  onClick={() => save.mutate(null)}
                  disabled={save.isPending}
                  className="h-8 rounded-md border border-slate-300 bg-white px-2 text-[11px] text-slate-700 hover:bg-red-50 hover:text-red-700 disabled:opacity-50"
                >Clear</button>
              )}
            </div>
          </div>
        )}
      </div>

      {errorText && (
        <p className="mt-2 text-[11px] text-red-600">{errorText}</p>
      )}
    </section>
  )
}
