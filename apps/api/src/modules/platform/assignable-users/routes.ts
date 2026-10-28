// Assignable-users — scoped user listing for the RACI editor picker.
//
// The main /users admin endpoint is intentionally admin-only (user mgmt
// is a tenant-admin concern). The RACI editor runs in R's hands and
// needs a lighter-weight list of candidates filtered by capability +
// project membership — hence this dedicated endpoint, open to any auth.
//
// Route (prefix /projects):
//   GET /:projectId/assignable-users?capability=<cap>
//
// Query:
//   capability (optional) — can-author | can-review | can-approve |
//                           can-qc | can-publish
//
// Response is a minimal shape — the picker only needs name/email/
// capabilities to render a chip + capability-match check:
//
//   [{ id, name, email, initials, capabilities, projectRole }]
//
// If `capability` is passed, users without that capability are filtered
// out server-side (keeps the client payload small for 100+ member
// projects). The lead R who's a tenant-admin bypasses the capability
// filter — admins can always self-grant per §4.2.

import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { requireAuth, type Capability } from '../../../auth/rbac.js'

const CAPABILITY_VALUES = ['can-author', 'can-review', 'can-approve', 'can-qc', 'can-publish'] as const
const querySchema = z.object({
  capability: z.enum(CAPABILITY_VALUES).optional(),
})

export const assignableUsersRoutes: FastifyPluginAsync = async (app) => {
  app.get('/:projectId/assignable-users', { preHandler: requireAuth() }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string }
    const parsed = querySchema.safeParse(request.query)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const project = await app.prisma.project.findUnique({ where: { id: projectId }, select: { id: true } })
    if (!project) return reply.code(404).send({ error: 'project_not_found' })

    // Active project members only. We fetch the member rows and then the
    // associated users in a batched findMany so we return at most one
    // row per user even if a user has multiple project_member rows
    // (shouldn't happen given the uniqueness index, but belt + braces).
    const members = await app.prisma.projectMember.findMany({
      where: { projectId, removedAt: null },
      select: { userId: true, projectRole: true },
    })
    if (members.length === 0) return reply.send([])

    const userIds = Array.from(new Set(members.map(m => m.userId)))
    const users = await app.prisma.user.findMany({
      where: { id: { in: userIds }, status: 'active' },
      select: { id: true, name: true, email: true, initials: true, capabilities: true },
      orderBy: { name: 'asc' },
    })

    const projectRoleByUser = new Map<string, string | null>()
    for (const m of members) projectRoleByUser.set(m.userId, m.projectRole)

    const cap = parsed.data.capability as Capability | undefined
    const filtered = cap
      ? users.filter(u => (u.capabilities as string[]).includes(cap))
      : users

    return reply.send(filtered.map(u => ({
      id: u.id,
      name: u.name,
      email: u.email,
      initials: u.initials,
      capabilities: u.capabilities,
      projectRole: projectRoleByUser.get(u.id) ?? null,
    })))
  })
}
