import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import type {
  PlatformAnalytics, PlatformConfig, AuditTrailEntry,
} from '@platform/types'
import { PLATFORM_ACCENT } from '@platform/types'
import { describeApiError } from '../../api'
import { useTenants } from '../../hooks'
import { platformApi } from '../api/platformApi'
import { usePlatformStore } from '../store'
import { NewTenantDialog } from './tenant-admin/TenantDirectory'

type TabKey = 'clients' | 'analytics' | 'ai-engines' | 'feature-flags'

const TAB_LABEL_KEYS: Record<TabKey, string> = {
  'clients':       'page.super_admin_panel.tab_clients',
  'analytics':     'page.super_admin_panel.tab_analytics',
  'ai-engines':    'page.super_admin_panel.tab_ai_engines',
  'feature-flags': 'page.super_admin_panel.tab_feature_flags',
}

const TABS: TabKey[] = ['clients', 'analytics', 'ai-engines', 'feature-flags']

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

// A client is a tenant (GET/POST /admin/tenants). Plan comes from the tenant's active
// subscription; admin contact and revenue aren't recorded yet, so those columns show "—".
function ClientsTab() {
  const { t } = useTranslation()
  const { data: tenants = [], isLoading, error } = useTenants()
  const [newOpen, setNewOpen] = useState(false)
  const counts = {
    active:    tenants.filter(ten => ten.status === 'active').length,
    suspended: tenants.filter(ten => ten.status === 'suspended').length,
    archived:  tenants.filter(ten => ten.status === 'archived').length,
  }
  return (
    <div className="flex flex-col gap-5" data-tab-panel="clients">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <SectionHeader
          eyebrow={t('page.super_admin_panel.clients_eyebrow')}
          title={t('page.super_admin_panel.clients_title', counts)}
          subtitle={t('page.super_admin_panel.clients_subtitle')}
        />
        <button
          type="button"
          data-new-client
          onClick={() => setNewOpen(true)}
          className="h-9 rounded-md px-3 text-[13px] font-semibold text-white"
          style={{ backgroundColor: PLATFORM_ACCENT.primary }}
        >{t('page.super_admin_panel.new_client')}</button>
      </div>
      {newOpen && <NewTenantDialog noun="client" onClose={() => setNewOpen(false)} />}

      {/* Scrolls sideways instead of running off the page on narrower screens (CW-074). */}
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white" data-clients-table>
        <table className="w-full min-w-[760px] text-[13px]">
          <thead style={{ backgroundColor: '#F8FAFC' }}>
            <tr className="text-left text-[11px] font-semibold uppercase tracking-widest text-slate-500">
              <th className="px-4 py-2">{t('page.super_admin_panel.col_client')}</th>
              <th className="px-4 py-2">{t('page.super_admin_panel.col_plan')}</th>
              <th className="px-4 py-2">{t('page.super_admin_panel.col_status')}</th>
              <th className="px-4 py-2">{t('page.super_admin_panel.col_admin_contact')}</th>
              <th className="px-4 py-2">{t('page.super_admin_panel.col_created')}</th>
              <th className="px-4 py-2 text-right">{t('page.super_admin_panel.col_revenue')}</th>
              <th className="px-4 py-2 text-right">{t('page.super_admin_panel.col_actions')}</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={7} className="px-4 py-6 text-center text-[13px] text-slate-500">{t('page.super_admin_panel.loading_clients')}</td></tr>
            )}
            {error && (
              <tr><td colSpan={7} className="px-4 py-6 text-center text-[13px] text-red-700" role="alert">{t('page.super_admin_panel.load_clients_error', { message: describeApiError(error).message })}</td></tr>
            )}
            {!isLoading && !error && tenants.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-6 text-center text-[13px] text-slate-500">{t('page.super_admin_panel.empty_prefix')} <strong>{t('page.super_admin_panel.new_client')}</strong> {t('page.super_admin_panel.empty_suffix')}</td></tr>
            )}
            {tenants.map(c => (
              <tr key={c.id} className="border-t border-slate-200" data-client-row={c.id} data-client-status={c.status}>
                <td className="px-4 py-3">
                  <p className="font-semibold text-slate-900">{c.name}</p>
                  <p className="mt-0.5 font-mono text-[10px] text-slate-500">{c.slug}</p>
                </td>
                <td className="px-4 py-3 capitalize text-slate-700" data-client-plan>
                  {c.plan ?? <span className="text-slate-400">—</span>}
                </td>
                <td className="px-4 py-3">
                  {c.status === 'active'    && <StatusChip status="ok"   label={t('page.super_admin_panel.chip_active')}    />}
                  {c.status === 'suspended' && <StatusChip status="warn" label={t('page.super_admin_panel.chip_suspended')} />}
                  {c.status === 'archived'  && <StatusChip status="off"  label={t('page.super_admin_panel.chip_archived')}  />}
                </td>
                <td className="px-4 py-3 text-slate-400">—</td>
                <td className="px-4 py-3 font-mono text-[11px] text-slate-500">{formatDay(c.createdAt)}</td>
                <td className="px-4 py-3 text-right font-mono text-slate-400">—</td>
                <td className="px-4 py-3 text-right">
                  <Link
                    to={`/super-admin/tenants/${c.id}`}
                    className="text-[12px] font-semibold hover:underline"
                    style={{ color: c.status === 'archived' ? '#64748B' : PLATFORM_ACCENT.primary }}
                    data-client-action={c.status === 'active' ? 'view-suspend' : c.status === 'suspended' ? 'reactivate' : 'view-readonly'}
                  >{c.status === 'active' ? t('page.super_admin_panel.action_view_suspend') : c.status === 'suspended' ? t('page.super_admin_panel.action_view_reactivate') : t('page.super_admin_panel.action_view_readonly')}</Link>
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
        {t('page.super_admin_panel.suspension_note')}
      </p>
    </div>
  )
}

function AnalyticsTab({ analytics }: { analytics: PlatformAnalytics }) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-5" data-tab-panel="analytics">
      <SectionHeader eyebrow={t('page.super_admin_panel.analytics_eyebrow')} title={t('page.super_admin_panel.analytics_title')} subtitle={t('page.super_admin_panel.analytics_subtitle')} />

      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }} data-stats-grid>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">{t('page.super_admin_panel.stat_total_active_users')}</p>
          <p className="mt-1 text-[24px] font-bold" style={{ color: PLATFORM_ACCENT.primary }} data-stat="totalActiveUsers">{analytics.totalActiveUsers}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">{t('page.super_admin_panel.stat_active_projects')}</p>
          <p className="mt-1 text-[24px] font-bold" style={{ color: PLATFORM_ACCENT.primary }} data-stat="activeProjects">{analytics.activeProjects}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">{t('page.super_admin_panel.stat_documents_created')}</p>
          <p className="mt-1 text-[24px] font-bold" style={{ color: PLATFORM_ACCENT.primary }} data-stat="documentsCreated">{analytics.documentsCreatedRolling30.toLocaleString('en-GB')}</p>
          <p className="mt-1 font-mono text-[10px] text-slate-500">{t('page.super_admin_panel.rolling_30')}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">{t('page.super_admin_panel.stat_ai_tokens')}</p>
          <p className="mt-1 text-[24px] font-bold" style={{ color: PLATFORM_ACCENT.primary }} data-stat="aiTokens">{formatCompactNumber(analytics.aiTokensRolling30)}</p>
          <p className="mt-1 font-mono text-[10px] text-slate-500">{t('page.super_admin_panel.rolling_30')}</p>
          {!!analytics.aiTokensUnattributedRolling30 && (
            <p className="mt-0.5 font-mono text-[10px] text-slate-500" data-unattributed-tokens>
              {t('page.super_admin_panel.tokens_unattributed', { tokens: formatCompactNumber(analytics.aiTokensUnattributedRolling30) })}
            </p>
          )}
        </div>
      </div>

      <div className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }} data-revenue-strip>
        <div>
          <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">{t('page.super_admin_panel.stat_mrr')}</p>
          <p className="mt-1 text-[18px] font-bold text-slate-900" data-revenue="mrr">{analytics.mrrGBP == null ? '—' : formatGBP(analytics.mrrGBP)}</p>
          {analytics.mrrGBP == null && <p className="mt-0.5 font-mono text-[10px] text-slate-500" data-revenue-note>{t('page.super_admin_panel.billing_not_connected', { count: analytics.activeSubscriptions ?? 0 })}</p>}
        </div>
        <div>
          <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">{t('page.super_admin_panel.stat_arr')}</p>
          <p className="mt-1 text-[18px] font-bold text-slate-900" data-revenue="arr">{analytics.arrGBP == null ? '—' : formatGBP(analytics.arrGBP)}</p>
        </div>
        <div>
          <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">{t('page.super_admin_panel.stat_churn')}</p>
          <p className="mt-1 text-[18px] font-bold text-slate-900" data-revenue="churn">{t('page.super_admin_panel.churn_clients', { count: analytics.churnThisQuarter })}</p>
        </div>
        <div>
          <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">{t('page.super_admin_panel.stat_avg_tokens')}</p>
          <p className="mt-1 text-[18px] font-bold text-slate-900" data-revenue="avg-tokens">{formatCompactNumber(analytics.avgTokensPerClientMonth)}</p>
        </div>
      </div>
    </div>
  )
}

