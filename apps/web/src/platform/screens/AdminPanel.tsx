import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { PlatformConfig, Subscription } from '@platform/types'
import { PLATFORM_ACCENT } from '@platform/types'
import { platformApi } from '../api/platformApi'
import { usePlatformStore } from '../store'

type TabKey =
  | 'ai-engine' | 'voice' | 'ectd' | 'payment-gateways'
  | 'document-templates' | 'subscription' | 'external-apis'

const TABS: { key: TabKey; label: string }[] = [
  { key: 'ai-engine',          label: 'AI Engine' },
  { key: 'voice',              label: 'Voice Transcription' },
  { key: 'ectd',               label: 'eCTD Configuration' },
  { key: 'payment-gateways',   label: 'Payment Gateways' },
  { key: 'document-templates', label: 'Document Templates' },
  { key: 'subscription',       label: 'Subscription' },
  { key: 'external-apis',      label: 'External APIs' },
]

const ENGINE_DISPLAY: Record<string, string> = {
  'claude-sonnet-4-6': 'Claude Sonnet 4.6',
  'claude-opus-4':     'Claude Opus 4',
  'claude-haiku-4-5':  'Claude Haiku 4.5',
  'gpt-4o':            'GPT-4o',
  'gemini-pro':        'Gemini Pro',
}

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

function AIEngineTab({ config, onChange }: { config: PlatformConfig; onChange: () => void }) {
  return (
    <div className="flex flex-col gap-5" data-tab-panel="ai-engine">
      <SectionHeader
        eyebrow="AI Engine"
        title="Default engine and per-module overrides"
        subtitle="Configure the default AI engine, per-module overrides, and the fallback route."
      />

      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }} data-engine-grid>
        {config.aiEngine.availableEngines.map(e => {
          const isDefault = e.id === config.aiEngine.default
          const label = ENGINE_DISPLAY[e.id] ?? e.label
          return (
            <div
              key={e.id}
              className="rounded-lg bg-white p-4"
              style={{
                border: `${isDefault ? 2 : 1}px solid ${isDefault ? PLATFORM_ACCENT.primary : '#E2E8F0'}`,
                boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
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
                  ? <StatusChip status="ok"  label="✓ Active" />
                  : <StatusChip status="off" label="○ Available" />}
              </div>
              {isDefault && (
                <p className="mt-2 text-[11px]" style={{ color: PLATFORM_ACCENT.primary }}>Default across all modules</p>
              )}
            </div>
          )
        })}
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4" data-fallback-row>
        <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Fallback engine</p>
        <p className="mt-1 text-[14px] font-semibold text-slate-900">
          {ENGINE_DISPLAY[config.aiEngine.fallback] ?? config.aiEngine.fallback} (fastest)
        </p>
        <p className="mt-1 text-[12px] text-slate-600">Used when the default engine returns an error or exceeds the response-time budget.</p>
      </div>

      <label className="flex items-start gap-3 rounded-lg border border-slate-200 bg-white p-4" data-override-toggle>
        <input
          type="checkbox"
          defaultChecked={config.aiEngine.perModuleOverrideEnabled}
          onChange={onChange}
          className="mt-0.5 h-4 w-4"
          style={{ accentColor: PLATFORM_ACCENT.primary }}
        />
        <div>
          <p className="text-[13px] font-semibold text-slate-900">Allow per-module AI engine override</p>
          <p className="mt-0.5 text-[12px] text-slate-600">Every override is written to the audit trail.</p>
        </div>
      </label>

      <div
        className="rounded-lg p-4"
        style={{ backgroundColor: PLATFORM_ACCENT.bgTint, border: `1px solid ${PLATFORM_ACCENT.borderMedium}` }}
        data-test-connection
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[13px] font-semibold" style={{ color: PLATFORM_ACCENT.primary }} data-connection-status>
              ✓ Connected · {config.aiEngine.default} · latency {config.aiEngine.lastTestedLatencyMs}ms
            </p>
            <p className="mt-1 font-mono text-[11px] text-slate-600">
              Last tested {formatUTC(config.aiEngine.lastTested)}
            </p>
          </div>
          <button
            type="button"
            data-test-connection-button
            className="h-9 rounded-md px-3 text-[13px] font-semibold text-white"
            style={{ backgroundColor: PLATFORM_ACCENT.primary }}
          >Test connection</button>
        </div>
      </div>
    </div>
  )
}

