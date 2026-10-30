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
//   scope=raci (optional) — active + invited non-admins, capability filter
//                           off (POST …/raci grants a missing capability)
//
// Response is a minimal shape — the picker only needs name/email/
// capabilities to render a chip + capability-match check:
//
//   [{ id, name, email, initials, capabilities, projectRole }]
//
// Candidates: the project's members plus active module-A users of the project's tenant.
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
  // scope=raci — the RACI picker: every active or invited non-admin candidate,
  // whatever their capabilities (assigning a letter grants the missing one).
  scope: z.enum(['raci']).optional(),
})
const ADMIN_ROLES = ['admin', 'tenant-admin', 'super-admin']

export const assignableUsersRoutes: FastifyPluginAsync = async (app) => {
  app.get('/:projectId/assignable-users', { preHandler: requireAuth() }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string }
    const parsed = querySchema.safeParse(request.query)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const project = await app.prisma.project.findUnique({ where: { id: projectId }, select: { id: true, tenantId: true } })
    if (!project) return reply.code(404).send({ error: 'project_not_found' })

    // Active project members. Bridge the legacy ProjectTeamMember table
    // during the mig-47 cutover — fixture-seeded demo projects populate
    // ProjectTeamMember only. Without this bridge the RACI picker shows
    // "No active project members with the can-X capability" on any demo
    // project that predates the ProjectMember backfill.
    const [members, legacyTeam] = await Promise.all([
      app.prisma.projectMember.findMany({
        where: { projectId, removedAt: null },
        select: { userId: true, projectRole: true },
      }),
      app.prisma.projectTeamMember.findMany({
        where: { projectId },
        select: { userId: true, role: true },
      }),
    ])

    const projectRoleByUser = new Map<string, string | null>()
    for (const m of members)    projectRoleByUser.set(m.userId, m.projectRole)
    // Only set the legacy role when the user has no ProjectMember row —
    // new rows win over legacy on conflict.
    for (const t of legacyTeam) if (!projectRoleByUser.has(t.userId)) projectRoleByUser.set(t.userId, t.role)

    // Candidates are the project's members plus every active Clinical Writing (module A) user in the
    // project's tenant (users with no tenant recorded included). RACI assignment itself only checks the
    // capability, so a writer doesn't have to be added to the project first to be picked.
    const userIds = Array.from(projectRoleByUser.keys())
    const forRaci = parsed.data.scope === 'raci'
    const users = await app.prisma.user.findMany({
      where: {
        ...(forRaci
          ? { status: { in: ['active', 'invited'] }, role: { notIn: ADMIN_ROLES } }
          : { status: 'active' }),
        OR: [
          { id: { in: userIds } },
          {
            modules: { has: 'A' },
            ...(project.tenantId ? { OR: [{ tenantId: project.tenantId }, { tenantId: null }] } : {}),
          },
        ],
      },
      select: { id: true, name: true, email: true, initials: true, capabilities: true },
      orderBy: { name: 'asc' },
    })

    const cap = parsed.data.capability as Capability | undefined
    const filtered = cap && !forRaci
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
