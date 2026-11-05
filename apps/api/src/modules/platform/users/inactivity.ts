// Inactivity sweep — warn, then suspend, accounts nobody has signed in to.
//
//   day 25 of inactivity  → one warning (in-app + email): sign in by <date> or
//                           the account is suspended on <date>.
//   day 30 of inactivity  → the account is suspended (status 'suspended',
//                           sessions revoked, audited as user.suspend with
//                           reason 'inactivity'), and the user is told by email.
//
// Suspension never comes sooner than 5 days after the warning, so an account
// that was already long inactive when this shipped still gets the full notice.
//
// The inactivity clock starts at the latest of: the last sign-in (lastActiveAt,
// stamped by password and SSO sign-in), registration (termsAcceptedAt),
// account creation, and the last time an admin unsuspended the account — so an
// unsuspended user isn't suspended again the next night. Signing in resets it,
// which also voids an earlier warning (only warnings after the clock started count).
//
// Admin roles are left out so a tenant can't lose its own administrators to the
// sweep. Safe to run repeatedly: a warning is sent once per inactive spell, and
// only accounts still 'active' are suspended.

import type { PrismaClient } from '@prisma/client'

export const INACTIVITY_SUSPEND_DAYS = 30
export const INACTIVITY_WARNING_LEAD_DAYS = 5
export const INACTIVITY_WARNING_KIND = 'account.inactivity_warning'
export const INACTIVITY_SUSPENDED_KIND = 'account.inactivity_suspended'
export const INACTIVITY_ACTOR = 'system:inactivity'

const DAY = 86_400_000
const EXEMPT_ROLES = ['tenant-admin', 'admin', 'super-admin']

export interface InactivityDeps {
  prisma: PrismaClient
  audit: { append: (e: {
    timestamp: string; actorId: string; action: string; entityType: string; entityId: string
    details: Record<string, unknown>; ipAddress: string | null
  }) => Promise<unknown> }
  notifications: { send: (args: {
    recipientId: string; kind: string; severity?: 'info' | 'warning' | 'critical'; title: string; body: string
    linkPath?: string; channels?: Array<'in_app' | 'email' | 'sms'>; payload?: Record<string, unknown>
  }) => Promise<unknown> }
}

const day = (d: Date) => d.toISOString().slice(0, 10)
const maxDate = (...ds: Array<Date | null | undefined>) =>
  new Date(Math.max(...ds.filter((d): d is Date => !!d).map(d => d.getTime())))

export async function runInactivitySweep(deps: InactivityDeps, now: Date = new Date()): Promise<{ warned: string[]; suspended: string[] }> {
  const { prisma } = deps
  const warnAfter = (INACTIVITY_SUSPEND_DAYS - INACTIVITY_WARNING_LEAD_DAYS) * DAY

  const users = await prisma.user.findMany({
    where: { status: 'active', role: { notIn: EXEMPT_ROLES } },
    select: { id: true, email: true, name: true, lastActiveAt: true, termsAcceptedAt: true, createdAt: true },
  })
  if (users.length === 0) return { warned: [], suspended: [] }

  // Last unsuspend per user (audit_events isn't modelled in Prisma).
  const ids = users.map(u => u.id)
  const reactivations = await prisma.$queryRawUnsafe<Array<{ entity_id: string; at: Date }>>(
    `SELECT entity_id, MAX("timestamp") AS at FROM audit_events
     WHERE action = 'user.reactivate' AND entity_type = 'user' AND entity_id = ANY($1::text[])
     GROUP BY entity_id`,
    ids,
  )
  const reactivatedAt = new Map(reactivations.map(r => [r.entity_id, new Date(r.at)]))

  const warned: string[] = []
  const suspended: string[] = []

  for (const u of users) {
    const clockStart = maxDate(u.lastActiveAt, u.termsAcceptedAt, u.createdAt, reactivatedAt.get(u.id))
    if (now.getTime() - clockStart.getTime() < warnAfter) continue

    const warning = await prisma.notification.findFirst({
      where: { recipientId: u.id, kind: INACTIVITY_WARNING_KIND, createdAt: { gte: clockStart } },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    })

    if (!warning) {
      const suspendOn = maxDate(new Date(clockStart.getTime() + INACTIVITY_SUSPEND_DAYS * DAY), new Date(now.getTime() + INACTIVITY_WARNING_LEAD_DAYS * DAY))
      await deps.notifications.send({
        recipientId: u.id,
        kind:        INACTIVITY_WARNING_KIND,
        severity:    'warning',
        title:       'Sign in to keep your ClinWrite.AI account active',
        body:
          `Hello ${u.name},\n\n` +
          `You haven't signed in to ClinWrite.AI since ${day(clockStart)}. ` +
          `Please sign in before ${day(suspendOn)}, or your account will be suspended on that date.\n\n` +
          `Signing in keeps your account active. If it is suspended, contact your administrator to restore access.`,
        linkPath:    '/sign-in',
        channels:    ['in_app', 'email'],
        payload:     { suspendOn: suspendOn.toISOString(), inactiveSince: clockStart.toISOString() },
      })
      await deps.audit.append({
        timestamp: now.toISOString(), actorId: INACTIVITY_ACTOR, action: 'user.inactivity_warning',
        entityType: 'user', entityId: u.id,
        details: { email: u.email, inactiveSince: clockStart.toISOString(), suspendOn: suspendOn.toISOString() },
        ipAddress: null,
      })
      warned.push(u.id)
      continue
    }

    const suspendAt = maxDate(new Date(clockStart.getTime() + INACTIVITY_SUSPEND_DAYS * DAY), new Date(warning.createdAt.getTime() + INACTIVITY_WARNING_LEAD_DAYS * DAY))
    if (now < suspendAt) continue

    // Same effect as an admin's Suspend: status + every live session revoked.
    const [changed] = await prisma.$transaction([
      prisma.user.updateMany({ where: { id: u.id, status: 'active' }, data: { status: 'suspended' } }),
      prisma.session.updateMany({ where: { userId: u.id, revokedAt: null }, data: { revokedAt: now } }),
    ])
    if (changed.count === 0) continue        // signed in / changed meanwhile

    await deps.audit.append({
      timestamp: now.toISOString(), actorId: INACTIVITY_ACTOR, action: 'user.suspend',
      entityType: 'user', entityId: u.id,
      details: { email: u.email, reason: 'inactivity', inactiveSince: clockStart.toISOString(), warnedAt: warning.createdAt.toISOString() },
      ipAddress: null,
    })
    await deps.notifications.send({
      recipientId: u.id,
      kind:        INACTIVITY_SUSPENDED_KIND,
      severity:    'critical',
      title:       'Your ClinWrite.AI account has been suspended',
      body:
        `Hello ${u.name},\n\n` +
        `Your ClinWrite.AI account was suspended on ${day(now)} because nobody had signed in to it since ${day(clockStart)}. ` +
        `Contact your administrator to have it restored.`,
      channels:    ['in_app', 'email'],
      payload:     { inactiveSince: clockStart.toISOString() },
    })
    suspended.push(u.id)
  }

  return { warned, suspended }
}
