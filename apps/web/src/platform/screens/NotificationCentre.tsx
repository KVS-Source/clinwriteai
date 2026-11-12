// Notification Centre — the signed-in user's own in-app notifications (bell in the top bar).
//
// Reads GET /notifications/me (newest first, dismissed ones left out; refreshed every 30 s so new
// @mentions arrive) and acts through
// /notifications/me/mark-read, /me/mark-all-read and /me/:id/dismiss. Every call is the
// signed-in user's own: the API scopes them to the session, so there is no user filter here.
// Loading, a failed load (with a retry) and an empty inbox each have their own state, and a
// failed action says so instead of being swallowed.
//
// Role switcher: a user holding two roles sees every notification, but one meant for the other role (the
// API's forRole) shows a warning with "Switch to ..." instead of its content, and isn't marked read. Switching
// remembers the role and opens the notification's page as that role (or the notification itself).
//
// There is no Preferences tab: the API has no notification-preferences endpoint, and delivery
// doesn't consult per-user preferences yet, so toggles would change nothing.

import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { PLATFORM_ACCENT, PLATFORM_USER_ROLE_LABEL } from '@platform/types'
import { platformApi, type MyNotification } from '../api/platformApi'
import { usePlatformStore } from '../store'
import { describeApiError } from '../../api'
import { chooseActiveRole } from '../../config/activeRole'

const QUERY_KEY = ['notifications', 'me'] as const
const UNREAD_KEY = ['notifications-unread'] as const     // the bell's badge (TopNav)

type FilterKey = 'all' | 'unread'

// Labels for the kinds the API sends; anything else reads "Notification".
const KIND_KEYS: Record<string, string> = {
  'comment.mention':               'page.notification_centre.kind_mention',
  'document.returned_to_authoring': 'page.notification_centre.kind_returned_to_authoring',
  'user.invitation':               'page.notification_centre.kind_user_invitation',
  'signature_requested':           'page.notification_centre.kind_signature_requested',
  'document_nudge':                'page.notification_centre.kind_document_nudge',
  'ai_quota_approaching':          'page.notification_centre.kind_ai_quota_approaching',
  'account.inactivity_warning':    'page.notification_centre.kind_inactivity_warning',
  'account.inactivity_suspended':  'page.notification_centre.kind_inactivity_suspended',
}

const SEVERITY_STYLE: Record<MyNotification['severity'], { bg: string; fg: string; labelKey?: string }> = {
  info:     { bg: PLATFORM_ACCENT.bgTint, fg: PLATFORM_ACCENT.primary },
  warning:  { bg: '#FEF3C7', fg: '#92400E', labelKey: 'page.notification_centre.severity_warning' },
  critical: { bg: '#FEE2E2', fg: '#991B1B', labelKey: 'page.notification_centre.severity_critical' },
}

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const dd = String(d.getUTCDate()).padStart(2, '0')
  const hh = String(d.getUTCHours()).padStart(2, '0')
  const mm = String(d.getUTCMinutes()).padStart(2, '0')
  return `${dd} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()} ${hh}:${mm} UTC`
}

// A title that starts with the sender's name gets their role in brackets: "Raj mentioned you…" -> "Raj (Reviewer) mentioned you…".
const withActorRole = (title: string, actor: MyNotification['actor']) =>
  actor && title.startsWith(actor.name) && !title.startsWith(`${actor.name} (`) ? `${actor.name} (${actor.role})${title.slice(actor.name.length)}` : title

