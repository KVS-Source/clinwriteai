// Publication section-lock helpers — Module B analogue of
// clinical-writing/section-locks/service.ts. Same lease semantics, same
// stale threshold. Separate table (publication_section_locks) so
// Module A locks and Module B locks don't share a unique index.

import type { PrismaClient, PublicationSectionLock } from '@prisma/client'

export const PUBLICATION_LOCK_STALE_SECONDS = 90

export interface PublicationLockHolder {
  userId:           string
  acquiredAt:       Date
  lastHeartbeatAt:  Date
  expiresInSeconds: number
}

export interface PublicationAcquireResult {
  outcome: 'acquired' | 'extended' | 'stolen' | 'conflict'
  holder:  PublicationLockHolder
}

function toHolder(row: PublicationSectionLock, now: Date = new Date()): PublicationLockHolder {
  const staleAt = row.lastHeartbeatAt.getTime() + PUBLICATION_LOCK_STALE_SECONDS * 1000
  return {
    userId:           row.userId,
    acquiredAt:       row.acquiredAt,
    lastHeartbeatAt:  row.lastHeartbeatAt,
    expiresInSeconds: Math.max(0, Math.round((staleAt - now.getTime()) / 1000)),
  }
}

export function isLive(row: PublicationSectionLock, now: Date = new Date()): boolean {
  return now.getTime() - row.lastHeartbeatAt.getTime() < PUBLICATION_LOCK_STALE_SECONDS * 1000
}

export async function acquirePublicationLock(
  prisma: PrismaClient,
  args: { publicationId: string; sectionId: string; userId: string },
): Promise<PublicationAcquireResult> {
  const now = new Date()
  return prisma.$transaction(async (tx) => {
    const existing = await tx.publicationSectionLock.findUnique({
      where: { publicationId_sectionId: { publicationId: args.publicationId, sectionId: args.sectionId } },
    })
    if (existing && isLive(existing, now)) {
      if (existing.userId === args.userId) {
        const extended = await tx.publicationSectionLock.update({
          where: { id: existing.id },
          data:  { lastHeartbeatAt: now },
        })
        return { outcome: 'extended' as const, holder: toHolder(extended, now) }
      }
      return { outcome: 'conflict' as const, holder: toHolder(existing, now) }
    }
    if (existing) {
      await tx.publicationSectionLock.delete({ where: { id: existing.id } })
    }
    const created = await tx.publicationSectionLock.create({
      data: {
        publicationId:   args.publicationId,
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

export async function releasePublicationLock(
  prisma: PrismaClient,
  args: { publicationId: string; sectionId: string; userId: string; force?: boolean },
): Promise<boolean> {
  const existing = await prisma.publicationSectionLock.findUnique({
    where: { publicationId_sectionId: { publicationId: args.publicationId, sectionId: args.sectionId } },
  })
  if (!existing) return false
  if (existing.userId !== args.userId && !args.force) return false
  await prisma.publicationSectionLock.delete({ where: { id: existing.id } })
  return true
}

export async function getPublicationLockHolder(
  prisma: PrismaClient,
  args: { publicationId: string; sectionId: string },
): Promise<PublicationLockHolder | null> {
  const existing = await prisma.publicationSectionLock.findUnique({
    where: { publicationId_sectionId: { publicationId: args.publicationId, sectionId: args.sectionId } },
  })
  if (!existing || !isLive(existing)) return null
  return toHolder(existing)
}

/** Precondition for PATCH section content. Returns the holder when the
 *  caller is blocked (another user holds a live lock), null when the
 *  caller may proceed (no lock, stale lock, or own lock). */
export async function requirePublicationLockHeldBy(
  prisma: PrismaClient,
  args: { publicationId: string; sectionId: string; userId: string },
): Promise<PublicationLockHolder | null> {
  const existing = await prisma.publicationSectionLock.findUnique({
    where: { publicationId_sectionId: { publicationId: args.publicationId, sectionId: args.sectionId } },
  })
  if (!existing) return null
  if (!isLive(existing)) return null
  if (existing.userId === args.userId) return null
  return toHolder(existing)
}

export async function listPublicationLocks(
  prisma: PrismaClient,
  publicationId: string,
): Promise<Array<{ sectionId: string; holder: PublicationLockHolder }>> {
  const now = new Date()
  const freshCutoff = new Date(now.getTime() - PUBLICATION_LOCK_STALE_SECONDS * 1000)
  const rows = await prisma.publicationSectionLock.findMany({
    where:   { publicationId, lastHeartbeatAt: { gte: freshCutoff } },
    orderBy: { lastHeartbeatAt: 'desc' },
  })
  return rows.map(r => ({ sectionId: r.sectionId, holder: toHolder(r, now) }))
}
