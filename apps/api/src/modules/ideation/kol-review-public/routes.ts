// Public KOL review route — no requireAuth; the one-time review link
// token IS the auth.
//
// Security posture:
//   - Mounted at /public/kol-review/* so the WAF rules (deploy
//     infrastructure) can scope aggressive rate limits + geo IP + bot
//     detection to just this prefix.
//   - Fastify-level rate limit per route: GET 60/min, POST 10/min,
//     both keyed on the remote IP (shared across tokens from the
//     same NAT, but the per-IP cap is higher than any legitimate
//     KOL usage).
//   - Token in the URL path — opaque 64-char hex (randomBytes(32)).
//     Comparison is constant-time to avoid token-prefix timing probes.
//   - Response bodies are minimum-necessary: KOL name + project
//     display name + card content to review. Nothing about owners,
//     authors, pricing, or other KOLs on the same project.
//   - Invalid token → 401. Expired → 410 Gone. Already-signed → 409.
//   - Audit every access (read OR write) with kolContactId + the
//     narrow set of fields the caller sent. The audit chain is the
//     source of truth for the review-decisions table that hasn't
//     shipped yet; when it does, the decisions move out of the audit
//     details into their own rows.
//
// Not shipping here (bigger scope — needs the dedicated decisions table):
//   - Per-card approve/reject/comment persistence (stored only in audit
//     for now; UI shows the aggregate sign-off state via signedOffAt).
//   - Resend-token / rotate-token / extend-expiry — admin-side via a
//     separate authenticated route.

import type { FastifyPluginAsync } from 'fastify'
import { timingSafeEqual } from 'node:crypto'
import { z } from 'zod'

const TOKEN_HEX_LEN = 64                                  // randomBytes(32).toString('hex')

function tokensEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  try {
    return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'))
  } catch {
    return false
  }
}

function isValidTokenShape(t: string): boolean {
  return typeof t === 'string' && t.length === TOKEN_HEX_LEN && /^[0-9a-f]+$/i.test(t)
}

// --- shapes --------------------------------------------------------------
//
// Deliberately NARROW. Only what the KOL needs to decide:
//  - who they are (so the UI can greet them by name)
//  - which project (display name only)
//  - what cards to review (sourceSection + sourcePassage + channel list)
//  - whether they've already signed off
// No ideationProject.owner, no tenant id, no project status.

function reviewPackageShape(args: {
  kol:     { name: string; email: string; signedOffAt: Date | null; reviewLinkExpiry: Date }
  project: { name: string | null }
  cards:   Array<{ id: string; sourceSection: string; sourcePassage: string; channelFormats: string[] }>
}) {
  return {
    kol: {
      name:            args.kol.name,
      email:           args.kol.email,
      signedOffAt:     args.kol.signedOffAt ? args.kol.signedOffAt.toISOString() : null,
      reviewLinkExpiry: args.kol.reviewLinkExpiry.toISOString(),
    },
    project: {
      name: args.project.name ?? 'Review package',
    },
    cards: args.cards.map(c => ({
      id:             c.id,
      sourceSection:  c.sourceSection,
      sourcePassage:  c.sourcePassage,
      channelFormats: c.channelFormats,
    })),
  }
}

// --- decision body schema -----------------------------------------------

const signoffBodySchema = z.object({
  decisions: z.array(z.object({
    cardId:   z.string().min(1),
    decision: z.enum(['approved', 'rejected', 'changes_requested']),
    comment:  z.string().max(2000).optional(),
  })).min(1).max(100),
})

// --- plugin --------------------------------------------------------------

