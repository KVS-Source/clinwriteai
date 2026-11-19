// Automatic ICH sync: keeps the framework registry in step with www.ich.org/page/ich-guidelines without anyone
// pressing "Sync from ICH".
//
// How it runs: an in-process timer (same pattern as the compliance gauge scheduler) checks once a day. If the last
// ICH sync, manual or automatic, is 30 days old or more, it runs the same sync as the button (./ich-sync.ts) and records
// it in the audit trail as `frameworks_synced_from_ich` with actor 'system' and trigger 'automatic'. "Last sync" is
// read from the audit trail, so API restarts (e.g. dev --watch) never cause extra syncs, and a manual sync resets the
// clock. If ich.org cannot be reached, nothing is changed and the next daily check tries again.
//
// After an automatic sync every active Project Manager gets an in-app notification ('ich_frameworks_synced') saying
// what changed and when the next sync is due. A failed sync notifies no one (it retries the next day).
//
// On in production (ICH_AUTO_SYNC=off to stop it); on a dev machine only with ICH_AUTO_SYNC=on; never under tests.

import { syncIchGuidelines, type IchSyncResult } from './ich-sync.js'

export const ICH_SYNC_ACTION = 'frameworks_synced_from_ich'
export const ICH_AUTO_SYNC_ACTOR = 'system'
export const ICH_AUTO_SYNC_EVERY_DAYS = 30
const DAY_MS = 24 * 60 * 60 * 1000
export const ICH_AUTO_SYNC_MAX_AGE_MS = ICH_AUTO_SYNC_EVERY_DAYS * DAY_MS   // sync when the last one is 30 days old
export const ICH_AUTO_SYNC_CHECK_MS = DAY_MS                                  // look once a day
const FIRST_CHECK_DELAY_MS = 60 * 1000                         // let the API finish starting first

export type IchSyncTrigger = 'manual' | 'automatic'

// What goes in the audit event for every ICH sync (the button and the timer write the same shape).
export const ichSyncAuditDetails = (r: IchSyncResult, trigger: IchSyncTrigger) => ({
  trigger,
  fetched: r.fetched, created: r.created.length, updated: r.updated.length, unchanged: r.unchanged,
  withdrawn: r.withdrawn, skipped: r.skipped.length,
})

interface RawQuery { $queryRawUnsafe: <T>(sql: string, ...args: unknown[]) => Promise<T> }

export interface LastIchSync { at: Date; trigger: IchSyncTrigger; actorId: string }

// The newest ICH sync in the audit trail, or null if there has never been one.
export async function lastIchSync(prisma: RawQuery): Promise<LastIchSync | null> {
  const rows = await prisma.$queryRawUnsafe<Array<{ timestamp: Date | string; actor_id: string; details: unknown }>>(
    `SELECT "timestamp", actor_id, details FROM audit_events WHERE action = $1 ORDER BY id DESC LIMIT 1`,
    ICH_SYNC_ACTION,
  )
  const row = rows[0]
  if (!row) return null
  const details = (typeof row.details === 'string' ? JSON.parse(row.details) : row.details) as { trigger?: string } | null
  return {
    at:      new Date(row.timestamp),
    trigger: details?.trigger === 'automatic' || row.actor_id === ICH_AUTO_SYNC_ACTOR ? 'automatic' : 'manual',
    actorId: row.actor_id,
  }
}

// On by default in production; on a developer machine only with ICH_AUTO_SYNC=on (dev APIs share one database, so
// every running laptop would otherwise sync it); never under tests. ICH_AUTO_SYNC=off turns it off anywhere.
export const ichAutoSyncEnabled = (env: { NODE_ENV?: string; ICH_AUTO_SYNC?: string }) => {
  if (env.NODE_ENV === 'test') return false
  const flag = (env.ICH_AUTO_SYNC ?? '').toLowerCase()
  if (flag === 'off') return false
  return flag === 'on' || env.NODE_ENV === 'production'
}

export interface IchAutoSyncOptions {
  prisma:  RawQuery & Parameters<typeof syncIchGuidelines>[0]
  audit:   { append: (e: Record<string, unknown>) => Promise<unknown> }
  logger:  { info: (...a: unknown[]) => void; warn: (...a: unknown[]) => void }
  sync?:   typeof syncIchGuidelines        // swapped in tests
  now?:    () => Date
  checkMs?: number
  maxAgeMs?: number
  // Tells the Project Managers about a finished automatic sync (./ich-auto-sync-plugin.ts wires it to notifications).
  notify?: (n: IchSyncNotice) => Promise<unknown>
}

