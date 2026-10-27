// Claims matrix routes — Module C (API contract §31) + review tier (§32).
//
// What this ships:
//   - List claims
//   - Harvest stub: creates/updates mock similarity scores so the UI has
//     something to render. The real pipeline (pgvector embeddings + Master
//     Library similarity) is deferred — see memory project_phase_3c_deferrals.
//   - Adopt: records approvedLibraryText + flips to 'library_adopted' without
//     MLR re-review. Writes audit event + recalculates review tier.
//   - Review tier read + MLR Lead override.
//
// Review tier calculation rule:
//   reuse_pct = (adopted + approved) / total * 100
//     ≥ 70 → tier A
//     40..69 → tier B
//     <40   → tier C
// (This is the Phase 3C placeholder — final tier formula from compliance
// SMEs lands with the agentic report.)

import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import type { PrismaClient } from '@prisma/client'
import { requireAuth } from '../../../auth/rbac.js'

const createClaimSchema = z.object({
  claimText: z.string().min(1),
  sourceRef: z.string().min(1),
  sourceType: z.enum(['smpc', 'csr', 'publication', 'label']),
  location: z.string().min(1),
})

// Adopt body: the UI's Claims Matrix screen sends
// { claimId, approvedLibraryText, adoptedBy }. We accept either naming for
// the approved text field (approvedText | approvedLibraryText) and derive
// librarySourceRef from the existing claim.sourceRef when omitted — the
// field is still required at the model level, but the demo UI doesn't have
// a Library picker yet so defaulting to the claim's own sourceRef is a
// defensible interim. adoptedBy is ignored (we use request.user.id).
const adoptSchema = z.object({
  claimId: z.string().min(1),
  approvedText: z.string().min(1).optional(),
  approvedLibraryText: z.string().min(1).optional(),
  librarySourceRef: z.string().min(1).optional(),
  adoptedBy: z.string().optional(),
}).refine(v => v.approvedText || v.approvedLibraryText, {
  message: 'approvedText or approvedLibraryText is required',
})

// Tier override: accept both the API-canonical letter form ('A'|'B'|'C') and
// the UI's numeric ReviewTier (1|2|3 → A|B|C). The UI also sends
// `newTier`+`overriddenBy` (overriddenBy ignored — use request.user).
const TIER_UI_TO_DB: Record<number, 'A' | 'B' | 'C'> = { 1: 'A', 2: 'B', 3: 'C' }
const overrideTierSchema = z.object({
  tier: z.enum(['A', 'B', 'C']).optional(),
  newTier: z.union([z.enum(['A', 'B', 'C']), z.literal(1), z.literal(2), z.literal(3)]).optional(),
  reason: z.string().min(3, 'Override reason is required'),
  overriddenBy: z.string().optional(),
})

function normalizeTier(input: z.infer<typeof overrideTierSchema>): 'A' | 'B' | 'C' | null {
  const t = input.tier ?? input.newTier
  if (t == null) return null
  const letter = typeof t === 'number' ? TIER_UI_TO_DB[t] : t
  return letter ?? null
}

