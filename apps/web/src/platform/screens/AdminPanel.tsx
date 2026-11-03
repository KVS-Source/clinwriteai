import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import type { AiConnectionTestResult, AiEngineSaveBody, PlatformConfig, Subscription } from '@platform/types'
import { PLATFORM_ACCENT } from '@platform/types'
import { platformApi } from '../api/platformApi'
import { describeApiError } from '../../api'
import { usePlatformStore } from '../store'

type TabKey =
  | 'ai-engine' | 'voice' | 'ectd' | 'payment-gateways'
  | 'document-templates' | 'subscription' | 'external-apis'

const TABS: { key: TabKey; labelKey: string }[] = [
  { key: 'ai-engine',          labelKey: 'page.admin_panel.tab_ai_engine' },
  { key: 'voice',              labelKey: 'page.admin_panel.tab_voice' },
  { key: 'ectd',               labelKey: 'page.admin_panel.tab_ectd' },
  { key: 'payment-gateways',   labelKey: 'page.admin_panel.tab_payment_gateways' },
  { key: 'document-templates', labelKey: 'page.admin_panel.tab_document_templates' },
  { key: 'subscription',       labelKey: 'page.admin_panel.tab_subscription' },
  { key: 'external-apis',      labelKey: 'page.admin_panel.tab_external_apis' },
]

// Friendly names for known model ids (matched by prefix, so dated ids like
// "claude-haiku-4-5-20251001" resolve too); anything else shows its own label.
const ENGINE_NAMES: [string, string][] = [
  ['claude-sonnet-4-6', 'Claude Sonnet 4.6'], ['claude-opus-4-7', 'Claude Opus 4.7'], ['claude-opus-4', 'Claude Opus 4'],
  ['claude-haiku-4-5', 'Claude Haiku 4.5'], ['gpt-4o', 'GPT-4o'], ['gemini-pro', 'Gemini Pro'],
]
const engineName = (id: string, fallback: string) => ENGINE_NAMES.find(([p]) => id.startsWith(p))?.[1] ?? fallback