export const ICH_SYNC_NOTIFICATION_KIND = 'ich_frameworks_synced'
export interface IchSyncNotice { title: string; body: string }

// What the Project Managers are told after an automatic sync.
export function ichSyncNotice(result: IchSyncResult, now: Date): IchSyncNotice {
  const names = (list: string[]) => list.length > 5 ? `${list.slice(0, 5).join(', ')} and ${list.length - 5} more` : list.join(', ')
  const parts = [
    result.created.length ? `${result.created.length} new (${names(result.created)})` : null,
    result.updated.length ? `${result.updated.length} updated (${names(result.updated)})` : null,
    result.withdrawn.length ? `${result.withdrawn.length} withdrawn (${names(result.withdrawn)})` : null,
  ].filter(Boolean)
  const next = new Date(now.getTime() + ICH_AUTO_SYNC_MAX_AGE_MS).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
  return {
    title: parts.length ? 'ICH frameworks updated' : 'ICH frameworks checked: no changes',
    body: `The automatic ${ICH_AUTO_SYNC_EVERY_DAYS}-day sync from ICH ran. `
      + (parts.length ? `Guidelines: ${parts.join('; ')}. Review their scope in the framework registry.` : 'No guidelines were added, changed or withdrawn.')
      + ` Next automatic sync around ${next}.`,
  }
}

// Every active user holding the Project Manager role, as primary or additional role.
export async function activeProjectManagerIds(prisma: { user: { findMany(a: unknown): Promise<Array<{ id: string }>> } }): Promise<string[]> {
  const rows = await prisma.user.findMany({
    where: { status: 'active', OR: [{ role: 'pm' }, { additionalRoles: { has: 'pm' } }] },
    select: { id: true },
  })
  return rows.map(r => r.id)
}

export class IchAutoSync {
  private timer: ReturnType<typeof setInterval> | null = null
  private first: ReturnType<typeof setTimeout> | null = null
  private running = false

  constructor(private readonly o: IchAutoSyncOptions) {}

  start(): void {
    if (this.timer) return
    const first = setTimeout(() => void this.tick(), FIRST_CHECK_DELAY_MS)
    const timer = setInterval(() => void this.tick(), this.o.checkMs ?? ICH_AUTO_SYNC_CHECK_MS)
    // Don't keep the process alive just for this.
    ;(first as { unref?: () => void }).unref?.(); (timer as { unref?: () => void }).unref?.()
    this.first = first; this.timer = timer
  }

  stop(): void {
    if (this.first) clearTimeout(this.first)
    if (this.timer) clearInterval(this.timer)
    this.first = this.timer = null
  }

  // One check. Returns what it did, for logs and tests.
  async tick(): Promise<'synced' | 'not_due' | 'failed' | 'busy'> {
    if (this.running) return 'busy'
    this.running = true
    try {
      const now = (this.o.now ?? (() => new Date()))()
      const last = await lastIchSync(this.o.prisma)
      if (last && now.getTime() - last.at.getTime() < (this.o.maxAgeMs ?? ICH_AUTO_SYNC_MAX_AGE_MS)) return 'not_due'
      let result: IchSyncResult
      try {
        result = await (this.o.sync ?? syncIchGuidelines)(this.o.prisma, ICH_AUTO_SYNC_ACTOR)
      } catch (err) {
        this.o.logger.warn({ err }, 'Automatic ICH sync: could not reach ich.org; nothing changed, will retry tomorrow')
        return 'failed'
      }
      await this.o.audit.append({
        timestamp:  now.toISOString(),
        actorId:    ICH_AUTO_SYNC_ACTOR,
        action:     ICH_SYNC_ACTION,
        entityType: 'regulatory_framework',
        entityId:   'ich',
        details:    ichSyncAuditDetails(result, 'automatic'),
        ipAddress:  null,
      })
      this.o.logger.info({ created: result.created, updated: result.updated, withdrawn: result.withdrawn }, 'Automatic ICH sync done')
      // The sync is done and recorded; a notification problem must not undo or repeat it.
      if (this.o.notify) {
        try { await this.o.notify(ichSyncNotice(result, now)) }
        catch (err) { this.o.logger.warn({ err }, 'Automatic ICH sync: could not notify the Project Managers') }
      }
      return 'synced'
    } catch (err) {
      this.o.logger.warn({ err }, 'Automatic ICH sync check failed')
      return 'failed'
    } finally {
      this.running = false
    }
  }
}