function VoiceTab({ config, onChange }: { config: PlatformConfig; onChange: () => void }) {
  return (
    <div className="flex flex-col gap-5" data-tab-panel="voice">
      <SectionHeader
        eyebrow="Voice Transcription"
        title="Voice notes provider and GDPR posture"
        subtitle="Voice notes are transcribed inline in the document editor (Modules A, B, C, D)."
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
                  ? <StatusChip status="ok"  label="✓ Active" />
                  : <StatusChip status="off" label="○ Available" />}
              </div>
            </div>
          )
        })}
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4" data-gdpr>
        <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">GDPR posture</p>
        <div className="mt-2 grid gap-3" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <div>
            <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Jurisdiction</p>
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
            <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Audio retention</p>
            <p className="mt-2 text-[13px] font-semibold text-slate-900" data-audio-retention>
              {config.voiceTranscription.audioRetentionPolicy === 'delete-immediately'
                ? 'Delete immediately after transcription'
                : config.voiceTranscription.audioRetentionPolicy}
            </p>
          </div>
        </div>
        <p
          className="mt-3 rounded-md p-3 text-[12px]"
          style={{ backgroundColor: PLATFORM_ACCENT.bgTint, color: PLATFORM_ACCENT.primary }}
          data-gdpr-note
        >
          Audio files are deleted from storage immediately after transcription. Transcript text is stored in the selected jurisdiction. Deletion is logged to the audit trail.
        </p>
      </div>
    </div>
  )
}

