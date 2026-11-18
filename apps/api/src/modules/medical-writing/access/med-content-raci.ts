// Med content RACI access helpers — Phase M-C.5.
//
// Module C doesn't have a dedicated contributor table like
// PublicationAuthor, so RACI is modelled from the fields that already
// exist on MedContentItem + the surrounding reviewer tables:
//
//   - owner (MedContentItem.ownerId)        → R + A (edit, comment, resolve)
//   - MlrReviewer rows for this item        → C   (comment + resolve own)
//   - tenant-admin / admin / super-admin    → always allowed
//   - pm (project manager) scoped to proj   → edit (parity with Module B)
//   - everyone else with Module C access    → read-only
//
// This keeps the gate shape identical to Module B's helpers so the
// comment routes + section routes can call the same shape of function.

import type { PrismaClient } from '@prisma/client'
import { hasAnyRole, type AuthenticatedUser } from '../../../auth/rbac.js'

export const MED_CONTENT_EDIT_FORBIDDEN = {
  error:   'med_content_edit_forbidden',
  message: 'Only the content owner (or PM / admin) may edit this item.',
} as const

export const MED_CONTENT_COMMENT_FORBIDDEN = {
  error:   'med_content_comment_forbidden',
  message: 'Only the owner, MLR reviewers, scoped PM, or admin may comment on this item.',
} as const

async function pmHasProjectAccess(
  prisma: PrismaClient,
  actor: AuthenticatedUser,
  projectId: string,
): Promise<boolean> {
  if (!hasAnyRole(actor, 'pm')) return false
  const member = await prisma.projectMember.findFirst({
    where:  { projectId, userId: actor.id },
    select: { id: true },
  })
  return member !== null
}

async function actorIsMlrReviewer(
  prisma: PrismaClient,
  actor: AuthenticatedUser,
  contentItemId: string,
): Promise<boolean> {
  const row = await prisma.mlrReviewer.findFirst({
    where:  { contentItemId, userId: actor.id },
    select: { id: true },
  })
  return row !== null
}

/** Who may change med content (section HTML, locks, AI draft trigger,
 *  section rewrite): owner, admins, scoped PM. Everyone else false. */
export async function actorCanEditMedContent(
  prisma: PrismaClient,
  actor: AuthenticatedUser,
  contentItemId: string,
): Promise<boolean> {
  if (hasAnyRole(actor, 'tenant-admin', 'admin', 'super-admin')) return true

  const item = await prisma.medContentItem.findUnique({
    where:  { id: contentItemId },
    select: { ownerId: true, projectId: true },
  })
  if (!item) return false

  if (item.ownerId === actor.id) return true
  if (await pmHasProjectAccess(prisma, actor, item.projectId)) return true

  return false
}

/** Who may add a comment on the item: owner + MLR reviewers + admin +
 *  scoped PM. Readers (auditor / read-only / guest) cannot. */
export async function actorCanCommentOnMedContent(
  prisma: PrismaClient,
  actor: AuthenticatedUser,
  contentItemId: string,
): Promise<boolean> {
  if (hasAnyRole(actor, 'tenant-admin', 'admin', 'super-admin')) return true

  const item = await prisma.medContentItem.findUnique({
    where:  { id: contentItemId },
    select: { ownerId: true, projectId: true },
  })
  if (!item) return false

  if (item.ownerId === actor.id) return true
  if (await pmHasProjectAccess(prisma, actor, item.projectId)) return true
  if (await actorIsMlrReviewer(prisma, actor, contentItemId)) return true

  return false
}

/** Slide-level edit gate. Slides live under MedSlideDeckJob which
 *  points to a contentItemId; delegate to actorCanEditMedContent. */
export async function actorCanEditMedSlide(
  prisma: PrismaClient,
  actor: AuthenticatedUser,
  slideId: string,
): Promise<{ allowed: boolean; contentItemId: string | null; deckJobId: string | null }> {
  const slide = await prisma.medSlide.findUnique({
    where:  { id: slideId },
    select: { deckJobId: true },
  })
  if (!slide) return { allowed: false, contentItemId: null, deckJobId: null }

  const deck = await prisma.medSlideDeckJob.findUnique({
    where:  { id: slide.deckJobId },
    select: { contentItemId: true },
  })
  if (!deck) return { allowed: false, contentItemId: null, deckJobId: slide.deckJobId }

  const allowed = await actorCanEditMedContent(prisma, actor, deck.contentItemId)
  return { allowed, contentItemId: deck.contentItemId, deckJobId: slide.deckJobId }
}

/** Slide-level comment gate — same delegation. */
export async function actorCanCommentOnMedSlide(
  prisma: PrismaClient,
  actor: AuthenticatedUser,
  slideId: string,
): Promise<{ allowed: boolean; contentItemId: string | null; deckJobId: string | null }> {
  const slide = await prisma.medSlide.findUnique({
    where:  { id: slideId },
    select: { deckJobId: true },
  })
  if (!slide) return { allowed: false, contentItemId: null, deckJobId: null }

  const deck = await prisma.medSlideDeckJob.findUnique({
    where:  { id: slide.deckJobId },
    select: { contentItemId: true },
  })
  if (!deck) return { allowed: false, contentItemId: null, deckJobId: slide.deckJobId }

  const allowed = await actorCanCommentOnMedContent(prisma, actor, deck.contentItemId)
  return { allowed, contentItemId: deck.contentItemId, deckJobId: slide.deckJobId }
}
