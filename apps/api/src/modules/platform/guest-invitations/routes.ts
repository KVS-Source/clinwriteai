// Guest invitation routes — time-boxed signed-URL access for external
// parties (KOL / sponsor / external SME / external auditor).
//
// Design: docs/roles-and-permissions.md §6.
//
// Two scopes share one table (GuestInvitation):
//   scope='document' → one doc, read + comment, 14-day default expiry.
//   scope='project'  → one project, read-only + audit export, 90-day
//                      default expiry. Only purpose='external-audit'
//                      makes sense here in v1.
//
// Routes:
//   POST   /documents/:documentId/guest-invitations    (R-only, scope='document')
//   POST   /projects/:projectId/guest-invitations      (admin-only, scope='project')
//   GET    /documents/:documentId/guest-invitations    (any auth; lists for doc)
//   GET    /projects/:projectId/guest-invitations      (any auth; lists for project)
//   DELETE /guest-invitations/:id                      (R-only for doc scope, admin for project; revokes)
//
// Token signing: uses the existing fastify-jwt infrastructure (HS256
// with JWT_SECRET). The design calls for ES256 shared with License
// Studio; that migration happens when the standalone deployment ships.
// Payload shape stays the same — only the signing algorithm swaps.
// Payload: { scope, documentId?, projectId?, email, purpose, exp, jti }.

import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { requireAuth } from '../../../auth/rbac.js'
import { actorCanEditDocumentRaci } from '../document-raci/access.js'

const DAY_MS = 24 * 60 * 60 * 1000
const DEFAULT_DOCUMENT_EXPIRY_DAYS = 14
const DEFAULT_PROJECT_EXPIRY_DAYS  = 90

const emailField   = z.string().email().max(320)
const purposeField = z.enum(['kol-review', 'sponsor-review', 'external-stat', 'external-audit', 'other'])

const documentInviteSchema = z.object({
  email: emailField,
  purpose: purposeField.default('kol-review'),
  expiresInDays: z.number().int().min(1).max(90).optional(),
})

const projectInviteSchema = z.object({
  email: emailField,
  // Project-scoped invites are external audit by default; the enum stays
  // open in case we need other project-scoped flavours later, but today
  // the UX only exposes external-audit for this scope.
  purpose: z.enum(['external-audit', 'other']).default('external-audit'),
  expiresInDays: z.number().int().min(1).max(365).optional(),
})

interface GuestTokenPayload {
  scope: 'document' | 'project'
  documentId?: string
  projectId?: string
  email: string
  purpose: string
  jti: string
  // exp set by jwtSign via { expiresIn } at sign time.
}

