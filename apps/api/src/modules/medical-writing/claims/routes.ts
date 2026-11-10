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
import { bestLibraryMatch } from './library-match.js'
import { extractClaimsWithClaude, buildStubClaims, normaliseClaimText, type ExtractedClaim } from './ai-extract.js'
import { resolveAiEngineSettings } from '../../platform/config/ai-engine-settings.js'

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

  // Harvest: for each claim on this content item, finds the best
  // Master Library match (LibrarySection where category='claim',
  // matching TA), records similarityPct + approvedLibraryText so the
  // adopt flow can carry the matched text forward without a round-
  // trip to the Library UI.
  //
  // Similarity today = Jaccard on tokenised word sets (library-match.ts).
  // When pgvector lands (X-2) swap the scoring call for cosine on the
  // embedding column; function signature stays identical.
  //
  // Claims with no match in the Library (e.g. first-of-kind content)
  // get similarityPct = 0 + approvedLibraryText = null. The UI's 80%
  // gate in the adopt route will keep them out of the library-adoption
  // path automatically.
  app.post('/:contentId/claims/harvest', { preHandler: requireAuth({ modules: ['C'] }) }, async (request, reply) => {
    const { contentId } = request.params as { contentId: string }
    const item = await app.prisma.medContentItem.findUnique({ where: { id: contentId } })
    if (!item) return reply.code(404).send({ error: 'not_found' })

    // AI extraction first (two-step harvest, 2026-11-10):
    //   1. Ask Claude to surface every discrete claim from the slide deck
    //      (or content metadata when no slides exist yet). Dedupe against
    //      existing rows by normalised claimText so re-running the button
    //      only adds genuinely new claims — existing claims keep their
    //      reviewer + approval status.
    //   2. Re-score every claim (new + existing) against the Master
    //      Library for similarityPct + approvedLibraryText. (Original
    //      harvest behaviour.)
    // Gated on AI readiness so a no-key deployment gets a direct 503
    // instead of a silent "0 claims" return.
    const engine = await resolveAiEngineSettings(app.prisma)
    const aiModel = engine.default
    const aiConfigured = app.aiGateway.isConfigured(aiModel)
    const stubAllowed = process.env.AI_ALLOW_STUB === '1'
    if (!aiConfigured && !stubAllowed) {
      return reply.code(503).send({
        error:     'ai_not_configured',
        message:   'AI is not set up — claim extraction needs an AI engine. Ask an admin to configure one.',
        setupPath: '/admin',
      })
    }

    const existingClaims = await app.prisma.claimsMatrixItem.findMany({ where: { contentItemId: contentId } })
    const existingByNorm = new Map(existingClaims.map(c => [normaliseClaimText(c.claimText), c]))

    let extractedCount = 0
    try {
      const apiKey = process.env.ANTHROPIC_API_KEY?.trim() ?? ''
      const extracted: ExtractedClaim[] = aiConfigured
        ? await extractClaimsWithClaude({ prisma: app.prisma, contentId, model: aiModel, apiKey })
        : buildStubClaims()
      const novel = extracted.filter(c => !existingByNorm.has(normaliseClaimText(c.claimText)))
      if (novel.length > 0) {
        await app.prisma.claimsMatrixItem.createMany({
          data: novel.map(c => ({
            contentItemId: contentId,
            claimText:     c.claimText,
            sourceRef:     c.sourceRef,
            sourceType:    c.sourceType,
            location:      c.location,
            approvalStatus: 'new',
          })),
        })
        extractedCount = novel.length
      }
    } catch (err) {
      app.log.warn({ err, contentId }, 'claims harvest: AI extraction failed — proceeding with library re-score on existing rows only')
    }

    // Re-read so the re-scoring loop below sees the just-inserted rows.
    const claims = await app.prisma.claimsMatrixItem.findMany({ where: { contentItemId: contentId } })
    const now = new Date()

    // Pull the candidate Library pool in one query: current + non-
    // retired claim-category rows matching the item's TA. Platform-wide
    // tenancy (single-tenant install); the filter is category + TA.
    const libraryCandidates = await app.prisma.librarySection.findMany({
      where: {
        category: 'claim',
        isCurrent: true,
        retiredAt: null,
        taTag: item.taTag,
      },
      select: { id: true, title: true, body: true },
    })

    const results = claims.map(c => {
      const match = bestLibraryMatch(c.claimText, libraryCandidates)
      return { claim: c, match }
    })

    await app.prisma.$transaction(
      results.map(({ claim, match }) =>
        app.prisma.claimsMatrixItem.update({
          where: { id: claim.id },
          data: {
            similarityPct:       match.similarityPct,
            approvedLibraryText: match.libraryBody,
            harvestedAt:         now,
          },
        }),
      ),
    )

    await recalculateReviewTier(app.prisma, contentId, request.user!.id)

    const matchedCount = results.filter(r => r.match.librarySectionId !== null).length
    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'claims_harvested',
      entityType: 'med_content',
      entityId: contentId,
      details: {
        claimCount:         claims.length,
        extractedCount,                           // new claims surfaced by AI in this run
        libraryPoolSize:    libraryCandidates.length,
        matchedCount,
        similarityEngine:   'jaccard',           // swap to 'pgvector-cosine' when X-2 lands
        extractionEngine:   aiConfigured ? aiModel : 'stub',
      },
      ipAddress: request.ip ?? null,
    })

    const candidates = await app.prisma.claimsMatrixItem.findMany({
      where: { contentItemId: contentId },
      orderBy: { createdAt: 'asc' },
    })
    // Response carries the per-run counts alongside the full candidates list
    // so the UI can flash a useful toast ("4 new claims extracted; 2 matched
    // the library") without a second request.
    return { candidates, extractedCount, matchedCount, totalClaims: claims.length }
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
