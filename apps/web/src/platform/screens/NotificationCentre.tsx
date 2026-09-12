import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { PlatformNotification, NotificationPreference } from '@platform/types'
import { PLATFORM_ACCENT } from '@platform/types'
import { platformApi } from '../api/platformApi'

const DEMO_USER_ID   = 'user-rw'
const DEMO_USER_NAME = 'Dr Sarah Chen'
const DEMO_USER_ROLE = 'Regulatory Writer'

type FilterKey = 'all' | 'stage_advance' | 'review_assigned' | 'ma_advance_notice' | 'publishing_overdue' | 'system'

const FILTER_CHIPS: { key: FilterKey; label: string; match: (n: PlatformNotification) => boolean }[] = [
  { key: 'all',                 label: 'All types',        match: () => true },
  { key: 'stage_advance',       label: 'Stage advance',    match: n => n.eventType === 'stage_advance' },
  { key: 'review_assigned',     label: 'Review assigned',  match: n => n.eventType === 'review_assigned' },
  { key: 'publishing_overdue',  label: 'Publishing due',   match: n => n.eventType === 'publishing_overdue' || n.eventType === 'ma_advance_notice' },
  { key: 'system',              label: 'System',           match: n => n.eventType === 'system' },
]

const EVENT_TYPE_LABEL: Record<string, string> = {
  stage_advance:      'Stage advance',
  review_assigned:    'Review assigned',
  ma_advance_notice:  'MA advance notice',
  system:             'System',
  comment:            'Comment',
  kol_reminder_1:     'KOL reminder',
  kol_reminder_2:     'KOL reminder',
  kol_invitation:     'KOL invitation',
  publishing_overdue: 'Publishing overdue',
  gate_failure:       'Gate failure',
}

const MODULE_META: Record<string, { label: string; colour: string }> = {
  A: { label: 'Module A · Clinical Writing',      colour: '#2563EB' },
  B: { label: 'Module B · Scientific Writing',    colour: '#0D9488' },
  C: { label: 'Module C · Medical Writing',       colour: '#7C3AED' },
  D: { label: 'Module D · Regulatory Writing',    colour: '#B0200D' },
  E: { label: 'Module E · Ideation & Publishing', colour: '#0D9488' },
  platform: { label: 'Platform',                  colour: PLATFORM_ACCENT.primary },
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime()
  const now  = new Date('2026-09-09T12:00:00Z').getTime()  // pinned demo now
  const diffMs = now - then
  const mins  = Math.round(diffMs / 60000)
  if (mins < 1)  return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24)  return `${hrs}h ago`
  const days = Math.round(hrs / 24)
  return `${days}d ago`
}
function formatDateTime(iso: string): string {
  const d = new Date(iso)
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const dd = String(d.getUTCDate()).padStart(2, '0')
  const hh = String(d.getUTCHours()).padStart(2, '0')
  const mm = String(d.getUTCMinutes()).padStart(2, '0')
  return `${dd} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()} ${hh}:${mm} UTC`
}