export const guestInvitationRoutes: FastifyPluginAsync = async (app) => {
  // ---------------------------------------------------------------------
  // POST /documents/:documentId/guest-invitations — R-only, scope='document'
  // ---------------------------------------------------------------------
  app.post('/documents/:documentId/guest-invitations', { preHandler: requireAuth() }, async (request, reply) => {
    const { documentId } = request.params as { documentId: string }
    const parsed = documentInviteSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const actor = request.user!
    if (!(await actorCanEditDocumentRaci(app.prisma, actor, documentId))) {
      return reply.code(403).send({
        error: 'guest_invite_forbidden',
        message: 'Only an R on this document (or an admin) can invite external guests.',
      })
    }

    const document = await app.prisma.document.findUnique({
      where: { id: documentId },
      select: { id: true },
    })
    if (!document) return reply.code(404).send({ error: 'document_not_found' })

    const expiresInDays = parsed.data.expiresInDays ?? DEFAULT_DOCUMENT_EXPIRY_DAYS
    const expiresAt = new Date(Date.now() + expiresInDays * DAY_MS)

    // Create the row first so we have the id to use as the jti claim.
    const row = await app.prisma.guestInvitation.create({
      data: {
        scope: 'document',
        documentId,
        email: parsed.data.email,
        purpose: parsed.data.purpose,
        invitedBy: actor.id,
        expiresAt,
        jwtText: '',
      },
    })

    const payload: GuestTokenPayload = {
      scope: 'document',
      documentId,
      email: parsed.data.email,
      purpose: parsed.data.purpose,
      jti: row.id,
    }
    // fastify-jwt's type signature is pinned to SessionClaims (the main
    // session JWT shape). Guest tokens have a different payload — the
    // runtime accepts any JSON object, so we cast through unknown. When
    // we move to ES256 signed with the License Studio key, this will be
    // a dedicated signer that doesn't share the SessionClaims typing.
    const token = await app.jwt.sign(payload as unknown as Parameters<typeof app.jwt.sign>[0], { expiresIn: `${expiresInDays}d` })

    const updated = await app.prisma.guestInvitation.update({
      where: { id: row.id },
      data: { jwtText: token },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: actor.id,
      action: 'guest_invitation.created',
      entityType: 'document',
      entityId: documentId,
      details: {
        guestInvitationId: row.id,
        email: parsed.data.email,
        purpose: parsed.data.purpose,
        scope: 'document',
        expiresAt: expiresAt.toISOString(),
      },
      ipAddress: request.ip ?? null,
    })

    return reply.code(201).send(withToken(updated))
  })

  // ---------------------------------------------------------------------
  // POST /projects/:projectId/guest-invitations — admin-only, scope='project'
  // ---------------------------------------------------------------------
  app.post('/projects/:projectId/guest-invitations', { preHandler: requireAuth({ roles: ['admin'] }) }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string }
    const parsed = projectInviteSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const actor = request.user!

    const project = await app.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true },
    })
    if (!project) return reply.code(404).send({ error: 'project_not_found' })

    const expiresInDays = parsed.data.expiresInDays ?? DEFAULT_PROJECT_EXPIRY_DAYS
    const expiresAt = new Date(Date.now() + expiresInDays * DAY_MS)

    const row = await app.prisma.guestInvitation.create({
      data: {
        scope: 'project',
        projectId,
        email: parsed.data.email,
        purpose: parsed.data.purpose,
        invitedBy: actor.id,
        expiresAt,
        jwtText: '',
      },
    })

    const payload: GuestTokenPayload = {
      scope: 'project',
      projectId,
      email: parsed.data.email,
      purpose: parsed.data.purpose,
      jti: row.id,
    }
    // fastify-jwt's type signature is pinned to SessionClaims (the main
    // session JWT shape). Guest tokens have a different payload — the
    // runtime accepts any JSON object, so we cast through unknown. When
    // we move to ES256 signed with the License Studio key, this will be
    // a dedicated signer that doesn't share the SessionClaims typing.
    const token = await app.jwt.sign(payload as unknown as Parameters<typeof app.jwt.sign>[0], { expiresIn: `${expiresInDays}d` })

    const updated = await app.prisma.guestInvitation.update({
      where: { id: row.id },
      data: { jwtText: token },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: actor.id,
      action: 'guest_invitation.created',
      entityType: 'project',
      entityId: projectId,
      details: {
        guestInvitationId: row.id,
        email: parsed.data.email,
        purpose: parsed.data.purpose,
        scope: 'project',
        expiresAt: expiresAt.toISOString(),
      },
      ipAddress: request.ip ?? null,
    })

    return reply.code(201).send(sanitize(updated))
  })

  // ---------------------------------------------------------------------
  // GET /documents/:documentId/guest-invitations
  // Lists the invitations ever issued for this doc. Any authenticated
  // user with doc access can read — tokens are sanitised in the response
  // so leaking a listing doesn't leak the magic link.
  // ---------------------------------------------------------------------
  app.get('/documents/:documentId/guest-invitations', { preHandler: requireAuth() }, async (request, reply) => {
    const { documentId } = request.params as { documentId: string }
    const document = await app.prisma.document.findUnique({ where: { id: documentId }, select: { id: true } })
    if (!document) return reply.code(404).send({ error: 'document_not_found' })

    const rows = await app.prisma.guestInvitation.findMany({
      where: { documentId },
      orderBy: { invitedAt: 'desc' },
    })
    return rows.map(sanitize)
  })

  // ---------------------------------------------------------------------
  // GET /projects/:projectId/guest-invitations
  // ---------------------------------------------------------------------
  app.get('/projects/:projectId/guest-invitations', { preHandler: requireAuth() }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string }
    const project = await app.prisma.project.findUnique({ where: { id: projectId }, select: { id: true } })
    if (!project) return reply.code(404).send({ error: 'project_not_found' })

    const rows = await app.prisma.guestInvitation.findMany({
      where: { projectId },
      orderBy: { invitedAt: 'desc' },
    })
    return rows.map(sanitize)
  })

  // ---------------------------------------------------------------------
  // DELETE /guest-invitations/:id — revoke. Soft via revokedAt.
  //   - doc-scoped invites: R-on-doc or admin.
  //   - project-scoped invites: admin only (same as who could create them).
  // ---------------------------------------------------------------------
  app.delete('/guest-invitations/:id', { preHandler: requireAuth() }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const existing = await app.prisma.guestInvitation.findUnique({ where: { id } })
    if (!existing) return reply.code(404).send({ error: 'not_found' })
    if (existing.revokedAt) return reply.code(409).send({ error: 'already_revoked' })

    const actor = request.user!
    const isAdmin = actor.role === 'tenant-admin' || actor.role === 'admin'

    let allowed = isAdmin
    if (!allowed && existing.scope === 'document' && existing.documentId) {
      allowed = await actorCanEditDocumentRaci(app.prisma, actor, existing.documentId)
    }
    // project-scoped: admin only, no R-escape — admin invited, admin revokes.

    if (!allowed) {
      return reply.code(403).send({
        error: 'guest_revoke_forbidden',
        message: existing.scope === 'document'
          ? 'Only an R on this document (or an admin) can revoke a guest invitation.'
          : 'Only an admin can revoke a project-scoped guest invitation.',
      })
    }

    const row = await app.prisma.guestInvitation.update({
      where: { id },
      data: { revokedAt: new Date() },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: actor.id,
      action: 'guest_invitation.revoked',
      entityType: existing.scope === 'document' ? 'document' : 'project',
      entityId: existing.scope === 'document' ? existing.documentId! : existing.projectId!,
      details: {
        guestInvitationId: id,
        email: existing.email,
        purpose: existing.purpose,
        scope: existing.scope,
      },
      ipAddress: request.ip ?? null,
    })

    return reply.send(sanitize(row))
  })
}