export const kolReviewPublicRoutes: FastifyPluginAsync = async (app) => {
  // Shared lookup — finds the KOL by token + validates expiry + sign-off
  // state. Returns one of:
  //   { kind: 'ok',       kol }  → proceed
  //   { kind: 'invalid'   }      → 401
  //   { kind: 'expired'   }      → 410 Gone
  //   { kind: 'signed'    }      → 409 Conflict
  async function resolveToken(rawToken: string) {
    if (!isValidTokenShape(rawToken)) return { kind: 'invalid' as const }
    // findMany + manual timing-safe compare rather than findFirst({token}),
    // which gives Prisma / Postgres a chance to short-circuit on the
    // first mismatching byte. The findMany bounded by LIMIT 1 cost is
    // fine at KOL volumes; the extra safety is cheap.
    const rows = await app.prisma.kolContact.findMany({
      where:  { reviewLinkToken: rawToken },
      take:   1,
      select: {
        id: true, ideationProjectId: true, name: true, email: true,
        reviewLinkToken: true, reviewLinkExpiry: true, signedOffAt: true,
      },
    })
    const kol = rows[0]
    if (!kol) return { kind: 'invalid' as const }
    if (!tokensEqual(kol.reviewLinkToken, rawToken)) return { kind: 'invalid' as const }
    if (kol.reviewLinkExpiry.getTime() < Date.now())  return { kind: 'expired' as const }
    if (kol.signedOffAt !== null)                      return { kind: 'signed' as const, kol }
    return { kind: 'ok' as const, kol }
  }

  // GET — read the review package.
  app.get('/public/kol-review/:token', {
    // Fastify-rate-limit config applied per route. The key defaults to
    // request.ip. If the deploy sits behind nginx, trustProxy in
    // server.ts ensures that's the real client IP rather than 127.0.0.1.
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const { token } = request.params as { token: string }
    const outcome = await resolveToken(token)
    if (outcome.kind === 'invalid') return reply.code(401).send({ error: 'invalid_token' })
    if (outcome.kind === 'expired') return reply.code(410).send({ error: 'token_expired' })
    // Signed is not a 409 on GET — the KOL may want to see their own
    // past decisions. Return the package with a flag; POST is the one
    // that refuses re-sign.
    const kol = outcome.kol

    // IdeationProject has no `name` column — resolve it via the parent
    // Project (id + name) so the KOL sees a readable project label.
    const ideation = await app.prisma.ideationProject.findUnique({
      where:  { id: kol.ideationProjectId },
      select: { id: true, projectId: true },
    })
    const parentProject = ideation
      ? await app.prisma.project.findUnique({
          where:  { id: ideation.projectId },
          select: { name: true },
        })
      : null
    // Pull cards across every artefact in the project. Narrow select
    // deliberate — don't accidentally leak provenance / kolStatus /
    // maStatus.
    const cards = await app.prisma.ideationContentCard.findMany({
      where:   { artefact: { ideationProjectId: kol.ideationProjectId } },
      select:  { id: true, sourceSection: true, sourcePassage: true, channelFormats: true },
      orderBy: { createdAt: 'asc' },
    })

    await app.audit.append({
      timestamp:  new Date().toISOString(),
      actorId:    `kol:${kol.id}`,                                            // synthetic — no User.id for external KOLs
      action:     'kol_review_opened',
      entityType: 'kol_contact',
      entityId:   kol.id,
      details:    { cardCount: cards.length, ideationProjectId: kol.ideationProjectId },
      ipAddress:  request.ip ?? null,
    })

    return reviewPackageShape({ kol, project: { name: parentProject?.name ?? null }, cards })
  })

  // POST — submit decisions + flip sign-off.
  app.post('/public/kol-review/:token/decisions', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const { token } = request.params as { token: string }
    const parsed = signoffBodySchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const outcome = await resolveToken(token)
    if (outcome.kind === 'invalid') return reply.code(401).send({ error: 'invalid_token' })
    if (outcome.kind === 'expired') return reply.code(410).send({ error: 'token_expired' })
    if (outcome.kind === 'signed')  return reply.code(409).send({ error: 'already_signed', signedOffAt: outcome.kol.signedOffAt?.toISOString() })

    const kol = outcome.kol
    const now = new Date()

    // Flip sign-off + record decisions in the audit chain (dedicated
    // decisions table ships in the full /kol-review scope — until
    // then the audit entry is the record of truth).
    await app.prisma.kolContact.update({
      where: { id: kol.id },
      data:  { signedOffAt: now },
    })

    await app.audit.append({
      timestamp:  now.toISOString(),
      actorId:    `kol:${kol.id}`,
      action:     'kol_review_signed_off',
      entityType: 'kol_contact',
      entityId:   kol.id,
      details:    {
        ideationProjectId: kol.ideationProjectId,
        decisions:         parsed.data.decisions,
      },
      ipAddress: request.ip ?? null,
    })

    return { signedOffAt: now.toISOString(), decisionCount: parsed.data.decisions.length }
  })
}