export function NotificationCentre() {
  const navigate = useNavigate()
  const qc = useQueryClient()

  const { data: notifsAll = [] } = useQuery<PlatformNotification[]>({
    queryKey: ['notifications'],
    queryFn:  () => platformApi.listNotifications(),
  })
  const { data: prefs = [] } = useQuery<NotificationPreference[]>({
    queryKey: ['notification-prefs'],
    queryFn:  () => platformApi.getNotificationPreferences(),
  })

  const [tab, setTab] = useState<'inbox' | 'preferences'>('inbox')
  const [filter, setFilter] = useState<FilterKey>('all')
  const [selectedId, setSelectedId] = useState<string>('notif-001')
  const [prefsLocal, setPrefsLocal] = useState<NotificationPreference[] | null>(null)

  // Filter to demo user (per brief §68)
  const inbox = useMemo(
    () => notifsAll.filter(n => n.targetUserId === DEMO_USER_ID),
    [notifsAll],
  )

  const filtered = useMemo(() => {
    const chip = FILTER_CHIPS.find(c => c.key === filter) ?? FILTER_CHIPS[0]
    return inbox.filter(n => chip.match(n))
  }, [inbox, filter])

  const unreadCount = inbox.filter(n => !n.isRead).length
  const active = inbox.find(n => n.id === selectedId) ?? inbox[0] ?? null

  const displayPrefs = prefsLocal ?? prefs

  const handleClickRow = async (n: PlatformNotification) => {
    setSelectedId(n.id)
    if (!n.isRead) {
      await platformApi.markNotificationRead(n.id).catch(() => {})
      await qc.invalidateQueries({ queryKey: ['notifications'] })
    }
  }

  const markAllRead = async () => {
    for (const n of inbox.filter(x => !x.isRead)) {
      await platformApi.markNotificationRead(n.id).catch(() => {})
    }
    await qc.invalidateQueries({ queryKey: ['notifications'] })
  }

  const togglePref = (userId: string, eventType: string, channel: 'email' | 'inApp' | 'sms', next: boolean) => {
    const base = displayPrefs
    const nextPrefs = base.map(p => p.userId === userId && p.eventType === eventType ? { ...p, [channel]: next } : p)
    setPrefsLocal(nextPrefs)
    void platformApi.updateNotificationPreferences(nextPrefs).catch(() => {})
  }

  return (
    <div className="bg-slate-50" data-screen="notification-centre">
      <div className="mx-auto flex flex-col gap-4" style={{ maxWidth: 1440, padding: '20px 32px 48px' }}>

        <nav className="flex items-center gap-2 text-xs text-slate-500">
          <span>Platform</span>
          <span style={{ color: '#CBD5E1' }}>&gt;</span>
          <span className="font-semibold text-slate-900">Notifications</span>
        </nav>

        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <h1 className="text-[22px] font-bold text-slate-900" style={{ margin: 0 }}>Notifications</h1>
            <p className="mt-1 max-w-[720px] text-[13px] text-slate-600">
              Assignments, stage advances and system events across every discipline you work in.
            </p>
            <p className="mt-1 font-mono text-xs text-slate-500" data-current-user>{DEMO_USER_NAME} · {DEMO_USER_ROLE}</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 border-b border-slate-200" data-tabs>
          <button
            type="button" onClick={() => setTab('inbox')}
            data-tab="inbox" data-active={tab === 'inbox' || undefined}
            className="flex items-center gap-2 px-3 py-2 text-[13px] font-semibold"
            style={{
              color: tab === 'inbox' ? PLATFORM_ACCENT.primary : '#64748B',
              borderBottom: tab === 'inbox' ? `2px solid ${PLATFORM_ACCENT.primary}` : '2px solid transparent',
            }}
          >
            Inbox
            {unreadCount > 0 && (
              <span
                className="inline-flex h-5 items-center rounded-full px-2 text-[11px] font-bold text-white"
                style={{ backgroundColor: PLATFORM_ACCENT.primary }}
                data-unread-badge
              >{unreadCount} unread</span>
            )}
          </button>
          <button
            type="button" onClick={() => setTab('preferences')}
            data-tab="preferences" data-active={tab === 'preferences' || undefined}
            className="px-3 py-2 text-[13px] font-semibold"
            style={{
              color: tab === 'preferences' ? PLATFORM_ACCENT.primary : '#64748B',
              borderBottom: tab === 'preferences' ? `2px solid ${PLATFORM_ACCENT.primary}` : '2px solid transparent',
            }}
          >Preferences</button>
        </div>

        {/* Body */}
        {tab === 'inbox' ? (
          <div className="grid gap-4" style={{ gridTemplateColumns: '420px 1fr' }}>

            {/* Left — list */}
            <section className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-3" data-inbox-list>

              <div className="flex flex-wrap items-center gap-2" data-filter-chips>
                {FILTER_CHIPS.map(c => {
                  const isActive = c.key === filter
                  return (
                    <button
                      key={c.key}
                      type="button"
                      onClick={() => setFilter(c.key)}
                      data-filter-chip={c.key}
                      data-active={isActive || undefined}
                      className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
                      style={{
                        backgroundColor: isActive ? PLATFORM_ACCENT.primary : '#F1F5F9',
                        color:           isActive ? '#FFFFFF' : '#475569',
                      }}
                    >{c.label}</button>
                  )
                })}
                <div className="flex-1" />
                <button type="button" onClick={markAllRead} data-mark-all-read
                  className="text-[11px] font-semibold text-slate-500 hover:underline">Mark all as read</button>
              </div>

              <div className="flex flex-col divide-y divide-slate-200">
                {filtered.map(n => {
                  const mod = MODULE_META[n.module] ?? { label: n.module, colour: PLATFORM_ACCENT.primary }
                  const isActive = n.id === active?.id
                  return (
                    <button
                      key={n.id}
                      type="button"
                      onClick={() => handleClickRow(n)}
                      data-notif-row={n.id}
                      data-notif-read={n.isRead || undefined}
                      data-notif-active={isActive || undefined}
                      className="flex flex-col items-start gap-1 px-3 py-2 text-left hover:bg-slate-50"
                      style={{
                        borderLeft: n.isRead ? '3px solid transparent' : `3px solid ${PLATFORM_ACCENT.primary}`,
                        backgroundColor: isActive ? PLATFORM_ACCENT.bgTint : undefined,
                      }}
                    >
                      <div className="flex w-full items-center justify-between gap-2">
                        <span className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-mono font-semibold uppercase"
                          style={{ backgroundColor: `${mod.colour}22`, color: mod.colour }}
                          data-notif-type={n.eventType}
                        >{EVENT_TYPE_LABEL[n.eventType] ?? n.eventType}</span>
                        <span className="font-mono text-[10px] text-slate-500" data-notif-time>{formatRelative(n.sentAt)}</span>
                      </div>
                      <p className="text-[13px] font-semibold text-slate-900" data-notif-title>{n.title}</p>
                      <p className="font-mono text-[10px] text-slate-500" data-notif-context>
                        {n.entityRef ?? '—'} · {mod.label}
                      </p>
                    </button>
                  )
                })}
              </div>

              <p className="pt-2 font-mono text-[11px] text-slate-500" data-count-label>
                Showing {filtered.length} notifications · {unreadCount} unread
              </p>
            </section>

            {/* Right — detail */}
            <aside className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-5" data-detail-panel>
              {active ? (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-mono font-semibold uppercase"
                      style={{ backgroundColor: PLATFORM_ACCENT.bgTint, color: PLATFORM_ACCENT.primary }}
                      data-active-type>{EVENT_TYPE_LABEL[active.eventType] ?? active.eventType}</span>
                    <span className="inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-mono font-semibold uppercase"
                      style={{ backgroundColor: `${(MODULE_META[active.module]?.colour ?? PLATFORM_ACCENT.primary)}22`, color: MODULE_META[active.module]?.colour ?? PLATFORM_ACCENT.primary }}
                      data-active-module>{MODULE_META[active.module]?.label ?? active.module}</span>
                  </div>

                  <h2 className="text-[16px] font-bold text-slate-900" data-active-title>{active.title}</h2>
                  <p className="text-[13px] text-slate-700" data-active-body>{active.body}</p>
                  <p className="font-mono text-[11px] text-slate-500" data-active-stamp>Raised: {formatDateTime(active.sentAt)}</p>

                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => navigate(active.ctaRoute)}
                      data-active-action
                      className="h-9 rounded-md px-4 text-[13px] font-semibold text-white"
                      style={{ backgroundColor: PLATFORM_ACCENT.primary }}
                    >{active.ctaLabel}</button>
                    <button type="button" className="text-[12px] font-semibold text-slate-500 hover:underline" data-dismiss>Dismiss</button>
                  </div>
                  <p className="font-mono text-[11px] text-slate-500" data-dismiss-note>
                    Dismissing removes the notification from your inbox. The underlying event remains in the audit trail.
                  </p>
                </>
              ) : (
                <p className="text-[13px] text-slate-500">Select a notification to view details.</p>
              )}
            </aside>
          </div>
        ) : (
          // Preferences tab
          <section className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-5" data-preferences-tab>
            <p
              className="rounded-md p-3 text-[12px]"
              style={{ backgroundColor: PLATFORM_ACCENT.bgTint, color: PLATFORM_ACCENT.primary }}
              data-prefs-note
            >
              Preferences apply to your account across every client project. In-app delivery cannot be disabled for system alerts.
            </p>

            <div className="overflow-hidden rounded-lg border border-slate-200" data-prefs-table>
              <table className="w-full text-[13px]">
                <thead style={{ backgroundColor: '#F8FAFC' }}>
                  <tr className="text-left text-[11px] font-semibold uppercase tracking-widest text-slate-500">
                    <th className="px-4 py-2">Event type</th>
                    <th className="px-4 py-2 text-center">Email</th>
                    <th className="px-4 py-2 text-center">In-app</th>
                    <th className="px-4 py-2 text-center">SMS</th>
                  </tr>
                </thead>
                <tbody>
                  {displayPrefs.map(p => {
                    const isSystem = p.eventType === 'system'
                    return (
                      <tr key={`${p.userId}-${p.eventType}`} className="border-t border-slate-200" data-pref-row={p.eventType}>
                        <td className="px-4 py-3 font-semibold text-slate-900">{EVENT_TYPE_LABEL[p.eventType] ?? p.eventType}</td>
                        <td className="px-4 py-3 text-center">
                          <input type="checkbox" checked={p.email} onChange={(e) => togglePref(p.userId, p.eventType, 'email', e.currentTarget.checked)}
                            data-pref-toggle={`${p.eventType}-email`} style={{ accentColor: PLATFORM_ACCENT.primary }} />
                        </td>
                        <td className="px-4 py-3 text-center">
                          <input
                            type="checkbox"
                            checked={p.inApp}
                            disabled={isSystem}
                            onChange={(e) => togglePref(p.userId, p.eventType, 'inApp', e.currentTarget.checked)}
                            data-pref-toggle={`${p.eventType}-inApp`}
                            data-pref-locked={isSystem || undefined}
                            style={{ accentColor: PLATFORM_ACCENT.primary }}
                          />
                        </td>
                        <td className="px-4 py-3 text-center">
                          <input type="checkbox" checked={p.sms} onChange={(e) => togglePref(p.userId, p.eventType, 'sms', e.currentTarget.checked)}
                            data-pref-toggle={`${p.eventType}-sms`} style={{ accentColor: PLATFORM_ACCENT.primary }} />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <p className="font-mono text-[11px] text-slate-500" data-audit-note>
              Preference changes take effect immediately and are written to the audit trail.
            </p>
          </section>
        )}
      </div>
    </div>
  )
}
