import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import type { PlatformNotification, NotificationPreference } from '@platform/types'
import { PLATFORM_ACCENT } from '@platform/types'
import { platformApi, type MyNotification } from '../api/platformApi'

const DEMO_USER_ID   = 'user-rw'
const DEMO_USER_NAME = 'Dr Sarah Chen'

type FilterKey = 'all' | 'comment' | 'stage_advance' | 'review_assigned' | 'ma_advance_notice' | 'publishing_overdue' | 'system'

const FILTER_CHIPS: { key: FilterKey; labelKey: string; match: (n: PlatformNotification) => boolean }[] = [
  { key: 'all',                 labelKey: 'page.notification_centre.filter_all',                match: () => true },
  { key: 'comment',             labelKey: 'page.notification_centre.filter_comment',            match: n => n.eventType === 'comment' },
  { key: 'stage_advance',       labelKey: 'page.notification_centre.filter_stage_advance',      match: n => n.eventType === 'stage_advance' },
  { key: 'review_assigned',     labelKey: 'page.notification_centre.filter_review_assigned',    match: n => n.eventType === 'review_assigned' },
  { key: 'publishing_overdue',  labelKey: 'page.notification_centre.filter_publishing_overdue', match: n => n.eventType === 'publishing_overdue' || n.eventType === 'ma_advance_notice' },
  { key: 'system',              labelKey: 'page.notification_centre.filter_system',             match: n => n.eventType === 'system' },
]

const EVENT_TYPE_KEYS: Record<string, string> = {
  stage_advance:      'page.notification_centre.event_stage_advance',
  review_assigned:    'page.notification_centre.event_review_assigned',
  ma_advance_notice:  'page.notification_centre.event_ma_advance_notice',
  system:             'page.notification_centre.event_system',
  comment:            'page.notification_centre.event_comment',
  kol_reminder_1:     'page.notification_centre.event_kol_reminder',
  kol_reminder_2:     'page.notification_centre.event_kol_reminder',
  kol_invitation:     'page.notification_centre.event_kol_invitation',
  publishing_overdue: 'page.notification_centre.event_publishing_overdue',
  gate_failure:       'page.notification_centre.event_gate_failure',
}

const MODULE_META: Record<string, { labelKey: string; colour: string }> = {
  A: { labelKey: 'page.notification_centre.module_clinical_writing',     colour: '#2563EB' },
  B: { labelKey: 'page.notification_centre.module_scientific_writing',   colour: '#0D9488' },
  C: { labelKey: 'page.notification_centre.module_medical_writing',      colour: '#7C3AED' },
  D: { labelKey: 'page.notification_centre.module_regulatory_writing',   colour: '#B0200D' },
  E: { labelKey: 'page.notification_centre.module_ideation_publishing',  colour: '#0D9488' },
  platform: { labelKey: 'page.notification_centre.module_platform',      colour: PLATFORM_ACCENT.primary },
}

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const dd = String(d.getUTCDate()).padStart(2, '0')
  const hh = String(d.getUTCHours()).padStart(2, '0')
  const mm = String(d.getUTCMinutes()).padStart(2, '0')
  return `${dd} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()} ${hh}:${mm} UTC`
}

// A stored notification for the signed-in user (e.g. an @mention) in the shape the inbox shows.
function fromStored(n: MyNotification, ctaLabel: string): PlatformNotification {
  const p = (n.payload ?? {}) as { projectId?: string; commentId?: string }
  return {
    id: n.id,
    eventType: n.kind === 'comment.mention' ? 'comment' : 'system',
    title: n.title, body: n.body, module: 'A',
    projectId: p.projectId ?? null, entityRef: p.commentId ?? null,
    targetUserId: '', sentAt: n.createdAt, isRead: !!n.readAt,
    ctaLabel, ctaRoute: n.linkPath ?? '/home',
  }
}