function formatUTC(iso: string): string {
  const d = new Date(iso)
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const dd = String(d.getUTCDate()).padStart(2, '0')
  const hh = String(d.getUTCHours()).padStart(2, '0')
  const mm = String(d.getUTCMinutes()).padStart(2, '0')
  return `${dd} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()} ${hh}:${mm} UTC`
}
function formatDay(iso: string): string {
  const d = new Date(iso)
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${String(d.getUTCDate()).padStart(2, '0')} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}
function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`
  if (n >= 1_000)     return `${Math.round(n / 1_000)}K`
  return String(n)
}

function StatusChip({ status, label }: { status: 'ok' | 'warn' | 'off' | 'info'; label: string }) {
  const palette = {
    ok:   { bg: '#F0FDF4', fg: '#166534', border: '#BBF7D0' },
    warn: { bg: '#FFFBEB', fg: '#B45309', border: '#FDE68A' },
    off:  { bg: '#F1F5F9', fg: '#475569', border: '#CBD5E1' },
    info: { bg: PLATFORM_ACCENT.bgTint, fg: PLATFORM_ACCENT.primary, border: PLATFORM_ACCENT.borderMedium },
  }[status]
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium"
      style={{ backgroundColor: palette.bg, color: palette.fg, border: `1px solid ${palette.border}` }}
      data-status-chip={status}
    >{label}</span>
  )
}

function SectionHeader({ eyebrow, title, subtitle }: { eyebrow: string; title: string; subtitle?: string }) {
  return (
    <div className="border-b border-slate-200 pb-4">
      <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">{eyebrow}</p>
      <h2 className="mt-1 text-[18px] font-bold text-slate-900">{title}</h2>
      {subtitle && <p className="mt-1 text-[13px] text-slate-600">{subtitle}</p>}
    </div>
  )
}

// -------------- Tab bodies --------------

export type AiDraft = AiEngineSaveBody
const draftOf = (config: PlatformConfig): AiDraft => ({
  default:                  config.aiEngine.default,
  fallback:                 config.aiEngine.fallback,
  perModuleOverrideEnabled: config.aiEngine.perModuleOverrideEnabled,
})
const sameDraft = (a: AiDraft, b: AiDraft) =>
  a.default === b.default && a.fallback === b.fallback && a.perModuleOverrideEnabled === b.perModuleOverrideEnabled

function AIEngineTab({ config, draft, onDraft }: { config: PlatformConfig; draft: AiDraft; onDraft: (d: AiDraft) => void }) {
  const { t } = useTranslation()
  const saved = draftOf(config)
  const engines = config.aiEngine.availableEngines

  // Every engine except the default; plus the saved fallback if it isn't one of the cards.
  const fallbackOptions = engines.filter(e => e.id !== draft.default).map(e => ({ id: e.id, label: engineName(e.id, e.label) }))
  if (draft.fallback !== draft.default && !fallbackOptions.some(o => o.id === draft.fallback)) {
    fallbackOptions.push({ id: draft.fallback, label: engineName(draft.fallback, draft.fallback) })
  }

  // Picking a new default: if it is also the fallback, the old default becomes the fallback
  // so the two always differ (the server rejects a fallback equal to the default).
  const selectDefault = (id: string) => {
    if (id === draft.default) return
    onDraft({ ...draft, default: id, fallback: draft.fallback === id ? draft.default : draft.fallback })
  }

  return (
    <div className="flex flex-col gap-5" data-tab-panel="ai-engine">
      <SectionHeader
        eyebrow={t('page.admin_panel.tab_ai_engine')}
        title={t('page.admin_panel.ai_section_title')}
        subtitle={t('page.admin_panel.ai_section_subtitle')}
      />

      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }} data-engine-grid role="radiogroup" aria-label={t('page.admin_panel.aria_default_ai_engine')}>
        {engines.map(e => {
          const isDefault = e.id === draft.default
          const changed = isDefault && draft.default !== saved.default
          const label = engineName(e.id, e.label)
          return (
            <button
              type="button"
              role="radio"
              aria-checked={isDefault}
              key={e.id}
              onClick={() => selectDefault(e.id)}
              className="rounded-lg bg-white p-4 text-left transition-shadow hover:shadow-md focus:outline-none focus-visible:ring-2"
              style={{
                border: `${isDefault ? 2 : 1}px solid ${isDefault ? PLATFORM_ACCENT.primary : '#E2E8F0'}`,
                boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
                cursor: 'pointer',
              }}
              data-engine-card={e.id}
              data-engine-active={isDefault || undefined}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-[14px] font-bold text-slate-900">{label}</p>
                  <p className="mt-0.5 font-mono text-[10px] text-slate-500">{e.provider} · <code>{e.id}</code></p>
                </div>
                {isDefault
                  ? <StatusChip status="ok"  label={`✓ ${t('page.admin_panel.chip_active')}`} />
                  : <StatusChip status="off" label={`○ ${t('page.admin_panel.chip_available')}`} />}
              </div>
              {isDefault && (
                <p className="mt-2 text-[11px]" style={{ color: PLATFORM_ACCENT.primary }}>
                  {t('page.admin_panel.default_across_modules')}{changed ? t('page.admin_panel.not_saved_yet_suffix') : ''}
                </p>
              )}
            </button>
          )
        })}
      </div>

      <label className="block rounded-lg border border-slate-200 bg-white p-4" data-fallback-row>
        <span className="block font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">{t('page.admin_panel.fallback_engine')}</span>
        <select
          value={draft.fallback}
          onChange={e => onDraft({ ...draft, fallback: e.target.value })}
          data-fallback-select
          className="mt-1 h-9 w-full max-w-md rounded-md border border-slate-300 bg-white px-2 text-[14px] font-semibold text-slate-900"
        >
          {fallbackOptions.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
        <span className="mt-1 block text-[12px] text-slate-600">{t('page.admin_panel.fallback_hint')}</span>
      </label>

      <label className="flex items-start gap-3 rounded-lg border border-slate-200 bg-white p-4" data-override-toggle>
        <input
          type="checkbox"
          checked={draft.perModuleOverrideEnabled}
          onChange={e => onDraft({ ...draft, perModuleOverrideEnabled: e.target.checked })}
          className="mt-0.5 h-4 w-4"
          style={{ accentColor: PLATFORM_ACCENT.primary }}
        />
        <div>
          <p className="text-[13px] font-semibold text-slate-900">{t('page.admin_panel.override_toggle_label')}</p>
          <p className="mt-0.5 text-[12px] text-slate-600">{t('page.admin_panel.override_toggle_hint')}</p>
        </div>
      </label>

      <ConnectionTest config={config} />
    </div>
  )
}

// "Test connection" (PRD sPM04 §2.2): fires a test prompt at the AI engine and
// shows the real outcome — connected + latency, failed + why, or "no key". The
// server enforces the 5-second limit and logs each result to the audit trail.
type ConnectionView =
  | { kind: 'connected';      model: string; latency: number | null; at: string | null }
  | { kind: 'failed';         model: string; message: string;        at: string | null }
  | { kind: 'not-configured'; message: string }
  | { kind: 'never-tested' }

function initialView(config: PlatformConfig, t: (k: string) => string): ConnectionView {
  const e = config.aiEngine
  if (e.lastTestedStatus === 'connected')      return { kind: 'connected', model: e.default, latency: e.lastTestedLatencyMs, at: e.lastTested }
  if (e.lastTestedStatus === 'failed')         return { kind: 'failed', model: e.default, message: t('page.admin_panel.last_test_failed'), at: e.lastTested }
  if (e.lastTestedStatus === 'not-configured') return { kind: 'not-configured', message: t('page.admin_panel.no_ai_key_env') }
  return { kind: 'never-tested' }
}

function viewFromResult(r: AiConnectionTestResult, t: (k: string) => string): ConnectionView {
  if (r.status === 'connected')      return { kind: 'connected', model: r.model, latency: r.latency, at: r.testedAt }
  if (r.status === 'not-configured') return { kind: 'not-configured', message: r.message ?? t('page.admin_panel.no_ai_key_short') }
  return { kind: 'failed', model: r.model, message: r.message ?? t('page.admin_panel.connection_failed_generic'), at: r.testedAt }
}

function ConnectionTest({ config }: { config: PlatformConfig }) {
  const { t } = useTranslation()
  const [view, setView] = useState<ConnectionView>(() => initialView(config, t))
  const test = useMutation({
    mutationFn: () => platformApi.testAiConnection(),
    onSuccess:  (result) => setView(viewFromResult(result, t)),
    onError:    (err)    => setView({ kind: 'failed', model: config.aiEngine.default, message: describeApiError(err).message, at: new Date().toISOString() }),
  })

  const tone =
    test.isPending                 ? { fg: '#475569', bg: PLATFORM_ACCENT.bgTint, border: PLATFORM_ACCENT.borderMedium }
    : view.kind === 'connected'    ? { fg: PLATFORM_ACCENT.primary, bg: PLATFORM_ACCENT.bgTint, border: PLATFORM_ACCENT.borderMedium }
    : view.kind === 'failed'       ? { fg: '#B91C1C', bg: '#FEF2F2', border: '#FECACA' }
    : view.kind === 'not-configured' ? { fg: '#B45309', bg: '#FFFBEB', border: '#FDE68A' }
    :                                { fg: '#475569', bg: PLATFORM_ACCENT.bgTint, border: PLATFORM_ACCENT.borderMedium }

  const headline =
    test.isPending                   ? t('page.admin_panel.testing_engine', { engine: config.aiEngine.default })
    : view.kind === 'connected'      ? (view.latency !== null
                                        ? t('page.admin_panel.conn_connected_with_latency', { model: view.model, latency: view.latency })
                                        : t('page.admin_panel.conn_connected', { model: view.model }))
    : view.kind === 'failed'         ? t('page.admin_panel.conn_failed_headline', { model: view.model })
    : view.kind === 'not-configured' ? t('page.admin_panel.conn_not_configured')
    :                                  t('page.admin_panel.conn_not_tested_yet')
  const detail =
    test.isPending                   ? t('page.admin_panel.sending_test_prompt')
    : view.kind === 'connected'      ? (view.at ? t('page.admin_panel.last_tested_at', { time: formatUTC(view.at) }) : '')
    : view.kind === 'failed'         ? `${view.message}${view.at ? ` · ${t('page.admin_panel.tested_at', { time: formatUTC(view.at) })}` : ''}`
    : view.kind === 'not-configured' ? view.message
    :                                  t('page.admin_panel.click_test_hint')

  return (
    <div
      className="rounded-lg p-4"
      style={{ backgroundColor: tone.bg, border: `1px solid ${tone.border}` }}
      data-test-connection
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="status" aria-live="polite">
          <p className="text-[13px] font-semibold" style={{ color: tone.fg }} data-connection-status={test.isPending ? 'testing' : view.kind}>
            {headline}
          </p>
          {detail && <p className="mt-1 font-mono text-[11px] text-slate-600" data-connection-detail>{detail}</p>}
        </div>
        <button
          type="button"
          data-test-connection-button
          onClick={() => test.mutate()}
          disabled={test.isPending}
          className="h-9 rounded-md px-3 text-[13px] font-semibold text-white disabled:cursor-wait disabled:opacity-60"
          style={{ backgroundColor: PLATFORM_ACCENT.primary }}
        >{test.isPending ? t('page.admin_panel.testing') : t('page.admin_panel.test_connection')}</button>
      </div>
    </div>
  )
}

function VoiceTab({ config, onChange }: { config: PlatformConfig; onChange: () => void }) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-5" data-tab-panel="voice">
      <SectionHeader
        eyebrow={t('page.admin_panel.tab_voice')}
        title={t('page.admin_panel.voice_section_title')}
        subtitle={t('page.admin_panel.voice_section_subtitle')}
      />

      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }} data-voice-grid>
        {config.voiceTranscription.availableEngines.map(e => {
          const active = e.id === config.voiceTranscription.engine
          return (
            <div
              key={e.id}
              className="rounded-lg bg-white p-4"
              style={{
                border: `${active ? 2 : 1}px solid ${active ? PLATFORM_ACCENT.primary : '#E2E8F0'}`,
                boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
              }}
              data-voice-engine={e.id}
              data-voice-active={active || undefined}
            >
              <p className="text-[14px] font-semibold text-slate-900">{e.label}</p>
              <div className="mt-2">
                {active
                  ? <StatusChip status="ok"  label={`✓ ${t('page.admin_panel.chip_active')}`} />
                  : <StatusChip status="off" label={`○ ${t('page.admin_panel.chip_available')}`} />}
              </div>
            </div>
          )
        })}
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4" data-gdpr>
        <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">{t('page.admin_panel.gdpr_posture')}</p>
        <div className="mt-2 grid gap-3" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <div>
            <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">{t('page.admin_panel.jurisdiction')}</p>
            <select
              onChange={onChange}
              defaultValue={config.voiceTranscription.gdprJurisdiction}
              data-jurisdiction-select
              data-jurisdiction-value={config.voiceTranscription.gdprJurisdiction}
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
            <p className="mt-2 text-[13px] font-semibold text-slate-900" data-audio-retention>
              {config.voiceTranscription.audioRetentionPolicy === 'delete-immediately'
                ? t('page.admin_panel.audio_delete_immediately')
                : config.voiceTranscription.audioRetentionPolicy}
            </p>
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
    </div>
  )
}

function EctdTab({ config }: { config: PlatformConfig }) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-5" data-tab-panel="ectd">
      <SectionHeader
        eyebrow={t('page.admin_panel.tab_ectd')}
        title={t('page.admin_panel.ectd_section_title')}
        subtitle={t('page.admin_panel.ectd_section_subtitle')}
      />

      <div className="grid gap-3" style={{ gridTemplateColumns: '1fr 1fr' }} data-ectd-versions>
        <div
          className="rounded-lg bg-white p-4"
          style={{ border: `2px solid ${PLATFORM_ACCENT.primary}`, boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}
          data-ectd-version={config.ectd.defaultVersion}
        >
          <div className="flex items-center justify-between">
            <p className="text-[14px] font-bold text-slate-900">eCTD {config.ectd.defaultVersion}</p>
            <StatusChip status="ok" label={`✓ ${t('page.admin_panel.chip_default')}`} />
          </div>
          <p className="mt-1 font-mono text-[10px] text-slate-500">{t('page.admin_panel.ich_m2_profile')}</p>
        </div>
        <div
          className="rounded-lg bg-white p-4"
          style={{ border: '1px solid #E2E8F0', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}
          data-ectd-version="v4.0"
        >
          <div className="flex items-center justify-between">
            <p className="text-[14px] font-bold text-slate-900">eCTD v4.0</p>
            <StatusChip status="off" label={`○ ${t('page.admin_panel.chip_available')}`} />
          </div>
          <p className="mt-1 font-mono text-[10px] text-slate-500">{t('page.admin_panel.next_gen_format')}</p>
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4" data-ectd-validator>
        <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">{t('page.admin_panel.validation_tool')}</p>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
          <p className="text-[14px] font-semibold text-slate-900">{config.ectd.validationTool}</p>
          <StatusChip status="ok" label={`✓ ${t('page.admin_panel.chip_configured')}`} />
        </div>
        <p className="mt-1 font-mono text-[11px] text-slate-500">
          {t('page.admin_panel.api_credentials_on_file', { date: formatDay(config.ectd.validationCredentialsLastValidated) })}
        </p>
      </div>
    </div>
  )
}

function PaymentGatewaysTab({ config, onChange }: { config: PlatformConfig; onChange: () => void }) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-5" data-tab-panel="payment-gateways">
      <SectionHeader
        eyebrow={t('page.admin_panel.tab_payment_gateways')}
        title={t('page.admin_panel.gateways_count', { count: config.paymentGateways.length })}
        subtitle={t('page.admin_panel.gateways_subtitle')}
      />

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white" data-gateways-table>
        <table className="w-full text-[13px]">
          <thead style={{ backgroundColor: '#F8FAFC' }}>
            <tr className="text-left text-[11px] font-semibold uppercase tracking-widest text-slate-500">
              <th className="px-4 py-2">{t('page.admin_panel.col_gateway')}</th>
              <th className="px-4 py-2">{t('page.admin_panel.col_status')}</th>
              <th className="px-4 py-2">{t('page.admin_panel.col_last_tested')}</th>
              <th className="px-4 py-2 text-right">{t('page.admin_panel.col_actions')}</th>
            </tr>
          </thead>
          <tbody>
            {config.paymentGateways.map(g => (
              <tr key={g.id} className="border-t border-slate-200" data-gateway-row={g.id}>
                <td className="px-4 py-3 font-semibold text-slate-900">{g.label}</td>
                <td className="px-4 py-3">
                  {g.status === 'active'
                    ? <StatusChip status="ok"  label={`✓ ${t('page.admin_panel.chip_active')}`} />
                    : <StatusChip status="off" label={`○ ${t('page.admin_panel.chip_inactive')}`} />}
                </td>
                <td className="px-4 py-3 font-mono text-[11px] text-slate-500">{g.lastTested ?? '—'}</td>
                <td className="px-4 py-3 text-right">
                  <button
                    type="button"
                    onClick={onChange}
                    className="text-[12px] font-semibold hover:underline"
                    style={{ color: PLATFORM_ACCENT.primary }}
                    data-gateway-action={g.status === 'active' ? 'edit' : 'activate'}
                  >{g.status === 'active' ? t('page.admin_panel.edit_deactivate') : t('page.admin_panel.activate')}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4" data-webhook-row>
        <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">{t('page.admin_panel.stripe_webhook_url')}</p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <code className="flex-1 rounded-md bg-slate-100 px-3 py-2 font-mono text-[12px] text-slate-800">
            https://api.clinwrite.ai/webhooks/stripe
          </code>
          <button
            type="button"
            className="h-9 rounded-md border border-slate-300 bg-white px-3 text-[13px] font-semibold text-slate-700 hover:bg-slate-50"
          >{t('page.admin_panel.copy_button')}</button>
        </div>
      </div>
    </div>
  )
}

function DocumentTemplatesTab() {
  const { t } = useTranslation()
  const templates = [
    { id: 'tmpl-genbioca-v2', name: 'GenBioCa Corporate v2.1', moduleKey: 'page.admin_panel.tmpl_module_slide_deck',     metaKey: 'page.admin_panel.tmpl_meta_uploaded_date', status: 'applied' as const, actionKey: 'page.admin_panel.tmpl_action_replace' },
    { id: 'tmpl-ich-e3',      name: 'ICH E3 CSR shell',        moduleKey: 'nav.clinical_writing',                        metaKey: 'page.admin_panel.tmpl_meta_platform_default', status: 'default' as const, actionKey: 'page.admin_panel.tmpl_action_override' },
    { id: 'tmpl-ectd-cover',  name: 'eCTD cover letter',       moduleKey: 'nav.regulatory_writing',                      metaKey: 'page.admin_panel.tmpl_meta_system_generated', status: 'default' as const, actionKey: 'page.admin_panel.tmpl_action_override' },
  ]
  return (
    <div className="flex flex-col gap-5" data-tab-panel="document-templates">
      <SectionHeader
        eyebrow={t('page.admin_panel.tab_document_templates')}
        title={t('page.admin_panel.templates_section_title')}
        subtitle={t('page.admin_panel.templates_section_subtitle')}
      />

      <div className="flex flex-col gap-3" data-templates-list>
        {templates.map(tpl => (
          <div key={tpl.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-4" data-template-row={tpl.id}>
            <div>
              <p className="text-[14px] font-semibold text-slate-900">{tpl.name}</p>
              <p className="mt-0.5 font-mono text-[11px] text-slate-500">{t(tpl.moduleKey)} · {t(tpl.metaKey)}</p>
            </div>
            <div className="flex items-center gap-2">
              {tpl.status === 'applied'
                ? <StatusChip status="ok"  label={`✓ ${t('page.admin_panel.chip_applied')}`} />
                : <StatusChip status="off" label={t('page.admin_panel.chip_platform_default')} />}
              <button
                type="button"
                className="h-8 rounded-md border border-slate-300 bg-white px-3 text-[12px] font-semibold text-slate-700 hover:bg-slate-50"
              >{t(tpl.actionKey)}</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function SubscriptionTab({ config, subscription }: { config: PlatformConfig; subscription: Subscription | null }) {
  const { t } = useTranslation()
  const currency  = config.currency
  const seats     = config.seats
  const running   = subscription?.currentMonthRunningTotal ?? subscription?.currentPeriod?.tokensConsumed ?? 0
  return (
    <div className="flex flex-col gap-5" data-tab-panel="subscription">
      <SectionHeader
        eyebrow={t('page.admin_panel.tab_subscription')}
        title={t('page.admin_panel.plan_section_title', { plan: config.plan, client: config.clientName })}
        subtitle={t('page.admin_panel.plan_section_subtitle', { tokens: formatTokens(config.contractedTokensPerMonth), date: formatDay(config.renewalDate) })}
      />

      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }} data-subscription-stats>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">{t('page.admin_panel.kpi_plan')}</p>
          <p className="mt-1 text-[18px] font-bold" style={{ color: PLATFORM_ACCENT.primary }} data-plan-value>{config.plan}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">{t('page.admin_panel.kpi_seats')}</p>
          <p className="mt-1 text-[18px] font-bold text-slate-900" data-seats-value>
            {seats ? `${seats.used}/${seats.total}` : '—'}
          </p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">{t('page.admin_panel.kpi_tokens_this_month')}</p>
          <p className="mt-1 text-[18px] font-bold text-slate-900" data-tokens-value>
            {formatTokens(running)}
          </p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">{t('page.admin_panel.kpi_renews')}</p>
          <p className="mt-1 text-[18px] font-bold text-slate-900">{formatDay(config.renewalDate)}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">{t('page.admin_panel.kpi_currency')}</p>
          <p className="mt-1 text-[18px] font-bold text-slate-900" data-currency-value>{currency}</p>
        </div>
      </div>

      <p
        className="rounded-lg p-3 text-[12px]"
        style={{ backgroundColor: PLATFORM_ACCENT.bgTint, color: PLATFORM_ACCENT.primary }}
        data-immutability-note
      >
        {t('page.admin_panel.invoices_immutable_note')}
      </p>
    </div>
  )
}

// Credentials entered in the Configure modal. Persisted to the API via
// GET/PUT /admin/external-apis/:apiId/credentials. The GET response
// masks every apiKey; this component never shows the raw secret back
// after save (the user re-types if they need to see it).
export interface ApiCredentialsDraft {
  apiKey?:   string
  baseUrl?:  string
  username?: string
  notes?:    string
}

function ExternalApisTab({ config, onChange: _onChange }: { config: PlatformConfig; onChange: () => void }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [editing, setEditing] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  const { data: credRows = [] } = useQuery({
    queryKey: ['external-api-credentials'],
    queryFn:  () => platformApi.listExternalApiCredentials(),
    retry: false,
  })
  const credByApiId = useMemo(
    () => new Map(credRows.map(r => [r.apiId, r])),
    [credRows],
  )

  const saveMut = useMutation({
    mutationFn: ({ apiId, body }: { apiId: string; body: ApiCredentialsDraft }) =>
      // Omit (undefined) keeps the stored value; empty string clears it.
      // Preserves "leave API key blank to keep the existing one" semantics
      // because the modal passes undefined when the input is blank.
      platformApi.saveExternalApiCredentials(apiId, {
        apiKey:   body.apiKey   === undefined ? undefined : (body.apiKey   || null),
        username: body.username === undefined ? undefined : (body.username || null),
        baseUrl:  body.baseUrl  === undefined ? undefined : (body.baseUrl  || null),
        notes:    body.notes    === undefined ? undefined : (body.notes    || null),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['external-api-credentials'] })
      setSaveError(null)
      setEditing(null)
    },
    onError: err => setSaveError(describeApiError(err).message),
  })

  const openConfig = (id: string) => { setSaveError(null); setEditing(id) }
  const closeConfig = () => { setEditing(null); setSaveError(null) }

  const activeConnector = editing ? config.externalApis.find(a => a.id === editing) ?? null : null
  const activeRow       = editing ? credByApiId.get(editing) ?? null : null
  // Prefill the modal with what the server knows about this connector.
  // apiKey is intentionally blank (we only have the mask); username,
  // baseUrl, notes come through verbatim so admins can tweak without
  // retyping.
  const activeDraft: ApiCredentialsDraft = activeRow
    ? { username: activeRow.username ?? undefined, baseUrl: activeRow.baseUrl ?? undefined, notes: activeRow.notes ?? undefined }
    : {}

  const saveDraft = (id: string, next: ApiCredentialsDraft) => {
    saveMut.mutate({ apiId: id, body: next })
  }
  return (
    <div className="flex flex-col gap-5" data-tab-panel="external-apis">
      <SectionHeader
        eyebrow={t('page.admin_panel.tab_external_apis')}
        title={t('page.admin_panel.external_apis_section_title')}
        subtitle={t('page.admin_panel.external_apis_section_subtitle', { count: config.externalApis.length })}
      />

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white" data-apis-table>
        <table className="w-full text-[13px]">
          <thead style={{ backgroundColor: '#F8FAFC' }}>
            <tr className="text-left text-[11px] font-semibold uppercase tracking-widest text-slate-500">
              <th className="px-4 py-2">{t('page.admin_panel.col_connector')}</th>
              <th className="px-4 py-2">{t('page.admin_panel.col_status')}</th>
              <th className="px-4 py-2">{t('page.admin_panel.col_last_checked')}</th>
              <th className="px-4 py-2 text-right">{t('page.admin_panel.col_actions')}</th>
            </tr>
          </thead>
          <tbody>
            {config.externalApis.map(a => {
              // "Has saved key" wins over the backend status for the chip —
              // once the admin stores credentials, the row reads as
              // configured until explicitly cleared.
              const saved = credByApiId.get(a.id)
              const hasSaved = !!saved?.hasApiKey || !!saved?.username
              const chipStatus = hasSaved || a.status === 'connected' ? 'connected' : a.status
              return (
                <tr key={a.id} className="border-t border-slate-200" data-api-row={a.id}>
                  <td className="px-4 py-3">
                    <p className="font-semibold text-slate-900">{a.label}</p>
                    {a.note && <p className="mt-0.5 font-mono text-[10px] text-slate-500">{a.note}</p>}
                  </td>
                  <td className="px-4 py-3">
                    {chipStatus === 'connected'      && <StatusChip status="ok"   label={`✓ ${t('page.admin_panel.chip_connected')}`} />}
                    {chipStatus === 'not-configured' && <StatusChip status="warn" label={`⚠ ${t('page.admin_panel.chip_not_configured')}`} />}
                    {chipStatus === 'inactive'       && <StatusChip status="off"  label={`○ ${t('page.admin_panel.chip_inactive')}`} />}
                  </td>
                  <td className="px-4 py-3 font-mono text-[11px] text-slate-500">
                    {a.lastTested ? formatDay(a.lastTested) : '—'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => openConfig(a.id)}
                      className="text-[12px] font-semibold hover:underline"
                      style={{ color: PLATFORM_ACCENT.primary }}
                      data-api-action={chipStatus === 'connected' ? 'edit' : 'configure'}
                    >{chipStatus === 'connected' ? t('page.admin_panel.edit_credentials') : t('page.admin_panel.configure')}</button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {editing && activeConnector && (
        <ApiCredentialsModal
          connector={activeConnector}
          initial={activeDraft}
          existingApiKeyMasked={activeRow?.apiKeyMasked ?? null}
          saving={saveMut.isPending}
          error={saveError}
          onCancel={closeConfig}
          onSave={next => saveDraft(editing, next)}
        />
      )}
    </div>
  )
}

// Credentials modal — simple form over an API key / base URL / username /
// notes. One shape fits every connector today (expand to per-connector
// field schemas once the backend endpoint lands). Masked api-key input +
// show/hide toggle so the admin can confirm what they typed without
// leaving the secret on screen.
function ApiCredentialsModal({
  connector,
  initial,
  existingApiKeyMasked,
  saving,
  error,
  onCancel,
  onSave,
}: {
  connector: { id: string; label: string; note?: string }
  initial:   ApiCredentialsDraft
  /** '••••abcd' if the server already stores a key; null if not set. */
  existingApiKeyMasked: string | null
  saving:  boolean
  error:   string | null
  onCancel:  () => void
  onSave:    (next: ApiCredentialsDraft) => void
}) {
  const { t } = useTranslation()
  const [apiKey,   setApiKey]   = useState(initial.apiKey   ?? '')
  const [baseUrl,  setBaseUrl]  = useState(initial.baseUrl  ?? '')
  const [username, setUsername] = useState(initial.username ?? '')
  const [notes,    setNotes]    = useState(initial.notes    ?? '')
  const [reveal,   setReveal]   = useState(false)

  // Save is allowed if the admin is editing an existing row (any field
  // change is fine) OR entering a fresh row with at least a key/username.
  const canSave =
    existingApiKeyMasked !== null ||
    apiKey.trim().length > 0 ||
    username.trim().length > 0

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-6"
      onClick={onCancel}
      data-modal="api-credentials"
    >
      <div
        className="mt-16 w-full max-w-md rounded-lg bg-white shadow-xl"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`cfg-${connector.id}-title`}
      >
        <div className="flex items-start justify-between border-b border-slate-200 px-5 py-3">
          <div>
            <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">
              {t('page.admin_panel.configure')}
            </p>
            <h3 id={`cfg-${connector.id}-title`} className="text-[16px] font-bold text-slate-900">
              {connector.label}
            </h3>
            {connector.note && <p className="mt-1 text-[12px] text-slate-500">{connector.note}</p>}
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label={t('button.close')}
          >
            ✕
          </button>
        </div>

        <div className="flex flex-col gap-3 px-5 py-4">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{t('page.admin_panel.api_key_label')}</span>
            <div className="flex gap-2">
              <input
                type={reveal ? 'text' : 'password'}
                value={apiKey}
                onChange={e => setApiKey(e.currentTarget.value)}
                placeholder={existingApiKeyMasked ? t('page.admin_panel.api_key_current_placeholder', { masked: existingApiKeyMasked }) : t('page.admin_panel.api_key_paste_placeholder')}
                className="h-9 flex-1 rounded-md border border-slate-300 px-3 font-mono text-[12px]"
                data-input="apiKey"
              />
              <button
                type="button"
                onClick={() => setReveal(v => !v)}
                className="rounded-md border border-slate-300 bg-white px-3 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
              >
                {reveal ? t('page.admin_panel.hide_key') : t('page.admin_panel.show_key')}
              </button>
            </div>
            {existingApiKeyMasked && !apiKey && (
              <span className="text-[11px] text-slate-500">
                {t('page.admin_panel.key_already_stored_hint')}
              </span>
            )}
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              {t('page.admin_panel.username_label')} <span className="font-normal text-slate-400">{t('page.admin_panel.username_hint')}</span>
            </span>
            <input
              type="text"
              value={username}
              onChange={e => setUsername(e.currentTarget.value)}
              placeholder={t('page.admin_panel.optional_placeholder')}
              className="h-9 rounded-md border border-slate-300 px-3 text-[13px]"
              data-input="username"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              {t('page.admin_panel.base_url_label')} <span className="font-normal text-slate-400">{t('page.admin_panel.base_url_hint')}</span>
            </span>
            <input
              type="url"
              value={baseUrl}
              onChange={e => setBaseUrl(e.currentTarget.value)}
              placeholder="https://api.example.com"
              className="h-9 rounded-md border border-slate-300 px-3 text-[13px]"
              data-input="baseUrl"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{t('page.admin_panel.notes_label')}</span>
            <textarea
              value={notes}
              onChange={e => setNotes(e.currentTarget.value)}
              rows={2}
              placeholder={t('page.admin_panel.notes_placeholder')}
              className="rounded-md border border-slate-300 px-3 py-2 text-[12px]"
              data-input="notes"
            />
          </label>

          <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
            {t('page.admin_panel.credentials_stored_note')}
          </p>
          {error && (
            <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700" role="alert">
              {error}
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-5 py-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="rounded-md border border-slate-300 bg-white px-4 py-2 text-[13px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >{t('button.cancel')}</button>
          <button
            type="button"
            onClick={() => onSave({
              apiKey:   apiKey.trim()   || undefined,
              baseUrl:  baseUrl.trim()  || undefined,
              username: username.trim() || undefined,
              notes:    notes.trim()    || undefined,
            })}
            disabled={!canSave || saving}
            className="rounded-md bg-blue-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >{saving ? t('page.admin_panel.saving') : t('page.admin_panel.save_credentials')}</button>
        </div>
      </div>
    </div>
  )
}

// -------------- Screen shell --------------

export function AdminPanel() {
  const { t } = useTranslation()
  const currentUser = usePlatformStore(s => s.currentUser)
  const setConfig   = usePlatformStore(s => s.setConfig)

  const [activeTab, setActiveTab] = useState<TabKey>('ai-engine')
  const [otherUnsaved, setOtherUnsaved] = useState(false)   // edits on tabs that don't persist yet
  const [aiDraft,   setAiDraft]   = useState<AiDraft | null>(null)
  const [saveNote,  setSaveNote]  = useState<string | null>(null)
  const qc = useQueryClient()

  const { data: config, isError: configFailed, refetch: refetchConfig } = useQuery({
    queryKey: ['platform-config'],
    queryFn:  () => platformApi.getConfig(),
  })
  const { data: subscription = null } = useQuery({
    queryKey: ['platform-subscription'],
    queryFn:  () => platformApi.getSubscription(),
  })

  useEffect(() => { if (config) setConfig(config) }, [config, setConfig])

  const aiDraftEffective = aiDraft ?? (config ? draftOf(config) : null)
  const aiDirty = !!config && !!aiDraft && !sameDraft(aiDraft, draftOf(config))
  const unsaved = otherUnsaved || aiDirty

  const saveAi = useMutation({
    mutationFn: (body: AiDraft) => platformApi.saveAiEngine(body),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['platform-config'] })
      setAiDraft(null)
      setSaveNote(t('page.admin_panel.ai_settings_saved_note'))
    },
  })

  const markUnsaved = () => { setSaveNote(null); setOtherUnsaved(true) }
  const handleSave  = () => {
    setSaveNote(null)
    if (aiDirty && aiDraft) saveAi.mutate(aiDraft)
    setOtherUnsaved(false)
  }

  const activeTabLabelKey = useMemo(() => TABS.find(tab => tab.key === activeTab)?.labelKey ?? '', [activeTab])
  const activeTabLabel = activeTabLabelKey ? t(activeTabLabelKey) : ''

  return (
    <div className="bg-slate-50" data-screen="admin-panel">
      <div className="flex flex-col gap-4" style={{ maxWidth: 1280, padding: '20px 32px 48px' }}>

        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-xs text-slate-500">
          <span>{t('page.admin_panel.crumb_platform')}</span>
          <span style={{ color: '#CBD5E1' }}>&gt;</span>
          <span className="font-semibold text-slate-900">{t('page.admin_panel.title')}</span>
          <span style={{ color: '#CBD5E1' }}>&gt;</span>
          <span>{activeTabLabel}</span>
        </nav>

        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <h1 className="text-[22px] font-bold text-slate-900" style={{ margin: 0 }}>{t('page.admin_panel.title')}</h1>
            <p className="mt-1 font-mono text-xs" style={{ color: '#64748B' }} data-current-user>
              {t('page.admin_panel.user_admin_client', { name: currentUser.name, client: config?.clientName ?? '—' })}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {unsaved && (
              <span
                className="inline-flex items-center gap-1.5 text-[12px] font-semibold"
                style={{ color: '#B45309' }}
                data-unsaved-indicator
              >
                <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: '#D97706' }} />
                {t('page.admin_panel.unsaved_changes')}
              </span>
            )}
            <button
              type="button"
              disabled={!unsaved || saveAi.isPending}
              onClick={handleSave}
              data-save-changes
              className="h-9 rounded-md px-4 text-[13px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
              style={{ backgroundColor: PLATFORM_ACCENT.primary }}
            >{saveAi.isPending ? t('page.admin_panel.saving') : t('page.admin_panel.save_changes')}</button>
          </div>
        </div>

        {saveNote && <p className="rounded-md bg-green-50 p-2.5 text-[13px] font-semibold text-green-800" role="status" data-save-note>{saveNote}</p>}
        {saveAi.isError && (
          <p className="rounded-md bg-red-50 p-2.5 text-[13px] font-semibold text-red-800" role="alert" data-save-error>
            {t('page.admin_panel.err_save_ai_settings', { message: describeApiError(saveAi.error).message })}
          </p>
        )}

        {/* Two-column: settings nav + content */}
        <div className="grid gap-4" style={{ gridTemplateColumns: '240px 1fr' }}>

          {/* Left settings nav */}
          <aside
            className="flex flex-col gap-1 rounded-lg border border-slate-200 bg-white p-2"
            data-settings-nav
            data-tab-count={TABS.length}
          >
            {TABS.map(tab => {
              const isActive = tab.key === activeTab
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveTab(tab.key)}
                  data-settings-tab={tab.key}
                  data-active={isActive || undefined}
                  className="rounded-md px-3 py-2 text-left text-[13px] font-semibold transition-colors"
                  style={{
                    backgroundColor: isActive ? PLATFORM_ACCENT.primary : 'transparent',
                    color:           isActive ? '#FFFFFF' : '#334155',
                  }}
                >{t(tab.labelKey)}</button>
              )
            })}
          </aside>

          {/* Right content panel */}
          <section className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-5" data-settings-content>
            {!config && !configFailed && <p className="text-[13px] text-slate-500">{t('page.admin_panel.loading_configuration')}</p>}
            {!config && configFailed && (
              <div className="rounded-md bg-red-50 p-3 text-[13px] text-red-800" data-config-error>
                {t('page.admin_panel.err_load_config')}{' '}
                <button type="button" onClick={() => { void refetchConfig() }} className="font-semibold underline">{t('page.admin_panel.try_again')}</button>
              </div>
            )}
            {config && aiDraftEffective && activeTab === 'ai-engine' && <AIEngineTab config={config} draft={aiDraftEffective} onDraft={d => { setSaveNote(null); setAiDraft(d) }} />}
            {config && activeTab === 'voice'              && <VoiceTab             config={config} onChange={markUnsaved} />}
            {config && activeTab === 'ectd'               && <EctdTab              config={config} />}
            {config && activeTab === 'payment-gateways'   && <PaymentGatewaysTab   config={config} onChange={markUnsaved} />}
            {config && activeTab === 'document-templates' && <DocumentTemplatesTab />}
            {config && activeTab === 'subscription'       && <SubscriptionTab      config={config} subscription={subscription} />}
            {config && activeTab === 'external-apis'      && <ExternalApisTab      config={config} onChange={markUnsaved} />}
          </section>
        </div>
      </div>
    </div>
  )
}