function AIEnginesTab({ config }: { config: PlatformConfig }) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-5" data-tab-panel="ai-engines">
      <SectionHeader eyebrow={t('page.super_admin_panel.engines_eyebrow')} title={t('page.super_admin_panel.engines_title')} subtitle={t('page.super_admin_panel.engines_subtitle')} />

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white" data-engines-table>
        <table className="w-full text-[13px]">
          <thead style={{ backgroundColor: '#F8FAFC' }}>
            <tr className="text-left text-[11px] font-semibold uppercase tracking-widest text-slate-500">
              <th className="px-4 py-2">{t('page.super_admin_panel.col_engine')}</th>
              <th className="px-4 py-2">{t('page.super_admin_panel.col_provider')}</th>
              <th className="px-4 py-2">{t('page.super_admin_panel.col_status')}</th>
              <th className="px-4 py-2 text-right">{t('page.super_admin_panel.col_actions')}</th>
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
                      ? <StatusChip status="ok"   label={t('page.super_admin_panel.engine_active')} />
                      : <StatusChip status="off"  label={t('page.super_admin_panel.engine_available')} />}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      data-engine-action="remove"
                      className="text-[12px] font-semibold text-slate-500 hover:text-red-700"
                    >{t('page.super_admin_panel.remove')}</button>
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
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-5" data-tab-panel="feature-flags">
      <SectionHeader eyebrow={t('page.super_admin_panel.flags_eyebrow')} title={t('page.super_admin_panel.flags_title', { count: config.featureFlags.length })} subtitle={t('page.super_admin_panel.flags_subtitle')} />

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white" data-flags-table>
        <table className="w-full text-[13px]">
          <thead style={{ backgroundColor: '#F8FAFC' }}>
            <tr className="text-left text-[11px] font-semibold uppercase tracking-widest text-slate-500">
              <th className="px-4 py-2">{t('page.super_admin_panel.col_feature')}</th>
              <th className="px-4 py-2">{t('page.super_admin_panel.col_status')}</th>
              <th className="px-4 py-2 text-right">{t('page.super_admin_panel.col_toggle')}</th>
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
                    {isEnabled && <StatusChip status="ok"   label={t('page.super_admin_panel.flag_enabled')} />}
                    {isBeta    && <StatusChip status="warn" label={t('page.super_admin_panel.flag_beta')} />}
                    {f.status === 'disabled' && <StatusChip status="off"  label={t('page.super_admin_panel.flag_disabled')} />}
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
  const { t } = useTranslation()
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-5" data-platform-audit-log>
      <SectionHeader
        eyebrow={t('page.super_admin_panel.audit_eyebrow')}
        title={t('page.super_admin_panel.audit_title', { count: entries.length })}
        subtitle={t('page.super_admin_panel.audit_subtitle')}
      />

      <div className="flex flex-col gap-2" data-audit-entries>
        {entries.map(ev => (
          <div key={ev.id} className="flex flex-wrap items-start justify-between gap-2 rounded-md border border-slate-200 p-3 text-[12px]" data-audit-entry={ev.id}>
            <div className="min-w-0 flex-1">
              <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">{ev.action} · {ev.entityType}</p>
              <p className="mt-1 text-[13px] font-semibold text-slate-900">{ev.entityLabel}</p>
              <p className="mt-1 text-slate-700">{ev.details}</p>
            </div>
            <div className="text-right font-mono text-[10px] text-slate-500">
              <p>{ev.userName}</p>
              <p>{formatDateTime(ev.timestamp)}</p>
            </div>
          </div>
        ))}
      </div>

      <p
        className="rounded-md p-3 text-[11px] font-mono"
        style={{ backgroundColor: PLATFORM_ACCENT.bgTint, color: PLATFORM_ACCENT.primary }}
        data-immutability-note
      >
        {t('page.super_admin_panel.audit_immutability')}
      </p>
    </section>
  )
}

