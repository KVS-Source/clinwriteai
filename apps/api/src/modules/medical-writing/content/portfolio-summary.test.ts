// GET /projects/:projectId/med-content/portfolio/summary

import Fastify from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from '../../../auth/rbac.js'

const { medContentProjectScopedRoutes } = await import('./routes.js')

const PROJ = 'proj-1'

type Row = {
  status:          string
  stage:           number
  type:            string
  complianceTrack: string
  reviewTier:      string | null
  archivedAt:      Date | null
  expiryDate:      Date | null
  fkPassed:        boolean | null
}

const soonDate   = new Date(); soonDate.setDate(soonDate.getDate() + 30)
const farDate    = new Date(); farDate.setDate(farDate.getDate() + 200)
const pastDate   = new Date(); pastDate.setDate(pastDate.getDate() - 1)

async function build(rows: Row[]) {
  const app = Fastify()
  app.decorate('prisma', {
    medContentItem: {
      findMany: vi.fn(async () => rows),
    },
  } as never)
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (req) => {
    const user: AuthenticatedUser = { id: 'u1', email: 'u@x.io', role: 'medical-writer', modules: ['C'], tenantId: 't1' }
    ;(req as unknown as { user: AuthenticatedUser }).user = user
  })
  await app.register(medContentProjectScopedRoutes, { prefix: '/projects' })
  await app.ready()
  return app
}

const get = (app: Awaited<ReturnType<typeof build>>) =>
  app.inject({ method: 'GET', url: `/projects/${PROJ}/med-content/portfolio/summary` })

beforeEach(() => { process.env.FEATURE_MODULES_ENABLED = 'C' })

describe('GET /projects/:projectId/med-content/portfolio/summary', () => {
  it('returns zero-counts for an empty project', async () => {
    const res = await get(await build([]))
    expect(res.statusCode).toBe(200)
    const body = res.json() as { totals: { active: number; archived: number }; byStatus: Record<string, number> }
    expect(body.totals).toEqual({ active: 0, archived: 0 })
    expect(body.byStatus).toEqual({})
  })

  it('counts status / stage / type / compliance track / tier across active rows', async () => {
    const app = await build([
      { status: 'in_authoring',   stage: 2, type: 'hcp_deck',   complianceTrack: 'promotional',     reviewTier: 'A',  archivedAt: null, expiryDate: null, fkPassed: null },
      { status: 'in_authoring',   stage: 2, type: 'hcp_deck',   complianceTrack: 'promotional',     reviewTier: 'B',  archivedAt: null, expiryDate: null, fkPassed: null },
      { status: 'in_mlr_review',  stage: 4, type: 'pil',        complianceTrack: 'non_promotional', reviewTier: null, archivedAt: null, expiryDate: null, fkPassed: true },
      { status: 'approved',       stage: 6, type: 'cme_module', complianceTrack: 'cme',             reviewTier: 'C',  archivedAt: null, expiryDate: null, fkPassed: null },
      // archived — excluded from everything except totals.archived
      { status: 'approved',       stage: 6, type: 'hcp_deck',   complianceTrack: 'promotional',     reviewTier: 'A',  archivedAt: new Date(), expiryDate: null, fkPassed: null },
    ])
    const res = await get(app)
    const body = res.json() as {
      totals: { active: number; archived: number }
      byStatus: Record<string, number>
      byStage:  Record<string, number>
      byType:   Record<string, number>
      byComplianceTrack: Record<string, number>
      byReviewTier: Record<string, number>
    }
    expect(body.totals).toEqual({ active: 4, archived: 1 })
    expect(body.byStatus).toEqual({ in_authoring: 2, in_mlr_review: 1, approved: 1 })
    expect(body.byStage).toEqual({ '2': 2, '4': 1, '6': 1 })
    expect(body.byType).toMatchObject({ hcp_deck: 2, pil: 1, cme_module: 1 })
    expect(body.byComplianceTrack).toMatchObject({ promotional: 2, non_promotional: 1, cme: 1 })
    // Untiered (null) bucketed under 'untiered'
    expect(body.byReviewTier).toMatchObject({ A: 1, B: 1, C: 1, untiered: 1 })
  })

  it('counts expiringSoon within the 60-day window (and ignores past-expiry + far-future)', async () => {
    const app = await build([
      { status: 'approved', stage: 6, type: 'hcp_deck', complianceTrack: 'promotional', reviewTier: null, archivedAt: null, expiryDate: soonDate, fkPassed: null },
      { status: 'approved', stage: 6, type: 'hcp_deck', complianceTrack: 'promotional', reviewTier: null, archivedAt: null, expiryDate: farDate,  fkPassed: null },
      { status: 'approved', stage: 6, type: 'hcp_deck', complianceTrack: 'promotional', reviewTier: null, archivedAt: null, expiryDate: pastDate, fkPassed: null },
    ])
    const res = await get(app)
    const body = res.json() as { expiringSoon: { count: number; windowDays: number } }
    expect(body.expiringSoon).toEqual({ count: 1, windowDays: 60 })
  })

  it('counts FK pass / fail / unscored only across patient-facing types', async () => {
    const app = await build([
      { status: 'approved', stage: 6, type: 'pil',               complianceTrack: 'non_promotional', reviewTier: null, archivedAt: null, expiryDate: null, fkPassed: true  },
      { status: 'approved', stage: 6, type: 'pls_eu_ctr',        complianceTrack: 'non_promotional', reviewTier: null, archivedAt: null, expiryDate: null, fkPassed: false },
      { status: 'approved', stage: 6, type: 'patient_education', complianceTrack: 'non_promotional', reviewTier: null, archivedAt: null, expiryDate: null, fkPassed: null  },
      { status: 'approved', stage: 6, type: 'hcp_deck',          complianceTrack: 'promotional',     reviewTier: null, archivedAt: null, expiryDate: null, fkPassed: true  },
    ])
    const res = await get(app)
    const body = res.json() as { patientFacingFk: Record<string, number> }
    // HCP deck fkPassed=true does NOT land in the patient-facing roll-up.
    expect(body.patientFacingFk).toEqual({ pass: 1, fail: 1, unscored: 1 })
  })
})
