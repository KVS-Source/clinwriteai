// Ideation artefact section-lock helpers — Module D analogue of
// MedContentSectionLock service. Same 90-second lease semantics.

import type { PrismaClient, IdeationArtefactSectionLock } from '@prisma/client'

export const IDEA_ART_LOCK_STALE_SECONDS = 90

export interface IdeaArtLockHolder {
  userId:           string
  acquiredAt:       Date
  lastHeartbeatAt:  Date
  expiresInSeconds: number
}

export interface IdeaArtAcquireResult {
  outcome: 'acquired' | 'extended' | 'stolen' | 'conflict'
  holder:  IdeaArtLockHolder
}

function toHolder(row: { userId: string; acquiredAt: Date; lastHeartbeatAt: Date }, now: Date = new Date()): IdeaArtLockHolder {
  const staleAt = row.lastHeartbeatAt.getTime() + IDEA_ART_LOCK_STALE_SECONDS * 1000
  return {
    userId:           row.userId,
    acquiredAt:       row.acquiredAt,
    lastHeartbeatAt:  row.lastHeartbeatAt,
    expiresInSeconds: Math.max(0, Math.round((staleAt - now.getTime()) / 1000)),
  }
}

function isLive(row: { lastHeartbeatAt: Date }, now: Date = new Date()): boolean {
  return now.getTime() - row.lastHeartbeatAt.getTime() < IDEA_ART_LOCK_STALE_SECONDS * 1000
}

export async function acquireIdeationArtefactSectionLock(
  prisma: PrismaClient,
  args: { ideationArtefactId: string; sectionId: string; userId: string },
): Promise<IdeaArtAcquireResult> {
  const now = new Date()
  return prisma.$transaction(async (tx) => {
    const existing = await tx.ideationArtefactSectionLock.findUnique({
      where: { ideationArtefactId_sectionId: { ideationArtefactId: args.ideationArtefactId, sectionId: args.sectionId } },
    })
    if (existing && isLive(existing, now)) {
      if (existing.userId === args.userId) {
        const extended = await tx.ideationArtefactSectionLock.update({
          where: { id: existing.id },
          data:  { lastHeartbeatAt: now },
        })
        return { outcome: 'extended' as const, holder: toHolder(extended, now) }
      }
      return { outcome: 'conflict' as const, holder: toHolder(existing, now) }
    }
    if (existing) await tx.ideationArtefactSectionLock.delete({ where: { id: existing.id } })
    const created = await tx.ideationArtefactSectionLock.create({
      data: {
        ideationArtefactId: args.ideationArtefactId,
        sectionId:            args.sectionId,
        userId:               args.userId,
        acquiredAt:           now,
        lastHeartbeatAt:      now,
      },
    })
    return { outcome: existing ? ('stolen' as const) : ('acquired' as const), holder: toHolder(created, now) }
  })
}

export async function releaseIdeationArtefactSectionLock(
  prisma: PrismaClient,
  args: { ideationArtefactId: string; sectionId: string; userId: string; force?: boolean },
): Promise<boolean> {
  const existing = await prisma.ideationArtefactSectionLock.findUnique({
    where: { ideationArtefactId_sectionId: { ideationArtefactId: args.ideationArtefactId, sectionId: args.sectionId } },
  })
  if (!existing) return false
  if (existing.userId !== args.userId && !args.force) return false
  await prisma.ideationArtefactSectionLock.delete({ where: { id: existing.id } })
  return true
}

export async function getIdeationArtefactSectionLockHolder(
  prisma: PrismaClient,
  args: { ideationArtefactId: string; sectionId: string },
): Promise<IdeaArtLockHolder | null> {
  const existing = await prisma.ideationArtefactSectionLock.findUnique({
    where: { ideationArtefactId_sectionId: { ideationArtefactId: args.ideationArtefactId, sectionId: args.sectionId } },
  })
  if (!existing || !isLive(existing)) return null
  return toHolder(existing)
}

export async function requireIdeationArtefactSectionLockHeldBy(
  prisma: PrismaClient,
  args: { ideationArtefactId: string; sectionId: string; userId: string },
): Promise<IdeaArtLockHolder | null> {
  const existing = await prisma.ideationArtefactSectionLock.findUnique({
    where: { ideationArtefactId_sectionId: { ideationArtefactId: args.ideationArtefactId, sectionId: args.sectionId } },
  })
  if (!existing) return null
  if (!isLive(existing)) return null
  if (existing.userId === args.userId) return null
  return toHolder(existing)
}

export async function listIdeationArtefactSectionLocks(
  prisma: PrismaClient,
  ideationArtefactId: string,
): Promise<Array<{ sectionId: string; holder: IdeaArtLockHolder }>> {
  const now = new Date()
  const freshCutoff = new Date(now.getTime() - IDEA_ART_LOCK_STALE_SECONDS * 1000)
  const rows = await prisma.ideationArtefactSectionLock.findMany({
    where:   { ideationArtefactId, lastHeartbeatAt: { gte: freshCutoff } },
    orderBy: { lastHeartbeatAt: 'desc' },
  })
  return rows.map((r: IdeationArtefactSectionLock) => ({ sectionId: r.sectionId, holder: toHolder(r, now) }))
}