// -------------- Screen shell --------------

export function SuperAdminPanel() {
  const { t } = useTranslation()
  const currentUser = usePlatformStore(s => s.currentUser)
  const [activeTab, setActiveTab] = useState<TabKey>('clients')

  const { data: config }    = useQuery({ queryKey: ['platform-config'],       queryFn: () => platformApi.getConfig() })
  const { data: analytics = null } = useQuery({ queryKey: ['sa-analytics'],   queryFn: () => platformApi.getPlatformAnalytics() })
  const { data: audit = [] }   = useQuery({ queryKey: ['audit'],              queryFn: () => platformApi.listAudit() })

  const platformAudit = useMemo(
    () => (audit as AuditTrailEntry[]).filter(a => a.module === 'platform' && a.userId === 'user-sa'),
    [audit],
  )

  const onFlagToggle = () => { /* PATCH would go here in production */ }
  const activeTabLabel = t(TAB_LABEL_KEYS[activeTab])

  return (
    <div className="bg-slate-50" data-screen="super-admin-panel">
      <div className="flex flex-col gap-4" style={{ maxWidth: 1280, padding: '20px 32px 48px' }}>

        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-xs text-slate-500">
          <span>{t('page.super_admin_panel.crumb_super_admin')}</span>
          <span style={{ color: '#CBD5E1' }}>&gt;</span>
          <span className="font-semibold text-slate-900">{t('page.super_admin_panel.crumb_panel')}</span>
          <span style={{ color: '#CBD5E1' }}>&gt;</span>
          <span>{activeTabLabel}</span>
        </nav>

        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <h1 className="text-[22px] font-bold text-slate-900" style={{ margin: 0 }}>{t('page.super_admin_panel.title')}</h1>
            <p className="mt-1 font-mono text-xs" style={{ color: '#64748B' }} data-current-user>
              {t('page.super_admin_panel.user_byline', { name: currentUser.name })}
            </p>
          </div>
        </div>

        {/* Two-column: tab nav + content */}
        <div className="grid gap-4" style={{ gridTemplateColumns: '240px minmax(0, 1fr)' }}>

          <aside className="flex flex-col gap-1 rounded-lg border border-slate-200 bg-white p-2" data-settings-nav data-tab-count={TABS.length}>
            {TABS.map(ty => {
              const isActive = ty === activeTab
              return (
                <button
                  key={ty}
                  type="button"
                  onClick={() => setActiveTab(ty)}
                  data-settings-tab={ty}
                  data-active={isActive || undefined}
                  className="rounded-md px-3 py-2 text-left text-[13px] font-semibold transition-colors"
                  style={{
                    backgroundColor: isActive ? PLATFORM_ACCENT.primary : 'transparent',
                    color:           isActive ? '#FFFFFF' : '#334155',
                  }}
                >{t(TAB_LABEL_KEYS[ty])}</button>
              )
            })}
          </aside>

          <section className="flex min-w-0 flex-col gap-4 rounded-lg border border-slate-200 bg-white p-5" data-settings-content>
            {activeTab === 'clients'       && <ClientsTab />}
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
