// Guest redemption routes — the public-facing endpoints a guest hits
// after clicking the magic link in their email. Zero authentication:
// the only credential is the signed JWT in the URL.
//
// Design: docs/roles-and-permissions.md §6.1 flow + §6.3 constraints.
//
// Three endpoints (prefix /guest):
//   GET  /verify/:token               — validate token; returns scope + doc/project id
//   GET  /document/:token             — stripped read-only doc view (scope='document')
//   POST /document/:token/comments    — guest leaves a comment on the doc
//
// Verification pipeline for every endpoint:
//   1. jwtVerify the token (signature + exp check)
//   2. Look up GuestInvitation by jti
//   3. 404 if row missing; 410 Gone if revokedAt is set
//   4. 410 Gone if expiresAt is in the past (defence-in-depth; jwtVerify
//      should have already caught this via exp)
//   5. 403 if the token's scope / docId / projectId don't match the row
//      (prevents a tampered token with mismatched claims)
//
// Guest cannot (per §6.3):
//   - download the document
//   - see prior versions
//   - export anything
//   - see projects or other docs

import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'

interface GuestTokenPayload {
  scope: 'document' | 'project'
  documentId?: string
  projectId?: string
  email: string
  purpose: string
  jti: string
}

const commentSchema = z.object({
  sectionRef: z.string().min(1).max(100),
  text: z.string().min(1).max(5000),
})

