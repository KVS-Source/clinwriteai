// Document visibility, enforced once for the whole API (CW-020).
//
// Any route addressed by a document — a `:documentId` path parameter, as in
// /documents/:documentId/versions, /checklist, /references, /crm, /voice-notes,
// /sections/:sectionId/ai-history … — is only for people who may see that document
// (canSeeDocument: inside a project they can see; for a contributor, a document
// they work on). Hooked here rather than in each route so a new document route
// can't forget it.
//
// Answers 404, not 403, so documents outside the caller's work don't leak.
// Unauthenticated requests pass through: the route's requireAuth answers 401.
// Must be registered after the auth plugin (which sets request.user) and before
// the routes.

import fp from 'fastify-plugin'
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify'
import type { PrismaClient } from '@prisma/client'
import { canSeeDocument, seesEverything, visibleProjectIdsForUser } from '../modules/projects/visibility.js'

export async function documentAccessHook(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply | void> {
  const user = request.user
  if (!user) return
  const documentId = (request.params as Record<string, unknown> | undefined)?.documentId
  if (typeof documentId !== 'string' || !documentId) return
  if (await canSeeDocument(request.server.prisma, user, documentId)) return
  return reply.code(404).send({ error: 'not_found' })
}

/** What a route's path parameter belongs to: a document, or (project-level records) a project. */
export type ParamOwner = { documentId?: string; projectId?: string } | null

/**
 * The same rule for routes addressed by something that belongs to a document or a project — a CRM
 * meeting (/crm/:meetingId/…), a TLF package or item (/tlf-packages/:packageId, /tlf-items/:itemId)
 * or a project (/projects/:projectId/tlf-packages). The hook above only sees `:documentId`; these
 * resolve the id to its document or project first (CW-020).
 *
 * An id that matches nothing is left to the route, which answers its own 404. Register it with
 * `app.addHook('preHandler', ownerVisibilityHook(...))` inside the plugin that owns the routes.
 */
export function ownerVisibilityHook(
  param: string,
  ownerOf: (prisma: PrismaClient, id: string) => Promise<ParamOwner>,
) {
  return async function ownerVisibility(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply | void> {
    const user = request.user
    if (!user) return
    const id = (request.params as Record<string, unknown> | undefined)?.[param]
    if (typeof id !== 'string' || !id) return
    if (seesEverything(user)) return   // admins and auditors: nothing to look up
    const prisma = request.server.prisma
    const owner = await ownerOf(prisma, id)
    if (!owner) return
    if (owner.documentId) {
      if (await canSeeDocument(prisma, user, owner.documentId)) return
    } else if (owner.projectId) {
      const visible = await visibleProjectIdsForUser(prisma, user)
      if (visible === 'all' || visible.has(owner.projectId)) return
    } else {
      return
    }
    return reply.code(404).send({ error: 'not_found' })
  }
}

const documentAccessPlugin: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', documentAccessHook)
}

export default fp(documentAccessPlugin, { name: 'document-access' })
