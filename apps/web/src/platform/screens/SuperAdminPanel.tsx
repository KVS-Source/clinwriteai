import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type {
  PlatformClient, PlatformAnalytics, PlatformConfig, AuditTrailEntry,
} from '@platform/types'
import { PLATFORM_ACCENT } from '@platform/types'
import { platformApi } from '../api/platformApi'
import { usePlatformStore } from '../store'

type TabKey = 'clients' | 'analytics' | 'ai-engines' | 'feature-flags'

const TABS: { key: TabKey; label: string }[] = [
  { key: 'clients',       label: 'Clients' },
  { key: 'analytics',     label: 'Platform Analytics' },
  { key: 'ai-engines',    label: 'AI Engines' },
  { key: 'feature-flags', label: 'Feature Flags' },
]

const ENGINE_DISPLAY: Record<string, string> = {
  'claude-sonnet-4-6': 'Claude Sonnet 4.6',
  'claude-opus-4':     'Claude Opus 4',
  'claude-haiku-4-5':  'Claude Haiku 4.5',
  'gpt-4o':            'GPT-4o',
  'gemini-pro':        'Gemini Pro',
}

function formatDay(iso: string): string {
  const d = new Date(iso)
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${String(d.getUTCDate()).padStart(2, '0')} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}
function formatDateTime(iso: string): string {
  const d = new Date(iso)
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const dd = String(d.getUTCDate()).padStart(2, '0')
  const hh = String(d.getUTCHours()).padStart(2, '0')
  const mm = String(d.getUTCMinutes()).padStart(2, '0')
  return `${dd} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()} ${hh}:${mm} UTC`
}
function formatGBP(amount: number): string {
  return `£${amount.toLocaleString('en-GB')}`
}
function formatCompactNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `${(n / 1_000).toFixed(n >= 100_000 ? 0 : 1)}K`
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

function ClientsTab({ clients, analytics }: { clients: PlatformClient[]; analytics: PlatformAnalytics | null }) {
  const counts = analytics?.clientCounts ?? { active: 0, suspended: 0, churned: 0 }
  return (
    <div className="flex flex-col gap-5" data-tab-panel="clients">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <SectionHeader
          eyebrow="Client Management"
          title={`${counts.active} active clients · ${counts.suspended} suspended · ${counts.churned} churned`}
          subtitle="GenBioCa-internal view. Super Admin governs every client organisation; Admin governs a single client account."
        />
        <button
          type="button"
          data-new-client
          className="h-9 rounded-md px-3 text-[13px] font-semibold text-white"
          style={{ backgroundColor: PLATFORM_ACCENT.primary }}
        >+ New client →</button>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white" data-clients-table>
        <table className="w-full text-[13px]">
          <thead style={{ backgroundColor: '#F8FAFC' }}>
            <tr className="text-left text-[11px] font-semibold uppercase tracking-widest text-slate-500">
              <th className="px-4 py-2">Client</th>
              <th className="px-4 py-2">Plan</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Admin contact</th>
              <th className="px-4 py-2">Created</th>
              <th className="px-4 py-2 text-right">Revenue to date</th>
              <th className="px-4 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {clients.map(c => (
              <tr key={c.id} className="border-t border-slate-200" data-client-row={c.id} data-client-status={c.status}>
                <td className="px-4 py-3">
                  <p className="font-semibold text-slate-900">{c.name}</p>
                  {c.note && <p className="mt-0.5 font-mono text-[10px] text-slate-500">{c.note}</p>}
                </td>
                <td className="px-4 py-3 text-slate-700">{c.plan}</td>
                <td className="px-4 py-3">
                  {c.status === 'active'    && <StatusChip status="ok"   label="✓ Active"    />}
                  {c.status === 'suspended' && <StatusChip status="warn" label="⚠ Suspended" />}
                  {c.status === 'churned'   && <StatusChip status="off"  label="○ Churned"   />}
                </td>
                <td className="px-4 py-3 text-slate-700">{c.adminContactName ?? '—'}</td>
                <td className="px-4 py-3 font-mono text-[11px] text-slate-500">{formatDay(c.createdAt)}</td>
                <td className="px-4 py-3 text-right font-mono text-slate-800">{formatGBP(c.revenueToDateGBP)}</td>
                <td className="px-4 py-3 text-right">
                  {c.status === 'active'    && <button type="button" className="text-[12px] font-semibold hover:underline" style={{ color: PLATFORM_ACCENT.primary }} data-client-action="view-suspend">{c.note === '(internal)' ? 'View' : 'View / Suspend'}</button>}
                  {c.status === 'suspended' && <button type="button" className="text-[12px] font-semibold hover:underline" style={{ color: PLATFORM_ACCENT.primary }} data-client-action="reactivate">Reactivate</button>}
                  {c.status === 'churned'   && <button type="button" className="text-[12px] font-semibold text-slate-500" data-client-action="view-readonly">View (read-only)</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p
        className="rounded-lg p-3 text-[12px]"
        style={{ backgroundColor: PLATFORM_ACCENT.bgTint, color: PLATFORM_ACCENT.primary }}
        data-suspension-note
      >
        Suspension and reactivation are recorded against the client with the acting Super Admin named. A churned client account becomes read-only and cannot be deleted.
      </p>
    </div>
  )
}

function AnalyticsTab({ analytics }: { analytics: PlatformAnalytics }) {
  return (
    <div className="flex flex-col gap-5" data-tab-panel="analytics">
      <SectionHeader eyebrow="Platform Analytics" title="Cross-client platform health" subtitle="Rolling 30-day counts. Revenue is platform-level (GBP)." />

      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }} data-stats-grid>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Total active users</p>
          <p className="mt-1 text-[24px] font-bold" style={{ color: PLATFORM_ACCENT.primary }} data-stat="totalActiveUsers">{analytics.totalActiveUsers}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Active projects</p>
          <p className="mt-1 text-[24px] font-bold" style={{ color: PLATFORM_ACCENT.primary }} data-stat="activeProjects">{analytics.activeProjects}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Documents created</p>
          <p className="mt-1 text-[24px] font-bold" style={{ color: PLATFORM_ACCENT.primary }} data-stat="documentsCreated">{analytics.documentsCreatedRolling30.toLocaleString('en-GB')}</p>
          <p className="mt-1 font-mono text-[10px] text-slate-500">rolling 30 days</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">AI tokens</p>
          <p className="mt-1 text-[24px] font-bold" style={{ color: PLATFORM_ACCENT.primary }} data-stat="aiTokens">{formatCompactNumber(analytics.aiTokensRolling30)}</p>
          <p className="mt-1 font-mono text-[10px] text-slate-500">rolling 30 days</p>
        </div>
      </div>

      <div className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }} data-revenue-strip>
        <div>
          <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">MRR</p>
          <p className="mt-1 text-[18px] font-bold text-slate-900" data-revenue="mrr">{formatGBP(analytics.mrrGBP)}</p>
        </div>
        <div>
          <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">ARR</p>
          <p className="mt-1 text-[18px] font-bold text-slate-900" data-revenue="arr">{formatGBP(analytics.arrGBP)}</p>
        </div>
        <div>
          <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Churn this quarter</p>
          <p className="mt-1 text-[18px] font-bold text-slate-900" data-revenue="churn">{analytics.churnThisQuarter} client{analytics.churnThisQuarter === 1 ? '' : 's'}</p>
        </div>
        <div>
          <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Avg tokens / client / month</p>
          <p className="mt-1 text-[18px] font-bold text-slate-900" data-revenue="avg-tokens">{formatCompactNumber(analytics.avgTokensPerClientMonth)}</p>
        </div>
      </div>
    </div>
  )
}