function EctdTab({ config }: { config: PlatformConfig }) {
  return (
    <div className="flex flex-col gap-5" data-tab-panel="ectd">
      <SectionHeader
        eyebrow="eCTD Configuration"
        title="Regulatory publishing engine and validation tool"
        subtitle="Applies to Module D submissions."
      />

      <div className="grid gap-3" style={{ gridTemplateColumns: '1fr 1fr' }} data-ectd-versions>
        <div
          className="rounded-lg bg-white p-4"
          style={{ border: `2px solid ${PLATFORM_ACCENT.primary}`, boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}
          data-ectd-version={config.ectd.defaultVersion}
        >
          <div className="flex items-center justify-between">
            <p className="text-[14px] font-bold text-slate-900">eCTD {config.ectd.defaultVersion}</p>
            <StatusChip status="ok" label="✓ Default" />
          </div>
          <p className="mt-1 font-mono text-[10px] text-slate-500">ICH M2 profile</p>
        </div>
        <div
          className="rounded-lg bg-white p-4"
          style={{ border: '1px solid #E2E8F0', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}
          data-ectd-version="v4.0"
        >
          <div className="flex items-center justify-between">
            <p className="text-[14px] font-bold text-slate-900">eCTD v4.0</p>
            <StatusChip status="off" label="○ Available" />
          </div>
          <p className="mt-1 font-mono text-[10px] text-slate-500">Next-generation format · FDA + EMA</p>
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4" data-ectd-validator>
        <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Validation tool</p>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
          <p className="text-[14px] font-semibold text-slate-900">{config.ectd.validationTool}</p>
          <StatusChip status="ok" label="✓ Configured" />
        </div>
        <p className="mt-1 font-mono text-[11px] text-slate-500">
          API credentials on file · last validated {formatDay(config.ectd.validationCredentialsLastValidated)}
        </p>
      </div>
    </div>
  )
}

function PaymentGatewaysTab({ config, onChange }: { config: PlatformConfig; onChange: () => void }) {
  return (
    <div className="flex flex-col gap-5" data-tab-panel="payment-gateways">
      <SectionHeader
        eyebrow="Payment Gateways"
        title={`${config.paymentGateways.length} gateways`}
        subtitle="Multiple gateways may be active simultaneously. Clients see every active gateway at checkout."
      />

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white" data-gateways-table>
        <table className="w-full text-[13px]">
          <thead style={{ backgroundColor: '#F8FAFC' }}>
            <tr className="text-left text-[11px] font-semibold uppercase tracking-widest text-slate-500">
              <th className="px-4 py-2">Gateway</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Last tested</th>
              <th className="px-4 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {config.paymentGateways.map(g => (
              <tr key={g.id} className="border-t border-slate-200" data-gateway-row={g.id}>
                <td className="px-4 py-3 font-semibold text-slate-900">{g.label}</td>
                <td className="px-4 py-3">
                  {g.status === 'active'
                    ? <StatusChip status="ok"  label="✓ Active" />
                    : <StatusChip status="off" label="○ Inactive" />}
                </td>
                <td className="px-4 py-3 font-mono text-[11px] text-slate-500">{g.lastTested ?? '—'}</td>
                <td className="px-4 py-3 text-right">
                  <button
                    type="button"
                    onClick={onChange}
                    className="text-[12px] font-semibold hover:underline"
                    style={{ color: PLATFORM_ACCENT.primary }}
                    data-gateway-action={g.status === 'active' ? 'edit' : 'activate'}
                  >{g.status === 'active' ? 'Edit / Deactivate' : 'Activate'}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4" data-webhook-row>
        <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Stripe webhook URL</p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <code className="flex-1 rounded-md bg-slate-100 px-3 py-2 font-mono text-[12px] text-slate-800">
            https://api.clinwrite.ai/webhooks/stripe
          </code>
          <button
            type="button"
            className="h-9 rounded-md border border-slate-300 bg-white px-3 text-[13px] font-semibold text-slate-700 hover:bg-slate-50"
          >Copy</button>
        </div>
      </div>
    </div>
  )
}

function DocumentTemplatesTab() {
  const templates = [
    { id: 'tmpl-genbioca-v2', name: 'GenBioCa Corporate v2.1', module: 'Slide deck',         meta: 'uploaded 02 Sept 2026', status: 'applied' as const, action: 'Replace' },
    { id: 'tmpl-ich-e3',      name: 'ICH E3 CSR shell',        module: 'Clinical Writing',   meta: 'platform default',      status: 'default' as const, action: 'Override' },
    { id: 'tmpl-ectd-cover',  name: 'eCTD cover letter',       module: 'Regulatory Writing', meta: 'system-generated',      status: 'default' as const, action: 'Override' },
  ]
  return (
    <div className="flex flex-col gap-5" data-tab-panel="document-templates">
      <SectionHeader
        eyebrow="Document Templates"
        title="Client and platform templates"
        subtitle="Client templates apply automatically to matching document types. Platform defaults are used when no client override exists."
      />

      <div className="flex flex-col gap-3" data-templates-list>
        {templates.map(t => (
          <div key={t.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-4" data-template-row={t.id}>
            <div>
              <p className="text-[14px] font-semibold text-slate-900">{t.name}</p>
              <p className="mt-0.5 font-mono text-[11px] text-slate-500">{t.module} · {t.meta}</p>
            </div>
            <div className="flex items-center gap-2">
              {t.status === 'applied'
                ? <StatusChip status="ok"  label="✓ Applied" />
                : <StatusChip status="off" label="Platform default" />}
              <button
                type="button"
                className="h-8 rounded-md border border-slate-300 bg-white px-3 text-[12px] font-semibold text-slate-700 hover:bg-slate-50"
              >{t.action}</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function SubscriptionTab({ config, subscription }: { config: PlatformConfig; subscription: Subscription | null }) {
  const currency  = config.currency
  const seats     = config.seats
  const running   = subscription?.currentMonthRunningTotal ?? subscription?.currentPeriod?.tokensConsumed ?? 0
  return (
    <div className="flex flex-col gap-5" data-tab-panel="subscription">
      <SectionHeader
        eyebrow="Subscription"
        title={`${config.plan} plan · ${config.clientName}`}
        subtitle={`Contracted ${formatTokens(config.contractedTokensPerMonth)} tokens per month · Renews ${formatDay(config.renewalDate)}`}
      />

      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }} data-subscription-stats>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Plan</p>
          <p className="mt-1 text-[18px] font-bold" style={{ color: PLATFORM_ACCENT.primary }} data-plan-value>{config.plan}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Seats</p>
          <p className="mt-1 text-[18px] font-bold text-slate-900" data-seats-value>
            {seats ? `${seats.used}/${seats.total}` : '—'}
          </p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Tokens this month</p>
          <p className="mt-1 text-[18px] font-bold text-slate-900" data-tokens-value>
            {formatTokens(running)}
          </p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Renews</p>
          <p className="mt-1 text-[18px] font-bold text-slate-900">{formatDay(config.renewalDate)}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Currency</p>
          <p className="mt-1 text-[18px] font-bold text-slate-900" data-currency-value>{currency}</p>
        </div>
      </div>

      <p
        className="rounded-lg p-3 text-[12px]"
        style={{ backgroundColor: PLATFORM_ACCENT.bgTint, color: PLATFORM_ACCENT.primary }}
        data-immutability-note
      >
        Invoices are immutable once issued. Plan changes take effect at the next renewal date and cannot be backdated.
      </p>
    </div>
  )
}

function ExternalApisTab({ config, onChange }: { config: PlatformConfig; onChange: () => void }) {
  return (
    <div className="flex flex-col gap-5" data-tab-panel="external-apis">
      <SectionHeader
        eyebrow="External APIs"
        title="Regulatory, publishing and messaging integrations"
        subtitle={`22 configured · Showing ${config.externalApis.length} of 22 connectors`}
      />

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white" data-apis-table>
        <table className="w-full text-[13px]">
          <thead style={{ backgroundColor: '#F8FAFC' }}>
            <tr className="text-left text-[11px] font-semibold uppercase tracking-widest text-slate-500">
              <th className="px-4 py-2">Connector</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Last checked</th>
              <th className="px-4 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {config.externalApis.map(a => (
              <tr key={a.id} className="border-t border-slate-200" data-api-row={a.id}>
                <td className="px-4 py-3">
                  <p className="font-semibold text-slate-900">{a.label}</p>
                  {a.note && <p className="mt-0.5 font-mono text-[10px] text-slate-500">{a.note}</p>}
                </td>
                <td className="px-4 py-3">
                  {a.status === 'connected'      && <StatusChip status="ok"   label="✓ Connected" />}
                  {a.status === 'not-configured' && <StatusChip status="warn" label="⚠ Not configured" />}
                  {a.status === 'inactive'       && <StatusChip status="off"  label="○ Inactive" />}
                </td>
                <td className="px-4 py-3 font-mono text-[11px] text-slate-500">
                  {a.lastTested ? formatDay(a.lastTested) : '—'}
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    type="button"
                    onClick={onChange}
                    className="text-[12px] font-semibold hover:underline"
                    style={{ color: PLATFORM_ACCENT.primary }}
                    data-api-action={a.status === 'connected' ? 'edit' : 'configure'}
                  >{a.status === 'connected' ? 'Edit credentials' : 'Configure'}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// -------------- Screen shell --------------

export function AdminPanel() {
  const currentUser = usePlatformStore(s => s.currentUser)
  const setConfig   = usePlatformStore(s => s.setConfig)

  const [activeTab, setActiveTab] = useState<TabKey>('ai-engine')
  const [unsaved,   setUnsaved]   = useState(false)

  const { data: config } = useQuery({
    queryKey: ['platform-config'],
    queryFn:  () => platformApi.getConfig(),
  })
  const { data: subscription = null } = useQuery({
    queryKey: ['platform-subscription'],
    queryFn:  () => platformApi.getSubscription(),
  })

  useEffect(() => { if (config) setConfig(config) }, [config, setConfig])

  const markUnsaved = () => setUnsaved(true)
  const handleSave  = () => setUnsaved(false)

  const activeTabLabel = useMemo(() => TABS.find(t => t.key === activeTab)?.label ?? '', [activeTab])

  return (
    <div className="bg-slate-50" data-screen="admin-panel">
      <div className="mx-auto flex flex-col gap-4" style={{ maxWidth: 1280, padding: '20px 32px 48px' }}>

        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-xs text-slate-500">
          <span>Platform</span>
          <span style={{ color: '#CBD5E1' }}>&gt;</span>
          <span className="font-semibold text-slate-900">Admin Panel</span>
          <span style={{ color: '#CBD5E1' }}>&gt;</span>
          <span>{activeTabLabel}</span>
        </nav>

        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <h1 className="text-[22px] font-bold text-slate-900" style={{ margin: 0 }}>Admin Panel</h1>
            <p className="mt-1 font-mono text-xs" style={{ color: '#64748B' }} data-current-user>
              {currentUser.name} · Admin · {config?.clientName ?? '—'}
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
                Unsaved changes
              </span>
            )}
            <button
              type="button"
              disabled={!unsaved}
              onClick={handleSave}
              data-save-changes
              className="h-9 rounded-md px-4 text-[13px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
              style={{ backgroundColor: PLATFORM_ACCENT.primary }}
            >Save changes</button>
          </div>
        </div>

        {/* Two-column: settings nav + content */}
        <div className="grid gap-4" style={{ gridTemplateColumns: '240px 1fr' }}>

          {/* Left settings nav */}
          <aside
            className="flex flex-col gap-1 rounded-lg border border-slate-200 bg-white p-2"
            data-settings-nav
            data-tab-count={TABS.length}
          >
            {TABS.map(t => {
              const isActive = t.key === activeTab
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setActiveTab(t.key)}
                  data-settings-tab={t.key}
                  data-active={isActive || undefined}
                  className="rounded-md px-3 py-2 text-left text-[13px] font-semibold transition-colors"
                  style={{
                    backgroundColor: isActive ? PLATFORM_ACCENT.primary : 'transparent',
                    color:           isActive ? '#FFFFFF' : '#334155',
                  }}
                >{t.label}</button>
              )
            })}
          </aside>

          {/* Right content panel */}
          <section className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-5" data-settings-content>
            {!config && <p className="text-[13px] text-slate-500">Loading configuration…</p>}
            {config && activeTab === 'ai-engine'          && <AIEngineTab          config={config} onChange={markUnsaved} />}
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
