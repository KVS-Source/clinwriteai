// Regulatory document section-lock helpers — Module D analogue of
// MedContentSectionLock service. Same 90-second lease semantics.

import type { PrismaClient, RegulatoryDocumentSectionLock } from '@prisma/client'

export const REG_DOC_LOCK_STALE_SECONDS = 90

export interface RegDocLockHolder {
  userId:           string
  acquiredAt:       Date
  lastHeartbeatAt:  Date
  expiresInSeconds: number
}

export interface RegDocAcquireResult {
  outcome: 'acquired' | 'extended' | 'stolen' | 'conflict'
  holder:  RegDocLockHolder
}

function toHolder(row: { userId: string; acquiredAt: Date; lastHeartbeatAt: Date }, now: Date = new Date()): RegDocLockHolder {
  const staleAt = row.lastHeartbeatAt.getTime() + REG_DOC_LOCK_STALE_SECONDS * 1000
  return {
    userId:           row.userId,
    acquiredAt:       row.acquiredAt,
    lastHeartbeatAt:  row.lastHeartbeatAt,
    expiresInSeconds: Math.max(0, Math.round((staleAt - now.getTime()) / 1000)),
  }
}

function isLive(row: { lastHeartbeatAt: Date }, now: Date = new Date()): boolean {
  return now.getTime() - row.lastHeartbeatAt.getTime() < REG_DOC_LOCK_STALE_SECONDS * 1000
}

export async function acquireRegularoryDocumentSectionLock(
  prisma: PrismaClient,
  args: { regulatoryDocumentId: string; sectionId: string; userId: string },
): Promise<RegDocAcquireResult> {
  const now = new Date()
  return prisma.$transaction(async (tx) => {
    const existing = await tx.regulatoryDocumentSectionLock.findUnique({
      where: { regulatoryDocumentId_sectionId: { regulatoryDocumentId: args.regulatoryDocumentId, sectionId: args.sectionId } },
    })
    if (existing && isLive(existing, now)) {
      if (existing.userId === args.userId) {
        const extended = await tx.regulatoryDocumentSectionLock.update({
          where: { id: existing.id },
          data:  { lastHeartbeatAt: now },
        })
        return { outcome: 'extended' as const, holder: toHolder(extended, now) }
      }
      return { outcome: 'conflict' as const, holder: toHolder(existing, now) }
    }
    if (existing) await tx.regulatoryDocumentSectionLock.delete({ where: { id: existing.id } })
    const created = await tx.regulatoryDocumentSectionLock.create({
      data: {
        regulatoryDocumentId: args.regulatoryDocumentId,
        sectionId:            args.sectionId,
        userId:               args.userId,
        acquiredAt:           now,
        lastHeartbeatAt:      now,
      },
    })
    return { outcome: existing ? ('stolen' as const) : ('acquired' as const), holder: toHolder(created, now) }
  })
}

export async function releaseRegulatoryDocumentSectionLock(
  prisma: PrismaClient,
  args: { regulatoryDocumentId: string; sectionId: string; userId: string; force?: boolean },
): Promise<boolean> {
  const existing = await prisma.regulatoryDocumentSectionLock.findUnique({
    where: { regulatoryDocumentId_sectionId: { regulatoryDocumentId: args.regulatoryDocumentId, sectionId: args.sectionId } },
  })
  if (!existing) return false
  if (existing.userId !== args.userId && !args.force) return false
  await prisma.regulatoryDocumentSectionLock.delete({ where: { id: existing.id } })
  return true
}

export async function getRegulatoryDocumentSectionLockHolder(
  prisma: PrismaClient,
  args: { regulatoryDocumentId: string; sectionId: string },
): Promise<RegDocLockHolder | null> {
  const existing = await prisma.regulatoryDocumentSectionLock.findUnique({
    where: { regulatoryDocumentId_sectionId: { regulatoryDocumentId: args.regulatoryDocumentId, sectionId: args.sectionId } },
  })
  if (!existing || !isLive(existing)) return null
  return toHolder(existing)
}

export async function requireRegulatoryDocumentSectionLockHeldBy(
  prisma: PrismaClient,
  args: { regulatoryDocumentId: string; sectionId: string; userId: string },
): Promise<RegDocLockHolder | null> {
  const existing = await prisma.regulatoryDocumentSectionLock.findUnique({
    where: { regulatoryDocumentId_sectionId: { regulatoryDocumentId: args.regulatoryDocumentId, sectionId: args.sectionId } },
  })
  if (!existing) return null
  if (!isLive(existing)) return null
  if (existing.userId === args.userId) return null
  return toHolder(existing)
}

export async function listRegulatoryDocumentSectionLocks(
  prisma: PrismaClient,
  regulatoryDocumentId: string,
): Promise<Array<{ sectionId: string; holder: RegDocLockHolder }>> {
  const now = new Date()
  const freshCutoff = new Date(now.getTime() - REG_DOC_LOCK_STALE_SECONDS * 1000)
  const rows = await prisma.regulatoryDocumentSectionLock.findMany({
    where:   { regulatoryDocumentId, lastHeartbeatAt: { gte: freshCutoff } },
    orderBy: { lastHeartbeatAt: 'desc' },
  })
  return rows.map((r: RegulatoryDocumentSectionLock) => ({ sectionId: r.sectionId, holder: toHolder(r, now) }))
}