export const guestRedemptionRoutes: FastifyPluginAsync = async (app) => {
  // --- Verify a token --------------------------------------------------
  app.get('/verify/:token', async (request, reply) => {
    const { token } = request.params as { token: string }
    const check = await verifyGuestToken(app, token)
    if (!check.ok) return reply.code(check.code).send({ error: check.error, message: check.message })
    const { payload, row } = check
    return reply.send({
      scope:        payload.scope,
      documentId:   row.documentId,
      projectId:    row.projectId,
      email:        row.email,
      purpose:      row.purpose,
      expiresAt:    row.expiresAt.toISOString(),
    })
  })

  // --- Fetch the doc (stripped read-only) ------------------------------
  app.get('/document/:token', async (request, reply) => {
    const { token } = request.params as { token: string }
    const check = await verifyGuestToken(app, token)
    if (!check.ok) return reply.code(check.code).send({ error: check.error, message: check.message })
    if (check.payload.scope !== 'document') {
      return reply.code(403).send({
        error: 'scope_mismatch',
        message: 'This token is not scoped to a single document.',
      })
    }

    const documentId = check.row.documentId!
    const doc = await app.prisma.document.findUnique({
      where: { id: documentId },
      select: {
        id: true,
        title: true,
        type: true,
        status: true,
        currentVersionId: true,
      },
    })
    if (!doc) return reply.code(404).send({ error: 'document_not_found' })

    const sections = doc.currentVersionId
      ? await app.prisma.sectionContent.findMany({
          where: { documentVersionId: doc.currentVersionId },
          select: { sectionId: true, sectionNumber: true, sectionTitle: true, contentHtml: true },
          orderBy: { sectionNumber: 'asc' },
        })
      : []

    // v1 default per docs §10 Q2: guest sees all comments on the doc.
    // Prior versions, download links, raw version id are stripped
    // (per §6.3 the guest cannot see prior versions / download / export).
    const comments = await app.prisma.comment.findMany({
      where: { documentId },
      select: { id: true, sectionRef: true, text: true, status: true, createdAt: true, reviewerId: true },
      orderBy: { createdAt: 'asc' },
    })

    return reply.send({
      guest: {
        email: check.row.email,
        purpose: check.row.purpose,
        expiresAt: check.row.expiresAt.toISOString(),
      },
      document: {
        id: doc.id,
        title: doc.title,
        type: doc.type,
        status: doc.status,
      },
      sections,
      comments: comments.map(c => ({
        id: c.id,
        sectionRef: c.sectionRef,
        text: c.text,
        status: c.status,
        createdAt: c.createdAt.toISOString(),
        // Author id intentionally stripped — the guest doesn't need to
        // know who else is on the doc. "Me vs them" ownership is derived
        // from external_email at comment-write time (below).
      })),
    })
  })

  // --- Leave a comment -------------------------------------------------
  app.post('/document/:token/comments', async (request, reply) => {
    const { token } = request.params as { token: string }
    const check = await verifyGuestToken(app, token)
    if (!check.ok) return reply.code(check.code).send({ error: check.error, message: check.message })
    if (check.payload.scope !== 'document') {
      return reply.code(403).send({ error: 'scope_mismatch' })
    }

    const parsed = commentSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const documentId = check.row.documentId!

    // Comment id is app-generated 'CMT-...' per the existing scheme.
    // Collision avoided by prefixing with 'G-' for guest comments.
    const commentId = `G-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const comment = await app.prisma.comment.create({
      data: {
        id: commentId,
        documentId,
        sectionRef: parsed.data.sectionRef,
        reviewerId: 'system:guest',
        text: parsed.data.text,
        // Guest comments default to 'query' severity — least prejudicial;
        // internal reviewers can elevate during triage.
        severity: 'query',
        status: 'open',
        externalEmail: check.row.email,
      },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: 'system:guest',
      action: 'guest_comment.added',
      entityType: 'document',
      entityId: documentId,
      details: {
        guestInvitationId: check.row.id,
        guestEmail: check.row.email,
        commentId: comment.id,
        sectionRef: parsed.data.sectionRef,
      },
      ipAddress: request.ip ?? null,
    })

    return reply.code(201).send({
      id: comment.id,
      sectionRef: comment.sectionRef,
      text: comment.text,
      status: comment.status,
      createdAt: comment.createdAt.toISOString(),
    })
  })
}

// -----------------------------------------------------------------------
// Shared token verification. Returns a discriminated union so callers
// can switch on `ok` and get HTTP code + message for the failure path.
// -----------------------------------------------------------------------
type VerifyResult =
  | { ok: true;  payload: GuestTokenPayload; row: Awaited<ReturnType<typeof loadInvitation>> extends infer T ? Exclude<T, null> : never }
  | { ok: false; code: 400 | 401 | 403 | 404 | 410; error: string; message: string }

async function verifyGuestToken(app: Parameters<FastifyPluginAsync>[0], token: string): Promise<VerifyResult> {
  if (!token || token.length < 20) {
    return { ok: false, code: 400, error: 'bad_token', message: 'Token is missing or malformed.' }
  }

  let payload: GuestTokenPayload
  try {
    // The verify-token call bypasses the SessionClaims typing on
    // app.jwt.verify (guest tokens are a different payload shape).
    payload = app.jwt.verify(token) as unknown as GuestTokenPayload
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return {
      ok: false,
      code: 401,
      error: 'token_invalid',
      message: /expired/i.test(msg) ? 'This link has expired. Request a new one.' : 'This link is not valid.',
    }
  }

  const row = await loadInvitation(app, payload.jti)
  if (!row) return { ok: false, code: 404, error: 'invitation_not_found', message: 'Invitation no longer exists.' }
  if (row.revokedAt)                 return { ok: false, code: 410, error: 'revoked',  message: 'This invitation was revoked.' }
  if (row.expiresAt.getTime() < Date.now()) return { ok: false, code: 410, error: 'expired',  message: 'This invitation has expired.' }

  // Scope / id-match sanity. The jwtVerify already validated the
  // signature but the stored row is authoritative — a tampered token
  // (if a signing key leaks) can be rejected here if claims disagree.
  if (payload.scope !== row.scope) {
    return { ok: false, code: 403, error: 'scope_mismatch', message: 'Token scope does not match the stored invitation.' }
  }
  if (payload.scope === 'document' && payload.documentId !== row.documentId) {
    return { ok: false, code: 403, error: 'document_mismatch', message: 'Token document id does not match the stored invitation.' }
  }
  if (payload.scope === 'project' && payload.projectId !== row.projectId) {
    return { ok: false, code: 403, error: 'project_mismatch', message: 'Token project id does not match the stored invitation.' }
  }

  return { ok: true, payload, row }
}

async function loadInvitation(app: Parameters<FastifyPluginAsync>[0], jti: string) {
  return app.prisma.guestInvitation.findUnique({ where: { id: jti } })
}
