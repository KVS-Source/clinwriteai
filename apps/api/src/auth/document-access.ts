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
import { canSeeDocument } from '../modules/projects/visibility.js'

export async function documentAccessHook(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply | void> {
  const user = request.user
  if (!user) return
  const documentId = (request.params as Record<string, unknown> | undefined)?.documentId
  if (typeof documentId !== 'string' || !documentId) return
  if (await canSeeDocument(request.server.prisma, user, documentId)) return
  return reply.code(404).send({ error: 'not_found' })
}

const documentAccessPlugin: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', documentAccessHook)
}

export default fp(documentAccessPlugin, { name: 'document-access' })