export function NotificationCentre() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const qc = useQueryClient()

  const formatRelative = (iso: string, stored = false): string => {
    const then = new Date(iso).getTime()
    // The sample notifications are dated against a pinned "now"; stored ones use the real clock.
    const now  = stored ? Date.now() : new Date('2026-09-09T12:00:00Z').getTime()
    const diffMs = now - then
    const mins  = Math.round(diffMs / 60000)
    if (mins < 1)  return t('page.notification_centre.rel_just_now')
    if (mins < 60) return t('page.notification_centre.rel_minutes', { count: mins })
    const hrs = Math.round(mins / 60)
    if (hrs < 24)  return t('page.notification_centre.rel_hours', { count: hrs })
    const days = Math.round(hrs / 24)
    return t('page.notification_centre.rel_days', { count: days })
  }

  const { data: notifsAll = [] } = useQuery<PlatformNotification[]>({
    queryKey: ['notifications'],
    queryFn:  () => platformApi.listNotifications(),
  })
  const { data: stored = [] } = useQuery<MyNotification[]>({
    queryKey: ['notifications', 'stored'],
    queryFn:  () => platformApi.listMyNotifications(),
    refetchInterval: 30_000,
    retry: false,
  })
  const storedInbox = useMemo(() => stored.map(n => fromStored(n, t('page.notification_centre.cta_open_document'))), [stored, t])
  const storedIds = useMemo(() => new Set(storedInbox.map(n => n.id)), [storedInbox])
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
    () => [...storedInbox, ...notifsAll.filter(n => n.targetUserId === DEMO_USER_ID)],
    [storedInbox, notifsAll],
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
      if (storedIds.has(n.id)) await platformApi.markMyNotificationsRead([n.id]).catch(() => {})
      else await platformApi.markNotificationRead(n.id).catch(() => {})
      await qc.invalidateQueries({ queryKey: ['notifications'] })
      await qc.invalidateQueries({ queryKey: ['notifications-unread'] })
    }
  }

  const markAllRead = async () => {
    if (storedInbox.some(x => !x.isRead)) await platformApi.markAllMyNotificationsRead().catch(() => {})
    for (const n of inbox.filter(x => !x.isRead && !storedIds.has(x.id))) {
      await platformApi.markNotificationRead(n.id).catch(() => {})
    }
    await qc.invalidateQueries({ queryKey: ['notifications'] })
    await qc.invalidateQueries({ queryKey: ['notifications-unread'] })
  }

  const togglePref = (userId: string, eventType: string, channel: 'email' | 'inApp' | 'sms', next: boolean) => {
    const base = displayPrefs
    const nextPrefs = base.map(p => p.userId === userId && p.eventType === eventType ? { ...p, [channel]: next } : p)
    setPrefsLocal(nextPrefs)
    void platformApi.updateNotificationPreferences(nextPrefs).catch(() => {})
  }

  const eventLabel = (ev: string): string => {
    const key = EVENT_TYPE_KEYS[ev]
    return key ? t(key) : ev
  }
  const moduleLabel = (m: string): string => {
    const meta = MODULE_META[m]
    return meta ? t(meta.labelKey) : m
  }

  return (
    <div className="bg-slate-50" data-screen="notification-centre">
      <div className="flex flex-col gap-4" style={{ maxWidth: 1440, padding: '20px 32px 48px' }}>

        <nav className="flex items-center gap-2 text-xs text-slate-500">
          <span>{t('page.notification_centre.crumb_platform')}</span>
          <span style={{ color: '#CBD5E1' }}>&gt;</span>
          <span className="font-semibold text-slate-900">{t('page.notification_centre.crumb_notifications')}</span>
        </nav>

        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <h1 className="text-[22px] font-bold text-slate-900" style={{ margin: 0 }}>{t('page.notification_centre.title')}</h1>
            <p className="mt-1 max-w-[720px] text-[13px] text-slate-600">
              {t('page.notification_centre.subtitle')}
            </p>
            <p className="mt-1 font-mono text-xs text-slate-500" data-current-user>{t('page.notification_centre.user_byline', { name: DEMO_USER_NAME, role: t('page.notification_centre.role_regulatory_writer') })}</p>
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
            {t('page.notification_centre.tab_inbox')}
            {unreadCount > 0 && (
              <span
                className="inline-flex h-5 items-center rounded-full px-2 text-[11px] font-bold text-white"
                style={{ backgroundColor: PLATFORM_ACCENT.primary }}
                data-unread-badge
              >{t('page.notification_centre.unread_badge', { count: unreadCount })}</span>
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
          >{t('page.notification_centre.tab_preferences')}</button>
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
                    >{t(c.labelKey)}</button>
                  )
                })}
                <div className="flex-1" />
                <button type="button" onClick={markAllRead} data-mark-all-read
                  className="text-[11px] font-semibold text-slate-500 hover:underline">{t('page.notification_centre.mark_all_read')}</button>
              </div>

              <div className="flex flex-col divide-y divide-slate-200">
                {filtered.map(n => {
                  const mod = MODULE_META[n.module] ?? { labelKey: '', colour: PLATFORM_ACCENT.primary }
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
                        >{eventLabel(n.eventType)}</span>
                        <span className="font-mono text-[10px] text-slate-500" data-notif-time>{formatRelative(n.sentAt, storedIds.has(n.id))}</span>
                      </div>
                      <p className="text-[13px] font-semibold text-slate-900" data-notif-title>{n.title}</p>
                      <p className="font-mono text-[10px] text-slate-500" data-notif-context>
                        {n.entityRef ?? '—'} · {moduleLabel(n.module)}
                      </p>
                    </button>
                  )
                })}
              </div>

              <p className="pt-2 font-mono text-[11px] text-slate-500" data-count-label>
                {t('page.notification_centre.count_label', { total: filtered.length, unread: unreadCount })}
              </p>
            </section>

            {/* Right — detail */}
            <aside className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-5" data-detail-panel>
              {active ? (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-mono font-semibold uppercase"
                      style={{ backgroundColor: PLATFORM_ACCENT.bgTint, color: PLATFORM_ACCENT.primary }}
                      data-active-type>{eventLabel(active.eventType)}</span>
                    <span className="inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-mono font-semibold uppercase"
                      style={{ backgroundColor: `${(MODULE_META[active.module]?.colour ?? PLATFORM_ACCENT.primary)}22`, color: MODULE_META[active.module]?.colour ?? PLATFORM_ACCENT.primary }}
                      data-active-module>{moduleLabel(active.module)}</span>
                  </div>

                  <h2 className="text-[16px] font-bold text-slate-900" data-active-title>{active.title}</h2>
                  <p className="text-[13px] text-slate-700" data-active-body>{active.body}</p>
                  <p className="font-mono text-[11px] text-slate-500" data-active-stamp>{t('page.notification_centre.raised_label', { time: formatDateTime(active.sentAt) })}</p>

                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => navigate(active.ctaRoute)}
                      data-active-action
                      className="h-9 rounded-md px-4 text-[13px] font-semibold text-white"
                      style={{ backgroundColor: PLATFORM_ACCENT.primary }}
                    >{active.ctaLabel}</button>
                    <button type="button" className="text-[12px] font-semibold text-slate-500 hover:underline" data-dismiss>{t('page.notification_centre.dismiss')}</button>
                  </div>
                  <p className="font-mono text-[11px] text-slate-500" data-dismiss-note>
                    {t('page.notification_centre.dismiss_note')}
                  </p>
                </>
              ) : (
                <p className="text-[13px] text-slate-500">{t('page.notification_centre.select_hint')}</p>
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
              {t('page.notification_centre.prefs_note')}
            </p>

            <div className="overflow-hidden rounded-lg border border-slate-200" data-prefs-table>
              <table className="w-full text-[13px]">
                <thead style={{ backgroundColor: '#F8FAFC' }}>
                  <tr className="text-left text-[11px] font-semibold uppercase tracking-widest text-slate-500">
                    <th className="px-4 py-2">{t('page.notification_centre.col_event_type')}</th>
                    <th className="px-4 py-2 text-center">{t('page.notification_centre.col_email')}</th>
                    <th className="px-4 py-2 text-center">{t('page.notification_centre.col_in_app')}</th>
                    <th className="px-4 py-2 text-center">{t('page.notification_centre.col_sms')}</th>
                  </tr>
                </thead>
                <tbody>
                  {displayPrefs.map(p => {
                    const isSystem = p.eventType === 'system'
                    return (
                      <tr key={`${p.userId}-${p.eventType}`} className="border-t border-slate-200" data-pref-row={p.eventType}>
                        <td className="px-4 py-3 font-semibold text-slate-900">{eventLabel(p.eventType)}</td>
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
              {t('page.notification_centre.audit_note')}
            </p>
          </section>
        )}
      </div>
    </div>
  )
}