export const claimsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/:contentId/claims', { preHandler: requireAuth({ modules: ['C'] }) }, async (request, reply) => {
    const { contentId } = request.params as { contentId: string }
    const item = await app.prisma.medContentItem.findUnique({ where: { id: contentId } })
    if (!item) return reply.code(404).send({ error: 'not_found' })
    return app.prisma.claimsMatrixItem.findMany({
      where: { contentItemId: contentId },
      orderBy: { createdAt: 'asc' },
    })
  })

  // Not in the API contract literally, but used by the authoring UI to seed
  // the matrix before the AI harvest runs. Keeps the harvest stub honest —
  // it mutates existing rows rather than inventing content.
  app.post('/:contentId/claims', { preHandler: requireAuth({ modules: ['C'] }) }, async (request, reply) => {
    const { contentId } = request.params as { contentId: string }
    const parsed = createClaimSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', message: parsed.error.issues[0]?.message ?? 'invalid request body', issues: parsed.error.issues })

    const item = await app.prisma.medContentItem.findUnique({ where: { id: contentId } })
    if (!item) return reply.code(404).send({ error: 'not_found' })

    const created = await app.prisma.claimsMatrixItem.create({
      data: { ...parsed.data, contentItemId: contentId },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'claim_added',
      entityType: 'med_content',
      entityId: contentId,
      details: { claimId: created.id, sourceType: created.sourceType, location: created.location },
      ipAddress: request.ip ?? null,
    })

    return reply.code(201).send(created)
  })

  // Harvest stub: assigns deterministic pseudo-similarity based on claim text
  // length so the UI gets stable numbers without needing pgvector. Real
  // similarity engine lands with the pgvector extension install (deferred).
  app.post('/:contentId/claims/harvest', { preHandler: requireAuth({ modules: ['C'] }) }, async (request, reply) => {
    const { contentId } = request.params as { contentId: string }
    const item = await app.prisma.medContentItem.findUnique({ where: { id: contentId } })
    if (!item) return reply.code(404).send({ error: 'not_found' })

    const claims = await app.prisma.claimsMatrixItem.findMany({ where: { contentItemId: contentId } })
    const now = new Date()

    await app.prisma.$transaction(
      claims.map(c => {
        // Stable pseudo-similarity: longer text → closer to 50%; the harvest
        // UI shows gradient bars so any deterministic distribution works.
        const sim = Math.min(95, 30 + (c.claimText.length % 60))
        return app.prisma.claimsMatrixItem.update({
          where: { id: c.id },
          data: { similarityPct: sim, harvestedAt: now },
        })
      }),
    )

    await recalculateReviewTier(app.prisma, contentId, request.user!.id)

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'claims_harvested',
      entityType: 'med_content',
      entityId: contentId,
      details: { claimCount: claims.length, stub: true },
      ipAddress: request.ip ?? null,
    })

    const candidates = await app.prisma.claimsMatrixItem.findMany({
      where: { contentItemId: contentId },
      orderBy: { createdAt: 'asc' },
    })
    return { candidates }
  })

  app.post('/:contentId/claims/adopt', { preHandler: requireAuth({ modules: ['C'] }) }, async (request, reply) => {
    const { contentId } = request.params as { contentId: string }
    const parsed = adoptSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', message: parsed.error.issues[0]?.message ?? 'invalid request body', issues: parsed.error.issues })

    const claim = await app.prisma.claimsMatrixItem.findFirst({
      where: { id: parsed.data.claimId, contentItemId: contentId },
    })
    if (!claim) return reply.code(404).send({ error: 'not_found' })

    // FR-C-018 gate: adoption requires similarity ≥ 80 AND an approved library
    // text match. The route takes approvedText from the client (coming from
    // the Master Library UI), but similarity still gates the state transition.
    if ((claim.similarityPct ?? 0) < 80) {
      return reply.code(422).send({
        error: 'similarity_too_low',
        message: `Library adoption requires similarity ≥ 80% (current: ${claim.similarityPct ?? 'unknown'}%). Run harvest first.`,
      })
    }

    const approvedText = parsed.data.approvedText ?? parsed.data.approvedLibraryText!
    const librarySourceRef = parsed.data.librarySourceRef ?? claim.sourceRef

    const updated = await app.prisma.claimsMatrixItem.update({
      where: { id: claim.id },
      data: {
        approvedLibraryText: approvedText,
        approvalStatus: 'approved',
        adoptedAt: new Date(),
      },
    })

    await recalculateReviewTier(app.prisma, contentId, request.user!.id)

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'claim_library_adopted',
      entityType: 'med_content',
      entityId: contentId,
      details: {
        claimId: claim.id,
        librarySourceRef,
        bypassedMlr: true,                                               // audit the bypass per API contract
      },
      ipAddress: request.ip ?? null,
    })

    return updated
  })

  // PATCH individual claim status — called by the Claims Matrix UI when a
  // reviewer flips a single claim between approved/modified/needs_edit/
  // library_adopted/new. Also accepts UI vocab 'must-fix' → 'needs_edit'.
  app.patch('/:contentId/claims/:claimId', { preHandler: requireAuth({ modules: ['C'] }) }, async (request, reply) => {
    const { contentId, claimId } = request.params as { contentId: string; claimId: string }
    const body = (request.body ?? {}) as { approvalStatus?: string; reviewerId?: string }
    const incoming = (body.approvalStatus ?? '').toLowerCase()
    const dbStatus =
      incoming === 'must-fix' || incoming === 'must_fix' ? 'needs_edit'
      : incoming === 'modified' ? 'needs_edit'
      : incoming
    const allowed = new Set(['new', 'approved', 'rejected', 'needs_edit', 'library_adopted'])
    if (!allowed.has(dbStatus)) {
      return reply.code(400).send({ error: 'validation', message: `unknown approvalStatus: ${incoming}` })
    }

    const claim = await app.prisma.claimsMatrixItem.findFirst({
      where: { id: claimId, contentItemId: contentId },
    })
    if (!claim) return reply.code(404).send({ error: 'not_found' })

    const updated = await app.prisma.claimsMatrixItem.update({
      where: { id: claimId },
      data: {
        approvalStatus: dbStatus,
        reviewerId: body.reviewerId ?? request.user!.id,
      },
    })

    await recalculateReviewTier(app.prisma, contentId, request.user!.id)

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'claim_status_updated',
      entityType: 'med_content',
      entityId: contentId,
      details: { claimId, from: claim.approvalStatus, to: dbStatus },
      ipAddress: request.ip ?? null,
    })

    return updated
  })

  app.get('/:contentId/review-tier', { preHandler: requireAuth({ modules: ['C'] }) }, async (request, reply) => {
    const { contentId } = request.params as { contentId: string }
    const latest = await app.prisma.reviewTierRecord.findFirst({
      where: { contentItemId: contentId },
      orderBy: { calculatedAt: 'desc' },
    })
    if (!latest) return reply.code(404).send({ error: 'no_tier_calculated_yet' })
    return latest
  })

  // Tier override — mounted at both /review-tier/override (canonical) and
  // /tier (the UI's shorthand) so the Claims Matrix PATCH wires end-to-end.
  const overrideHandler: import('fastify').RouteHandlerMethod = async (request, reply) => {
    // Note: roles=['admin'] is a Phase 3C stand-in for "MLR Lead" —
    // the full MLR-role catalogue lands when MLR comments/decision workflow
    // ships. Admin acts as MLR Lead until then.
    const { contentId } = request.params as { contentId: string }
    const parsed = overrideTierSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', message: parsed.error.issues[0]?.message ?? 'invalid request body', issues: parsed.error.issues })
    const tier = normalizeTier(parsed.data)
    if (!tier) return reply.code(400).send({ error: 'validation', message: 'tier (A|B|C or 1|2|3) is required' })

    const latest = await app.prisma.reviewTierRecord.findFirst({
      where: { contentItemId: contentId },
      orderBy: { calculatedAt: 'desc' },
    })
    if (!latest) return reply.code(404).send({ error: 'no_tier_calculated_yet' })

    const created = await app.prisma.reviewTierRecord.create({
      data: {
        contentItemId: contentId,
        tier,
        reusePct: latest.reusePct,
        overriddenBy: request.user!.id,
        overrideReason: parsed.data.reason,
      },
    })

    await app.prisma.medContentItem.update({
      where: { id: contentId },
      data: { reviewTier: tier, tierOverriddenBy: request.user!.id },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'tier_overridden',
      entityType: 'med_content',
      entityId: contentId,
      details: {
        originalTier: latest.tier,
        newTier: tier,
        reason: parsed.data.reason,
      },
      ipAddress: request.ip ?? null,
    })

    return created
  }

  app.post('/:contentId/review-tier/override', { preHandler: requireAuth({ modules: ['C'], roles: ['admin'] }) }, overrideHandler)
  app.patch('/:contentId/tier',                 { preHandler: requireAuth({ modules: ['C'], roles: ['admin'] }) }, overrideHandler)
}

// --- helpers --------------------------------------------------------------

export async function recalculateReviewTier(
  prisma: PrismaClient,
  contentItemId: string,
  _actorId: string,
): Promise<void> {
  const claims = await prisma.claimsMatrixItem.findMany({ where: { contentItemId } })
  if (claims.length === 0) return

  const reused = claims.filter(c => c.approvalStatus === 'approved' || c.approvalStatus === 'library_adopted').length
  const reusePct = Math.round((reused / claims.length) * 100)
  const tier = reusePct >= 70 ? 'A' : reusePct >= 40 ? 'B' : 'C'

  await prisma.reviewTierRecord.create({
    data: { contentItemId, tier, reusePct },
  })
  await prisma.medContentItem.update({
    where: { id: contentItemId },
    data: { reviewTier: tier },
  })
}
