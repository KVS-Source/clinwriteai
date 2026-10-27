// Section-lock helpers (sPM-autosave).
//
// The autosave flow enters edit mode on click. Before any write is accepted,
// the editing user must hold a live lock on the section. The lock is advisory
// (not DB row locking) — it's a lease-based coordinator so two users don't
// silently clobber each other's edits.
//
// Lease rules:
//   - A lock is "live" when lastHeartbeatAt is within SECTION_LOCK_STALE_SECONDS.
//   - An acquire against a live lock held by another user → return the holder
//     (route layer turns this into 423 Locked).
//   - An acquire against a live lock held by the same user → extend the lease
//     (page refresh / another tab from the same browser never locks the user
//     out of their own section).
//   - An acquire against a stale lock → steal: delete the stale row and
//     insert a fresh one.
//
// Why not Postgres row locking: we need the lock to survive across HTTP
// requests (writer leaves one PATCH and starts the next), which an advisory
// lease represents much more naturally than any `FOR UPDATE` scheme.

import type { PrismaClient, SectionLock } from '@prisma/client'

export const SECTION_LOCK_STALE_SECONDS = 90

export interface LockHolder {
  userId:           string
  acquiredAt:       Date
  lastHeartbeatAt:  Date
  /** Seconds from now until the lock is considered stale. Clamp to >= 0. */
  expiresInSeconds: number
}

export interface AcquireResult {
  outcome: 'acquired' | 'extended' | 'stolen' | 'conflict'
  holder:  LockHolder
}

function toHolder(row: SectionLock, now: Date = new Date()): LockHolder {
  const staleAt = row.lastHeartbeatAt.getTime() + SECTION_LOCK_STALE_SECONDS * 1000
  return {
    userId:           row.userId,
    acquiredAt:       row.acquiredAt,
    lastHeartbeatAt:  row.lastHeartbeatAt,
    expiresInSeconds: Math.max(0, Math.round((staleAt - now.getTime()) / 1000)),
  }
}

export function isLive(row: SectionLock, now: Date = new Date()): boolean {
  return now.getTime() - row.lastHeartbeatAt.getTime() < SECTION_LOCK_STALE_SECONDS * 1000
}

/**
 * Acquire or extend the lock on (documentId, sectionId) for `userId`.
 * Transactional: a stale-steal + insert run atomically so two concurrent
 * acquirers can't both believe they stole.
 */
export async function acquireLock(
  prisma: PrismaClient,
  args: { documentId: string; sectionId: string; userId: string },
): Promise<AcquireResult> {
  const now = new Date()

  return prisma.$transaction(async (tx) => {
    const existing = await tx.sectionLock.findUnique({
      where: { documentId_sectionId: { documentId: args.documentId, sectionId: args.sectionId } },
    })

    if (existing && isLive(existing, now)) {
      if (existing.userId === args.userId) {
        const extended = await tx.sectionLock.update({
          where: { id: existing.id },
          data:  { lastHeartbeatAt: now },
        })
        return { outcome: 'extended' as const, holder: toHolder(extended, now) }
      }
      return { outcome: 'conflict' as const, holder: toHolder(existing, now) }
    }

    // Stale lock exists → delete it so the UNIQUE index lets us insert fresh.
    // (We can't UPDATE in place because that would preserve the id/acquiredAt
    // of the previous holder, which is semantically misleading.)
    if (existing) {
      await tx.sectionLock.delete({ where: { id: existing.id } })
    }

    const created = await tx.sectionLock.create({
      data: {
        documentId:      args.documentId,
        sectionId:       args.sectionId,
        userId:          args.userId,
        acquiredAt:      now,
        lastHeartbeatAt: now,
      },
    })
    return {
      outcome: existing ? ('stolen' as const) : ('acquired' as const),
      holder:  toHolder(created, now),
    }
  })
}

/**
 * Release the lock. No-op when the lock doesn't exist or the caller doesn't
 * hold it (unless `force` — admins releasing a stuck lock). Returns true
 * when a row was deleted.
 */
export async function releaseLock(
  prisma: PrismaClient,
  args: { documentId: string; sectionId: string; userId: string; force?: boolean },
): Promise<boolean> {
  const existing = await prisma.sectionLock.findUnique({
    where: { documentId_sectionId: { documentId: args.documentId, sectionId: args.sectionId } },
  })
  if (!existing) return false
  if (existing.userId !== args.userId && !args.force) return false
  await prisma.sectionLock.delete({ where: { id: existing.id } })
  return true
}

/**
 * Read current holder (if any live lock exists). Dead locks return null — the
 * UI treats them as "unlocked" since the next acquire will succeed.
 */
export async function getHolder(
  prisma: PrismaClient,
  args: { documentId: string; sectionId: string },
): Promise<LockHolder | null> {
  const existing = await prisma.sectionLock.findUnique({
    where: { documentId_sectionId: { documentId: args.documentId, sectionId: args.sectionId } },
  })
  if (!existing || !isLive(existing)) return null
  return toHolder(existing)
}

/**
 * Precondition for PATCH /sections. Returns the holder when the caller is
 * blocked (another user holds a live lock), null when the caller may proceed.
 * A dead lock is treated as "no lock" — PATCH is allowed, and the client
 * should re-acquire if they expect to keep writing.
 */
export async function requireLockHeldBy(
  prisma: PrismaClient,
  args: { documentId: string; sectionId: string; userId: string },
): Promise<LockHolder | null> {
  const existing = await prisma.sectionLock.findUnique({
    where: { documentId_sectionId: { documentId: args.documentId, sectionId: args.sectionId } },
  })
  if (!existing) return null
  if (!isLive(existing)) return null
  if (existing.userId === args.userId) return null
  return toHolder(existing)
}

/**
 * Snapshot of every live lock on a document, used by the editor to decorate
 * the section list ("Alice is editing §4.1"). Dead locks are excluded.
 */
export async function listDocumentLocks(
  prisma: PrismaClient,
  documentId: string,
): Promise<Array<{ sectionId: string; holder: LockHolder }>> {
  const now = new Date()
  const freshCutoff = new Date(now.getTime() - SECTION_LOCK_STALE_SECONDS * 1000)
  const rows = await prisma.sectionLock.findMany({
    where:   { documentId, lastHeartbeatAt: { gte: freshCutoff } },
    orderBy: { lastHeartbeatAt: 'desc' },
  })
  return rows.map(r => ({ sectionId: r.sectionId, holder: toHolder(r, now) }))
}