export function NotificationCentre() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const currentUser = usePlatformStore(s => s.currentUser)
  const [searchParams] = useSearchParams()
  const heldRoles: readonly string[] = currentUser.allRoles && currentUser.allRoles.length > 0 ? currentUser.allRoles : [currentUser.role]
  /** Meant for the user's other role: switch before seeing it. */
  const needsSwitch = (n: MyNotification) => !!n.forRole && n.forRole !== currentUser.role && heldRoles.includes(n.forRole)
  const roleName = (r: string) => PLATFORM_USER_ROLE_LABEL[r as keyof typeof PLATFORM_USER_ROLE_LABEL] ?? r

  const formatRelative = (iso: string): string => {
    const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
    if (mins < 1)  return t('page.notification_centre.rel_just_now')
    if (mins < 60) return t('page.notification_centre.rel_minutes', { count: mins })
    const hrs = Math.round(mins / 60)
    if (hrs < 24)  return t('page.notification_centre.rel_hours', { count: hrs })
    return t('page.notification_centre.rel_days', { count: Math.round(hrs / 24) })
  }
  const kindLabel = (kind: string) => t(KIND_KEYS[kind] ?? 'page.notification_centre.kind_other')

  const feed = useQuery({
    queryKey: QUERY_KEY,
    queryFn:  () => platformApi.listMyNotifications(),
    refetchInterval: 30_000,
    retry: false,
  })
  const inbox = useMemo(() => feed.data ?? [], [feed.data])

  const [filter, setFilter] = useState<FilterKey>('all')
  // ?open=<id>: the notification to show first (where a role switch lands when there is no page to open).
  const [selectedId, setSelectedId] = useState<string | null>(() => searchParams.get('open'))
  const [switching, setSwitching] = useState(false)
  // Only when arriving with ?open=<id>; otherwise the first notification is opened as before.
  const [autoOpened, setAutoOpened] = useState(() => !searchParams.get('open'))
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => { if (e.persisted) setSwitching(false) }
    window.addEventListener('pageshow', onShow)
    return () => window.removeEventListener('pageshow', onShow)
  }, [])
  const [actionError, setActionError] = useState<string | null>(null)

  const filtered = useMemo(() => (filter === 'unread' ? inbox.filter(n => !n.readAt) : inbox), [inbox, filter])
  const unreadCount = inbox.filter(n => !n.readAt).length
  // The chosen notification (kept open even after it is read and leaves the Unread filter), else the first one in the list.
  const active = inbox.find(n => n.id === selectedId) ?? filtered[0] ?? null

  // Changes are applied to the cached feed straight away; a failure says so and reloads it.
  const patchCache = (fn: (list: MyNotification[]) => MyNotification[]) =>
    qc.setQueryData<MyNotification[]>(QUERY_KEY, old => (old ? fn(old) : old))
  // Any change to read / dismissed state also changes the bell's unread count.
  const refreshBadge = () => void qc.invalidateQueries({ queryKey: UNREAD_KEY })
  const onActionError = (err: unknown) => {
    setActionError(t('page.notification_centre.action_failed', { message: describeApiError(err).message }))
    void qc.invalidateQueries({ queryKey: QUERY_KEY })
  }
  const now = () => new Date().toISOString()

  const markRead = useMutation({
    mutationFn: (id: string) => platformApi.markMyNotificationsRead([id]),
    onMutate: (id) => { setActionError(null); patchCache(list => list.map(n => (n.id === id && !n.readAt ? { ...n, readAt: now() } : n))) },
    onError: onActionError,
    onSettled: refreshBadge,
  })
  const markAllRead = useMutation({
    mutationFn: () => platformApi.markAllMyNotificationsRead(),
    onMutate: () => { setActionError(null); patchCache(list => list.map(n => (n.readAt ? n : { ...n, readAt: now() }))) },
    onError: onActionError,
    onSettled: refreshBadge,
  })
  const dismiss = useMutation({
    mutationFn: (id: string) => platformApi.dismissNotification(id),
    onMutate: (id) => { setActionError(null); setSelectedId(null); patchCache(list => list.filter(n => n.id !== id)) },
    onError: onActionError,
    onSettled: refreshBadge,
  })

  const select = (n: MyNotification) => {
    setSelectedId(n.id)
    // Not read until it is actually seen, i.e. after switching to its role.
    if (!n.readAt && !needsSwitch(n)) markRead.mutate(n.id)
  }

  // Switch to the notification's role, then open its page as that role (a full load, so every screen and
  // query starts over), or the notification itself when it has no page.
  const switchAndOpen = async (n: MyNotification) => {
    if (!n.forRole) return
    setSwitching(true)
    if (!n.readAt) await platformApi.markMyNotificationsRead([n.id]).catch(() => undefined)
    chooseActiveRole(currentUser.id, n.forRole)
    window.location.assign(n.linkPath && n.linkPath.startsWith('/') ? n.linkPath : `/notifications?open=${encodeURIComponent(n.id)}`)
  }

  // The notification shown on the right is being read. On arrival (and after dismissing one) the first is shown
  // without a click, so open it for real: it is marked read and the unread count goes down.
  useEffect(() => {
    if (selectedId === null && filtered[0]) select(filtered[0])
    else if (!autoOpened && selectedId !== null && inbox.length > 0) {
      // Arrived with ?open=<id> (e.g. after switching role): it is being read now.
      setAutoOpened(true)
      const n = inbox.find(x => x.id === selectedId)
      if (n && !n.readAt && !needsSwitch(n)) markRead.mutate(n.id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, filtered])

  const openLink = (path: string) => {
    if (path.startsWith('/')) navigate(path)
    else window.open(path, '_blank', 'noopener')
  }

  const roleLabel = PLATFORM_USER_ROLE_LABEL[currentUser.role] ?? currentUser.role

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
            <p className="mt-1 max-w-[720px] text-[13px] text-slate-600">{t('page.notification_centre.subtitle')}</p>
            <p className="mt-1 font-mono text-xs text-slate-500" data-current-user>
              {t('page.notification_centre.user_byline', { name: currentUser.name, role: roleLabel })}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1 border-b border-slate-200" data-tabs>
          <span
            data-tab="inbox" data-active
            className="flex items-center gap-2 px-3 py-2 text-[13px] font-semibold"
            style={{ color: PLATFORM_ACCENT.primary, borderBottom: `2px solid ${PLATFORM_ACCENT.primary}` }}
          >
            {t('page.notification_centre.tab_inbox')}
            {unreadCount > 0 && (
              <span className="inline-flex h-5 items-center rounded-full px-2 text-[11px] font-bold text-white"
                style={{ backgroundColor: PLATFORM_ACCENT.primary }} data-unread-badge>
                {t('page.notification_centre.unread_badge', { count: unreadCount })}
              </span>
            )}
          </span>
        </div>

        {actionError && (
          <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-800" data-action-error>
            {actionError}
          </p>
        )}

        {feed.isLoading ? (
          <p className="rounded-lg border border-slate-200 bg-white p-6 text-[13px] text-slate-500" data-state="loading">
            {t('page.notification_centre.loading')}
          </p>
        ) : feed.isError ? (
          <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-[13px] text-red-800" data-state="error">
            <span>{t('page.notification_centre.load_failed', { message: describeApiError(feed.error).message })}</span>
            <button type="button" onClick={() => void feed.refetch()} data-action="retry"
              className="rounded-md border border-red-300 bg-white px-3 py-1 text-[12px] font-semibold text-red-800 hover:bg-red-100">
              {t('page.notification_centre.retry')}
            </button>
          </div>
        ) : inbox.length === 0 ? (
          <div className="rounded-lg border border-slate-200 bg-white p-8 text-center" data-state="empty">
            <p className="text-[14px] font-semibold text-slate-800">{t('page.notification_centre.empty_inbox')}</p>
            <p className="mt-1 text-[13px] text-slate-500">{t('page.notification_centre.empty_inbox_hint')}</p>
          </div>
        ) : (
          <div className="grid gap-4" style={{ gridTemplateColumns: 'minmax(0, 420px) minmax(0, 1fr)' }}>

            {/* Left — list */}
            <section className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-3" data-inbox-list>
              <div className="flex flex-wrap items-center gap-2" data-filter-chips>
                {(['all', 'unread'] as const).map(key => {
                  const isActive = key === filter
                  return (
                    <button key={key} type="button" onClick={() => setFilter(key)}
                      data-filter-chip={key} data-active={isActive || undefined}
                      className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
                      style={{ backgroundColor: isActive ? PLATFORM_ACCENT.primary : '#F1F5F9', color: isActive ? '#FFFFFF' : '#475569' }}>
                      {t(key === 'all' ? 'page.notification_centre.filter_all' : 'page.notification_centre.filter_unread')}
                    </button>
                  )
                })}
                <div className="flex-1" />
                <button type="button" onClick={() => markAllRead.mutate()} disabled={unreadCount === 0 || markAllRead.isPending} data-mark-all-read
                  className="text-[11px] font-semibold text-slate-500 hover:underline disabled:cursor-default disabled:opacity-50 disabled:no-underline">
                  {t('page.notification_centre.mark_all_read')}
                </button>
              </div>

              {filtered.length === 0 ? (
                <p className="px-3 py-6 text-center text-[13px] text-slate-500" data-state="empty-filter">
                  {t('page.notification_centre.empty_unread')}
                </p>
              ) : (
                <div className="flex flex-col divide-y divide-slate-200">
                  {filtered.map(n => {
                    const isActive = n.id === active?.id
                    const sev = SEVERITY_STYLE[n.severity] ?? SEVERITY_STYLE.info
                    return (
                      <button key={n.id} type="button" onClick={() => select(n)}
                        data-notif-row={n.id} data-notif-read={!!n.readAt || undefined} data-notif-active={isActive || undefined}
                        className="flex flex-col items-start gap-1 px-3 py-2 text-left hover:bg-slate-50"
                        style={{
                          borderLeft: n.readAt ? '3px solid transparent' : `3px solid ${PLATFORM_ACCENT.primary}`,
                          backgroundColor: isActive ? PLATFORM_ACCENT.bgTint : undefined,
                        }}>
                        <div className="flex w-full items-center justify-between gap-2">
                          <span className="inline-flex items-center rounded-md px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase"
                            style={{ backgroundColor: sev.bg, color: sev.fg }} data-notif-type={n.kind}>
                            {kindLabel(n.kind)}
                          </span>
                          <span className="font-mono text-[10px] text-slate-500" title={formatDateTime(n.createdAt)} data-notif-time>
                            {formatRelative(n.createdAt)}
                          </span>
                        </div>
                        {needsSwitch(n) && (
                          <span className="inline-flex items-center rounded-md border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800" data-notif-for-role={n.forRole}>
                            {t('page.notification_centre.for_role', { role: roleName(n.forRole!) })}
                          </span>
                        )}
                        <p className={`text-[13px] text-slate-900 ${n.readAt ? 'font-medium' : 'font-semibold'}`} data-notif-title>{withActorRole(n.title, n.actor)}</p>
                        {n.context && (
                          <p className="w-full truncate text-[11px] text-slate-500" data-notif-context>
                            <span className="font-semibold text-slate-600">{n.context.projectName ?? t('page.notification_centre.project_unknown', { defaultValue: 'Project' })}</span>
                            <span className="mx-1 text-slate-300">›</span>
                            {n.context.documentTitle}
                          </p>
                        )}
                      </button>
                    )
                  })}
                </div>
              )}

              <p className="pt-2 font-mono text-[11px] text-slate-500" data-count-label>
                {t('page.notification_centre.count_label', { total: filtered.length, unread: unreadCount })}
              </p>
            </section>

            {/* Right — detail */}
            <aside className="flex min-w-0 flex-col gap-3 rounded-lg border border-slate-200 bg-white p-5" data-detail-panel>
              {active && needsSwitch(active) ? (
                <div className="flex flex-col gap-3" role="alert" data-role-switch-notice={active.forRole}>
                  <span className="inline-flex w-fit items-center rounded-md px-2 py-0.5 font-mono text-[10px] font-semibold uppercase"
                    style={{ backgroundColor: PLATFORM_ACCENT.bgTint, color: PLATFORM_ACCENT.primary }}>
                    {kindLabel(active.kind)}
                  </span>
                  <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3">
                    <p className="text-[14px] font-bold text-amber-900">
                      {t('page.notification_centre.switch_title', { role: roleName(active.forRole!) })}
                    </p>
                    <p className="mt-1 text-[13px] text-amber-900">
                      {t('page.notification_centre.switch_body', { role: roleName(active.forRole!), current: roleName(currentUser.role) })}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <button type="button" onClick={() => void switchAndOpen(active)} disabled={switching} data-action="switch-role-open"
                      className="h-9 rounded-md px-4 text-[13px] font-semibold text-white disabled:opacity-60" style={{ backgroundColor: PLATFORM_ACCENT.primary }}>
                      {switching ? t('page.notification_centre.switching') : t('page.notification_centre.switch_action', { role: roleName(active.forRole!) })}
                    </button>
                  </div>
                </div>
              ) : active ? (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center rounded-md px-2 py-0.5 font-mono text-[10px] font-semibold uppercase"
                      style={{ backgroundColor: PLATFORM_ACCENT.bgTint, color: PLATFORM_ACCENT.primary }} data-active-type>
                      {kindLabel(active.kind)}
                    </span>
                    {SEVERITY_STYLE[active.severity]?.labelKey && (
                      <span className="inline-flex items-center rounded-md px-2 py-0.5 font-mono text-[10px] font-semibold uppercase"
                        style={{ backgroundColor: SEVERITY_STYLE[active.severity].bg, color: SEVERITY_STYLE[active.severity].fg }} data-active-severity>
                        {t(SEVERITY_STYLE[active.severity].labelKey!)}
                      </span>
                    )}
                  </div>

                  <h2 className="text-[16px] font-bold text-slate-900" data-active-title>{withActorRole(active.title, active.actor)}</h2>
                  {(active.context || active.actor) && (
                    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md bg-slate-50 px-3 py-2 text-[12px]" data-active-context>
                      {active.context && (
                        <>
                          <dt className="font-semibold text-slate-500">{t('page.notification_centre.project_label', { defaultValue: 'Project' })}</dt>
                          <dd className="text-slate-900" data-context-project>{active.context.projectName ?? '—'}</dd>
                          <dt className="font-semibold text-slate-500">{t('page.notification_centre.document_label', { defaultValue: 'Document' })}</dt>
                          <dd className="text-slate-900" data-context-document>{active.context.documentTitle}</dd>
                        </>
                      )}
                      {active.actor && (
                        <>
                          <dt className="font-semibold text-slate-500">{t('page.notification_centre.from_label', { defaultValue: 'From' })}</dt>
                          <dd className="text-slate-900" data-context-from>{active.actor.name} ({active.actor.role})</dd>
                        </>
                      )}
                    </dl>
                  )}
                  <p className="whitespace-pre-line break-words text-[13px] leading-relaxed text-slate-700" data-active-body>{active.body}</p>
                  <p className="font-mono text-[11px] text-slate-500" data-active-stamp>
                    {t('page.notification_centre.raised_label', { time: formatDateTime(active.createdAt) })}
                  </p>

                  <div className="flex items-center gap-3">
                    {active.linkPath && (
                      <button type="button" onClick={() => openLink(active.linkPath!)} data-active-action
                        className="h-9 rounded-md px-4 text-[13px] font-semibold text-white" style={{ backgroundColor: PLATFORM_ACCENT.primary }}>
                        {t('page.notification_centre.open_link')}
                      </button>
                    )}
                    <button type="button" onClick={() => dismiss.mutate(active.id)} disabled={dismiss.isPending} data-dismiss
                      className="text-[12px] font-semibold text-slate-500 hover:underline disabled:opacity-50">
                      {t('page.notification_centre.dismiss')}
                    </button>
                  </div>
                  <p className="font-mono text-[11px] text-slate-500" data-dismiss-note>{t('page.notification_centre.dismiss_note')}</p>
                </>
              ) : (
                <p className="text-[13px] text-slate-500">{t('page.notification_centre.select_hint')}</p>
              )}
            </aside>
          </div>
        )}
      </div>
    </div>
  )
}
