// Target-journal catalogue — GET /journals.
//
// Read-only reference data for JournalSubmissionReadiness. Replaces the
// JOURNALS array that used to live inline in the component. Supports an
// optional `?scope=` filter (free-text match) and an `?icmje=true` filter
// (ICMJE-aligned journals only). No pagination today — the catalogue is
// small enough that a single page is fine; add it when we onboard a real
// list.

import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { requireAuth } from '../../../auth/rbac.js'

const listQuerySchema = z.object({
  scope: z.string().min(1).optional(),
  icmje: z.enum(['true', 'false']).optional(),
})

type JournalRow = {
  id: string
  name: string
  abbreviation: string
  impactFactor: number | null
  acceptanceRate: number | null
  timeToDecision: number | null
  isICMJE: boolean
  isEQUATOR: boolean
  scope: string | null
  submissionGuidelinesUrl: string | null
}

function journalShape(j: JournalRow) {
  return {
    id:                      j.id,
    name:                    j.name,
    abbreviation:            j.abbreviation,
    impactFactor:            j.impactFactor,
    acceptanceRate:          j.acceptanceRate,
    timeToDecision:          j.timeToDecision,
    isICMJE:                 j.isICMJE,
    isEQUATOR:               j.isEQUATOR,
    scope:                   j.scope,
    submissionGuidelinesUrl: j.submissionGuidelinesUrl,
  }
}

export const journalsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/journals', { preHandler: requireAuth({ modules: ['B'] }) }, async (request, reply) => {
    const parsed = listQuerySchema.safeParse(request.query)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const rows = await app.prisma.journal.findMany({
      where: {
        ...(parsed.data.scope ? { scope: { equals: parsed.data.scope, mode: 'insensitive' } } : {}),
        ...(parsed.data.icmje === 'true' ? { isICMJE: true } : {}),
        ...(parsed.data.icmje === 'false' ? { isICMJE: false } : {}),
      },
      orderBy: [{ impactFactor: 'desc' }, { name: 'asc' }],
    })

    return rows.map(journalShape)
  })
}
