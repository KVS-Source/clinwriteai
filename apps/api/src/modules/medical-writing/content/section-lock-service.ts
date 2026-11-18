// Med content section-lock + slide-lock helpers — Module C analogue
// of PublicationSectionLock service. Same 90-second lease semantics.
//
// Two separate tables because slides live on a different parent
// (MedSlideDeckJob) from sections (MedContentVersion).

import type { PrismaClient, MedContentSectionLock, MedSlideLock } from '@prisma/client'

export const MED_CONTENT_LOCK_STALE_SECONDS = 90

export interface MedLockHolder {
  userId:           string
  acquiredAt:       Date
  lastHeartbeatAt:  Date
  expiresInSeconds: number
}

export interface MedAcquireResult {
  outcome: 'acquired' | 'extended' | 'stolen' | 'conflict'
  holder:  MedLockHolder
}

function toHolder(row: { userId: string; acquiredAt: Date; lastHeartbeatAt: Date }, now: Date = new Date()): MedLockHolder {
  const staleAt = row.lastHeartbeatAt.getTime() + MED_CONTENT_LOCK_STALE_SECONDS * 1000
  return {
    userId:           row.userId,
    acquiredAt:       row.acquiredAt,
    lastHeartbeatAt:  row.lastHeartbeatAt,
    expiresInSeconds: Math.max(0, Math.round((staleAt - now.getTime()) / 1000)),
  }
}

function isLive(row: { lastHeartbeatAt: Date }, now: Date = new Date()): boolean {
  return now.getTime() - row.lastHeartbeatAt.getTime() < MED_CONTENT_LOCK_STALE_SECONDS * 1000
}

// -------- Section locks --------------------------------------------------
export async function acquireMedContentSectionLock(
  prisma: PrismaClient,
  args: { contentItemId: string; sectionId: string; userId: string },
): Promise<MedAcquireResult> {
  const now = new Date()
  return prisma.$transaction(async (tx) => {
    const existing = await tx.medContentSectionLock.findUnique({
      where: { contentItemId_sectionId: { contentItemId: args.contentItemId, sectionId: args.sectionId } },
    })
    if (existing && isLive(existing, now)) {
      if (existing.userId === args.userId) {
        const extended = await tx.medContentSectionLock.update({
          where: { id: existing.id },
          data:  { lastHeartbeatAt: now },
        })
        return { outcome: 'extended' as const, holder: toHolder(extended, now) }
      }
      return { outcome: 'conflict' as const, holder: toHolder(existing, now) }
    }
    if (existing) await tx.medContentSectionLock.delete({ where: { id: existing.id } })
    const created = await tx.medContentSectionLock.create({
      data: {
        contentItemId:   args.contentItemId,
        sectionId:       args.sectionId,
        userId:          args.userId,
        acquiredAt:      now,
        lastHeartbeatAt: now,
      },
    })
    return { outcome: existing ? ('stolen' as const) : ('acquired' as const), holder: toHolder(created, now) }
  })
}

export async function releaseMedContentSectionLock(
  prisma: PrismaClient,
  args: { contentItemId: string; sectionId: string; userId: string; force?: boolean },
): Promise<boolean> {
  const existing = await prisma.medContentSectionLock.findUnique({
    where: { contentItemId_sectionId: { contentItemId: args.contentItemId, sectionId: args.sectionId } },
  })
  if (!existing) return false
  if (existing.userId !== args.userId && !args.force) return false
  await prisma.medContentSectionLock.delete({ where: { id: existing.id } })
  return true
}

export async function getMedContentSectionLockHolder(
  prisma: PrismaClient,
  args: { contentItemId: string; sectionId: string },
): Promise<MedLockHolder | null> {
  const existing = await prisma.medContentSectionLock.findUnique({
    where: { contentItemId_sectionId: { contentItemId: args.contentItemId, sectionId: args.sectionId } },
  })
  if (!existing || !isLive(existing)) return null
  return toHolder(existing)
}

export async function requireMedContentSectionLockHeldBy(
  prisma: PrismaClient,
  args: { contentItemId: string; sectionId: string; userId: string },
): Promise<MedLockHolder | null> {
  const existing = await prisma.medContentSectionLock.findUnique({
    where: { contentItemId_sectionId: { contentItemId: args.contentItemId, sectionId: args.sectionId } },
  })
  if (!existing) return null
  if (!isLive(existing)) return null
  if (existing.userId === args.userId) return null
  return toHolder(existing)
}

export async function listMedContentSectionLocks(
  prisma: PrismaClient,
  contentItemId: string,
): Promise<Array<{ sectionId: string; holder: MedLockHolder }>> {
  const now = new Date()
  const freshCutoff = new Date(now.getTime() - MED_CONTENT_LOCK_STALE_SECONDS * 1000)
  const rows = await prisma.medContentSectionLock.findMany({
    where:   { contentItemId, lastHeartbeatAt: { gte: freshCutoff } },
    orderBy: { lastHeartbeatAt: 'desc' },
  })
  return rows.map((r: MedContentSectionLock) => ({ sectionId: r.sectionId, holder: toHolder(r, now) }))
}

// -------- Slide locks ----------------------------------------------------
export async function acquireMedSlideLock(
  prisma: PrismaClient,
  args: { slideId: string; userId: string },
): Promise<MedAcquireResult> {
  const now = new Date()
  return prisma.$transaction(async (tx) => {
    const existing = await tx.medSlideLock.findUnique({ where: { slideId: args.slideId } })
    if (existing && isLive(existing, now)) {
      if (existing.userId === args.userId) {
        const extended = await tx.medSlideLock.update({
          where: { id: existing.id }, data: { lastHeartbeatAt: now },
        })
        return { outcome: 'extended' as const, holder: toHolder(extended, now) }
      }
      return { outcome: 'conflict' as const, holder: toHolder(existing, now) }
    }
    if (existing) await tx.medSlideLock.delete({ where: { id: existing.id } })
    const created = await tx.medSlideLock.create({
      data: {
        slideId:         args.slideId,
        userId:          args.userId,
        acquiredAt:      now,
        lastHeartbeatAt: now,
      },
    })
    return { outcome: existing ? ('stolen' as const) : ('acquired' as const), holder: toHolder(created, now) }
  })
}

export async function releaseMedSlideLock(
  prisma: PrismaClient,
  args: { slideId: string; userId: string; force?: boolean },
): Promise<boolean> {
  const existing = await prisma.medSlideLock.findUnique({ where: { slideId: args.slideId } })
  if (!existing) return false
  if (existing.userId !== args.userId && !args.force) return false
  await prisma.medSlideLock.delete({ where: { id: existing.id } })
  return true
}

export async function listMedSlideLocks(
  prisma: PrismaClient,
  deckJobId: string,
): Promise<Array<{ slideId: string; holder: MedLockHolder }>> {
  const now = new Date()
  const freshCutoff = new Date(now.getTime() - MED_CONTENT_LOCK_STALE_SECONDS * 1000)
  const slides = await prisma.medSlide.findMany({
    where:  { deckJobId },
    select: { id: true },
  })
  const slideIds = slides.map(s => s.id)
  if (slideIds.length === 0) return []
  const rows = await prisma.medSlideLock.findMany({
    where:   { slideId: { in: slideIds }, lastHeartbeatAt: { gte: freshCutoff } },
    orderBy: { lastHeartbeatAt: 'desc' },
  })
  return rows.map((r: MedSlideLock) => ({ slideId: r.slideId, holder: toHolder(r, now) }))
}