function AIEnginesTab({ config }: { config: PlatformConfig }) {
  return (
    <div className="flex flex-col gap-5" data-tab-panel="ai-engines">
      <SectionHeader eyebrow="AI Engines" title="Cross-client engine registry" subtitle="Removing an engine here removes it from every client's Admin panel. Sessions already run keep their recorded engine." />

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white" data-engines-table>
        <table className="w-full text-[13px]">
          <thead style={{ backgroundColor: '#F8FAFC' }}>
            <tr className="text-left text-[11px] font-semibold uppercase tracking-widest text-slate-500">
              <th className="px-4 py-2">Engine</th>
              <th className="px-4 py-2">Provider</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {config.aiEngine.availableEngines.map(e => {
              const isDefault = e.id === config.aiEngine.default
              return (
                <tr key={e.id} className="border-t border-slate-200" data-engine-row={e.id}>
                  <td className="px-4 py-3">
                    <p className="font-semibold text-slate-900">{ENGINE_DISPLAY[e.id] ?? e.label}</p>
                    <p className="mt-0.5 font-mono text-[10px] text-slate-500"><code>{e.id}</code></p>
                  </td>
                  <td className="px-4 py-3 text-slate-700">{e.provider}</td>
                  <td className="px-4 py-3">
                    {isDefault
                      ? <StatusChip status="ok"   label="✓ Active" />
                      : <StatusChip status="off"  label="○ Available" />}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      data-engine-action="remove"
                      className="text-[12px] font-semibold text-slate-500 hover:text-red-700"
                    >Remove</button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function FeatureFlagsTab({ config, onToggle }: { config: PlatformConfig; onToggle: (id: string, next: boolean) => void }) {
  return (
    <div className="flex flex-col gap-5" data-tab-panel="feature-flags">
      <SectionHeader eyebrow="Feature Flags" title={`${config.featureFlags.length} flags`} subtitle="Flags apply platform-wide and take effect on the next page load for every client." />

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white" data-flags-table>
        <table className="w-full text-[13px]">
          <thead style={{ backgroundColor: '#F8FAFC' }}>
            <tr className="text-left text-[11px] font-semibold uppercase tracking-widest text-slate-500">
              <th className="px-4 py-2">Feature</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2 text-right">Toggle</th>
            </tr>
          </thead>
          <tbody>
            {config.featureFlags.map(f => {
              const isEnabled = f.status === 'enabled'
              const isBeta    = f.status === 'beta'
              return (
                <tr key={f.id} className="border-t border-slate-200" data-flag-row={f.id} data-flag-status={f.status}>
                  <td className="px-4 py-3 font-semibold text-slate-900">{f.label}</td>
                  <td className="px-4 py-3">
                    {isEnabled && <StatusChip status="ok"   label="✓ Enabled" />}
                    {isBeta    && <StatusChip status="warn" label="○ Beta" />}
                    {f.status === 'disabled' && <StatusChip status="off"  label="○ Disabled" />}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <label className="inline-flex cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        defaultChecked={isEnabled || isBeta}
                        onChange={(e) => onToggle(f.id, e.currentTarget.checked)}
                        data-flag-toggle={f.id}
                        className="h-4 w-4"
                        style={{ accentColor: PLATFORM_ACCENT.primary }}
                      />
                    </label>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function PlatformAuditLog({ entries }: { entries: AuditTrailEntry[] }) {
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-5" data-platform-audit-log>
      <SectionHeader
        eyebrow="Platform Audit Log"
        title={`${entries.length} recent Super Admin events`}
        subtitle="Cross-client actions performed by GenBioCa Super Admin."
      />

      <div className="flex flex-col gap-2" data-audit-entries>
        {entries.map(e => (
          <div key={e.id} className="flex flex-wrap items-start justify-between gap-2 rounded-md border border-slate-200 p-3 text-[12px]" data-audit-entry={e.id}>
            <div className="min-w-0 flex-1">
              <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">{e.action} · {e.entityType}</p>
              <p className="mt-1 text-[13px] font-semibold text-slate-900">{e.entityLabel}</p>
              <p className="mt-1 text-slate-700">{e.details}</p>
            </div>
            <div className="text-right font-mono text-[10px] text-slate-500">
              <p>{e.userName}</p>
              <p>{formatDateTime(e.timestamp)}</p>
            </div>
          </div>
        ))}
      </div>

      <p
        className="rounded-md p-3 text-[11px] font-mono"
        style={{ backgroundColor: PLATFORM_ACCENT.bgTint, color: PLATFORM_ACCENT.primary }}
        data-immutability-note
      >
        Audit records are immutable and cannot be edited, backdated or removed.
      </p>
    </section>
  )
}

// -------------- Screen shell --------------

export function SuperAdminPanel() {
  const currentUser = usePlatformStore(s => s.currentUser)
  const [activeTab, setActiveTab] = useState<TabKey>('clients')

  const { data: config }    = useQuery({ queryKey: ['platform-config'],       queryFn: () => platformApi.getConfig() })
  const { data: clients = [] } = useQuery({ queryKey: ['sa-clients'],         queryFn: () => platformApi.listPlatformClients() })
  const { data: analytics = null } = useQuery({ queryKey: ['sa-analytics'],   queryFn: () => platformApi.getPlatformAnalytics() })
  const { data: audit = [] }   = useQuery({ queryKey: ['audit'],              queryFn: () => platformApi.listAudit() })

  const platformAudit = useMemo(
    () => (audit as AuditTrailEntry[]).filter(a => a.module === 'platform' && a.userId === 'user-sa'),
    [audit],
  )

  const onFlagToggle = () => { /* PATCH would go here in production */ }
  const activeTabLabel = TABS.find(t => t.key === activeTab)?.label ?? ''

  return (
    <div className="bg-slate-50" data-screen="super-admin-panel">
      <div className="flex flex-col gap-4" style={{ maxWidth: 1280, padding: '20px 32px 48px' }}>

        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-xs text-slate-500">
          <span>Super Admin</span>
          <span style={{ color: '#CBD5E1' }}>&gt;</span>
          <span className="font-semibold text-slate-900">Super Admin Panel</span>
          <span style={{ color: '#CBD5E1' }}>&gt;</span>
          <span>{activeTabLabel}</span>
        </nav>

        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <h1 className="text-[22px] font-bold text-slate-900" style={{ margin: 0 }}>Super Admin Panel</h1>
            <p className="mt-1 font-mono text-xs" style={{ color: '#64748B' }} data-current-user>
              {currentUser.name} · Super Admin · GenBioCa (internal)
            </p>
          </div>
        </div>

        {/* Two-column: tab nav + content */}
        <div className="grid gap-4" style={{ gridTemplateColumns: '240px 1fr' }}>

          <aside className="flex flex-col gap-1 rounded-lg border border-slate-200 bg-white p-2" data-settings-nav data-tab-count={TABS.length}>
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

          <section className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-5" data-settings-content>
            {activeTab === 'clients'       && <ClientsTab       clients={clients as PlatformClient[]} analytics={analytics as PlatformAnalytics | null} />}
            {activeTab === 'analytics'     && analytics && <AnalyticsTab analytics={analytics as PlatformAnalytics} />}
            {activeTab === 'ai-engines'    && config    && <AIEnginesTab    config={config as PlatformConfig} />}
            {activeTab === 'feature-flags' && config    && <FeatureFlagsTab config={config as PlatformConfig} onToggle={onFlagToggle} />}
          </section>
        </div>

        {/* Platform Audit Log — always visible as final section */}
        <PlatformAuditLog entries={platformAudit} />
      </div>
    </div>
  )
}