// Sanitise outbound rows — the jwtText (magic-link token) is only
// returned to the issuer at creation time. GET endpoints and DELETE
// response strip it so a casual list reader can't walk away with the
// link to someone else's doc.
// GET + DELETE strip the full JWT so a casual list reader can't walk
// away with another R's magic link.
function sanitize(row: {
  id: string; scope: string; documentId: string | null; projectId: string | null;
  email: string; purpose: string; invitedBy: string;
  invitedAt: Date; expiresAt: Date; revokedAt: Date | null;
  jwtText: string;
}) {
  const { jwtText, ...rest } = row
  return {
    ...rest,
    invitedAt: rest.invitedAt.toISOString(),
    expiresAt: rest.expiresAt.toISOString(),
    revokedAt: rest.revokedAt ? rest.revokedAt.toISOString() : null,
    tokenPreview: jwtText ? `${jwtText.slice(0, 12)}…` : null,
  }
}

// POST responses include the full token — the caller needs it once to
// email to the guest. The row is NOT re-fetchable with the token again
// via any read endpoint; if lost, the R has to revoke + re-invite.
function withToken(row: {
  id: string; scope: string; documentId: string | null; projectId: string | null;
  email: string; purpose: string; invitedBy: string;
  invitedAt: Date; expiresAt: Date; revokedAt: Date | null;
  jwtText: string;
}) {
  return {
    ...sanitize(row),
    token: row.jwtText,
  }
}
